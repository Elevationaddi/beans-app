import { z } from "zod";
import {
  dataEnvelope,
  expectedVersionSchema,
  filsSchema,
  listEnvelope,
  localizedDescriptionSchema,
  localizedTextSchema,
  merchantScopeQuerySchema,
  uuidSchema,
} from "./common.js";

// ── Categories ──────────────────────────────────────────────────────────────

export const categorySchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  names: localizedTextSchema,
  sort: z.number().int(),
  active: z.boolean(),
});
export type Category = z.infer<typeof categorySchema>;

export const categoryListQuerySchema = merchantScopeQuerySchema;
export const createCategoryRequestSchema = z.strictObject({
  merchantId: uuidSchema,
  names: localizedTextSchema,
  sort: z.number().int().min(0).max(10_000).default(0),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .strictObject({
    names: localizedTextSchema,
    sort: z.number().int().min(0).max(10_000),
    /** A category with published products cannot be deactivated. */
    active: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Send at least one field");
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const categoryResponseSchema = dataEnvelope(categorySchema);
export const categoryListResponseSchema = listEnvelope(categorySchema);

// ── Modifier groups ─────────────────────────────────────────────────────────

export const modifierOptionSchema = z.object({
  id: uuidSchema,
  names: localizedTextSchema,
  /** Added to the product price; options cannot discount in the MVP. */
  deltaFils: filsSchema,
  active: z.boolean(),
});
export type ModifierOption = z.infer<typeof modifierOptionSchema>;

export const modifierGroupSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  names: localizedTextSchema,
  minCount: z.number().int(),
  maxCount: z.number().int(),
  sort: z.number().int(),
  version: z.number().int(),
  options: z.array(modifierOptionSchema),
});
export type ModifierGroup = z.infer<typeof modifierGroupSchema>;

const optionInputSchema = z.strictObject({
  /** Existing option to update; omit to add a new one. */
  id: uuidSchema.optional(),
  names: localizedTextSchema,
  deltaFils: filsSchema,
});

export const modifierGroupListQuerySchema = merchantScopeQuerySchema;
export const createModifierGroupRequestSchema = z.strictObject({
  merchantId: uuidSchema,
  names: localizedTextSchema,
  minCount: z.number().int().min(0).max(20),
  maxCount: z.number().int().min(1).max(20),
  sort: z.number().int().min(0).max(10_000).default(0),
  options: z
    .array(optionInputSchema.omit({ id: true }))
    .min(1)
    .max(30),
});
export type CreateModifierGroupRequest = z.infer<typeof createModifierGroupRequestSchema>;

export const updateModifierGroupRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  names: localizedTextSchema.optional(),
  minCount: z.number().int().min(0).max(20).optional(),
  maxCount: z.number().int().min(1).max(20).optional(),
  sort: z.number().int().min(0).max(10_000).optional(),
  /**
   * The complete list of options to offer. Listed IDs are updated, entries without an ID are
   * added, and existing options left out are deactivated (never deleted: past orders refer to them).
   */
  options: z.array(optionInputSchema).min(1).max(30).optional(),
});
export type UpdateModifierGroupRequest = z.infer<typeof updateModifierGroupRequestSchema>;

export const modifierGroupResponseSchema = dataEnvelope(modifierGroupSchema);
export const modifierGroupListResponseSchema = listEnvelope(modifierGroupSchema);

// ── Products ────────────────────────────────────────────────────────────────

export const productStatusSchema = z.enum(["draft", "published", "archived"]);

/** Allergen labels are free-form slugs pending a reviewed list (docs/09: human review). */
const allergenSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/, "Lowercase allergen label");

export const productSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  categoryId: uuidSchema,
  names: localizedTextSchema,
  descriptions: localizedDescriptionSchema,
  priceFils: filsSchema,
  allergens: z.array(z.string()),
  status: productStatusSchema,
  version: z.number().int(),
  /** Modifier groups in display order. */
  groupIds: z.array(uuidSchema),
});
export type Product = z.infer<typeof productSchema>;

export const productListQuerySchema = merchantScopeQuerySchema.extend({
  categoryId: uuidSchema.optional(),
  status: productStatusSchema.optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

const productFields = {
  categoryId: uuidSchema,
  names: localizedTextSchema,
  descriptions: localizedDescriptionSchema,
  priceFils: filsSchema,
  allergens: z.array(allergenSchema).max(20),
  groupIds: z.array(uuidSchema).max(10),
};

/** Products are created as drafts. Publishing is a PATCH that checks the publish rules. */
export const createProductRequestSchema = z.strictObject({
  merchantId: uuidSchema,
  ...productFields,
  descriptions: productFields.descriptions.default({}),
  allergens: productFields.allergens.default([]),
  groupIds: productFields.groupIds.default([]),
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  categoryId: productFields.categoryId.optional(),
  names: productFields.names.optional(),
  descriptions: productFields.descriptions.optional(),
  priceFils: productFields.priceFils.optional(),
  allergens: productFields.allergens.optional(),
  groupIds: productFields.groupIds.optional(),
  /** draft → published (publish rules apply); published → draft; any → archived; archived → draft. */
  status: productStatusSchema.optional(),
});
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const productResponseSchema = dataEnvelope(productSchema);
export const productListResponseSchema = listEnvelope(productSchema);
