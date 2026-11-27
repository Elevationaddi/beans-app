import { z } from "zod";
import { dataEnvelope, listEnvelope, pageQuerySchema, uuidSchema } from "./common.js";
import {
  applicationDocumentSchema,
  merchantApplicationSchema,
  merchantStatusSchema,
} from "./merchant-applications.js";

export const adminMerchantQuerySchema = pageQuerySchema.extend({
  status: merchantStatusSchema.optional(),
});
export type AdminMerchantQuery = z.infer<typeof adminMerchantQuerySchema>;

export const adminMerchantSummarySchema = z.object({
  id: uuidSchema,
  legalName: z.string(),
  brandName: z.string(),
  status: merchantStatusSchema,
  submittedAt: z.iso.datetime().nullable(),
  branchCount: z.number().int(),
});

/** Review actions. Each maps to exactly one status transition (see docs/13-progress.md). */
export const reviewDecisionSchema = z.enum([
  "start_review",
  "approve",
  "reject",
  "request_changes",
  "suspend",
  "reinstate",
]);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const reviewMerchantRequestSchema = z.strictObject({
  decision: reviewDecisionSchema,
  /** Mandatory for every decision (docs/04 A02). Shown to the applicant for request_changes and reject. */
  reason: z.string().trim().min(3).max(1000),
  /** The status the reviewer saw; a mismatch means someone else acted first (409). */
  expectedStatus: merchantStatusSchema,
});
export type ReviewMerchantRequest = z.infer<typeof reviewMerchantRequestSchema>;

export const adminMerchantDetailSchema = merchantApplicationSchema.extend({
  documents: z.array(
    applicationDocumentSchema.extend({
      /** Short-lived link, present only for files that passed the check. Each issue is audited. */
      downloadUrl: z.url().nullable(),
    }),
  ),
  branchCount: z.number().int(),
});
export type AdminMerchantDetail = z.infer<typeof adminMerchantDetailSchema>;

export const adminMerchantListResponseSchema = listEnvelope(adminMerchantSummarySchema);
export const adminMerchantDetailResponseSchema = dataEnvelope(adminMerchantDetailSchema);
