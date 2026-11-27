import { z } from "zod";
import { dataEnvelope, uuidSchema } from "./common.js";
import { membershipRoleSchema } from "./me.js";

/** Roles an owner can grant. Ownership is never granted through invitations (no escalation). */
export const staffRoleSchema = z.enum(["manager", "barista", "analyst"]);
export const membershipStatusSchema = z.enum(["invited", "active", "revoked"]);
export const invitationStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);

export const staffMemberSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  role: membershipRoleSchema,
  status: membershipStatusSchema,
  branchIds: z.array(uuidSchema),
  /** Managers only: may edit the merchant's menu (docs/10). */
  catalogDelegated: z.boolean(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const staffInvitationSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  email: z.string(),
  role: staffRoleSchema,
  branchIds: z.array(uuidSchema),
  catalogDelegated: z.boolean(),
  status: invitationStatusSchema,
  expiresAt: z.iso.datetime(),
});
export type StaffInvitation = z.infer<typeof staffInvitationSchema>;

export const staffQuerySchema = z.strictObject({ merchantId: uuidSchema });
export const staffListResponseSchema = dataEnvelope(
  z.object({ members: z.array(staffMemberSchema), invitations: z.array(staffInvitationSchema) }),
);

export const inviteStaffRequestSchema = z.strictObject({
  merchantId: uuidSchema,
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  role: staffRoleSchema,
  branchIds: z.array(uuidSchema).max(50).default([]),
  catalogDelegated: z.boolean().default(false),
});
export type InviteStaffRequest = z.infer<typeof inviteStaffRequestSchema>;

/**
 * The invitation plus its one-time token. The token is shown once and stored only as a hash;
 * no email is sent until a notification provider is approved, so the owner shares it.
 */
export const inviteStaffResponseSchema = dataEnvelope(
  z.object({ invitation: staffInvitationSchema, token: z.string() }),
);

export const acceptInvitationRequestSchema = z.strictObject({
  token: z.string().min(20).max(200),
});
export const staffMemberResponseSchema = dataEnvelope(staffMemberSchema);
export const staffInvitationResponseSchema = dataEnvelope(staffInvitationSchema);

export const updateStaffRequestSchema = z
  .strictObject({
    role: staffRoleSchema,
    branchIds: z.array(uuidSchema).max(50),
    /** revoked takes effect on the member's next request. */
    status: z.enum(["active", "revoked"]),
    catalogDelegated: z.boolean(),
    reason: z.string().trim().min(1).max(500),
  })
  .partial()
  .refine((body) => Object.keys(body).some((key) => key !== "reason"), "Send at least one change");
export type UpdateStaffRequest = z.infer<typeof updateStaffRequestSchema>;
