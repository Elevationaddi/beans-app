import { z } from "zod";
import { dataEnvelope, filsSchema, listEnvelope, pageQuerySchema, uuidSchema } from "./common.js";
import { paymentStatusSchema } from "./ordering.js";

/** A finance decision always carries a reason; it is written to the audit log. */
const reasonSchema = z.string().trim().min(3).max(500);

// ── Payments ────────────────────────────────────────────────────────────────

export const adminPaymentQuerySchema = pageQuerySchema.extend({
  status: paymentStatusSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type AdminPaymentQuery = z.infer<typeof adminPaymentQuerySchema>;

export const adminPaymentSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  orderNumber: z.string(),
  merchantId: uuidSchema,
  brandName: z.string(),
  attempt: z.number().int(),
  provider: z.string(),
  providerRef: z.string().nullable(),
  status: paymentStatusSchema,
  amountFils: filsSchema,
  /** Requested, approved, submitted and succeeded refunds together. */
  refundCommittedFils: filsSchema,
  refundedFils: filsSchema,
  currency: z.literal("AED"),
  createdAt: z.iso.datetime(),
});
export type AdminPayment = z.infer<typeof adminPaymentSchema>;
export const adminPaymentListResponseSchema = listEnvelope(adminPaymentSchema);

// ── Refunds ─────────────────────────────────────────────────────────────────

export const refundStatusSchema = z.enum([
  "requested",
  "approved",
  "rejected",
  "submitted",
  "succeeded",
  "failed",
]);
export const refundKindSchema = z.enum(["manual", "late_capture"]);

export const createRefundRequestSchema = z.strictObject({
  paymentId: uuidSchema,
  amountFils: filsSchema.refine((v) => v !== "0", "Must be more than zero"),
  reason: reasonSchema,
});
export type CreateRefundRequest = z.infer<typeof createRefundRequestSchema>;

export const decisionRequestSchema = z.strictObject({ reason: reasonSchema });
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;

export const refundSchema = z.object({
  id: uuidSchema,
  paymentId: uuidSchema,
  orderId: uuidSchema,
  kind: refundKindSchema,
  status: refundStatusSchema,
  amountFils: filsSchema,
  currency: z.literal("AED"),
  reason: z.string(),
  requestedBy: uuidSchema.nullable(),
  decidedBy: uuidSchema.nullable(),
  decisionReason: z.string().nullable(),
  failureCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RefundView = z.infer<typeof refundSchema>;
export const refundResponseSchema = dataEnvelope(refundSchema);
export const refundQuerySchema = pageQuerySchema.extend({ status: refundStatusSchema.optional() });
export const refundListResponseSchema = listEnvelope(refundSchema);

// ── Payouts (sandbox simulation) ────────────────────────────────────────────

export const payoutStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "rejected",
  "submitted",
  "paid",
  "failed",
]);

export const createPayoutRequestSchema = z.strictObject({
  merchantId: uuidSchema,
  /** Earnings posted up to this moment are included. */
  periodEnd: z.iso.datetime(),
});
export type CreatePayoutRequest = z.infer<typeof createPayoutRequestSchema>;

export const payoutSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  status: payoutStatusSchema,
  amountFils: filsSchema,
  currency: z.literal("AED"),
  periodEnd: z.iso.datetime(),
  makerId: uuidSchema,
  checkerId: uuidSchema.nullable(),
  decisionReason: z.string().nullable(),
  failureCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type PayoutView = z.infer<typeof payoutSchema>;
export const payoutResponseSchema = dataEnvelope(payoutSchema);
export const payoutQuerySchema = pageQuerySchema.extend({
  merchantId: uuidSchema.optional(),
  status: payoutStatusSchema.optional(),
});
export const payoutListResponseSchema = listEnvelope(payoutSchema);

// ── Reconciliation ──────────────────────────────────────────────────────────

export const reconciliationExceptionStatusSchema = z.enum(["open", "resolved"]);

export const runReconciliationRequestSchema = z
  .strictObject({ from: z.iso.datetime(), to: z.iso.datetime() })
  .refine((body) => body.from < body.to, { message: "from must be before to", path: ["to"] });
export type RunReconciliationRequest = z.infer<typeof runReconciliationRequestSchema>;

export const reconciliationExceptionSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  kind: z.enum([
    "missing_at_provider",
    "missing_locally",
    "amount_mismatch",
    "currency_mismatch",
    "status_mismatch",
  ]),
  objectType: z.enum(["payment", "refund", "payout"]),
  localId: uuidSchema.nullable(),
  providerRef: z.string().nullable(),
  merchantId: uuidSchema.nullable(),
  expected: z.record(z.string(), z.unknown()),
  actual: z.record(z.string(), z.unknown()),
  status: reconciliationExceptionStatusSchema,
  resolutionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReconciliationExceptionView = z.infer<typeof reconciliationExceptionSchema>;
export const reconciliationExceptionResponseSchema = dataEnvelope(reconciliationExceptionSchema);
export const reconciliationQuerySchema = pageQuerySchema.extend({
  status: reconciliationExceptionStatusSchema.optional(),
  merchantId: uuidSchema.optional(),
});
export const reconciliationListResponseSchema = listEnvelope(reconciliationExceptionSchema);

export const reconciliationRunResponseSchema = dataEnvelope(
  z.object({
    id: uuidSchema,
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    matched: z.number().int(),
    mismatched: z.number().int(),
    exceptionIds: z.array(uuidSchema),
  }),
);

// ── Ledger ──────────────────────────────────────────────────────────────────

export const trialBalanceResponseSchema = dataEnvelope(
  z.object({
    accounts: z.array(
      z.object({ account: z.string(), debitFils: filsSchema, creditFils: filsSchema }),
    ),
    totalDebitFils: filsSchema,
    totalCreditFils: filsSchema,
    unbalancedJournals: z.number().int(),
    balanced: z.boolean(),
  }),
);

// ── Provider webhooks ───────────────────────────────────────────────────────

export const webhookParamsSchema = z.strictObject({ provider: z.string().min(1).max(40) });
export const webhookReceiptResponseSchema = dataEnvelope(
  z.object({ received: z.literal(true), duplicate: z.boolean() }),
);
