import { z } from "zod";
import {
  dataEnvelope,
  expectedVersionSchema,
  filsSchema,
  listEnvelope,
  localizedTextSchema,
  pageQuerySchema,
  uuidSchema,
} from "./common.js";
import { fulfilmentModeSchema } from "./merchant-branches.js";
import {
  arrivalSchema,
  cancellationRequestSchema,
  cancellationRequestStatusSchema,
  lineOptionSchema,
  orderRefundSchema,
  orderStatusSchema,
  totalsSchema,
  vehicleSnapshotSchema,
} from "./ordering.js";

/** A finance or operations decision always carries a reason; it is written to the log. */
const reasonSchema = z.string().trim().min(3).max(500);

/** Six digits, shown in the customer app and typed by staff at handoff. */
export const pickupCodeSchema = z.string().regex(/^\d{6}$/, "Six digits");

/** Upper bound for an accept ETA (docs/07: 1..120 minutes). */
export const MAX_ETA_MINUTES = 120;

// ── Staff queue (merchant portal and branch tablet) ─────────────────────────

/** Statuses on the live queue: New, Preparing and Ready tabs (docs/05). */
export const ACTIVE_ORDER_STATUSES = ["received", "accepted", "preparing", "ready"] as const;

export const merchantOrderQuerySchema = pageQuerySchema.extend({
  branchId: uuidSchema,
  /** Omitted: the live queue (received to ready), oldest first. Given: that status, newest first. */
  status: orderStatusSchema.optional(),
});
export type MerchantOrderQuery = z.infer<typeof merchantOrderQuerySchema>;

export const merchantOrderLineSchema = z.object({
  productId: uuidSchema,
  names: localizedTextSchema,
  quantity: z.number().int(),
  options: z.array(lineOptionSchema),
  /** Customer notes, for example allergies. */
  notes: z.string().nullable(),
});

/**
 * An order as staff need it: what to make, for when, and for which car. No customer name,
 * contact details or payment data (docs/03 B06: operational data only).
 */
export const merchantOrderSchema = z.object({
  id: uuidSchema,
  publicNumber: z.string(),
  branchId: uuidSchema,
  status: orderStatusSchema,
  version: z.number().int(),
  mode: fulfilmentModeSchema,
  asap: z.boolean(),
  pickupAt: z.iso.datetime(),
  etaAt: z.iso.datetime().nullable(),
  /** Accept before this, or the order is cancelled and refunded automatically. */
  acceptBy: z.iso.datetime().nullable(),
  items: z.array(merchantOrderLineSchema),
  vehicle: vehicleSnapshotSchema.nullable(),
  arrival: arrivalSchema,
  /** The customer asked to cancel; operations will review it. */
  cancellationRequested: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MerchantOrder = z.infer<typeof merchantOrderSchema>;
export const merchantOrderResponseSchema = dataEnvelope(merchantOrderSchema);
export const merchantOrderListResponseSchema = listEnvelope(merchantOrderSchema);

/**
 * One staff step on an order (docs/07): accept (with ETA), reject (with reason), start,
 * ready, complete (with the customer's handoff code). No arbitrary status strings.
 */
export const transitionRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("accept"),
    expectedVersion: expectedVersionSchema,
    etaMinutes: z.number().int().min(1).max(MAX_ETA_MINUTES),
  }),
  z.strictObject({
    action: z.literal("reject"),
    expectedVersion: expectedVersionSchema,
    reason: reasonSchema,
  }),
  z.strictObject({ action: z.literal("start"), expectedVersion: expectedVersionSchema }),
  z.strictObject({ action: z.literal("ready"), expectedVersion: expectedVersionSchema }),
  z.strictObject({
    action: z.literal("complete"),
    expectedVersion: expectedVersionSchema,
    pickupCode: pickupCodeSchema,
  }),
]);
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;
export type TransitionAction = TransitionRequest["action"];

export const versionedRequestSchema = z.strictObject({ expectedVersion: expectedVersionSchema });
export type VersionedRequest = z.infer<typeof versionedRequestSchema>;

// ── Customer: arrival, cancellation, receipt ────────────────────────────────

export const arrivalResponseSchema = dataEnvelope(
  arrivalSchema.extend({ orderId: uuidSchema, version: z.number().int() }),
);

export const cancelRequestSchema = z.strictObject({ reason: reasonSchema });
export type CancelRequest = z.infer<typeof cancelRequestSchema>;

export const cancelResultSchema = z.object({
  /** cancelled: the order was cancelled and a refund started. review: support will decide. */
  outcome: z.enum(["cancelled", "review"]),
  orderStatus: orderStatusSchema,
  version: z.number().int(),
  request: cancellationRequestSchema,
  refund: orderRefundSchema.nullable(),
});
export type CancelResult = z.infer<typeof cancelResultSchema>;
export const cancelResponseSchema = dataEnvelope(cancelResultSchema);

/**
 * Receipt built only from the order's immutable snapshots. Sandbox: it is not a tax invoice
 * (D06); the app must label it so.
 */
export const receiptSchema = z.object({
  orderId: uuidSchema,
  publicNumber: z.string(),
  status: orderStatusSchema,
  issuedAt: z.iso.datetime(),
  brandName: z.string(),
  branchNames: localizedTextSchema,
  branchAddress: z.string(),
  mode: fulfilmentModeSchema,
  pickupAt: z.iso.datetime(),
  items: z.array(merchantOrderLineSchema.extend({ unitFils: filsSchema, totalFils: filsSchema })),
  totals: totalsSchema,
  policyVersion: z.string(),
  paidFils: filsSchema,
  refundedFils: filsSchema,
  refunds: z.array(orderRefundSchema),
  sandbox: z.literal(true),
  taxInvoice: z.literal(false),
});
export type Receipt = z.infer<typeof receiptSchema>;
export const receiptResponseSchema = dataEnvelope(receiptSchema);

// ── Operations ──────────────────────────────────────────────────────────────

export const adminCancelOrderRequestSchema = z.strictObject({
  reason: reasonSchema,
  expectedVersion: expectedVersionSchema,
});
export type AdminCancelOrderRequest = z.infer<typeof adminCancelOrderRequestSchema>;

export const adminCancelOrderResponseSchema = dataEnvelope(
  z.object({
    orderId: uuidSchema,
    status: orderStatusSchema,
    version: z.number().int(),
    /** Started automatically only for orders cancelled before acceptance. */
    refund: orderRefundSchema.nullable(),
  }),
);

export const adminCancellationQuerySchema = pageQuerySchema.extend({
  status: cancellationRequestStatusSchema.optional(),
});
export const adminCancellationSchema = cancellationRequestSchema.extend({
  publicNumber: z.string(),
  branchId: uuidSchema,
});
export type AdminCancellationView = z.infer<typeof adminCancellationSchema>;
export const adminCancellationListResponseSchema = listEnvelope(adminCancellationSchema);
export const adminCancellationResponseSchema = dataEnvelope(adminCancellationSchema);

export const declineCancellationRequestSchema = z.strictObject({ reason: reasonSchema });

// ── Live updates (server-sent events) ───────────────────────────────────────

/**
 * Pushed when an order changes. Carries no personal data: the client refetches the order or
 * queue, and refetches everything after a reconnect or a gap in versions (docs/07).
 */
export const orderUpdatedEventSchema = z.object({
  type: z.literal("order.updated"),
  orderId: uuidSchema,
  version: z.number().int(),
  occurredAt: z.iso.datetime(),
});
export type OrderUpdatedEvent = z.infer<typeof orderUpdatedEventSchema>;
