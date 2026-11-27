import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  adminCancelOrderResponseSchema,
  adminCancellationListResponseSchema,
  adminCancellationResponseSchema,
  arrivalResponseSchema,
  cancelResponseSchema,
  cartRequiredResponseSchema,
  checkoutResponseSchema,
  errorResponseSchema,
  merchantOrderListResponseSchema,
  merchantOrderResponseSchema,
  orderResponseSchema,
  orderUpdatedEventSchema,
  publicSlotsResponseSchema,
  quoteResponseSchema,
  receiptResponseSchema,
  vehicleResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FulfillmentService } from "../src/fulfillment/fulfillment.service.js";
import type { AdminRoleName } from "../src/generated/prisma/client.js";
import { OutboxWorkerService } from "../src/outbox/outbox-worker.service.js";
import { RealtimeService } from "../src/realtime/realtime.service.js";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";

const allWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  opens: new Date("1970-01-01T00:00:00Z"),
  closes: new Date("1970-01-01T23:59:00Z"),
}));

type Person = Awaited<ReturnType<MerchantWorld["person"]>>;

describe("phase 8: fulfilment (queue, staff steps, curbside, handoff, cancellations)", () => {
  let world: MerchantWorld;
  let fulfillment: FulfillmentService;
  let shop: Awaited<ReturnType<typeof createShop>>;
  let barista: Person;
  let barista2: Person;
  let otherBarista: Person;
  let analyst: Person;
  let ops: { userId: string; token: string };

  const http = () => request(world.app.getHttpServer());
  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

  function post(path: string, token: string, body: object, key: string | null = randomUUID()) {
    const req = http().post(path).set("Authorization", `Bearer ${token}`);
    if (key) req.set("Idempotency-Key", key);
    return req.send(body);
  }
  const get = (path: string, token: string) =>
    http().get(path).set("Authorization", `Bearer ${token}`);

  async function admin(roles: AdminRoleName[]) {
    const user = await world.prisma.user.create({ data: { authSubject: `adm-${randomUUID()}` } });
    for (const role of roles)
      await world.prisma.adminRole.create({ data: { userId: user.id, role } });
    return {
      userId: user.id,
      token: await world.issuer.token({ sub: user.authSubject, aal: "aal2" }),
    };
  }

  async function createShop() {
    const merchant = await world.prisma.merchant.create({
      data: {
        legalName: "Fulfilment LLC",
        brandName: `Queue ${randomUUID().slice(0, 6)}`,
        licenseNumber: `FUL-${randomUUID().slice(0, 12)}`,
        status: "approved",
      },
    });
    const branch = async (name: string) =>
      world.prisma.branch.create({
        data: {
          merchantId: merchant.id,
          nameEn: name,
          address: "1 Test Street, Abu Dhabi",
          city: "abu_dhabi",
          modes: ["in_store", "curbside"],
          capacity: 50,
          status: "active",
          hours: { create: allWeek },
        },
      });
    const main = await branch("Queue Corniche");
    const other = await branch("Queue Marina");
    const category = await world.prisma.category.create({
      data: { merchantId: merchant.id, nameEn: "Bakery" },
    });
    const croissant = await world.prisma.product.create({
      data: {
        merchantId: merchant.id,
        categoryId: category.id,
        names: { en: "Croissant" },
        baseFils: 1200n,
        status: "published",
      },
    });
    // Tracked stock, to see holds released on rejection and consumed on handoff.
    await world.prisma.branchProduct.create({
      data: {
        branchId: main.id,
        productId: croissant.id,
        merchantId: merchant.id,
        stockOnHand: 500,
      },
    });
    return { merchant, branch: main, other, croissant };
  }

  /** A paid order (captured by the sandbox provider), received by the branch. */
  async function paidOrder(mode: "in_store" | "curbside" = "in_store", quantity = 2) {
    const person = await world.person();
    const cart = cartRequiredResponseSchema.parse(
      (await world.put("/v1/cart", person.token, { branchId: shop.branch.id }).expect(200)).body,
    ).data;
    const filled = cartRequiredResponseSchema.parse(
      (
        await world
          .post("/v1/cart/items", person.token, {
            productId: shop.croissant.id,
            quantity,
            expectedVersion: cart.version,
          })
          .expect(201)
      ).body,
    ).data;
    const slots = publicSlotsResponseSchema.parse(
      (
        await http()
          .get(`/v1/branches/${shop.branch.id}/slots?date=${dubaiDate(1)}&mode=${mode}`)
          .expect(200)
      ).body,
    ).data.slots;
    let vehicleId: string | undefined;
    if (mode === "curbside") {
      vehicleId = vehicleResponseSchema.parse(
        (
          await world
            .post("/v1/vehicles", person.token, { plate: "A 12345", color: "White" })
            .expect(201)
        ).body,
      ).data.id;
    }
    const quote = quoteResponseSchema.parse(
      (
        await world
          .post("/v1/quotes", person.token, {
            cartId: filled.id,
            cartVersion: filled.version,
            mode,
            slotId: slots[0]?.id,
            ...(vehicleId && { vehicleId }),
          })
          .expect(201)
      ).body,
    ).data;
    const result = checkoutResponseSchema.parse(
      (
        await post("/v1/checkout", person.token, {
          quoteId: quote.id,
          sandboxOutcome: "succeed",
        }).expect(201)
      ).body,
    ).data;
    expect(result.status).toBe("received");
    return { person, orderId: result.orderId, version: result.version, slotId: slots[0]?.id ?? "" };
  }

  const staffView = async (orderId: string, token = barista.token) =>
    merchantOrderResponseSchema.parse(
      (await get(`/v1/merchant/orders/${orderId}`, token).expect(200)).body,
    ).data;
  const customerView = async (orderId: string, token: string) =>
    orderResponseSchema.parse((await get(`/v1/orders/${orderId}`, token).expect(200)).body).data;

  function step(
    orderId: string,
    body: object,
    token = barista.token,
    key: string | null = randomUUID(),
  ) {
    return post(`/v1/merchant/orders/${orderId}/transition`, token, body, key);
  }
  async function walk(orderId: string, upTo: "accepted" | "preparing" | "ready") {
    let version = (await staffView(orderId)).version;
    const actions: object[] = [{ action: "accept", etaMinutes: 10 }];
    if (upTo !== "accepted") actions.push({ action: "start" });
    if (upTo === "ready") actions.push({ action: "ready" });
    for (const action of actions) {
      version = merchantOrderResponseSchema.parse(
        (await step(orderId, { ...action, expectedVersion: version }).expect(200)).body,
      ).data.version;
    }
    return version;
  }
  const refundsOf = (orderId: string) =>
    world.prisma.refund.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
  const stock = () =>
    world.prisma.branchProduct.findFirstOrThrow({
      where: { branchId: shop.branch.id, productId: shop.croissant.id },
    });
  const slotOf = (id: string) => world.prisma.slot.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    world = await MerchantWorld.create();
    fulfillment = world.app.get(FulfillmentService);
    shop = await createShop();
    barista = await world.person({
      merchantId: shop.merchant.id,
      role: "barista",
      branchIds: [shop.branch.id],
    });
    barista2 = await world.person({
      merchantId: shop.merchant.id,
      role: "barista",
      branchIds: [shop.branch.id],
    });
    otherBarista = await world.person({
      merchantId: shop.merchant.id,
      role: "barista",
      branchIds: [shop.other.id],
    });
    analyst = await world.person({
      merchantId: shop.merchant.id,
      role: "analyst",
      branchIds: [shop.branch.id],
    });
    ops = await admin(["operations"]);
    await world.prisma.policy.upsert({
      where: { type_version: { type: "commission", version: "sandbox-v1" } },
      create: {
        type: "commission",
        version: "sandbox-v1",
        effectiveAt: new Date("2026-01-01T00:00:00Z"),
        configuration: { sandbox: true, rateBasisPoints: 1000 },
      },
      update: {},
    });
  });
  afterAll(() => world.close());

  it("runs a complete test order end to end: pay, accept, prepare, ready, hand over", async () => {
    const before = await stock();
    const { person, orderId, slotId } = await paidOrder("in_store", 2);
    const slotBefore = await slotOf(slotId);

    // The customer sees the handoff code; the queue shows the order with an acceptance deadline.
    const mine = await customerView(orderId, person.token);
    expect(mine.status).toBe("received");
    expect(mine.pickupCode).toMatch(/^\d{6}$/);
    const queue = merchantOrderListResponseSchema.parse(
      (await get(`/v1/merchant/orders?branchId=${shop.branch.id}`, barista.token).expect(200)).body,
    ).data;
    const queued = queue.find((o) => o.id === orderId);
    expect(queued?.acceptBy).not.toBeNull();
    expect(queued?.items[0]?.quantity).toBe(2);
    expect(JSON.stringify(queued)).not.toContain(person.email); // operational data only

    const version = await walk(orderId, "ready");
    const wrong = mine.pickupCode === "000000" ? "000001" : "000000";
    const bad = await step(orderId, {
      action: "complete",
      expectedVersion: version,
      pickupCode: wrong,
    }).expect(422);
    expect(errorOf(bad.body).fieldErrors).toHaveProperty("pickupCode");
    const done = merchantOrderResponseSchema.parse(
      (
        await step(orderId, {
          action: "complete",
          expectedVersion: version,
          pickupCode: mine.pickupCode ?? "",
        }).expect(200)
      ).body,
    ).data;
    expect(done.status).toBe("completed");

    const after = await customerView(orderId, person.token);
    expect(after.timeline.map((e) => e.toState)).toEqual([
      "pending_payment",
      "received",
      "accepted",
      "preparing",
      "ready",
      "completed",
    ]);
    expect(after.etaAt).not.toBeNull();
    expect(after.pickupCode).toBeNull(); // not shown once handed over
    // Stock leaves the shelf; the slot place stays used; the merchant's earning is posted.
    const left = await stock();
    expect(left.stockOnHand).toBe((before.stockOnHand ?? 0) - 2);
    expect(left.stockReserved).toBe(before.stockReserved);
    expect((await slotOf(slotId)).confirmed).toBe(slotBefore.confirmed);
    const journals = await world.prisma.journalTransaction.findMany({
      where: { sourceId: orderId, eventType: "completed" },
    });
    expect(journals).toHaveLength(1);

    const receipt = receiptResponseSchema.parse(
      (await get(`/v1/orders/${orderId}/receipt`, person.token).expect(200)).body,
    ).data;
    expect(receipt).toMatchObject({
      status: "completed",
      paidFils: "2400",
      refundedFils: "0",
      taxInvoice: false,
    });
    expect(receipt.items[0]).toMatchObject({ quantity: 2, unitFils: "1200", totalFils: "2400" });
  });

  describe("access", () => {
    it("scopes the queue to the caller's branches and roles", async () => {
      const { person, orderId } = await paidOrder();
      await get(`/v1/merchant/orders/${orderId}`, otherBarista.token).expect(404);
      await get(`/v1/merchant/orders?branchId=${shop.branch.id}`, otherBarista.token).expect(404);
      await get(`/v1/merchant/orders/${orderId}`, analyst.token).expect(403);
      await get(`/v1/merchant/orders/${orderId}`, person.token).expect(404);
      const version = (await staffView(orderId)).version;
      await step(
        orderId,
        { action: "accept", etaMinutes: 5, expectedVersion: version },
        otherBarista.token,
      ).expect(404);
      // Another customer cannot see, check in, cancel or get a receipt for this order.
      const stranger = await world.person();
      await get(`/v1/orders/${orderId}/receipt`, stranger.token).expect(404);
      await post(`/v1/orders/${orderId}/cancel-requests`, stranger.token, {
        reason: "Not mine",
      }).expect(404);
      await post(`/v1/orders/${orderId}/arrival`, stranger.token, {
        expectedVersion: version,
      }).expect(404);
      // Unknown actions and missing fields are refused.
      await step(orderId, { action: "teleport", expectedVersion: version }).expect(400);
      await step(orderId, { action: "accept", expectedVersion: version }).expect(400);
      await step(orderId, { action: "accept", etaMinutes: 121, expectedVersion: version }).expect(
        400,
      );
      await step(
        orderId,
        { action: "accept", etaMinutes: 5, expectedVersion: version },
        barista.token,
        null,
      ).expect(400);
    });

    it("never shows unpaid orders to staff", async () => {
      const person = await world.person();
      const cart = cartRequiredResponseSchema.parse(
        (await world.put("/v1/cart", person.token, { branchId: shop.branch.id }).expect(200)).body,
      ).data;
      const filled = cartRequiredResponseSchema.parse(
        (
          await world
            .post("/v1/cart/items", person.token, {
              productId: shop.croissant.id,
              quantity: 1,
              expectedVersion: cart.version,
            })
            .expect(201)
        ).body,
      ).data;
      const slots = publicSlotsResponseSchema.parse(
        (
          await http().get(
            `/v1/branches/${shop.branch.id}/slots?date=${dubaiDate(1)}&mode=in_store`,
          )
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
      const pending = checkoutResponseSchema.parse(
        (
          await post("/v1/checkout", person.token, {
            quoteId: quote.id,
            sandboxOutcome: "pending",
          }).expect(201)
        ).body,
      ).data;
      expect(pending.status).toBe("pending_payment");
      await get(`/v1/merchant/orders/${pending.orderId}`, barista.token).expect(404);
      await get(
        `/v1/merchant/orders?branchId=${shop.branch.id}&status=pending_payment`,
        barista.token,
      ).expect(400);
      await get(`/v1/orders/${pending.orderId}/receipt`, person.token).expect(409);
    });
  });

  describe("Q10 two tablets, Q17 reconnect", () => {
    it("lets only one tablet accept; the other gets a stale-version conflict", async () => {
      const { orderId, version } = await paidOrder();
      const [a, b] = await Promise.all([
        step(orderId, { action: "accept", etaMinutes: 5, expectedVersion: version }, barista.token),
        step(
          orderId,
          { action: "accept", etaMinutes: 7, expectedVersion: version },
          barista2.token,
        ),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(errorOf(loser.body).code).toBe("CONFLICT");
      expect(errorOf(loser.body).fieldErrors?.expectedVersion?.[0]).toContain(String(version + 1));
      const events = await world.prisma.orderEvent.count({
        where: { orderId, toState: "accepted" },
      });
      expect(events).toBe(1);
    });

    it("replays a retried step after reconnecting without applying it twice", async () => {
      const { orderId, version } = await paidOrder();
      const key = randomUUID();
      const body = { action: "accept", etaMinutes: 5, expectedVersion: version };
      const first = await step(orderId, body, barista.token, key).expect(200);
      const replay = await step(orderId, body, barista.token, key).expect(200);
      expect(replay.body).toEqual(first.body);
      // A new attempt with the old version (an offline tablet's queued tap) is refused.
      const stale = await step(orderId, body).expect(409);
      expect(errorOf(stale.body).code).toBe("CONFLICT");
      // The canonical queue shows the order once, accepted, at the new version.
      const queue = merchantOrderListResponseSchema
        .parse(
          (await get(`/v1/merchant/orders?branchId=${shop.branch.id}`, barista.token).expect(200))
            .body,
        )
        .data.filter((o) => o.id === orderId);
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ status: "accepted", version: version + 1 });
      // No skipping: ready straight from accepted is not allowed.
      const skip = await step(orderId, { action: "ready", expectedVersion: version + 1 }).expect(
        409,
      );
      expect(errorOf(skip.body).code).toBe("INVALID_TRANSITION");
    });
  });

  describe("Q09 branch rejects or does not answer", () => {
    it("rejection ends the order, gives back the slot place and stock, and refunds in full", async () => {
      const before = await stock();
      const { person, orderId, version, slotId } = await paidOrder("in_store", 3);
      const held = await stock();
      expect(held.stockReserved).toBe(before.stockReserved + 3);
      const slotHeld = await slotOf(slotId);
      await step(orderId, { action: "reject", expectedVersion: version }).expect(400); // reason required
      const res = merchantOrderResponseSchema.parse(
        (
          await step(orderId, {
            action: "reject",
            reason: "Oven broken",
            expectedVersion: version,
          }).expect(200)
        ).body,
      ).data;
      expect(res.status).toBe("rejected");
      expect((await stock()).stockReserved).toBe(before.stockReserved);
      expect((await slotOf(slotId)).confirmed).toBe(slotHeld.confirmed - 1);
      const [refund] = await refundsOf(orderId);
      expect(refund).toMatchObject({
        kind: "order_cancelled",
        status: "succeeded",
        amountFils: 3600n,
      });
      const mine = await customerView(orderId, person.token);
      expect(mine.refunds[0]).toMatchObject({
        kind: "order_cancelled",
        status: "succeeded",
        amountFils: "3600",
      });
      expect(mine.pickupCode).toBeNull();
      // Terminal: nothing moves it again, and the database refuses it too.
      await step(orderId, { action: "accept", etaMinutes: 5, expectedVersion: res.version }).expect(
        409,
      );
      await expect(
        world.prisma.order.update({
          where: { id: orderId },
          data: { status: "accepted", version: { increment: 1 } },
        }),
      ).rejects.toThrow();
      const receipt = receiptResponseSchema.parse(
        (await get(`/v1/orders/${orderId}/receipt`, person.token).expect(200)).body,
      ).data;
      expect(receipt).toMatchObject({ status: "rejected", refundedFils: "3600" });
    });

    it("cancels and refunds orders nobody accepted in time; a late accept loses", async () => {
      const { orderId, version } = await paidOrder();
      const row = await world.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(row.acceptBy).not.toBeNull();
      const late = new Date((row.acceptBy?.getTime() ?? 0) + 1000);
      expect(await fulfillment.sweepAcceptanceTimeouts(late)).toBeGreaterThanOrEqual(1);
      const order = await world.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { events: { orderBy: { seq: "desc" }, take: 1 } },
      });
      expect(order.status).toBe("cancelled");
      expect(order.events[0]?.reason).toBe("acceptance_timeout");
      const [refund] = await refundsOf(orderId);
      expect(refund).toMatchObject({ kind: "order_cancelled", status: "succeeded" });
      await step(orderId, { action: "accept", etaMinutes: 5, expectedVersion: version }).expect(
        409,
      );
      // Sweeping again does nothing more.
      await fulfillment.sweepAcceptanceTimeouts(late);
      expect(await refundsOf(orderId)).toHaveLength(1);
    });

    it("refuses an accept after the deadline even before the sweep runs", async () => {
      const { orderId, version } = await paidOrder();
      await world.prisma.order.update({
        where: { id: orderId },
        data: { acceptBy: new Date(Date.now() - 1000) },
      });
      const res = await step(orderId, {
        action: "accept",
        etaMinutes: 5,
        expectedVersion: version,
      }).expect(409);
      expect(errorOf(res.body).code).toBe("INVALID_TRANSITION");
    });
  });

  describe("Q11 curbside check-in and handoff", () => {
    it("records one arrival, one acknowledgement and one completion; wrong codes are denied", async () => {
      const { person, orderId, version } = await paidOrder("curbside", 1);
      // Not before the branch accepts.
      const early = await post(`/v1/orders/${orderId}/arrival`, person.token, {
        expectedVersion: version,
      }).expect(409);
      expect(errorOf(early.body).code).toBe("INVALID_TRANSITION");
      const accepted = await walk(orderId, "accepted");
      const staff = await staffView(orderId);
      expect(staff.vehicle).toMatchObject({ plate: "A 12345", color: "White" });

      const [a, b] = await Promise.all([
        post(`/v1/orders/${orderId}/arrival`, person.token, { expectedVersion: accepted }),
        post(`/v1/orders/${orderId}/arrival`, person.token, { expectedVersion: accepted }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const arrivalA = arrivalResponseSchema.parse(a.body).data;
      const arrivalB = arrivalResponseSchema.parse(b.body).data;
      expect(arrivalA.arrivedAt).not.toBeNull();
      expect(arrivalB.arrivedAt).toBe(arrivalA.arrivedAt);
      expect(arrivalA.version).toBe(accepted + 1); // bumped once
      // A later repeat with an old version still answers the same arrival.
      const again = arrivalResponseSchema.parse(
        (
          await post(`/v1/orders/${orderId}/arrival`, person.token, { expectedVersion: 1 }).expect(
            200,
          )
        ).body,
      ).data;
      expect(again.arrivedAt).toBe(arrivalA.arrivedAt);

      const ack1 = merchantOrderResponseSchema.parse(
        (
          await post(`/v1/merchant/orders/${orderId}/ack-arrival`, barista.token, {
            expectedVersion: accepted + 1,
          }).expect(200)
        ).body,
      ).data;
      const ack2 = merchantOrderResponseSchema.parse(
        (
          await post(`/v1/merchant/orders/${orderId}/ack-arrival`, barista2.token, {
            expectedVersion: accepted + 1,
          }).expect(200)
        ).body,
      ).data;
      expect(ack2.arrival.acknowledgedAt).toBe(ack1.arrival.acknowledgedAt);
      expect(ack2.version).toBe(ack1.version);

      let v = ack1.version;
      for (const action of ["start", "ready"]) {
        v = merchantOrderResponseSchema.parse(
          (await step(orderId, { action, expectedVersion: v }).expect(200)).body,
        ).data.version;
      }
      const code = (await customerView(orderId, person.token)).pickupCode ?? "";
      const wrong = code === "123456" ? "654321" : "123456";
      await step(orderId, { action: "complete", expectedVersion: v, pickupCode: wrong }).expect(
        422,
      );
      const [c1, c2] = await Promise.all([
        step(orderId, { action: "complete", expectedVersion: v, pickupCode: code }, barista.token),
        step(orderId, { action: "complete", expectedVersion: v, pickupCode: code }, barista2.token),
      ]);
      expect([c1.status, c2.status].sort()).toEqual([200, 409]);
      expect(
        await world.prisma.orderEvent.count({ where: { orderId, toState: "completed" } }),
      ).toBe(1);
      expect(
        await world.prisma.journalTransaction.count({
          where: { sourceId: orderId, eventType: "completed" },
        }),
      ).toBe(1);
    });

    it("locks handoff for a while after five wrong codes", async () => {
      const { person, orderId } = await paidOrder();
      const v = await walk(orderId, "ready");
      const code = (await customerView(orderId, person.token)).pickupCode ?? "";
      const wrong = code === "111111" ? "222222" : "111111";
      for (let i = 0; i < 4; i += 1) {
        await step(orderId, { action: "complete", expectedVersion: v, pickupCode: wrong }).expect(
          422,
        );
      }
      const locked = await step(orderId, {
        action: "complete",
        expectedVersion: v,
        pickupCode: wrong,
      }).expect(429);
      expect(errorOf(locked.body).code).toBe("RATE_LIMITED");
      // Even the right code waits until the lock ends.
      await step(orderId, { action: "complete", expectedVersion: v, pickupCode: code }).expect(429);
      expect((await staffView(orderId)).status).toBe("ready");
    });

    it("refuses check-in for pickup at the counter", async () => {
      const { person, orderId } = await paidOrder("in_store");
      const v = await walk(orderId, "accepted");
      await post(`/v1/orders/${orderId}/arrival`, person.token, { expectedVersion: v }).expect(422);
    });
  });

  describe("Q12 cancellations", () => {
    it("cancels and refunds at once before acceptance", async () => {
      const { person, orderId } = await paidOrder();
      const res = cancelResponseSchema.parse(
        (
          await post(`/v1/orders/${orderId}/cancel-requests`, person.token, {
            reason: "Changed my mind",
          }).expect(201)
        ).body,
      ).data;
      expect(res).toMatchObject({ outcome: "cancelled", orderStatus: "cancelled" });
      expect(res.request.status).toBe("approved");
      expect(res.refund).toMatchObject({
        kind: "order_cancelled",
        status: "succeeded",
        amountFils: "2400",
      });
    });

    it("after acceptance creates a support request and changes neither order nor money", async () => {
      const { person, orderId } = await paidOrder();
      await walk(orderId, "preparing");
      const first = cancelResponseSchema.parse(
        (
          await post(`/v1/orders/${orderId}/cancel-requests`, person.token, {
            reason: "Running late",
          }).expect(201)
        ).body,
      ).data;
      expect(first).toMatchObject({ outcome: "review", orderStatus: "preparing", refund: null });
      expect(first.request).toMatchObject({ status: "open", orderStatus: "preparing" });
      const repeat = cancelResponseSchema.parse(
        (
          await post(`/v1/orders/${orderId}/cancel-requests`, person.token, {
            reason: "Please cancel",
          }).expect(201)
        ).body,
      ).data;
      expect(repeat.request.id).toBe(first.request.id);
      expect(await refundsOf(orderId)).toHaveLength(0);
      expect((await staffView(orderId)).cancellationRequested).toBe(true);
      expect((await customerView(orderId, person.token)).cancellationRequest?.status).toBe("open");

      // Operations: support can read the list, only operations can decide.
      const support = await admin(["support"]);
      const list = adminCancellationListResponseSchema.parse(
        (await get("/v1/admin/cancellation-requests?status=open", support.token).expect(200)).body,
      ).data;
      expect(list.some((r) => r.id === first.request.id)).toBe(true);
      await post(`/v1/admin/cancellation-requests/${first.request.id}/decline`, support.token, {
        reason: "No",
      }).expect(403);
      const declined = adminCancellationResponseSchema.parse(
        (
          await post(`/v1/admin/cancellation-requests/${first.request.id}/decline`, ops.token, {
            reason: "Drink already being made",
          }).expect(200)
        ).body,
      ).data;
      expect(declined.status).toBe("declined");
      await post(`/v1/admin/cancellation-requests/${first.request.id}/decline`, ops.token, {
        reason: "Again",
      }).expect(409);
      expect((await staffView(orderId)).status).toBe("preparing");
      expect(await refundsOf(orderId)).toHaveLength(0);
    });

    it("operations can cancel an accepted order; the refund is left to finance", async () => {
      const { person, orderId } = await paidOrder();
      const v = await walk(orderId, "accepted");
      await post(`/v1/orders/${orderId}/cancel-requests`, person.token, {
        reason: "Wrong branch",
      }).expect(201);
      await post(`/v1/admin/orders/${orderId}/cancel`, barista.token, {
        reason: "Checked",
        expectedVersion: v + 1,
      }).expect(403);
      await post(`/v1/admin/orders/${orderId}/cancel`, ops.token, {
        reason: "Checked",
        expectedVersion: v,
      }).expect(409);
      const res = adminCancelOrderResponseSchema.parse(
        (
          await post(`/v1/admin/orders/${orderId}/cancel`, ops.token, {
            reason: "Customer at wrong branch",
            expectedVersion: v + 1,
          }).expect(200)
        ).body,
      ).data;
      expect(res).toMatchObject({ status: "cancelled", refund: null });
      expect(await refundsOf(orderId)).toHaveLength(0);
      const request = (await customerView(orderId, person.token)).cancellationRequest;
      expect(request?.status).toBe("approved");
      const audit = await world.prisma.auditEvent.findFirst({
        where: { targetId: orderId, action: "order.cancelled" },
      });
      expect(audit?.actorId).toBe(ops.userId);
    });
  });

  describe("live updates", () => {
    let baseUrl: string;

    beforeAll(async () => {
      await world.app.listen(0, "127.0.0.1");
      const { port } = world.app.getHttpServer().address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    /** Opens an event stream and collects `order.updated` events until `stop()`. */
    async function open(path: string, token: string) {
      const controller = new AbortController();
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      const events: unknown[] = [];
      let resolveNext: (() => void) | undefined;
      const reading = (async () => {
        if (!res.body || res.status !== 200) return;
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          for await (const chunk of res.body) {
            buffer += decoder.decode(chunk as Uint8Array, { stream: true });
            let end;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (!block.includes("event: order.updated")) continue;
              const data = block.split("\n").find((line) => line.startsWith("data: "));
              if (data) events.push(JSON.parse(data.slice(6)));
              resolveNext?.();
            }
          }
        } catch {
          // aborted
        }
      })();
      return {
        status: res.status,
        events,
        next: (count: number) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("no event")), 5000);
            const check = () => {
              if (events.length >= count) {
                clearTimeout(timer);
                resolve();
              }
            };
            resolveNext = check;
            check();
          }),
        stop: async () => {
          controller.abort();
          await reading;
        },
      };
    }

    /** What the outbox worker does with a committed `order.updated` row. */
    async function deliver(orderId: string) {
      const rows = await world.prisma.outboxMessage.findMany({
        where: { topic: "order.updated", aggregateId: orderId },
        orderBy: { createdAt: "asc" },
      });
      const worker = world.app.get(OutboxWorkerService);
      for (const row of rows) await worker.publishOrderUpdate(row.payload);
      return rows.length;
    }

    it("pushes version signals without personal data to the branch and the customer", async () => {
      await world.app.get(RealtimeService).ensureSubscribed();
      const { person, orderId, version } = await paidOrder();
      const branchStream = await open(
        `/v1/merchant/branches/${shop.branch.id}/order-events`,
        barista.token,
      );
      const customerStream = await open(`/v1/orders/${orderId}/events`, person.token);
      try {
        expect([branchStream.status, customerStream.status]).toEqual([200, 200]);
        await step(orderId, { action: "accept", etaMinutes: 5, expectedVersion: version }).expect(
          200,
        );
        const delivered = await deliver(orderId);
        await branchStream.next(1);
        await customerStream.next(delivered);
        const event = orderUpdatedEventSchema.parse(customerStream.events.at(-1));
        expect(event).toMatchObject({ type: "order.updated", orderId, version: version + 1 });
        expect(Object.keys(event).sort()).toEqual(["occurredAt", "orderId", "type", "version"]);
      } finally {
        await branchStream.stop();
        await customerStream.stop();
      }
    });

    it("refuses streams outside the caller's scope", async () => {
      const { orderId } = await paidOrder();
      const stranger = await world.person();
      const other = await open(
        `/v1/merchant/branches/${shop.branch.id}/order-events`,
        otherBarista.token,
      );
      expect(other.status).toBe(404);
      const notMine = await open(`/v1/orders/${orderId}/events`, stranger.token);
      expect(notMine.status).toBe(404);
      const anon = await fetch(`${baseUrl}/v1/orders/${orderId}/events`);
      expect(anon.status).toBe(401);
      await other.stop();
      await notMine.stop();
    });
  });
});
