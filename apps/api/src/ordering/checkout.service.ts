import { SettingsService } from "../platform/settings.service.js";
import { BenefitsService } from "../engagement/benefits.service.js";
import { randomInt } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  Benefit,
  CheckoutRequest,
  CheckoutResult,
  Fulfillment,
  QuoteLine,
  Totals,
} from "@beans/contracts";
import { ApiError } from "../common/api-error.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import { availabilityOf, DiscoveryService } from "../discovery/discovery.service.js";
import type { Prisma, Quote as QuoteRow } from "../generated/prisma/client.js";
import { SlotService } from "../inventory/slot.service.js";
import { StockService } from "../inventory/stock.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider.js";
import {
  branchClosed,
  featureDisabled,
  outOfStock,
  priceChanged,
  quoteExpired,
  slotFull,
} from "./ordering-errors.js";
import { PaymentReconciler } from "./payment-reconciler.service.js";
import { priceLines, quantitiesByProduct } from "./quote.service.js";

/** Unambiguous characters for the number customers and staff read out loud. */
const PUBLIC_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function newPublicNumber(): string {
  let value = "";
  for (let i = 0; i < 8; i += 1) value += PUBLIC_ALPHABET[randomInt(PUBLIC_ALPHABET.length)];
  return value;
}

export const providerKeyFor = (orderId: string, attempt: number) => `order:${orderId}:${attempt}`;

/**
 * Checkout (docs/06, docs/08). One transaction re-checks the quote against the live cart,
 * menu and branch, holds the slot place and tracked stock with conditional updates (slot
 * first, then products by ID), and creates the order awaiting payment with payment attempt 1,
 * its timeline event and an outbox event. The provider is called after commit with a stable
 * idempotency key. Calling checkout again for the same quote never creates a second order or
 * a second charge: it reconciles the open attempt, or starts a new attempt only after the
 * previous one is proven failed and while the hold lasts.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger("CheckoutService");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(SlotService) private readonly slots: SlotService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PaymentReconciler) private readonly reconciler: PaymentReconciler,
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(BenefitsService) private readonly benefits: BenefitsService,
  ) {}

  async checkout(userId: string, body: CheckoutRequest): Promise<CheckoutResult> {
    await this.settings.assertOrderingOpen();
    if (body.sandboxOutcome !== undefined && this.provider.name !== "fake") {
      throw featureDisabled("sandboxOutcome", "Sandbox payment outcomes");
    }
    const quote = await this.prisma.quote.findFirst({ where: { id: body.quoteId, userId } });
    if (!quote) throw ApiError.notFound("Quote not found");

    const existing = await this.prisma.order.findUnique({ where: { quoteId: quote.id } });
    if (existing) return this.continuePayment(existing.id, body);
    if (quote.expiresAt <= new Date()) throw quoteExpired();

    let orderId: string;
    try {
      orderId = await this.reserve(quote, userId);
    } catch (error) {
      // A concurrent checkout of the same quote (a double tap) may have won the race: it
      // converted the cart or inserted the order first. Continue with its order.
      const raced =
        isUniqueViolation(error) || (error instanceof ApiError && error.code === "QUOTE_EXPIRED");
      if (!raced) throw error;
      const winner = await this.prisma.order.findUnique({ where: { quoteId: quote.id } });
      if (!winner) throw error;
      return this.continuePayment(winner.id, body);
    }
    return this.continuePayment(orderId, body);
  }

  private async reserve(quote: QuoteRow, userId: string): Promise<string> {
    const lines = quote.lineSnapshot as unknown as QuoteLine[];
    const totals = quote.totals as unknown as Totals;
    const fulfillment = quote.fulfillment as unknown as Fulfillment;
    const now = new Date();
    const { holdSeconds } = await this.settings.get("operations");

    return this.prisma.$transaction(async (tx) => {
      // Q05: the cart must be exactly the one that was quoted.
      const [cart] = await tx.$queryRaw<{ status: string; version: number }[]>`
        SELECT status, version FROM carts WHERE id = ${quote.cartId}::uuid FOR UPDATE`;
      if (!cart || cart.status !== "active" || cart.version !== quote.cartVersion) {
        throw quoteExpired("Your cart changed after this quote. Get a new quote.");
      }

      let branch;
      try {
        branch = await this.discovery.listedBranch(quote.branchId, tx);
      } catch (error) {
        if (error instanceof ApiError && error.code === "NOT_FOUND")
          throw branchClosed("This branch is no longer taking orders");
        throw error;
      }
      if (branch.status === "paused")
        throw branchClosed("This branch is not taking orders right now");
      if (fulfillment.asap && availabilityOf(branch, now) !== "open") {
        throw branchClosed("This branch is closed now. Choose a pickup time when it is open.");
      }

      // Q05: re-price against the live menu; any difference needs the customer's consent.
      const items = await tx.cartItem.findMany({
        where: { cartId: quote.cartId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      let live: QuoteLine[];
      try {
        live = priceLines(await this.discovery.menu(branch.id, tx), items);
      } catch (error) {
        if (error instanceof ApiError && error.code === "VALIDATION_FAILED") throw priceChanged();
        throw error;
      }
      const same =
        live.length === lines.length &&
        live.every((l, i) => {
          const q = lines[i];
          return (
            q !== undefined &&
            l.cartItemId === q.cartItemId &&
            l.quantity === q.quantity &&
            l.unitFils === q.unitFils &&
            l.lineFils === q.lineFils &&
            l.options.map((o) => `${o.id}:${o.deltaFils}`).join() ===
              q.options.map((o) => `${o.id}:${o.deltaFils}`).join()
          );
        });
      if (!same) throw priceChanged();

      // Holds: slot first, then products in ID order, the same order everywhere (Q04).
      const slot = await tx.slot.findUniqueOrThrow({ where: { id: quote.slotId } });
      if (!fulfillment.asap && slot.startsAt <= now) {
        throw quoteExpired("This pickup time has passed. Choose another time.");
      }
      if (!(await this.slots.hold(tx, slot.id, 1))) throw slotFull();

      const wanted = quantitiesByProduct(lines);
      const rows = await tx.branchProduct.findMany({
        where: { branchId: branch.id, productId: { in: wanted.map(([id]) => id) } },
      });
      const held: { branchProductId: string; quantity: number }[] = [];
      for (const [productId, quantity] of wanted) {
        const row = rows.find((r) => r.productId === productId);
        // No branch row: offered at base price, untracked and enabled (phase 4 rule).
        if (!row) continue;
        if (!(await this.stock.hold(tx, branch.id, productId, quantity))) {
          throw outOfStock({ [`products.${productId}`]: ["Not enough left"] });
        }
        held.push({ branchProductId: row.id, quantity });
      }

      const reservation = await tx.reservation.create({
        data: {
          quoteId: quote.id,
          slotId: slot.id,
          expiresAt: new Date(now.getTime() + holdSeconds * 1000),
          items: { create: held },
        },
      });
      const order = await tx.order.create({
        data: {
          userId,
          branchId: branch.id,
          merchantId: branch.merchantId,
          quoteId: quote.id,
          reservationId: reservation.id,
          publicNumber: newPublicNumber(),
          mode: quote.mode,
          fulfillmentSnapshot: fulfillment as unknown as Prisma.InputJsonObject,
          totals: totals as unknown as Prisma.InputJsonObject,
          ...(quote.benefit !== null && {
            benefit: quote.benefit as unknown as Prisma.InputJsonObject,
          }),
          policyVersion: quote.policyVersion,
        },
      });
      // Phase 9: hold the reward, promo code or gift for this order (released if it fails).
      await this.benefits.hold(
        tx,
        { id: order.id, userId, merchantId: branch.merchantId },
        quote.benefit as unknown as Benefit | null,
        now,
      );
      await tx.orderItem.createMany({
        data: lines.map((l, index) => ({
          orderId: order.id,
          lineNo: index + 1,
          productId: l.productId,
          quantity: l.quantity,
          snapshot: {
            names: l.names,
            options: l.options,
            notes: l.notes,
            unitFils: l.unitFils,
          } as unknown as Prisma.InputJsonObject,
          totalFils: BigInt(l.lineFils),
        })),
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          seq: 1,
          fromState: null,
          toState: "pending_payment",
          actorId: userId,
        },
      });
      await tx.payment.create({
        data: {
          orderId: order.id,
          attempt: 1,
          provider: this.provider.name,
          providerKey: providerKeyFor(order.id, 1),
          amountFils: BigInt(totals.totalFils),
          currency: totals.currency,
        },
      });
      await tx.cart.update({ where: { id: quote.cartId }, data: { status: "converted" } });
      await this.outbox.enqueue(tx, {
        topic: "order.updated",
        aggregateId: order.id,
        dedupeKey: `order:${order.id}:v1`,
        payload: {
          orderId: order.id,
          branchId: branch.id,
          userId: order.userId,
          status: "pending_payment",
          version: 1,
          occurredAt: order.createdAt.toISOString(),
        },
      });
      return order.id;
    });
  }

  /**
   * Drives the order's payment forward without ever charging twice:
   * - an attempt never sent (or whose answer was lost) is sent again with the same key;
   * - a pending attempt is only re-checked with the provider;
   * - a failed attempt is followed by a new one only while the hold is still valid.
   */
  private async continuePayment(orderId: string, body: CheckoutRequest): Promise<CheckoutResult> {
    await this.reconciler.refresh(orderId);
    let state = await this.load(orderId);
    const now = new Date();

    if (state.status === "pending_payment") {
      const latest = state.payments[0];
      const holdValid = state.reservation.state === "held" && state.reservation.expiresAt > now;
      if (latest?.status === "failed" && holdValid) {
        const created = await this.newAttempt(orderId, latest.attempt + 1, latest.amountFils);
        if (created) state = await this.load(orderId);
      } else if (latest?.status === "failed" && !holdValid) {
        await this.reconciler.expire(state.reservation.id, now);
        state = await this.load(orderId);
      }
      const open = state.payments[0];
      if (
        state.status === "pending_payment" &&
        open?.status === "pending" &&
        open.providerRef === null
      ) {
        try {
          const result = await this.provider.createPayment({
            idempotencyKey: open.providerKey,
            orderId,
            amountFils: open.amountFils,
            currency: "AED",
            ...(body.sandboxOutcome !== undefined && { sandboxOutcome: body.sandboxOutcome }),
          });
          await this.reconciler.apply(open.id, result);
        } catch (error) {
          // The attempt stays pending; the same key is used on the next try or by the sweep.
          this.logger.warn(`order ${orderId}: payment call failed: ${String(error)}`);
        }
        state = await this.load(orderId);
      }
    }
    return this.result(state);
  }

  /** Inserts the next attempt; the partial unique index allows only one pending attempt. */
  private async newAttempt(orderId: string, attempt: number, amountFils: bigint): Promise<boolean> {
    try {
      await this.prisma.payment.create({
        data: {
          orderId,
          attempt,
          provider: this.provider.name,
          providerKey: providerKeyFor(orderId, attempt),
          amountFils,
          currency: "AED",
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false; // a concurrent retry created it
      throw error;
    }
  }

  private load(orderId: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        reservation: true,
        payments: { orderBy: { attempt: "desc" } },
      },
    });
  }

  private result(state: Awaited<ReturnType<CheckoutService["load"]>>): CheckoutResult {
    const latest = state.payments[0];
    const totals = state.totals as unknown as Totals;
    const holdValid =
      state.reservation.state === "held" && state.reservation.expiresAt > new Date();
    return {
      orderId: state.id,
      publicNumber: state.publicNumber,
      status: state.status,
      version: state.version,
      totalFils: totals.totalFils,
      currency: "AED",
      payment: {
        attempt: latest?.attempt ?? 1,
        status: latest?.status ?? "pending",
        retryable: state.status === "pending_payment" && latest?.status === "failed" && holdValid,
        clientAction: { type: "none" },
      },
      holdExpiresAt: state.reservation.expiresAt.toISOString(),
    };
  }
}
