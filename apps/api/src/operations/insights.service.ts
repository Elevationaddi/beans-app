import { Inject, Injectable } from "@nestjs/common";
import type {
  AdminDashboard,
  AdminReport,
  MerchantAnalytics,
  MerchantDashboard,
} from "@beans/contracts";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";

/** Merchant roles that may read dashboards and analytics (docs/10: analysts read, never act). */
const INSIGHT_ROLES = new Set(["owner", "manager", "analyst"]);

interface Period {
  from: Date;
  to: Date;
}

const big = (value: unknown) => BigInt((value as bigint | number | string | null) ?? 0);
const int = (value: unknown) => Number((value as bigint | number | null) ?? 0);

/**
 * Aggregates for dashboards, analytics and reports (docs/03, docs/04 A01/A08). Every number
 * comes from one SQL definition, documented on the contract schemas, so the tests can rebuild
 * it from raw rows (aggregate metrics reconcile). No personal data leaves these queries.
 */
@Injectable()
export class InsightsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
  ) {}

  /** The branches of `merchantId` the caller may read, optionally narrowed to one. */
  async scopedBranches(userId: string, merchantId: string, branchId?: string): Promise<string[]> {
    const member = await this.access.requireMember(userId, merchantId);
    if (!INSIGHT_ROLES.has(member.role)) {
      throw ApiError.forbidden("Only owners, managers and analysts can read reports");
    }
    const branches = await this.prisma.branch.findMany({
      where: { merchantId, ...this.access.branchScope(userId), ...(branchId && { id: branchId }) },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (branchId && branches.length === 0) throw ApiError.notFound("Branch not found");
    return branches.map((b) => b.id);
  }

  async merchantDashboard(branchIds: string[], period: Period): Promise<MerchantDashboard> {
    const [row] = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH paid AS (
        SELECT o.id, o.status, (o.totals->>'totalFils')::bigint AS total
        FROM orders o
        JOIN order_events e ON e.order_id = o.id AND e.to_state = 'received'
        WHERE o.branch_id = ANY(${branchIds}::uuid[])
          AND e.created_at >= ${period.from} AND e.created_at < ${period.to}
      ),
      prep AS (
        SELECT EXTRACT(EPOCH FROM (r.created_at - a.created_at)) AS seconds
        FROM paid p
        JOIN order_events a ON a.order_id = p.id AND a.to_state = 'accepted'
        JOIN order_events r ON r.order_id = p.id AND r.to_state = 'ready'
      )
      SELECT
        (SELECT count(*) FROM paid) AS paid,
        (SELECT count(*) FROM paid WHERE status = 'completed') AS completed,
        (SELECT count(*) FROM paid WHERE status = 'rejected') AS rejected,
        (SELECT count(*) FROM paid WHERE status = 'cancelled') AS cancelled,
        (SELECT COALESCE(sum(total), 0) FROM paid WHERE status = 'completed') AS gross,
        (SELECT COALESCE(sum(rf.amount_fils), 0) FROM refunds rf
           JOIN paid p ON p.id = rf.order_id AND p.status = 'completed'
           WHERE rf.status = 'succeeded') AS refunded,
        (SELECT round(avg(seconds)) FROM prep) AS prep`;
    const live = await this.prisma.order.groupBy({
      by: ["status"],
      where: {
        branchId: { in: branchIds },
        status: { in: ["received", "accepted", "preparing", "ready"] },
      },
      _count: { _all: true },
    });
    const liveCount = (status: string) => live.find((l) => l.status === status)?._count._all ?? 0;
    const gross = big(row?.gross);
    const refunded = big(row?.refunded);
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      branchIds,
      paidOrders: int(row?.paid),
      completedOrders: int(row?.completed),
      rejectedOrders: int(row?.rejected),
      cancelledOrders: int(row?.cancelled),
      grossSalesFils: gross.toString(),
      refundedFils: refunded.toString(),
      netSalesFils: (gross - refunded).toString(),
      averagePrepSeconds: row?.prep == null ? null : Number(row.prep),
      liveQueue: {
        received: liveCount("received"),
        accepted: liveCount("accepted"),
        preparing: liveCount("preparing"),
        ready: liveCount("ready"),
      },
    };
  }

  async merchantAnalytics(branchIds: string[], period: Period): Promise<MerchantAnalytics> {
    const daily = await this.prisma.$queryRaw<{ date: string; orders: bigint; gross: bigint }[]>`
      SELECT to_char(e.created_at AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD') AS date,
             count(*) AS orders, COALESCE(sum((o.totals->>'totalFils')::bigint), 0) AS gross
      FROM orders o
      JOIN order_events e ON e.order_id = o.id AND e.to_state = 'completed'
      WHERE o.branch_id = ANY(${branchIds}::uuid[])
        AND e.created_at >= ${period.from} AND e.created_at < ${period.to}
      GROUP BY 1 ORDER BY 1`;
    const products = await this.prisma.$queryRaw<
      { product_id: string; name: string; units: bigint }[]
    >`
      SELECT i.product_id, min(i.snapshot->'names'->>'en') AS name, sum(i.quantity) AS units
      FROM order_items i
      JOIN orders o ON o.id = i.order_id
      JOIN order_events e ON e.order_id = o.id AND e.to_state = 'completed'
      WHERE o.branch_id = ANY(${branchIds}::uuid[])
        AND e.created_at >= ${period.from} AND e.created_at < ${period.to}
      GROUP BY i.product_id ORDER BY units DESC, i.product_id LIMIT 20`;
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      daily: daily.map((d) => ({
        date: d.date,
        completedOrders: int(d.orders),
        grossSalesFils: big(d.gross).toString(),
      })),
      products: products.map((p) => ({
        productId: p.product_id,
        name: p.name,
        units: int(p.units),
      })),
    };
  }

  async adminDashboard(period: Period, city: string | null): Promise<AdminDashboard> {
    const [money] = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        (SELECT COALESCE(sum(p.amount_fils), 0) FROM payments p
           JOIN orders o ON o.id = p.order_id JOIN branches b ON b.id = o.branch_id
           WHERE p.status = 'captured' AND p.created_at >= ${period.from} AND p.created_at < ${period.to}
             AND (${city}::text IS NULL OR b.city = ${city}::text)) AS gmv,
        (SELECT COALESCE(sum(r.amount_fils), 0) FROM refunds r
           JOIN orders o ON o.id = r.order_id JOIN branches b ON b.id = o.branch_id
           WHERE r.status = 'succeeded' AND r.created_at >= ${period.from} AND r.created_at < ${period.to}
             AND (${city}::text IS NULL OR b.city = ${city}::text)) AS refunded,
        (SELECT count(*) FROM orders o JOIN branches b ON b.id = o.branch_id
           JOIN order_events e ON e.order_id = o.id AND e.to_state = 'received'
           WHERE e.created_at >= ${period.from} AND e.created_at < ${period.to}
             AND (${city}::text IS NULL OR b.city = ${city}::text)) AS paid,
        (SELECT count(*) FROM orders o JOIN branches b ON b.id = o.branch_id
           JOIN order_events e ON e.order_id = o.id AND e.to_state = 'received'
           WHERE o.status = 'completed' AND e.created_at >= ${period.from} AND e.created_at < ${period.to}
             AND (${city}::text IS NULL OR b.city = ${city}::text)) AS completed,
        (SELECT count(DISTINCT m.id) FROM merchants m JOIN branches b ON b.merchant_id = m.id
           WHERE m.status = 'approved' AND b.status = 'active'
             AND (${city}::text IS NULL OR b.city = ${city}::text)) AS shops`;
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);
    const [pending, tickets, cancellations, outbox, webhooks, refunds, payouts, recon, waiting] =
      await Promise.all([
        this.prisma.merchant.count({ where: { status: { in: ["submitted", "review"] } } }),
        this.prisma.ticket.count({ where: { status: { in: ["open", "pending"] } } }),
        this.prisma.cancellationRequest.count({ where: { status: "open" } }),
        this.prisma.outboxMessage.count({ where: { state: "failed" } }),
        this.prisma.paymentWebhookEvent.count({
          where: { processedAt: null, receivedAt: { lt: fiveMinutesAgo } },
        }),
        this.prisma.refund.count({ where: { status: "failed" } }),
        this.prisma.payout.count({ where: { status: "failed" } }),
        this.prisma.reconciliationException.count({ where: { status: "open" } }),
        this.prisma.order.count({ where: { status: "received", acceptBy: { lt: now } } }),
      ]);
    const alerts: AdminDashboard["alerts"] = (
      [
        ["outbox_failed", outbox],
        ["webhooks_waiting", webhooks],
        ["refunds_failed", refunds],
        ["payouts_failed", payouts],
        ["reconciliation_open", recon],
        ["orders_waiting_acceptance", waiting],
      ] as const
    )
      .filter(([, count]) => count > 0)
      .map(([code, count]) => ({ code, count }));
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      city: (city as AdminDashboard["city"]) ?? null,
      gmvFils: big(money?.gmv).toString(),
      refundedFils: big(money?.refunded).toString(),
      paidOrders: int(money?.paid),
      completedOrders: int(money?.completed),
      activeShops: int(money?.shops),
      pendingApprovals: pending,
      openTickets: tickets,
      openCancellationRequests: cancellations,
      alerts,
    };
  }

  async report(report: AdminReport["report"], period: Period): Promise<AdminReport> {
    const rows =
      report === "orders_by_merchant"
        ? await this.prisma.$queryRaw<
            { merchant_id: string; brand_name: string; n: bigint; amount: bigint }[]
          >`
            SELECT m.id AS merchant_id, m.brand_name, count(*) AS n,
                   COALESCE(sum((o.totals->>'totalFils')::bigint), 0) AS amount
            FROM orders o JOIN merchants m ON m.id = o.merchant_id
            JOIN order_events e ON e.order_id = o.id AND e.to_state = 'received'
            WHERE e.created_at >= ${period.from} AND e.created_at < ${period.to}
            GROUP BY m.id, m.brand_name ORDER BY amount DESC, m.id`
        : await this.prisma.$queryRaw<
            { merchant_id: string; brand_name: string; n: bigint; amount: bigint }[]
          >`
            SELECT m.id AS merchant_id, m.brand_name, count(*) AS n, COALESCE(sum(r.amount_fils), 0) AS amount
            FROM refunds r JOIN orders o ON o.id = r.order_id JOIN merchants m ON m.id = o.merchant_id
            WHERE r.status = 'succeeded' AND r.created_at >= ${period.from} AND r.created_at < ${period.to}
            GROUP BY m.id, m.brand_name ORDER BY amount DESC, m.id`;
    const mapped = rows.map((r) => ({
      merchantId: r.merchant_id,
      brandName: r.brand_name,
      count: int(r.n),
      amountFils: big(r.amount).toString(),
    }));
    return {
      report,
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      rows: mapped,
      totals: {
        count: mapped.reduce((sum, r) => sum + r.count, 0),
        amountFils: mapped.reduce((sum, r) => sum + BigInt(r.amountFils), 0n).toString(),
      },
    };
  }
}
