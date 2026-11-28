import { createHmac, randomBytes } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { defer, filter, type Observable, of, Subject, switchMap } from "rxjs";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

/** Internal signal; only `orderId`, `version` and `occurredAt` ever reach a client. */
export interface OrderSignal {
  orderId: string;
  branchId: string;
  userId: string;
  version: number;
  occurredAt: string;
}

export function parseSignal(raw: unknown): OrderSignal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (
    typeof s.orderId !== "string" ||
    typeof s.branchId !== "string" ||
    typeof s.userId !== "string" ||
    typeof s.version !== "number" ||
    typeof s.occurredAt !== "string"
  ) {
    return null;
  }
  return {
    orderId: s.orderId,
    branchId: s.branchId,
    userId: s.userId,
    version: s.version,
    occurredAt: s.occurredAt,
  };
}

export type LiveScope = "order" | "branch";

/** The Broadcast event name clients listen for. */
export const LIVE_EVENT = "order.updated";

/**
 * Live order updates. Every committed `order.updated` outbox event arrives here once (or more:
 * delivery is at least once). Two outputs:
 *
 * - In-process streams for the server-sent event endpoints (local development and tests).
 * - With REALTIME_DRIVER=supabase, a Supabase Realtime Broadcast message on the order's and
 *   the branch's channel. Channel names are an HMAC of the ID, handed only to callers the API
 *   has authorized, and messages carry only the order ID and version. Clients then refetch
 *   the order through the API, so the database stays the only source of truth and a missed
 *   message costs freshness (the apps also poll), never correctness.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger("Realtime");
  private readonly signals = new Subject<OrderSignal>();
  private readonly channelSecret: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.channelSecret = env.REALTIME_CHANNEL_SECRET ?? randomBytes(32).toString("hex");
  }

  /** The unguessable channel name for one order or one branch queue. */
  channelFor(scope: LiveScope, id: string): string {
    const mac = createHmac("sha256", this.channelSecret).update(`${scope}:${id}`).digest("hex");
    return `${scope}-${mac.slice(0, 40)}`;
  }

  /** What a client needs to subscribe: null when this deployment has no shared live channel. */
  subscription(
    scope: LiveScope,
    id: string,
  ): { url: string; channel: string; event: string } | null {
    if (this.env.REALTIME_DRIVER !== "supabase" || !this.env.SUPABASE_URL) return null;
    return { url: this.env.SUPABASE_URL, channel: this.channelFor(scope, id), event: LIVE_EVENT };
  }

  async publish(signal: OrderSignal): Promise<void> {
    this.signals.next(signal);
    if (this.env.REALTIME_DRIVER === "supabase") await this.broadcast(signal);
  }

  /** Signals matching `predicate` in this process, for the event-stream endpoints. */
  stream(predicate: (signal: OrderSignal) => boolean): Observable<OrderSignal> {
    return defer(() => of(null)).pipe(switchMap(() => this.signals.pipe(filter(predicate))));
  }

  onModuleDestroy(): void {
    this.signals.complete();
  }

  /** Supabase Realtime REST broadcast. Throws on failure so the outbox retries it. */
  private async broadcast(signal: OrderSignal): Promise<void> {
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = this.env.SUPABASE_URL;
    if (!key || !url) throw new Error("Supabase Realtime is not configured");
    const payload = {
      orderId: signal.orderId,
      version: signal.version,
      occurredAt: signal.occurredAt,
    };
    const response = await fetch(new URL("/realtime/v1/api/broadcast", url), {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { topic: this.channelFor("order", signal.orderId), event: LIVE_EVENT, payload },
          { topic: this.channelFor("branch", signal.branchId), event: LIVE_EVENT, payload },
        ],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      // Never log the key or the body; the status is enough to diagnose.
      throw new Error(`Supabase Realtime broadcast failed with HTTP ${response.status}`);
    }
  }
}
