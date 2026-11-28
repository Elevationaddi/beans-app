import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhookVerificationError } from "./payment-provider.js";
import {
  filsToTapAmount,
  TapApiError,
  tapAmountToFils,
  TapPaymentProvider,
} from "./tap-payment.provider.js";

/** Obviously fake key, assembled at runtime so secret scanners do not flag the test. */
const KEY = ["sk", "test", "notarealkey"].join("_");

type Call = { url: string; init: RequestInit };

function provider(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  const tap = new TapPaymentProvider({
    secretKey: KEY,
    apiUrl: "https://api.example.test/",
    returnUrl: "https://app.example.test/paid",
    fetchImpl,
  });
  return { tap, calls, body: (i: number) => JSON.parse(String(calls[i]!.init.body)) };
}

function signed(body: Record<string, unknown>, amountText: string, created: string) {
  const ref = (body.reference ?? {}) as { gateway?: string; payment?: string };
  const text =
    `x_id${String(body.id)}x_amount${amountText}x_currency${String(body.currency)}` +
    `x_gateway_reference${ref.gateway ?? ""}x_payment_reference${ref.payment ?? ""}` +
    `x_status${String(body.status)}x_created${created}`;
  return createHmac("sha256", KEY).update(text).digest("hex");
}

describe("Tap amounts", () => {
  it("converts integer fils to Tap's decimal amount and back without losing a fils", () => {
    expect(filsToTapAmount(1250n)).toBe(12.5);
    expect(filsToTapAmount(100n)).toBe(1);
    expect(filsToTapAmount(1n)).toBe(0.01);
    for (const fils of [0n, 1n, 99n, 1050n, 123456789n]) {
      expect(tapAmountToFils(filsToTapAmount(fils))).toBe(fils);
    }
    expect(tapAmountToFils("12.50")).toBe(1250n);
    expect(() => tapAmountToFils("12.505")).toThrow(TapApiError);
    expect(() => tapAmountToFils("abc")).toThrow(TapApiError);
  });
});

describe("TapPaymentProvider", () => {
  it("creates a hosted-page charge with our idempotency key and asks the app to redirect", async () => {
    const { tap, calls, body } = provider([
      {
        body: {
          id: "chg_1",
          status: "INITIATED",
          amount: 34,
          currency: "AED",
          transaction: { url: "https://checkout.tap.company/pay/chg_1" },
        },
      },
    ]);
    const payment = await tap.createPayment({
      idempotencyKey: "order:o1:1",
      orderId: "o1",
      amountFils: 3400n,
      currency: "AED",
    });
    expect(payment).toEqual({
      providerRef: "chg_1",
      status: "pending",
      amountFils: 3400n,
      currency: "AED",
      clientAction: { type: "redirect", url: "https://checkout.tap.company/pay/chg_1" },
    });
    expect(calls[0]!.url).toBe("https://api.tap.company/v2/charges");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const sent = body(0);
    expect(sent).toMatchObject({
      amount: 34,
      currency: "AED",
      source: { id: "src_all" },
      reference: { idempotent: "order:o1:1", order: "o1" },
      post: { url: "https://api.example.test/v1/webhooks/payments/tap" },
      redirect: { url: "https://app.example.test/paid" },
    });
    // No personal data or card fields leave the server.
    expect(JSON.stringify(sent)).not.toMatch(/email|phone|cvv|"card"/i);
  });

  it("maps captured and declined charges, and never redirects to a non-https URL", async () => {
    const { tap } = provider([
      { body: { id: "chg_2", status: "CAPTURED", amount: "12.00", currency: "AED" } },
      {
        body: {
          id: "chg_3",
          status: "DECLINED",
          amount: 12,
          currency: "AED",
          response: { code: "507" },
        },
      },
      {
        body: {
          id: "chg_4",
          status: "INITIATED",
          amount: 12,
          currency: "AED",
          transaction: { url: "http://evil.test" },
        },
      },
      { status: 404, body: { errors: [{ code: "1108" }] } },
    ]);
    expect((await tap.fetchPayment("chg_2"))?.status).toBe("captured");
    expect(await tap.fetchPayment("chg_3")).toMatchObject({ status: "failed", failureCode: "507" });
    expect((await tap.fetchPayment("chg_4"))?.clientAction).toEqual({ type: "none" });
    expect(await tap.fetchPayment("chg_missing")).toBeNull();
  });

  it("refunds by charge with a stable key and maps refund states", async () => {
    const { tap, body } = provider([
      {
        body: { id: "re_1", status: "PENDING", amount: 5, currency: "AED", charge_id: "chg_2" },
      },
      {
        body: { id: "re_1", status: "REFUNDED", amount: 5, currency: "AED", charge_id: "chg_2" },
      },
    ]);
    const refund = await tap.refund({
      idempotencyKey: "refund:r1",
      paymentRef: "chg_2",
      amountFils: 500n,
      currency: "AED",
    });
    expect(refund).toMatchObject({ providerRef: "re_1", status: "pending", amountFils: 500n });
    expect(body(0)).toMatchObject({
      charge_id: "chg_2",
      amount: 5,
      reference: { idempotent: "refund:r1" },
    });
    expect((await tap.fetchRefund("re_1"))?.status).toBe("succeeded");
  });

  it("surfaces Tap errors without the key or body, so the attempt stays pending", async () => {
    const { tap } = provider([{ status: 401, body: { errors: [{ code: "2107" }] } }]);
    const error = await tap
      .createPayment({ idempotencyKey: "k", orderId: "o", amountFils: 100n, currency: "AED" })
      .then(
        () => new Error("expected a failure"),
        (e: unknown) => e as Error,
      );
    expect(error).toBeInstanceOf(TapApiError);
    expect(error.message).toContain("401");
    expect(error.message).not.toContain(KEY);
  });

  it("refuses payouts: Tap settles to the merchant's bank", async () => {
    const { tap } = provider([]);
    await expect(
      tap.initiatePayout({ idempotencyKey: "p", merchantId: "m", amountFils: 1n, currency: "AED" }),
    ).rejects.toThrow(/manually/);
  });

  describe("webhooks", () => {
    const charge = {
      id: "chg_9",
      object: "charge",
      status: "CAPTURED",
      amount: 34,
      currency: "AED",
      reference: { gateway: "g1", payment: "p1" },
      transaction: { created: "1764316800000" },
    };

    it("accepts a correctly signed charge and names only the object", () => {
      const { tap } = provider([]);
      const raw = Buffer.from(JSON.stringify(charge));
      const event = tap.verifyWebhook(raw, {
        hashstring: signed(charge, "34.00", "1764316800000"),
      });
      expect(event).toEqual({
        eventId: "chg_9:CAPTURED",
        type: "payment.captured",
        objectType: "payment",
        providerRef: "chg_9",
        createdAt: new Date(1764316800000),
      });
      // Tap's unpadded amount form is accepted too.
      expect(() =>
        tap.verifyWebhook(raw, { hashstring: signed(charge, "34", "1764316800000") }),
      ).not.toThrow();
    });

    it("recognises refunds", () => {
      const { tap } = provider([]);
      const refund = {
        id: "re_9",
        object: "refund",
        status: "REFUNDED",
        amount: 5,
        currency: "AED",
        charge_id: "chg_9",
        created: "1764316900000",
      };
      const event = tap.verifyWebhook(Buffer.from(JSON.stringify(refund)), {
        hashstring: signed(refund, "5.00", "1764316900000"),
      });
      expect(event).toMatchObject({ objectType: "refund", providerRef: "re_9" });
    });

    it("refuses forged, tampered, unsigned and malformed notifications", () => {
      const { tap } = provider([]);
      const good = signed(charge, "34.00", "1764316800000");
      const tampered = Buffer.from(JSON.stringify({ ...charge, amount: 1 }));
      expect(() => tap.verifyWebhook(tampered, { hashstring: good })).toThrow(
        WebhookVerificationError,
      );
      const otherKey = createHmac("sha256", ["sk", "test", "other"].join("_"))
        .update("x")
        .digest("hex");
      expect(() =>
        tap.verifyWebhook(Buffer.from(JSON.stringify(charge)), { hashstring: otherKey }),
      ).toThrow(WebhookVerificationError);
      expect(() => tap.verifyWebhook(Buffer.from(JSON.stringify(charge)), {})).toThrow(
        WebhookVerificationError,
      );
      expect(() => tap.verifyWebhook(Buffer.from("not json"), { hashstring: good })).toThrow(
        WebhookVerificationError,
      );
    });
  });
});
