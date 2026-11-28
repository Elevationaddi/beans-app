import { z } from "zod";
import { dataEnvelope, uuidSchema } from "./common.js";
import { adminRoleSchema, membershipRoleSchema } from "./me.js";

/**
 * Local development sign-in (D12, 2026-11-28). Only fictional accounts, only when the API runs
 * with DEV_AUTH_ENABLED=true, never in production. Real sign-in uses Supabase Auth.
 */
export const devAccountKindSchema = z.enum(["customer", "business", "staff", "admin"]);

export const devAccountSchema = z.object({
  userId: uuidSchema,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  kind: devAccountKindSchema,
  membershipRoles: z.array(membershipRoleSchema),
  adminRoles: z.array(adminRoleSchema),
  status: z.enum(["active", "suspended", "deleted"]),
});
export type DevAccount = z.infer<typeof devAccountSchema>;

export const devAccountListResponseSchema = dataEnvelope(z.array(devAccountSchema));

export const devSessionRequestSchema = z.strictObject({
  userId: uuidSchema,
  /** Simulates a completed multi-factor step (aal2), needed by the admin console. */
  mfa: z.boolean().default(false),
});
export type DevSessionRequest = z.infer<typeof devSessionRequestSchema>;

export const devSessionSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.iso.datetime(),
  aal: z.enum(["aal1", "aal2"]),
  userId: uuidSchema,
});
export type DevSession = z.infer<typeof devSessionSchema>;
export const devSessionResponseSchema = dataEnvelope(devSessionSchema);

export const devSignUpRequestSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(80),
    email: z.email().max(254).optional(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, "use international format, for example +971501234567")
      .optional(),
  })
  .refine((v) => v.email || v.phone, "provide an email or a phone number");
export type DevSignUpRequest = z.infer<typeof devSignUpRequestSchema>;
