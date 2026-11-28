import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError } from "../common/api-error.js";
import type { ApiRequest, ApiResponse } from "../common/request-context.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { RedisService } from "../redis/redis.service.js";

export interface RateLimitRule {
  /** Bucket name, shared by routes that should count together. */
  name: string;
  limit: number;
  windowSeconds: number;
}

const RATE_LIMIT = Symbol("RATE_LIMIT");

/**
 * Limits how often one caller (the signed-in user, else the client IP) may hit a route
 * (docs/10: checkout, pickup code, uploads, claims, exports). These are security defaults,
 * not product policy; adjust them with operations data.
 */
export const RateLimit = (rule: RateLimitRule) =>
  applyDecorators(SetMetadata(RATE_LIMIT, rule), UseGuards(RateLimitGuard));

/** Default limits. Generous for real use, tight enough to slow guessing and scripted abuse. */
export const LIMITS = {
  checkout: { name: "checkout", limit: 20, windowSeconds: 60 },
  quote: { name: "quote", limit: 60, windowSeconds: 60 },
  staffAction: { name: "staff-action", limit: 120, windowSeconds: 60 },
  arrival: { name: "arrival", limit: 20, windowSeconds: 60 },
  cancelRequest: { name: "cancel-request", limit: 10, windowSeconds: 3600 },
  upload: { name: "upload", limit: 30, windowSeconds: 3600 },
  ticket: { name: "ticket", limit: 20, windowSeconds: 3600 },
  privacy: { name: "privacy", limit: 5, windowSeconds: 3600 },
  export: { name: "export", limit: 30, windowSeconds: 60 },
  webhook: { name: "webhook", limit: 600, windowSeconds: 60 },
  devAuth: { name: "dev-auth", limit: 60, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger("RateLimit");

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.RATE_LIMIT_ENABLED) return true;
    const rule = this.reflector.get<RateLimitRule | undefined>(RATE_LIMIT, context.getHandler());
    if (!rule) return true;
    const http = context.switchToHttp();
    const req = http.getRequest<
      ApiRequest & { ip?: string; socket?: { remoteAddress?: string } }
    >();
    const who = req.actor
      ? `user:${req.actor.userId}`
      : `ip:${req.ip ?? req.socket?.remoteAddress ?? "unknown"}`;
    const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
    const key = `rl:${rule.name}:${who}:${window}`;
    let count: number;
    try {
      const client = this.redis.client;
      if (client.status === "wait" || client.status === "end") await client.connect();
      const result = await client.multi().incr(key).expire(key, rule.windowSeconds).exec();
      count = Number(result?.[0]?.[1] ?? 0);
    } catch (error) {
      // Fail open: an outage of Redis must not stop orders. The outage itself raises the
      // health check to degraded, which operations watch.
      this.logger.warn(`rate limit check skipped (${rule.name}): ${(error as Error).message}`);
      return true;
    }
    if (count > rule.limit) {
      const retryAfter = rule.windowSeconds - (Math.floor(Date.now() / 1000) % rule.windowSeconds);
      http.getResponse<ApiResponse>().setHeader("Retry-After", String(retryAfter));
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        "RATE_LIMITED",
        "Too many requests. Wait a little and try again.",
      );
    }
    return true;
  }
}
