import { createHmac, randomUUID } from "node:crypto";
import {
  cartRequiredResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
  publicSlotsResponseSchema,
  quoteResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider.js";
import { TapPaymentProvider } from "../src/payments/tap-payment.provider.js";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";
import { createShop, type Shop } from "./order-flow.js";

/** Obviously fake key, assembled at runtime so secret scanners do not flag the test. */
const KEY = ["sk", "test", "integration"].join("_");

/**
 * A stand-in for Tap's API (no network): charges start INITIATED with a hosted-page URL and
 * become CAPTURED or DECLINED when the "customer" finishes on that page.
 */
class FakeTapServer {
  charges = new Map<string, Record<string, unknown>>();
  byKey = new Map<string, string>();
  creates = 0;

  fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace("/v2", "");
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if ((init.headers as Record<string, string>).authorization !== `Bearer ${KEY}`) {
      return json({ errors: [{ code: "2107" }] }, 401);
    }
    if (init.method === "POST" && path === "/charges") {
      const body = JSON.parse(String(init.body)) as {
        amount: number;
        currency: string;
        reference: { idempotent: string };
      };
      const existing = this.byKey.get(body.reference.idempotent);
      if (existing) return json(this.charges.get(existing));
      this.creates += 1;
      const id = `chg_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const charge = {
        id,
        object: "charge",
        status: "INITIATED",
        amount: body.amount,
        currency: body.currency,
        reference: { gateway: "", payment: `p_${id}`, idempotent: body.reference.idempotent },
        transaction: { url: `https://checkout.tap.company/pay/${id}`, created: String(Date.now()) },
      };
      this.charges.set(id, charge);
      this.byKey.set(body.reference.idempotent, id);
      return json(charge);
    }
    const match = /^\/charges\/(chg_\w+)$/.exec(path);
    if (init.method === "GET" && match) {
      const charge = this.charges.get(match[1]!);
      return charge ? json(charge) : json({ errors: [{ code: "1108" }] }, 404);
    }
    return json({ errors: [{ code: "404" }] }, 404);
  }) as unknown as typeof fetch;

  finish(id: string, status: "CAPTURED" | "DECLINED") {
    const charge = this.charges.get(id)!;
    charge.status = status;
    return charge;
  }
}

function hashFor(charge: Record<string, unknown>) {
  const ref = charge.reference as { gateway: string; payment: string };
  const tx = charge.transaction as { created: string };
  const text =
    `x_id${String(charge.id)}x_amount${Number(charge.amount).toFixed(2)}` +
    `x_currency${String(charge.currency)}x_gateway_reference${ref.gateway}` +
    `x_payment_reference${ref.payment}x_status${String(charge.status)}x_created${tx.created}`;
  return createHmac("sha256", KEY).update(text).digest("hex");
}

describe("Tap sandbox adapter through checkout and webhooks (D03)", () => {
  let world: MerchantWorld;
  let shop: Shop;
  const tap = new FakeTapServer();
  const http = () => request(world.app.getHttpServer());

  beforeAll(async () => {
    world = await MerchantWorld.create({}, [
      {
        provide: PAYMENT_PROVIDER,
        useValue: new TapPaymentProvider({
          secretKey: KEY,
          apiUrl: "https://api.example.test",
          returnUrl: "https://app.example.test/paid",
          fetchImpl: tap.fetch,
        }),
      },
    ]);
    shop = await createShop(world);
  });
  afterAll(() => world.close());

  async function checkout() {
    const person = await world.person();
    const cart = cartRequiredResponseSchema.parse(
      (await world.put("/v1/cart", person.token, { branchId: shop.branch.id }).expect(200)).body,
    ).data;
    const filled = cartRequiredResponseSchema.parse(
      (
        await world
          .post("/v1/cart/items", person.token, {
            productId: shop.product.id,
            quantity: 2,
            expectedVersion: cart.version,
          })
          .expect(201)
      ).body,
    ).data;
    const slots = publicSlotsResponseSchema.parse(
      (
        await http()
          .get(`/v1/branches/${shop.branch.id}/slots?date=${dubaiDate(1)}&mode=in_store`)
          .expect(200)
      ).body,
    ).data.slots;
    const quote = quoteResponseSchema.parse(
      (
        await world
          .post("/v1/quotes", person.token, {
            cartId: filled.id,
            cartVersion: filled.version,
            mode: "in_store",
            slotId: slots[0]?.id,
          })
          .expect(201)
      ).body,
    ).data;
    const key = randomUUID();
    const send = () =>
      http()
        .post("/v1/checkout")
        .set("Authorization", `Bearer ${person.token}`)
        .set("Idempotency-Key", key)
        .send({ quoteId: quote.id });
    const result = checkoutResponseSchema.parse((await send().expect(201)).body).data;
    return { person, result, send };
  }

  const webhook = (charge: Record<string, unknown>, hash = hashFor(charge)) =>
    http()
      .post("/v1/webhooks/payments/tap")
      .set("hashstring", hash)
      .set("content-type", "application/json")
      .send(JSON.stringify(charge));

  it("sends the customer to Tap's page, then a signed webhook confirms the order", async () => {
    const { person, result, send } = await checkout();
    expect(result.status).toBe("pending_payment");
    expect(result.payment.status).toBe("pending");
    expect(result.payment.clientAction).toMatchObject({
      type: "redirect",
      url: expect.stringMatching(/^https:\/\/checkout\.tap\.company\/pay\/chg_/),
    });
    // Repeating checkout never creates a second charge.
    const before = tap.creates;
    await send().expect(201);
    expect(tap.creates).toBe(before);

    const payment = await world.prisma.payment.findFirstOrThrow({
      where: { orderId: result.orderId },
    });
    expect(payment.provider).toBe("tap");
    const charge = tap.finish(payment.providerRef!, "CAPTURED");

    // A forged notification is refused and changes nothing.
    await webhook(charge, "0".repeat(64)).expect(401);
    await webhook(charge).expect(200);
    const order = orderResponseSchema.parse(
      (await world.get(`/v1/orders/${result.orderId}`, person.token).expect(200)).body,
    ).data;
    expect(order.status).toBe("received");
    // Tap retries notifications: a duplicate is acknowledged and does nothing more.
    const dup = await webhook(charge).expect(200);
    expect(dup.body.data.duplicate).toBe(true);
    expect(
      await world.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    ).toMatchObject({ status: "captured", amountFils: 2400n });
  });

  it("marks a declined charge failed so the customer can try again", async () => {
    const { result } = await checkout();
    const payment = await world.prisma.payment.findFirstOrThrow({
      where: { orderId: result.orderId },
    });
    await webhook(tap.finish(payment.providerRef!, "DECLINED")).expect(200);
    const after = await world.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("failed");
    const order = await world.prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(order.status).toBe("pending_payment");
  });
});
