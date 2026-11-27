import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";

export const OUTBOX_QUEUE = "outbox-events";
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

/** Publisher used by the relay. BullMQ in production; tests can substitute a fake. */
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

export class BullMqOutboxPublisher implements OutboxPublisher {
  private readonly queue: Queue;
  private readonly logger = new Logger("BullMqOutboxPublisher");

  constructor(redisUrl: string) {
    const url = new URL(redisUrl);
    this.queue = new Queue(OUTBOX_QUEUE, {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        ...(url.username && { username: decodeURIComponent(url.username) }),
        ...(url.password && { password: decodeURIComponent(url.password) }),
        ...(url.protocol === "rediss:" && { tls: {} }),
        // Fail a publish after one retry instead of hanging; the relay backs off and retries.
        maxRetriesPerRequest: 1,
      },
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
    });
    this.queue.on("error", (error: Error) =>
      this.logger.warn(`Queue connection error: ${error.message}`),
    );
  }

  async publish(message: {
    topic: string;
    dedupeKey: string;
    aggregateId: string;
    payload: unknown;
  }) {
    // jobId = dedupe key: BullMQ ignores a second add with the same id, so a relay crash
    // between publish and marking the row cannot create a duplicate job.
    await this.queue.add(
      message.topic,
      { aggregateId: message.aggregateId, payload: message.payload },
      { jobId: message.dedupeKey },
    );
  }

  async close() {
    // Let a connection attempt still in flight settle before closing, so it cannot surface
    // later as an unhandled rejection. A failure here is already reported by the error event.
    // Bounded: when Redis is unreachable the connection retries forever.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 1_000);
    });
    await Promise.race([
      this.queue.waitUntilReady().then(
        () => undefined,
        (error: Error) => this.logger.warn(`Queue was not ready at shutdown: ${error.message}`),
      ),
      timeout,
    ]);
    clearTimeout(timer);
    await this.queue.close();
  }
}

/**
 * Moves pending outbox rows to BullMQ. Rows are leased in a short transaction (FOR UPDATE
 * SKIP LOCKED, so several API instances can run relays), published outside the transaction,
 * then marked dispatched. Failures back off exponentially; after MAX_ATTEMPTS a row is
 * marked failed for operator attention.
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
