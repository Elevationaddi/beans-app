import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  platformSettingSchemas,
  type PlatformSetting,
  type PlatformSettingKey,
  type PlatformSettingValues,
} from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/api-error.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AdminRoleName, Prisma } from "../generated/prisma/client.js";

/** Who may change each key. No implicit super_admin bypass beyond what is listed here. */
export const SETTING_EDITORS: Record<PlatformSettingKey, AdminRoleName[]> = {
  operations: ["operations", "super_admin"],
  pause: ["operations", "security", "super_admin"],
  features: ["super_admin"],
  homepage: ["marketing", "super_admin"],
};
export const SETTING_KEYS = Object.keys(SETTING_EDITORS) as PlatformSettingKey[];

const CACHE_MS = 3000;

/**
 * Typed, versioned and audited platform settings (D10). Values not yet saved fall back to the
 * environment defaults, so a fresh install behaves exactly as before. Reads are cached for a
 * few seconds; writes clear the cache of this instance.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<PlatformSettingKey, { at: number; value: unknown }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  defaults(): PlatformSettingValues {
    return {
      operations: {
        acceptSeconds: this.env.ACCEPT_TIMEOUT_SECONDS,
        quoteSeconds: this.env.QUOTE_TTL_SECONDS,
        holdSeconds: this.env.RESERVATION_TTL_SECONDS,
        invitationHours: 72,
        // Sandbox gifts (founder, 2026-11-28): unclaimed or unused gifts expire after 30 days.
        giftValidDays: 30,
      },
      pause: { ordersPaused: false, message: null },
      // Phase 9 is built (sandbox). Off by default everywhere; the sandbox seed and a super
      // admin turn features on. Gifts stay refused in production whatever this says.
      features: { stampCards: false, promotions: false, dineIn: false, sandboxGifts: false },
      homepage: { hero: null, featuredMerchantIds: [] },
    };
  }

  async get<K extends PlatformSettingKey>(key: K): Promise<PlatformSettingValues[K]> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as PlatformSettingValues[K];
    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    // Fields added later take their default, so older stored values keep working.
    const stored =
      row && typeof row.value === "object" && row.value !== null && !Array.isArray(row.value)
        ? { ...(this.defaults()[key] as object), ...(row.value as object) }
        : row?.value;
    const parsed = row ? platformSettingSchemas[key].safeParse(stored) : null;
    // A stored value that no longer fits the schema falls back to the default, never crashes.
    const value = (
      parsed?.success ? parsed.data : this.defaults()[key]
    ) as PlatformSettingValues[K];
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Refuses new orders while the platform is paused (emergency pause, A09). */
  async assertOrderingOpen(): Promise<void> {
    const pause = await this.get("pause");
    if (pause.ordersPaused) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "PLATFORM_PAUSED",
        pause.message?.en ?? "Ordering is paused for a short while. Please try again soon.",
      );
    }
  }

  async list(): Promise<PlatformSetting[]> {
    const rows = await this.prisma.platformSetting.findMany();
    return Promise.all(
      SETTING_KEYS.map(async (key) => {
        const row = rows.find((r) => r.key === key);
        return {
          key,
          value: await this.get(key),
          version: row?.version ?? 0,
          updatedAt: row?.updatedAt.toISOString() ?? null,
          updatedById: row?.updatedById ?? null,
          editableBy: SETTING_EDITORS[key],
        };
      }),
    );
  }

  async update(
    actor: { userId: string; requestId: string },
    key: PlatformSettingKey,
    input: { value: unknown; expectedVersion: number; reason: string },
  ): Promise<PlatformSetting> {
    const roles = await this.prisma.adminRole.findMany({
      where: { userId: actor.userId },
      select: { role: true },
    });
    if (!roles.some((r) => SETTING_EDITORS[key].includes(r.role))) {
      throw ApiError.forbidden(`Changing ${key} needs one of: ${SETTING_EDITORS[key].join(", ")}`);
    }
    const parsed = platformSettingSchemas[key].safeParse(input.value);
    if (!parsed.success) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        "VALIDATION_FAILED",
        "Check the values",
        Object.fromEntries(
          parsed.error.issues.map((i) => [["value", ...i.path].join("."), [i.message]]),
        ),
      );
    }
    if (key === "homepage")
      await this.assertFeaturable(
        (parsed.data as PlatformSettingValues["homepage"]).featuredMerchantIds,
      );
    const value = parsed.data as Prisma.InputJsonValue;
    const saved = await this.prisma.$transaction(async (tx) => {
      const before = await tx.platformSetting.findUnique({ where: { key } });
      const current = before?.version ?? 0;
      if (current !== input.expectedVersion) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "CONFLICT",
          "Someone changed this setting first. Reload and try again.",
        );
      }
      const row = before
        ? await tx.platformSetting.update({
            where: { key, version: current },
            data: { value, version: current + 1, updatedById: actor.userId },
          })
        : await tx.platformSetting.create({
            data: { key, value, version: 1, updatedById: actor.userId },
          });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: `platform.setting_changed`,
          targetType: "platform_setting",
          targetId: key,
          requestId: actor.requestId,
          reason: input.reason,
          before: {
            value: (before?.value as Prisma.InputJsonObject | undefined) ?? this.defaults()[key],
            version: current,
          },
          after: { value, version: row.version },
        },
        tx,
      );
      return row;
    });
    this.cache.delete(key);
    return {
      key,
      value: parsed.data,
      version: saved.version,
      updatedAt: saved.updatedAt.toISOString(),
      updatedById: saved.updatedById,
      editableBy: SETTING_EDITORS[key],
    };
  }

  private async assertFeaturable(ids: string[]) {
    if (new Set(ids).size !== ids.length) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "A shop is listed twice");
    }
    const ok = await this.prisma.merchant.count({ where: { id: { in: ids }, status: "approved" } });
    if (ok !== ids.length) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        "VALIDATION_FAILED",
        "Only approved shops can be featured",
      );
    }
  }
}
