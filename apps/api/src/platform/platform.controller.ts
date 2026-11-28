import { Body, Controller, Get, Inject, Param, Put } from "@nestjs/common";
import {
  type Homepage,
  type PlatformSetting,
  type PlatformSettingKey,
  type PlatformStatus,
  type UpdatePlatformSettingRequest,
  platformSettingParamsSchema,
  updatePlatformSettingRequestSchema,
} from "@beans/contracts";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { Public } from "../auth/public.decorator.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import { Idempotent } from "../idempotency/idempotent.interceptor.js";
import { SettingsService } from "./settings.service.js";

/** Public platform state for every app: pause banner, features, homepage. */
@Controller("platform")
export class PlatformController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get("status")
  @Public()
  async status(): Promise<{ data: PlatformStatus }> {
    const [pause, features] = await Promise.all([
      this.settings.get("pause"),
      this.settings.get("features"),
    ]);
    return {
      data: {
        ordersPaused: pause.ordersPaused,
        message: pause.message,
        features,
        sandbox: !this.env.LIVE_PAYMENTS_ENABLED,
      },
    };
  }

  @Get("homepage")
  @Public()
  async homepage(): Promise<{ data: Homepage }> {
    const home = await this.settings.get("homepage");
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: home.featuredMerchantIds }, status: "approved" },
      select: {
        id: true,
        brandName: true,
        _count: { select: { branches: { where: { status: { in: ["active", "paused"] } } } } },
      },
    });
    const byId = new Map(merchants.map((m) => [m.id, m]));
    return {
      data: {
        hero: home.hero,
        // Keep the order chosen by marketing; drop shops that are no longer approved.
        featured: home.featuredMerchantIds
          .map((id) => byId.get(id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m))
          .map((m) => ({
            merchantId: m.id,
            brandName: m.brandName,
            branchCount: m._count.branches,
          })),
      },
    };
  }
}

/** A09: writable, versioned and audited platform settings, emergency pause and A07 homepage. */
@Controller("admin/platform-settings")
export class AdminPlatformController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  @RequireAdmin("operations", "security", "marketing", "super_admin")
  async list(): Promise<{ data: PlatformSetting[] }> {
    return { data: await this.settings.list() };
  }

  @Put(":key")
  @Idempotent()
  @RequireAdmin("operations", "security", "marketing", "super_admin")
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(platformSettingParamsSchema)) params: { key: PlatformSettingKey },
    @Body(new ZodValidationPipe(updatePlatformSettingRequestSchema))
    body: UpdatePlatformSettingRequest,
  ): Promise<{ data: PlatformSetting }> {
    return {
      data: await this.settings.update({ userId: actor.userId, requestId }, params.key, body),
    };
  }
}
