import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { TransitionRequest } from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/api-error.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import { LedgerService } from "../finance/ledger.service.js";
import { RefundService } from "../finance/refund.service.js";
import type { OrderStatus, Prisma } from "../generated/prisma/client.js";
import { StockService } from "../inventory/stock.service.js";
import { type LockedOrder, PaymentReconciler } from "../ordering/payment-reconciler.service.js";
import {
  PICKUP_CODE_LOCK_MS,
  PICKUP_CODE_MAX_FAILURES,
  PickupCodes,
} from "../ordering/pickup-code.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";

type Tx = Prisma.TransactionClient;

/** Roles that run the order queue (docs/10: analysts never touch orders). */
const QUEUE_ROLES = new Set(["owner", "manager", "barista"]);

/** Staff steps: from → to (docs/08 state machine). Reject is separate: it refunds. */
const STEPS = {
  accept: { from: "received", to: "accepted" },
  reject: { from: "received", to: "rejected" },
  start: { from: "accepted", to: "preparing" },
  ready: { from: "preparing", to: "ready" },
  complete: { from: "ready", to: "completed" },
} as const satisfies Record<TransitionRequest["action"], { from: OrderStatus; to: OrderStatus }>;

const UNPAID = new Set<OrderStatus>(["pending_payment", "payment_failed"]);

const OPEN_FOR_CUSTOMER_CANCEL: OrderStatus[] = ["accepted", "preparing", "ready"];

export const staleOrder = (current: number) =>
  new ApiError(
    HttpStatus.CONFLICT,
    "CONFLICT",
    "This order changed, for example on another tablet. Reload it and try again.",
    { expectedVersion: [`Current version is ${current}`] },
  );

export const invalidTransition = (message: string) =>
  new ApiError(HttpStatus.CONFLICT, "INVALID_TRANSITION", message);

interface Actor {
  userId: string;
  requestId: string;
}

/**
 * Fulfilment (phase 8, docs/05 and docs/08): staff steps on the branch queue, the acceptance
 * timeout, curbside arrival, handoff with the pickup code, and cancellations. Every change
 * locks the order row, checks the expected version, and writes the status, timeline event and
 * outbox signal in one transaction, so two tablets cannot both win (Q10). Money follows
 * afterwards: refunds are created in the same transaction and sent to the provider after commit.
 */
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger("Fulfillment");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentReconciler) private readonly orders: PaymentReconciler,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(RefundService) private readonly refunds: RefundService,
    @Inject(PickupCodes) private readonly pickupCodes: PickupCodes,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The order's branch, when the caller runs that branch's queue. 404 otherwise. */
  async requireQueueAccess(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, status: true },
    });
    // Staff never see an order before its payment is captured (docs/08).
    if (!order || UNPAID.has(order.status)) throw ApiError.notFound("Order not found");
    await this.requireBranchQueue(userId, order.branchId, "Order");
    return order;
  }

  async requireBranchQueue(userId: string, branchId: string, resource = "Branch") {
    let access;
    try {
      access = await this.access.requireBranch(userId, branchId);
    } catch (error) {
      if (error instanceof ApiError && error.code === "NOT_FOUND")
        throw ApiError.notFound(`${resource} not found`);
      throw error;
    }
    if (!QUEUE_ROLES.has(access.role)) {
      throw ApiError.forbidden("Only the owner, managers and baristas can work on orders");
    }
    return access;
  }

  // ── Staff ────────────────────────────────────────────────────────────────

  async transition(actor: Actor, orderId: string, body: TransitionRequest): Promise<void> {
    await this.requireQueueAccess(actor.userId, orderId);
    const step = STEPS[body.action];
    const outcome = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockFresh(tx, orderId, body.expectedVersion);
      if (order.status !== step.from) {
        throw invalidTransition(`This order is ${order.status}; it cannot be ${verb(body.action)}`);
      }
      const now = new Date();
      switch (body.action) {
        case "accept": {
          const row = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          if (row.acceptBy && row.acceptBy <= now) {
            throw invalidTransition("The time to accept this order has passed");
          }
          await this.orders.transition(tx, order, "accepted", {
            actorId: actor.userId,
            metadata: { etaMinutes: body.etaMinutes },
            data: { etaAt: new Date(now.getTime() + body.etaMinutes * 60_000) },
          });
          return { refundId: null };
        }
        case "reject":
          return {
            refundId: await this.cancelPaidOrder(tx, order, "rejected", {
              actorId: actor.userId,
              reason: body.reason,
              refundReason: "Order rejected by the branch",
            }),
          };
        case "start":
        case "ready":
          await this.orders.transition(tx, order, step.to, { actorId: actor.userId });
          return { refundId: null };
        case "complete":
          return this.complete(tx, order, actor, body.pickupCode, now);
      }
    });
    if ("wrongCode" in outcome) {
      throw outcome.locked
        ? pickupLocked()
        : new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "VALIDATION_FAILED",
            "That pickup code is not right. Ask the customer to show the code in their app.",
            { pickupCode: ["Wrong code"] },
          );
    }
    if (outcome.refundId) await this.refunds.submit(outcome.refundId);
  }

  private async complete(
    tx: Tx,
    order: LockedOrder,
    actor: Actor,
    code: string,
    now: Date,
  ): Promise<{ refundId: null } | { wrongCode: true; locked: boolean }> {
    const row = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    if (row.pickupCodeLockedTil && row.pickupCodeLockedTil > now) throw pickupLocked();
    if (!this.pickupCodes.verify(row.pickupCodeHash, order.id, code)) {
      const failures = row.pickupCodeFailures + 1;
      const locked = failures >= PICKUP_CODE_MAX_FAILURES;
      // Recorded without a version bump: nothing a client shows has changed.
      await tx.order.update({
        where: { id: order.id },
        data: locked
          ? {
              pickupCodeFailures: 0,
              pickupCodeLockedTil: new Date(now.getTime() + PICKUP_CODE_LOCK_MS),
            }
          : { pickupCodeFailures: failures },
      });
      return { wrongCode: true, locked };
    }
    const curbsideAck =
      row.mode === "curbside" && row.arrivedAt && !row.arrivalAckAt
        ? { arrivalAckAt: now, arrivalAckById: actor.userId }
        : {};
    await this.orders.transition(tx, order, "completed", {
      actorId: actor.userId,
      data: { ...curbsideAck, pickupCodeFailures: 0, pickupCodeLockedTil: null },
    });
    // Handed over: held stock leaves the shelf, and the merchant's earning is posted.
    await this.settleStock(tx, order.reservation_id, "consume");
    await this.ledger.postCompletion(tx, order.id, now);
    return { refundId: null };
  }

  async acknowledgeArrival(actor: Actor, orderId: string, expectedVersion: number) {
    await this.requireQueueAccess(actor.userId, orderId);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.orders.lockOrder(tx, orderId);
      const row = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (row.arrivalAckAt) return; // repeat: the same acknowledgement
      if (order.version !== expectedVersion) throw staleOrder(order.version);
      if (row.mode !== "curbside" || !row.arrivedAt) {
        throw invalidTransition("The customer has not checked in for curbside pickup");
      }
      if (!OPEN_FOR_CUSTOMER_CANCEL.includes(order.status)) {
        throw invalidTransition(`This order is ${order.status}`);
      }
      await this.orders.touch(tx, order, {
        arrivalAckAt: new Date(),
        arrivalAckById: actor.userId,
      });
    });
  }

  // ── Customer ─────────────────────────────────────────────────────────────

  /** Curbside check-in (docs/08): after acceptance; repeats return the same arrival. */
  async arrive(userId: string, orderId: string, expectedVersion: number) {
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.order.findFirst({
        where: { id: orderId, userId },
        select: { id: true },
      });
      if (!owned) throw ApiError.notFound("Order not found");
      const order = await this.orders.lockOrder(tx, orderId);
      const row = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (row.arrivedAt) return; // repeat: the same arrival, whatever version was sent (Q11)
      if (row.mode !== "curbside") {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "VALIDATION_FAILED",
          "Check-in is only for curbside pickup",
          { mode: ["Not curbside"] },
        );
      }
      if (order.version !== expectedVersion) throw staleOrder(order.version);
      if (!OPEN_FOR_CUSTOMER_CANCEL.includes(order.status)) {
        throw invalidTransition(
          order.status === "received"
            ? "You can check in once the branch accepts your order"
            : `This order is ${order.status}`,
        );
      }
      await this.orders.touch(tx, order, { arrivedAt: new Date() });
    });
  }

  /**
   * D05 (sandbox): before acceptance the order is cancelled at once and refunded; after
   * acceptance an open request goes to operations and nothing else changes (Q12).
   */
  async requestCancellation(userId: string, orderId: string, reason: string) {
    try {
      return await this.requestCancellationOnce(userId, orderId, reason);
    } catch (error) {
      // Two taps at once: the partial unique index lets one open request through.
      if (isUniqueViolation(error)) return this.requestCancellationOnce(userId, orderId, reason);
      throw error;
    }
  }

  private async requestCancellationOnce(userId: string, orderId: string, reason: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const owned = await tx.order.findFirst({
        where: { id: orderId, userId },
        select: { id: true },
      });
      if (!owned) throw ApiError.notFound("Order not found");
      const order = await this.orders.lockOrder(tx, orderId);
      const open = await tx.cancellationRequest.findFirst({
        where: { orderId, status: "open" },
      });
      if (open) return { requestId: open.id, refundId: null, outcome: "review" as const };
      if (order.status === "received") {
        const request = await tx.cancellationRequest.create({
          data: {
            orderId,
            userId,
            reason,
            orderStatus: order.status,
            status: "approved",
            resolutionReason: "Cancelled before the branch accepted (automatic)",
          },
        });
        const refundId = await this.cancelPaidOrder(tx, order, "cancelled", {
          actorId: userId,
          reason: "customer_cancelled_before_acceptance",
          refundReason: "Cancelled by the customer before acceptance",
        });
        return { requestId: request.id, refundId, outcome: "cancelled" as const };
      }
      if (!OPEN_FOR_CUSTOMER_CANCEL.includes(order.status)) {
        throw invalidTransition(`This order is ${order.status}; it cannot be cancelled`);
      }
      const request = await tx.cancellationRequest.create({
        data: { orderId, userId, reason, orderStatus: order.status },
      });
      // Operations and the branch see the flag; the customer is answered by support.
      await this.orders.touch(tx, order, {});
      return { requestId: request.id, refundId: null, outcome: "review" as const };
    });
    if (result.refundId) await this.refunds.submit(result.refundId);
    return result;
  }

  // ── Operations ───────────────────────────────────────────────────────────

  /**
   * Operations cancel (docs/08): before acceptance the customer is refunded automatically;
   * after acceptance the order is cancelled and finance refunds separately (maker-checker).
   */
  async adminCancel(actor: Actor, orderId: string, reason: string, expectedVersion: number) {
    const result = await this.prisma.$transaction(async (tx) => {
      const exists = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
      if (!exists) throw ApiError.notFound("Order not found");
      const order = await this.lockFresh(tx, orderId, expectedVersion);
      let refundId: string | null = null;
      if (order.status === "received") {
        refundId = await this.cancelPaidOrder(tx, order, "cancelled", {
          actorId: actor.userId,
          reason,
          refundReason: "Cancelled by operations before acceptance",
        });
      } else if (OPEN_FOR_CUSTOMER_CANCEL.includes(order.status)) {
        await this.orders.transition(tx, order, "cancelled", { actorId: actor.userId, reason });
        // Not prepared yet: give the stock back. Prepared: it is used (waste is recorded later).
        await this.settleStock(
          tx,
          order.reservation_id,
          order.status === "accepted" ? "release" : "consume",
        );
        if (order.status === "accepted") await this.releaseSlot(tx, order.reservation_id);
      } else {
        throw invalidTransition(`This order is ${order.status}; it cannot be cancelled`);
      }
      await tx.cancellationRequest.updateMany({
        where: { orderId, status: "open" },
        data: { status: "approved", resolvedById: actor.userId, resolutionReason: reason },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "order.cancelled",
          targetType: "order",
          targetId: orderId,
          requestId: actor.requestId,
          reason,
          before: { status: order.status },
          after: { status: "cancelled", refundId },
        },
        tx,
      );
      return { refundId };
    });
    if (result.refundId) await this.refunds.submit(result.refundId);
    return result;
  }

  async declineCancellation(actor: Actor, requestId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.cancellationRequest.findUnique({ where: { id: requestId } });
      if (!request) throw ApiError.notFound("Cancellation request not found");
      const order = await this.orders.lockOrder(tx, request.orderId);
      const fresh = await tx.cancellationRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (fresh.status !== "open")
        throw invalidTransition(`This request is already ${fresh.status}`);
      await tx.cancellationRequest.update({
        where: { id: requestId },
        data: { status: "declined", resolvedById: actor.userId, resolutionReason: reason },
      });
      await this.orders.touch(tx, order, {});
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "order.cancellation_declined",
          targetType: "order",
          targetId: request.orderId,
          requestId: actor.requestId,
          reason,
        },
        tx,
      );
    });
  }

  // ── Acceptance timeout ───────────────────────────────────────────────────

  /**
   * Cancels and refunds paid orders nobody accepted in time (Q09). Locks each order and
   * re-checks status and deadline, so a tablet accepting at the same moment wins or loses
   * cleanly. Returns how many were cancelled.
   */
  async sweepAcceptanceTimeouts(now = new Date(), limit = 50): Promise<number> {
    const due = await this.prisma.order.findMany({
      where: { status: "received", acceptBy: { lte: now } },
      select: { id: true },
      orderBy: { acceptBy: "asc" },
      take: limit,
    });
    let cancelled = 0;
    for (const { id } of due) {
      try {
        const refundId = await this.prisma.$transaction(async (tx) => {
          const order = await this.orders.lockOrder(tx, id);
          const row = await tx.order.findUniqueOrThrow({ where: { id } });
          if (order.status !== "received" || !row.acceptBy || row.acceptBy > now) return undefined;
          return this.cancelPaidOrder(tx, order, "cancelled", {
            reason: "acceptance_timeout",
            refundReason: "The branch did not accept the order in time",
          });
        });
        if (refundId === undefined) continue;
        cancelled += 1;
        if (refundId) await this.refunds.submit(refundId);
      } catch (error) {
        this.logger.error(`acceptance timeout for order ${id} failed: ${String(error)}`);
      }
    }
    return cancelled;
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  private async lockFresh(tx: Tx, orderId: string, expectedVersion: number) {
    const order = await this.orders.lockOrder(tx, orderId);
    if (order.version !== expectedVersion) throw staleOrder(order.version);
    return order;
  }

  /**
   * A received (paid, not accepted) order ends: status, slot place and stock back, and a
   * full refund of what is left on the payment. Returns the refund to submit after commit.
   */
  private async cancelPaidOrder(
    tx: Tx,
    order: LockedOrder,
    to: "rejected" | "cancelled",
    extra: { actorId?: string; reason: string; refundReason: string },
  ): Promise<string | null> {
    await this.orders.transition(tx, order, to, {
      reason: extra.reason,
      ...(extra.actorId && { actorId: extra.actorId }),
    });
    await this.releaseSlot(tx, order.reservation_id);
    await this.settleStock(tx, order.reservation_id, "release");
    return this.refunds.createOrderCancelRefund(tx, order.id, extra.refundReason);
  }

  private async releaseSlot(tx: Tx, reservationId: string) {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.state !== "committed") return;
    await tx.$executeRaw`
      UPDATE slots SET confirmed = confirmed - 1, updated_at = now()
      WHERE id = ${reservation.slotId}::uuid AND confirmed >= 1`;
    await tx.reservation.update({ where: { id: reservationId }, data: { state: "released" } });
  }

  /** Tracked stock held by the order: back on the shelf, or out of stock for good. */
  private async settleStock(tx: Tx, reservationId: string, how: "release" | "consume") {
    const items = await tx.reservationItem.findMany({
      where: { reservationId },
      include: { branchProduct: true },
    });
    items.sort((a, b) => (a.branchProduct.productId < b.branchProduct.productId ? -1 : 1));
    for (const item of items) {
      const { branchId, productId } = item.branchProduct;
      if (how === "release") await this.stock.release(tx, branchId, productId, item.quantity);
      else await this.stock.consume(tx, branchId, productId, item.quantity);
    }
  }
}

const pickupLocked = () =>
  new ApiError(
    HttpStatus.TOO_MANY_REQUESTS,
    "RATE_LIMITED",
    "Too many wrong pickup codes. Wait a few minutes or ask a manager.",
  );

function verb(action: TransitionRequest["action"]): string {
  return {
    accept: "accepted",
    reject: "rejected",
    start: "started",
    ready: "marked ready",
    complete: "completed",
  }[action];
}
