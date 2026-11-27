import { describe, expect, it } from "vitest";
import { divideHalfUp, totalsFor } from "./pricing.js";

describe("sandbox pricing", () => {
  it("matches the docs/08 example: AED 22.00 includes 105 fils VAT", () => {
    expect(totalsFor(2200n)).toEqual({
      currency: "AED",
      subtotalFils: "2200",
      discountFils: "0",
      taxIncludedFils: "105",
      feeFils: "0",
      totalFils: "2200",
    });
  });

  it("rounds half up", () => {
    expect(divideHalfUp(5n, 2n)).toBe(3n);
    expect(divideHalfUp(4n, 3n)).toBe(1n);
    expect(divideHalfUp(0n, 7n)).toBe(0n);
    // 2100 × 5 / 105 = 100 exactly; 21 × 5 / 105 = 1
    expect(totalsFor(2100n).taxIncludedFils).toBe("100");
    expect(totalsFor(21n).taxIncludedFils).toBe("1");
  });

  it("handles large integer amounts without floating point", () => {
    expect(totalsFor(999_999_999_999n).totalFils).toBe("999999999999");
  });

  it("refuses negative values", () => {
    expect(() => divideHalfUp(-1n, 2n)).toThrow(RangeError);
  });
});
