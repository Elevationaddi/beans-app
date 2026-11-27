import { z } from "zod";
import {
  citySchema,
  dataEnvelope,
  filsSchema,
  listEnvelope,
  localDateSchema,
  uuidSchema,
} from "./common.js";

export const branchStatusSchema = z.enum(["draft", "active", "paused", "closed"]);
export const fulfilmentModeSchema = z.enum(["in_store", "curbside", "dine_in"]);

/** "HH:MM", 00:00 to 23:59, in the branch timezone. */
export const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time as HH:MM");

/** One opening interval. Overnight opening is sent as two intervals (before and after midnight). */
export const openingIntervalSchema = z.strictObject({
  opens: clockTimeSchema,
  closes: clockTimeSchema,
});

export const branchHoursSchema = z.strictObject({
  /** ISO weekday: 1 = Monday ... 7 = Sunday, in the branch timezone. */
  weekday: z.number().int().min(1).max(7),
  opens: clockTimeSchema,
  closes: clockTimeSchema,
});
export type BranchHours = z.infer<typeof branchHoursSchema>;

/** A holiday or special day that replaces the weekly hours for one local date. */
export const branchExceptionSchema = z.object({
  date: localDateSchema,
  closed: z.boolean(),
  intervals: z.array(openingIntervalSchema),
});
export type BranchException = z.infer<typeof branchExceptionSchema>;

export const merchantBranchSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  address: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  phone: z.string().nullable(),
  city: citySchema.nullable(),
  timezone: z.string(),
  status: branchStatusSchema,
  modes: z.array(fulfilmentModeSchema),
  capacity: z.number().int(),
  hours: z.array(branchHoursSchema),
  /** Exceptions from today (branch time) onwards, earliest first. */
  exceptions: z.array(branchExceptionSchema),
});
export type MerchantBranch = z.infer<typeof merchantBranchSchema>;

export const merchantBranchListResponseSchema = listEnvelope(merchantBranchSchema);
export const merchantBranchResponseSchema = dataEnvelope(merchantBranchSchema);

const branchFields = {
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120).nullable(),
  address: z.string().trim().min(1).max(300),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,20}$/, "Phone number")
    .nullable(),
  /** Customers find branches by emirate; a branch without one is not listed by city. */
  city: citySchema.nullable(),
  modes: z.array(fulfilmentModeSchema).min(1).max(3),
  /** Orders the branch can take per 15-minute pickup slot (sandbox slot length, D10). */
  capacity: z.number().int().min(0).max(1000),
  /** The full weekly schedule; replaces the previous one. */
  hours: z.array(branchHoursSchema).max(70),
};

/** New branches start as drafts; activation is a separate PATCH (needs an approved merchant). */
export const createBranchRequestSchema = z.strictObject({
  merchantId: uuidSchema,
  ...branchFields,
  nameAr: branchFields.nameAr.optional(),
  lat: branchFields.lat.optional(),
  lng: branchFields.lng.optional(),
  phone: branchFields.phone.optional(),
  city: branchFields.city.optional(),
  hours: branchFields.hours.default([]),
});
export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;

export const updateBranchRequestSchema = z
  .strictObject({
    nameEn: branchFields.nameEn,
    nameAr: branchFields.nameAr,
    address: branchFields.address,
    lat: branchFields.lat,
    lng: branchFields.lng,
    phone: branchFields.phone,
    city: branchFields.city,
    modes: branchFields.modes,
    capacity: branchFields.capacity,
    hours: branchFields.hours,
    /** draft → active; active ⇄ paused; any → closed; closed → active. */
    status: branchStatusSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Send at least one field");
export type UpdateBranchRequest = z.infer<typeof updateBranchRequestSchema>;

export const branchExceptionParamsSchema = z.strictObject({
  id: uuidSchema,
  date: localDateSchema,
});

/** Closed days send no intervals; open days send the replacement intervals. */
export const putBranchExceptionRequestSchema = z.strictObject({
  closed: z.boolean(),
  intervals: z.array(openingIntervalSchema).max(10),
});
export type PutBranchExceptionRequest = z.infer<typeof putBranchExceptionRequestSchema>;
export const branchExceptionResponseSchema = dataEnvelope(branchExceptionSchema);

// ── Pickup slots (merchant view) ────────────────────────────────────────────

export const branchSlotsQuerySchema = z.strictObject({ date: localDateSchema });
export const branchSlotSchema = z.object({
  id: uuidSchema,
  startsAt: z.iso.datetime(),
  capacity: z.number().int(),
  reserved: z.number().int(),
  confirmed: z.number().int(),
});
export type BranchSlot = z.infer<typeof branchSlotSchema>;
export const branchSlotsResponseSchema = dataEnvelope(
  z.object({ date: localDateSchema, timezone: z.string(), slots: z.array(branchSlotSchema) }),
);

// ── Branch availability overrides ───────────────────────────────────────────

export const branchProductParamsSchema = z.strictObject({ id: uuidSchema, productId: uuidSchema });
export const branchOptionParamsSchema = z.strictObject({ id: uuidSchema, optionId: uuidSchema });

export const putBranchProductRequestSchema = z.strictObject({
  /** false = sold out / hidden at this branch, effective immediately. */
  enabled: z.boolean(),
  /** Branch price instead of the base price; null clears the override. */
  priceOverrideFils: filsSchema.nullable().default(null),
  /** Units on hand when stock is tracked; null means not tracked (enabled flag only). */
  stockOnHand: z.number().int().min(0).max(1_000_000).nullable().default(null),
});
export type PutBranchProductRequest = z.infer<typeof putBranchProductRequestSchema>;

export const branchProductSchema = z.object({
  branchId: uuidSchema,
  productId: uuidSchema,
  enabled: z.boolean(),
  priceOverrideFils: filsSchema.nullable(),
  stockOnHand: z.number().int().nullable(),
  /** Units held for unpaid or open orders (from checkout, phase 6). */
  stockReserved: z.number().int(),
});
export type BranchProductAvailability = z.infer<typeof branchProductSchema>;
export const branchProductResponseSchema = dataEnvelope(branchProductSchema);

export const putBranchOptionRequestSchema = z.strictObject({
  enabled: z.boolean(),
  deltaOverrideFils: filsSchema.nullable().default(null),
});
export type PutBranchOptionRequest = z.infer<typeof putBranchOptionRequestSchema>;

export const branchOptionSchema = z.object({
  branchId: uuidSchema,
  optionId: uuidSchema,
  enabled: z.boolean(),
  deltaOverrideFils: filsSchema.nullable(),
});
export type BranchOptionAvailability = z.infer<typeof branchOptionSchema>;
export const branchOptionResponseSchema = dataEnvelope(branchOptionSchema);
