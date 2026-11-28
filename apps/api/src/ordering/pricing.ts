import type { Totals } from "@beans/contracts";

/**
 * SANDBOX pricing policy. Not approved: decision D06 (tax) and the customer fee are open.
 * docs/08 sandbox rules: prices are tax-inclusive with a sample 5% VAT, no customer fee, no
 * platform-funded discount. Real values come from an approved, effective-dated policy.
 */
export const SANDBOX_PRICING_POLICY = {
  version: "sandbox-v1",
  /** Included VAT rate in basis points (500 = 5%). */
  vatBasisPoints: 500n,
  customerFeeFils: 0n,
} as const;

/** round(numerator / denominator) half up, for non-negative integers. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError("non-negative values only");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Order totals from the sum of line totals (docs/08). A merchant-funded discount (phase 9
 * reward, promo code or gift) comes off before tax; the tax component is
 * round(net × rate / (1 + rate)) and is included, never added. Not a legal tax calculation.
 */
export function totalsFor(
  subtotalFils: bigint,
  discountFils = 0n,
  policy = SANDBOX_PRICING_POLICY,
): Totals {
  if (discountFils < 0n || discountFils > subtotalFils) {
    throw new RangeError("discount must be between zero and the subtotal");
  }
  const discounted = subtotalFils - discountFils;
  const taxIncludedFils = divideHalfUp(
    discounted * policy.vatBasisPoints,
    10_000n + policy.vatBasisPoints,
  );
  const totalFils = discounted + policy.customerFeeFils;
  return {
    currency: "AED",
    subtotalFils: subtotalFils.toString(),
    discountFils: discountFils.toString(),
    taxIncludedFils: taxIncludedFils.toString(),
    feeFils: policy.customerFeeFils.toString(),
    totalFils: totalFils.toString(),
  };
}
