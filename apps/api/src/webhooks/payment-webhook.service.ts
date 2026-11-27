import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import { PayoutService } from "../finance/payout.service.js";
import { RefundService } from "../finance/refund.service.js";
import { PaymentReconciler } from "../ordering/payment-reconciler.service.js";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  WebhookVerificationError,
} from "../payments/payment-provider.js";

const MAX_ATTEMPTS = 10;

/**
 * Provider webhooks (docs/10: signed raw body, replay window, unique event ID; Q07).
 * 1. Verify the signature over the exact raw bytes and the timestamp window; forged or stale
 *    events are refused with 401 and nothing is stored.
 * 2. Store a durable receipt keyed by (provider, event ID); a duplicate is acknowledged
 *    without doing anything again.
 * 3. Process: the event only says which object changed. Its current state is fetched from
 *    the provider and applied idempotently, so out-of-order events cannot move anything
 *    backwards. A processing failure still answers 2xx; the sweep retries the receipt.
 * The raw payload is never logged or stored, only its SHA-256.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger("PaymentWebhooks");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PaymentReconciler) private readonly reconciler: PaymentReconciler,
    @Inject(RefundService) private readonly refunds: RefundService,
    @Inject(PayoutService) private readonly payouts: PayoutService,
  ) {}

  async receive(
    providerName: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: true; duplicate: boolean }> {
    if (providerName !== this.provider.name) throw ApiError.notFound("Unknown payment provider");
    if (!rawBody || rawBody.length === 0) throw ApiError.validation({ body: ["Empty body"] });
    let event;
    try {
      event = this.provider.verifyWebhook(rawBody, headers);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        this.logger.warn(`rejected ${providerName} webhook: ${error.message}`);
        throw ApiError.unauthenticated("Webhook signature is not valid");
      }
      throw error;
    }
    let id: string;
    try {
      const row = await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: providerName,
          eventId: event.eventId,
          type: event.type,
          providerRef: event.providerRef,
          payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
        },
      });
      id = row.id;
    } catch (error) {
      if (isUniqueViolation(error)) return { received: true, duplicate: true };
      throw error;
    }
    await this.process(id);
    return { received: true, duplicate: false };
  }

  /** Processes one stored receipt. Never throws: failures are recorded for the sweep. */
  async process(receiptId: string): Promise<void> {
    const receipt = await this.prisma.paymentWebhookEvent.findUniqueOrThrow({
      where: { id: receiptId },
    });
    if (receipt.status === "processed" || receipt.status === "ignored") return;
    try {
      const handled = await this.apply(receipt.type, receipt.providerRef ?? "");
      await this.prisma.paymentWebhookEvent.update({
        where: { id: receipt.id },
        data: {
          status: handled ? "processed" : "ignored",
          attempts: { increment: 1 },
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      this.logger.error(`webhook ${receipt.id} failed: ${String(error)}`);
      await this.prisma.paymentWebhookEvent.update({
        where: { id: receipt.id },
        data: {
          status: "failed",
          attempts: { increment: 1 },
          lastError: String(error).slice(0, 500),
        },
      });
    }
  }

  async sweep(limit = 50): Promise<number> {
    const open = await this.prisma.paymentWebhookEvent.findMany({
      where: { status: { in: ["received", "failed"] }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { receivedAt: "asc" },
      take: limit,
      select: { id: true },
    });
    for (const r of open) await this.process(r.id);
    return open.length;
  }

  /** Returns false when the object is not ours (ignored). */
  private async apply(type: string, providerRef: string): Promise<boolean> {
    const [kind] = type.split(".");
    if (kind === "payment") {
      const payment = await this.prisma.payment.findUnique({ where: { providerRef } });
      if (!payment) return false;
      await this.reconciler.refresh(payment.orderId);
      return true;
    }
    if (kind === "refund") {
      const refund = await this.prisma.refund.findUnique({ where: { providerRef } });
      if (!refund) return false;
      await this.refunds.refresh(refund.id);
      return true;
    }
    if (kind === "payout") {
      const payout = await this.prisma.payout.findUnique({ where: { providerRef } });
      if (!payout) return false;
      await this.payouts.refresh(payout.id);
      return true;
    }
    return false;
  }
}
