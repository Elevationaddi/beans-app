import { RealtimeClient } from "@supabase/realtime-js";
import { useEffect, useRef, useState } from "react";
import { api, call } from "./api";
import { config } from "./config";

/** "live": signals arrive over Supabase Realtime; "polling": the screen relies on refreshing. */
export type LiveState = "connecting" | "live" | "polling";

let client: RealtimeClient | null = null;
function realtime(): RealtimeClient | null {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  client ??= new RealtimeClient(`${config.supabaseUrl.replace(/\/$/, "")}/realtime/v1`, {
    params: { apikey: config.supabaseAnonKey },
  });
  return client;
}

/**
 * Live updates for one of the customer's orders (cycle 3). Asks the API for the order's
 * Broadcast channel and refetches (`onChange`) on each signal and after every rejoin; the
 * database stays the source of truth. Without a channel (local development, no Supabase
 * settings, or the request failed) the state is "polling" and the screen refreshes on a timer.
 */
export function useLiveOrder(orderId: string, enabled: boolean, onChange: () => void): LiveState {
  const [state, setState] = useState<LiveState>("connecting");
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let cleanup: (() => void) | null = null;
    setState("connecting");
    void (async () => {
      const socket = realtime();
      let subscription = null;
      try {
        subscription = socket
          ? (await call(api.GET("/v1/orders/{id}/live", { params: { path: { id: orderId } } })))
              .data
          : null;
      } catch {
        subscription = null;
      }
      if (stopped) return;
      if (!socket || !subscription) {
        setState("polling");
        return;
      }
      let joinedBefore = false;
      const channel = socket
        .channel(subscription.channel, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: subscription.event }, () => changed.current())
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // Signals sent while disconnected are not replayed: refetch after a rejoin.
            if (joinedBefore) changed.current();
            joinedBefore = true;
            setState("live");
          } else {
            setState("polling");
          }
        });
      cleanup = () => void socket.removeChannel(channel);
    })();
    return () => {
      stopped = true;
      cleanup?.();
    };
  }, [orderId, enabled]);

  return enabled ? state : "polling";
}
