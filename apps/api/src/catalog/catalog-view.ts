import type { Category, LocalizedText, ModifierGroup, Product } from "@beans/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export const groupInclude = {
  options: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.ModifierGroupInclude;
export type GroupRow = Prisma.ModifierGroupGetPayload<{ include: typeof groupInclude }>;

export const productInclude = {
  groups: { orderBy: { sort: "asc" }, select: { groupId: true } },
} satisfies Prisma.ProductInclude;
export type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type CategoryRow = Prisma.CategoryGetPayload<object>;

export function toCategoryView(row: CategoryRow): Category {
  return {
    id: row.id,
    merchantId: row.merchantId,
    names: { en: row.nameEn, ...(row.nameAr !== null && { ar: row.nameAr }) },
    sort: row.sort,
    active: row.active,
  };
}

export function toGroupView(row: GroupRow): ModifierGroup {
  return {
    id: row.id,
    merchantId: row.merchantId,
    names: row.name as unknown as LocalizedText,
    minCount: row.minCount,
    maxCount: row.maxCount,
    sort: row.sort,
    version: row.version,
    options: row.options.map((o) => ({
      id: o.id,
      names: o.name as unknown as LocalizedText,
      deltaFils: o.deltaFils.toString(),
      active: o.active,
    })),
  };
}

export function toProductView(row: ProductRow): Product {
  return {
    id: row.id,
    merchantId: row.merchantId,
    categoryId: row.categoryId,
    names: row.names as unknown as LocalizedText,
    descriptions: row.descriptions as Product["descriptions"],
    priceFils: row.baseFils.toString(),
    allergens: row.allergens,
    status: row.status,
    version: row.version,
    groupIds: row.groups.map((g) => g.groupId),
  };
}

/** Keyset filter for (createdAt, id) ordering. */
export function after(cursor: { createdAt: Date; id: string } | null | undefined) {
  return cursor
    ? {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      }
    : {};
}
