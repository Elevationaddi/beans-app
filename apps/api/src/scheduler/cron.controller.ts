import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Headers, HttpCode, Inject, Logger } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { ApiError } from "../common/api-error.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import { OutboxRelayService } from "../outbox/outbox-relay.service.js";
import { purgeRateLimitCounters } from "../security/rate-limit.js";
import { PaymentSweepService } from "../webhooks/payment-sweep.service.js";

/** Stop starting new outbox passes after this long, so a tick ends well inside its time limit. */
const OUTBOX_BUDGET_MS = 20_000;

export function bearerMatches(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled work for serverless hosting, where no process stays up to run timers. Vercel Cron
 * calls GET /v1/internal/cron/tick every minute with `Authorization: Bearer $CRON_SECRET`.
 * Every job it runs is idempotent and row-locked, so a duplicated, late or overlapping tick
 * (or a long-running server's own timers running at the same time) changes nothing twice.
 * Without CRON_SECRET the route answers 404.
 */
@Public()
@Controller("internal/cron")
export class CronController {
  private readonly logger = new Logger("Cron");

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OutboxRelayService) private readonly outbox: OutboxRelayService,
    @Inject(PaymentSweepService) private readonly sweep: PaymentSweepService,
  ) {}

  @Get("tick")
  @HttpCode(200)
  async tick(@Headers("authorization") authorization: string | undefined) {
    if (!this.env.CRON_SECRET) throw ApiError.notFound("Not found");
    if (!bearerMatches(authorization, this.env.CRON_SECRET)) {
      throw ApiError.notFound("Not found");
    }
    const started = Date.now();
    let dispatched = 0;
    // Drain the outbox in batches until it is empty or the time budget is used.
    for (;;) {
      const n = await this.outbox.dispatchBatch(50);
      dispatched += n;
      if (n < 50 || Date.now() - started > OUTBOX_BUDGET_MS) break;
    }
    await this.sweep.sweepOnce();
    const purged = await purgeRateLimitCounters(this.prisma);
    const result = { dispatched, purgedRateLimits: purged, ms: Date.now() - started };
    this.logger.log(`tick ${JSON.stringify(result)}`);
    return { data: result };
  }
}
