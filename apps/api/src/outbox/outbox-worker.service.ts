import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { FILE_SCAN_TOPIC, FilesService } from "../files/files.service.js";
import { queueForTopic, redisConnection } from "./outbox-relay.service.js";

interface OutboxJobData {
  aggregateId: string;
  payload: unknown;
}

/**
 * Consumes outbox jobs this process knows how to handle. Handlers must be idempotent: a job
 * can run more than once (retries, redelivery after a crash).
 */
@Injectable()
export class OutboxWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private readonly workers: Worker[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  /** Topic → handler. Each topic's domain queue gets one worker. */
  private handlers(): Record<string, (job: Job<OutboxJobData>) => Promise<void>> {
    return {
      [FILE_SCAN_TOPIC]: (job) => this.files.scan(job.data.aggregateId),
    };
  }

  onApplicationBootstrap(): void {
    if (!this.env.OUTBOX_WORKER_ENABLED) return;
    const handlers = this.handlers();
    const queues = new Set(Object.keys(handlers).map(queueForTopic));
    for (const queue of queues) {
      const worker = new Worker<OutboxJobData>(
        queue,
        async (job) => {
          const handler = handlers[job.name];
          if (!handler) throw new Error(`No handler for topic ${job.name}`);
          await handler(job);
        },
        {
          connection: { ...redisConnection(this.env.REDIS_URL), maxRetriesPerRequest: null },
          concurrency: 4,
        },
      );
      worker.on("failed", (job, error) =>
        this.logger.error(`Job ${job?.name ?? "?"} ${job?.id ?? "?"} failed: ${error.message}`),
      );
      worker.on("error", (error) => this.logger.warn(`Worker ${queue} error: ${error.message}`));
      this.workers.push(worker);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}
