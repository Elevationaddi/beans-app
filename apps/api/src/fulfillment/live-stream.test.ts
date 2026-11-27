import type { MessageEvent } from "@nestjs/common";
import { Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import { parseSignal, type OrderSignal } from "../realtime/realtime.service.js";
import { liveStream } from "./live-stream.js";

const signal: OrderSignal = {
  orderId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  version: 4,
  occurredAt: "2026-11-27T10:00:00.000Z",
};

describe("live order stream", () => {
  it("starts with a heartbeat and sends updates without personal data", () => {
    const signals = new Subject<OrderSignal>();
    const seen: MessageEvent[] = [];
    const sub = liveStream(signals, async () => undefined, 60_000).subscribe((e) => seen.push(e));
    signals.next(signal);
    sub.unsubscribe();
    expect(seen[0]?.type).toBe("heartbeat");
    expect(seen[1]).toEqual({
      type: "order.updated",
      id: `${signal.orderId}:4`,
      data: {
        type: "order.updated",
        orderId: signal.orderId,
        version: 4,
        occurredAt: signal.occurredAt,
      },
    });
    expect(JSON.stringify(seen[1])).not.toContain(signal.userId);
    expect(JSON.stringify(seen[1])).not.toContain(signal.branchId);
  });

  it("ends quietly once the subscriber loses access", async () => {
    const signals = new Subject<OrderSignal>();
    let allowed = true;
    const done = new Promise<void>((resolve, reject) => {
      liveStream(
        signals,
        async () => {
          if (!allowed) throw new Error("gone");
        },
        5,
      ).subscribe({ complete: () => resolve(), error: reject });
    });
    allowed = false;
    await expect(done).resolves.toBeUndefined();
  });

  it("ignores malformed realtime messages", () => {
    expect(parseSignal(signal)).toEqual(signal);
    expect(parseSignal({ ...signal, version: "4" })).toBeNull();
    expect(parseSignal(null)).toBeNull();
    expect(parseSignal({ orderId: signal.orderId })).toBeNull();
  });
});
