import { randomUUID } from "node:crypto";
import {
  cartRequiredResponseSchema,
  checkoutResponseSchema,
  createdGiftResponseSchema,
  publicSlotsResponseSchema,
  quoteResponseSchema,
  stampCardResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BenefitsService } from "../src/engagement/benefits.service.js";
import type { AdminRoleName } from "../src/generated/prisma/client.js";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";
import { completeOrder, createShop, type Shop } from "./order-flow.js";

/**
 * Cycle 3 loyalty rules per café: eligible and excluded products, stamps per item, reward
 * products, campaign dates, redemption restrictions, and reversal on full and partial refunds.
 */
describe("configurable stamp-card rules", () => {
  let world: MerchantWorld;
  const http = () => request(world.app.getHttpServer());
  const send = (method: "post" | "put", path: string, token: string, body: object = {}) =>
    (method === "post" ? http().post(path) : http().put(path))
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send(body);
  type Person = { token: string; user: { id: string } };

  async function admin(roles: AdminRoleName[]) {
    const user = await world.prisma.user.create({
      data: {
        authSubject: `adm-${randomUUID()}`,
        email: `adm-${randomUUID().slice(0, 8)}@example.test`,
      },
    });
    for (const role of roles)
      await world.prisma.adminRole.create({ data: { userId: user.id, role } });
    return { token: await world.issuer.token({ sub: user.authSubject, aal: "aal2" }) };
  }

  /** A shop with a croissant (from createShop, 12 AED), a latte (18 AED) and a mug (40 AED). */
  async function shopWithMenu() {
    const shop = await createShop(world);
    const make = (name: string, fils: bigint) =>
      world.prisma.product.create({
        data: {
          merchantId: shop.merchant.id,
          categoryId: shop.product.categoryId,
          names: { en: name },
          baseFils: fils,
          status: "published",
        },
      });
    return {
      shop,
      croissant: shop.product,
      latte: await make("Latte", 1800n),
      mug: await make("Mug", 4000n),
    };
  }

  async function quote(
    person: Person,
    shop: Shop,
    items: { productId: string; quantity: number }[],
    extra: object = {},
  ) {
    await world.prisma.cart.updateMany({
      where: { userId: person.user.id, status: "active" },
      data: { status: "abandoned" },
    });
    let cart = cartRequiredResponseSchema.parse(
      (await world.put("/v1/cart", person.token, { branchId: shop.branch.id }).expect(200)).body,
    ).data;
    for (const item of items) {
      cart = cartRequiredResponseSchema.parse(
        (
          await world
            .post("/v1/cart/items", person.token, { ...item, expectedVersion: cart.version })
            .expect(201)
        ).body,
      ).data;
    }
    const slots = publicSlotsResponseSchema.parse(
      (
        await http()
          .get(`/v1/branches/${shop.branch.id}/slots?date=${dubaiDate(1)}&mode=in_store`)
          .expect(200)
      ).body,
    ).data.slots;
    return world.post("/v1/quotes", person.token, {
      cartId: cart.id,
      cartVersion: cart.version,
      mode: "in_store",
      slotId: slots[0]?.id,
      ...extra,
    });
  }

  async function buy(
    person: Person,
    shop: Shop,
    items: { productId: string; quantity: number }[],
    extra: object = {},
  ) {
    const res = await quote(person, shop, items, extra);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const q = quoteResponseSchema.parse(res.body).data;
    const result = checkoutResponseSchema.parse(
      (
        await send("post", "/v1/checkout", person.token, {
          quoteId: q.id,
          sandboxOutcome: "succeed",
        }).expect(201)
      ).body,
    ).data;
    return { person, quote: q, orderId: result.orderId, version: result.version };
  }

  const balance = async (userId: string, merchantId: string) =>
    (
      await world.prisma.stampAccount.findUnique({
        where: { userId_merchantId: { userId, merchantId } },
      })
    )?.balance ?? 0;

  async function refund(orderId: string, amountFils: bigint) {
    const payment = await world.prisma.payment.findFirstOrThrow({
      where: { orderId, status: "captured" },
    });
    const maker = await admin(["finance_maker"]);
    const checker = await admin(["finance_checker"]);
    const created = (
      await send("post", "/v1/admin/refunds", maker.token, {
        paymentId: payment.id,
        amountFils: amountFils.toString(),
        reason: "Item missing",
      }).expect(201)
    ).body.data as { id: string };
    await send("post", `/v1/admin/refunds/${created.id}/approve`, checker.token, {
      reason: "Checked",
    }).expect(200);
    return { refundId: created.id, paid: payment.amountFils };
  }

  beforeAll(async () => {
    world = await MerchantWorld.create();
    const features = { stampCards: true, promotions: true, dineIn: true, sandboxGifts: true };
    await world.prisma.platformSetting.upsert({
      where: { key: "features" },
      create: { key: "features", value: features },
      update: { value: features },
    });
  });
  afterAll(async () => {
    await world.prisma.platformSetting.deleteMany({
      where: { key: { in: ["features", "operations"] } },
    });
    await world.close();
  });

  it("validates the rules and keeps product lists inside the café", async () => {
    const { shop, croissant, latte } = await shopWithMenu();
    const boss = await world.person({ merchantId: shop.merchant.id, role: "owner" });
    const base = {
      names: { en: "Card" },
      stampsRequired: 4,
      reward: { en: "Free item" },
      rewardMaxFils: "2000",
      active: true,
    };
    const path = `/v1/merchant/stamp-card?merchantId=${shop.merchant.id}`;
    await send("put", path, boss.token, {
      ...base,
      eligibleProductIds: [latte.id],
      excludedProductIds: [latte.id],
    }).expect(400);
    await send("put", path, boss.token, { ...base, stampsPerItem: 11 }).expect(400);
    await send("put", path, boss.token, {
      ...base,
      startsAt: "2026-12-10T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
    }).expect(400);
    const foreign = (await createShop(world)).product;
    const leak = await send("put", path, boss.token, {
      ...base,
      rewardProductIds: [foreign.id],
    }).expect(400);
    expect(JSON.stringify(leak.body)).toContain("this café's menu");
    // Older clients that send only the original fields keep the original behaviour.
    const plain = stampCardResponseSchema.parse(
      (await send("put", path, boss.token, base).expect(200)).body,
    ).data!;
    expect(plain).toMatchObject({
      eligibleProductIds: [],
      excludedProductIds: [],
      stampsPerItem: 1,
      rewardProductIds: [],
      startsAt: null,
      endsAt: null,
      redeemMinSubtotalFils: "0",
      redeemDailyLimit: 1,
    });
    expect(croissant.id).toBeTruthy();
  });

  it("earns only on eligible items, applies the reward to reward items and enforces restrictions", async () => {
    const { shop, croissant, latte, mug } = await shopWithMenu();
    const boss = await world.person({ merchantId: shop.merchant.id, role: "owner" });
    const card = stampCardResponseSchema.parse(
      (
        await send("put", `/v1/merchant/stamp-card?merchantId=${shop.merchant.id}`, boss.token, {
          names: { en: "Coffee card" },
          stampsRequired: 4,
          reward: { en: "A croissant on us" },
          rewardMaxFils: "1500",
          active: true,
          excludedProductIds: [mug.id],
          stampsPerItem: 2,
          rewardProductIds: [croissant.id],
          redeemMinSubtotalFils: "1500",
          redeemDailyLimit: 1,
        }).expect(200)
      ).body,
    ).data!;
    const customer = await world.person();

    // 2 lattes (eligible) + 1 mug (excluded) = 2 × 2 stamps.
    const first = await buy(customer, shop, [
      { productId: latte.id, quantity: 2 },
      { productId: mug.id, quantity: 1 },
    ]);
    await completeOrder(world, first, boss.token);
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(4);

    // The reward needs a reward item in the cart, then takes that item's price off (capped).
    const noRewardItem = await quote(customer, shop, [{ productId: latte.id, quantity: 1 }], {
      rewardId: card.id,
    });
    expect(noRewardItem.status).toBe(422);
    expect(JSON.stringify(noRewardItem.body)).toContain("reward items");
    // Below the minimum order for a reward (croissant alone is 12 AED, minimum is 15 AED).
    const tooSmall = await quote(customer, shop, [{ productId: croissant.id, quantity: 1 }], {
      rewardId: card.id,
    });
    expect(tooSmall.status).toBe(422);
    const redeemed = await buy(
      customer,
      shop,
      [
        { productId: croissant.id, quantity: 1 },
        { productId: latte.id, quantity: 1 },
      ],
      { rewardId: card.id },
    );
    expect(redeemed.quote.benefit).toMatchObject({ kind: "reward", discountFils: "1200" });
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(0);

    // One reward a day: even with enough stamps, a second one today is refused.
    await world.prisma.stampAccount.update({
      where: { userId_merchantId: { userId: customer.user.id, merchantId: shop.merchant.id } },
      data: { balance: 8 },
    });
    const second = await quote(
      customer,
      shop,
      [
        { productId: croissant.id, quantity: 1 },
        { productId: latte.id, quantity: 1 },
      ],
      { rewardId: card.id },
    );
    expect(second.status).toBe(422);
    expect(JSON.stringify(second.body)).toContain("today's rewards");

    // Rejected by the café: the reward is released and no longer counts toward today's limit.
    await send("post", `/v1/merchant/orders/${redeemed.orderId}/transition`, boss.token, {
      action: "reject",
      reason: "Out of croissants",
      expectedVersion: redeemed.version,
    }).expect(200);
    const retry = await quote(
      customer,
      shop,
      [
        { productId: croissant.id, quantity: 1 },
        { productId: latte.id, quantity: 1 },
      ],
      { rewardId: card.id },
    );
    expect(retry.status).toBe(201);
  });

  it("reverses stamps in proportion to each partial refund, once, and fully on a full refund", async () => {
    const { shop, latte } = await shopWithMenu();
    const boss = await world.person({ merchantId: shop.merchant.id, role: "owner" });
    await send("put", `/v1/merchant/stamp-card?merchantId=${shop.merchant.id}`, boss.token, {
      names: { en: "Card" },
      stampsRequired: 10,
      reward: { en: "Free latte" },
      rewardMaxFils: "1800",
      active: true,
    }).expect(200);
    const customer = await world.person();
    const order = await buy(customer, shop, [{ productId: latte.id, quantity: 4 }]);
    await completeOrder(world, order, boss.token);
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(4);
    const paid = BigInt(order.quote.totalFils);

    // A quarter refunded: one of four stamps back.
    const firstRefund = await refund(order.orderId, paid / 4n);
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(3);
    // Replaying the same refund changes nothing.
    await world.prisma.$transaction((tx) =>
      world.app.get(BenefitsService).onRefundSucceeded(tx, order.orderId, firstRefund.refundId),
    );
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(3);
    // A small goodwill refund that is less than one stamp's share takes nothing.
    await refund(order.orderId, 100n);
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(3);
    // The rest: all four stamps reversed in total, never more.
    await refund(order.orderId, paid - paid / 4n - 100n);
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(0);
    const reversed = await world.prisma.stampEvent.aggregate({
      where: { orderId: order.orderId, kind: "reverse" },
      _sum: { stamps: true },
    });
    expect(reversed._sum.stamps).toBe(-4);
  });

  it("gives back the stamps spent on a reward when that order is refunded in full", async () => {
    const { shop, croissant, latte } = await shopWithMenu();
    const boss = await world.person({ merchantId: shop.merchant.id, role: "owner" });
    const card = stampCardResponseSchema.parse(
      (
        await send("put", `/v1/merchant/stamp-card?merchantId=${shop.merchant.id}`, boss.token, {
          names: { en: "Card" },
          stampsRequired: 2,
          reward: { en: "Free croissant" },
          rewardMaxFils: "1200",
          active: true,
        }).expect(200)
      ).body,
    ).data!;
    const customer = await world.person();
    await world.prisma.stampAccount.create({
      data: { userId: customer.user.id, merchantId: shop.merchant.id, balance: 2 },
    });
    const order = await buy(
      customer,
      shop,
      [
        { productId: croissant.id, quantity: 1 },
        { productId: latte.id, quantity: 1 },
      ],
      { rewardId: card.id },
    );
    await completeOrder(world, order, boss.token);
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(2); // 2 - 2 + 2 earned
    await refund(order.orderId, BigInt(order.quote.totalFils));
    // Earned stamps reversed (-2) and the reward's stamps released (+2).
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(2);
  });

  it("earns and redeems nothing outside the card's dates", async () => {
    const { shop, latte, croissant } = await shopWithMenu();
    const boss = await world.person({ merchantId: shop.merchant.id, role: "owner" });
    const card = stampCardResponseSchema.parse(
      (
        await send("put", `/v1/merchant/stamp-card?merchantId=${shop.merchant.id}`, boss.token, {
          names: { en: "Old campaign" },
          stampsRequired: 2,
          reward: { en: "Free croissant" },
          rewardMaxFils: "1200",
          active: true,
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2026-02-01T00:00:00.000Z",
        }).expect(200)
      ).body,
    ).data!;
    const customer = await world.person();
    const order = await buy(customer, shop, [{ productId: latte.id, quantity: 2 }]);
    await completeOrder(world, order, boss.token);
    expect(await balance(customer.user.id, shop.merchant.id)).toBe(0);
    await world.prisma.stampAccount
      .update({
        where: { userId_merchantId: { userId: customer.user.id, merchantId: shop.merchant.id } },
        data: { balance: 5 },
      })
      .catch(() =>
        world.prisma.stampAccount.create({
          data: { userId: customer.user.id, merchantId: shop.merchant.id, balance: 5 },
        }),
      );
    const res = await quote(customer, shop, [{ productId: croissant.id, quantity: 2 }], {
      rewardId: card.id,
    });
    expect(res.status).toBe(422);
  });

  it("sets new gifts to expire after the configured number of days", async () => {
    const { shop } = await shopWithMenu();
    const ops = await admin(["operations"]);
    const current = (
      await world.get("/v1/admin/platform-settings", ops.token).expect(200)
    ).body.data.find((s: { key: string }) => s.key === "operations");
    expect(current.value.giftValidDays).toBe(30);
    await send("put", "/v1/admin/platform-settings/operations", ops.token, {
      value: { ...current.value, giftValidDays: 7 },
      expectedVersion: current.version,
      reason: "Shorter sandbox gifts",
    }).expect(200);
    const buyer = await world.person();
    const created = createdGiftResponseSchema.parse(
      (await send("post", "/v1/gifts", buyer.token, { productId: shop.product.id }).expect(201))
        .body,
    ).data;
    const days = (new Date(created.gift.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("refuses an order below the AED 1 minimum", async () => {
    const { shop } = await shopWithMenu();
    const sample = await world.prisma.product.create({
      data: {
        merchantId: shop.merchant.id,
        categoryId: shop.product.categoryId,
        names: { en: "Tasting sip" },
        baseFils: 50n,
        status: "published",
      },
    });
    const customer = await world.person();
    const res = await quote(customer, shop, [{ productId: sample.id, quantity: 1 }]);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("minimum order is AED 1.00");
    const two = await quote(customer, shop, [{ productId: sample.id, quantity: 2 }]);
    expect(two.status).toBe(201);
  });
});
