import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service.js";
import {
  OUTBOX_PUBLISHER,
  OutboxRelayService,
  type OutboxPublisher,
} from "../src/outbox/outbox-relay.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";

class FakePublisher implements OutboxPublisher {
  published: string[] = [];
  failWith: Error | null = null;
  async publish(message: { dedupeKey: string }) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (this.failWith) throw this.failWith;
    this.published.push(message.dedupeKey);
  }
  async close() {}
}

describe("transactional outbox", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: OutboxService;
  let relay: OutboxRelayService;
  const publisher = new FakePublisher();

  beforeAll(async () => {
    app = await createTestApp(testEnv(), {
      overrides: [{ provide: OUTBOX_PUBLISHER, useValue: publisher }],
    });
    prisma = app.get(PrismaService);
    outbox = app.get(OutboxService);
    relay = app.get(OutboxRelayService);
  });

  beforeEach(async () => {
    publisher.published = [];
    publisher.failWith = null;
    // Park rows left by earlier tests so each test sees only its own.
    await prisma.outboxMessage.updateMany({
      where: { state: "pending" },
      data: { state: "failed" },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const entry = (dedupeKey = `test-${randomUUID()}`) => ({
    topic: "test.event",
    aggregateId: randomUUID(),
    dedupeKey,
    payload: { hello: "world" },
  });

  it("commits the event only with its transaction", async () => {
    const committed = entry();
    const rolledBack = entry();
    await prisma.$transaction((tx) => outbox.enqueue(tx, committed));
    await expect(
      prisma.$transaction(async (tx) => {
        await outbox.enqueue(tx, rolledBack);
        throw new Error("business rule failed");
      }),
    ).rejects.toThrow("business rule failed");
    expect(await prisma.outboxMessage.count({ where: { dedupeKey: committed.dedupeKey } })).toBe(1);
    expect(await prisma.outboxMessage.count({ where: { dedupeKey: rolledBack.dedupeKey } })).toBe(
      0,
    );
  });

  it("enqueues a dedupe key once", async () => {
    const e = entry();
    expect(await prisma.$transaction((tx) => outbox.enqueue(tx, e))).toBe(true);
    expect(await prisma.$transaction((tx) => outbox.enqueue(tx, e))).toBe(false);
  });

  it("dispatches pending rows once and marks them dispatched", async () => {
    const a = entry();
    const b = entry();
    await prisma.$transaction(async (tx) => {
      await outbox.enqueue(tx, a);
      await outbox.enqueue(tx, b);
    });
    expect(await relay.dispatchBatch()).toBe(2);
    expect(await relay.dispatchBatch()).toBe(0);
    expect(publisher.published.sort()).toEqual([a.dedupeKey, b.dedupeKey].sort());
    const rows = await prisma.outboxMessage.findMany({
      where: { dedupeKey: { in: [a.dedupeKey, b.dedupeKey] } },
    });
    expect(rows.every((r) => r.state === "dispatched" && r.attempts === 1)).toBe(true);
  });

  it("concurrent relays never publish the same row twice", async () => {
    const entries = Array.from({ length: 20 }, () => entry());
    await prisma.$transaction(async (tx) => {
      for (const e of entries) await outbox.enqueue(tx, e);
    });
    const counts = await Promise.all([
      relay.dispatchBatch(7),
      relay.dispatchBatch(7),
      relay.dispatchBatch(7),
    ]);
    const rest = await relay.dispatchBatch(50);
    expect(counts.reduce((sum, n) => sum + n, 0) + rest).toBe(20);
    expect(new Set(publisher.published).size).toBe(publisher.published.length);
    expect(publisher.published).toHaveLength(20);
  });

  it("backs off after a publish failure and records the error", async () => {
    const e = entry();
    await prisma.$transaction((tx) => outbox.enqueue(tx, e));
    publisher.failWith = new Error("handler unavailable");
    expect(await relay.dispatchBatch()).toBe(0);
    const row = await prisma.outboxMessage.findUniqueOrThrow({ where: { dedupeKey: e.dedupeKey } });
    expect(row).toMatchObject({ state: "pending", attempts: 1, lastError: "handler unavailable" });
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    // Not retried before the backoff expires.
    publisher.failWith = null;
    expect(await relay.dispatchBatch()).toBe(0);
  });
});

describe("a lease left by a frozen instance", () => {
  it("is picked up again once it expires, so no event is lost", async () => {
    const app = await createTestApp(testEnv(), {
      overrides: [{ provide: OUTBOX_PUBLISHER, useValue: new FakePublisher() }],
    });
    try {
      const prisma = app.get(PrismaService);
      const relay = app.get(OutboxRelayService);
      const publisher = app.get<FakePublisher>(OUTBOX_PUBLISHER);
      await prisma.outboxMessage.updateMany({
        where: { state: "pending" },
        data: { state: "failed" },
      });
      const dedupeKey = `lease-${randomUUID()}`;
      await prisma.$transaction((tx) =>
        app.get(OutboxService).enqueue(tx, {
          topic: "test.event",
          aggregateId: randomUUID(),
          dedupeKey,
          payload: {},
        }),
      );
      // Simulate an instance that leased the row and was frozen before finishing.
      await prisma.outboxMessage.update({
        where: { dedupeKey },
        data: { attempts: 1, nextRunAt: new Date(Date.now() + 60_000) },
      });
      expect(await relay.dispatchBatch()).toBe(0);
      await prisma.outboxMessage.update({
        where: { dedupeKey },
        data: { nextRunAt: new Date(Date.now() - 1_000) },
      });
      expect(await relay.dispatchBatch()).toBe(1);
      expect(publisher.published).toEqual([dedupeKey]);
    } finally {
      await app.close();
    }
  });
});
