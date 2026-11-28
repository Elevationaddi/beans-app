"use client";
import { liveSubscriptionResponseSchema, type LiveSubscription } from "@beans/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";

export type StreamState = "connecting" | "live" | "reconnecting" | "offline";

/**
 * Server-sent events over fetch, so the bearer token travels in a header (EventSource cannot
 * send one). Reconnects with backoff; `onEvent` receives each parsed `data:` payload and
 * `onReconnect` lets the screen refetch canonical state after a gap (docs/05 T06).
 */
export function useEventStream(
  path: string | null,
  onEvent: (data: unknown) => void,
  onReconnect?: () => void,
): StreamState {
  const { api, session } = useAuth();
  const [state, setState] = useState<StreamState>("connecting");
  const handlers = useRef({ onEvent, onReconnect });
  handlers.current = { onEvent, onReconnect };

  useEffect(() => {
    if (!path || !session) return;
    let stopped = false;
    let attempt = 0;
    let controller = new AbortController();

    const run = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          setState(attempt === 0 ? "connecting" : "reconnecting");
          const response = await fetch(api.url(path), {
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
              Accept: "text/event-stream",
            },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
          if (attempt > 0) handlers.current.onReconnect?.();
          attempt = 0;
          setState("live");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let index: number;
            while ((index = buffer.indexOf("\n\n")) >= 0) {
              const chunk = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);
              const data = chunk
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("\n");
              if (!data) continue;
              try {
                handlers.current.onEvent(JSON.parse(data));
              } catch {
                // Not JSON (heartbeat comment): ignore.
              }
            }
          }
        } catch (error) {
          if (stopped || (error as Error).name === "AbortError") return;
        }
        attempt += 1;
        setState(navigator.onLine ? "reconnecting" : "offline");
        await new Promise((r) => setTimeout(r, Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4))));
      }
    };
    void run();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [path, session, api]);

  return state;
}

/**
 * Live order signals with the database as the source of truth (cycle 3).
 *
 * Asks the API for this screen's channel (`livePath`). On serverless hosting that is a Supabase
 * Realtime Broadcast channel with an unguessable name; each signal carries only an order ID and
 * version, so the screen refetches from the API (`onChange`). Without shared live updates (local
 * development) it falls back to the API's event stream at `streamPath`. Whatever the transport,
 * callers keep polling: slowly while "live", quickly otherwise (see `livePollMs`).
 */
export function useLiveUpdates(options: {
  livePath: string | null;
  streamPath: string | null;
  onChange: () => void;
}): StreamState {
  const { api, session, supabase } = useAuth();
  const [subscription, setSubscription] = useState<LiveSubscription | undefined>(undefined);
  const [realtimeState, setRealtimeState] = useState<StreamState>("connecting");
  const onChange = useRef(options.onChange);
  onChange.current = options.onChange;

  // Which transport? Undefined while asking; null when the deployment has no shared channel.
  useEffect(() => {
    setSubscription(undefined);
    if (!options.livePath || !session) return;
    const controller = new AbortController();
    api
      .get(options.livePath, liveSubscriptionResponseSchema, undefined, controller.signal)
      .then((res) => setSubscription(res.data))
      .catch(() => {
        // Could not ask (offline, server error): rely on the event stream and polling.
        if (!controller.signal.aborted) setSubscription(null);
      });
    return () => controller.abort();
  }, [options.livePath, session, api]);

  const useRealtime = Boolean(subscription && supabase);
  useEffect(() => {
    if (!subscription || !supabase) return;
    setRealtimeState("connecting");
    return subscribeToLiveChannel(supabase, subscription, {
      onSignal: () => onChange.current(),
      onState: setRealtimeState,
    });
  }, [subscription, supabase]);

  // The event stream only when the API says there is no shared channel (local development): on
  // serverless hosting a held-open stream would occupy a function, so polling covers the gap.
  const streamState = useEventStream(
    subscription === null ? options.streamPath : null,
    () => onChange.current(),
    () => onChange.current(),
  );
  if (useRealtime) return realtimeState;
  if (subscription === undefined) return "connecting";
  return subscription === null ? streamState : "reconnecting";
}

/** Polling interval for a live screen: a slow safety net while live, faster when not. */
export function livePollMs(state: StreamState, liveMs = 60_000, fallbackMs = 10_000): number {
  return state === "live" ? liveMs : fallbackMs;
}

/**
 * Joins one Supabase Realtime Broadcast channel. `onSignal` runs for each order signal and once
 * more after every rejoin, because signals sent while disconnected are not replayed. Returns
 * the cleanup function.
 */
export function subscribeToLiveChannel(
  supabase: Pick<SupabaseClient, "channel" | "removeChannel">,
  subscription: NonNullable<LiveSubscription>,
  handlers: { onSignal: () => void; onState: (state: StreamState) => void },
): () => void {
  let joinedBefore = false;
  const channel = supabase
    .channel(subscription.channel, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: subscription.event }, () => handlers.onSignal())
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        if (joinedBefore) handlers.onSignal();
        joinedBefore = true;
        handlers.onState("live");
      } else if (status === "CLOSED") {
        handlers.onState("offline");
      } else {
        // CHANNEL_ERROR or TIMED_OUT: the client rejoins with backoff by itself.
        const online = typeof navigator === "undefined" ? true : navigator.onLine;
        handlers.onState(online ? "reconnecting" : "offline");
      }
    });
  return () => {
    void supabase.removeChannel(channel);
  };
}
