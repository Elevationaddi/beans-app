import { z } from "zod";
import {
  citySchema,
  dataEnvelope,
  filsSchema,
  listEnvelope,
  localDateSchema,
  localizedDescriptionSchema,
  localizedTextSchema,
  pageQuerySchema,
  uuidSchema,
} from "./common.js";
import {
  branchExceptionSchema,
  branchHoursSchema,
  fulfilmentModeSchema,
} from "./merchant-branches.js";

/**
 * What a customer can do right now: `open` takes orders, `closed` is outside opening hours
 * (visible, but no ASAP orders), `paused` was paused by the café (no new orders).
 */
export const branchAvailabilitySchema = z.enum(["open", "closed", "paused"]);
export type BranchAvailability = z.infer<typeof branchAvailabilitySchema>;

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const branchSearchQuerySchema = pageQuerySchema
  .extend({
    q: z.string().trim().min(1).max(80).optional(),
    city: citySchema.optional(),
    /** Only sent when the customer allowed location; never stored. */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    mode: fulfilmentModeSchema.optional(),
    openNow: booleanQuery.optional(),
  })
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), {
    message: "Send both lat and lng, or neither",
    path: ["lat"],
  });
export type BranchSearchQuery = z.infer<typeof branchSearchQuerySchema>;

export const publicBranchCardSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  brandName: z.string(),
  names: localizedTextSchema,
  address: z.string(),
  city: citySchema.nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  modes: z.array(fulfilmentModeSchema),
  availability: branchAvailabilitySchema,
  /** Straight-line distance, only when the request carried a location. */
  distanceMeters: z.number().int().nullable(),
});
export type PublicBranchCard = z.infer<typeof publicBranchCardSchema>;
export const publicBranchListResponseSchema = listEnvelope(publicBranchCardSchema);

export const publicBranchDetailSchema = publicBranchCardSchema.extend({
  phone: z.string().nullable(),
  timezone: z.string(),
  hours: z.array(branchHoursSchema),
  exceptions: z.array(branchExceptionSchema),
  /** Other listed branches of the same café, for the branch switcher. */
  siblings: z.array(z.object({ id: uuidSchema, names: localizedTextSchema })),
});
export type PublicBranchDetail = z.infer<typeof publicBranchDetailSchema>;
export const publicBranchResponseSchema = dataEnvelope(publicBranchDetailSchema);

// ── Menu ────────────────────────────────────────────────────────────────────

export const menuOptionSchema = z.object({
  id: uuidSchema,
  names: localizedTextSchema,
  /** Branch price of the option (branch override or base). */
  deltaFils: filsSchema,
  available: z.boolean(),
});

export const menuGroupSchema = z.object({
  id: uuidSchema,
  names: localizedTextSchema,
  minCount: z.number().int(),
  maxCount: z.number().int(),
  options: z.array(menuOptionSchema),
});
export type MenuGroup = z.infer<typeof menuGroupSchema>;

export const menuProductSchema = z.object({
  id: uuidSchema,
  names: localizedTextSchema,
  descriptions: localizedDescriptionSchema,
  /** Branch price (branch override or base), whole fils. */
  priceFils: filsSchema,
  /** Labels pending a reviewed allergen list; not an allergy guarantee. */
  allergens: z.array(z.string()),
  /** false = sold out or switched off at this branch. */
  available: z.boolean(),
  groups: z.array(menuGroupSchema),
});
export type MenuProduct = z.infer<typeof menuProductSchema>;

export const branchMenuSchema = z.object({
  branchId: uuidSchema,
  currency: z.literal("AED"),
  /** Changes whenever anything on this menu changes; carts compare it to detect stale data. */
  version: z.string(),
  categories: z.array(
    z.object({ id: uuidSchema, names: localizedTextSchema, products: z.array(menuProductSchema) }),
  ),
});
export type BranchMenu = z.infer<typeof branchMenuSchema>;
export const branchMenuResponseSchema = dataEnvelope(branchMenuSchema);

// ── Server-side item pricing ────────────────────────────────────────────────

/** Most of one item a customer can add at once (sandbox limit, recorded in the progress log). */
export const MAX_ITEM_QUANTITY = 20;

/**
 * Prices one customized item. The request carries choices only, never prices: unknown
 * fields (such as a client price) are rejected, and the server's total is the only total.
 */
export const priceItemRequestSchema = z.strictObject({
  productId: uuidSchema,
  optionIds: z.array(uuidSchema).max(30).default([]),
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
});
export type PriceItemRequest = z.infer<typeof priceItemRequestSchema>;

export const pricedItemSchema = z.object({
  productId: uuidSchema,
  optionIds: z.array(uuidSchema),
  quantity: z.number().int(),
  unitFils: filsSchema,
  lineFils: filsSchema,
  menuVersion: z.string(),
});
export type PricedItem = z.infer<typeof pricedItemSchema>;
export const pricedItemResponseSchema = dataEnvelope(pricedItemSchema);

// ── Pickup times ────────────────────────────────────────────────────────────

export const publicSlotsQuerySchema = z.strictObject({
  date: localDateSchema,
  mode: fulfilmentModeSchema,
});
export const publicSlotsResponseSchema = dataEnvelope(
  z.object({
    date: localDateSchema,
    timezone: z.string(),
    availability: branchAvailabilitySchema,
    /** Future slots only; capacity is shown as available or not, never as counts. */
    slots: z.array(z.object({ startsAt: z.iso.datetime(), available: z.boolean() })),
  }),
);

// ── Favorites ───────────────────────────────────────────────────────────────

export const favoriteSchema = z.object({
  merchantId: uuidSchema,
  brandName: z.string(),
  savedAt: z.iso.datetime(),
});
export type Favorite = z.infer<typeof favoriteSchema>;
export const favoriteListResponseSchema = listEnvelope(favoriteSchema);
export const favoriteParamsSchema = z.strictObject({ merchantId: uuidSchema });
export const favoriteStateResponseSchema = dataEnvelope(
  z.object({ merchantId: uuidSchema, saved: z.boolean() }),
);
