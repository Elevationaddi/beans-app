import { z } from "zod";
import {
  dataEnvelope,
  filsSchema,
  listEnvelope,
  localizedTextSchema,
  pageQuerySchema,
  uuidSchema,
} from "./common.js";
import { adminRoleSchema } from "./me.js";
import { fulfilmentModeSchema } from "./merchant-branches.js";
import { orderStatusSchema } from "./ordering.js";

const reasonSchema = z.string().trim().min(3).max(500);

// ── A03 customers ───────────────────────────────────────────────────────────

export const userStatusSchema = z.enum(["active", "suspended", "deleted"]);
export const adminCustomerQuerySchema = pageQuerySchema.extend({
  /** Matches email, phone or name (contains, case-insensitive). */
  q: z.string().trim().min(2).max(100).optional(),
  status: userStatusSchema.optional(),
});
export type AdminCustomerQuery = z.infer<typeof adminCustomerQuerySchema>;

export const adminCustomerSchema = z.object({
  id: uuidSchema,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  locale: z.enum(["en", "ar"]),
  status: userStatusSchema,
  createdAt: z.iso.datetime(),
});
export type AdminCustomer = z.infer<typeof adminCustomerSchema>;
export const adminCustomerListResponseSchema = listEnvelope(adminCustomerSchema);

export const adminCustomerDetailSchema = adminCustomerSchema.extend({
  orderCount: z.number().int(),
  completedOrderCount: z.number().int(),
  spentFils: filsSchema,
  openTickets: z.number().int(),
  memberships: z.array(
    z.object({ merchantId: uuidSchema, brandName: z.string(), role: z.string() }),
  ),
  adminRoles: z.array(adminRoleSchema),
  recentOrders: z.array(
    z.object({
      id: uuidSchema,
      publicNumber: z.string(),
      status: orderStatusSchema,
      totalFils: filsSchema,
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;
export const adminCustomerResponseSchema = dataEnvelope(adminCustomerDetailSchema);

export const setUserStatusRequestSchema = z.strictObject({
  status: z.enum(["active", "suspended"]),
  reason: reasonSchema,
});
export type SetUserStatusRequest = z.infer<typeof setUserStatusRequestSchema>;

// ── A04 order monitoring ────────────────────────────────────────────────────

export const adminOrderQuerySchema = pageQuerySchema.extend({
  status: orderStatusSchema.optional(),
  merchantId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  /** Exact public order number. */
  number: z.string().trim().min(4).max(20).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;

export const adminOrderSchema = z.object({
  id: uuidSchema,
  publicNumber: z.string(),
  status: orderStatusSchema,
  mode: fulfilmentModeSchema,
  merchantId: uuidSchema,
  brandName: z.string(),
  branchId: uuidSchema,
  branchName: z.string(),
  customerId: uuidSchema,
  totalFils: filsSchema,
  createdAt: z.iso.datetime(),
  acceptBy: z.iso.datetime().nullable(),
  etaAt: z.iso.datetime().nullable(),
  /** Accepted or preparing past the promised time, or not accepted in time. */
  late: z.boolean(),
});
export type AdminOrder = z.infer<typeof adminOrderSchema>;
export const adminOrderListResponseSchema = listEnvelope(adminOrderSchema);

export const adminOrderDetailSchema = adminOrderSchema.extend({
  items: z.array(
    z.object({ name: z.string(), quantity: z.number().int(), options: z.array(z.string()) }),
  ),
  events: z.array(
    z.object({
      type: z.string(),
      fromStatus: z.string().nullable(),
      toStatus: z.string().nullable(),
      at: z.iso.datetime(),
      actorRole: z.string().nullable(),
    }),
  ),
  payments: z.array(
    z.object({
      id: uuidSchema,
      status: z.string(),
      amountFils: filsSchema,
      provider: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  refunds: z.array(
    z.object({
      id: uuidSchema,
      status: z.string(),
      amountFils: filsSchema,
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
export const adminOrderResponseSchema = dataEnvelope(adminOrderDetailSchema);

// ── A10 admin accounts and roles ────────────────────────────────────────────

export const adminAccountSchema = z.object({
  userId: uuidSchema,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  status: userStatusSchema,
  roles: z.array(adminRoleSchema),
});
export type AdminAccount = z.infer<typeof adminAccountSchema>;
export const adminAccountListResponseSchema = dataEnvelope(z.array(adminAccountSchema));
export const adminAccountResponseSchema = dataEnvelope(adminAccountSchema);

/** Grant or remove one role. The target must already have an account (signed in once). */
export const setAdminRoleRequestSchema = z.strictObject({
  email: z.email().max(200),
  role: adminRoleSchema,
  grant: z.boolean(),
  reason: reasonSchema,
});
export type SetAdminRoleRequest = z.infer<typeof setAdminRoleRequestSchema>;

// ── A02 merchant suspension ─────────────────────────────────────────────────

export const setMerchantStatusRequestSchema = z.strictObject({
  status: z.enum(["approved", "suspended"]),
  reason: reasonSchema,
});
export type SetMerchantStatusRequest = z.infer<typeof setMerchantStatusRequestSchema>;

// ── Menu moderation ─────────────────────────────────────────────────────────

export const adminProductQuerySchema = pageQuerySchema.extend({
  merchantId: uuidSchema.optional(),
  hidden: z.enum(["true", "false"]).optional(),
  q: z.string().trim().min(2).max(100).optional(),
});
export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;
export const adminProductSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  brandName: z.string(),
  names: z.object({ en: z.string(), ar: z.string().optional() }),
  descriptions: z.object({ en: z.string().optional(), ar: z.string().optional() }),
  baseFils: filsSchema,
  status: z.enum(["draft", "published", "archived"]),
  allergens: z.array(z.string()),
  hidden: z.boolean(),
  moderationNote: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type AdminProduct = z.infer<typeof adminProductSchema>;
export const adminProductListResponseSchema = listEnvelope(adminProductSchema);
export const adminProductResponseSchema = dataEnvelope(adminProductSchema);
export const moderateProductRequestSchema = z.strictObject({
  hidden: z.boolean(),
  reason: reasonSchema,
});
export type ModerateProductRequest = z.infer<typeof moderateProductRequestSchema>;

// ── A05 disputes and chargebacks (sandbox) ──────────────────────────────────

export const disputeStatusSchema = z.enum(["open", "evidence_submitted", "won", "lost"]);
export const adminDisputeQuerySchema = pageQuerySchema.extend({
  status: disputeStatusSchema.optional(),
});
export const disputeSchema = z.object({
  id: uuidSchema,
  paymentId: uuidSchema,
  orderId: uuidSchema,
  publicNumber: z.string(),
  merchantId: uuidSchema,
  providerRef: z.string(),
  amountFils: filsSchema,
  reason: z.string(),
  status: disputeStatusSchema,
  evidence: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DisputeView = z.infer<typeof disputeSchema>;
export const disputeListResponseSchema = listEnvelope(disputeSchema);
export const disputeResponseSchema = dataEnvelope(disputeSchema);
/** Sandbox only: simulate the provider opening a dispute on a captured payment. */
export const simulateDisputeRequestSchema = z.strictObject({
  paymentId: uuidSchema,
  amountFils: filsSchema,
  reason: z.string().trim().min(3).max(200),
});
export const submitDisputeEvidenceRequestSchema = z.strictObject({
  evidence: z.string().trim().min(10).max(4000),
});
/** Sandbox only: record the provider's outcome. */
export const resolveDisputeRequestSchema = z.strictObject({
  outcome: z.enum(["won", "lost"]),
  reason: reasonSchema,
});

// ── Notifications inbox ─────────────────────────────────────────────────────

export const notificationSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  title: z.object({ en: z.string(), ar: z.string().optional() }),
  body: z.object({ en: z.string(), ar: z.string().optional() }),
  data: z.record(z.string(), z.unknown()),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationView = z.infer<typeof notificationSchema>;
export const notificationListResponseSchema = listEnvelope(notificationSchema).extend({
  unread: z.number().int(),
});
export const notificationResponseSchema = dataEnvelope(notificationSchema);

/** Admin broadcast to an audience's in-app inbox (no SMS, email or push). */
export const broadcastRequestSchema = z.strictObject({
  audience: z.enum(["customers", "merchant_owners", "all_staff"]),
  title: localizedTextSchema,
  body: z.strictObject({
    en: z.string().trim().min(1).max(1000),
    ar: z.string().trim().min(1).max(1000).optional(),
  }),
  reason: reasonSchema,
});
export type BroadcastRequest = z.infer<typeof broadcastRequestSchema>;
export const broadcastResponseSchema = dataEnvelope(z.object({ recipients: z.number().int() }));
