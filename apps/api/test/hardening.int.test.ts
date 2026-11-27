import { randomUUID } from "node:crypto";
import {
  cartRequiredResponseSchema,
  checkoutResponseSchema,
  errorResponseSchema,
  publicSlotsResponseSchema,
  quoteResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakePaymentProvider } from "../src/payments/fake-payment.provider.js";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";
import { createShop, type Shop } from "./order-flow.js";

describe("phase 11: hardening", () => {
  let world: MerchantWorld;
  let shop: Shop;
  const http = () => request(world.app.getHttpServer());
  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

  beforeAll(async () => {
    world = await MerchantWorld.create({ RATE_LIMIT_ENABLED: "true" });
    shop = await createShop(world);
  });
  afterAll(() => world.close());

  /** A customer with a quote for `quantity` units, ready to check out. */
  async function quoted(quantity = 1) {
    const person = await world.person();
    const cart = cartRequiredResponseSchema.parse(
      (await world.put("/v1/cart", person.token, { branchId: shop.branch.id }).expect(200)).body,
    ).data;
    const filled = cartRequiredResponseSchema.parse(
      (
        await world
          .post("/v1/cart/items", person.token, {
            productId: shop.product.id,
            quantity,
            expectedVersion: cart.version,
          })
          .expect(201)
      ).body,
    ).data;
    const slots = publicSlotsResponseSchema.parse(
      (await http().get(`/v1/branches/${shop.branch.id}/slots?date=${dubaiDate(1)}&mode=in_store`))
        .body,
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
    return { person, quote };
  }

  const checkout = (token: string, quoteId: string, key = randomUUID()) =>
    http()
      .post("/v1/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ quoteId, sandboxOutcome: "succeed" });

  it("sends security headers on every response", async () => {
    for (const res of [await http().get("/health/live"), await http().get("/v1/me")]) {
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    }
  });

  it("rate limits sensitive routes per user, with Retry-After", async () => {
    const a = await world.person();
    const b = await world.person();
    for (let i = 0; i < 5; i += 1) {
      await world.post("/v1/me/privacy-requests", a.token, { kind: "access" }).expect(201);
    }
    const limited = await world
      .post("/v1/me/privacy-requests", a.token, { kind: "access" })
      .expect(429);
    expect(errorOf(limited.body).code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // Another person is not affected.
    await world.post("/v1/me/privacy-requests", b.token, { kind: "access" }).expect(201);
  });

  it("sells the last units exactly once under a burst of checkouts (Q04 at scale)", async () => {
    await world.prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId: shop.branch.id, productId: shop.product.id } },
      create: {
        branchId: shop.branch.id,
        productId: shop.product.id,
        merchantId: shop.merchant.id,
        stockOnHand: 5,
      },
      update: { stockOnHand: 5, stockReserved: 0 },
    });
    const buyers = await Promise.all(Array.from({ length: 12 }, () => quoted(1)));
    const results = await Promise.all(buyers.map((b) => checkout(b.person.token, b.quote.id)));
    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status !== 201);
    expect(won).toHaveLength(5);
    expect(lost.every((r) => r.status === 409 && errorOf(r.body).code === "OUT_OF_STOCK")).toBe(
      true,
    );
    const stock = await world.prisma.branchProduct.findFirstOrThrow({
      where: { branchId: shop.branch.id, productId: shop.product.id },
    });
    expect(stock.stockReserved).toBe(5);
    expect(stock.stockReserved).toBeLessThanOrEqual(stock.stockOnHand ?? 0);
    await world.prisma.branchProduct.update({
      where: { id: stock.id },
      data: { stockOnHand: null, stockReserved: 0 },
    });
  });

  it("survives a provider outage at checkout without charging twice (Q22)", async () => {
    const provider = world.app.get(FakePaymentProvider);
    const { person, quote } = await quoted(1);
    const spy = vi
      .spyOn(provider, "createPayment")
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const first = checkoutResponseSchema.parse(
      (await checkout(person.token, quote.id).expect(201)).body,
    ).data;
    expect(first.status).toBe("pending_payment");
    expect(first.payment.status).toBe("pending");
    // The provider is back: the customer retries; the same attempt and key are used.
    const retry = checkoutResponseSchema.parse(
      (await checkout(person.token, quote.id).expect(201)).body,
    ).data;
    spy.mockRestore();
    expect(retry.orderId).toBe(first.orderId);
    expect(retry.status).toBe("received");
    const payments = await world.prisma.payment.findMany({ where: { orderId: first.orderId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe("captured");
  });
});
