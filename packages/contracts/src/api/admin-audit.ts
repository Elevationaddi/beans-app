import { z } from "zod";
import { listEnvelope, pageQuerySchema, uuidSchema } from "./common.js";

export const auditQuerySchema = pageQuerySchema.extend({
  actorId: uuidSchema.optional(),
  targetId: z.string().min(1).max(200).optional(),
  /** Actions starting with this text, e.g. "admin." or "platform." (A10 security logs). */
  actionPrefix: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z_.]+$/)
    .optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditEventSchema = z.object({
  id: uuidSchema,
  actorId: uuidSchema.nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  reason: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  requestId: z.string(),
  createdAt: z.iso.datetime(),
});
export type AuditEventView = z.infer<typeof auditEventSchema>;

export const auditListResponseSchema = listEnvelope(auditEventSchema);
