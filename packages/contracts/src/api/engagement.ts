import { z } from "zod";
import {
  dataEnvelope,
  filsSchema,
  listEnvelope,
  localizedTextSchema,
  pageQuerySchema,
  uuidSchema,
} from "./common.js";

/**
 * Phase 9 engagement (sandbox): stamp cards, merchant promotions with admin review, dine-in by
 * table QR, and sandbox gifts. Every benefit is funded by the merchant and applied by the
 * server at quote time; the client never sends a discount amount. No stored value or wallet.
 */

const reasonSchema = z.string().trim().min(3).max(500);

// ── Benefit on a quote or order ─────────────────────────────────────────────

export const benefitSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reward"),
    stampCardId: uuidSchema,
    stamps: z.number().int(),
    label: localizedTextSchema,
    discountFils: filsSchema,
  }),
  z.object({
    kind: z.literal("promotion"),
    promotionId: uuidSchema,
    code: z.string(),
    discountFils: filsSchema,
  }),
  z.object({
    kind: z.literal("gift"),
    giftId: uuidSchema,
    label: localizedTextSchema,
    discountFils: filsSchema,
  }),
]);
export type Benefit = z.infer<typeof benefitSchema>;

/** The table a dine-in order is for, from a verified table token (never a client table ID). */
export const tableSnapshotSchema = z.object({ id: uuidSchema, label: z.string() });
export type TableSnapshot = z.infer<typeof tableSnapshotSchema>;

// ── Stamp cards ─────────────────────────────────────────────────────────────

export const stampCardSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  names: localizedTextSchema,
  /** Stamps needed for one reward. One stamp per item in a completed order. */
  stampsRequired: z.number().int(),
  reward: localizedTextSchema,
  /** The reward takes the price of one item off the order, up to this amount. */
  rewardMaxFils: filsSchema,
  active: z.boolean(),
  /** Bumped whenever the terms change, so customers can see which terms applied. */
  termsVersion: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type StampCard = z.infer<typeof stampCardSchema>;
export const stampCardResponseSchema = dataEnvelope(stampCardSchema.nullable());

export const stampCardQuerySchema = z.strictObject({ merchantId: uuidSchema });

export const putStampCardRequestSchema = z.strictObject({
  names: localizedTextSchema,
  stampsRequired: z.number().int().min(2).max(20),
  reward: localizedTextSchema,
  rewardMaxFils: filsSchema,
  active: z.boolean(),
});
export type PutStampCardRequest = z.infer<typeof putStampCardRequestSchema>;

/** One merchant's stamps for the signed-in customer. Balance can be negative after a reversal. */
export const stampBalanceSchema = z.object({
  merchantId: uuidSchema,
  brandName: z.string(),
  balance: z.number().int(),
  card: stampCardSchema.nullable(),
  /** True when the balance covers one reward on the active card. */
  rewardAvailable: z.boolean(),
});
export type StampBalance = z.infer<typeof stampBalanceSchema>;
export const stampBalanceListResponseSchema = dataEnvelope(z.array(stampBalanceSchema));

export const stampEventKindSchema = z.enum(["earn", "reverse", "redeem", "release"]);
export const stampEventSchema = z.object({
  id: uuidSchema,
  kind: stampEventKindSchema,
  stamps: z.number().int(),
  orderId: uuidSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export const stampEventListResponseSchema = dataEnvelope(z.array(stampEventSchema));
export const stampEventsQuerySchema = z.strictObject({ merchantId: uuidSchema });

// ── Promotions ──────────────────────────────────────────────────────────────

export const promotionStatusSchema = z.enum([
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "paused",
  "ended",
]);
export type PromotionStatus = z.infer<typeof promotionStatusSchema>;
export const promotionKindSchema = z.enum(["percent", "amount"]);

export const promotionSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  brandName: z.string(),
  code: z.string(),
  names: localizedTextSchema,
  kind: promotionKindSchema,
  /** Percent off in basis points (1000 = 10%), for kind "percent". */
  percentBasisPoints: z.number().int().nullable(),
  /** Fixed amount off, for kind "amount". */
  amountFils: filsSchema.nullable(),
  minSubtotalFils: filsSchema,
  maxDiscountFils: filsSchema.nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  maxRedemptions: z.number().int().nullable(),
  perCustomerLimit: z.number().int(),
  redemptions: z.number().int(),
  status: promotionStatusSchema,
  reviewNote: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type Promotion = z.infer<typeof promotionSchema>;
export const promotionResponseSchema = dataEnvelope(promotionSchema);
export const promotionListResponseSchema = listEnvelope(promotionSchema);

const promotionFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,20}$/, "3 to 20 letters or digits"),
  names: localizedTextSchema,
  kind: promotionKindSchema,
  percentBasisPoints: z.number().int().min(100).max(10_000).nullable(),
  amountFils: filsSchema.nullable(),
  minSubtotalFils: filsSchema,
  maxDiscountFils: filsSchema.nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable(),
  perCustomerLimit: z.number().int().min(1).max(100),
};
export const createPromotionRequestSchema = z.strictObject({
  merchantId: uuidSchema,
  ...promotionFields,
});
export type CreatePromotionRequest = z.infer<typeof createPromotionRequestSchema>;
export const updatePromotionRequestSchema = z.strictObject({
  ...promotionFields,
  expectedVersion: z.number().int().min(1),
});
export type UpdatePromotionRequest = z.infer<typeof updatePromotionRequestSchema>;

/** Merchant steps: submit for review, pause, resume (approved again), end. */
export const promotionActionRequestSchema = z.strictObject({
  action: z.enum(["submit", "pause", "resume", "end"]),
  expectedVersion: z.number().int().min(1),
});
export type PromotionActionRequest = z.infer<typeof promotionActionRequestSchema>;

export const merchantPromotionQuerySchema = pageQuerySchema.extend({ merchantId: uuidSchema });
export const adminPromotionQuerySchema = pageQuerySchema.extend({
  status: promotionStatusSchema.optional(),
});

export const reviewPromotionRequestSchema = z.strictObject({
  decision: z.enum(["approve", "reject"]),
  reason: reasonSchema,
  expectedVersion: z.number().int().min(1),
});
export type ReviewPromotionRequest = z.infer<typeof reviewPromotionRequestSchema>;

// ── Dine-in tables ──────────────────────────────────────────────────────────

export const branchTableSchema = z.object({
  id: uuidSchema,
  branchId: uuidSchema,
  label: z.string(),
  active: z.boolean(),
  /** Signed, opaque token for the printed QR code. Rotating replaces it; old codes stop working. */
  token: z.string().nullable(),
  tokenVersion: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type BranchTable = z.infer<typeof branchTableSchema>;
export const branchTableResponseSchema = dataEnvelope(branchTableSchema);
export const branchTableListResponseSchema = dataEnvelope(z.array(branchTableSchema));
export const createBranchTableRequestSchema = z.strictObject({
  label: z.string().trim().min(1).max(20),
});
export type CreateBranchTableRequest = z.infer<typeof createBranchTableRequestSchema>;
export const branchTableParamsSchema = z.strictObject({ id: uuidSchema, tableId: uuidSchema });
export const branchTableActionRequestSchema = z.strictObject({
  action: z.enum(["rotate", "retire"]),
});

export const resolveTableQuerySchema = z.strictObject({ token: z.string().min(10).max(500) });
export const resolvedTableSchema = z.object({
  branchId: uuidSchema,
  brandName: z.string(),
  branchNames: localizedTextSchema,
  table: tableSnapshotSchema,
});
export const resolvedTableResponseSchema = dataEnvelope(resolvedTableSchema);

// ── Sandbox gifts ───────────────────────────────────────────────────────────

export const giftStatusSchema = z.enum(["issued", "claimed", "reserved", "redeemed", "expired"]);
export const giftSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  brandName: z.string(),
  productId: uuidSchema,
  productNames: localizedTextSchema,
  /** The gift covers one of this product, up to this amount (its price when bought). */
  valueFils: filsSchema,
  message: z.string().nullable(),
  status: giftStatusSchema,
  /** "sent" when the caller bought it, "received" when the caller claimed it. */
  role: z.enum(["sent", "received"]),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  sandbox: z.literal(true),
});
export type Gift = z.infer<typeof giftSchema>;
export const giftListResponseSchema = dataEnvelope(z.array(giftSchema));

export const createGiftRequestSchema = z.strictObject({
  productId: uuidSchema,
  message: z.string().trim().max(200).optional(),
});
export type CreateGiftRequest = z.infer<typeof createGiftRequestSchema>;
/** The claim token is shown once, to the buyer, to share. Only its hash is stored. */
export const createdGiftResponseSchema = dataEnvelope(
  z.object({ gift: giftSchema, claimToken: z.string() }),
);
export const claimGiftRequestSchema = z.strictObject({ token: z.string().min(20).max(200) });
export const giftResponseSchema = dataEnvelope(giftSchema);

export const adminGiftSchema = giftSchema.omit({ role: true }).extend({
  purchaserId: uuidSchema,
  recipientId: uuidSchema.nullable(),
  orderId: uuidSchema.nullable(),
});
export const adminGiftListResponseSchema = listEnvelope(adminGiftSchema);
export const adminGiftQuerySchema = pageQuerySchema.extend({ status: giftStatusSchema.optional() });

export type MerchantPromotionQuery = z.infer<typeof merchantPromotionQuerySchema>;
export type AdminPromotionQuery = z.infer<typeof adminPromotionQuerySchema>;
