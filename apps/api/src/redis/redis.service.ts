import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      // Fail health checks quickly instead of queueing commands while Redis is down.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
    });
    this.client.on("error", (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  /** True when Redis answers PING. Never throws. */
  async isHealthy(): Promise<boolean> {
    try {
      if (this.client.status === "wait" || this.client.status === "end") {
        await this.client.connect();
      }
      return (await this.client.ping()) === "PONG";
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${(error as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== "end") {
      this.client.disconnect();
    }
  }
}
