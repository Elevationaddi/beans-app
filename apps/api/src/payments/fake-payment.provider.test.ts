import { describe, expect, it } from "vitest";
import { FakePaymentProvider } from "./fake-payment.provider.js";

const input = (key: string, extra: object = {}) => ({
  idempotencyKey: key,
  orderId: "00000000-0000-4000-8000-000000000001",
  amountFils: 2200n,
  currency: "AED" as const,
  ...extra,
});

describe("FakePaymentProvider", () => {
  it("creates one payment per idempotency key", async () => {
    const provider = new FakePaymentProvider();
    const first = await provider.createPayment(input("order:a:1"));
    const again = await provider.createPayment(input("order:a:1", { sandboxOutcome: "fail" }));
    expect(again.providerRef).toBe(first.providerRef);
    expect(again.status).toBe("captured");
    expect(provider.chargesCreated).toBe(1);
  });

  it("refuses a reused key with a different amount", async () => {
    const provider = new FakePaymentProvider();
    await provider.createPayment(input("order:b:1"));
    await expect(provider.createPayment({ ...input("order:b:1"), amountFils: 1n })).rejects.toThrow(
      /different amount/,
    );
  });

  it("settles a pending payment exactly once", async () => {
    const provider = new FakePaymentProvider();
    const pending = await provider.createPayment(input("order:c:1", { sandboxOutcome: "pending" }));
    expect(pending.status).toBe("pending");
    provider.settle(pending.providerRef, "captured");
    expect((await provider.fetchPayment(pending.providerRef))?.status).toBe("captured");
    expect(() => provider.settle(pending.providerRef, "failed")).toThrow(/already captured/);
    expect(await provider.fetchPayment("fake_unknown")).toBeNull();
  });

  it("declines with a reason code and no card data", async () => {
    const provider = new FakePaymentProvider();
    const failed = await provider.createPayment(input("order:d:1", { sandboxOutcome: "fail" }));
    expect(failed).toMatchObject({ status: "failed", failureCode: "sandbox_declined" });
  });
});
