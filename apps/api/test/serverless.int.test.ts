import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service.js";
import { OutboxWorkerService } from "../src/outbox/outbox-worker.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { RealtimeService } from "../src/realtime/realtime.service.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";

const CRON_SECRET = "c".repeat(48);

/**
 * Serverless hosting (cycle 3): no Redis, no background loops. Scheduled work runs from a
 * protected cron endpoint and live updates go through Supabase Realtime Broadcast.
 */
describe("cron tick", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp(testEnv({ CRON_SECRET }));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers 404 without the scheduler's secret, so the route reveals nothing", async () => {
    await request(app.getHttpServer()).get("/v1/internal/cron/tick").expect(404);
    await request(app.getHttpServer())
      .get("/v1/internal/cron/tick")
      .set("Authorization", `Bearer ${"x".repeat(48)}`)
      .expect(404);
    await request(app.getHttpServer())
      .get("/v1/internal/cron/tick")
      .set("Authorization", CRON_SECRET)
      .expect(404);
  });

  it("dispatches pending events and purges expired rate-limit counters", async () => {
    await prisma.outboxMessage.updateMany({
      where: { state: "pending" },
      data: { state: "failed" },
    });
    const dedupeKey = `cron-${randomUUID()}`;
    await prisma.$transaction((tx) =>
      app.get(OutboxService).enqueue(tx, {
        topic: "order.updated",
        aggregateId: randomUUID(),
        dedupeKey,
        payload: {
          orderId: randomUUID(),
          branchId: randomUUID(),
          userId: randomUUID(),
          version: 2,
          occurredAt: new Date().toISOString(),
        },
      }),
    );
    await prisma.$executeRaw`INSERT INTO rate_limit_counters (key, count, expires_at)
      VALUES (${`old-${randomUUID()}`}, 3, now() - interval '1 minute')`;

    const response = await request(app.getHttpServer())
      .get("/v1/internal/cron/tick")
      .set("Authorization", `Bearer ${CRON_SECRET}`)
      .expect(200);
    expect(response.body.data.dispatched).toBeGreaterThanOrEqual(1);
    expect(response.body.data.purgedRateLimits).toBeGreaterThanOrEqual(1);
    const row = await prisma.outboxMessage.findUniqueOrThrow({ where: { dedupeKey } });
    expect(row.state).toBe("dispatched");

    // A second, overlapping or late tick never handles the same event again.
    await request(app.getHttpServer())
      .get("/v1/internal/cron/tick")
      .set("Authorization", `Bearer ${CRON_SECRET}`)
      .expect(200);
    const after = await prisma.outboxMessage.findUniqueOrThrow({ where: { dedupeKey } });
    expect(after).toMatchObject({ state: "dispatched", attempts: 1 });
  });

  it("is off entirely when no secret is configured", async () => {
    const off = await createTestApp(testEnv());
    try {
      await request(off.getHttpServer())
        .get("/v1/internal/cron/tick")
        .set("Authorization", "Bearer ")
        .expect(404);
    } finally {
      await off.close();
    }
  });
});

describe("rate limits without Redis", () => {
  it("count exactly across concurrent requests through PostgreSQL", async () => {
    const app = await createTestApp(
      testEnv({ RATE_LIMIT_ENABLED: "true", DEV_AUTH_ENABLED: "true" }),
    );
    try {
      const prisma = app.get(PrismaService);
      // The development sign-in list is limited to 60 a minute per IP.
      await prisma.$executeRaw`DELETE FROM rate_limit_counters WHERE key LIKE 'rl:dev-auth:%'`;
      const statuses = await Promise.all(
        Array.from({ length: 70 }, () =>
          request(app.getHttpServer())
            .get("/v1/dev-auth/accounts")
            .then((r) => r.status),
        ),
      );
      const limited = statuses.filter((s) => s === 429).length;
      const ok = statuses.filter((s) => s === 200).length;
      // At most 60 succeed per one-minute window (two windows if the burst straddles a boundary).
      expect(ok + limited).toBe(70);
      expect(ok === 60 || (ok > 60 && ok <= 70)).toBe(true);
      expect(limited).toBe(70 - ok);
    } finally {
      await app.close();
    }
  });
});

describe("live updates through Supabase Realtime Broadcast", () => {
  let server: Server;
  let base: string;
  const received: { headers: IncomingMessage["headers"]; body: unknown }[] = [];
  let failNext = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      req.on("end", () => {
        if (req.url !== "/realtime/v1/api/broadcast") {
          res.writeHead(404).end();
          return;
        }
        if (failNext) {
          failNext = false;
          res.writeHead(503).end();
          return;
        }
        received.push({ headers: req.headers, body: JSON.parse(raw) });
        res.writeHead(202).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("broadcasts only the order ID and version on unguessable order and branch channels", async () => {
    const serviceKey = "service-role-key-for-tests-only";
    const app = await createTestApp(
      testEnv({
        REALTIME_DRIVER: "supabase",
        SUPABASE_URL: base,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
        REALTIME_CHANNEL_SECRET: "r".repeat(48),
      }),
    );
    try {
      const realtime = app.get(RealtimeService);
      const signal = {
        orderId: randomUUID(),
        branchId: randomUUID(),
        userId: randomUUID(),
        version: 3,
        occurredAt: new Date().toISOString(),
      };
      await app.get(OutboxWorkerService).publishOrderUpdate(signal);
      const sent = received.at(-1)!;
      expect(sent.headers.apikey).toBe(serviceKey);
      const body = sent.body as { messages: { topic: string; event: string; payload: object }[] };
      expect(body.messages.map((m) => m.topic)).toEqual([
        realtime.channelFor("order", signal.orderId),
        realtime.channelFor("branch", signal.branchId),
      ]);
      for (const message of body.messages) {
        expect(message.event).toBe("order.updated");
        expect(Object.keys(message.payload).sort()).toEqual(["occurredAt", "orderId", "version"]);
        expect(message.topic).not.toContain(signal.orderId);
        expect(message.topic).not.toContain(signal.branchId);
      }
      expect(realtime.subscription("order", signal.orderId)).toEqual({
        url: base,
        channel: realtime.channelFor("order", signal.orderId),
        event: "order.updated",
      });

      // A failed broadcast throws, so the outbox keeps the event and retries it.
      failNext = true;
      await expect(app.get(OutboxWorkerService).publishOrderUpdate(signal)).rejects.toThrow(
        /HTTP 503/,
      );
    } finally {
      await app.close();
    }
  });

  it("hands out no channel when this deployment has no shared live updates", async () => {
    const app = await createTestApp(testEnv());
    try {
      expect(app.get(RealtimeService).subscription("order", randomUUID())).toBeNull();
    } finally {
      await app.close();
    }
  });
});
