import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, ReconciliationRun } from "../generated/prisma/client.js";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type StatementEntry,
} from "../payments/payment-provider.js";

interface LocalEntry {
  objectType: StatementEntry["objectType"];
  localId: string;
  providerRef: string;
  status: string;
  amountFils: bigint;
  currency: string;
  merchantId: string;
}

interface Difference {
  kind:
    | "missing_at_provider"
    | "missing_locally"
    | "amount_mismatch"
    | "currency_mismatch"
    | "status_mismatch";
  objectType: StatementEntry["objectType"];
  localId: string | null;
  providerRef: string;
  merchantId: string | null;
  expected: Prisma.InputJsonObject;
  actual: Prisma.InputJsonObject;
}

/** Our final statuses and what the provider reports for the same state. */
const PROVIDER_STATUS: Record<string, string> = {
  captured: "captured",
  failed: "failed",
  succeeded: "succeeded",
  paid: "paid",
};

const view = (e: { status: string; amountFils: bigint; currency: string }) => ({
  status: e.status,
  amountFils: e.amountFils.toString(),
  currency: e.currency,
});

/**
 * Daily reconciliation (docs/08): compares amount, currency, provider reference and status of
 * every payment, refund and payout the provider recorded in a period with our records. Each
 * difference becomes an open exception; open exceptions block payouts for that merchant (or
 * all payouts when the merchant is unknown) until a finance checker resolves them with a reason.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async run(
    actor: { userId: string; requestId: string } | null,
    period: { from: Date; to: Date },
  ): Promise<ReconciliationRun & { exceptions: { id: string }[] }> {
    if (period.from >= period.to) throw ApiError.validation({ to: ["Must be after from"] });
    const statement = await this.provider.statement(period.from, period.to);
    const refs = statement.map((s) => s.providerRef);
    const local = await this.localEntries(refs, period);
    const differences = compare(statement, local);

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.reconciliationRun.create({
        data: {
          periodStart: period.from,
          periodEnd: period.to,
          startedById: actor?.userId ?? null,
          matched:
            statement.length - differences.filter((d) => d.kind !== "missing_at_provider").length,
          mismatched: differences.length,
        },
      });
      if (differences.length > 0) {
        await tx.reconciliationException.createMany({
          data: differences.map((d) => ({ runId: run.id, ...d })),
        });
      }
      if (actor) {
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "reconciliation.run",
            targetType: "reconciliation_run",
            targetId: run.id,
            requestId: actor.requestId,
            after: { mismatched: differences.length },
          },
          tx,
        );
      }
      const exceptions = await tx.reconciliationException.findMany({
        where: { runId: run.id },
        select: { id: true },
      });
      return { ...run, exceptions };
    });
  }

  async resolve(actor: { userId: string; requestId: string }, exceptionId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.reconciliationException.findUnique({ where: { id: exceptionId } });
      if (!current) throw ApiError.notFound("Exception not found");
      if (current.status !== "open") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRANSITION", "Already resolved");
      }
      const updated = await tx.reconciliationException.update({
        where: { id: exceptionId },
        data: {
          status: "resolved",
          resolvedById: actor.userId,
          resolutionReason: reason,
          resolvedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "reconciliation.exception_resolved",
          targetType: "reconciliation_exception",
          targetId: exceptionId,
          requestId: actor.requestId,
          reason,
        },
        tx,
      );
      return updated;
    });
  }

  /** Our final records with a provider reference, matched by reference or created in the period. */
  private async localEntries(
    refs: string[],
    period: { from: Date; to: Date },
  ): Promise<LocalEntry[]> {
    const inPeriod = { gte: period.from, lt: period.to };
    const [payments, refunds, payouts] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          providerRef: { not: null },
          OR: [{ providerRef: { in: refs } }, { status: "captured", createdAt: inPeriod }],
        },
        include: { order: { select: { merchantId: true } } },
      }),
      this.prisma.refund.findMany({
        where: {
          providerRef: { not: null },
          OR: [{ providerRef: { in: refs } }, { status: "succeeded", createdAt: inPeriod }],
        },
        include: { order: { select: { merchantId: true } } },
      }),
      this.prisma.payout.findMany({
        where: {
          providerRef: { not: null },
          OR: [{ providerRef: { in: refs } }, { status: "paid", createdAt: inPeriod }],
        },
      }),
    ]);
    return [
      ...payments.map((p) => ({
        objectType: "payment" as const,
        localId: p.id,
        providerRef: p.providerRef ?? "",
        status: p.status,
        amountFils: p.amountFils,
        currency: p.currency,
        merchantId: p.order.merchantId,
      })),
      ...refunds.map((r) => ({
        objectType: "refund" as const,
        localId: r.id,
        providerRef: r.providerRef ?? "",
        status: r.status,
        amountFils: r.amountFils,
        currency: r.currency,
        merchantId: r.order.merchantId,
      })),
      ...payouts.map((p) => ({
        objectType: "payout" as const,
        localId: p.id,
        providerRef: p.providerRef ?? "",
        status: p.status,
        amountFils: p.amountFils,
        currency: p.currency,
        merchantId: p.merchantId,
      })),
    ];
  }
}

/** Pure comparison of a provider statement with our records. */
export function compare(statement: StatementEntry[], local: LocalEntry[]): Difference[] {
  const differences: Difference[] = [];
  const byRef = new Map(local.map((l) => [l.providerRef, l]));
  const seen = new Set<string>();
  for (const entry of statement) {
    const mine = byRef.get(entry.providerRef);
    seen.add(entry.providerRef);
    if (!mine) {
      // Pending or failed provider records with no local counterpart move no money.
      if (entry.status === "pending" || entry.status === "failed") continue;
      differences.push({
        kind: "missing_locally",
        objectType: entry.objectType,
        localId: null,
        providerRef: entry.providerRef,
        merchantId: null,
        expected: {},
        actual: view(entry),
      });
      continue;
    }
    const base = {
      objectType: entry.objectType,
      localId: mine.localId,
      providerRef: entry.providerRef,
      merchantId: mine.merchantId,
      expected: view(mine),
      actual: view(entry),
    };
    if (mine.currency !== entry.currency) differences.push({ kind: "currency_mismatch", ...base });
    else if (mine.amountFils !== entry.amountFils)
      differences.push({ kind: "amount_mismatch", ...base });
    else if ((PROVIDER_STATUS[mine.status] ?? mine.status) !== entry.status) {
      // A record still in flight on our side (pending, submitted) is not yet a difference.
      if (!["pending", "approved", "submitted"].includes(mine.status)) {
        differences.push({ kind: "status_mismatch", ...base });
      }
    }
  }
  for (const mine of local) {
    if (seen.has(mine.providerRef)) continue;
    if (!["captured", "succeeded", "paid"].includes(mine.status)) continue;
    differences.push({
      kind: "missing_at_provider",
      objectType: mine.objectType,
      localId: mine.localId,
      providerRef: mine.providerRef,
      merchantId: mine.merchantId,
      expected: view(mine),
      actual: {},
    });
  }
  return differences;
}
