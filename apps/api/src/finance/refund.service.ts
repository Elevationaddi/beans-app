import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/api-error.js";
import { isCheckViolation } from "../common/db-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, Refund } from "../generated/prisma/client.js";
import { BenefitsService } from "../engagement/benefits.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderRefund,
} from "../payments/payment-provider.js";
import { LedgerService } from "./ledger.service.js";

export const refundLimit = () =>
  new ApiError(
    HttpStatus.CONFLICT,
    "REFUND_LIMIT",
    "Refunds would exceed what was captured for this payment",
  );

/**
 * Refunds (docs/08, docs/04 A05). A manual refund is requested by a finance maker and
 * approved by a different finance checker (dual control, also enforced by a database CHECK).
 * Requested, approved, submitted and succeeded refunds can never exceed the captured amount:
 * a database trigger locks the payment row and checks the total (Q13). The provider is
 * called after commit with the stable key `refund:<id>`; the journal is posted only when the
 * provider confirms.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger("RefundService");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(BenefitsService) private readonly benefits: BenefitsService,
  ) {}

  async request(
    actor: { userId: string; requestId: string },
    input: { paymentId: string; amountFils: bigint; reason: string },
  ): Promise<Refund> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
        if (!payment) throw ApiError.notFound("Payment not found");
        if (payment.status !== "captured") {
          throw new ApiError(
            HttpStatus.CONFLICT,
            "CONFLICT",
            "Only captured payments can be refunded",
          );
        }
        const id = randomUUID();
        const refund = await tx.refund.create({
          data: {
            id,
            paymentId: payment.id,
            orderId: payment.orderId,
            kind: "manual",
            amountFils: input.amountFils,
            currency: payment.currency,
            reason: input.reason,
            requestedById: actor.userId,
            providerKey: `refund:${id}`,
          },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "refund.requested",
            targetType: "refund",
            targetId: refund.id,
            requestId: actor.requestId,
            reason: input.reason,
            after: { paymentId: payment.id, amountFils: input.amountFils.toString() },
          },
          tx,
        );
        return refund;
      });
    } catch (error) {
      if (isCheckViolation(error, "refund_limit")) throw refundLimit();
      throw error;
    }
  }

  async decide(
    actor: { userId: string; requestId: string },
    refundId: string,
    decision: "approve" | "reject",
    reason: string,
  ): Promise<Refund> {
    const refund = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
      if (!row) throw ApiError.notFound("Refund not found");
      const current = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      if (current.requestedById === actor.userId) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          "FORBIDDEN",
          "A refund must be approved by someone other than the person who requested it",
        );
      }
      if (current.status !== "requested") {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          `This refund is already ${current.status}`,
        );
      }
      const updated = await tx.refund.update({
        where: { id: refundId },
        data: {
          status: decision === "approve" ? "approved" : "rejected",
          decidedById: actor.userId,
          decisionReason: reason,
        },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: decision === "approve" ? "refund.approved" : "refund.rejected",
          targetType: "refund",
          targetId: refundId,
          requestId: actor.requestId,
          reason,
          before: { status: current.status },
          after: { status: updated.status },
        },
        tx,
      );
      return updated;
    });
    if (refund.status === "approved") await this.submit(refund.id);
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
  }

  /**
   * Automatic full refund of a payment captured after its hold expired (Q08). Created inside
   * the caller's transaction; submitted to the provider after commit.
   */
  async createLateCaptureRefund(
    tx: Prisma.TransactionClient,
    payment: { id: string; orderId: string; amountFils: bigint; currency: string },
  ): Promise<string> {
    const id = randomUUID();
    await tx.refund.create({
      data: {
        id,
        paymentId: payment.id,
        orderId: payment.orderId,
        kind: "late_capture",
        amountFils: payment.amountFils,
        currency: payment.currency,
        reason: "Payment was captured after the order's hold expired",
        status: "approved",
        providerKey: `refund:${id}`,
      },
    });
    // The customer is told once a notification provider is approved; the event is durable now.
    await this.outbox.enqueue(tx, {
      topic: "customer.payment_refunded",
      aggregateId: payment.orderId,
      dedupeKey: `refund:${id}:customer_notice`,
      payload: { orderId: payment.orderId, refundId: id, reason: "late_capture" },
    });
    return id;
  }

  /**
   * Automatic refund when a paid order is rejected, not accepted in time, or cancelled before
   * acceptance (docs/08: "initiate refund"). Refunds whatever of the captured payment is not
   * already committed to other refunds. Created in the caller's transaction (which holds the
   * order lock); submit it after commit. Returns null when nothing is left to refund.
   */
  async createOrderCancelRefund(
    tx: Prisma.TransactionClient,
    orderId: string,
    reason: string,
  ): Promise<string | null> {
    const payment = await tx.payment.findFirst({ where: { orderId, status: "captured" } });
    if (!payment) return null;
    const committed = await tx.refund.aggregate({
      where: {
        paymentId: payment.id,
        status: { in: ["requested", "approved", "submitted", "succeeded"] },
      },
      _sum: { amountFils: true },
    });
    const amount = payment.amountFils - (committed._sum.amountFils ?? 0n);
    if (amount <= 0n) return null;
    const id = randomUUID();
    await tx.refund.create({
      data: {
        id,
        paymentId: payment.id,
        orderId,
        kind: "order_cancelled",
        amountFils: amount,
        currency: payment.currency,
        reason,
        status: "approved",
        providerKey: `refund:${id}`,
      },
    });
    await this.outbox.enqueue(tx, {
      topic: "customer.payment_refunded",
      aggregateId: orderId,
      dedupeKey: `refund:${id}:customer_notice`,
      payload: { orderId, refundId: id, reason: "order_cancelled" },
    });
    return id;
  }

  /** Sends an approved refund to the provider (same key on every try) and applies the answer. */
  async submit(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: { select: { providerRef: true } } },
    });
    if (refund.status !== "approved" && refund.status !== "submitted") return;
    if (refund.status === "submitted" && refund.providerRef) return this.refresh(refundId);
    if (!refund.payment.providerRef) {
      this.logger.error(`refund ${refund.id}: payment has no provider reference`);
      return;
    }
    let result: ProviderRefund;
    try {
      result = await this.provider.refund({
        idempotencyKey: refund.providerKey,
        paymentRef: refund.payment.providerRef,
        amountFils: refund.amountFils,
        currency: "AED",
      });
    } catch (error) {
      // Stays approved; the sweep retries with the same key.
      this.logger.warn(`refund ${refund.id}: provider call failed: ${String(error)}`);
      return;
    }
    await this.apply(refund.id, result);
  }

  async refresh(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.status !== "submitted" || !refund.providerRef) return;
    const result = await this.provider.fetchRefund(refund.providerRef);
    if (result) await this.apply(refund.id, result);
  }

  /** Records the provider's answer once; posts the journal on success. */
  async apply(refundId: string, result: ProviderRefund): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      if (refund.status !== "approved" && refund.status !== "submitted") return;
      if (result.amountFils !== refund.amountFils || result.currency !== refund.currency) {
        this.logger.error(`refund ${refund.id}: provider amount or currency mismatch`);
        return;
      }
      if (result.status === "pending") {
        await tx.refund.update({
          where: { id: refund.id },
          data: { status: "submitted", providerRef: result.providerRef },
        });
        return;
      }
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: result.status,
          providerRef: result.providerRef,
          failureCode: result.status === "failed" ? (result.failureCode ?? "failed") : null,
        },
      });
      if (result.status === "succeeded") {
        await this.ledger.postRefund(tx, refund);
        // Stamps earned by the order are taken back in proportion to what is refunded (once per refund).
        await this.benefits.onRefundSucceeded(tx, refund.orderId, refund.id);
      }
      await this.outbox.enqueue(tx, {
        topic: "refund.updated",
        aggregateId: refund.orderId,
        dedupeKey: `refund:${refund.id}:${result.status}`,
        payload: { orderId: refund.orderId, refundId: refund.id, status: result.status },
      });
    });
  }

  /** Retries approved refunds and polls submitted ones. */
  async sweep(limit = 50): Promise<number> {
    const open = await this.prisma.refund.findMany({
      where: { status: { in: ["approved", "submitted"] } },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true },
    });
    for (const r of open) await this.submit(r.id);
    return open.length;
  }
}
