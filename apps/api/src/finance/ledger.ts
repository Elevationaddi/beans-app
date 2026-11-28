/** Chart of accounts (docs/08). Tax accounts are added once D06 is approved. */
export const ACCOUNTS = [
  "provider_clearing",
  "customer_order_liability",
  "merchant_payable",
  "platform_commission_revenue",
  "refund_liability",
  "processor_fee_expense",
  "payout_clearing",
] as const;
export type AccountCode = (typeof ACCOUNTS)[number];

export interface PostingLine {
  account: AccountCode;
  merchantId?: string;
  debitFils?: bigint;
  creditFils?: bigint;
}

export class UnbalancedPostingError extends Error {}

/** Debits must equal credits, each line has exactly one positive side, two lines at least. */
export function assertBalanced(lines: PostingLine[]): void {
  if (lines.length < 2) throw new UnbalancedPostingError("a posting needs at least two lines");
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    const debit = line.debitFils ?? 0n;
    const credit = line.creditFils ?? 0n;
    if (debit < 0n || credit < 0n || debit > 0n === credit > 0n) {
      throw new UnbalancedPostingError("each line needs exactly one positive side");
    }
    if (line.account === "merchant_payable" && !line.merchantId) {
      throw new UnbalancedPostingError("merchant_payable lines need a merchant");
    }
    debits += debit;
    credits += credit;
  }
  if (debits !== credits) {
    throw new UnbalancedPostingError(`debits ${debits} do not equal credits ${credits}`);
  }
}

/** round(numerator / denominator) half up, for non-negative integers. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * The amount commission is charged on. Founder decision D02 (sandbox default, 2026-11-28): net
 * merchandise value excluding VAT and refunded amounts. Prices are tax-inclusive, so the VAT
 * inside the kept amount is taken in proportion to the order's VAT, rounded half up.
 */
export function commissionBase(
  keptFils: bigint,
  order: { totalFils: bigint; taxIncludedFils: bigint },
  basis: "gross_of_vat" | "net_of_vat",
): bigint {
  if (keptFils < 0n || order.totalFils < 0n || order.taxIncludedFils < 0n) {
    throw new RangeError("invalid commission base inputs");
  }
  if (basis === "gross_of_vat" || order.totalFils === 0n || order.taxIncludedFils === 0n) {
    return keptFils;
  }
  const vat = divideHalfUp(keptFils * order.taxIncludedFils, order.totalFils);
  return keptFils - (vat > keptFils ? keptFils : vat);
}

/** Commission on an order total at a rate in basis points, rounded half up. */
export function commissionFor(totalFils: bigint, rateBasisPoints: bigint): bigint {
  if (totalFils < 0n || rateBasisPoints < 0n || rateBasisPoints > 10_000n) {
    throw new RangeError("invalid commission inputs");
  }
  return divideHalfUp(totalFils * rateBasisPoints, 10_000n);
}

/**
 * Splits a refund of a completed order between merchant payable and commission in the same
 * proportion as the completion posting; the residual fils go to the payable so the two parts
 * always add up to the refund (docs/08: deterministic residual).
 */
export function splitRefund(
  refundFils: bigint,
  completed: { payableFils: bigint; commissionFils: bigint },
): { payableFils: bigint; commissionFils: bigint } {
  const total = completed.payableFils + completed.commissionFils;
  if (refundFils <= 0n || refundFils > total)
    throw new RangeError("refund outside the order total");
  const commissionFils = divideHalfUp(refundFils * completed.commissionFils, total);
  return { payableFils: refundFils - commissionFils, commissionFils };
}
