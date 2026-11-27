import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OrderStatus, Prisma } from "../generated/prisma/client.js";
import { LedgerService } from "../finance/ledger.service.js";
import { RefundService } from "../finance/refund.service.js";
import { StockService } from "../inventory/stock.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderPayment,
} from "../payments/payment-provider.js";
import { PickupCodes } from "./pickup-code.js";

export interface LockedOrder {
  id: string;
  user_id: string;
  branch_id: string;
  status: OrderStatus;
  version: number;
  reservation_id: string;
  quote_id: string;
}

/**
 * Applies what the payment provider says to an order, exactly once (docs/08):
 * - captured: the payment is recorded, the held slot place becomes confirmed, the reservation
 *   is committed and the order moves pending_payment → received. Only then do staff see it.
 * - failed: the attempt is recorded as failed; the order keeps its holds so the customer can
 *   retry with a new attempt until the hold expires.
 * - pending: nothing changes.
 * Expired holds are released only after asking the provider (reconcile before release).
 * Every change locks the order row first, so the sweep and a customer retry cannot race.
 */
@Injectable()
export class PaymentReconciler {
  private readonly logger = new Logger("PaymentReconciler");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(RefundService) private readonly refunds: RefundService,
    @Inject(PickupCodes) private readonly pickupCodes: PickupCodes,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Records a provider answer for one attempt. Safe to call repeatedly. */
  async apply(paymentId: string, result: ProviderPayment): Promise<void> {
    const lateRefundId = await this.prisma.$transaction(async (tx): Promise<string | null> => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const order = await this.lockOrder(tx, payment.orderId);
      const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (current.status !== "pending") return null; // already final: nothing to do

      if (result.amountFils !== current.amountFils || result.currency !== current.currency) {
        // Never commit an order on a mismatched amount; leave it pending for review.
        this.logger.error(`payment ${current.id}: provider amount or currency mismatch`);
        return null;
      }
      if (result.status === "pending") {
        if (current.providerRef === null) {
          await tx.payment.update({
            where: { id: current.id },
            data: { providerRef: result.providerRef },
          });
        }
        return null;
      }
      await tx.payment.update({
        where: { id: current.id },
        data: {
          providerRef: result.providerRef,
          status: result.status,
          failureCode: result.status === "failed" ? (result.failureCode ?? "declined") : null,
        },
      });
      if (result.status === "failed") return null;

      // Captured: the money is with the provider whatever happens to the order.
      await this.ledger.postCapture(tx, current);
      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: order.reservation_id },
      });
      if (order.status === "pending_payment" && reservation.state === "held") {
        await this.commit(tx, order, reservation.slotId, current.id);
        return null;
      }
      // Late capture after the hold was released (Q08). The order cannot go back from
      // payment_failed (docs/08 state machine), so the payment is refunded in full,
      // automatically, and the customer notice is queued.
      this.logger.warn(
        `payment ${current.id} captured after order ${order.id} was ${order.status}`,
      );
      return this.refunds.createLateCaptureRefund(tx, current);
    });
    if (lateRefundId) await this.refunds.submit(lateRefundId);
  }

  /** Asks the provider about the order's open attempt and applies the answer. */
  async refresh(orderId: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: "pending" },
    });
    if (!payment) return;
    let result: ProviderPayment | null;
    try {
      result = payment.providerRef
        ? await this.provider.fetchPayment(payment.providerRef)
        : await this.provider.findByKey(payment.providerKey);
    } catch (error) {
      this.logger.warn(`payment ${payment.id}: provider lookup failed: ${String(error)}`);
      return;
    }
    if (result) await this.apply(payment.id, result);
  }

  /**
   * Releases one expired hold after reconciling with the provider. A capture found during
   * reconciliation commits the order instead. Returns the order's resulting status.
   */
  async expire(reservationId: string, now = new Date()): Promise<OrderStatus | null> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { order: { select: { id: true } } },
    });
    if (!reservation?.order) return null;
    await this.refresh(reservation.order.id);

    return this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, reservation.order?.id ?? "");
      const fresh = await tx.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { items: { include: { branchProduct: true } } },
      });
      if (order.status !== "pending_payment" || fresh.state !== "held" || fresh.expiresAt > now) {
        return order.status;
      }
      const stillPending = await tx.payment.count({
        where: { orderId: order.id, status: "pending" },
      });
      // Slot first, then stock by product ID: the same lock order as checkout.
      await tx.$executeRaw`
        UPDATE slots SET reserved = reserved - 1, updated_at = now()
        WHERE id = ${fresh.slotId}::uuid AND reserved >= 1`;
      const items = [...fresh.items].sort((a, b) =>
        a.branchProduct.productId < b.branchProduct.productId ? -1 : 1,
      );
      for (const item of items) {
        await this.stock.release(
          tx,
          item.branchProduct.branchId,
          item.branchProduct.productId,
          item.quantity,
        );
      }
      await tx.reservation.update({ where: { id: fresh.id }, data: { state: "released" } });
      await this.transition(tx, order, "payment_failed", {
        reason: stillPending > 0 ? "payment_unconfirmed_at_expiry" : "payment_not_completed",
      });
      await this.restoreCart(tx, order);
      return "payment_failed" as const;
    });
  }

  /** One sweep: poll open attempts, then release expired holds. Returns counts for logging. */
  async sweep(now = new Date(), limit = 50): Promise<{ polled: number; expired: number }> {
    const open = await this.prisma.payment.findMany({
      where: { status: "pending", order: { status: "pending_payment" } },
      select: { orderId: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
    for (const p of open) await this.refresh(p.orderId);
    const expired = await this.prisma.reservation.findMany({
      where: { state: "held", expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: limit,
    });
    for (const r of expired) await this.expire(r.id, now);
    return { polled: open.length, expired: expired.length };
  }

  async lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<LockedOrder> {
    const [order] = await tx.$queryRaw<LockedOrder[]>`
      SELECT id, user_id, branch_id, status, version, reservation_id, quote_id
      FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    if (!order) throw new Error(`order ${orderId} not found`);
    return order;
  }

  private async commit(
    tx: Prisma.TransactionClient,
    order: LockedOrder,
    slotId: string,
    paymentId: string,
  ): Promise<void> {
    // Held place → confirmed place. Stock stays reserved until the order is completed.
    const moved = await tx.$executeRaw`
      UPDATE slots SET reserved = reserved - 1, confirmed = confirmed + 1, updated_at = now()
      WHERE id = ${slotId}::uuid AND reserved >= 1`;
    if (moved !== 1) throw new Error(`slot ${slotId} has no held place for order ${order.id}`);
    await tx.reservation.update({
      where: { id: order.reservation_id },
      data: { state: "committed" },
    });
    // Staff see the order now; the handoff code is issued and the acceptance clock starts.
    await this.transition(tx, order, "received", {
      metadata: { paymentId },
      data: {
        pickupCodeHash: this.pickupCodes.hashFor(order.id),
        acceptBy: new Date(Date.now() + this.env.ACCEPT_TIMEOUT_SECONDS * 1000),
      },
    });
  }

  /**
   * Moves the locked order to a new status: version bump, timeline event and outbox, together.
   * `data` changes other columns in the same update. Returns the new version.
   */
  async transition(
    tx: Prisma.TransactionClient,
    order: LockedOrder,
    to: OrderStatus,
    extra: {
      reason?: string;
      metadata?: Prisma.InputJsonObject;
      actorId?: string;
      data?: Prisma.OrderUncheckedUpdateInput;
    } = {},
  ): Promise<number> {
    await tx.order.update({
      where: { id: order.id },
      data: { ...extra.data, status: to, version: order.version + 1 },
    });
    const last = await tx.orderEvent.findFirst({
      where: { orderId: order.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        seq: (last?.seq ?? 0) + 1,
        fromState: order.status,
        toState: to,
        actorId: extra.actorId ?? null,
        reason: extra.reason ?? null,
        metadata: extra.metadata ?? {},
      },
    });
    await this.announce(tx, order, to);
    return order.version + 1;
  }

  /**
   * A change that is not a status change (curbside arrival, its acknowledgement): version
   * bump and outbox only, so tablets and the customer app refetch. Returns the new version.
   */
  async touch(
    tx: Prisma.TransactionClient,
    order: LockedOrder,
    data: Prisma.OrderUncheckedUpdateInput,
  ): Promise<number> {
    await tx.order.update({
      where: { id: order.id },
      data: { ...data, version: order.version + 1 },
    });
    await this.announce(tx, order, order.status);
    return order.version + 1;
  }

  private async announce(tx: Prisma.TransactionClient, order: LockedOrder, status: OrderStatus) {
    await this.outbox.enqueue(tx, {
      topic: "order.updated",
      aggregateId: order.id,
      dedupeKey: `order:${order.id}:v${order.version + 1}`,
      payload: {
        orderId: order.id,
        branchId: order.branch_id,
        userId: order.user_id,
        status,
        version: order.version + 1,
        occurredAt: new Date().toISOString(),
      },
    });
  }

  /** After a failed checkout, give the customer their cart back unless they started a new one. */
  private async restoreCart(tx: Prisma.TransactionClient, order: LockedOrder): Promise<void> {
    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: order.quote_id },
      select: { cartId: true },
    });
    const active = await tx.cart.count({ where: { userId: order.user_id, status: "active" } });
    if (active > 0) return;
    await tx.$executeRaw`
      UPDATE carts SET status = 'active', version = version + 1, updated_at = now()
      WHERE id = ${quote.cartId}::uuid AND status = 'converted'`;
  }
}
