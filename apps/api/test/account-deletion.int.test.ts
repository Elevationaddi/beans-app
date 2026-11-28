import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { deleteAccountResponseSchema, errorResponseSchema } from "@beans/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseAdminService } from "../src/auth/supabase-admin.service.js";
import { OutboxWorkerService } from "../src/outbox/outbox-worker.service.js";
import { MerchantWorld } from "./merchant-world.js";
import { completeOrder, createShop, paidOrder } from "./order-flow.js";

/** Cycle 3: customers can delete their own account (email sign-in, no support ticket). */
describe("self-service account deletion", () => {
  let world: MerchantWorld;
  let server: Server;
  let base: string;
  const calls: {
    method: string | undefined;
    url: string | undefined;
    headers: IncomingMessage["headers"];
  }[] = [];
  let status = 200;

  beforeAll(async () => {
    world = await MerchantWorld.create();
    server = createServer((req, res) => {
      calls.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(status).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await world.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it("needs the typed confirmation", async () => {
    const person = await world.person();
    await world.post("/v1/me/deletion", person.token, {}).expect(400);
    await world.post("/v1/me/deletion", person.token, { confirm: "delete" }).expect(400);
    const user = await world.prisma.user.findUniqueOrThrow({ where: { id: person.user.id } });
    expect(user.status).toBe("active");
  });

  it("removes personal details, keeps orders, refuses the old sign-in and queues sign-in deletion", async () => {
    const shop = await createShop(world);
    const order = await paidOrder(world, shop);
    const { person } = order;
    await world.prisma.user.update({
      where: { id: person.user.id },
      data: { displayName: "Fictional Customer", phone: "+971500000000" },
    });
    await world.prisma.favorite.create({
      data: { userId: person.user.id, merchantId: shop.merchant.id },
    });

    // An order in progress blocks deletion, so refunds and handover still reach the person.
    const blocked = await world
      .post("/v1/me/deletion", person.token, { confirm: "DELETE" })
      .expect(409);
    expect(errorResponseSchema.parse(blocked.body).error.code).toBe("CONFLICT");

    const staff = await world.person({ merchantId: shop.merchant.id, role: "owner" });
    await completeOrder(world, order, staff.token);
    const response = await world
      .post("/v1/me/deletion", person.token, { confirm: "DELETE" })
      .expect(200);
    expect(deleteAccountResponseSchema.parse(response.body).data.deleted).toBe(true);

    const user = await world.prisma.user.findUniqueOrThrow({ where: { id: person.user.id } });
    expect(user).toMatchObject({ status: "deleted", displayName: null, email: null, phone: null });
    expect(await world.prisma.favorite.count({ where: { userId: person.user.id } })).toBe(0);
    // Orders and the financial journal stay for retention.
    const kept = await world.prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(kept.status).toBe("completed");
    const audit = await world.prisma.auditEvent.findFirst({
      where: { targetId: person.user.id, action: "user.account_deleted" },
    });
    expect(audit).not.toBeNull();
    const queued = await world.prisma.outboxMessage.findUniqueOrThrow({
      where: { dedupeKey: `account.deleted:${person.user.id}` },
    });
    expect(queued.payload).toEqual({ authSubject: person.user.authSubject });

    // The same token no longer works, and a second deletion cannot run.
    await world.get("/v1/me", person.token).expect(403);
    await world.post("/v1/me/deletion", person.token, { confirm: "DELETE" }).expect(403);
  });

  it("refuses while the account has business or admin access", async () => {
    const { merchant } = await world.tenant("Deletion");
    const owner = await world.person({ merchantId: merchant.id, role: "owner" });
    await world.post("/v1/me/deletion", owner.token, { confirm: "DELETE" }).expect(409);

    const admin = await world.person();
    await world.prisma.adminRole.create({ data: { userId: admin.user.id, role: "support" } });
    await world.post("/v1/me/deletion", admin.token, { confirm: "DELETE" }).expect(409);
  });

  it("deletes the Supabase sign-in with the server key, treating 'already gone' as done", async () => {
    const admin = new SupabaseAdminService({
      ...world.app.get(SupabaseAdminService)["env"],
      SUPABASE_URL: base,
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-tests-only",
    });
    const subject = "0b6a3f1e-7c55-4d5e-9a51-2f0f6a3c9d11";
    status = 200;
    await expect(admin.deleteAuthUser(subject)).resolves.toBe("deleted");
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: `/auth/v1/admin/users/${subject}`,
    });
    expect(calls.at(-1)!.headers.apikey).toBe("service-role-key-for-tests-only");
    status = 404;
    await expect(admin.deleteAuthUser(subject)).resolves.toBe("deleted");
    // Any other failure throws so the outbox keeps the event and retries.
    status = 500;
    await expect(admin.deleteAuthUser(subject)).rejects.toThrow(/HTTP 500/);
    // Seed and development accounts have no Supabase user.
    const before = calls.length;
    await expect(admin.deleteAuthUser("seed-customer-1")).resolves.toBe("skipped");
    expect(calls.length).toBe(before);
  });

  it("runs the queued event through the outbox worker", async () => {
    await expect(
      world.app.get(OutboxWorkerService).publish({
        topic: "account.deleted",
        aggregateId: "x",
        payload: { authSubject: "dev-123" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      world.app.get(OutboxWorkerService).publish({
        topic: "account.deleted",
        aggregateId: "x",
        payload: {},
      }),
    ).rejects.toThrow(/authSubject/);
  });
});
