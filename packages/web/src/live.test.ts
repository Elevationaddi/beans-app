import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { subscribeToLiveChannel, type StreamState } from "./events";

/**
 * A stand-in for Supabase Realtime speaking the Phoenix protocol the real client uses
 * (serializer 1.0.0 objects or 2.0.0 arrays). It accepts channel joins and lets the test push
 * a Broadcast message, or drop every connection to force a reconnect.
 */
function fakeRealtime() {
  const http: Server = createServer();
  const wss = new WebSocket.Server({ server: http, path: "/realtime/v1/websocket" });
  const sockets = new Set<{ ws: WebSocket; v2: boolean; topics: Set<string> }>();
  const send = (
    client: { ws: WebSocket; v2: boolean },
    joinRef: string | null,
    ref: string | null,
    topic: string,
    event: string,
    payload: unknown,
  ) =>
    client.ws.send(
      JSON.stringify(
        client.v2 ? [joinRef, ref, topic, event, payload] : { topic, event, payload, ref },
      ),
    );
  wss.on("connection", (ws, req) => {
    const v2 = new URL(req.url!, "http://x").searchParams.get("vsn") === "2.0.0";
    const client = { ws, v2, topics: new Set<string>() };
    sockets.add(client);
    ws.on("close", () => sockets.delete(client));
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as unknown;
      const [joinRef, ref, topic, event] = Array.isArray(message)
        ? (message as [string | null, string | null, string, string])
        : [
            (message as { join_ref?: string }).join_ref ?? null,
            (message as { ref: string }).ref,
            (message as { topic: string }).topic,
            (message as { event: string }).event,
          ];
      if (event === "phx_join") {
        client.topics.add(topic);
        send(client, joinRef, ref, topic, "phx_reply", {
          status: "ok",
          response: { postgres_changes: [] },
        });
      } else if (event === "heartbeat" || event === "access_token" || event === "phx_leave") {
        send(client, null, ref, topic, "phx_reply", { status: "ok", response: {} });
      }
    });
  });
  return {
    http,
    broadcast(channel: string, event: string, payload: object) {
      const topic = `realtime:${channel}`;
      for (const client of sockets) {
        if (client.topics.has(topic)) {
          send(client, null, null, topic, "broadcast", { type: "broadcast", event, payload });
        }
      }
    },
    dropAll() {
      for (const client of sockets) client.ws.terminate();
    },
    get connections() {
      return sockets.size;
    },
  };
}

const until = async (check: () => boolean, ms = 8000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("live order channel (Supabase Realtime Broadcast)", () => {
  const fake = fakeRealtime();
  let url: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => fake.http.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(fake.http.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => fake.http.close(resolve));
  });

  it("joins the channel, refetches on each signal and again after a reconnect", async () => {
    const supabase = createClient(url, "anon-key-for-tests", {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { reconnectAfterMs: () => 50, transport: WebSocket as never },
    });
    const states: StreamState[] = [];
    let signals = 0;
    const stop = subscribeToLiveChannel(
      supabase,
      { url, channel: "order-abc123", event: "order.updated" },
      { onSignal: () => (signals += 1), onState: (s) => states.push(s) },
    );
    try {
      await until(() => states.at(-1) === "live");
      expect(signals).toBe(0);

      // Another event name or another channel is ignored.
      fake.broadcast("order-abc123", "something.else", {});
      fake.broadcast("order-other", "order.updated", {});
      fake.broadcast("order-abc123", "order.updated", { orderId: "o", version: 2 });
      await until(() => signals === 1);

      // Connection lost: the client rejoins by itself and the screen refetches once.
      fake.dropAll();
      await until(() => states.includes("reconnecting") || states.includes("offline"));
      await until(() => states.at(-1) === "live" && signals === 2);
      fake.broadcast("order-abc123", "order.updated", { orderId: "o", version: 3 });
      await until(() => signals === 3);
    } finally {
      stop();
      await supabase.removeAllChannels();
      supabase.realtime.disconnect();
    }
  });
});
