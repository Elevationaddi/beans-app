import { randomUUID } from "node:crypto";
import {
  adminDashboardResponseSchema,
  adminReportResponseSchema,
  adminSettingsResponseSchema,
  errorResponseSchema,
  merchantAnalyticsResponseSchema,
  merchantDashboardResponseSchema,
  privacyExportResponseSchema,
  ticketListResponseSchema,
  ticketResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminRoleName } from "../src/generated/prisma/client.js";
import { MerchantWorld } from "./merchant-world.js";
import { completeOrder, createShop, paidOrder, type Shop } from "./order-flow.js";

type Person = Awaited<ReturnType<MerchantWorld["person"]>>;

describe("phase 10: tickets, privacy requests, dashboards, reports, settings", () => {
  let world: MerchantWorld;
  let shopA: Shop;
  let shopB: Shop;
  let ownerA: Person;
  let baristaA: Person;
  let analystA: Person;
  let ownerB: Person;
  let support: { userId: string; token: string };
  let ops: { userId: string; token: string };
  const from = new Date(Date.now() - 3_600_000).toISOString();
  const to = () => new Date(Date.now() + 3_600_000).toISOString();

  const http = () => request(world.app.getHttpServer());
  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;
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

  beforeAll(async () => {
    world = await MerchantWorld.create();
    shopA = await createShop(world, "abu_dhabi");
    shopB = await createShop(world, "dubai");
    ownerA = await world.person({ merchantId: shopA.merchant.id, role: "owner" });
    baristaA = await world.person({
      merchantId: shopA.merchant.id,
      role: "barista",
      branchIds: [shopA.branch.id],
    });
    analystA = await world.person({
      merchantId: shopA.merchant.id,
      role: "analyst",
      branchIds: [shopA.branch.id],
    });
    ownerB = await world.person({ merchantId: shopB.merchant.id, role: "owner" });
    support = await admin(["support"]);
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

  describe("tickets", () => {
    it("links customers to their own orders and hides internal notes", async () => {
      const order = await paidOrder(world, shopA);
      const stranger = await world.person();
      await world
        .post("/v1/tickets", stranger.token, {
          category: "order_issue",
          message: "Where is it?",
          orderId: order.orderId,
        })
        .expect(404);
      const created = ticketResponseSchema.parse(
        (
          await world
            .post("/v1/tickets", order.person.token, {
              category: "order_issue",
              message: "My croissant was cold",
              orderId: order.orderId,
            })
            .expect(201)
        ).body,
      ).data;
      expect(created).toMatchObject({ channel: "customer", status: "open", assigneeId: null });
      await get(`/v1/tickets/${created.id}`, stranger.token).expect(404);

      await world
        .post(`/v1/admin/tickets/${created.id}/messages`, support.token, {
          body: "Customer sounds upset; offer a refund?",
          visibility: "internal",
        })
        .expect(201);
      await world
        .post(`/v1/admin/tickets/${created.id}/messages`, support.token, {
          body: "Sorry about that. We are looking into it.",
        })
        .expect(201);
      const seen = ticketResponseSchema.parse(
        (await get(`/v1/tickets/${created.id}`, order.person.token).expect(200)).body,
      ).data;
      expect(seen.messages.map((m) => m.authorRole)).toEqual(["customer", "support"]);
      expect(JSON.stringify(seen)).not.toContain("offer a refund");
      const full = ticketResponseSchema.parse(
        (await get(`/v1/admin/tickets/${created.id}`, support.token).expect(200)).body,
      ).data;
      expect(full.messages).toHaveLength(3);

      // Customers cannot write internal notes; history is append-only in the database.
      await world
        .post(`/v1/tickets/${created.id}/messages`, order.person.token, {
          body: "secret",
          visibility: "internal",
        })
        .expect(403);
      await expect(
        world.prisma.ticketMessage.updateMany({
          where: { ticketId: created.id },
          data: { body: "edited" },
        }),
      ).rejects.toThrow();

      // Support assigns and resolves (audited); a customer reply reopens it.
      await world
        .patch(`/v1/admin/tickets/${created.id}`, support.token, {
          assigneeId: support.userId,
          status: "resolved",
        })
        .expect(200);
      await world
        .patch(`/v1/admin/tickets/${created.id}`, support.token, { assigneeId: ownerA.user.id })
        .expect(400);
      const reopened = ticketResponseSchema.parse(
        (
          await world
            .post(`/v1/tickets/${created.id}/messages`, order.person.token, { body: "Still cold" })
            .expect(201)
        ).body,
      ).data;
      expect(reopened.status).toBe("open");
      expect(
        await world.prisma.auditEvent.count({
          where: { targetId: created.id, action: "ticket.updated" },
        }),
      ).toBe(1);
      const mine = ticketListResponseSchema.parse(
        (await get("/v1/tickets", order.person.token).expect(200)).body,
      ).data;
      expect(mine.map((t) => t.id)).toEqual([created.id]);
    });

    it("keeps merchant tickets inside the merchant (Q15)", async () => {
      const orderA = await paidOrder(world, shopA);
      // Owner B cannot raise a ticket for merchant A or about A's order.
      await world
        .post("/v1/tickets", ownerB.token, {
          category: "merchant_support",
          message: "Hi",
          merchantId: shopA.merchant.id,
        })
        .expect(404);
      await world
        .post("/v1/tickets", ownerB.token, {
          category: "order_issue",
          message: "Hi",
          merchantId: shopB.merchant.id,
          orderId: orderA.orderId,
        })
        .expect(404);
      // Baristas do not handle merchant support.
      await world
        .post("/v1/tickets", baristaA.token, {
          category: "merchant_support",
          message: "Hi",
          merchantId: shopA.merchant.id,
        })
        .expect(403);
      const ticket = ticketResponseSchema.parse(
        (
          await world
            .post("/v1/tickets", ownerA.token, {
              category: "order_issue",
              message: "Customer did not collect",
              merchantId: shopA.merchant.id,
              orderId: orderA.orderId,
            })
            .expect(201)
        ).body,
      ).data;
      expect(ticket.channel).toBe("merchant");
      await get(`/v1/tickets/${ticket.id}`, ownerB.token).expect(404);
      await get(`/v1/tickets?merchantId=${shopA.merchant.id}`, ownerB.token).expect(404);
      const listed = ticketListResponseSchema.parse(
        (await get(`/v1/tickets?merchantId=${shopA.merchant.id}`, ownerA.token).expect(200)).body,
      ).data;
      expect(listed.some((t) => t.id === ticket.id)).toBe(true);
      // The customer of that order does not see the merchant's ticket.
      await get(`/v1/tickets/${ticket.id}`, orderA.person.token).expect(404);
    });
  });

  describe("Q24 privacy request and redacted export", () => {
    it("creates a scoped, audited request and export", async () => {
      const order = await paidOrder(world, shopA);
      await world
        .post("/v1/vehicles", order.person.token, { plate: "B 7", color: "Blue" })
        .expect(201);
      const res = await world
        .post("/v1/me/privacy-requests", order.person.token, { kind: "access" })
        .expect(201);
      const ticketId = (res.body as { data: { ticketId: string } }).data.ticketId;
      const deletion = await world
        .post("/v1/me/privacy-requests", order.person.token, { kind: "deletion" })
        .expect(201);
      const deletionId = (deletion.body as { data: { ticketId: string } }).data.ticketId;

      // The admin privacy queue lists privacy tickets only.
      const queue = ticketListResponseSchema.parse(
        (await get("/v1/admin/tickets?category=privacy&limit=100", support.token).expect(200)).body,
      ).data;
      expect(queue.map((t) => t.id)).toEqual(expect.arrayContaining([ticketId, deletionId]));
      expect(queue.every((t) => t.category === "privacy")).toBe(true);
      await get("/v1/admin/tickets?category=nonsense", support.token).expect(400);

      await get(`/v1/admin/privacy-requests/${ticketId}/export`, ops.token).expect(403);
      await get(`/v1/admin/privacy-requests/${deletionId}/export`, support.token).expect(400);
      const exported = privacyExportResponseSchema.parse(
        (await get(`/v1/admin/privacy-requests/${ticketId}/export`, support.token).expect(200))
          .body,
      ).data;
      expect(exported.user.id).toBe(order.person.user.id);
      expect(exported.user.email).toBe(order.person.email);
      expect(exported.orders.map((o) => o.id)).toEqual([order.orderId]);
      expect(exported.vehicles).toEqual([{ plate: "B 7", color: "Blue", model: null }]);
      // Only that person's data: nothing about other customers or merchants' staff.
      expect(JSON.stringify(exported)).not.toContain(ownerA.email);
      const audits = await world.prisma.auditEvent.findMany({
        where: { targetId: { in: [ticketId, order.person.user.id] } },
        orderBy: { createdAt: "asc" },
      });
      expect(audits.map((a) => a.action)).toEqual(["privacy.requested", "privacy.exported"]);
      expect(audits[1]?.actorId).toBe(support.userId);
      // Nothing was deleted automatically.
      expect(
        await world.prisma.user.findUnique({ where: { id: order.person.user.id } }),
      ).not.toBeNull();
    });
  });

  describe("dashboards and reports", () => {
    it("merchant metrics reconcile with the raw orders and stay inside the merchant", async () => {
      const shop = await createShop(world);
      const owner = await world.person({ merchantId: shop.merchant.id, role: "owner" });
      const done1 = await paidOrder(world, shop, 2);
      const done2 = await paidOrder(world, shop, 1);
      const waiting = await paidOrder(world, shop, 3);
      await completeOrder(world, done1, owner.token);
      await completeOrder(world, done2, owner.token);
      void waiting;
      const q = `merchantId=${shop.merchant.id}&from=${from}&to=${to()}`;
      const dash = merchantDashboardResponseSchema.parse(
        (await get(`/v1/merchant/dashboard?${q}`, owner.token).expect(200)).body,
      ).data;
      // Rebuild from rows: orders received in the period, completed totals.
      const orders = await world.prisma.order.findMany({ where: { branchId: shop.branch.id } });
      const completed = orders.filter((o) => o.status === "completed");
      const gross = completed.reduce(
        (sum, o) => sum + BigInt((o.totals as { totalFils: string }).totalFils),
        0n,
      );
      expect(dash).toMatchObject({
        paidOrders: orders.length,
        completedOrders: completed.length,
        grossSalesFils: gross.toString(),
        refundedFils: "0",
        netSalesFils: gross.toString(),
        liveQueue: { received: 1, accepted: 0, preparing: 0, ready: 0 },
      });
      expect(dash.paidOrders).toBe(3);
      expect(dash.grossSalesFils).toBe("3600");
      expect(dash.averagePrepSeconds).not.toBeNull();

      const analytics = merchantAnalyticsResponseSchema.parse(
        (await get(`/v1/merchant/analytics?${q}`, owner.token).expect(200)).body,
      ).data;
      expect(analytics.daily.reduce((s, d) => s + d.completedOrders, 0)).toBe(2);
      expect(analytics.products).toEqual([
        { productId: shop.product.id, name: "Flow Croissant", units: 3 },
      ]);

      // Q15: another merchant's owner, a barista, a stranger: refused.
      await get(`/v1/merchant/dashboard?${q}`, ownerB.token).expect(404);
      await get(
        `/v1/merchant/dashboard?merchantId=${shopA.merchant.id}&from=${from}&to=${to()}`,
        baristaA.token,
      ).expect(403);
      await get(
        `/v1/merchant/dashboard?merchantId=${shopA.merchant.id}&branchId=${shop.branch.id}&from=${from}&to=${to()}`,
        ownerA.token,
      ).expect(404);
      // Analysts read only their assigned branches.
      await get(
        `/v1/merchant/analytics?merchantId=${shopA.merchant.id}&from=${from}&to=${to()}`,
        analystA.token,
      ).expect(200);
      const bad = await get(
        `/v1/merchant/dashboard?merchantId=${shop.merchant.id}&from=${to()}&to=${from}`,
        owner.token,
      ).expect(400);
      expect(errorOf(bad.body).fieldErrors).toHaveProperty("to");
    });

    it("admin overview and reports reconcile, filter by city, and are audited", async () => {
      const analyst = await admin(["analyst"]);
      const dash = adminDashboardResponseSchema.parse(
        (await get(`/v1/admin/dashboard?from=${from}&to=${to()}`, analyst.token).expect(200)).body,
      ).data;
      const captured = await world.prisma.payment.aggregate({
        where: { status: "captured", createdAt: { gte: new Date(from) } },
        _sum: { amountFils: true },
      });
      expect(BigInt(dash.gmvFils)).toBe(captured._sum.amountFils ?? 0n);
      const dubai = adminDashboardResponseSchema.parse(
        (
          await get(`/v1/admin/dashboard?from=${from}&to=${to()}&city=dubai`, analyst.token).expect(
            200,
          )
        ).body,
      ).data;
      expect(BigInt(dubai.gmvFils)).toBeLessThanOrEqual(BigInt(dash.gmvFils));
      await get(`/v1/admin/dashboard?from=${from}&to=${to()}`, support.token).expect(403);

      const report = adminReportResponseSchema.parse(
        (
          await get(
            `/v1/admin/reports?report=orders_by_merchant&from=${from}&to=${to()}`,
            analyst.token,
          ).expect(200)
        ).body,
      ).data;
      expect(report.totals.count).toBe(report.rows.reduce((s, r) => s + r.count, 0));
      expect(report.totals.count).toBe(dash.paidOrders);
      expect(JSON.stringify(report)).not.toMatch(/@example\.test/);
      expect(
        await world.prisma.auditEvent.count({
          where: { actorId: analyst.userId, action: "report.viewed" },
        }),
      ).toBe(1);
    });

    it("shows the settings in force, all phase-two features off", async () => {
      const settings = adminSettingsResponseSchema.parse(
        (await get("/v1/admin/settings", ops.token).expect(200)).body,
      ).data;
      expect(settings.features).toEqual({
        livePayments: false,
        rewards: false,
        gifts: false,
        dineIn: false,
        promoCodes: false,
        wallet: false,
      });
      expect(settings.timeouts.acceptSeconds).toBe(120);
      expect(settings.policies.find((p) => p.type === "commission")?.sandbox).toBe(true);
      await get("/v1/admin/settings", support.token).expect(403);
    });
  });

  describe("Q16 revoked staff and suspended merchant", () => {
    it("revoked staff can do nothing more; a suspended merchant takes no new orders", async () => {
      const shop = await createShop(world);
      const barista = await world.person({
        merchantId: shop.merchant.id,
        role: "barista",
        branchIds: [shop.branch.id],
      });
      const order = await paidOrder(world, shop);
      await get(`/v1/merchant/orders/${order.orderId}`, barista.token).expect(200);
      await world.prisma.membership.update({
        where: { id: barista.membership?.id ?? "" },
        data: { status: "revoked" },
      });
      await get(`/v1/merchant/orders/${order.orderId}`, barista.token).expect(404);
      await http()
        .post(`/v1/merchant/orders/${order.orderId}/transition`)
        .set("Authorization", `Bearer ${barista.token}`)
        .set("Idempotency-Key", randomUUID())
        .send({ action: "accept", etaMinutes: 5, expectedVersion: order.version })
        .expect(404);

      await world.prisma.merchant.update({
        where: { id: shop.merchant.id },
        data: { status: "suspended" },
      });
      // Customers cannot find or order from it any more.
      await http().get(`/v1/branches/${shop.branch.id}`).expect(404);
      const customer = await world.person();
      const cart = await world.put("/v1/cart", customer.token, { branchId: shop.branch.id });
      expect(cart.status).toBe(404);
      // Its staff are locked out too, even the owner's queue.
      const owner = await world.person({ merchantId: shop.merchant.id, role: "owner" });
      await get(`/v1/merchant/orders?branchId=${shop.branch.id}`, owner.token).expect(404);
    });
  });
});
