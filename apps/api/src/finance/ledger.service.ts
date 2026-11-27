import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { assertBalanced, commissionFor, type PostingLine, splitRefund } from "./ledger.js";

export interface Posting {
  sourceType: "payment" | "refund" | "order" | "payout";
  sourceId: string;
  eventType: string;
  lines: PostingLine[];
}

/**
 * Append-only, balanced journal (docs/08). Each business event posts at most once: the
 * (source type, source id, event type) key is unique, so a retried webhook or sweep cannot
 * post twice. Balance is checked here and again by a deferred database trigger at commit.
 * The accounting treatment is a sandbox model pending accountant and provider validation.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Posts inside the caller's transaction. Returns false when it was already posted. */
  async post(tx: Prisma.TransactionClient, posting: Posting): Promise<boolean> {
    assertBalanced(posting.lines);
    const created = await tx.journalTransaction.createManyAndReturn({
      data: [
        {
          sourceType: posting.sourceType,
          sourceId: posting.sourceId,
          eventType: posting.eventType,
        },
      ],
      skipDuplicates: true,
    });
    const journal = created[0];
    if (!journal) return false;
    await tx.journalLine.createMany({
      data: posting.lines.map((l) => ({
        journalId: journal.id,
        accountCode: l.account,
        merchantId: l.merchantId ?? null,
        debitFils: l.debitFils ?? 0n,
        creditFils: l.creditFils ?? 0n,
      })),
    });
    return true;
  }

  /** Capture: Dr provider_clearing / Cr customer_order_liability. */
  postCapture(tx: Prisma.TransactionClient, payment: { id: string; amountFils: bigint }) {
    return this.post(tx, {
      sourceType: "payment",
      sourceId: payment.id,
      eventType: "captured",
      lines: [
        { account: "provider_clearing", debitFils: payment.amountFils },
        { account: "customer_order_liability", creditFils: payment.amountFils },
      ],
    });
  }

  /**
   * Completion (called by order completion in phase 8): moves what the customer paid, less
   * refunds already made, from the order liability to the merchant and the commission at the
   * effective commission policy. Sandbox policy until D02 is approved.
   */
  async postCompletion(tx: Prisma.TransactionClient, orderId: string, at = new Date()) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        payments: { where: { status: "captured" } },
        refunds: { where: { status: "succeeded" } },
      },
    });
    const captured = order.payments.reduce((sum, p) => sum + p.amountFils, 0n);
    const refunded = order.refunds.reduce((sum, r) => sum + r.amountFils, 0n);
    const net = captured - refunded;
    if (net <= 0n) return false;
    const policy = await tx.policy.findFirst({
      where: { type: "commission", effectiveAt: { lte: at } },
      orderBy: { effectiveAt: "desc" },
    });
    const rate = (policy?.configuration as { rateBasisPoints?: unknown } | undefined)
      ?.rateBasisPoints;
    if (!policy || typeof rate !== "number" || !Number.isInteger(rate)) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "SERVICE_UNAVAILABLE",
        "No effective commission policy; completion cannot be posted",
      );
    }
    const commission = commissionFor(net, BigInt(rate));
    const lines: PostingLine[] = [
      { account: "customer_order_liability", debitFils: net },
      { account: "merchant_payable", merchantId: order.merchantId, creditFils: net - commission },
    ];
    if (commission > 0n)
      lines.push({ account: "platform_commission_revenue", creditFils: commission });
    if (net - commission === 0n) lines.splice(1, 1);
    return this.post(tx, {
      sourceType: "order",
      sourceId: order.id,
      eventType: "completed",
      lines,
    });
  }

  /**
   * Confirmed refund. Before completion it reverses the order liability; after completion it
   * reverses merchant payable and commission in proportion (docs/08).
   */
  async postRefund(
    tx: Prisma.TransactionClient,
    refund: { id: string; orderId: string; amountFils: bigint },
  ) {
    const completion = await tx.journalTransaction.findUnique({
      where: {
        sourceType_sourceId_eventType: {
          sourceType: "order",
          sourceId: refund.orderId,
          eventType: "completed",
        },
      },
      include: { lines: true },
    });
    let lines: PostingLine[];
    if (!completion) {
      lines = [
        { account: "customer_order_liability", debitFils: refund.amountFils },
        { account: "provider_clearing", creditFils: refund.amountFils },
      ];
    } else {
      const payableLine = completion.lines.find((l) => l.accountCode === "merchant_payable");
      const payable = payableLine?.creditFils ?? 0n;
      const commission = completion.lines
        .filter((l) => l.accountCode === "platform_commission_revenue")
        .reduce((sum, l) => sum + l.creditFils, 0n);
      const part = splitRefund(refund.amountFils, {
        payableFils: payable,
        commissionFils: commission,
      });
      lines = [{ account: "provider_clearing", creditFils: refund.amountFils }];
      if (part.payableFils > 0n && payableLine?.merchantId) {
        lines.push({
          account: "merchant_payable",
          merchantId: payableLine.merchantId,
          debitFils: part.payableFils,
        });
      }
      if (part.commissionFils > 0n) {
        lines.push({ account: "platform_commission_revenue", debitFils: part.commissionFils });
      }
    }
    return this.post(tx, {
      sourceType: "refund",
      sourceId: refund.id,
      eventType: "succeeded",
      lines,
    });
  }

  /** Confirmed payout: Dr merchant_payable / Cr provider_clearing. */
  postPayout(
    tx: Prisma.TransactionClient,
    payout: { id: string; merchantId: string; amountFils: bigint },
  ) {
    return this.post(tx, {
      sourceType: "payout",
      sourceId: payout.id,
      eventType: "paid",
      lines: [
        {
          account: "merchant_payable",
          merchantId: payout.merchantId,
          debitFils: payout.amountFils,
        },
        { account: "provider_clearing", creditFils: payout.amountFils },
      ],
    });
  }

  /** Totals per account and whether the whole journal balances (trial balance, Q23). */
  async trialBalance() {
    const rows = await this.prisma.$queryRaw<
      { account_code: string; debits: bigint; credits: bigint }[]
    >`SELECT account_code, COALESCE(SUM(debit_fils), 0)::bigint AS debits,
             COALESCE(SUM(credit_fils), 0)::bigint AS credits
      FROM journal_lines GROUP BY account_code ORDER BY account_code`;
    const [unbalanced] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT journal_id FROM journal_lines GROUP BY journal_id
        HAVING SUM(debit_fils) <> SUM(credit_fils)) t`;
    const debits = rows.reduce((s, r) => s + r.debits, 0n);
    const credits = rows.reduce((s, r) => s + r.credits, 0n);
    return {
      accounts: rows.map((r) => ({
        account: r.account_code,
        debitFils: r.debits.toString(),
        creditFils: r.credits.toString(),
      })),
      totalDebitFils: debits.toString(),
      totalCreditFils: credits.toString(),
      unbalancedJournals: Number(unbalanced?.count ?? 0n),
      balanced: debits === credits && (unbalanced?.count ?? 0n) === 0n,
    };
  }
}
