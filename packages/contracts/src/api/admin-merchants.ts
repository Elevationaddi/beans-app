import { z } from "zod";
import {
  dataEnvelope,
  listEnvelope,
  localDateSchema,
  pageQuerySchema,
  uuidSchema,
} from "./common.js";
import {
  applicationDocumentSchema,
  createApplicationRequestSchema,
  emirateSchema,
  merchantApplicationSchema,
  merchantContactSchema,
  merchantRepresentativeSchema,
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
  emirate: emirateSchema.nullable(),
  licenseExpiresOn: localDateSchema.nullable(),
  /** Date of the latest manual licence check, if any. */
  lastVerifiedOn: localDateSchema.nullable(),
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

const longText = (max: number) => z.string().trim().min(1).max(max);

/**
 * An administrator's record that the trade licence was checked by hand against an outside
 * source. It is never an automatic or government verification.
 */
export const recordVerificationRequestSchema = z.strictObject({
  verifiedOn: localDateSchema,
  /** Must match the licence number on the application. */
  licenseNumber: longText(64),
  licenseAuthority: longText(120),
  licenseExpiresOn: localDateSchema,
  /** Where the licence was checked, e.g. the issuing authority's public register. */
  source: longText(300),
  notes: longText(2000).optional(),
});
export type RecordVerificationRequest = z.infer<typeof recordVerificationRequestSchema>;

export const merchantVerificationSchema = z.object({
  id: uuidSchema,
  method: z.literal("manual_external_check"),
  verifiedOn: localDateSchema,
  verifiedBy: z.object({ id: uuidSchema, name: z.string().nullable() }),
  licenseNumber: z.string(),
  licenseAuthority: z.string(),
  licenseExpiresOn: localDateSchema,
  source: z.string(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type MerchantVerification = z.infer<typeof merchantVerificationSchema>;

export const addMerchantNoteRequestSchema = z.strictObject({ body: longText(2000) });
export type AddMerchantNoteRequest = z.infer<typeof addMerchantNoteRequestSchema>;

export const merchantNoteSchema = z.object({
  id: uuidSchema,
  author: z.object({ id: uuidSchema, name: z.string().nullable() }),
  body: z.string(),
  createdAt: z.iso.datetime(),
});

/** One audit entry about this merchant, newest first. */
export const merchantHistoryEntrySchema = z.object({
  id: uuidSchema,
  action: z.string(),
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  at: z.iso.datetime(),
});

/**
 * Admin creates a merchant that was verified outside the platform. The merchant starts
 * approved, with a manual verification record, and the owner gets an invitation link.
 */
export const createVerifiedMerchantRequestSchema = z.strictObject({
  legalName: createApplicationRequestSchema.shape.legalName,
  brandName: createApplicationRequestSchema.shape.brandName,
  licenseNumber: createApplicationRequestSchema.shape.licenseNumber,
  licenseAuthority: longText(120),
  licenseExpiresOn: localDateSchema,
  emirate: emirateSchema,
  contact: merchantContactSchema,
  representative: merchantRepresentativeSchema,
  declaredBranchCount: z.number().int().min(1).max(500),
  description: longText(1000).optional(),
  ownerEmail: z.email().max(254),
  verification: z.strictObject({
    verifiedOn: localDateSchema,
    source: longText(300),
    notes: longText(2000).optional(),
  }),
  reason: z.string().trim().min(3).max(1000),
});
export type CreateVerifiedMerchantRequest = z.infer<typeof createVerifiedMerchantRequestSchema>;

export const adminMerchantDetailSchema = merchantApplicationSchema.extend({
  documents: z.array(
    applicationDocumentSchema.extend({
      /** Short-lived link, present only for files that passed the check. Each issue is audited. */
      downloadUrl: z.url().nullable(),
    }),
  ),
  branchCount: z.number().int(),
  verifications: z.array(merchantVerificationSchema),
  notes: z.array(merchantNoteSchema),
  history: z.array(merchantHistoryEntrySchema),
});
export type AdminMerchantDetail = z.infer<typeof adminMerchantDetailSchema>;

export const adminMerchantListResponseSchema = listEnvelope(adminMerchantSummarySchema);
export const adminMerchantDetailResponseSchema = dataEnvelope(adminMerchantDetailSchema);

export const createVerifiedMerchantResponseSchema = dataEnvelope(
  z.object({
    merchant: adminMerchantDetailSchema,
    /** Shown once: the owner opens /invite?token=… in the business portal. */
    ownerInvitationToken: z.string(),
  }),
);
