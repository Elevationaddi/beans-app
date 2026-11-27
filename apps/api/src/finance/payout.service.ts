import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Payout, Prisma } from "../generated/prisma/client.js";
import { OutboxService } from "../outbox/outbox.service.js";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderPayout,
} from "../payments/payment-provider.js";
import { LedgerService } from "./ledger.service.js";

/**
 * Sandbox payout simulation (D04 not approved: schedule, holds, negative balances). A maker
 * drafts a payout of the merchant's available payable up to a period end; a different checker
 * approves it; the provider is called after commit with `payout:<id>`; the journal is posted
 * only when the provider confirms. The merchant row is locked while earnings are allocated,
 * so two drafts can never cover the same earnings. Open reconciliation exceptions block
 * payouts (docs/04 A05: mismatched totals block payout).
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger("PayoutService");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Available payable: earnings up to periodEnd, less refund reversals and active payouts. */
  async available(
    db: Prisma.TransactionClient | PrismaService,
    merchantId: string,
    periodEnd: Date,
  ) {
    const [row] = await db.$queryRaw<{ credits: bigint; debits: bigint; allocated: bigint }[]>`
      SELECT
        (SELECT COALESCE(SUM(l.credit_fils), 0) FROM journal_lines l
           WHERE l.account_code = 'merchant_payable' AND l.merchant_id = ${merchantId}::uuid
             AND l.created_at <= ${periodEnd})::bigint AS credits,
        (SELECT COALESCE(SUM(l.debit_fils), 0) FROM journal_lines l
           JOIN journal_transactions j ON j.id = l.journal_id
           WHERE l.account_code = 'merchant_payable' AND l.merchant_id = ${merchantId}::uuid
             AND j.source_type <> 'payout')::bigint AS debits,
        (SELECT COALESCE(SUM(a.amount_fils), 0) FROM payout_allocations a
           JOIN payouts p ON p.id = a.payout_id
           WHERE p.merchant_id = ${merchantId}::uuid
             AND p.status IN ('pending_approval', 'approved', 'submitted', 'paid'))::bigint AS allocated`;
    return (row?.credits ?? 0n) - (row?.debits ?? 0n) - (row?.allocated ?? 0n);
  }

  async draft(
    actor: { userId: string; requestId: string },
    input: { merchantId: string; periodEnd: Date },
  ): Promise<Payout> {
    if (input.periodEnd > new Date()) {
      throw ApiError.validation({ periodEnd: ["Must not be in the future"] });
    }
    return this.prisma.$transaction(async (tx) => {
      const [merchant] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM merchants WHERE id = ${input.merchantId}::uuid FOR UPDATE`;
      if (!merchant) throw ApiError.notFound("Merchant not found");
      await this.assertNoOpenExceptions(tx, input.merchantId);
      const amount = await this.available(tx, input.merchantId, input.periodEnd);
      if (amount <= 0n) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "VALIDATION_FAILED",
          "Nothing is available to pay out for this merchant and period",
          { merchantId: [`Available payable is ${amount} fils`] },
        );
      }
      const id = randomUUID();
      const payout = await tx.payout.create({
        data: {
          id,
          merchantId: input.merchantId,
          amountFils: amount,
          periodEnd: input.periodEnd,
          makerId: actor.userId,
          providerKey: `payout:${id}`,
        },
      });
      await this.allocate(tx, payout);
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "payout.drafted",
          targetType: "payout",
          targetId: payout.id,
          requestId: actor.requestId,
          after: { merchantId: input.merchantId, amountFils: amount.toString() },
        },
        tx,
      );
      return payout;
    });
  }

  async decide(
    actor: { userId: string; requestId: string },
    payoutId: string,
    decision: "approve" | "reject",
    reason: string,
  ): Promise<Payout> {
    const payout = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!current) throw ApiError.notFound("Payout not found");
      await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${current.merchantId}::uuid FOR UPDATE`;
      const locked = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      if (locked.makerId === actor.userId) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          "FORBIDDEN",
          "A payout must be approved by someone other than the person who drafted it",
        );
      }
      if (locked.status !== "pending_approval") {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          `This payout is already ${locked.status}`,
        );
      }
      if (decision === "approve") await this.assertNoOpenExceptions(tx, locked.merchantId);
      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: decision === "approve" ? "approved" : "rejected",
          checkerId: actor.userId,
          decisionReason: reason,
        },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: decision === "approve" ? "payout.approved" : "payout.rejected",
          targetType: "payout",
          targetId: payoutId,
          requestId: actor.requestId,
          reason,
          before: { status: locked.status },
          after: { status: updated.status },
        },
        tx,
      );
      return updated;
    });
    if (payout.status === "approved") await this.submit(payout.id);
    return this.prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
  }

  async submit(payoutId: string): Promise<void> {
    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status === "submitted" && payout.providerRef) return this.refresh(payoutId);
    if (payout.status !== "approved") return;
    let result: ProviderPayout;
    try {
      result = await this.provider.initiatePayout({
        idempotencyKey: payout.providerKey,
        merchantId: payout.merchantId,
        amountFils: payout.amountFils,
        currency: "AED",
      });
    } catch (error) {
      this.logger.warn(`payout ${payout.id}: provider call failed: ${String(error)}`);
      return;
    }
    await this.apply(payout.id, result);
  }

  async refresh(payoutId: string): Promise<void> {
    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status !== "submitted" || !payout.providerRef) return;
    const result = await this.provider.fetchPayout(payout.providerRef);
    if (result) await this.apply(payout.id, result);
  }

  async apply(payoutId: string, result: ProviderPayout): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      if (payout.status !== "approved" && payout.status !== "submitted") return;
      if (result.amountFils !== payout.amountFils || result.currency !== payout.currency) {
        this.logger.error(`payout ${payout.id}: provider amount or currency mismatch`);
        return;
      }
      if (result.status === "pending") {
        await tx.payout.update({
          where: { id: payout.id },
          data: { status: "submitted", providerRef: result.providerRef },
        });
        return;
      }
      await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: result.status,
          providerRef: result.providerRef,
          failureCode: result.status === "failed" ? (result.failureCode ?? "failed") : null,
        },
      });
      // A failed payout releases its allocations (status no longer active); the journal is untouched.
      if (result.status === "paid") await this.ledger.postPayout(tx, payout);
      await this.outbox.enqueue(tx, {
        topic: "payout.updated",
        aggregateId: payout.merchantId,
        dedupeKey: `payout:${payout.id}:${result.status}`,
        payload: { payoutId: payout.id, merchantId: payout.merchantId, status: result.status },
      });
    });
  }

  async sweep(limit = 50): Promise<number> {
    const open = await this.prisma.payout.findMany({
      where: { status: { in: ["approved", "submitted"] } },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true },
    });
    for (const p of open) await this.submit(p.id);
    return open.length;
  }

  /** First-in-first-out over the merchant's unallocated earnings lines. */
  private async allocate(tx: Prisma.TransactionClient, payout: Payout): Promise<void> {
    const lines = await tx.$queryRaw<{ id: string; remaining: bigint }[]>`
      SELECT l.id, (l.credit_fils - COALESCE((
          SELECT SUM(a.amount_fils) FROM payout_allocations a JOIN payouts p ON p.id = a.payout_id
          WHERE a.journal_line_id = l.id
            AND p.status IN ('pending_approval', 'approved', 'submitted', 'paid')), 0))::bigint AS remaining
      FROM journal_lines l
      WHERE l.account_code = 'merchant_payable' AND l.merchant_id = ${payout.merchantId}::uuid
        AND l.credit_fils > 0 AND l.created_at <= ${payout.periodEnd}
      ORDER BY l.created_at, l.id`;
    let left = payout.amountFils;
    const data: { payoutId: string; journalLineId: string; amountFils: bigint }[] = [];
    for (const line of lines) {
      if (left === 0n) break;
      if (line.remaining <= 0n) continue;
      const take = line.remaining < left ? line.remaining : left;
      data.push({ payoutId: payout.id, journalLineId: line.id, amountFils: take });
      left -= take;
    }
    if (left !== 0n) throw new Error(`payout ${payout.id}: earnings do not cover the amount`);
    await tx.payoutAllocation.createMany({ data });
  }

  private async assertNoOpenExceptions(tx: Prisma.TransactionClient, merchantId: string) {
    const open = await tx.reconciliationException.count({
      where: { status: "open", OR: [{ merchantId }, { merchantId: null }] },
    });
    if (open > 0) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "CONFLICT",
        "Open reconciliation differences block payouts for this merchant. Resolve them first.",
      );
    }
  }
}
