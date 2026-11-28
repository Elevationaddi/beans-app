import { createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  BranchAvailability,
  BranchMenu,
  LocalizedText,
  MenuProduct,
  PriceItemRequest,
  PricedItem,
} from "@beans/contracts";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  type ClockInterval,
  type DateException,
  isOpenAt,
  localToday,
  timeToClock,
  type WeeklyHours,
} from "../inventory/schedule.js";

/** Branches customers can see: active or paused, of an approved merchant. */
export const LISTED_BRANCH: Prisma.BranchWhereInput = {
  status: { in: ["active", "paused"] },
  merchant: { status: "approved" },
};

export const scheduleInclude = {
  hours: { orderBy: [{ weekday: "asc" }, { opens: "asc" }] },
  exceptions: { orderBy: { localDate: "asc" } },
} satisfies Prisma.BranchInclude;

type ScheduleRows = Prisma.BranchGetPayload<{ include: typeof scheduleInclude }>;

export function weeklyHours(row: Pick<ScheduleRows, "hours">): WeeklyHours[] {
  return row.hours.map((h) => ({
    weekday: h.weekday,
    opens: timeToClock(h.opens),
    closes: timeToClock(h.closes),
  }));
}

/** Exceptions from yesterday (branch time) onwards: enough to decide "open now". */
export function upcomingExceptions(
  row: Pick<ScheduleRows, "exceptions" | "timezone">,
  now = new Date(),
): DateException[] {
  const yesterday = localToday(row.timezone, new Date(now.getTime() - 86_400_000));
  return row.exceptions
    .map((e) => ({
      date: e.localDate.toISOString().slice(0, 10),
      closed: e.closed,
      intervals: e.intervals as unknown as ClockInterval[],
    }))
    .filter((e) => e.date >= yesterday);
}

export function availabilityOf(row: ScheduleRows, now = new Date()): BranchAvailability {
  if (row.status === "paused") return "paused";
  return isOpenAt(row.timezone, weeklyHours(row), upcomingExceptions(row, now), now)
    ? "open"
    : "closed";
}

const fils = (value: bigint) => value.toString();

type Db = Prisma.TransactionClient | PrismaService;

export interface ResolvedLine {
  product: MenuProduct;
  options: { id: string; names: LocalizedText; deltaFils: bigint }[];
  unitFils: bigint;
  lineFils: bigint;
}

/**
 * Validates one customized item against a branch menu and prices it (Q02). Rejects missing
 * required options, too many choices, options from other products, and anything sold out.
 * The client never sends a price: unit = branch price + branch option prices, in BigInt fils.
 */
export function resolveLine(
  menu: BranchMenu,
  request: { productId: string; optionIds: string[]; quantity: number },
): ResolvedLine {
  const product = menu.categories
    .flatMap((c) => c.products)
    .find((p) => p.id === request.productId);
  if (!product) throw ApiError.notFound("Product not found on this menu");
  if (!product.available) {
    throw new ApiError(HttpStatus.CONFLICT, "OUT_OF_STOCK", "This item is sold out at this branch");
  }

  const optionIds = request.optionIds;
  if (new Set(optionIds).size !== optionIds.length)
    throw invalidItem({ optionIds: ["An option is chosen twice"] });
  const byOption = new Map(
    product.groups.flatMap((g) => g.options.map((o) => [o.id, { group: g, option: o }])),
  );
  if (optionIds.some((id) => !byOption.has(id)))
    throw invalidItem({ optionIds: ["Not an option of this product"] });

  const errors: Record<string, string[]> = {};
  for (const group of product.groups) {
    const chosen = optionIds.filter((id) => byOption.get(id)?.group.id === group.id).length;
    if (chosen < group.minCount)
      errors[`groups.${group.id}`] = [`Choose at least ${group.minCount}`];
    else if (chosen > group.maxCount)
      errors[`groups.${group.id}`] = [`Choose at most ${group.maxCount}`];
  }
  if (Object.keys(errors).length > 0) throw invalidItem(errors);

  const chosen = optionIds.map((id) => {
    const entry = byOption.get(id);
    if (!entry) throw invalidItem({ optionIds: ["Not an option of this product"] });
    return entry.option;
  });
  if (chosen.some((o) => !o.available)) {
    throw new ApiError(
      HttpStatus.CONFLICT,
      "OUT_OF_STOCK",
      "An option you chose is not available at this branch",
    );
  }
  const options = chosen.map((o) => ({ id: o.id, names: o.names, deltaFils: BigInt(o.deltaFils) }));
  const unitFils = options.reduce((sum, o) => sum + o.deltaFils, BigInt(product.priceFils));
  return { product, options, unitFils, lineFils: unitFils * BigInt(request.quantity) };
}

function invalidItem(fieldErrors: Record<string, string[]>): ApiError {
  return new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "VALIDATION_FAILED",
    "Check the item's options",
    fieldErrors,
  );
}

/**
 * The customer-facing menu of one branch and the canonical price of an item. Prices always
 * come from the database (branch override, else base) and are computed in BigInt fils.
 */
@Injectable()
export class DiscoveryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** A listed branch, or 404 (drafts, closed branches and unapproved merchants included). */
  async listedBranch(branchId: string, db: Db = this.prisma) {
    const branch = await db.branch.findFirst({
      where: { id: branchId, ...LISTED_BRANCH },
      include: { ...scheduleInclude, merchant: { select: { brandName: true } } },
    });
    if (!branch) throw ApiError.notFound("Branch not found");
    return branch;
  }

  /** The menu as customers see it. Pass a transaction to read it consistently with a checkout. */
  async menu(branchId: string, db: Db = this.prisma): Promise<BranchMenu> {
    const branch = await this.listedBranch(branchId, db);
    const [categories, branchProducts, branchOptions] = await Promise.all([
      db.category.findMany({
        where: { merchantId: branch.merchantId, active: true },
        orderBy: [{ sort: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: {
          products: {
            where: { status: "published", moderationHiddenAt: null },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: {
              groups: {
                orderBy: { sort: "asc" },
                include: {
                  group: {
                    include: {
                      options: {
                        where: { active: true },
                        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      db.branchProduct.findMany({ where: { branchId } }),
      db.branchOption.findMany({ where: { branchId } }),
    ]);
    const productOverride = new Map(branchProducts.map((bp) => [bp.productId, bp]));
    const optionOverride = new Map(branchOptions.map((bo) => [bo.optionId, bo]));

    const content = {
      branchId,
      currency: "AED" as const,
      categories: categories
        .filter((c) => c.products.length > 0)
        .map((c) => ({
          id: c.id,
          names: { en: c.nameEn, ...(c.nameAr !== null && { ar: c.nameAr }) } as LocalizedText,
          products: c.products.map((p): MenuProduct => {
            const override = productOverride.get(p.id);
            // No override row means the product is offered at its base price, untracked.
            const inStock =
              !override ||
              override.stockOnHand === null ||
              override.stockOnHand - override.stockReserved > 0;
            return {
              id: p.id,
              names: p.names as unknown as LocalizedText,
              descriptions: p.descriptions as MenuProduct["descriptions"],
              priceFils: fils(override?.priceOverrideFils ?? p.baseFils),
              allergens: p.allergens,
              available: (override?.enabled ?? true) && inStock,
              groups: p.groups.map(({ group }) => ({
                id: group.id,
                names: group.name as unknown as LocalizedText,
                minCount: group.minCount,
                maxCount: group.maxCount,
                options: group.options.map((o) => {
                  const optionRow = optionOverride.get(o.id);
                  return {
                    id: o.id,
                    names: o.name as unknown as LocalizedText,
                    deltaFils: fils(optionRow?.deltaOverrideFils ?? o.deltaFils),
                    available: optionRow?.enabled ?? true,
                  };
                }),
              })),
            };
          }),
        })),
    };
    const version = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
    return { ...content, version };
  }

  /** Canonical price of one customized item (Q02); see resolveLine. */
  async priceItem(branchId: string, request: PriceItemRequest): Promise<PricedItem> {
    const menu = await this.menu(branchId);
    const line = resolveLine(menu, request);
    return {
      productId: line.product.id,
      optionIds: request.optionIds,
      quantity: request.quantity,
      unitFils: line.unitFils.toString(),
      lineFils: line.lineFils.toString(),
      menuVersion: menu.version,
    };
  }
}
