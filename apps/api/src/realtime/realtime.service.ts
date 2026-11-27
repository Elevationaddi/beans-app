import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { defer, filter, from, type Observable, Subject, switchMap } from "rxjs";
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

export const REALTIME_CHANNEL = "realtime:orders";

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

/**
 * Fans order changes out to open event streams on every API instance through Redis pub/sub.
 * The outbox worker publishes each committed `order.updated` event; streams filter by order
 * or branch after authorizing the subscriber. Delivery is best effort: clients refetch the
 * canonical order or queue on every event and after every reconnect (docs/07), so a missed
 * signal costs freshness, never correctness.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger("Realtime");
  private readonly signals = new Subject<OrderSignal>();
  private publisher: Redis | undefined;
  private subscriber: Redis | undefined;
  private subscribing: Promise<void> | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async publish(signal: OrderSignal): Promise<void> {
    this.publisher ??= this.connection("publisher");
    await this.publisher.publish(REALTIME_CHANNEL, JSON.stringify(signal));
  }

  /** Signals matching `predicate`, from the moment the Redis subscription is live. */
  stream(predicate: (signal: OrderSignal) => boolean): Observable<OrderSignal> {
    return defer(() => from(this.ensureSubscribed())).pipe(
      switchMap(() => this.signals.pipe(filter(predicate))),
    );
  }

  /** Resolves once this instance listens on the channel (used by tests to avoid races). */
  ensureSubscribed(): Promise<void> {
    this.subscribing ??= (async () => {
      const subscriber = this.connection("subscriber");
      this.subscriber = subscriber;
      subscriber.on("message", (_channel: string, message: string) => {
        try {
          const signal = parseSignal(JSON.parse(message));
          if (signal) this.signals.next(signal);
        } catch {
          this.logger.warn("Ignored a malformed realtime message");
        }
      });
      await subscriber.subscribe(REALTIME_CHANNEL);
    })().catch((error: Error) => {
      this.subscribing = undefined;
      throw error;
    });
    return this.subscribing;
  }

  async onModuleDestroy(): Promise<void> {
    this.signals.complete();
    for (const client of [this.publisher, this.subscriber]) {
      if (client && client.status !== "end") client.disconnect();
    }
  }

  private connection(role: string): Redis {
    const client = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    client.on("error", (error: Error) => this.logger.warn(`Redis ${role} error: ${error.message}`));
    return client;
  }
}
