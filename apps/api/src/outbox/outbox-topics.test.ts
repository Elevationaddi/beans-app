import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OutboxWorkerService } from "./outbox-worker.service.js";

/** Every `topic: "…"` literal enqueued anywhere in the API source. */
function enqueuedTopics(dir: string, found = new Set<string>()): Set<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "generated" || name.endsWith(".test.ts")) continue;
    if (statSync(path).isDirectory()) enqueuedTopics(path, found);
    else if (name.endsWith(".ts")) {
      for (const m of readFileSync(path, "utf8").matchAll(/topic:\s*"([a-z_]+\.[a-z_.]+)"/g)) {
        found.add(m[1]!);
      }
    }
  }
  return found;
}

describe("outbox topics", () => {
  it("has a handler or an explicit acknowledgement for every topic the API enqueues", async () => {
    const calls: string[] = [];
    const worker = new OutboxWorkerService(
      { scan: async () => void calls.push("scan") } as never,
      { publish: async () => void calls.push("realtime") } as never,
      { deleteAuthUser: async () => "skipped" } as never,
    );
    const topics = [...enqueuedTopics(join(import.meta.dirname, ".."))];
    expect(topics.length).toBeGreaterThan(5);
    for (const topic of topics) {
      const payload = {
        orderId: "o",
        branchId: "b",
        userId: "u",
        version: 1,
        occurredAt: new Date().toISOString(),
      };
      await expect(
        worker.publish({ topic, aggregateId: "a", payload }),
        `topic ${topic}`,
      ).resolves.toBeUndefined();
    }
    await expect(
      worker.publish({ topic: "unknown.topic", aggregateId: "a", payload: {} }),
    ).rejects.toThrow(/No handler/);
  });
});
