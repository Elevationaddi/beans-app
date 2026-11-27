import { z } from "zod";
import { dataEnvelope, uuidSchema } from "./common.js";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const documentMimeSchema = z.enum(["application/pdf", "image/jpeg", "image/png"]);
export const merchantDocumentTypeSchema = z.enum([
  "trade_license",
  "owner_id",
  "vat_certificate",
  "other",
]);
export const uploadStatusSchema = z.enum(["pending", "quarantined", "clean", "rejected"]);

export const createUploadRequestSchema = z.strictObject({
  purpose: z.literal("merchant_document"),
  merchantId: uuidSchema,
  documentType: merchantDocumentTypeSchema,
  mime: documentMimeSchema,
  size: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

/** Where and how to send the bytes. The link is single-purpose and expires quickly. */
export const uploadTicketSchema = z.object({
  id: uuidSchema,
  uploadUrl: z.url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  maxBytes: z.number().int(),
  expiresAt: z.iso.datetime(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const uploadSchema = z.object({
  id: uuidSchema,
  status: uploadStatusSchema,
  mime: documentMimeSchema,
  size: z.number().int(),
  /** Why a file was rejected, in plain words. Null otherwise. */
  rejectionReason: z.string().nullable(),
});
export type UploadView = z.infer<typeof uploadSchema>;

export const uploadTicketResponseSchema = dataEnvelope(uploadTicketSchema);
export const uploadResponseSchema = dataEnvelope(uploadSchema);

/** Signed token in the query string of local-storage upload and download links. */
export const signedTokenQuerySchema = z.strictObject({ token: z.string().min(16).max(2048) });
