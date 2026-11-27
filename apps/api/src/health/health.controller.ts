import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { HealthResponse, LivenessResponse } from "@beans/contracts";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /** Liveness: the process is up. Does not touch dependencies. */
  @Get("live")
  live(): LivenessResponse {
    return { status: "ok" };
  }

  /** Readiness: database and Redis both reachable. Answers 503 when either is down. */
  @Get()
  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy()]);
    const healthy = database && redis;
    const body: HealthResponse = {
      status: healthy ? "ok" : "degraded",
      version: this.env.API_VERSION,
      time: new Date().toISOString(),
      checks: { database: database ? "up" : "down", redis: redis ? "up" : "down" },
    };
    if (!healthy) {
      // Nest sends the object as the response body with HTTP 503.
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
