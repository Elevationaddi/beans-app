import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import {
  type MerchantFinance,
  type MerchantFinanceQuery,
  merchantFinanceQuerySchema,
  merchantPayoutQuerySchema,
  type MerchantTransaction,
} from "@beans/contracts";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import { LIMITS, RateLimit } from "../security/rate-limit.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";

const MAX_ROWS = 500;

interface CsvResponse {
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

/** B09: the business's own sales, refunds, commission and payouts, from the journal. */
@Controller("merchant/finance")
export class MerchantFinanceController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async requireFinanceReader(userId: string, merchantId: string) {
    const member = await this.access.requireMember(userId, merchantId);
    if (member.role !== "owner" && member.role !== "analyst") throw ApiError.forbidden();
    return member;
  }

  @Get()
  async summary(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(merchantFinanceQuerySchema)) query: MerchantFinanceQuery,
  ): Promise<{ data: MerchantFinance }> {
    await this.requireFinanceReader(actor.userId, query.merchantId);
    return { data: await this.build(query) };
  }

  @Get("statement")
  @RateLimit(LIMITS.export)
  async statement(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Query(new ZodValidationPipe(merchantFinanceQuerySchema)) query: MerchantFinanceQuery,
    @Res() res: CsvResponse,
  ): Promise<void> {
    await this.requireFinanceReader(actor.userId, query.merchantId);
    const data = await this.build(query);
    await this.audit.record({
      actorId: actor.userId,
      action: "merchant.statement_exported",
      targetType: "merchant",
      targetId: query.merchantId,
      requestId,
      after: { from: query.from, to: query.to, rows: data.transactions.length },
    });
    const rows = [
      ["kind", "order", "at_utc", "amount_fils", "commission_fils", "payable_change_fils"],
      ...data.transactions.map((t) => [
        t.kind,
        t.publicNumber,
        t.at,
        t.amountFils,
        t.commissionFils,
        t.payableChangeFils,
      ]),
      [],
      ["sales_fils", data.salesFils],
      ["refunds_fils", data.refundsFils],
      ["commission_fils", data.commissionFils],
      ["net_payable_fils", data.netPayableFils],
      ["note", "SANDBOX statement, not a tax invoice. Amounts in fils (1 AED = 100 fils)."],
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="statement-${query.from.slice(0, 10)}-${query.to.slice(0, 10)}.csv"`,
    );
    res.send(
      rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"),
    );
  }

  @Get("payouts")
  async payouts(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(merchantPayoutQuerySchema))
    query: z.infer<typeof merchantPayoutQuerySchema>,
  ) {
    await this.requireFinanceReader(actor.userId, query.merchantId);
    const rows = await this.prisma.payout.findMany({
      where: { merchantId: query.merchantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      data: rows.map((p) => ({
        id: p.id,
        status: p.status,
        amountFils: p.amountFils.toString(),
        periodEnd: p.periodEnd.toISOString(),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  }

  private async build(query: MerchantFinanceQuery): Promise<MerchantFinance> {
    const range = { gte: new Date(query.from), lt: new Date(query.to) };
    const merchantId = query.merchantId;
    const [journals, balanceAgg, paidAgg, policy] = await Promise.all([
      this.prisma.journalTransaction.findMany({
        where: {
          createdAt: range,
          OR: [
            { sourceType: "order", eventType: "completed" },
            { sourceType: "refund", eventType: "succeeded" },
          ],
          lines: { some: { merchantId } },
        },
        include: { lines: true },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS + 1,
      }),
      this.prisma.journalLine.aggregate({
        where: { merchantId, accountCode: "merchant_payable" },
        _sum: { creditFils: true, debitFils: true },
      }),
      this.prisma.journalLine.aggregate({
        where: {
          merchantId,
          accountCode: "merchant_payable",
          journal: { sourceType: "payout", createdAt: range },
        },
        _sum: { debitFils: true },
      }),
      this.prisma.policy.findFirst({
        where: { type: "commission", effectiveAt: { lte: new Date() } },
        orderBy: { effectiveAt: "desc" },
      }),
    ]);
    const truncated = journals.length > MAX_ROWS;
    const kept = journals.slice(0, MAX_ROWS);
    const refundIds = kept.filter((j) => j.sourceType === "refund").map((j) => j.sourceId);
    const refunds = refundIds.length
      ? await this.prisma.refund.findMany({
          where: { id: { in: refundIds } },
          select: { id: true, orderId: true },
        })
      : [];
    const refundOrder = new Map(refunds.map((r) => [r.id, r.orderId]));
    const orderIds = [
      ...new Set(
        kept
          .map((j) => (j.sourceType === "order" ? j.sourceId : refundOrder.get(j.sourceId)))
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds }, merchantId },
      select: { id: true, publicNumber: true },
    });
    const numbers = new Map(orders.map((o) => [o.id, o.publicNumber]));

    let sales = 0n;
    let refunded = 0n;
    let commission = 0n;
    let payable = 0n;
    const transactions: MerchantTransaction[] = [];
    for (const j of kept) {
      const sum = (code: string, side: "debitFils" | "creditFils") =>
        j.lines.filter((l) => l.accountCode === code).reduce((acc, l) => acc + l[side], 0n);
      const orderId = j.sourceType === "order" ? j.sourceId : refundOrder.get(j.sourceId);
      if (!orderId || !numbers.has(orderId)) continue;
      if (j.sourceType === "order") {
        const amount = sum("customer_order_liability", "debitFils");
        const fee = sum("platform_commission_revenue", "creditFils");
        const change = j.lines
          .filter((l) => l.accountCode === "merchant_payable" && l.merchantId === merchantId)
          .reduce((a, l) => a + l.creditFils, 0n);
        sales += amount;
        commission += fee;
        payable += change;
        transactions.push({
          kind: "sale",
          orderId,
          publicNumber: numbers.get(orderId)!,
          at: j.createdAt.toISOString(),
          amountFils: amount.toString(),
          commissionFils: fee.toString(),
          payableChangeFils: change.toString(),
        });
      } else {
        const amount = sum("provider_clearing", "creditFils");
        const fee = sum("platform_commission_revenue", "debitFils");
        const change = j.lines
          .filter((l) => l.accountCode === "merchant_payable" && l.merchantId === merchantId)
          .reduce((a, l) => a + l.debitFils, 0n);
        refunded += amount;
        commission -= fee;
        payable -= change;
        transactions.push({
          kind: "refund",
          orderId,
          publicNumber: numbers.get(orderId)!,
          at: j.createdAt.toISOString(),
          amountFils: amount.toString(),
          commissionFils: fee.toString(),
          payableChangeFils: (-change).toString(),
        });
      }
    }
    const config = (policy?.configuration ?? {}) as {
      rateBasisPoints?: unknown;
      vatExcluded?: unknown;
      sandbox?: unknown;
    };
    const balance = (balanceAgg._sum.creditFils ?? 0n) - (balanceAgg._sum.debitFils ?? 0n);
    return {
      period: { from: query.from, to: query.to },
      salesFils: sales.toString(),
      refundsFils: refunded.toString(),
      commissionFils: (commission < 0n ? 0n : commission).toString(),
      netPayableFils: payable.toString(),
      balanceFils: balance.toString(),
      paidOutFils: (paidAgg._sum.debitFils ?? 0n).toString(),
      commission: {
        policyVersion: policy?.version ?? null,
        rateBasisPoints: typeof config.rateBasisPoints === "number" ? config.rateBasisPoints : null,
        vatExcluded: config.vatExcluded === true,
        sandbox: config.sandbox !== false,
      },
      transactions,
      truncated,
    };
  }
}
