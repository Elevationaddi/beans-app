import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 10;

interface ClaimedRow {
  id: string;
  topic: string;
  aggregate_id: string;
  dedupe_key: string;
  payload: unknown;
  attempts: number;
}

/**
 * Where the relay hands each event. In production this runs the handler in the same process
 * (the database is the queue: no Redis or paid queue service); tests can substitute a fake.
 */
export interface OutboxPublisher {
  publish(message: {
    topic: string;
    dedupeKey: string;
    aggregateId: string;
    payload: unknown;
  }): Promise<void>;
  close(): Promise<void>;
}

export const OUTBOX_PUBLISHER = Symbol("OUTBOX_PUBLISHER");

/**
 * Database-backed job processing. Pending outbox rows are leased in a short statement
 * (FOR UPDATE SKIP LOCKED, so any number of serverless instances, cron ticks and request
 * kicks can run at once without handling a row twice), handled outside the transaction, then
 * marked dispatched. Failures back off exponentially; after MAX_ATTEMPTS a row is marked
 * failed for operator attention. A lease that is never completed (the instance was frozen
 * or killed) expires after LEASE_MS and the row is picked up again, so handlers must be
 * idempotent.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OUTBOX_PUBLISHER) private readonly publisher: OutboxPublisher,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.OUTBOX_RELAY_ENABLED) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.dispatchBatch()
        .then(() => undefined)
        .catch((error: Error) => this.logger.error(`Outbox relay pass failed: ${error.message}`))
        .finally(() => {
          this.running = undefined;
        });
    }, 1_000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
    await this.publisher.close();
  }

  /**
   * Dispatches what a request just committed without delaying its response. On Vercel,
   * waitUntil keeps the function alive until the pass finishes; elsewhere the promise simply
   * runs. A pass that is skipped or fails is caught by the next cron tick.
   */
  kick(): void {
    const pass = this.dispatchBatch(20).catch((error: Error) =>
      this.logger.warn(`Outbox kick failed: ${error.message}`),
    );
    waitUntil(pass);
  }

  /** One relay pass. Returns how many rows were dispatched. */
  async dispatchBatch(limit = 50): Promise<number> {
    const claimed = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox SET next_run_at = now() + ${LEASE_MS} * interval '1 millisecond',
                        attempts = attempts + 1,
                        updated_at = now()
      WHERE id IN (
        SELECT id FROM outbox
        WHERE state = 'pending' AND next_run_at <= now()
        ORDER BY next_run_at, created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, topic, aggregate_id, dedupe_key, payload, attempts`;

    let dispatched = 0;
    for (const row of claimed) {
      try {
        await this.publisher.publish({
          topic: row.topic,
          dedupeKey: row.dedupe_key,
          aggregateId: row.aggregate_id,
          payload: row.payload,
        });
        await this.prisma.outboxMessage.update({
          where: { id: row.id },
          data: { state: "dispatched", lastError: null },
        });
        dispatched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const exhausted = row.attempts >= MAX_ATTEMPTS;
        const backoffMs = Math.min(2 ** row.attempts * 1_000, 15 * 60_000);
        await this.prisma.outboxMessage.update({
          where: { id: row.id },
          data: {
            state: exhausted ? "failed" : "pending",
            lastError: message.slice(0, 500),
            nextRunAt: new Date(Date.now() + backoffMs),
          },
        });
        this.logger.warn(
          `Outbox ${row.topic} ${row.id} attempt ${row.attempts} failed${exhausted ? " permanently" : ""}: ${message}`,
        );
      }
    }
    return dispatched;
  }
}
