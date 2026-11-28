import { randomUUID } from "node:crypto";
import {
  branchTableListResponseSchema,
  branchTableResponseSchema,
  cartRequiredResponseSchema,
  checkoutResponseSchema,
  createdGiftResponseSchema,
  giftListResponseSchema,
  merchantOrderResponseSchema,
  orderResponseSchema,
  promotionResponseSchema,
  publicSlotsResponseSchema,
  quoteResponseSchema,
  resolvedTableResponseSchema,
  stampBalanceListResponseSchema,
  stampCardResponseSchema,
  stampEventListResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminRoleName } from "../src/generated/prisma/client.js";
import { BenefitsService } from "../src/engagement/benefits.service.js";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";
import { completeOrder, createShop, type Shop } from "./order-flow.js";

/**
 * Phase 9 (sandbox): stamp cards, promotions with admin review, dine-in table codes and gifts.
 * Hardening rows Q19 (stamps exactly once), Q20 (one gift claimant) and Q21 (table codes).
 */
describe("phase 9: engagement (stamps, promotions, tables, gifts)", () => {
  let world: MerchantWorld;
  const http = () => request(world.app.getHttpServer());
  const errorOf = (body: unknown) => (body as { error: { code: string } }).error;

  /** Idempotent writes need a key; sending one on every write keeps the tests short. */
  const send = (method: "post" | "put", path: string, token: string, body: object = {}) =>
    (method === "post" ? http().post(path) : http().put(path))
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send(body);
  const post = (path: string, token: string, body?: object) => send("post", path, token, body);
  const put = (path: string, token: string, body: object) => send("put", path, token, body);
  const get = (path: string, token: string) => world.get(path, token);

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
    return {
      userId: user.id,
      token: await world.issuer.token({ sub: user.authSubject, aal: "aal2" }),
    };
  }

  async function owner(shop: Shop) {
    return world.person({ merchantId: shop.merchant.id, role: "owner" });
  }

  /** Builds a fresh cart, asks for a quote (with any benefit fields) and returns it, unpaid. */
  async function quoteFor(
    person: Person,
    shop: Shop,
    extra: Record<string, unknown> = {},
    quantity = 1,
  ) {
    await world.prisma.cart.updateMany({
      where: { userId: person.user.id, status: "active" },
      data: { status: "abandoned" },
    });
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
    const mode = (extra.mode as string | undefined) ?? "in_store";
    const slots = publicSlotsResponseSchema.parse(
      (
        await http()
          .get(`/v1/branches/${shop.branch.id}/slots?date=${dubaiDate(1)}&mode=${mode}`)
          .expect(200)
      ).body,
    ).data.slots;
    return world.post("/v1/quotes", person.token, {
      cartId: filled.id,
      cartVersion: filled.version,
      mode,
      slotId: slots[0]?.id,
      ...extra,
    });
  }

  /** A paid (received) order with the given benefit fields. */
  async function buy(
    person: Person,
    shop: Shop,
    extra: Record<string, unknown> = {},
    quantity = 1,
  ) {
    const res = await quoteFor(person, shop, extra, quantity);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const quote = quoteResponseSchema.parse(res.body).data;
    const result = checkoutResponseSchema.parse(
      (
        await post("/v1/checkout", person.token, {
          quoteId: quote.id,
          sandboxOutcome: "succeed",
        }).expect(201)
      ).body,
    ).data;
    return { person, quote, orderId: result.orderId, version: result.version };
  }

  async function reject(orderId: string, version: number, staffToken: string) {
    await post(`/v1/merchant/orders/${orderId}/transition`, staffToken, {
      action: "reject",
      reason: "Machine broken",
      expectedVersion: version,
    }).expect(200);
  }

  beforeAll(async () => {
    world = await MerchantWorld.create();
    // Off by default; this suite turns every phase 9 feature on before the first read.
    await world.prisma.platformSetting.upsert({
      where: { key: "features" },
      create: {
        key: "features",
        value: { stampCards: true, promotions: true, dineIn: true, sandboxGifts: true },
      },
      update: { value: { stampCards: true, promotions: true, dineIn: true, sandboxGifts: true } },
    });
  });
  afterAll(async () => {
    // Leave the shared test database with default settings (files run one after another).
    await world.prisma.platformSetting.deleteMany({ where: { key: "features" } });
    await world.close();
  });

  describe("Q19 stamp cards: earned, redeemed, released and reversed exactly once", () => {
    it("runs the whole stamp life cycle", async () => {
      const shop = await createShop(world);
      const boss = await owner(shop);
      const card = stampCardResponseSchema.parse(
        (
          await put(`/v1/merchant/stamp-card?merchantId=${shop.merchant.id}`, boss.token, {
            names: { en: "Flow card" },
            stampsRequired: 2,
            reward: { en: "One pastry on us" },
            rewardMaxFils: "1000",
            active: true,
          }).expect(200)
        ).body,
      ).data!;
      expect(card).toMatchObject({ stampsRequired: 2, termsVersion: 1, active: true });
      const pub = stampCardResponseSchema.parse(
        (await http().get(`/v1/branches/${shop.branch.id}/stamp-card`).expect(200)).body,
      ).data;
      expect(pub?.id).toBe(card.id);

      // Another business's owner cannot change this card.
      const other = await owner(await createShop(world));
      await put(`/v1/merchant/stamp-card?merchantId=${shop.merchant.id}`, other.token, {
        names: { en: "Hijack" },
        stampsRequired: 2,
        reward: { en: "x" },
        rewardMaxFils: "1",
        active: true,
      }).expect(404);

      // Two items, completed: two stamps, once, however often the completion is replayed.
      const customer = await world.person();
      const first = await buy(customer, shop, {}, 2);
      const noReward = await quoteFor(customer, shop, { rewardId: card.id });
      expect(noReward.status).toBe(422);
      await completeOrder(world, first, boss.token);
      const balance = async () =>
        stampBalanceListResponseSchema
          .parse((await get("/v1/me/stamps", customer.token).expect(200)).body)
          .data.find((b) => b.merchantId === shop.merchant.id);
      expect(await balance()).toMatchObject({ balance: 2, rewardAvailable: true });
      const benefits = world.app.get(BenefitsService);
      for (let i = 0; i < 2; i++) {
        await world.prisma.$transaction((tx) =>
          benefits.onTransition(tx, { id: first.orderId, user_id: customer.user.id }, "completed"),
        );
      }
      expect((await balance())?.balance).toBe(2);

      // Redeem: one item price off, up to the card's maximum.
      const redeemed = await buy(customer, shop, { rewardId: card.id });
      expect(redeemed.quote.benefit).toMatchObject({ kind: "reward", discountFils: "1000" });
      expect(redeemed.quote.totalFils).toBe("200");
      expect((await balance())?.balance).toBe(0);
      // The café rejects it: the stamps come back, once.
      await reject(redeemed.orderId, redeemed.version, boss.token);
      expect((await balance())?.balance).toBe(2);

      const again = await buy(customer, shop, { rewardId: card.id });
      await completeOrder(world, again, boss.token);
      expect((await balance())?.balance).toBe(1); // 2 - 2 redeemed + 1 earned

      // A full refund of the first order takes its two stamps back, once.
      const payment = await world.prisma.payment.findFirstOrThrow({
        where: { orderId: first.orderId, status: "captured" },
      });
      const maker = await admin(["finance_maker"]);
      const checker = await admin(["finance_checker"]);
      const refund = (
        await post("/v1/admin/refunds", maker.token, {
          paymentId: payment.id,
          amountFils: payment.amountFils.toString(),
          reason: "Customer complaint",
        }).expect(201)
      ).body.data as { id: string };
      await post(`/v1/admin/refunds/${refund.id}/approve`, checker.token, {
        reason: "Checked receipt",
      }).expect(200);
      expect(await balance()).toMatchObject({ balance: -1, rewardAvailable: false });

      const events = stampEventListResponseSchema.parse(
        (
          await get(`/v1/me/stamps/events?merchantId=${shop.merchant.id}`, customer.token).expect(
            200,
          )
        ).body,
      ).data;
      const of = (orderId: string) =>
        events
          .filter((e) => e.orderId === orderId)
          .map((e) => [e.kind, e.stamps])
          .sort();
      expect(of(first.orderId)).toEqual([
        ["earn", 2],
        ["reverse", -2],
      ]);
      expect(of(redeemed.orderId)).toEqual([
        ["redeem", -2],
        ["release", 2],
      ]);
      expect(of(again.orderId)).toEqual([
        ["earn", 1],
        ["redeem", -2],
      ]);

      // The ledger is append-only.
      await expect(
        world.prisma
          .$executeRaw`UPDATE stamp_events SET stamps = 99 WHERE order_id = ${first.orderId}::uuid`,
      ).rejects.toThrow();

      // Only one benefit per order.
      const both = await quoteFor(customer, shop, { rewardId: card.id, promoCode: "ANY" });
      expect(both.status).toBe(422);
    });
  });

  describe("promotions with admin review", () => {
    it("needs approval, applies caps and limits, frees a use on rejection and keeps tenants apart", async () => {
      const shop = await createShop(world);
      const boss = await owner(shop);
      const now = Date.now();
      const created = promotionResponseSchema.parse(
        (
          await post("/v1/merchant/promotions", boss.token, {
            merchantId: shop.merchant.id,
            code: "flow20",
            names: { en: "Twenty off" },
            kind: "percent",
            percentBasisPoints: 2000,
            amountFils: null,
            minSubtotalFils: "1000",
            maxDiscountFils: "300",
            startsAt: new Date(now - 60_000).toISOString(),
            endsAt: new Date(now + 86_400_000).toISOString(),
            maxRedemptions: 2,
            perCustomerLimit: 1,
          }).expect(201)
        ).body,
      ).data;
      expect(created).toMatchObject({ code: "FLOW20", status: "draft", version: 1 });
      await post("/v1/merchant/promotions", boss.token, {
        merchantId: shop.merchant.id,
        code: "FLOW20",
        names: { en: "Dup" },
        kind: "amount",
        percentBasisPoints: null,
        amountFils: "100",
        minSubtotalFils: "0",
        maxDiscountFils: null,
        startsAt: new Date(now).toISOString(),
        endsAt: new Date(now + 86_400_000).toISOString(),
        maxRedemptions: null,
        perCustomerLimit: 1,
      }).expect(409);

      const alice = await world.person();
      expect((await quoteFor(alice, shop, { promoCode: "FLOW20" })).status).toBe(422);

      // Other businesses cannot see or move it.
      const stranger = await owner(await createShop(world));
      await post(`/v1/merchant/promotions/${created.id}/actions`, stranger.token, {
        action: "submit",
        expectedVersion: 1,
      }).expect(404);
      const submitted = promotionResponseSchema.parse(
        (
          await post(`/v1/merchant/promotions/${created.id}/actions`, boss.token, {
            action: "submit",
            expectedVersion: 1,
          }).expect(200)
        ).body,
      ).data;
      expect(submitted.status).toBe("pending_review");

      const ops = await admin(["operations"]);
      const marketing = await admin(["marketing"]);
      const queue = (
        await get("/v1/admin/promotions?status=pending_review&limit=100", ops.token).expect(200)
      ).body.data as { id: string }[];
      expect(queue.map((p) => p.id)).toContain(created.id);
      const decide = { decision: "approve", reason: "Terms are clear", expectedVersion: 2 };
      await post(`/v1/admin/promotions/${created.id}/review`, ops.token, decide).expect(403);
      await post(`/v1/admin/promotions/${created.id}/review`, alice.token, decide).expect(403);
      const approved = promotionResponseSchema.parse(
        (
          await post(`/v1/admin/promotions/${created.id}/review`, marketing.token, decide).expect(
            200,
          )
        ).body,
      ).data;
      expect(approved).toMatchObject({ status: "approved", reviewNote: "Terms are clear" });
      const audit = await world.prisma.auditEvent.findFirst({
        where: { targetId: created.id, actorId: marketing.userId },
      });
      expect(audit).not.toBeNull();

      // 20% of 1200 is 240, under the 300 cap.
      const a1 = await buy(alice, shop, { promoCode: "flow20" });
      expect(a1.quote.benefit).toMatchObject({
        kind: "promotion",
        code: "FLOW20",
        discountFils: "240",
      });
      expect(a1.quote.totalFils).toBe("960");
      // Two items: 480 off, capped at 300.
      const bob = await world.person();
      const capped = quoteResponseSchema.parse(
        (await quoteFor(bob, shop, { promoCode: "FLOW20" }, 2)).body,
      ).data;
      expect(capped.benefit?.discountFils).toBe("300");

      // Per-customer limit.
      const twice = await quoteFor(alice, shop, { promoCode: "FLOW20" });
      expect(twice.status).toBe(422);

      // Total cap of two uses: Bob takes the second, Carol is refused.
      const b1 = await buy(bob, shop, { promoCode: "FLOW20" });
      const carol = await world.person();
      const full = await quoteFor(carol, shop, { promoCode: "FLOW20" });
      expect(full.status).toBe(422);

      // The café rejects Bob's order: the use is freed and Carol can have it.
      await reject(b1.orderId, b1.version, boss.token);
      await buy(carol, shop, { promoCode: "FLOW20" });
      const row = await world.prisma.promotion.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.redemptions).toBe(2);
      const uses = await world.prisma.promotionRedemption.findMany({
        where: { promotionId: created.id },
      });
      expect(uses.map((u) => u.status).sort()).toEqual(["confirmed", "confirmed", "released"]);

      // Paused codes stop working.
      await post(`/v1/merchant/promotions/${created.id}/actions`, boss.token, {
        action: "pause",
        expectedVersion: approved.version,
      }).expect(200);
      expect((await quoteFor(await world.person(), shop, { promoCode: "FLOW20" })).status).toBe(
        422,
      );
    });
  });

  describe("Q21 dine-in table codes", () => {
    it("signs, resolves, rotates and retires codes, and never trusts a table from another branch", async () => {
      const shop = await createShop(world);
      await world.prisma.branch.update({
        where: { id: shop.branch.id },
        data: { modes: ["in_store", "dine_in"] },
      });
      const other = await createShop(world);
      await world.prisma.branch.update({
        where: { id: other.branch.id },
        data: { modes: ["in_store", "dine_in"] },
      });
      const manager = await world.person({
        merchantId: shop.merchant.id,
        role: "manager",
        branchIds: [shop.branch.id],
      });
      const barista = await world.person({
        merchantId: shop.merchant.id,
        role: "barista",
        branchIds: [shop.branch.id],
      });
      const otherOwner = await owner(other);

      const tables = `/v1/merchant/branches/${shop.branch.id}/tables`;
      const table = branchTableResponseSchema.parse(
        (await post(tables, manager.token, { label: "T7" }).expect(201)).body,
      ).data;
      expect(table).toMatchObject({ label: "T7", active: true, tokenVersion: 1 });
      expect(table.token).toMatch(/^t1\./);
      await post(tables, manager.token, { label: "T7" }).expect(409);
      await post(tables, barista.token, { label: "T8" }).expect(403);
      await get(tables, otherOwner.token).expect(404);

      const resolve = (token: string) =>
        http().get(`/v1/tables/resolve?token=${encodeURIComponent(token)}`);
      const resolved = resolvedTableResponseSchema.parse(
        (await resolve(table.token!).expect(200)).body,
      ).data;
      expect(resolved).toMatchObject({
        branchId: shop.branch.id,
        table: { id: table.id, label: "T7" },
      });

      // Forged: a valid-looking token with the signature of another table, or a flipped byte.
      const otherTable = branchTableResponseSchema.parse(
        (
          await post(`/v1/merchant/branches/${other.branch.id}/tables`, otherOwner.token, {
            label: "T1",
          }).expect(201)
        ).body,
      ).data;
      const [, id] = table.token!.split(".");
      const [, , version, mac] = otherTable.token!.split(".");
      await resolve(`t1.${id}.${version}.${mac}`).expect(404);
      const flipped = table.token!.slice(0, -1) + (table.token!.endsWith("A") ? "B" : "A");
      await resolve(flipped).expect(404);
      await resolve("t1.not-a-token.1.zzzzzzzzzz").expect(404);

      // Dine-in needs a code for this branch; another branch's code is refused.
      const guest = await world.person();
      expect((await quoteFor(guest, shop, { mode: "dine_in" })).status).toBe(422);
      expect(
        (await quoteFor(guest, shop, { mode: "dine_in", tableToken: otherTable.token })).status,
      ).toBe(422);
      expect((await quoteFor(guest, shop, { tableToken: table.token })).status).toBe(422);
      const order = await buy(guest, shop, { mode: "dine_in", tableToken: table.token });
      expect(order.quote.fulfillment.table).toEqual({ id: table.id, label: "T7" });
      const staffView = merchantOrderResponseSchema.parse(
        (await get(`/v1/merchant/orders/${order.orderId}`, barista.token).expect(200)).body,
      ).data;
      expect(staffView.table).toEqual({ id: table.id, label: "T7" });
      const mine = orderResponseSchema.parse(
        (await get(`/v1/orders/${order.orderId}`, guest.token).expect(200)).body,
      ).data;
      expect(mine.fulfillment.table?.label).toBe("T7");

      // Rotating replaces the code: the printed one stops working at once.
      const action = `${tables}/${table.id}/actions`;
      const rotated = branchTableResponseSchema.parse(
        (await post(action, manager.token, { action: "rotate" }).expect(200)).body,
      ).data;
      expect(rotated.tokenVersion).toBe(2);
      expect(rotated.token).not.toBe(table.token);
      await resolve(table.token!).expect(404);
      expect(
        (await quoteFor(await world.person(), shop, { mode: "dine_in", tableToken: table.token }))
          .status,
      ).toBe(422);
      await resolve(rotated.token!).expect(200);

      // Retiring ends it for good.
      await post(action, manager.token, { action: "retire" }).expect(200);
      await resolve(rotated.token!).expect(404);
      await post(action, manager.token, { action: "rotate" }).expect(422);
      const list = branchTableListResponseSchema.parse(
        (await get(tables, manager.token).expect(200)).body,
      ).data;
      expect(list.find((t) => t.id === table.id)).toMatchObject({ active: false, token: null });
      // The label is free again for a new table.
      await post(tables, manager.token, { label: "T7" }).expect(201);
    });
  });

  describe("Q20 sandbox gifts", () => {
    it("has exactly one claimant, works once and only for the gifted product", async () => {
      const shop = await createShop(world);
      const buyer = await world.person();
      const created = createdGiftResponseSchema.parse(
        (
          await post("/v1/gifts", buyer.token, {
            productId: shop.product.id,
            message: "Enjoy!",
          }).expect(201)
        ).body,
      ).data;
      expect(created.gift).toMatchObject({
        status: "issued",
        role: "sent",
        valueFils: "1200",
        sandbox: true,
      });
      const stored = await world.prisma.gift.findUniqueOrThrow({ where: { id: created.gift.id } });
      expect(
        JSON.stringify(stored, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
      ).not.toContain(created.claimToken);

      await post("/v1/gifts/claim", buyer.token, { token: created.claimToken }).expect(422);
      await post("/v1/gifts/claim", buyer.token, { token: "x".repeat(32) }).expect(404);

      const [ann, ben] = [await world.person(), await world.person()];
      const raced = await Promise.all(
        [ann, ben].map((p) => post("/v1/gifts/claim", p.token, { token: created.claimToken })),
      );
      expect(raced.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = raced[0]!.status === 200 ? ann : ben;
      const loser = winner === ann ? ben : ann;
      expect(errorOf(raced.find((r) => r.status === 409)?.body).code).toBe("CONFLICT");

      const theirs = giftListResponseSchema.parse(
        (await get("/v1/gifts", winner.token).expect(200)).body,
      ).data;
      expect(theirs.find((g) => g.id === created.gift.id)).toMatchObject({
        role: "received",
        status: "claimed",
      });
      expect(
        giftListResponseSchema
          .parse((await get("/v1/gifts", loser.token).expect(200)).body)
          .data.some((g) => g.id === created.gift.id),
      ).toBe(false);

      // Only the recipient, and only with the gifted product, at that business.
      expect((await quoteFor(loser, shop, { giftId: created.gift.id })).status).toBe(422);
      const elsewhere = await createShop(world);
      expect((await quoteFor(winner, elsewhere, { giftId: created.gift.id })).status).toBe(422);

      // The gift covers the item but the order still charges the minimum.
      const used = await buy(winner, shop, { giftId: created.gift.id });
      expect(used.quote.benefit).toMatchObject({ kind: "gift", discountFils: "1100" });
      expect(used.quote.totalFils).toBe("100");
      expect(
        (await world.prisma.gift.findUniqueOrThrow({ where: { id: created.gift.id } })).status,
      ).toBe("redeemed");
      expect((await quoteFor(winner, shop, { giftId: created.gift.id })).status).toBe(422);

      // Admins see every gift.
      const marketing = await admin(["marketing"]);
      const all = (await get("/v1/admin/gifts?limit=100", marketing.token).expect(200)).body
        .data as { id: string; recipientId: string; orderId: string }[];
      expect(all.find((g) => g.id === created.gift.id)).toMatchObject({
        recipientId: winner.user.id,
        orderId: used.orderId,
      });
      await get("/v1/admin/gifts", winner.token).expect(403);
    });

    it("returns a held gift when the café rejects the order", async () => {
      const shop = await createShop(world);
      const boss = await owner(shop);
      const buyer = await world.person();
      const { gift, claimToken } = createdGiftResponseSchema.parse(
        (await post("/v1/gifts", buyer.token, { productId: shop.product.id }).expect(201)).body,
      ).data;
      const friend = await world.person();
      await post("/v1/gifts/claim", friend.token, { token: claimToken }).expect(200);
      const order = await buy(friend, shop, { giftId: gift.id });
      expect((await world.prisma.gift.findUniqueOrThrow({ where: { id: gift.id } })).status).toBe(
        "redeemed",
      );
      await reject(order.orderId, order.version, boss.token);
      expect(await world.prisma.gift.findUniqueOrThrow({ where: { id: gift.id } })).toMatchObject({
        status: "claimed",
        orderId: null,
      });
    });
  });
});
