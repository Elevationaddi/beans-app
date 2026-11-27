import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  type AdminPayment,
  adminPaymentQuerySchema,
  type CreatePayoutRequest,
  createPayoutRequestSchema,
  type CreateRefundRequest,
  createRefundRequestSchema,
  type DecisionRequest,
  decisionRequestSchema,
  payoutQuerySchema,
  type PayoutView,
  reconciliationQuerySchema,
  type ReconciliationExceptionView,
  type RefundView,
  refundQuerySchema,
  type RunReconciliationRequest,
  runReconciliationRequestSchema,
  uuidSchema,
} from "@beans/contracts";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  Payout,
  PaymentStatus,
  PayoutStatus,
  ReconciliationException,
  Refund,
  RefundStatus,
} from "../generated/prisma/client.js";
import { Idempotent } from "../idempotency/idempotent.interceptor.js";
import { LedgerService } from "./ledger.service.js";
import { PayoutService } from "./payout.service.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { RefundService } from "./refund.service.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));
const decision = new ZodValidationPipe(decisionRequestSchema);

const COMMITTED: RefundStatus[] = ["requested", "approved", "submitted", "succeeded"];

function page<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

const before = (cursor: ReturnType<typeof decodeCursor>) =>
  cursor && {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };

export function toRefund(r: Refund): RefundView {
  return {
    id: r.id,
    paymentId: r.paymentId,
    orderId: r.orderId,
    kind: r.kind,
    status: r.status,
    amountFils: r.amountFils.toString(),
    currency: "AED",
    reason: r.reason,
    requestedBy: r.requestedById,
    decidedBy: r.decidedById,
    decisionReason: r.decisionReason,
    failureCode: r.failureCode,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPayout(p: Payout): PayoutView {
  return {
    id: p.id,
    merchantId: p.merchantId,
    status: p.status,
    amountFils: p.amountFils.toString(),
    currency: "AED",
    periodEnd: p.periodEnd.toISOString(),
    makerId: p.makerId,
    checkerId: p.checkerId,
    decisionReason: p.decisionReason,
    failureCode: p.failureCode,
    createdAt: p.createdAt.toISOString(),
  };
}

function toException(e: ReconciliationException): ReconciliationExceptionView {
  return {
    id: e.id,
    runId: e.runId,
    kind: e.kind as ReconciliationExceptionView["kind"],
    objectType: e.objectType as ReconciliationExceptionView["objectType"],
    localId: e.localId,
    providerRef: e.providerRef,
    merchantId: e.merchantId,
    expected: e.expected as Record<string, unknown>,
    actual: e.actual as Record<string, unknown>,
    status: e.status,
    resolutionReason: e.resolutionReason,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * Admin finance (docs/04 A05). Every route needs a finance role with MFA. Makers request
 * refunds and draft payouts; a different checker approves them (no self approval, and no
 * super_admin bypass on dual-control routes).
 */
@Controller("admin")
export class AdminFinanceController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RefundService) private readonly refunds: RefundService,
    @Inject(PayoutService) private readonly payouts: PayoutService,
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  @Get("payments")
  @RequireAdmin("finance_maker", "finance_checker")
  async payments(
    @Query(new ZodValidationPipe(adminPaymentQuerySchema))
    query: {
      cursor?: string;
      limit: number;
      status?: PaymentStatus;
      from?: string;
      to?: string;
    },
  ): Promise<{ data: AdminPayment[]; meta: { nextCursor: string | null } }> {
    const rows = await this.prisma.payment.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...((query.from || query.to) && {
          createdAt: {
            ...(query.from && { gte: new Date(query.from) }),
            ...(query.to && { lt: new Date(query.to) }),
          },
        }),
        ...before(decodeCursor(query.cursor)),
      },
      include: {
        order: {
          select: {
            publicNumber: true,
            merchantId: true,
            branch: { select: { merchant: { select: { brandName: true } } } },
          },
        },
        refunds: { select: { status: true, amountFils: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return {
      data: items.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        orderNumber: p.order.publicNumber,
        merchantId: p.order.merchantId,
        brandName: p.order.branch.merchant.brandName,
        attempt: p.attempt,
        provider: p.provider,
        providerRef: p.providerRef,
        status: p.status,
        amountFils: p.amountFils.toString(),
        refundCommittedFils: p.refunds
          .filter((r) => COMMITTED.includes(r.status))
          .reduce((s, r) => s + r.amountFils, 0n)
          .toString(),
        refundedFils: p.refunds
          .filter((r) => r.status === "succeeded")
          .reduce((s, r) => s + r.amountFils, 0n)
          .toString(),
        currency: "AED",
        createdAt: p.createdAt.toISOString(),
      })),
      meta: { nextCursor },
    };
  }

  @Get("refunds")
  @RequireAdmin("finance_maker", "finance_checker")
  async listRefunds(
    @Query(new ZodValidationPipe(refundQuerySchema))
    query: {
      cursor?: string;
      limit: number;
      status?: RefundStatus;
    },
  ): Promise<{ data: RefundView[]; meta: { nextCursor: string | null } }> {
    const rows = await this.prisma.refund.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...before(decodeCursor(query.cursor)),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toRefund), meta: { nextCursor } };
  }

  @Post("refunds")
  @Idempotent()
  @RequireAdmin("finance_maker")
  async requestRefund(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createRefundRequestSchema)) body: CreateRefundRequest,
  ): Promise<{ data: RefundView }> {
    const refund = await this.refunds.request(
      { userId: actor.userId, requestId },
      { paymentId: body.paymentId, amountFils: BigInt(body.amountFils), reason: body.reason },
    );
    return { data: toRefund(refund) };
  }

  @Post("refunds/:id/approve")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("finance_checker")
  async approveRefund(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(decision) body: DecisionRequest,
  ): Promise<{ data: RefundView }> {
    const refund = await this.refunds.decide(
      { userId: actor.userId, requestId },
      params.id,
      "approve",
      body.reason,
    );
    return { data: toRefund(refund) };
  }

  @Post("refunds/:id/reject")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("finance_checker")
  async rejectRefund(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(decision) body: DecisionRequest,
  ): Promise<{ data: RefundView }> {
    const refund = await this.refunds.decide(
      { userId: actor.userId, requestId },
      params.id,
      "reject",
      body.reason,
    );
    return { data: toRefund(refund) };
  }

  @Get("payouts")
  @RequireAdmin("finance_maker", "finance_checker")
  async listPayouts(
    @Query(new ZodValidationPipe(payoutQuerySchema))
    query: {
      cursor?: string;
      limit: number;
      merchantId?: string;
      status?: PayoutStatus;
    },
  ): Promise<{ data: PayoutView[]; meta: { nextCursor: string | null } }> {
    const rows = await this.prisma.payout.findMany({
      where: {
        ...(query.merchantId && { merchantId: query.merchantId }),
        ...(query.status && { status: query.status }),
        ...before(decodeCursor(query.cursor)),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toPayout), meta: { nextCursor } };
  }

  @Post("payouts")
  @Idempotent()
  @RequireAdmin("finance_maker")
  async draftPayout(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createPayoutRequestSchema)) body: CreatePayoutRequest,
  ): Promise<{ data: PayoutView }> {
    const payout = await this.payouts.draft(
      { userId: actor.userId, requestId },
      { merchantId: body.merchantId, periodEnd: new Date(body.periodEnd) },
    );
    return { data: toPayout(payout) };
  }

  @Post("payouts/:id/approve")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("finance_checker")
  async approvePayout(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(decision) body: DecisionRequest,
  ): Promise<{ data: PayoutView }> {
    const payout = await this.payouts.decide(
      { userId: actor.userId, requestId },
      params.id,
      "approve",
      body.reason,
    );
    return { data: toPayout(payout) };
  }

  @Post("payouts/:id/reject")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("finance_checker")
  async rejectPayout(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(decision) body: DecisionRequest,
  ): Promise<{ data: PayoutView }> {
    const payout = await this.payouts.decide(
      { userId: actor.userId, requestId },
      params.id,
      "reject",
      body.reason,
    );
    return { data: toPayout(payout) };
  }

  @Get("reconciliation")
  @RequireAdmin("finance_maker", "finance_checker")
  async exceptions(
    @Query(new ZodValidationPipe(reconciliationQuerySchema))
    query: {
      cursor?: string;
      limit: number;
      status?: "open" | "resolved";
      merchantId?: string;
    },
  ): Promise<{ data: ReconciliationExceptionView[]; meta: { nextCursor: string | null } }> {
    const rows = await this.prisma.reconciliationException.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.merchantId && { merchantId: query.merchantId }),
        ...before(decodeCursor(query.cursor)),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toException), meta: { nextCursor } };
  }

  @Post("reconciliation/runs")
  @RequireAdmin("finance_maker", "finance_checker")
  async run(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(runReconciliationRequestSchema)) body: RunReconciliationRequest,
  ) {
    const run = await this.reconciliation.run(
      { userId: actor.userId, requestId },
      { from: new Date(body.from), to: new Date(body.to) },
    );
    return {
      data: {
        id: run.id,
        periodStart: run.periodStart.toISOString(),
        periodEnd: run.periodEnd.toISOString(),
        matched: run.matched,
        mismatched: run.mismatched,
        exceptionIds: run.exceptions.map((e) => e.id),
      },
    };
  }

  @Post("reconciliation/:id/resolve")
  @HttpCode(200)
  @RequireAdmin("finance_checker")
  async resolve(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(decision) body: DecisionRequest,
  ): Promise<{ data: ReconciliationExceptionView }> {
    const resolved = await this.reconciliation.resolve(
      { userId: actor.userId, requestId },
      params.id,
      body.reason,
    );
    return { data: toException(resolved) };
  }

  @Get("ledger/trial-balance")
  @RequireAdmin("finance_maker", "finance_checker")
  async trialBalance() {
    return { data: await this.ledger.trialBalance() };
  }
}
