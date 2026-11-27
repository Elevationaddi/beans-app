import { z } from "zod";
import {
  citySchema,
  dataEnvelope,
  expectedVersionSchema,
  filsSchema,
  listEnvelope,
  localizedTextSchema,
  pageQuerySchema,
  uuidSchema,
} from "./common.js";
import { MAX_ITEM_QUANTITY } from "./discovery.js";
import { fulfilmentModeSchema } from "./merchant-branches.js";

// ── Vehicles (curbside pickup) ──────────────────────────────────────────────

const plateSchema = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9 ]+$/, "Letters, digits and spaces only")
  .transform((value) => value.toUpperCase().replace(/\s+/g, " "));

export const vehicleSchema = z.object({
  id: uuidSchema,
  plate: z.string(),
  /** Emirate on the plate, when the customer gives it. */
  plateRegion: citySchema.nullable(),
  color: z.string(),
  model: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

export const createVehicleRequestSchema = z.strictObject({
  plate: plateSchema,
  plateRegion: citySchema.optional(),
  color: z.string().trim().min(1).max(30),
  model: z.string().trim().min(1).max(60).optional(),
});
export type CreateVehicleRequest = z.infer<typeof createVehicleRequestSchema>;

export const updateVehicleRequestSchema = z
  .strictObject({
    plate: plateSchema.optional(),
    plateRegion: citySchema.nullable().optional(),
    color: z.string().trim().min(1).max(30).optional(),
    model: z.string().trim().min(1).max(60).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Change at least one field" });
export type UpdateVehicleRequest = z.infer<typeof updateVehicleRequestSchema>;

export const vehicleResponseSchema = dataEnvelope(vehicleSchema);
export const vehicleListResponseSchema = dataEnvelope(z.array(vehicleSchema));
export const vehicleRemovedResponseSchema = dataEnvelope(
  z.object({ id: uuidSchema, removed: z.literal(true) }),
);

// ── Cart ────────────────────────────────────────────────────────────────────

const notesSchema = z.string().trim().min(1).max(200);

/**
 * Why a cart line cannot be checked out as it is. `unavailable`: sold out or no longer on
 * the menu. `options_changed`: its options are no longer valid (for example a required
 * choice was added). The customer edits or removes the line; nothing is changed silently.
 */
export const cartIssueSchema = z.enum(["unavailable", "options_changed"]);

export const cartItemSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  names: localizedTextSchema.nullable(),
  quantity: z.number().int(),
  optionIds: z.array(uuidSchema),
  options: z.array(z.object({ id: uuidSchema, names: localizedTextSchema })),
  notes: z.string().nullable(),
  /** Current server price; null while the line has an issue. */
  unitFils: filsSchema.nullable(),
  lineFils: filsSchema.nullable(),
  issue: cartIssueSchema.nullable(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartSchema = z.object({
  id: uuidSchema,
  branchId: uuidSchema,
  branchNames: localizedTextSchema,
  /** Optimistic concurrency token: send it back as expectedVersion on every change. */
  version: z.number().int(),
  currency: z.literal("AED"),
  items: z.array(cartItemSchema),
  /** Estimate of lines without issues. The quote is the only price the customer pays. */
  subtotalFils: filsSchema,
  menuVersion: z.string().nullable(),
  /** Non-empty, every line priced, and the branch is taking orders. */
  canCheckout: z.boolean(),
});
export type Cart = z.infer<typeof cartSchema>;
/** `data` is null when the customer has no active cart. */
export const cartResponseSchema = dataEnvelope(cartSchema.nullable());
export const cartRequiredResponseSchema = dataEnvelope(cartSchema);

/** Starts a cart at a branch. Switching branch with items needs replaceConfirmed (F04, Q03). */
export const putCartRequestSchema = z.strictObject({
  branchId: uuidSchema,
  expectedVersion: expectedVersionSchema.optional(),
  replaceConfirmed: z.boolean().default(false),
});
export type PutCartRequest = z.infer<typeof putCartRequestSchema>;

export const addCartItemRequestSchema = z.strictObject({
  productId: uuidSchema,
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
  optionIds: z.array(uuidSchema).max(30).default([]),
  notes: notesSchema.optional(),
  expectedVersion: expectedVersionSchema,
});
export type AddCartItemRequest = z.infer<typeof addCartItemRequestSchema>;

export const updateCartItemRequestSchema = z.strictObject({
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
  optionIds: z.array(uuidSchema).max(30),
  notes: notesSchema.nullable().optional(),
  expectedVersion: expectedVersionSchema,
});
export type UpdateCartItemRequest = z.infer<typeof updateCartItemRequestSchema>;

export const cartItemParamsSchema = z.strictObject({ id: uuidSchema });
export const deleteCartItemQuerySchema = z.strictObject({
  expectedVersion: z.coerce.number().int().min(1),
});

// ── Quotes ──────────────────────────────────────────────────────────────────

/**
 * Asks the server to price the cart for a pickup. No totals are accepted from the client.
 * Omit slotId for ASAP. Table tokens, promo codes and rewards are phase-two features and are
 * refused with FEATURE_DISABLED until they are approved.
 */
export const createQuoteRequestSchema = z.strictObject({
  cartId: uuidSchema,
  cartVersion: expectedVersionSchema,
  mode: fulfilmentModeSchema,
  slotId: uuidSchema.optional(),
  vehicleId: uuidSchema.optional(),
  tableToken: z.string().min(1).max(500).optional(),
  promoCode: z.string().min(1).max(50).optional(),
  rewardId: uuidSchema.optional(),
});
export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

export const lineOptionSchema = z.object({
  id: uuidSchema,
  names: localizedTextSchema,
  deltaFils: filsSchema,
});

export const quoteLineSchema = z.object({
  cartItemId: uuidSchema,
  productId: uuidSchema,
  names: localizedTextSchema,
  quantity: z.number().int(),
  options: z.array(lineOptionSchema),
  notes: z.string().nullable(),
  unitFils: filsSchema,
  lineFils: filsSchema,
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const vehicleSnapshotSchema = z.object({
  plate: z.string(),
  plateRegion: citySchema.nullable(),
  color: z.string(),
  model: z.string().nullable(),
});

export const fulfillmentSchema = z.object({
  mode: fulfilmentModeSchema,
  asap: z.boolean(),
  slotId: uuidSchema,
  /** Start of the pickup slot (UTC). */
  pickupAt: z.iso.datetime(),
  timezone: z.string(),
  vehicle: vehicleSnapshotSchema.nullable(),
});
export type Fulfillment = z.infer<typeof fulfillmentSchema>;

/** Totals in fils. Sandbox policy: tax-inclusive prices, sample 5% VAT, no fee (D06). */
export const totalsSchema = z.object({
  currency: z.literal("AED"),
  subtotalFils: filsSchema,
  discountFils: filsSchema,
  taxIncludedFils: filsSchema,
  feeFils: filsSchema,
  totalFils: filsSchema,
});
export type Totals = z.infer<typeof totalsSchema>;

export const quoteSchema = totalsSchema.extend({
  id: uuidSchema,
  cartId: uuidSchema,
  cartVersion: z.number().int(),
  branchId: uuidSchema,
  expiresAt: z.iso.datetime(),
  policyVersion: z.string(),
  menuVersion: z.string(),
  lines: z.array(quoteLineSchema),
  fulfillment: fulfillmentSchema,
});
export type Quote = z.infer<typeof quoteSchema>;
export const quoteResponseSchema = dataEnvelope(quoteSchema);

// ── Checkout ────────────────────────────────────────────────────────────────

/**
 * Sandbox only: how the fake payment provider should answer. Refused unless the server runs
 * the fake provider (which it can never do in production).
 */
export const sandboxPaymentOutcomeSchema = z.enum(["succeed", "fail", "pending"]);

/** Checkout accepts the quote only, never totals. */
export const checkoutRequestSchema = z.strictObject({
  quoteId: uuidSchema,
  sandboxOutcome: sandboxPaymentOutcomeSchema.optional(),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const orderStatusSchema = z.enum([
  "pending_payment",
  "payment_failed",
  "received",
  "accepted",
  "rejected",
  "cancelled",
  "preparing",
  "ready",
  "completed",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const paymentStatusSchema = z.enum(["pending", "captured", "failed"]);

/** What the app must do next for the payment. The fake provider never needs an action. */
export const paymentClientActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
]);

export const paymentSummarySchema = z.object({
  attempt: z.number().int(),
  status: paymentStatusSchema,
  /** A failed attempt may be retried while the hold lasts; the retry is a new attempt. */
  retryable: z.boolean(),
});

export const checkoutResultSchema = z.object({
  orderId: uuidSchema,
  publicNumber: z.string(),
  status: orderStatusSchema,
  version: z.number().int(),
  totalFils: filsSchema,
  currency: z.literal("AED"),
  payment: paymentSummarySchema.extend({ clientAction: paymentClientActionSchema }),
  /** Until when the slot place and stock stay held for payment. */
  holdExpiresAt: z.iso.datetime(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;
export const checkoutResponseSchema = dataEnvelope(checkoutResultSchema);

// ── Orders ──────────────────────────────────────────────────────────────────

export const orderSummarySchema = z.object({
  id: uuidSchema,
  publicNumber: z.string(),
  branchId: uuidSchema,
  branchNames: localizedTextSchema,
  brandName: z.string(),
  status: orderStatusSchema,
  mode: fulfilmentModeSchema,
  pickupAt: z.iso.datetime(),
  totalFils: filsSchema,
  currency: z.literal("AED"),
  createdAt: z.iso.datetime(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const orderLineSchema = z.object({
  productId: uuidSchema,
  names: localizedTextSchema,
  quantity: z.number().int(),
  options: z.array(lineOptionSchema),
  notes: z.string().nullable(),
  unitFils: filsSchema,
  totalFils: filsSchema,
});

export const orderEventSchema = z.object({
  seq: z.number().int(),
  fromState: orderStatusSchema.nullable(),
  toState: orderStatusSchema,
  at: z.iso.datetime(),
});

export const orderDetailSchema = orderSummarySchema.extend({
  version: z.number().int(),
  items: z.array(orderLineSchema),
  totals: totalsSchema,
  fulfillment: fulfillmentSchema,
  policyVersion: z.string(),
  payment: paymentSummarySchema.nullable(),
  timeline: z.array(orderEventSchema),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const orderListQuerySchema = pageQuerySchema.extend({
  status: orderStatusSchema.optional(),
});
export const orderListResponseSchema = listEnvelope(orderSummarySchema);
export const orderResponseSchema = dataEnvelope(orderDetailSchema);
