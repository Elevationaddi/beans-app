import type { MessageEvent } from "@nestjs/common";
import type { OrderUpdatedEvent } from "@beans/contracts";
import { catchError, EMPTY, interval, map, merge, mergeMap, type Observable, of } from "rxjs";
import type { OrderSignal } from "../realtime/realtime.service.js";

export const HEARTBEAT_MS = 25_000;

/**
 * An event stream for one subscriber: `order.updated` events (no personal data), a heartbeat
 * right away and every 25 s so proxies keep the connection, and an access re-check with each
 * heartbeat, so a removed staff member stops receiving updates. The stream ends quietly when
 * access is lost; the client then gets 403/404 on reconnect.
 */
export function liveStream(
  signals: Observable<OrderSignal>,
  stillAllowed: () => Promise<unknown>,
  heartbeatMs = HEARTBEAT_MS,
): Observable<MessageEvent> {
  const updates = signals.pipe(
    map((signal): MessageEvent => {
      const data: OrderUpdatedEvent = {
        type: "order.updated",
        orderId: signal.orderId,
        version: signal.version,
        occurredAt: signal.occurredAt,
      };
      return { type: "order.updated", id: `${signal.orderId}:${signal.version}`, data };
    }),
  );
  const heartbeats = interval(heartbeatMs).pipe(
    mergeMap(async () => {
      await stillAllowed();
      return heartbeat();
    }),
  );
  return merge(of(heartbeat()), updates, heartbeats).pipe(catchError(() => EMPTY));
}

const heartbeat = (): MessageEvent => ({ type: "heartbeat", data: {} });
