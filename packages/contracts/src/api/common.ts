import { z } from "zod";

export const uuidSchema = z.uuid();

/** Error codes from docs/07-api-specification.md plus the identity/platform codes of phase 2. */
export const errorCodeSchema = z.enum([
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "MFA_REQUIRED",
  "ACCOUNT_SUSPENDED",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "REQUEST_IN_PROGRESS",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
  // Reserved for later phases (docs/07).
  "PRICE_CHANGED",
  "OUT_OF_STOCK",
  "BRANCH_CLOSED",
  "SLOT_FULL",
  "QUOTE_EXPIRED",
  "INVALID_TRANSITION",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "FEATURE_DISABLED",
  "REFUND_LIMIT",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Every error response: `{ error: { code, message, fieldErrors?, requestId } }`. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    requestId: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Success envelope for a single resource: `{ data }`. */
export function dataEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data });
}

/** Success envelope for a list: `{ data: [...], meta: { nextCursor } }`. */
export function listEnvelope<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z.object({ nextCursor: z.string().nullable() }),
  });
}

/** Cursor pagination query: opaque cursor, default limit 20, max 100. */
export const pageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * Money on the wire: a non-negative integer number of fils as a decimal string (docs/07),
 * so no client ever does floating-point arithmetic on prices. 1 AED = 100 fils.
 */
export const filsSchema = z.string().regex(/^(0|[1-9]\d{0,11})$/, "Amount in fils, digits only");

/**
 * Text shown to customers in English and Arabic. English is required; Arabic is optional
 * until reviewed by a native speaker (CLAUDE.md: no invented production translations).
 */
export const localizedTextSchema = z.strictObject({
  en: z.string().trim().min(1).max(200),
  ar: z.string().trim().min(1).max(200).optional(),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** Optional longer text, either language may be absent. */
export const localizedDescriptionSchema = z.strictObject({
  en: z.string().trim().min(1).max(1000).optional(),
  ar: z.string().trim().min(1).max(1000).optional(),
});

/** Optimistic concurrency token for state updates (docs/07: stale versions answer 409). */
export const expectedVersionSchema = z.number().int().min(1);

/** A calendar date in the branch's own timezone, `YYYY-MM-DD`. */
export const localDateSchema = z.iso.date();

/** A merchant the caller belongs to. Only a lookup key: authority comes from membership. */
export const merchantScopeQuerySchema = pageQuerySchema.extend({ merchantId: uuidSchema });
