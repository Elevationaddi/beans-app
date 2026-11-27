import { describe, expect, it } from "vitest";
import { assertBalanced, commissionFor, splitRefund, UnbalancedPostingError } from "./ledger.js";

describe("ledger rules", () => {
  it("accepts balanced postings only", () => {
    expect(() =>
      assertBalanced([
        { account: "provider_clearing", debitFils: 2200n },
        { account: "customer_order_liability", creditFils: 2200n },
      ]),
    ).not.toThrow();
    for (const lines of [
      [{ account: "provider_clearing" as const, debitFils: 2200n }],
      [
        { account: "provider_clearing" as const, debitFils: 2200n },
        { account: "customer_order_liability" as const, creditFils: 2199n },
      ],
      [
        { account: "provider_clearing" as const, debitFils: 1n, creditFils: 1n },
        { account: "customer_order_liability" as const, creditFils: 0n, debitFils: 0n },
      ],
      [
        { account: "customer_order_liability" as const, debitFils: 5n },
        { account: "merchant_payable" as const, creditFils: 5n },
      ],
    ]) {
      expect(() => assertBalanced(lines)).toThrow(UnbalancedPostingError);
    }
  });

  it("matches the docs/08 example: 10% of AED 22.00 is 220 fils", () => {
    expect(commissionFor(2200n, 1000n)).toBe(220n);
    expect(commissionFor(2205n, 1000n)).toBe(221n); // 220.5 rounds half up
    expect(commissionFor(0n, 1000n)).toBe(0n);
  });

  it("splits refunds of completed orders without losing a fils", () => {
    expect(splitRefund(2200n, { payableFils: 1980n, commissionFils: 220n })).toEqual({
      payableFils: 1980n,
      commissionFils: 220n,
    });
    const part = splitRefund(333n, { payableFils: 1980n, commissionFils: 220n });
    expect(part.payableFils + part.commissionFils).toBe(333n);
    expect(part.commissionFils).toBe(33n);
    expect(() => splitRefund(2201n, { payableFils: 1980n, commissionFils: 220n })).toThrow(
      RangeError,
    );
  });
});
