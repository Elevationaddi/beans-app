import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  type AdminAccount,
  type AdminCustomer,
  type AdminCustomerDetail,
  type AdminCustomerQuery,
  type AdminOrder,
  type AdminOrderDetail,
  type AdminOrderQuery,
  type AdminProduct,
  type AdminProductQuery,
  type BroadcastRequest,
  type DisputeView,
  type ModerateProductRequest,
  type SetAdminRoleRequest,
  type SetMerchantStatusRequest,
  type SetUserStatusRequest,
  adminCustomerQuerySchema,
  adminDisputeQuerySchema,
  adminOrderQuerySchema,
  adminProductQuerySchema,
  broadcastRequestSchema,
  moderateProductRequestSchema,
  resolveDisputeRequestSchema,
  setAdminRoleRequestSchema,
  setMerchantStatusRequestSchema,
  setUserStatusRequestSchema,
  simulateDisputeRequestSchema,
  submitDisputeEvidenceRequestSchema,
} from "@beans/contracts";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import { idParams } from "../common/params.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { type LineSnapshot } from "../fulfillment/order-views.js";
import { Idempotent } from "../idempotency/idempotent.interceptor.js";

type Cursor = ReturnType<typeof decodeCursor>;
/** Newest first, keyset on (createdAt, id). */
const before = (cursor: Cursor) =>
  cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }
    : {};
function page<T extends { id: string; createdAt: Date }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}
const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });
const totalOf = (totals: Prisma.JsonValue) =>
  String((totals as { totalFils?: string } | null)?.totalFils ?? "0");
const ACTIVE = ["received", "accepted", "preparing", "ready"] as const;

/**
 * Admin console back end for A02–A10 gaps: customers, order monitoring, admin roles, merchant
 * suspension, menu moderation, disputes (sandbox) and in-app broadcasts. Every change is audited
 * with a reason; privileged reads of personal data are audited too (docs/10-security.md).
 */
@Controller("admin")
export class AdminConsoleController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ── A03 customers ──────────────────────────────────────────────────────────

  @Get("customers")
  @RequireAdmin("support", "operations", "security")
  async customers(
    @Query(new ZodValidationPipe(adminCustomerQuerySchema)) query: AdminCustomerQuery,
  ): Promise<{ data: AdminCustomer[]; meta: { nextCursor: string | null } }> {
    const rows = await this.prisma.user.findMany({
      where: {
        adminRoles: { none: {} },
        ...(query.status && { status: query.status }),
        ...(query.q && {
          OR: [{ email: ci(query.q) }, { phone: ci(query.q) }, { displayName: ci(query.q) }],
        }),
        ...before(decodeCursor(query.cursor)),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toCustomer), meta: { nextCursor } };
  }

  @Get("customers/:id")
  @RequireAdmin("support", "operations", "security")
  async customer(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: AdminCustomerDetail }> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.id },
      include: {
        adminRoles: { select: { role: true } },
        memberships: {
          where: { status: "active" },
          select: { merchantId: true, role: true, merchant: { select: { brandName: true } } },
        },
      },
    });
    if (!user) throw ApiError.notFound("Customer not found");
    const [orders, recent, openTickets] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId: user.id },
        select: { status: true, totals: true },
      }),
      this.prisma.order.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.prisma.ticket.count({
        where: { requesterId: user.id, status: { in: ["open", "pending"] } },
      }),
    ]);
    const completed = orders.filter((o) => o.status === "completed");
    await this.audit.record({
      actorId: actor.userId,
      action: "admin.customer_viewed",
      targetType: "user",
      targetId: user.id,
      requestId,
    });
    return {
      data: {
        ...toCustomer(user),
        orderCount: orders.length,
        completedOrderCount: completed.length,
        spentFils: completed.reduce((sum, o) => sum + BigInt(totalOf(o.totals)), 0n).toString(),
        openTickets,
        memberships: user.memberships.map((m) => ({
          merchantId: m.merchantId,
          brandName: m.merchant.brandName,
          role: m.role,
        })),
        adminRoles: user.adminRoles.map((r) => r.role),
        recentOrders: recent.map((o) => ({
          id: o.id,
          publicNumber: o.publicNumber,
          status: o.status,
          totalFils: totalOf(o.totals),
          createdAt: o.createdAt.toISOString(),
        })),
      },
    };
  }

  /** Suspend or restore. Suspended people are refused on every request (auth guard). */
  @Post("customers/:id/status")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("support", "security")
  async setCustomerStatus(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(setUserStatusRequestSchema)) body: SetUserStatusRequest,
  ): Promise<{ data: AdminCustomer }> {
    if (params.id === actor.userId)
      throw ApiError.forbidden("You cannot change your own account status");
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: params.id },
        include: { adminRoles: true },
      });
      if (!user || user.status === "deleted") throw ApiError.notFound("Customer not found");
      if (user.adminRoles.length > 0)
        throw ApiError.forbidden("Admin accounts are managed under admin roles");
      const saved = await tx.user.update({ where: { id: user.id }, data: { status: body.status } });
      await this.audit.record(
        {
          actorId: actor.userId,
          action:
            body.status === "suspended" ? "admin.customer_suspended" : "admin.customer_restored",
          targetType: "user",
          targetId: user.id,
          requestId,
          reason: body.reason,
          before: { status: user.status },
          after: { status: saved.status },
        },
        tx,
      );
      return { data: toCustomer(saved) };
    });
  }

  // ── A04 order monitoring ───────────────────────────────────────────────────

  @Get("orders")
  @RequireAdmin("operations", "support", "finance_maker", "finance_checker")
  async orders(
    @Query(new ZodValidationPipe(adminOrderQuerySchema)) query: AdminOrderQuery,
  ): Promise<{ data: AdminOrder[]; meta: { nextCursor: string | null } }> {
    const rows = await this.prisma.order.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.merchantId && { merchantId: query.merchantId }),
        ...(query.branchId && { branchId: query.branchId }),
        ...(query.number && { publicNumber: query.number.toUpperCase() }),
        ...((query.from || query.to) && {
          createdAt: {
            ...(query.from && { gte: new Date(query.from) }),
            ...(query.to && { lt: new Date(query.to) }),
          },
        }),
        ...before(decodeCursor(query.cursor)),
      },
      include: orderListInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toAdminOrder), meta: { nextCursor } };
  }

  @Get("orders/:id")
  @RequireAdmin("operations", "support", "finance_maker", "finance_checker")
  async order(@Param(idParams) params: { id: string }): Promise<{ data: AdminOrderDetail }> {
    const row = await this.prisma.order.findUnique({
      where: { id: params.id },
      include: {
        ...orderListInclude,
        items: { orderBy: { lineNo: "asc" } },
        events: {
          orderBy: { seq: "asc" },
          include: { actor: { select: { adminRoles: { select: { role: true } } } } },
        },
        payments: { orderBy: { attempt: "asc" } },
        refunds: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!row) throw ApiError.notFound("Order not found");
    return {
      data: {
        ...toAdminOrder(row),
        items: row.items.map((i) => {
          const snap = i.snapshot as unknown as LineSnapshot;
          return {
            name: snap.names.en,
            quantity: i.quantity,
            options: snap.options.map((o) => o.names.en),
          };
        }),
        events: row.events.map((e) => ({
          type: e.fromState === null ? "created" : "transition",
          fromStatus: e.fromState,
          toStatus: e.toState,
          at: e.createdAt.toISOString(),
          actorRole:
            e.actorId === null
              ? "system"
              : e.actorId === row.userId
                ? "customer"
                : e.actor?.adminRoles.length
                  ? "admin"
                  : "staff",
        })),
        payments: row.payments.map((p) => ({
          id: p.id,
          status: p.status,
          amountFils: p.amountFils.toString(),
          provider: p.provider,
          createdAt: p.createdAt.toISOString(),
        })),
        refunds: row.refunds.map((r) => ({
          id: r.id,
          status: r.status,
          amountFils: r.amountFils.toString(),
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  }

  // ── A10 admin accounts and roles ───────────────────────────────────────────

  @Get("admins")
  @RequireAdmin("super_admin", "security")
  async admins(): Promise<{ data: AdminAccount[] }> {
    const users = await this.prisma.user.findMany({
      where: { adminRoles: { some: {} } },
      include: { adminRoles: { select: { role: true }, orderBy: { role: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    return { data: users.map(toAccount) };
  }

  /** Super admins only. The last super admin cannot be removed; nobody changes their own roles. */
  @Post("admins/roles")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("super_admin")
  async setRole(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(setAdminRoleRequestSchema)) body: SetAdminRoleRequest,
  ): Promise<{ data: AdminAccount }> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { email: { equals: body.email, mode: "insensitive" }, status: "active" },
      });
      if (!target)
        throw ApiError.notFound("No active account with that email. They must sign in once first.");
      if (target.id === actor.userId)
        throw ApiError.forbidden("You cannot change your own admin roles");
      const has = await tx.adminRole.findUnique({
        where: { userId_role: { userId: target.id, role: body.role } },
      });
      if (body.grant && !has) {
        await tx.adminRole.create({ data: { userId: target.id, role: body.role } });
      } else if (!body.grant && has) {
        if (
          body.role === "super_admin" &&
          (await tx.adminRole.count({ where: { role: "super_admin" } })) <= 1
        ) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            "CONFLICT",
            "The last super admin cannot be removed",
          );
        }
        await tx.adminRole.delete({
          where: { userId_role: { userId: target.id, role: body.role } },
        });
      }
      await this.audit.record(
        {
          actorId: actor.userId,
          action: body.grant ? "admin.role_granted" : "admin.role_removed",
          targetType: "user",
          targetId: target.id,
          requestId,
          reason: body.reason,
          after: { role: body.role, changed: body.grant !== Boolean(has) },
        },
        tx,
      );
      const fresh = await tx.user.findUniqueOrThrow({
        where: { id: target.id },
        include: { adminRoles: { select: { role: true }, orderBy: { role: "asc" } } },
      });
      return { data: toAccount(fresh) };
    });
  }

  // ── A02 merchant suspension ────────────────────────────────────────────────

  @Post("merchants/:id/status")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("operations", "super_admin")
  async setMerchantStatus(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(setMerchantStatusRequestSchema)) body: SetMerchantStatusRequest,
  ): Promise<{ data: { id: string; status: string } }> {
    return this.prisma.$transaction(async (tx) => {
      const merchant = await tx.merchant.findUnique({ where: { id: params.id } });
      if (!merchant) throw ApiError.notFound("Merchant not found");
      // Only approved ↔ suspended here; applications go through review.
      const allowed =
        body.status === "suspended"
          ? merchant.status === "approved"
          : merchant.status === "suspended";
      if (!allowed) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          `A ${merchant.status} merchant cannot become ${body.status}`,
        );
      }
      const saved = await tx.merchant.update({
        where: { id: merchant.id },
        data: { status: body.status },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: body.status === "suspended" ? "merchant.suspended" : "merchant.reinstated",
          targetType: "merchant",
          targetId: merchant.id,
          requestId,
          reason: body.reason,
          before: { status: merchant.status },
          after: { status: saved.status },
        },
        tx,
      );
      return { data: { id: saved.id, status: saved.status } };
    });
  }

  // ── Menu moderation ────────────────────────────────────────────────────────

  @Get("products")
  @RequireAdmin("operations", "marketing")
  async products(
    @Query(new ZodValidationPipe(adminProductQuerySchema)) query: AdminProductQuery,
  ): Promise<{ data: AdminProduct[]; meta: { nextCursor: string | null } }> {
    const rows = await this.prisma.product.findMany({
      where: {
        status: { not: "archived" },
        ...(query.merchantId && { merchantId: query.merchantId }),
        ...(query.hidden === "true" && { moderationHiddenAt: { not: null } }),
        ...(query.hidden === "false" && { moderationHiddenAt: null }),
        ...(query.q && { names: { path: ["en"], string_contains: query.q } }),
        ...before(decodeCursor(query.cursor)),
      },
      include: { merchant: { select: { brandName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toAdminProduct), meta: { nextCursor } };
  }

  /** Hide or restore a product for customers everywhere, with a note the merchant can read. */
  @Post("products/:id/moderation")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("operations")
  async moderate(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(moderateProductRequestSchema)) body: ModerateProductRequest,
  ): Promise<{ data: AdminProduct }> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: params.id } });
      if (!product) throw ApiError.notFound("Product not found");
      const saved = await tx.product.update({
        where: { id: product.id },
        data: body.hidden
          ? { moderationHiddenAt: new Date(), moderationNote: body.reason }
          : { moderationHiddenAt: null, moderationNote: null },
        include: { merchant: { select: { brandName: true } } },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: body.hidden ? "product.moderation_hidden" : "product.moderation_restored",
          targetType: "product",
          targetId: product.id,
          requestId,
          reason: body.reason,
          before: { hidden: product.moderationHiddenAt !== null },
          after: { hidden: body.hidden },
        },
        tx,
      );
      return { data: toAdminProduct(saved) };
    });
  }

  // ── A05 disputes and chargebacks (sandbox) ─────────────────────────────────

  @Get("disputes")
  @RequireAdmin("finance_maker", "finance_checker")
  async disputes(
    @Query(new ZodValidationPipe(adminDisputeQuerySchema))
    query: z.infer<typeof adminDisputeQuerySchema>,
  ): Promise<{ data: DisputeView[]; meta: { nextCursor: string | null } }> {
    const rows = await this.prisma.dispute.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...before(decodeCursor(query.cursor)),
      },
      include: disputeInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toDispute), meta: { nextCursor } };
  }

  /**
   * Sandbox only: stands in for the provider's dispute webhook so the workflow can be tested.
   * Refused when live payments are enabled; the real adapter posts disputes from webhooks.
   */
  @Post("disputes/simulate")
  @Idempotent()
  @RequireAdmin("finance_maker")
  async simulateDispute(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(simulateDisputeRequestSchema))
    body: z.infer<typeof simulateDisputeRequestSchema>,
  ): Promise<{ data: DisputeView }> {
    if (this.env.LIVE_PAYMENTS_ENABLED || this.env.PAYMENT_PROVIDER !== "fake") {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        "FEATURE_DISABLED",
        "Simulated disputes exist only in the sandbox",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: body.paymentId } });
      if (!payment || payment.status !== "captured")
        throw ApiError.notFound("Captured payment not found");
      const amount = BigInt(body.amountFils);
      if (amount > payment.amountFils) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "VALIDATION_FAILED",
          "A dispute cannot exceed the payment",
        );
      }
      const dispute = await tx.dispute.create({
        data: {
          paymentId: payment.id,
          providerRef: `sandbox-dispute-${crypto.randomUUID()}`,
          amountFils: amount,
          reason: body.reason,
          dueAt: new Date(Date.now() + 7 * 86_400_000),
        },
        include: disputeInclude,
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "dispute.opened",
          targetType: "dispute",
          targetId: dispute.id,
          requestId,
          after: { amountFils: body.amountFils, sandbox: true },
        },
        tx,
      );
      return { data: toDispute(dispute) };
    });
  }

  @Post("disputes/:id/evidence")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("finance_maker")
  async evidence(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(submitDisputeEvidenceRequestSchema)) body: { evidence: string },
  ): Promise<{ data: DisputeView }> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dispute.updateMany({
        where: { id: params.id, status: "open" },
        data: { status: "evidence_submitted", evidence: body.evidence },
      });
      if (updated.count === 0)
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          "Evidence can be sent only for an open dispute",
        );
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "dispute.evidence_submitted",
          targetType: "dispute",
          targetId: params.id,
          requestId,
        },
        tx,
      );
      return {
        data: toDispute(
          await tx.dispute.findUniqueOrThrow({ where: { id: params.id }, include: disputeInclude }),
        ),
      };
    });
  }

  /** Sandbox: record the outcome. A lost dispute's cost allocation is an open decision. */
  @Post("disputes/:id/resolve")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("finance_checker")
  async resolveDispute(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(resolveDisputeRequestSchema))
    body: z.infer<typeof resolveDisputeRequestSchema>,
  ): Promise<{ data: DisputeView }> {
    if (this.env.LIVE_PAYMENTS_ENABLED) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        "FEATURE_DISABLED",
        "Outcomes come from the provider when live",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dispute.updateMany({
        where: { id: params.id, status: { in: ["open", "evidence_submitted"] } },
        data: { status: body.outcome },
      });
      if (updated.count === 0)
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          "This dispute is already closed",
        );
      await this.audit.record(
        {
          actorId: actor.userId,
          action: `dispute.${body.outcome}`,
          targetType: "dispute",
          targetId: params.id,
          requestId,
          reason: body.reason,
        },
        tx,
      );
      return {
        data: toDispute(
          await tx.dispute.findUniqueOrThrow({ where: { id: params.id }, include: disputeInclude }),
        ),
      };
    });
  }

  // ── Notifications: in-app broadcast ────────────────────────────────────────

  /** Writes to in-app inboxes only. No SMS, email or push is sent (CLAUDE.md). */
  @Post("notifications/broadcast")
  @Idempotent()
  @RequireAdmin("marketing", "operations")
  async broadcast(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(broadcastRequestSchema)) body: BroadcastRequest,
  ): Promise<{ data: { recipients: number } }> {
    const where: Prisma.UserWhereInput =
      body.audience === "customers"
        ? { status: "active", adminRoles: { none: {} }, memberships: { none: {} } }
        : body.audience === "merchant_owners"
          ? { status: "active", memberships: { some: { role: "owner", status: "active" } } }
          : { status: "active", memberships: { some: { status: "active" } } };
    const users = await this.prisma.user.findMany({ where, select: { id: true }, take: 50_000 });
    await this.prisma.$transaction(async (tx) => {
      await tx.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          kind: "broadcast",
          title: body.title,
          body: body.body,
        })),
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "notification.broadcast",
          targetType: "audience",
          targetId: body.audience,
          requestId,
          reason: body.reason,
          after: { recipients: users.length, title: body.title.en },
        },
        tx,
      );
    });
    return { data: { recipients: users.length } };
  }
}

const orderListInclude = {
  branch: { select: { nameEn: true, merchant: { select: { brandName: true } } } },
} satisfies Prisma.OrderInclude;
type OrderListRow = Prisma.OrderGetPayload<{ include: typeof orderListInclude }>;

function toAdminOrder(row: OrderListRow): AdminOrder {
  const now = Date.now();
  const late =
    (row.status === "received" && row.acceptBy !== null && row.acceptBy.getTime() < now) ||
    ((row.status === "accepted" || row.status === "preparing") &&
      row.etaAt !== null &&
      row.etaAt.getTime() < now);
  return {
    id: row.id,
    publicNumber: row.publicNumber,
    status: row.status,
    mode: row.mode,
    merchantId: row.merchantId,
    brandName: row.branch.merchant.brandName,
    branchId: row.branchId,
    branchName: row.branch.nameEn,
    customerId: row.userId,
    totalFils: totalOf(row.totals),
    createdAt: row.createdAt.toISOString(),
    acceptBy: row.acceptBy?.toISOString() ?? null,
    etaAt: row.etaAt?.toISOString() ?? null,
    late: late && (ACTIVE as readonly string[]).includes(row.status),
  };
}

function toCustomer(u: {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  locale: "en" | "ar";
  status: "active" | "suspended" | "deleted";
  createdAt: Date;
}): AdminCustomer {
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    phone: u.phone,
    locale: u.locale,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
  };
}

function toAccount(u: {
  id: string;
  displayName: string | null;
  email: string | null;
  status: "active" | "suspended" | "deleted";
  adminRoles: { role: AdminAccount["roles"][number] }[];
}): AdminAccount {
  return {
    userId: u.id,
    displayName: u.displayName,
    email: u.email,
    status: u.status,
    roles: u.adminRoles.map((r) => r.role),
  };
}

function toAdminProduct(
  p: Prisma.ProductGetPayload<{ include: { merchant: { select: { brandName: true } } } }>,
): AdminProduct {
  const names = p.names as { en: string; ar?: string };
  const descriptions = (p.descriptions ?? {}) as { en?: string; ar?: string };
  return {
    id: p.id,
    merchantId: p.merchantId,
    brandName: p.merchant.brandName,
    names: { en: names.en, ...(names.ar ? { ar: names.ar } : {}) },
    descriptions: {
      ...(descriptions.en ? { en: descriptions.en } : {}),
      ...(descriptions.ar ? { ar: descriptions.ar } : {}),
    },
    baseFils: p.baseFils.toString(),
    status: p.status,
    allergens: p.allergens,
    hidden: p.moderationHiddenAt !== null,
    moderationNote: p.moderationNote,
    updatedAt: p.updatedAt.toISOString(),
  };
}

const disputeInclude = {
  payment: {
    select: { orderId: true, order: { select: { publicNumber: true, merchantId: true } } },
  },
} satisfies Prisma.DisputeInclude;

function toDispute(d: Prisma.DisputeGetPayload<{ include: typeof disputeInclude }>): DisputeView {
  return {
    id: d.id,
    paymentId: d.paymentId,
    orderId: d.payment.orderId,
    publicNumber: d.payment.order.publicNumber,
    merchantId: d.payment.order.merchantId,
    providerRef: d.providerRef,
    amountFils: d.amountFils.toString(),
    reason: d.reason,
    status: d.status,
    evidence: d.evidence,
    dueAt: d.dueAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
