import { describe, expect, it } from "vitest";
import { FakePaymentProvider } from "./fake-payment.provider.js";
import { WebhookVerificationError } from "./payment-provider.js";

const SECRET = "x".repeat(40);

const input = (key: string, extra: object = {}) => ({
  idempotencyKey: key,
  orderId: "00000000-0000-4000-8000-000000000001",
  amountFils: 2200n,
  currency: "AED" as const,
  ...extra,
});

describe("FakePaymentProvider", () => {
  it("creates one payment per idempotency key", async () => {
    const provider = new FakePaymentProvider(SECRET);
    const first = await provider.createPayment(input("order:a:1"));
    const again = await provider.createPayment(input("order:a:1", { sandboxOutcome: "fail" }));
    expect(again.providerRef).toBe(first.providerRef);
    expect(again.status).toBe("captured");
    expect(provider.chargesCreated).toBe(1);
  });

  it("refuses a reused key with a different amount", async () => {
    const provider = new FakePaymentProvider(SECRET);
    await provider.createPayment(input("order:b:1"));
    await expect(provider.createPayment({ ...input("order:b:1"), amountFils: 1n })).rejects.toThrow(
      /different amount/,
    );
  });

  it("settles a pending payment exactly once", async () => {
    const provider = new FakePaymentProvider(SECRET);
    const pending = await provider.createPayment(input("order:c:1", { sandboxOutcome: "pending" }));
    expect(pending.status).toBe("pending");
    provider.settle(pending.providerRef, "captured");
    expect((await provider.fetchPayment(pending.providerRef))?.status).toBe("captured");
    expect(() => provider.settle(pending.providerRef, "failed")).toThrow(/already captured/);
    expect(await provider.fetchPayment("fake_pay_unknown")).toBeNull();
  });

  it("declines with a reason code and no card data", async () => {
    const provider = new FakePaymentProvider(SECRET);
    const failed = await provider.createPayment(input("order:d:1", { sandboxOutcome: "fail" }));
    expect(failed).toMatchObject({ status: "failed", failureCode: "sandbox_declined" });
  });
});

describe("FakePaymentProvider refunds, payouts and webhooks", () => {
  it("never refunds more than was captured", async () => {
    const provider = new FakePaymentProvider(SECRET);
    const paid = await provider.createPayment(input("order:e:1"));
    const base = { paymentRef: paid.providerRef, currency: "AED" as const };
    await provider.refund({ ...base, idempotencyKey: "refund:1", amountFils: 2000n });
    const again = await provider.refund({ ...base, idempotencyKey: "refund:1", amountFils: 2000n });
    expect(again.status).toBe("succeeded");
    await expect(
      provider.refund({ ...base, idempotencyKey: "refund:2", amountFils: 201n }),
    ).rejects.toThrow(/exceed/);
  });

  it("pays out once per key", async () => {
    const provider = new FakePaymentProvider(SECRET);
    const payout = {
      idempotencyKey: "payout:1",
      merchantId: "m",
      amountFils: 10n,
      currency: "AED" as const,
    };
    const first = await provider.initiatePayout(payout);
    expect((await provider.initiatePayout(payout)).providerRef).toBe(first.providerRef);
  });

  it("verifies signed webhooks and refuses forged, altered or stale ones", () => {
    const provider = new FakePaymentProvider(SECRET);
    const hook = provider.webhook("payment", "payment.captured", "fake_pay_1", {
      eventId: "evt_1",
    });
    const event = provider.verifyWebhook(Buffer.from(hook.body), hook.headers);
    expect(event).toMatchObject({
      eventId: "evt_1",
      objectType: "payment",
      providerRef: "fake_pay_1",
    });

    const altered = hook.body.replace("fake_pay_1", "fake_pay_2");
    expect(() => provider.verifyWebhook(Buffer.from(altered), hook.headers)).toThrow(
      WebhookVerificationError,
    );
    const other = new FakePaymentProvider("y".repeat(40));
    expect(() => other.verifyWebhook(Buffer.from(hook.body), hook.headers)).toThrow(/mismatch/);
    expect(() => provider.verifyWebhook(Buffer.from(hook.body), {})).toThrow(/missing/);
    const stale = provider.webhook("payment", "payment.captured", "fake_pay_1", {
      at: new Date(Date.now() - 301_000),
    });
    expect(() => provider.verifyWebhook(Buffer.from(stale.body), stale.headers)).toThrow(/replay/);
  });
});
