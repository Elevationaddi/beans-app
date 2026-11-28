import { z } from "zod";
import { dataEnvelope, uuidSchema } from "./common.js";

export const localeSchema = z.enum(["en", "ar"]);
export const membershipRoleSchema = z.enum(["owner", "manager", "barista", "analyst"]);
export const adminRoleSchema = z.enum([
  "super_admin",
  "operations",
  "finance_maker",
  "finance_checker",
  "support",
  "marketing",
  "analyst",
  "security",
]);

export const membershipSummarySchema = z.object({
  merchantId: uuidSchema,
  brandName: z.string(),
  role: membershipRoleSchema,
  /** Branches the member is assigned to. Owners have every branch and get an empty list. */
  branchIds: z.array(uuidSchema),
});

export const profileSchema = z.object({
  id: uuidSchema,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  locale: localeSchema,
  memberships: z.array(membershipSummarySchema),
  adminRoles: z.array(adminRoleSchema),
  /** True when the current session completed multi-factor authentication (aal2). */
  mfaVerified: z.boolean(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profileResponseSchema = dataEnvelope(profileSchema);

export const updateProfileRequestSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    locale: localeSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "provide at least one field to update");
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/**
 * Self-service account deletion (cycle 3). The caller types DELETE to confirm. Orders, payments
 * and the financial journal are kept (legal retention, pending review) but no longer carry the
 * person's name, email or phone. Refused with 409 while an order is open or the account still
 * has business or admin access.
 */
export const deleteAccountRequestSchema = z.strictObject({
  confirm: z.literal("DELETE"),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export const deleteAccountResponseSchema = z.object({
  data: z.object({ deleted: z.literal(true) }),
});
