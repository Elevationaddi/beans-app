import { z } from "zod";
import { dataEnvelope, listEnvelope, localDateSchema, uuidSchema } from "./common.js";
import { merchantDocumentTypeSchema, uploadStatusSchema } from "./uploads.js";

export const merchantStatusSchema = z.enum([
  "draft",
  "submitted",
  "review",
  "approved",
  "rejected",
  "suspended",
]);

const text = (max: number) => z.string().trim().min(1).max(max);

export const merchantContactSchema = z.strictObject({
  name: text(120),
  email: z.email().max(254),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/, "Use digits, spaces and an optional leading +"),
});

export const emirateSchema = z.enum([
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
]);
export type Emirate = z.infer<typeof emirateSchema>;

/** Person authorized to act for the business (cycle 4 manual verification). */
export const merchantRepresentativeSchema = merchantContactSchema.extend({
  position: text(120),
});

/**
 * Application details. The cycle 4 fields are optional while drafting and required to submit
 * (see `missingForSubmission`), so applications started earlier keep working.
 */
export const createApplicationRequestSchema = z.strictObject({
  legalName: text(200),
  brandName: text(120),
  licenseNumber: text(64),
  contact: merchantContactSchema,
  licenseAuthority: text(120).optional(),
  licenseExpiresOn: localDateSchema.optional(),
  emirate: emirateSchema.optional(),
  representative: merchantRepresentativeSchema.optional(),
  declaredBranchCount: z.number().int().min(1).max(500).optional(),
  description: text(1000).optional(),
});
export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>;

export const updateApplicationRequestSchema = createApplicationRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "provide at least one field to update");
export type UpdateApplicationRequest = z.infer<typeof updateApplicationRequestSchema>;

/** Documents are optional and refused while document uploads are switched off. */
export const submitApplicationRequestSchema = z.strictObject({
  documentIds: z.array(uuidSchema).max(20).default([]),
});
export type SubmitApplicationRequest = z.infer<typeof submitApplicationRequestSchema>;

export const applicationDocumentSchema = z.object({
  id: uuidSchema,
  uploadId: uuidSchema,
  type: merchantDocumentTypeSchema,
  fileStatus: uploadStatusSchema,
  reviewStatus: z.enum(["pending", "accepted", "rejected"]),
  createdAt: z.iso.datetime(),
});

export const merchantApplicationSchema = z.object({
  id: uuidSchema,
  legalName: z.string(),
  brandName: z.string(),
  licenseNumber: z.string(),
  contact: z.object({ name: z.string(), email: z.string(), phone: z.string() }).partial(),
  licenseAuthority: z.string().nullable(),
  licenseExpiresOn: localDateSchema.nullable(),
  emirate: emirateSchema.nullable(),
  representative: z
    .object({ name: z.string(), position: z.string(), email: z.string(), phone: z.string() })
    .partial(),
  /** Number of branches the applicant declared. */
  declaredBranchCount: z.number().int().nullable(),
  description: z.string().nullable(),
  /** False while document uploads are switched off (no approved malware scanner). */
  documentsAccepted: z.boolean(),
  status: merchantStatusSchema,
  /** Latest note from the reviewer, such as the corrections requested. */
  reviewNote: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  documents: z.array(applicationDocumentSchema),
});
export type MerchantApplication = z.infer<typeof merchantApplicationSchema>;

export const merchantApplicationResponseSchema = dataEnvelope(merchantApplicationSchema);
export const merchantApplicationListResponseSchema = listEnvelope(merchantApplicationSchema);
