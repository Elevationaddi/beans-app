import { z } from "zod";
import {
  citySchema,
  dataEnvelope,
  filsSchema,
  listEnvelope,
  pageQuerySchema,
  uuidSchema,
} from "./common.js";
import { orderStatusSchema } from "./ordering.js";

// ── Tickets (docs/04 A06, docs/02 support, docs/03 support) ─────────────────

export const ticketCategorySchema = z.enum([
  "order_issue",
  "payment",
  "account",
  "privacy",
  "merchant_support",
  "other",
]);
export const ticketStatusSchema = z.enum(["open", "pending", "resolved", "closed"]);
export const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const ticketChannelSchema = z.enum(["customer", "merchant"]);
export const privacyRequestKindSchema = z.enum(["access", "deletion", "correction"]);
export const ticketVisibilitySchema = z.enum(["public", "internal"]);

const messageBodySchema = z.string().trim().min(1).max(4000);

/**
 * Raise a ticket. Customers may link only their own orders; merchant members name the merchant
 * and may link only that merchant's orders. Privacy requests use POST /me/privacy-requests.
 */
export const createTicketRequestSchema = z.strictObject({
  category: ticketCategorySchema.exclude(["privacy"]),
  message: messageBodySchema,
  orderId: uuidSchema.optional(),
  /** Set when a merchant member raises the ticket for their merchant. */
  merchantId: uuidSchema.optional(),
});
export type CreateTicketRequest = z.infer<typeof createTicketRequestSchema>;

export const ticketQuerySchema = pageQuerySchema.extend({
  status: ticketStatusSchema.optional(),
  /** Merchant members: tickets of this merchant instead of their own customer tickets. */
  merchantId: uuidSchema.optional(),
});

export const ticketMessageSchema = z.object({
  id: uuidSchema,
  authorRole: z.enum(["customer", "merchant", "support"]),
  visibility: ticketVisibilitySchema,
  body: z.string(),
  createdAt: z.iso.datetime(),
});

export const ticketSchema = z.object({
  id: uuidSchema,
  channel: ticketChannelSchema,
  category: ticketCategorySchema,
  privacyKind: privacyRequestKindSchema.nullable(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  orderId: uuidSchema.nullable(),
  merchantId: uuidSchema.nullable(),
  /** Support only. */
  assigneeId: uuidSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TicketView = z.infer<typeof ticketSchema>;

export const ticketDetailSchema = ticketSchema.extend({
  /** Customers and merchants see public messages only; support also sees internal notes. */
  messages: z.array(ticketMessageSchema),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const ticketResponseSchema = dataEnvelope(ticketDetailSchema);
export const ticketListResponseSchema = listEnvelope(ticketSchema);

export const createTicketMessageRequestSchema = z.strictObject({
  body: messageBodySchema,
  /** Internal notes are for support only; anyone else sending "internal" is refused. */
  visibility: ticketVisibilitySchema.default("public"),
});
export type CreateTicketMessageRequest = z.infer<typeof createTicketMessageRequestSchema>;

export const updateTicketRequestSchema = z
  .strictObject({
    status: ticketStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    /** A support or operations admin; null unassigns. */
    assigneeId: uuidSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to change" });
export type UpdateTicketRequest = z.infer<typeof updateTicketRequestSchema>;

export const privacyRequestSchema = z.strictObject({
  kind: privacyRequestKindSchema,
  message: messageBodySchema.optional(),
});
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>;

/**
 * What the platform holds about a person, for an access request (Q24). Contact details are
 * included because the person asked for their own data; payment card data is never stored.
 */
export const privacyExportSchema = z.object({
  ticketId: uuidSchema,
  generatedAt: z.iso.datetime(),
  user: z.object({
    id: uuidSchema,
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    locale: z.string(),
    status: z.string(),
    createdAt: z.iso.datetime(),
  }),
  vehicles: z.array(
    z.object({ plate: z.string(), color: z.string(), model: z.string().nullable() }),
  ),
  favorites: z.array(z.object({ merchantId: uuidSchema, createdAt: z.iso.datetime() })),
  orders: z.array(
    z.object({
      id: uuidSchema,
      publicNumber: z.string(),
      status: orderStatusSchema,
      totalFils: filsSchema,
      createdAt: z.iso.datetime(),
    }),
  ),
  tickets: z.array(
    z.object({ id: uuidSchema, category: ticketCategorySchema, createdAt: z.iso.datetime() }),
  ),
});
export type PrivacyExport = z.infer<typeof privacyExportSchema>;
export const privacyExportResponseSchema = dataEnvelope(privacyExportSchema);

// ── Dashboards, analytics and reports ───────────────────────────────────────

export const merchantDashboardQuerySchema = z
  .strictObject({
    merchantId: uuidSchema,
    branchId: uuidSchema.optional(),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .refine((p) => p.from < p.to, { message: "from must be before to", path: ["to"] })
  .refine((p) => Date.parse(p.to) - Date.parse(p.from) <= 366 * 86_400_000, {
    message: "At most 366 days",
    path: ["to"],
  });
export type MerchantDashboardQuery = z.infer<typeof merchantDashboardQuerySchema>;

/**
 * Definitions (docs/04 A01 "metrics reconcile with definitions"): an order counts in the period
 * when it was received (paid) in the period. Gross sales: order totals of completed orders.
 * Refunded: succeeded refunds on those orders. Net sales: gross minus refunded. Amounts in fils.
 */
export const merchantDashboardSchema = z.object({
  period: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  branchIds: z.array(uuidSchema),
  paidOrders: z.number().int(),
  completedOrders: z.number().int(),
  rejectedOrders: z.number().int(),
  cancelledOrders: z.number().int(),
  grossSalesFils: filsSchema,
  refundedFils: filsSchema,
  netSalesFils: filsSchema,
  /** Mean seconds from accepted to ready, over orders that reached ready. Null without any. */
  averagePrepSeconds: z.number().int().nullable(),
  /** Right now, regardless of the period. */
  liveQueue: z.object({
    received: z.number().int(),
    accepted: z.number().int(),
    preparing: z.number().int(),
    ready: z.number().int(),
  }),
});
export type MerchantDashboard = z.infer<typeof merchantDashboardSchema>;
export const merchantDashboardResponseSchema = dataEnvelope(merchantDashboardSchema);

export const merchantAnalyticsSchema = z.object({
  period: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  /** Completed orders per Dubai calendar day. */
  daily: z.array(
    z.object({ date: z.iso.date(), completedOrders: z.number().int(), grossSalesFils: filsSchema }),
  ),
  /** Units sold per product on completed orders, most first (top 20). */
  products: z.array(z.object({ productId: uuidSchema, name: z.string(), units: z.number().int() })),
});
export type MerchantAnalytics = z.infer<typeof merchantAnalyticsSchema>;
export const merchantAnalyticsResponseSchema = dataEnvelope(merchantAnalyticsSchema);

export const adminDashboardQuerySchema = z
  .strictObject({ from: z.iso.datetime(), to: z.iso.datetime(), city: citySchema.optional() })
  .refine((p) => p.from < p.to, { message: "from must be before to", path: ["to"] });
export type AdminDashboardQuery = z.infer<typeof adminDashboardQuerySchema>;

export const alertSchema = z.object({
  code: z.enum([
    "outbox_failed",
    "webhooks_waiting",
    "refunds_failed",
    "payouts_failed",
    "reconciliation_open",
    "orders_waiting_acceptance",
  ]),
  count: z.number().int(),
});

/**
 * Platform overview (docs/04 A01). GMV: captured payments created in the period, for branches
 * in the city when one is given. Other counts follow the merchant dashboard definitions.
 */
export const adminDashboardSchema = z.object({
  period: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  city: citySchema.nullable(),
  gmvFils: filsSchema,
  refundedFils: filsSchema,
  paidOrders: z.number().int(),
  completedOrders: z.number().int(),
  activeShops: z.number().int(),
  pendingApprovals: z.number().int(),
  openTickets: z.number().int(),
  openCancellationRequests: z.number().int(),
  alerts: z.array(alertSchema),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
export const adminDashboardResponseSchema = dataEnvelope(adminDashboardSchema);

export const adminReportQuerySchema = z
  .strictObject({
    report: z.enum(["orders_by_merchant", "refunds_by_merchant"]),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .refine((p) => p.from < p.to, { message: "from must be before to", path: ["to"] });
export type AdminReportQuery = z.infer<typeof adminReportQuerySchema>;

/** Aggregates per merchant, with no personal data. Every view is written to the audit log. */
export const adminReportSchema = z.object({
  report: z.enum(["orders_by_merchant", "refunds_by_merchant"]),
  period: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  rows: z.array(
    z.object({
      merchantId: uuidSchema,
      brandName: z.string(),
      count: z.number().int(),
      amountFils: filsSchema,
    }),
  ),
  totals: z.object({ count: z.number().int(), amountFils: filsSchema }),
});
export type AdminReport = z.infer<typeof adminReportSchema>;
export const adminReportResponseSchema = dataEnvelope(adminReportSchema);

// ── Settings (docs/04 A09), read only ───────────────────────────────────────

export const adminSettingsSchema = z.object({
  /** Server-side switches; every disabled feature is refused by the API. */
  features: z.object({
    livePayments: z.boolean(),
    rewards: z.boolean(),
    gifts: z.boolean(),
    dineIn: z.boolean(),
    promoCodes: z.boolean(),
    wallet: z.boolean(),
  }),
  timeouts: z.object({
    quoteSeconds: z.number().int(),
    holdSeconds: z.number().int(),
    acceptSeconds: z.number().int(),
  }),
  currency: z.literal("AED"),
  timezone: z.literal("Asia/Dubai"),
  paymentProvider: z.string(),
  policies: z.array(
    z.object({
      type: z.string(),
      version: z.string(),
      effectiveAt: z.iso.datetime(),
      sandbox: z.boolean(),
    }),
  ),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;
export const adminSettingsResponseSchema = dataEnvelope(adminSettingsSchema);
