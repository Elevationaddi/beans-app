import { describe, expect, it } from "vitest";
import { compare } from "./reconciliation.service.js";

const at = new Date("2026-11-27T10:00:00Z");
const local = (providerRef: string, status: string, amountFils = 100n) => ({
  objectType: "payment" as const,
  localId: "00000000-0000-4000-8000-000000000001",
  providerRef,
  status,
  amountFils,
  currency: "AED",
  merchantId: "00000000-0000-4000-8000-0000000000aa",
});
const remote = (providerRef: string, status: string, amountFils = 100n, currency = "AED") => ({
  objectType: "payment" as const,
  providerRef,
  status,
  amountFils,
  currency,
  createdAt: at,
});

describe("reconciliation compare", () => {
  it("matches identical records", () => {
    expect(compare([remote("a", "captured")], [local("a", "captured")])).toEqual([]);
  });

  it("reports each kind of difference", () => {
    const kinds = compare(
      [
        remote("amount", "captured", 99n),
        remote("currency", "captured", 100n, "USD"),
        remote("status", "failed"),
        remote("theirs", "captured"),
        remote("theirs-pending", "pending"),
      ],
      [
        local("amount", "captured"),
        local("currency", "captured"),
        local("status", "captured"),
        local("ours", "captured"),
      ],
    ).map((d) => [d.kind, d.providerRef, d.merchantId !== null]);
    expect(kinds).toEqual([
      ["amount_mismatch", "amount", true],
      ["currency_mismatch", "currency", true],
      ["status_mismatch", "status", true],
      ["missing_locally", "theirs", false],
      ["missing_at_provider", "ours", true],
    ]);
  });

  it("does not flag records still in flight on our side", () => {
    expect(compare([remote("p", "captured")], [local("p", "pending")])).toEqual([]);
  });
});
