import { SettingsService } from "../platform/settings.service.js";
import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";
import {
  type AdminDashboard,
  type AdminDashboardQuery,
  adminDashboardQuerySchema,
  type AdminReport,
  type AdminReportQuery,
  adminReportQuerySchema,
  type AdminSettings,
  type MerchantAnalytics,
  type MerchantDashboard,
  type MerchantDashboardQuery,
  merchantDashboardQuerySchema,
  type PrivacyExport,
  uuidSchema,
} from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import { InsightsService } from "./insights.service.js";
import { LIMITS, RateLimit } from "../security/rate-limit.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));
const merchantQuery = new ZodValidationPipe(merchantDashboardQuerySchema);
const period = (q: { from: string; to: string }) => ({
  from: new Date(q.from),
  to: new Date(q.to),
});

/** Merchant dashboard and analytics, scoped to the caller's branches (docs/03 B01, B09). */
@Controller("merchant")
export class MerchantInsightsController {
  constructor(@Inject(InsightsService) private readonly insights: InsightsService) {}

  @Get("dashboard")
  async dashboard(
    @CurrentActor() actor: Actor,
    @Query(merchantQuery) query: MerchantDashboardQuery,
  ): Promise<{ data: MerchantDashboard }> {
    const branches = await this.insights.scopedBranches(
      actor.userId,
      query.merchantId,
      query.branchId,
    );
    return { data: await this.insights.merchantDashboard(branches, period(query)) };
  }

  @Get("analytics")
  async analytics(
    @CurrentActor() actor: Actor,
    @Query(merchantQuery) query: MerchantDashboardQuery,
  ): Promise<{ data: MerchantAnalytics }> {
    const branches = await this.insights.scopedBranches(
      actor.userId,
      query.merchantId,
      query.branchId,
    );
    return { data: await this.insights.merchantAnalytics(branches, period(query)) };
  }
}

/** Platform overview, reports, settings and privacy exports (docs/04 A01, A08, A09, A03). */
@Controller("admin")
export class AdminInsightsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InsightsService) private readonly insights: InsightsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly platformSettings: SettingsService,
  ) {}

  @Get("dashboard")
  @RequireAdmin("operations", "finance_maker", "finance_checker", "analyst")
  async dashboard(
    @Query(new ZodValidationPipe(adminDashboardQuerySchema)) query: AdminDashboardQuery,
  ): Promise<{ data: AdminDashboard }> {
    return { data: await this.insights.adminDashboard(period(query), query.city ?? null) };
  }

  /** Aggregates only. Each view is audited (docs/04 A08: log downloads). */
  @Get("reports")
  @RateLimit(LIMITS.export)
  @RequireAdmin("operations", "finance_maker", "finance_checker", "analyst")
  async report(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Query(new ZodValidationPipe(adminReportQuerySchema)) query: AdminReportQuery,
  ): Promise<{ data: AdminReport }> {
    const data = await this.insights.report(query.report, period(query));
    await this.audit.record({
      actorId: actor.userId,
      action: "report.viewed",
      targetType: "report",
      targetId: query.report,
      requestId,
      after: { report: query.report, from: query.from, to: query.to },
    });
    return { data };
  }

  /** Switches, timers and policy versions in force. Edit them under admin/platform-settings. */
  @Get("settings")
  @RequireAdmin("operations", "security", "super_admin")
  async settings(): Promise<{ data: AdminSettings }> {
    const [ops, features] = await Promise.all([
      this.platformSettings.get("operations"),
      this.platformSettings.get("features"),
    ]);
    const policies = await this.prisma.policy.findMany({
      orderBy: [{ type: "asc" }, { effectiveAt: "desc" }],
    });
    return {
      data: {
        features: {
          livePayments: this.env.LIVE_PAYMENTS_ENABLED,
          rewards: features.stampCards,
          gifts: features.sandboxGifts,
          dineIn: features.dineIn,
          promoCodes: features.promotions,
          // No stored-value wallet at this stage (founder decision 2026-11-28).
          wallet: false,
        },
        timeouts: {
          quoteSeconds: ops.quoteSeconds,
          holdSeconds: ops.holdSeconds,
          acceptSeconds: ops.acceptSeconds,
        },
        currency: "AED",
        timezone: "Asia/Dubai",
        paymentProvider: this.env.PAYMENT_PROVIDER,
        policies: policies.map((p) => ({
          type: p.type,
          version: p.version,
          effectiveAt: p.effectiveAt.toISOString(),
          sandbox:
            p.approvedById === null ||
            (p.configuration as { sandbox?: unknown } | null)?.sandbox === true,
        })),
      },
    };
  }

  /**
   * Access request export (Q24): the requester's own data, for support to send to them.
   * Only for privacy tickets asking for access; every export is audited.
   */
  @Get("privacy-requests/:id/export")
  @RateLimit(LIMITS.export)
  @RequireAdmin("support", "security")
  async privacyExport(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: PrivacyExport }> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: params.id } });
    if (!ticket || ticket.category !== "privacy")
      throw ApiError.notFound("Privacy request not found");
    if (ticket.privacyKind !== "access") {
      throw ApiError.validation({ id: ["Only access requests have an export"] });
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ticket.requesterId },
      include: {
        vehicles: { orderBy: { createdAt: "asc" } },
        favorites: { orderBy: { createdAt: "asc" } },
        orders: { orderBy: { createdAt: "asc" } },
        ticketsRequested: { orderBy: { createdAt: "asc" } },
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      action: "privacy.exported",
      targetType: "user",
      targetId: user.id,
      requestId,
      after: { ticketId: ticket.id },
    });
    return {
      data: {
        ticketId: ticket.id,
        generatedAt: new Date().toISOString(),
        user: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          phone: user.phone,
          locale: user.locale,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
        },
        vehicles: user.vehicles.map((v) => ({ plate: v.plate, color: v.color, model: v.model })),
        favorites: user.favorites.map((f) => ({
          merchantId: f.merchantId,
          createdAt: f.createdAt.toISOString(),
        })),
        orders: user.orders.map((o) => ({
          id: o.id,
          publicNumber: o.publicNumber,
          status: o.status,
          totalFils: String((o.totals as { totalFils?: unknown }).totalFils ?? "0"),
          createdAt: o.createdAt.toISOString(),
        })),
        tickets: user.ticketsRequested.map((t) => ({
          id: t.id,
          category: t.category,
          createdAt: t.createdAt.toISOString(),
        })),
      },
    };
  }
}
