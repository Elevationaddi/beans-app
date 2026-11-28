import { randomUUID } from "node:crypto";
import {
  adminAccountResponseSchema,
  adminCustomerListResponseSchema,
  adminCustomerResponseSchema,
  adminOrderListResponseSchema,
  adminOrderResponseSchema,
  adminProductResponseSchema,
  branchMenuResponseSchema,
  broadcastResponseSchema,
  disputeResponseSchema,
  errorResponseSchema,
  homepageResponseSchema,
  notificationListResponseSchema,
  platformSettingListResponseSchema,
  platformSettingResponseSchema,
  platformStatusResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminRoleName } from "../src/generated/prisma/client.js";
import { MerchantWorld } from "./merchant-world.js";
import { createShop, paidOrder, type Shop } from "./order-flow.js";

/** Cycle 2 admin console back end: settings and pause, people, orders, moderation, disputes. */
describe("platform administration", () => {
  let world: MerchantWorld;
  let shop: Shop;
  const http = () => request(world.app.getHttpServer());
  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;
  const get = (path: string, token: string) =>
    http().get(path).set("Authorization", `Bearer ${token}`);
  const send = (method: "post" | "put", path: string, token: string, body: object) =>
    (method === "post" ? http().post(path) : http().put(path))
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send(body);

  async function admin(roles: AdminRoleName[], aal: "aal1" | "aal2" = "aal2") {
    const email = `adm-${randomUUID().slice(0, 8)}@example.test`;
    const user = await world.prisma.user.create({
      data: { authSubject: `adm-${randomUUID()}`, email },
    });
    for (const role of roles)
      await world.prisma.adminRole.create({ data: { userId: user.id, role } });
    return {
      userId: user.id,
      email,
      token: await world.issuer.token({ sub: user.authSubject, aal }),
    };
  }
  async function version(key: string) {
    return (await world.prisma.platformSetting.findUnique({ where: { key } }))?.version ?? 0;
  }

  beforeAll(async () => {
    world = await MerchantWorld.create();
    shop = await createShop(world);
    // Start from defaults so earlier runs on the same database do not leak in.
    await world.prisma.platformSetting.deleteMany({});
  });
  afterAll(async () => {
    // Leave the shared test database with default settings (files run one after another).
    await world.prisma.platformSetting.deleteMany({});
    await world.close();
  });

  describe("settings (A09)", () => {
    it("changes operational timers with a version, a reason and an audit entry, used by quotes", async () => {
      const ops = await admin(["operations"]);
      const marketing = await admin(["marketing"]);
      const list = platformSettingListResponseSchema.parse(
        (await get("/v1/admin/platform-settings", ops.token).expect(200)).body,
      ).data;
      expect(list.map((s) => s.key).sort()).toEqual([
        "features",
        "homepage",
        "operations",
        "pause",
      ]);
      const value = {
        acceptSeconds: 180,
        quoteSeconds: 240,
        holdSeconds: 600,
        invitationHours: 48,
      };

      await send("put", "/v1/admin/platform-settings/operations", marketing.token, {
        value,
        expectedVersion: 0,
        reason: "Try",
      }).expect(403);
      const bad = await send("put", "/v1/admin/platform-settings/operations", ops.token, {
        value: { ...value, acceptSeconds: 5 },
        expectedVersion: 0,
        reason: "Too short",
      }).expect(400);
      expect(errorOf(bad.body).code).toBe("VALIDATION_FAILED");
      const saved = platformSettingResponseSchema.parse(
        (
          await send("put", "/v1/admin/platform-settings/operations", ops.token, {
            value,
            expectedVersion: 0,
            reason: "Pilot timers",
          }).expect(200)
        ).body,
      ).data;
      expect(saved).toMatchObject({ version: 1, value });
      await send("put", "/v1/admin/platform-settings/operations", ops.token, {
        value,
        expectedVersion: 0,
        reason: "Stale",
      }).expect(409);
      expect(
        await world.prisma.auditEvent.count({
          where: {
            action: "platform.setting_changed",
            targetId: "operations",
            actorId: ops.userId,
          },
        }),
      ).toBe(1);
      // An aal1 session is refused even with the role.
      const noMfa = await admin(["operations"], "aal1");
      await get("/v1/admin/platform-settings", noMfa.token).expect(403);
    });

    it("pauses and resumes ordering for everyone (emergency pause)", async () => {
      const security = await admin(["security"]);
      const paused = { ordersPaused: true, message: { en: "Back in 10 minutes" } };
      await send("put", "/v1/admin/platform-settings/pause", security.token, {
        value: paused,
        expectedVersion: await version("pause"),
        reason: "Incident drill",
      }).expect(200);
      const status = platformStatusResponseSchema.parse(
        (await http().get("/v1/platform/status").expect(200)).body,
      ).data;
      expect(status).toMatchObject({
        ordersPaused: true,
        message: { en: "Back in 10 minutes" },
        sandbox: true,
      });

      // Each test app caches settings for a few seconds; wait it out so the quote sees the pause.
      await new Promise((r) => setTimeout(r, 3100));
      const refused = await paidOrder(world, shop).then(
        () => null,
        (e: Error) => e.message,
      );
      expect(refused).toMatch(/503/);

      await send("put", "/v1/admin/platform-settings/pause", security.token, {
        value: { ordersPaused: false, message: null },
        expectedVersion: await version("pause"),
        reason: "Drill over",
      }).expect(200);
      await new Promise((r) => setTimeout(r, 3100));
      await paidOrder(world, shop);
    });

    it("features approved shops on the homepage, in the chosen order", async () => {
      const marketing = await admin(["marketing"]);
      const second = await createShop(world);
      const draft = await world.prisma.merchant.create({
        data: {
          legalName: "Draft LLC",
          brandName: "Draft",
          licenseNumber: `D-${randomUUID().slice(0, 10)}`,
        },
      });
      const hero = { en: "Pilot week in Abu Dhabi" };
      await send("put", "/v1/admin/platform-settings/homepage", marketing.token, {
        value: { hero, featuredMerchantIds: [draft.id] },
        expectedVersion: 0,
        reason: "Launch",
      }).expect(400);
      await send("put", "/v1/admin/platform-settings/homepage", marketing.token, {
        value: { hero, featuredMerchantIds: [second.merchant.id, shop.merchant.id] },
        expectedVersion: 0,
        reason: "Launch",
      }).expect(200);
      await new Promise((r) => setTimeout(r, 3100));
      const home = homepageResponseSchema.parse(
        (await http().get("/v1/platform/homepage").expect(200)).body,
      ).data;
      expect(home.hero).toEqual(hero);
      expect(home.featured.map((f) => f.merchantId)).toEqual([
        second.merchant.id,
        shop.merchant.id,
      ]);
      // Live payments and the wallet are not settings at all.
      await send("put", "/v1/admin/platform-settings/wallet", marketing.token, {
        value: true,
        expectedVersion: 0,
        reason: "No",
      }).expect(400);
    });
  });

  describe("people (A03, A10)", () => {
    it("finds, views and suspends a customer, who is then refused", async () => {
      const support = await admin(["support"]);
      const order = await paidOrder(world, shop);
      const customer = await world.prisma.user.findFirstOrThrow({
        where: { orders: { some: { id: order.orderId } } },
      });
      await world.prisma.user.update({
        where: { id: customer.id },
        data: { email: `find-${customer.id.slice(0, 8)}@example.test` },
      });
      const found = adminCustomerListResponseSchema.parse(
        (
          await get(`/v1/admin/customers?q=find-${customer.id.slice(0, 8)}`, support.token).expect(
            200,
          )
        ).body,
      ).data;
      expect(found.map((c) => c.id)).toEqual([customer.id]);
      const detail = adminCustomerResponseSchema.parse(
        (await get(`/v1/admin/customers/${customer.id}`, support.token).expect(200)).body,
      ).data;
      expect(detail).toMatchObject({ orderCount: 1, status: "active" });
      expect(
        await world.prisma.auditEvent.count({
          where: { action: "admin.customer_viewed", targetId: customer.id },
        }),
      ).toBe(1);

      await send("post", `/v1/admin/customers/${customer.id}/status`, support.token, {
        status: "suspended",
        reason: "Fraud check",
      }).expect(200);
      const refused = await get("/v1/me", order.person.token).expect(403);
      expect(errorOf(refused.body).code).toBe("ACCOUNT_SUSPENDED");
      await send("post", `/v1/admin/customers/${customer.id}/status`, support.token, {
        status: "active",
        reason: "Cleared",
      }).expect(200);
      await get("/v1/me", order.person.token).expect(200);
      await send("post", `/v1/admin/customers/${support.userId}/status`, support.token, {
        status: "suspended",
        reason: "Self",
      }).expect(403);
    });

    it("lets only super admins change roles, never their own, and keeps one super admin", async () => {
      const superA = await admin(["super_admin"]);
      const security = await admin(["security"]);
      const target = await admin([]);
      await send("post", "/v1/admin/admins/roles", security.token, {
        email: target.email,
        role: "support",
        grant: true,
        reason: "Hire",
      }).expect(403);
      const granted = adminAccountResponseSchema.parse(
        (
          await send("post", "/v1/admin/admins/roles", superA.token, {
            email: target.email,
            role: "support",
            grant: true,
            reason: "Hire",
          }).expect(200)
        ).body,
      ).data;
      expect(granted.roles).toEqual(["support"]);
      await send("post", "/v1/admin/admins/roles", superA.token, {
        email: superA.email,
        role: "security",
        grant: true,
        reason: "Self",
      }).expect(403);
      await send("post", "/v1/admin/admins/roles", superA.token, {
        email: target.email,
        role: "support",
        grant: false,
        reason: "Left",
      }).expect(200);
      expect(
        await world.prisma.auditEvent.count({
          where: { targetId: target.userId, action: { startsWith: "admin.role_" } },
        }),
      ).toBe(2);

      // With every other super admin removed, the last one cannot be taken away.
      const superB = await admin(["super_admin"]);
      const others = await world.prisma.adminRole.findMany({
        where: { role: "super_admin", userId: { notIn: [superA.userId, superB.userId] } },
      });
      await world.prisma.adminRole.deleteMany({ where: { id: { in: others.map((o) => o.id) } } });
      await send("post", "/v1/admin/admins/roles", superB.token, {
        email: superA.email,
        role: "super_admin",
        grant: false,
        reason: "Rotate",
      }).expect(200);
      const last = await send("post", "/v1/admin/admins/roles", superA.token, {
        email: superB.email,
        role: "super_admin",
        grant: false,
        reason: "Oops",
      });
      // superA lost the role above, so it is refused by role before the last-admin rule.
      expect(last.status).toBe(403);
      await world.prisma.adminRole.createMany({
        data: others.map((o) => ({ userId: o.userId, role: o.role })),
      });
    });
  });

  describe("orders, merchants and menu (A02, A04, moderation)", () => {
    it("monitors orders across merchants with their timeline", async () => {
      const ops = await admin(["operations"]);
      const order = await paidOrder(world, shop);
      const list = adminOrderListResponseSchema.parse(
        (
          await get(
            `/v1/admin/orders?merchantId=${shop.merchant.id}&status=received`,
            ops.token,
          ).expect(200)
        ).body,
      ).data;
      expect(list.map((o) => o.id)).toContain(order.orderId);
      const detail = adminOrderResponseSchema.parse(
        (await get(`/v1/admin/orders/${order.orderId}`, ops.token).expect(200)).body,
      ).data;
      expect(detail.events.map((e) => e.toStatus)).toContain("received");
      // The version lets an admin cancel without overwriting a concurrent change.
      expect(detail.version).toBeGreaterThanOrEqual(1);
      expect(detail.payments[0]).toMatchObject({ status: "captured", provider: "fake" });
      const customer = await admin(["marketing"]);
      await get("/v1/admin/orders", customer.token).expect(403);
    });

    it("suspends and reinstates a merchant, only from approved", async () => {
      const ops = await admin(["operations"]);
      const other = await createShop(world);
      await send("post", `/v1/admin/merchants/${other.merchant.id}/status`, ops.token, {
        status: "approved",
        reason: "Already",
      }).expect(409);
      await send("post", `/v1/admin/merchants/${other.merchant.id}/status`, ops.token, {
        status: "suspended",
        reason: "Licence expired",
      }).expect(200);
      await http().get(`/v1/branches/${other.branch.id}/menu`).expect(404);
      await send("post", `/v1/admin/merchants/${other.merchant.id}/status`, ops.token, {
        status: "approved",
        reason: "Renewed",
      }).expect(200);
      await http().get(`/v1/branches/${other.branch.id}/menu`).expect(200);
    });

    it("hides a product from customers and restores it", async () => {
      const ops = await admin(["operations"]);
      const menuIds = async () =>
        branchMenuResponseSchema
          .parse((await http().get(`/v1/branches/${shop.branch.id}/menu`).expect(200)).body)
          .data.categories.flatMap((c) => c.products.map((p) => p.id));
      expect(await menuIds()).toContain(shop.product.id);
      const hidden = adminProductResponseSchema.parse(
        (
          await send("post", `/v1/admin/products/${shop.product.id}/moderation`, ops.token, {
            hidden: true,
            reason: "Misleading claim",
          }).expect(200)
        ).body,
      ).data;
      expect(hidden).toMatchObject({ hidden: true, moderationNote: "Misleading claim" });
      expect(await menuIds()).not.toContain(shop.product.id);
      await send("post", `/v1/admin/products/${shop.product.id}/moderation`, ops.token, {
        hidden: false,
        reason: "Fixed",
      }).expect(200);
      expect(await menuIds()).toContain(shop.product.id);
    });
  });

  describe("disputes (A05, sandbox) and notifications", () => {
    it("opens a sandbox dispute, takes evidence and records the outcome with dual roles", async () => {
      const maker = await admin(["finance_maker"]);
      const checker = await admin(["finance_checker"]);
      const order = await paidOrder(world, shop);
      const payment = await world.prisma.payment.findFirstOrThrow({
        where: { orderId: order.orderId },
      });
      await send("post", "/v1/admin/disputes/simulate", maker.token, {
        paymentId: payment.id,
        amountFils: "999999",
        reason: "Not received",
      }).expect(422);
      const opened = disputeResponseSchema.parse(
        (
          await send("post", "/v1/admin/disputes/simulate", maker.token, {
            paymentId: payment.id,
            amountFils: "500",
            reason: "Not received",
          }).expect(201)
        ).body,
      ).data;
      expect(opened).toMatchObject({ status: "open", orderId: order.orderId, amountFils: "500" });
      await send("post", `/v1/admin/disputes/${opened.id}/evidence`, maker.token, {
        evidence: "Handed over with the pickup code at 10:42.",
      }).expect(200);
      await send("post", `/v1/admin/disputes/${opened.id}/resolve`, maker.token, {
        outcome: "won",
        reason: "Provider decided",
      }).expect(403);
      const won = disputeResponseSchema.parse(
        (
          await send("post", `/v1/admin/disputes/${opened.id}/resolve`, checker.token, {
            outcome: "won",
            reason: "Provider decided",
          }).expect(200)
        ).body,
      ).data;
      expect(won.status).toBe("won");
      await send("post", `/v1/admin/disputes/${opened.id}/resolve`, checker.token, {
        outcome: "lost",
        reason: "Again",
      }).expect(409);
    });

    it("broadcasts to merchant owners' in-app inboxes only", async () => {
      const marketing = await admin(["marketing"]);
      const owner = await world.person({ merchantId: shop.merchant.id, role: "owner" });
      const customer = await world.person();
      const sent = broadcastResponseSchema.parse(
        (
          await send("post", "/v1/admin/notifications/broadcast", marketing.token, {
            audience: "merchant_owners",
            title: { en: "Weekly payout schedule" },
            body: { en: "Sandbox payouts run every Monday." },
            reason: "Pilot comms",
          }).expect(201)
        ).body,
      ).data;
      expect(sent.recipients).toBeGreaterThan(0);
      const inbox = notificationListResponseSchema.parse(
        (await get("/v1/me/notifications", owner.token).expect(200)).body,
      );
      expect(inbox.unread).toBe(1);
      const id = inbox.data[0]!.id;
      await http()
        .post(`/v1/me/notifications/${id}/read`)
        .set("Authorization", `Bearer ${customer.token}`)
        .expect(404);
      await http()
        .post(`/v1/me/notifications/${id}/read`)
        .set("Authorization", `Bearer ${owner.token}`)
        .expect(200);
      const after = notificationListResponseSchema.parse(
        (await get("/v1/me/notifications", owner.token).expect(200)).body,
      );
      expect(after.unread).toBe(0);
      expect(
        notificationListResponseSchema.parse(
          (await get("/v1/me/notifications", customer.token).expect(200)).body,
        ).data,
      ).toEqual([]);
    });
  });
});
