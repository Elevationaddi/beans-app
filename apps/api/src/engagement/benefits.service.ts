import { Inject, Injectable } from "@nestjs/common";
import type { Benefit, CreateQuoteRequest, QuoteLine, TableSnapshot } from "@beans/contracts";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OrderStatus, Prisma, StampEventKind } from "../generated/prisma/client.js";
import { featureDisabled, semantic } from "../ordering/ordering-errors.js";
import { SettingsService } from "../platform/settings.service.js";
import { TableTokens } from "./table-tokens.js";

type Tx = Prisma.TransactionClient;

/**
 * SANDBOX: the least a discounted order still charges, so every order has a real payment.
 * Not approved (open question for the founder: should a reward be able to make an order free?).
 */
export const MIN_CHARGE_FILS = 100n;

/** Orders that end without being fulfilled give their benefit back. */
const RELEASE_ON: readonly OrderStatus[] = ["payment_failed", "rejected", "cancelled"];

interface QuoteContext {
  userId: string;
  merchantId: string;
  lines: QuoteLine[];
  subtotalFils: bigint;
  body: CreateQuoteRequest;
  now: Date;
}

const benefitError = (field: string, message: string) => semantic(message, { [field]: [message] });

/** Inside the card's optional campaign window. */
function inWindow(card: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  return (!card.startsAt || now >= card.startsAt) && (!card.endsAt || now < card.endsAt);
}

/** Whether a product earns stamps on this card. */
function earnsStamps(
  card: { eligibleProductIds: string[]; excludedProductIds: string[] },
  productId: string,
): boolean {
  if (card.excludedProductIds.includes(productId)) return false;
  return card.eligibleProductIds.length === 0 || card.eligibleProductIds.includes(productId);
}

function capped(field: string, raw: bigint, subtotal: bigint): bigint {
  const room = subtotal - MIN_CHARGE_FILS;
  if (room <= 0n) {
    throw benefitError(field, "This order is too small for a discount. Add another item.");
  }
  return raw < room ? raw : room;
}

/**
 * Phase 9 benefits (sandbox, merchant-funded): stamp-card rewards, approved promo codes and
 * claimed gifts. The server works out the discount at quote time, holds the benefit when the
 * order is created, confirms it when payment succeeds and gives it back when the order ends
 * unfulfilled. Stamps are earned once per completed order (card rules: eligible products,
 * stamps per item, dates) and reversed in proportion to each refund. Every step is idempotent per order (unique keys), so replays are safe.
 */
@Injectable()
export class BenefitsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(TableTokens) private readonly tokens: TableTokens,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Gifts are sandbox-only: refused in production whatever the feature flag says. */
  async giftsEnabled(): Promise<boolean> {
    if (this.env.NODE_ENV === "production") return false;
    return (await this.settings.get("features")).sandboxGifts;
  }

  // ── Quote ──────────────────────────────────────────────────────────────────

  /** The verified table for a dine-in quote. The token must be current and for this branch. */
  async tableFor(token: string | undefined, branchId: string): Promise<TableSnapshot> {
    if (!(await this.settings.get("features")).dineIn) throw featureDisabled("mode", "Dine-in");
    if (!token) throw benefitError("tableToken", "Scan the QR code on your table to order");
    const table = await this.verifiedTable(token);
    if (!table || table.branchId !== branchId) {
      throw benefitError("tableToken", "This table code is not valid here. Scan it again.");
    }
    return { id: table.id, label: table.label };
  }

  /** Active table for a token with a valid signature and the current version; else null. */
  async verifiedTable(token: string) {
    const parsed = this.tokens.parse(token);
    if (!parsed) return null;
    const table = await this.prisma.branchTable.findUnique({ where: { id: parsed.tableId } });
    if (!table || table.status !== "active" || table.tokenVersion !== parsed.version) return null;
    return table;
  }

  async forQuote(ctx: QuoteContext): Promise<Benefit | null> {
    const { body } = ctx;
    const asked = [body.rewardId, body.promoCode, body.giftId].filter((v) => v !== undefined);
    if (asked.length === 0) return null;
    if (asked.length > 1) {
      throw semantic("Use one reward, promo code or gift per order", {
        benefit: ["Only one per order"],
      });
    }
    if (body.rewardId !== undefined) return this.rewardQuote(ctx, body.rewardId);
    if (body.promoCode !== undefined) return this.promotionQuote(ctx, body.promoCode);
    return this.giftQuote(ctx, body.giftId ?? "");
  }

  private async rewardQuote(ctx: QuoteContext, cardId: string): Promise<Benefit> {
    if (!(await this.settings.get("features")).stampCards)
      throw featureDisabled("rewardId", "Rewards");
    const card = await this.prisma.stampCard.findFirst({
      where: { id: cardId, merchantId: ctx.merchantId, active: true },
    });
    if (!card || !inWindow(card, ctx.now)) {
      throw benefitError("rewardId", "This café's stamp card is not available");
    }
    const account = await this.prisma.stampAccount.findUnique({
      where: { userId_merchantId: { userId: ctx.userId, merchantId: ctx.merchantId } },
    });
    if ((account?.balance ?? 0) < card.stampsRequired) {
      throw benefitError("rewardId", "Not enough stamps for a reward yet");
    }
    if (ctx.subtotalFils < card.redeemMinSubtotalFils) {
      throw benefitError("rewardId", "Your order is below the minimum for using a reward");
    }
    if (
      (await this.rewardsToday(this.prisma, ctx.userId, ctx.merchantId, ctx.now)) >=
      card.redeemDailyLimit
    ) {
      throw benefitError("rewardId", "You have used today's rewards at this café");
    }
    const candidates =
      card.rewardProductIds.length === 0
        ? ctx.lines
        : ctx.lines.filter((l) => card.rewardProductIds.includes(l.productId));
    if (candidates.length === 0) {
      throw benefitError("rewardId", "Add one of the reward items to your cart to use the reward");
    }
    const cheapest = candidates.reduce(
      (min, l) => (BigInt(l.unitFils) < min ? BigInt(l.unitFils) : min),
      BigInt(candidates[0]!.unitFils),
    );
    const raw = cheapest < card.rewardMaxFils ? cheapest : card.rewardMaxFils;
    return {
      kind: "reward",
      stampCardId: card.id,
      stamps: card.stampsRequired,
      label: { en: card.rewardEn, ...(card.rewardAr && { ar: card.rewardAr }) },
      discountFils: capped("rewardId", raw, ctx.subtotalFils).toString(),
    };
  }

  /** Rewards used today (Dubai calendar day) at this café, not counting released ones. */
  private async rewardsToday(
    db: Tx | PrismaService,
    userId: string,
    merchantId: string,
    now: Date,
    exceptOrderId?: string,
  ): Promise<number> {
    const [row] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM stamp_events e
      WHERE e.user_id = ${userId}::uuid AND e.merchant_id = ${merchantId}::uuid
        AND e.kind = 'redeem'
        AND (e.created_at AT TIME ZONE 'Asia/Dubai')::date = (${now}::timestamptz AT TIME ZONE 'Asia/Dubai')::date
        AND (${exceptOrderId ?? null}::uuid IS NULL OR e.order_id <> ${exceptOrderId ?? null}::uuid)
        AND NOT EXISTS (SELECT 1 FROM stamp_events r WHERE r.order_id = e.order_id AND r.kind = 'release')`;
    return Number(row?.n ?? 0n);
  }

  private async promotionQuote(ctx: QuoteContext, rawCode: string): Promise<Benefit> {
    if (!(await this.settings.get("features")).promotions)
      throw featureDisabled("promoCode", "Promo codes");
    const code = rawCode.trim().toUpperCase();
    const promotion = await this.prisma.promotion.findUnique({
      where: { merchantId_code: { merchantId: ctx.merchantId, code } },
    });
    this.checkPromotion(promotion, ctx.now);
    const p = promotion!;
    if (ctx.subtotalFils < p.minSubtotalFils) {
      throw benefitError("promoCode", "Your order is below this code's minimum");
    }
    if (p.maxRedemptions !== null && p.redemptions >= p.maxRedemptions) {
      throw benefitError("promoCode", "This code has been fully used");
    }
    const used = await this.prisma.promotionRedemption.count({
      where: { promotionId: p.id, userId: ctx.userId, status: { in: ["held", "confirmed"] } },
    });
    if (used >= p.perCustomerLimit)
      throw benefitError("promoCode", "You have already used this code");
    let raw =
      p.kind === "percent"
        ? (ctx.subtotalFils * BigInt(p.percentBasisPoints ?? 0)) / 10_000n
        : (p.amountFils ?? 0n);
    if (p.maxDiscountFils !== null && raw > p.maxDiscountFils) raw = p.maxDiscountFils;
    if (raw <= 0n) throw benefitError("promoCode", "This code gives no discount on this order");
    return {
      kind: "promotion",
      promotionId: p.id,
      code: p.code,
      discountFils: capped("promoCode", raw, ctx.subtotalFils).toString(),
    };
  }

  private checkPromotion(
    p: { status: string; startsAt: Date; endsAt: Date } | null,
    now: Date,
  ): void {
    if (!p || p.status !== "approved" || now < p.startsAt || now >= p.endsAt) {
      throw benefitError("promoCode", "This code is not valid");
    }
  }

  private async giftQuote(ctx: QuoteContext, giftId: string): Promise<Benefit> {
    if (!(await this.giftsEnabled())) throw featureDisabled("giftId", "Gifts");
    const gift = await this.prisma.gift.findFirst({
      where: {
        id: giftId,
        recipientId: ctx.userId,
        status: "claimed",
        merchantId: ctx.merchantId,
        expiresAt: { gt: ctx.now },
      },
      include: { product: { select: { names: true } } },
    });
    if (!gift) throw benefitError("giftId", "This gift cannot be used here");
    const line = ctx.lines.find((l) => l.productId === gift.productId);
    if (!line) throw benefitError("giftId", "Add the gifted drink to your cart to use the gift");
    const unit = BigInt(line.unitFils);
    const raw = unit < gift.valueFils ? unit : gift.valueFils;
    return {
      kind: "gift",
      giftId: gift.id,
      label: gift.product.names as unknown as { en: string; ar?: string },
      discountFils: capped("giftId", raw, ctx.subtotalFils).toString(),
    };
  }

  // ── Checkout: hold ─────────────────────────────────────────────────────────

  /**
   * Holds the quoted benefit for a new order, inside the checkout transaction. Conditional
   * updates make concurrent checkouts safe: stamps never go below the reward price, a code
   * never passes its cap or per-customer limit, and a gift is held by one order only.
   */
  async hold(
    tx: Tx,
    order: { id: string; userId: string; merchantId: string },
    benefit: Benefit | null,
    now = new Date(),
  ): Promise<void> {
    if (!benefit) return;
    if (benefit.kind === "reward") {
      const moved = await tx.$executeRaw`
        UPDATE stamp_accounts SET balance = balance - ${benefit.stamps}::int, updated_at = now()
        WHERE user_id = ${order.userId}::uuid AND merchant_id = ${order.merchantId}::uuid
          AND balance >= ${benefit.stamps}::int`;
      if (moved !== 1) throw benefitError("rewardId", "Not enough stamps for a reward yet");
      // The balance row is now locked, so concurrent checkouts see each other's redemptions.
      const card = await tx.stampCard.findUnique({ where: { id: benefit.stampCardId } });
      if (!card || !card.active || !inWindow(card, now)) {
        throw benefitError("rewardId", "This café's stamp card is not available");
      }
      if (
        (await this.rewardsToday(tx, order.userId, order.merchantId, now, order.id)) >=
        card.redeemDailyLimit
      ) {
        throw benefitError("rewardId", "You have used today's rewards at this café");
      }
      await this.appendEvent(tx, order, "redeem", -benefit.stamps, benefit.stampCardId);
      return;
    }
    if (benefit.kind === "promotion") {
      const [p] = await tx.$queryRaw<
        {
          id: string;
          status: string;
          starts_at: Date;
          ends_at: Date;
          max_redemptions: number | null;
          redemptions: number;
          per_customer_limit: number;
        }[]
      >`SELECT id, status, starts_at, ends_at, max_redemptions, redemptions, per_customer_limit
        FROM promotions WHERE id = ${benefit.promotionId}::uuid FOR UPDATE`;
      this.checkPromotion(
        p ? { status: p.status, startsAt: p.starts_at, endsAt: p.ends_at } : null,
        now,
      );
      if (p!.max_redemptions !== null && p!.redemptions >= p!.max_redemptions) {
        throw benefitError("promoCode", "This code has been fully used");
      }
      const used = await tx.promotionRedemption.count({
        where: {
          promotionId: p!.id,
          userId: order.userId,
          status: { in: ["held", "confirmed"] },
        },
      });
      if (used >= p!.per_customer_limit)
        throw benefitError("promoCode", "You have already used this code");
      await tx.promotion.update({
        where: { id: p!.id },
        data: { redemptions: { increment: 1 } },
      });
      await tx.promotionRedemption.create({
        data: { promotionId: p!.id, userId: order.userId, orderId: order.id },
      });
      return;
    }
    const held = await tx.gift.updateMany({
      where: {
        id: benefit.giftId,
        recipientId: order.userId,
        status: "claimed",
        expiresAt: { gt: now },
      },
      data: { status: "reserved", orderId: order.id },
    });
    if (held.count !== 1) throw benefitError("giftId", "This gift cannot be used here");
  }

  // ── Order lifecycle ────────────────────────────────────────────────────────

  /** Called by every order status change, in the same transaction. */
  async onTransition(
    tx: Tx,
    order: { id: string; user_id: string },
    to: OrderStatus,
  ): Promise<void> {
    if (to === "received") return this.confirm(tx, order.id);
    if (to === "completed") return this.earn(tx, order.id);
    if (RELEASE_ON.includes(to)) return this.release(tx, order.id);
  }

  private async confirm(tx: Tx, orderId: string): Promise<void> {
    await tx.promotionRedemption.updateMany({
      where: { orderId, status: "held" },
      data: { status: "confirmed" },
    });
    await tx.gift.updateMany({
      where: { orderId, status: "reserved" },
      data: { status: "redeemed" },
    });
  }

  private async release(tx: Tx, orderId: string): Promise<void> {
    const redemption = await tx.promotionRedemption.findUnique({ where: { orderId } });
    if (redemption && redemption.status !== "released") {
      await tx.promotionRedemption.update({
        where: { id: redemption.id },
        data: { status: "released" },
      });
      await tx.$executeRaw`
        UPDATE promotions SET redemptions = redemptions - 1, updated_at = now()
        WHERE id = ${redemption.promotionId}::uuid AND redemptions >= 1`;
    }
    await tx.gift.updateMany({
      where: { orderId, status: { in: ["reserved", "redeemed"] } },
      data: { status: "claimed", orderId: null },
    });
    const redeemed = await tx.stampEvent.findUnique({
      where: { orderId_kind_ref: { orderId, kind: "redeem", ref: "" } },
    });
    if (redeemed) {
      const order = { id: orderId, userId: redeemed.userId, merchantId: redeemed.merchantId };
      if (await this.appendEvent(tx, order, "release", -redeemed.stamps, redeemed.cardId)) {
        await this.addToBalance(tx, order, -redeemed.stamps);
      }
    }
  }

  /**
   * Stamps for a completed order, once, on the café's active card inside its window:
   * `stampsPerItem` for each eligible item (the eligible list, or every product when it is
   * empty, minus the excluded products).
   */
  private async earn(tx: Tx, orderId: string): Promise<void> {
    if (!(await this.settings.get("features")).stampCards) return;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        merchantId: true,
        items: { select: { productId: true, quantity: true } },
      },
    });
    const card = await tx.stampCard.findFirst({
      where: { merchantId: order.merchantId, active: true },
    });
    if (!card || !inWindow(card, new Date())) return;
    const stamps = order.items.reduce(
      (sum, i) => sum + (earnsStamps(card, i.productId) ? i.quantity * card.stampsPerItem : 0),
      0,
    );
    if (stamps <= 0) return;
    if (await this.appendEvent(tx, order, "earn", stamps, card.id)) {
      await this.addToBalance(tx, order, stamps);
    }
  }

  /**
   * After a refund succeeds, the stamps the order earned are taken back in proportion to the
   * amount refunded so far (rounded down; all of them on a full refund), once per refund. A
   * full refund also gives back stamps spent on a reward for that order. The balance may go
   * below zero if earned stamps were already spent; nobody is charged.
   */
  async onRefundSucceeded(tx: Tx, orderId: string, refundId: string): Promise<void> {
    const [paid, refunded] = await Promise.all([
      tx.payment.aggregate({ where: { orderId, status: "captured" }, _sum: { amountFils: true } }),
      tx.refund.aggregate({ where: { orderId, status: "succeeded" }, _sum: { amountFils: true } }),
    ]);
    const paidFils = paid._sum.amountFils ?? 0n;
    const refundedFils = refunded._sum.amountFils ?? 0n;
    if (paidFils <= 0n || refundedFils <= 0n) return;
    const full = refundedFils >= paidFils;

    const earned = await tx.stampEvent.findUnique({
      where: { orderId_kind_ref: { orderId, kind: "earn", ref: "" } },
    });
    if (earned) {
      const target = full
        ? earned.stamps
        : Number((BigInt(earned.stamps) * refundedFils) / paidFils);
      const reversed = await tx.stampEvent.aggregate({
        where: { orderId, kind: "reverse" },
        _sum: { stamps: true },
      });
      const delta = target + (reversed._sum.stamps ?? 0);
      const order = { id: orderId, userId: earned.userId, merchantId: earned.merchantId };
      if (
        delta > 0 &&
        (await this.appendEvent(tx, order, "reverse", -delta, earned.cardId, refundId))
      ) {
        await this.addToBalance(tx, order, -delta);
      }
    }

    if (full) {
      const redeemed = await tx.stampEvent.findUnique({
        where: { orderId_kind_ref: { orderId, kind: "redeem", ref: "" } },
      });
      if (redeemed) {
        const order = { id: orderId, userId: redeemed.userId, merchantId: redeemed.merchantId };
        if (await this.appendEvent(tx, order, "release", -redeemed.stamps, redeemed.cardId)) {
          await this.addToBalance(tx, order, -redeemed.stamps);
        }
      }
    }
  }

  /** Inserts the order's event of this kind unless it exists. True when inserted. */
  private async appendEvent(
    tx: Tx,
    order: { id: string; userId: string; merchantId: string },
    kind: StampEventKind,
    stamps: number,
    cardId: string | null,
    ref = "",
  ): Promise<boolean> {
    const inserted = await tx.$executeRaw`
      INSERT INTO stamp_events (id, user_id, merchant_id, card_id, order_id, kind, stamps, ref)
      VALUES (gen_random_uuid(), ${order.userId}::uuid, ${order.merchantId}::uuid,
              ${cardId}::uuid, ${order.id}::uuid, ${kind}::"StampEventKind", ${stamps}::int, ${ref})
      ON CONFLICT (order_id, kind, ref) DO NOTHING`;
    return inserted === 1;
  }

  private async addToBalance(
    tx: Tx,
    order: { userId: string; merchantId: string },
    stamps: number,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO stamp_accounts (user_id, merchant_id, balance, updated_at)
      VALUES (${order.userId}::uuid, ${order.merchantId}::uuid, ${stamps}::int, now())
      ON CONFLICT (user_id, merchant_id)
      DO UPDATE SET balance = stamp_accounts.balance + ${stamps}::int, updated_at = now()`;
  }
}
