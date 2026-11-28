"use client";
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
