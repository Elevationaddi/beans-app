import { randomUUID } from "node:crypto";
import {
  cartRequiredResponseSchema,
  cartResponseSchema,
  checkoutResponseSchema,
  errorResponseSchema,
  orderListResponseSchema,
  orderResponseSchema,
  publicSlotsResponseSchema,
  quoteResponseSchema,
  vehicleListResponseSchema,
  vehicleResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localClock } from "../src/inventory/schedule.js";
import { PaymentReconciler } from "../src/ordering/payment-reconciler.service.js";
import { FakePaymentProvider } from "../src/payments/fake-payment.provider.js";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";

const allWeek = (opens: string, closes: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    opens: new Date(`1970-01-01T${opens}:00Z`),
    closes: new Date(`1970-01-01T${closes}:00Z`),
  }));

type Person = Awaited<ReturnType<MerchantWorld["person"]>>;

describe("phase 6: cart, quotes, checkout with the sandbox provider, orders", () => {
  let world: MerchantWorld;
  let provider: FakePaymentProvider;
  let reconciler: PaymentReconciler;
  let cafe: Awaited<ReturnType<typeof makeCafe>>;
  let other: Awaited<ReturnType<typeof makeCafe>>;

  async function makeCafe(
    label: string,
    opts: { capacity?: number; open?: boolean; croissantStock?: number } = {},
  ) {
    const merchant = await world.prisma.merchant.create({
      data: {
        legalName: `${label} LLC`,
        brandName: `${label} ${randomUUID().slice(0, 6)}`,
        licenseNumber: `CHK-${randomUUID().slice(0, 12)}`,
        status: "approved",
      },
    });
    const merchantId = merchant.id;
    const branch = await world.prisma.branch.create({
      data: {
        merchantId,
        nameEn: `${label} Corniche`,
        address: "Test",
        city: "abu_dhabi",
        modes: ["in_store", "curbside"],
        capacity: opts.capacity ?? 5,
        status: "active",
        hours: {
          create: opts.open === false ? allWeek("00:00", "00:01") : allWeek("00:00", "23:59"),
        },
      },
    });
    const category = await world.prisma.category.create({ data: { merchantId, nameEn: "Coffee" } });
    const size = await world.prisma.modifierGroup.create({
      data: { merchantId, name: { en: "Size" }, minCount: 1, maxCount: 1 },
    });
    const small = await world.prisma.modifierOption.create({
      data: { groupId: size.id, merchantId, name: { en: "Small" }, deltaFils: 0n },
    });
    const large = await world.prisma.modifierOption.create({
      data: { groupId: size.id, merchantId, name: { en: "Large" }, deltaFils: 300n },
    });
    const extras = await world.prisma.modifierGroup.create({
      data: { merchantId, name: { en: "Extras" }, minCount: 0, maxCount: 2 },
    });
    const shot = await world.prisma.modifierOption.create({
      data: { groupId: extras.id, merchantId, name: { en: "Extra shot" }, deltaFils: 250n },
    });
    const syrup = await world.prisma.modifierOption.create({
      data: { groupId: extras.id, merchantId, name: { en: "Syrup" }, deltaFils: 150n },
    });
    const latte = await world.prisma.product.create({
      data: {
        merchantId,
        categoryId: category.id,
        names: { en: "Latte" },
        baseFils: 1800n,
        status: "published",
      },
    });
    await world.prisma.productGroup.createMany({
      data: [
        { productId: latte.id, groupId: size.id, merchantId, sort: 0 },
        { productId: latte.id, groupId: extras.id, merchantId, sort: 1 },
      ],
    });
    const croissant = await world.prisma.product.create({
      data: {
        merchantId,
        categoryId: category.id,
        names: { en: "Croissant" },
        baseFils: 1200n,
        status: "published",
      },
    });
    await world.prisma.branchProduct.create({
      data: { branchId: branch.id, productId: latte.id, merchantId, priceOverrideFils: 1700n },
    });
    await world.prisma.branchProduct.create({
      data: {
        branchId: branch.id,
        productId: croissant.id,
        merchantId,
        stockOnHand: opts.croissantStock ?? 10,
      },
    });
    await world.prisma.branchOption.create({
      data: { branchId: branch.id, optionId: syrup.id, merchantId, enabled: false },
    });
    return { merchant, branch, latte, croissant, small, large, shot, syrup };
  }

  beforeAll(async () => {
    world = await MerchantWorld.create();
    provider = world.app.get(FakePaymentProvider);
    reconciler = world.app.get(PaymentReconciler);
    cafe = await makeCafe("Checkout");
    other = await makeCafe("Other");
  });
  afterAll(() => world.close());

  const http = () => request(world.app.getHttpServer());
  const del = (path: string, token: string) =>
    http().delete(path).set("Authorization", `Bearer ${token}`);
  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

  function startCart(person: Person, branchId: string, replaceConfirmed = false) {
    return world.put("/v1/cart", person.token, { branchId, replaceConfirmed });
  }

  function addItem(person: Person, version: number, item: object) {
    return world.post("/v1/cart/items", person.token, { expectedVersion: version, ...item });
  }

  /** Tomorrow's first pickup slot at a branch. */
  async function slotId(branchId: string, index = 0) {
    const res = await http()
      .get(`/v1/branches/${branchId}/slots?date=${dubaiDate(1)}&mode=in_store`)
      .expect(200);
    const slot = publicSlotsResponseSchema.parse(res.body).data.slots[index];
    if (!slot) throw new Error("no slot");
    return slot.id;
  }

  /** A customer with a cart at `shop` holding `items`, quoted for tomorrow's first slot. */
  async function quoted(
    shop: typeof cafe,
    items: object[] = [{ productId: shop.latte.id, quantity: 1, optionIds: [shop.small.id] }],
    quoteExtra: object = {},
  ) {
    const person = await world.person();
    let cart = cartRequiredResponseSchema.parse(
      (await startCart(person, shop.branch.id).expect(200)).body,
    ).data;
    for (const item of items) {
      cart = cartRequiredResponseSchema.parse(
        (await addItem(person, cart.version, item).expect(201)).body,
      ).data;
    }
    const res = await world
      .post("/v1/quotes", person.token, {
        cartId: cart.id,
        cartVersion: cart.version,
        mode: "in_store",
        slotId: await slotId(shop.branch.id),
        ...quoteExtra,
      })
      .expect(201);
    return { person, cart, quote: quoteResponseSchema.parse(res.body).data };
  }

  function checkout(person: Person, quoteId: string, extra: object = {}, key = randomUUID()) {
    return http()
      .post("/v1/checkout")
      .set("Authorization", `Bearer ${person.token}`)
      .set("Idempotency-Key", key)
      .send({ quoteId, ...extra });
  }

  const slotRow = (id: string) => world.prisma.slot.findUniqueOrThrow({ where: { id } });
  const stockRow = (shop: typeof cafe) =>
    world.prisma.branchProduct.findUniqueOrThrow({
      where: { branchId_productId: { branchId: shop.branch.id, productId: shop.croissant.id } },
    });

  describe("vehicles", () => {
    it("saves, lists, changes and removes the customer's own cars only", async () => {
      const me = await world.person();
      const stranger = await world.person();
      const created = vehicleResponseSchema.parse(
        (
          await world
            .post("/v1/vehicles", me.token, {
              plate: " ab 12345 ",
              plateRegion: "abu_dhabi",
              color: "White",
            })
            .expect(201)
        ).body,
      ).data;
      expect(created).toMatchObject({ plate: "AB 12345", plateRegion: "abu_dhabi", model: null });

      await world
        .post("/v1/vehicles", me.token, { plate: "X1", color: "Red", vin: "x" })
        .expect(400);
      await world
        .patch(`/v1/vehicles/${created.id}`, stranger.token, { color: "Blue" })
        .expect(404);
      await del(`/v1/vehicles/${created.id}`, stranger.token).expect(404);
      expect(
        vehicleListResponseSchema.parse((await world.get("/v1/vehicles", stranger.token)).body)
          .data,
      ).toEqual([]);

      const changed = await world
        .patch(`/v1/vehicles/${created.id}`, me.token, { color: "Blue", model: "Patrol" })
        .expect(200);
      expect(changed.body.data).toMatchObject({ color: "Blue", model: "Patrol" });
      await del(`/v1/vehicles/${created.id}`, me.token).expect(200);
      await world.get("/v1/vehicles", "not-a-token").expect(401);
    });
  });

  describe("cart", () => {
    it("prices items on the server and rejects tampered prices and invalid options (Q02)", async () => {
      const me = await world.person();
      expect(
        cartResponseSchema.parse((await world.get("/v1/cart", me.token)).body).data,
      ).toBeNull();
      await addItem(me, 1, {
        productId: cafe.latte.id,
        quantity: 1,
        optionIds: [cafe.small.id],
      }).expect(404);

      const cart = cartRequiredResponseSchema.parse(
        (await startCart(me, cafe.branch.id).expect(200)).body,
      ).data;
      expect(cart).toMatchObject({ version: 1, items: [], canCheckout: false });

      // A client price is an unknown field: rejected, never used.
      const tampered = await addItem(me, cart.version, {
        productId: cafe.latte.id,
        quantity: 1,
        optionIds: [cafe.small.id],
        unitFils: "1",
      }).expect(400);
      expect(errorOf(tampered.body).code).toBe("VALIDATION_FAILED");

      const missingSize = await addItem(me, cart.version, {
        productId: cafe.latte.id,
        quantity: 1,
        optionIds: [],
      }).expect(422);
      expect(errorOf(missingSize.body).fieldErrors).toHaveProperty(
        `groups.${(await world.prisma.productGroup.findFirstOrThrow({ where: { productId: cafe.latte.id, sort: 0 } })).groupId}`,
      );
      const disabled = await addItem(me, cart.version, {
        productId: cafe.latte.id,
        quantity: 1,
        optionIds: [cafe.small.id, cafe.syrup.id],
      }).expect(409);
      expect(errorOf(disabled.body).code).toBe("OUT_OF_STOCK");

      const added = cartRequiredResponseSchema.parse(
        (
          await addItem(me, cart.version, {
            productId: cafe.latte.id,
            quantity: 2,
            optionIds: [cafe.shot.id, cafe.large.id],
          }).expect(201)
        ).body,
      ).data;
      // Branch price 1700 + large 300 + shot 250 = 2250 per cup.
      expect(added.items[0]).toMatchObject({ quantity: 2, unitFils: "2250", lineFils: "4500" });
      expect(added).toMatchObject({ version: 2, subtotalFils: "4500", canCheckout: true });

      // Same item again merges into the line; stale versions are refused.
      const stale = await addItem(me, 1, {
        productId: cafe.latte.id,
        quantity: 1,
        optionIds: [cafe.large.id, cafe.shot.id],
      }).expect(409);
      expect(errorOf(stale.body)).toMatchObject({ code: "CONFLICT" });
      const merged = cartRequiredResponseSchema.parse(
        (
          await addItem(me, 2, {
            productId: cafe.latte.id,
            quantity: 1,
            optionIds: [cafe.large.id, cafe.shot.id],
          }).expect(201)
        ).body,
      ).data;
      expect(merged.items).toHaveLength(1);
      expect(merged.items[0]?.quantity).toBe(3);
      await addItem(me, 3, {
        productId: cafe.latte.id,
        quantity: 18,
        optionIds: [cafe.large.id, cafe.shot.id],
      }).expect(422);

      const itemId = merged.items[0]?.id ?? "";
      const stranger = await world.person();
      await startCart(stranger, cafe.branch.id).expect(200);
      await world
        .patch(`/v1/cart/items/${itemId}`, stranger.token, {
          quantity: 1,
          optionIds: [cafe.small.id],
          expectedVersion: 1,
        })
        .expect(404);

      const patched = await world
        .patch(`/v1/cart/items/${itemId}`, me.token, {
          quantity: 1,
          optionIds: [cafe.small.id],
          notes: "Oat milk please",
          expectedVersion: 3,
        })
        .expect(200);
      expect(patched.body.data.items[0]).toMatchObject({
        unitFils: "1700",
        notes: "Oat milk please",
      });

      // A menu change marks the line instead of silently repricing or dropping it.
      await world.prisma.branchProduct.update({
        where: { branchId_productId: { branchId: cafe.branch.id, productId: cafe.latte.id } },
        data: { enabled: false },
      });
      const view = cartResponseSchema.parse((await world.get("/v1/cart", me.token)).body).data;
      expect(view?.items[0]).toMatchObject({ issue: "unavailable", unitFils: null });
      expect(view?.canCheckout).toBe(false);
      await world.prisma.branchProduct.update({
        where: { branchId_productId: { branchId: cafe.branch.id, productId: cafe.latte.id } },
        data: { enabled: true },
      });

      await del(`/v1/cart/items/${itemId}?expectedVersion=3`, me.token).expect(409);
      const emptied = await del(`/v1/cart/items/${itemId}?expectedVersion=4`, me.token).expect(200);
      expect(emptied.body.data).toMatchObject({ version: 5, items: [] });
    });

    it("asks before switching branch and never mixes branches (Q03)", async () => {
      const me = await world.person();
      const first = cartRequiredResponseSchema.parse(
        (await startCart(me, cafe.branch.id).expect(200)).body,
      ).data;
      // Empty cart: switching needs no confirmation.
      const moved = cartRequiredResponseSchema.parse(
        (await startCart(me, other.branch.id).expect(200)).body,
      ).data;
      expect(moved.branchId).toBe(other.branch.id);
      await addItem(me, moved.version, {
        productId: other.croissant.id,
        quantity: 1,
      }).expect(201);

      const refused = await startCart(me, cafe.branch.id).expect(409);
      expect(errorOf(refused.body).fieldErrors).toHaveProperty("replaceConfirmed");
      const still = cartResponseSchema.parse((await world.get("/v1/cart", me.token)).body).data;
      expect(still?.branchId).toBe(other.branch.id);
      expect(still?.items).toHaveLength(1);

      // Products of another café cannot be added.
      await addItem(me, still?.version ?? 0, { productId: cafe.croissant.id, quantity: 1 }).expect(
        404,
      );

      const replaced = cartRequiredResponseSchema.parse(
        (await startCart(me, cafe.branch.id, true).expect(200)).body,
      ).data;
      expect(replaced).toMatchObject({ branchId: cafe.branch.id, items: [], version: 1 });
      const carts = await world.prisma.cart.findMany({ where: { userId: me.user.id } });
      expect(carts.filter((c) => c.status === "active")).toHaveLength(1);
      expect(carts.find((c) => c.id === first.id)?.status).toBe("abandoned");

      await world.put("/v1/cart", me.token, { branchId: randomUUID() }).expect(404);
    });
  });

  describe("quotes", () => {
    it("snapshots server totals with the sandbox tax policy", async () => {
      const { quote } = await quoted(cafe, [
        { productId: cafe.latte.id, quantity: 2, optionIds: [cafe.large.id] },
        { productId: cafe.croissant.id, quantity: 1 },
      ]);
      // 2 × (1700 + 300) + 1200 = 5200; included VAT round(5200 × 5 / 105) = 248.
      expect(quote).toMatchObject({
        currency: "AED",
        subtotalFils: "5200",
        discountFils: "0",
        taxIncludedFils: "248",
        feeFils: "0",
        totalFils: "5200",
        policyVersion: "sandbox-v1",
      });
      expect(quote.lines).toHaveLength(2);
      expect(quote.fulfillment).toMatchObject({ mode: "in_store", asap: false, vehicle: null });
      expect(new Date(quote.expiresAt).getTime() - Date.now()).toBeGreaterThan(200_000);
      await expect(
        world.prisma.quote.update({ where: { id: quote.id }, data: { cartVersion: 99 } }),
      ).rejects.toThrow();
    });

    it("validates cart version, pickup type, vehicle, slot and phase-two fields", async () => {
      const me = await world.person();
      const cart = cartRequiredResponseSchema.parse(
        (await startCart(me, cafe.branch.id).expect(200)).body,
      ).data;
      const base = { cartId: cart.id, cartVersion: cart.version, mode: "in_store" };
      expect(
        errorOf((await world.post("/v1/quotes", me.token, base).expect(422)).body).message,
      ).toMatch(/empty/);
      const withItem = cartRequiredResponseSchema.parse(
        (await addItem(me, cart.version, { productId: cafe.croissant.id, quantity: 1 }).expect(201))
          .body,
      ).data;
      const ok = { ...base, cartVersion: withItem.version, slotId: await slotId(cafe.branch.id) };

      await world.post("/v1/quotes", me.token, { ...ok, cartVersion: 1 }).expect(409);
      await world.post("/v1/quotes", me.token, { ...ok, totalFils: "1" }).expect(400);
      const curbside = await world
        .post("/v1/quotes", me.token, { ...ok, mode: "curbside" })
        .expect(422);
      expect(errorOf(curbside.body).fieldErrors).toHaveProperty("vehicleId");
      const strangerCar = vehicleResponseSchema.parse(
        (
          await world
            .post("/v1/vehicles", (await world.person()).token, { plate: "Z9", color: "Grey" })
            .expect(201)
        ).body,
      ).data;
      await world
        .post("/v1/quotes", me.token, { ...ok, mode: "curbside", vehicleId: strangerCar.id })
        .expect(404);
      const myCar = vehicleResponseSchema.parse(
        (await world.post("/v1/vehicles", me.token, { plate: "A1", color: "Black" }).expect(201))
          .body,
      ).data;
      const curbsideQuote = quoteResponseSchema.parse(
        (
          await world
            .post("/v1/quotes", me.token, { ...ok, mode: "curbside", vehicleId: myCar.id })
            .expect(201)
        ).body,
      ).data;
      expect(curbsideQuote.fulfillment.vehicle).toMatchObject({ plate: "A1", color: "Black" });
      // Deleting the car later does not touch the quote snapshot.
      await del(`/v1/vehicles/${myCar.id}`, me.token).expect(200);

      for (const [field, value] of [
        ["promoCode", "SAVE10"],
        ["rewardId", randomUUID()],
      ] as const) {
        const res = await world.post("/v1/quotes", me.token, { ...ok, [field]: value }).expect(422);
        expect(errorOf(res.body).code).toBe("FEATURE_DISABLED");
      }
      // A table code only goes with dine-in, which is off by default (phase 9).
      const tableOnPickup = await world
        .post("/v1/quotes", me.token, { ...ok, tableToken: "t" })
        .expect(422);
      expect(errorOf(tableOnPickup.body).code).toBe("VALIDATION_FAILED");
      for (const extra of [{}, { tableToken: "t" }]) {
        const dineIn = await world
          .post("/v1/quotes", me.token, { ...ok, mode: "dine_in", ...extra })
          .expect(422);
        expect(errorOf(dineIn.body).code).toBe("FEATURE_DISABLED");
      }
      await world.post("/v1/quotes", me.token, { ...ok, slotId: randomUUID() }).expect(404);
      // Another branch's slot is not found here.
      await world
        .post("/v1/quotes", me.token, { ...ok, slotId: await slotId(other.branch.id) })
        .expect(404);
      // Someone else's cart is not found.
      await world.post("/v1/quotes", (await world.person()).token, ok).expect(404);
    });

    it("ASAP needs an open, unpaused branch", async () => {
      const closed = await makeCafe("Closed", { open: false });
      const shopper = await world.person();
      const cart = cartRequiredResponseSchema.parse(
        (await startCart(shopper, closed.branch.id).expect(200)).body,
      ).data;
      const filled = cartRequiredResponseSchema.parse(
        (
          await addItem(shopper, cart.version, {
            productId: closed.croissant.id,
            quantity: 1,
          }).expect(201)
        ).body,
      ).data;
      const res = await world
        .post("/v1/quotes", shopper.token, {
          cartId: filled.id,
          cartVersion: filled.version,
          mode: "in_store",
        })
        .expect(409);
      expect(errorOf(res.body).code).toBe("BRANCH_CLOSED");

      const me = await world.person();
      const open = cartRequiredResponseSchema.parse(
        (await startCart(me, cafe.branch.id).expect(200)).body,
      ).data;
      const item = cartRequiredResponseSchema.parse(
        (await addItem(me, open.version, { productId: cafe.croissant.id, quantity: 1 }).expect(201))
          .body,
      ).data;
      const asap = await world.post("/v1/quotes", me.token, {
        cartId: item.id,
        cartVersion: item.version,
        mode: "in_store",
      });
      // The test café closes at 23:59 Dubai time; the last slot starts at 23:30.
      if (localClock("Asia/Dubai").minutes >= 23 * 60 + 40) {
        expect(asap.status).toBe(409);
      } else {
        expect(asap.status).toBe(201);
        expect(quoteResponseSchema.parse(asap.body).data.fulfillment.asap).toBe(true);
      }

      const paused = await makeCafe("Paused");
      const p = await world.person();
      const pc = cartRequiredResponseSchema.parse(
        (await startCart(p, paused.branch.id).expect(200)).body,
      ).data;
      const pi = cartRequiredResponseSchema.parse(
        (await addItem(p, pc.version, { productId: paused.croissant.id, quantity: 1 }).expect(201))
          .body,
      ).data;
      await world.prisma.branch.update({
        where: { id: paused.branch.id },
        data: { status: "paused" },
      });
      const pausedRes = await world
        .post("/v1/quotes", p.token, {
          cartId: pi.id,
          cartVersion: pi.version,
          mode: "in_store",
          slotId: randomUUID(),
        })
        .expect(409);
      expect(errorOf(pausedRes.body).code).toBe("BRANCH_CLOSED");
    });
  });

  describe("checkout", () => {
    it("holds, charges once, and only then marks the order received (Q06 success)", async () => {
      const { person, quote } = await quoted(cafe, [
        { productId: cafe.latte.id, quantity: 1, optionIds: [cafe.small.id] },
        { productId: cafe.croissant.id, quantity: 2 },
      ]);
      const stockBefore = await stockRow(cafe);
      const slotBefore = await slotRow(quote.fulfillment.slotId);
      const charges = provider.chargesCreated;

      const missingKey = await world.post("/v1/checkout", person.token, { quoteId: quote.id });
      expect(missingKey.status).toBe(400);
      expect(errorOf(missingKey.body).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      await checkout(person, quote.id, { totalFils: "1" }).expect(400);

      const key = randomUUID();
      const res = await checkout(person, quote.id, {}, key).expect(201);
      const result = checkoutResponseSchema.parse(res.body).data;
      expect(result).toMatchObject({
        status: "received",
        version: 2,
        totalFils: "4100",
        payment: {
          attempt: 1,
          status: "captured",
          retryable: false,
          clientAction: { type: "none" },
        },
      });
      expect(result.publicNumber).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
      expect(provider.chargesCreated).toBe(charges + 1);

      const slotAfter = await slotRow(quote.fulfillment.slotId);
      expect(slotAfter.confirmed).toBe(slotBefore.confirmed + 1);
      expect(slotAfter.reserved).toBe(slotBefore.reserved);
      expect((await stockRow(cafe)).stockReserved).toBe(stockBefore.stockReserved + 2);
      expect(
        cartResponseSchema.parse((await world.get("/v1/cart", person.token)).body).data,
      ).toBeNull();

      // Replays and repeats never create another order or charge.
      const replay = await checkout(person, quote.id, {}, key).expect(201);
      expect(replay.headers["idempotent-replayed"]).toBe("true");
      expect(replay.body).toEqual(res.body);
      const again = checkoutResponseSchema.parse(
        (await checkout(person, quote.id).expect(201)).body,
      ).data;
      expect(again.orderId).toBe(result.orderId);
      expect(provider.chargesCreated).toBe(charges + 1);
      await checkout(person, quote.id, { sandboxOutcome: "fail" }, key).expect(409);

      const detail = orderResponseSchema.parse(
        (await world.get(`/v1/orders/${result.orderId}`, person.token).expect(200)).body,
      ).data;
      expect(detail).toMatchObject({
        status: "received",
        totals: { totalFils: "4100", taxIncludedFils: "195" },
        payment: { attempt: 1, status: "captured" },
        policyVersion: "sandbox-v1",
      });
      expect(detail.items.map((i) => [i.names.en, i.quantity, i.totalFils])).toEqual([
        ["Latte", 1, "1700"],
        ["Croissant", 2, "2400"],
      ]);
      expect(detail.timeline.map((e) => [e.fromState, e.toState])).toEqual([
        [null, "pending_payment"],
        ["pending_payment", "received"],
      ]);
      const list = orderListResponseSchema.parse(
        (await world.get("/v1/orders?status=received", person.token).expect(200)).body,
      );
      expect(list.data.map((o) => o.id)).toEqual([result.orderId]);

      const stranger = await world.person();
      await world.get(`/v1/orders/${result.orderId}`, stranger.token).expect(404);
      await checkout(stranger, quote.id).expect(404);
      expect(
        orderListResponseSchema.parse((await world.get("/v1/orders", stranger.token)).body).data,
      ).toEqual([]);

      // History is immutable.
      await expect(
        world.prisma.orderEvent.updateMany({
          where: { orderId: result.orderId },
          data: { reason: "x" },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        world.prisma.payment.updateMany({
          where: { orderId: result.orderId },
          data: { status: "failed" },
        }),
      ).rejects.toThrow(/final/);
      const outbox = await world.prisma.outboxMessage.findMany({
        where: { aggregateId: result.orderId },
        orderBy: { createdAt: "asc" },
      });
      expect(outbox.map((m) => m.dedupeKey)).toEqual([
        `order:${result.orderId}:v1`,
        `order:${result.orderId}:v2`,
      ]);
    });

    it("rejects a quote whose prices, stock or cart changed (Q05)", async () => {
      const priced = await quoted(cafe);
      const slotBefore = await slotRow(priced.quote.fulfillment.slotId);
      await world.prisma.branchProduct.update({
        where: { branchId_productId: { branchId: cafe.branch.id, productId: cafe.latte.id } },
        data: { priceOverrideFils: 1750n },
      });
      try {
        const res = await checkout(priced.person, priced.quote.id).expect(409);
        expect(errorOf(res.body).code).toBe("PRICE_CHANGED");
      } finally {
        await world.prisma.branchProduct.update({
          where: { branchId_productId: { branchId: cafe.branch.id, productId: cafe.latte.id } },
          data: { priceOverrideFils: 1700n },
        });
      }
      expect(await world.prisma.order.count({ where: { quoteId: priced.quote.id } })).toBe(0);
      expect((await slotRow(priced.quote.fulfillment.slotId)).reserved).toBe(slotBefore.reserved);
      // After the price returns, the same quote is valid again (nothing was held or charged).

      const shop = await makeCafe("Stock", { croissantStock: 3 });
      const stocked = await quoted(shop, [{ productId: shop.croissant.id, quantity: 3 }]);
      await world.prisma.branchProduct.update({
        where: { branchId_productId: { branchId: shop.branch.id, productId: shop.croissant.id } },
        data: { stockOnHand: 2 },
      });
      const sold = await checkout(stocked.person, stocked.quote.id).expect(409);
      expect(errorOf(sold.body).code).toBe("OUT_OF_STOCK");
      expect((await stockRow(shop)).stockReserved).toBe(0);

      const edited = await quoted(cafe);
      await addItem(edited.person, edited.cart.version, {
        productId: cafe.croissant.id,
        quantity: 1,
      }).expect(201);
      const changed = await checkout(edited.person, edited.quote.id).expect(409);
      expect(errorOf(changed.body).code).toBe("QUOTE_EXPIRED");
    });

    it("refuses an expired quote", async () => {
      const { person, quote } = await quoted(cafe);
      const row = await world.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      // Quotes are immutable, so store an already-expired copy of the same quote.
      const expired = await world.prisma.quote.create({
        data: {
          cartId: row.cartId,
          cartVersion: row.cartVersion,
          userId: row.userId,
          branchId: row.branchId,
          mode: row.mode,
          slotId: row.slotId,
          totals: row.totals as object,
          lineSnapshot: row.lineSnapshot as object[],
          fulfillment: row.fulfillment as object,
          menuVersion: row.menuVersion,
          policyVersion: row.policyVersion,
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      const res = await checkout(person, expired.id).expect(409);
      expect(errorOf(res.body).code).toBe("QUOTE_EXPIRED");
      expect(await world.prisma.order.count({ where: { quoteId: expired.id } })).toBe(0);
      // The fresh quote still works.
      await checkout(person, quote.id).expect(201);
    });

    it("sells the last unit and the last slot place exactly once under concurrency (Q04)", async () => {
      const shop = await makeCafe("Race", { croissantStock: 1 });
      const a = await quoted(shop, [{ productId: shop.croissant.id, quantity: 1 }]);
      const b = await quoted(shop, [{ productId: shop.croissant.id, quantity: 1 }]);
      const results = await Promise.all([
        checkout(a.person, a.quote.id),
        checkout(b.person, b.quote.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409);
      expect(errorOf(loser?.body).code).toBe("OUT_OF_STOCK");
      expect((await stockRow(shop)).stockReserved).toBe(1);
      const slot = await slotRow(a.quote.fulfillment.slotId);
      expect(slot.reserved + slot.confirmed).toBe(1);

      const tiny = await makeCafe("Tiny", { capacity: 1 });
      const c = await quoted(tiny);
      const d = await quoted(tiny);
      expect(c.quote.fulfillment.slotId).toBe(d.quote.fulfillment.slotId);
      const raced = await Promise.all([
        checkout(c.person, c.quote.id),
        checkout(d.person, d.quote.id),
      ]);
      expect(raced.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(errorOf(raced.find((r) => r.status === 409)?.body).code).toBe("SLOT_FULL");
      const full = await slotRow(c.quote.fulfillment.slotId);
      expect({ reserved: full.reserved, confirmed: full.confirmed }).toEqual({
        reserved: 0,
        confirmed: 1,
      });
      // A new quote for the full slot is refused up front.
      const e = await world.person();
      const ec = cartRequiredResponseSchema.parse(
        (await startCart(e, tiny.branch.id).expect(200)).body,
      ).data;
      const ei = cartRequiredResponseSchema.parse(
        (await addItem(e, ec.version, { productId: tiny.croissant.id, quantity: 1 }).expect(201))
          .body,
      ).data;
      const late = await world
        .post("/v1/quotes", e.token, {
          cartId: ei.id,
          cartVersion: ei.version,
          mode: "in_store",
          slotId: c.quote.fulfillment.slotId,
        })
        .expect(409);
      expect(errorOf(late.body).code).toBe("SLOT_FULL");

      // A double tap on the same quote creates one order and one charge.
      const f = await quoted(cafe);
      const charges = provider.chargesCreated;
      const taps = await Promise.all([
        checkout(f.person, f.quote.id),
        checkout(f.person, f.quote.id),
      ]);
      expect(taps.map((t) => t.status)).toEqual([201, 201]);
      expect(new Set(taps.map((t) => t.body.data.orderId)).size).toBe(1);
      expect(provider.chargesCreated).toBe(charges + 1);
      expect(await world.prisma.order.count({ where: { quoteId: f.quote.id } })).toBe(1);
    });

    it("keeps holds after a failed payment and retries as a new attempt (Q06 failure and retry)", async () => {
      const shop = await makeCafe("Retry", { croissantStock: 1 });
      const { person, quote } = await quoted(shop, [{ productId: shop.croissant.id, quantity: 1 }]);
      const key = randomUUID();
      const failed = checkoutResponseSchema.parse(
        (await checkout(person, quote.id, { sandboxOutcome: "fail" }, key).expect(201)).body,
      ).data;
      expect(failed).toMatchObject({
        status: "pending_payment",
        payment: { attempt: 1, status: "failed", retryable: true },
      });
      // Not visible as a paid order; holds kept for the retry.
      expect((await slotRow(quote.fulfillment.slotId)).reserved).toBe(1);
      expect((await stockRow(shop)).stockReserved).toBe(1);

      // The same key replays the same answer and does not retry.
      const replay = await checkout(person, quote.id, { sandboxOutcome: "fail" }, key).expect(201);
      expect(replay.body).toEqual(
        (await checkout(person, quote.id, { sandboxOutcome: "fail" }, key)).body,
      );
      expect(await world.prisma.payment.count({ where: { orderId: failed.orderId } })).toBe(1);

      const retried = checkoutResponseSchema.parse(
        (await checkout(person, quote.id, { sandboxOutcome: "succeed" }).expect(201)).body,
      ).data;
      expect(retried).toMatchObject({
        orderId: failed.orderId,
        status: "received",
        payment: { attempt: 2, status: "captured" },
      });
      const payments = await world.prisma.payment.findMany({
        where: { orderId: failed.orderId },
        orderBy: { attempt: "asc" },
      });
      expect(payments.map((p) => [p.attempt, p.status, p.providerKey])).toEqual([
        [1, "failed", `order:${failed.orderId}:1`],
        [2, "captured", `order:${failed.orderId}:2`],
      ]);
      const slot = await slotRow(quote.fulfillment.slotId);
      expect({ reserved: slot.reserved, confirmed: slot.confirmed }).toEqual({
        reserved: 0,
        confirmed: 1,
      });
      // Captured orders never take another attempt.
      await checkout(person, quote.id, { sandboxOutcome: "succeed" }).expect(201);
      expect(await world.prisma.payment.count({ where: { orderId: failed.orderId } })).toBe(2);
    });

    it("waits on a pending payment without charging again, then settles (Q06 pending)", async () => {
      const { person, quote } = await quoted(cafe);
      const charges = provider.chargesCreated;
      const pending = checkoutResponseSchema.parse(
        (await checkout(person, quote.id, { sandboxOutcome: "pending" }).expect(201)).body,
      ).data;
      expect(pending).toMatchObject({
        status: "pending_payment",
        payment: { attempt: 1, status: "pending", retryable: false },
      });
      const again = checkoutResponseSchema.parse(
        (await checkout(person, quote.id, { sandboxOutcome: "succeed" }).expect(201)).body,
      ).data;
      expect(again.payment).toMatchObject({ attempt: 1, status: "pending" });
      expect(provider.chargesCreated).toBe(charges + 1);

      const payment = await world.prisma.payment.findFirstOrThrow({
        where: { orderId: pending.orderId },
      });
      provider.settle(payment.providerRef ?? "", "captured");
      await reconciler.sweep();
      const detail = orderResponseSchema.parse(
        (await world.get(`/v1/orders/${pending.orderId}`, person.token).expect(200)).body,
      ).data;
      expect(detail).toMatchObject({ status: "received", payment: { status: "captured" } });
    });

    it("releases expired holds only after asking the provider, and refunds a late capture", async () => {
      const shop = await makeCafe("Expiry", { croissantStock: 2 });
      const { person, quote, cart } = await quoted(shop, [
        { productId: shop.croissant.id, quantity: 2 },
      ]);
      const pending = checkoutResponseSchema.parse(
        (await checkout(person, quote.id, { sandboxOutcome: "pending" }).expect(201)).body,
      ).data;
      expect((await stockRow(shop)).stockReserved).toBe(2);
      const order = await world.prisma.order.findUniqueOrThrow({ where: { id: pending.orderId } });
      await world.prisma.reservation.update({
        where: { id: order.reservationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await reconciler.sweep();
      const after = await world.prisma.order.findUniqueOrThrow({
        where: { id: pending.orderId },
        include: { reservation: true, events: { orderBy: { seq: "asc" } } },
      });
      expect(after.status).toBe("payment_failed");
      expect(after.reservation.state).toBe("released");
      expect(after.events.at(-1)).toMatchObject({
        fromState: "pending_payment",
        toState: "payment_failed",
        reason: "payment_unconfirmed_at_expiry",
      });
      expect((await stockRow(shop)).stockReserved).toBe(0);
      expect((await slotRow(quote.fulfillment.slotId)).reserved).toBe(0);
      // The customer gets the cart back to try again.
      const restored = cartResponseSchema.parse(
        (await world.get("/v1/cart", person.token)).body,
      ).data;
      expect(restored).toMatchObject({ id: cart.id, items: [{ quantity: 2 }] });

      // The provider captures late (Q08): the order stays failed and the payment is refunded
      // in full automatically (phase 7).
      const payment = await world.prisma.payment.findFirstOrThrow({
        where: { orderId: pending.orderId },
      });
      provider.settle(payment.providerRef ?? "", "captured");
      await reconciler.refresh(pending.orderId);
      expect(
        (await world.prisma.order.findUniqueOrThrow({ where: { id: pending.orderId } })).status,
      ).toBe("payment_failed");
      const refunds = await world.prisma.refund.findMany({ where: { paymentId: payment.id } });
      expect(refunds.map((r) => [r.kind, r.status, r.amountFils])).toEqual([
        ["late_capture", "succeeded", payment.amountFils],
      ]);

      // Checking out the old quote again gives the final state and charges nothing.
      const charges = provider.chargesCreated;
      const final = checkoutResponseSchema.parse(
        (await checkout(person, quote.id).expect(201)).body,
      ).data;
      expect(final).toMatchObject({ status: "payment_failed", payment: { retryable: false } });
      expect(provider.chargesCreated).toBe(charges);
    });

    it("does not retry a failed payment after the hold expired", async () => {
      const { person, quote } = await quoted(cafe);
      const failed = checkoutResponseSchema.parse(
        (await checkout(person, quote.id, { sandboxOutcome: "fail" }).expect(201)).body,
      ).data;
      const order = await world.prisma.order.findUniqueOrThrow({ where: { id: failed.orderId } });
      await world.prisma.reservation.update({
        where: { id: order.reservationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const retry = checkoutResponseSchema.parse(
        (await checkout(person, quote.id, { sandboxOutcome: "succeed" }).expect(201)).body,
      ).data;
      expect(retry).toMatchObject({
        status: "payment_failed",
        payment: { attempt: 1, status: "failed", retryable: false },
      });
      expect(await world.prisma.payment.count({ where: { orderId: failed.orderId } })).toBe(1);
      const events = await world.prisma.orderEvent.findMany({
        where: { orderId: failed.orderId },
        orderBy: { seq: "asc" },
      });
      expect(events.at(-1)?.reason).toBe("payment_not_completed");
    });
  });

  describe("database guards", () => {
    it("allows one active cart per customer and one captured payment per order", async () => {
      const me = await world.person();
      await world.prisma.cart.create({ data: { userId: me.user.id, branchId: cafe.branch.id } });
      await expect(
        world.prisma.cart.create({ data: { userId: me.user.id, branchId: other.branch.id } }),
      ).rejects.toThrow();

      const { person, quote } = await quoted(cafe);
      const done = checkoutResponseSchema.parse(
        (await checkout(person, quote.id).expect(201)).body,
      ).data;
      await expect(
        world.prisma.payment.create({
          data: {
            orderId: done.orderId,
            attempt: 2,
            provider: "fake",
            providerKey: `order:${done.orderId}:2`,
            amountFils: 1700n,
            currency: "AED",
            status: "captured",
          },
        }),
      ).rejects.toThrow();
      await expect(
        world.prisma.orderItem.deleteMany({ where: { orderId: done.orderId } }),
      ).rejects.toThrow(/append-only/);
    });
  });
});
