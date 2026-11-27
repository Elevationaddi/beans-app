import { Controller, Get, HttpStatus, Inject } from "@nestjs/common";
import type { HealthResponse, LivenessResponse } from "@beans/contracts";
import { Public } from "../auth/public.decorator.js";
import { PassthroughHttpException } from "../common/http-exception.filter.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";

@Public()
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
      // Sent unchanged with HTTP 503 so load balancers can read which dependency is down.
      throw new PassthroughHttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
