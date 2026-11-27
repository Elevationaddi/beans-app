import { randomUUID } from "node:crypto";
import {
  cartRequiredResponseSchema,
  checkoutResponseSchema,
  merchantOrderResponseSchema,
  orderResponseSchema,
  publicSlotsResponseSchema,
  quoteResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { dubaiDate, type MerchantWorld } from "./merchant-world.js";

const allWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  opens: new Date("1970-01-01T00:00:00Z"),
  closes: new Date("1970-01-01T23:59:00Z"),
}));

/** An approved merchant with one open branch (in Abu Dhabi unless told otherwise) and a 12 AED product. */
export async function createShop(world: MerchantWorld, city = "abu_dhabi") {
  const merchant = await world.prisma.merchant.create({
    data: {
      legalName: "Flow LLC",
      brandName: `Flow ${randomUUID().slice(0, 6)}`,
      licenseNumber: `FLW-${randomUUID().slice(0, 12)}`,
      status: "approved",
    },
  });
  const branch = await world.prisma.branch.create({
    data: {
      merchantId: merchant.id,
      nameEn: "Flow Branch",
      address: "1 Flow Street",
      city,
      modes: ["in_store"],
      capacity: 100,
      status: "active",
      hours: { create: allWeek },
    },
  });
  const category = await world.prisma.category.create({
    data: { merchantId: merchant.id, nameEn: "Bakery" },
  });
  const product = await world.prisma.product.create({
    data: {
      merchantId: merchant.id,
      categoryId: category.id,
      names: { en: "Flow Croissant" },
      baseFils: 1200n,
      status: "published",
    },
  });
  return { merchant, branch, product };
}

export type Shop = Awaited<ReturnType<typeof createShop>>;

/** A customer order paid through the sandbox provider; the order is `received`. */
export async function paidOrder(world: MerchantWorld, shop: Shop, quantity = 1) {
  const http = () => request(world.app.getHttpServer());
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
  const result = checkoutResponseSchema.parse(
    (
      await http()
        .post("/v1/checkout")
        .set("Authorization", `Bearer ${person.token}`)
        .set("Idempotency-Key", randomUUID())
        .send({ quoteId: quote.id, sandboxOutcome: "succeed" })
        .expect(201)
    ).body,
  ).data;
  return { person, orderId: result.orderId, version: result.version };
}

/** Accept, start, ready and hand over with the customer's code, as a barista would. */
export async function completeOrder(
  world: MerchantWorld,
  order: { person: { token: string }; orderId: string; version: number },
  staffToken: string,
) {
  const http = () => request(world.app.getHttpServer());
  const code = orderResponseSchema.parse(
    (await world.get(`/v1/orders/${order.orderId}`, order.person.token).expect(200)).body,
  ).data.pickupCode;
  let version = order.version;
  const steps: object[] = [
    { action: "accept", etaMinutes: 5 },
    { action: "start" },
    { action: "ready" },
    { action: "complete", pickupCode: code },
  ];
  for (const step of steps) {
    version = merchantOrderResponseSchema.parse(
      (
        await http()
          .post(`/v1/merchant/orders/${order.orderId}/transition`)
          .set("Authorization", `Bearer ${staffToken}`)
          .set("Idempotency-Key", randomUUID())
          .send({ ...step, expectedVersion: version })
          .expect(200)
      ).body,
    ).data.version;
  }
  return version;
}
