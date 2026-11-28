import { z } from "zod";
import { dataEnvelope, uuidSchema } from "./common.js";

const bilingual = z.strictObject({
  en: z.string().trim().min(1).max(200),
  ar: z.string().trim().max(200).optional(),
});

/**
 * Settings an authorised admin may change (D10, 2026-11-28: operational values configurable
 * through admin controls). Each key has its own schema; the server validates every write.
 * Live payments and the wallet are not here on purpose: they cannot be switched on by admins.
 */
export const platformSettingSchemas = {
  /** D10 operational timers. */
  operations: z.strictObject({
    acceptSeconds: z.number().int().min(30).max(900),
    quoteSeconds: z.number().int().min(60).max(1800),
    holdSeconds: z.number().int().min(60).max(3600),
    invitationHours: z.number().int().min(1).max(336),
    /** Sandbox gifts: days a gift stays valid to claim and use. */
    giftValidDays: z.number().int().min(1).max(365),
  }),
  /** Emergency platform pause: no new quotes or checkouts while on. */
  pause: z.strictObject({
    ordersPaused: z.boolean(),
    message: bilingual.nullable(),
  }),
  /** Phase 9 features, sandbox only. Production gifting stays off regardless (D-phase 9). */
  features: z.strictObject({
    stampCards: z.boolean(),
    promotions: z.boolean(),
    dineIn: z.boolean(),
    sandboxGifts: z.boolean(),
  }),
  /** A07 homepage content and featured shops for the customer app. */
  homepage: z.strictObject({
    hero: bilingual.nullable(),
    featuredMerchantIds: z.array(uuidSchema).max(12),
  }),
} as const;
export type PlatformSettingKey = keyof typeof platformSettingSchemas;
export const platformSettingKeySchema = z.enum(["operations", "pause", "features", "homepage"]);
export type PlatformSettingValues = {
  [K in PlatformSettingKey]: z.infer<(typeof platformSettingSchemas)[K]>;
};

export const platformSettingSchema = z.object({
  key: platformSettingKeySchema,
  value: z.unknown(),
  version: z.number().int(),
  updatedAt: z.iso.datetime().nullable(),
  updatedById: uuidSchema.nullable(),
  /** Admin roles allowed to change this key. */
  editableBy: z.array(z.string()),
});
export type PlatformSetting = z.infer<typeof platformSettingSchema>;
export const platformSettingListResponseSchema = dataEnvelope(z.array(platformSettingSchema));
export const platformSettingResponseSchema = dataEnvelope(platformSettingSchema);
export const platformSettingParamsSchema = z.strictObject({ key: platformSettingKeySchema });

export const updatePlatformSettingRequestSchema = z.strictObject({
  value: z.unknown(),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
});
export type UpdatePlatformSettingRequest = z.infer<typeof updatePlatformSettingRequestSchema>;

/** Public: what every app needs to know before letting someone order. */
export const platformStatusSchema = z.object({
  ordersPaused: z.boolean(),
  message: z.object({ en: z.string(), ar: z.string().optional() }).nullable(),
  features: platformSettingSchemas.features,
  sandbox: z.boolean(),
});
export type PlatformStatus = z.infer<typeof platformStatusSchema>;
export const platformStatusResponseSchema = dataEnvelope(platformStatusSchema);

/** Public homepage: hero text and featured shops (approved merchants only). */
export const homepageSchema = z.object({
  hero: z.object({ en: z.string(), ar: z.string().optional() }).nullable(),
  featured: z.array(
    z.object({ merchantId: uuidSchema, brandName: z.string(), branchCount: z.number().int() }),
  ),
});
export type Homepage = z.infer<typeof homepageSchema>;
export const homepageResponseSchema = dataEnvelope(homepageSchema);
