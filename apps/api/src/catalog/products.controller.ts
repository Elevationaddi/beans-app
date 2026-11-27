import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  type CreateProductRequest,
  createProductRequestSchema,
  type Product,
  type ProductListQuery,
  productListQuerySchema,
  type UpdateProductRequest,
  updateProductRequestSchema,
  uuidSchema,
} from "@beans/contracts";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import { isCheckViolation } from "../common/db-errors.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, ProductStatus } from "../generated/prisma/client.js";
import { MerchantAccessService, within } from "../tenancy/merchant-access.service.js";
import { after, productInclude, toProductView } from "./catalog-view.js";
import { staleVersion } from "./modifier-groups.controller.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

/** Archive instead of delete: past orders keep referring to archived products. */
const TRANSITIONS: Record<ProductStatus, readonly ProductStatus[]> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

function invalidTransition(message: string): ApiError {
  return new ApiError(HttpStatus.CONFLICT, "INVALID_TRANSITION", message);
}

function notApproved(error: unknown): never {
  if (isCheckViolation(error, "is not approved")) {
    throw invalidTransition("The merchant must be approved before products can be published");
  }
  throw error;
}

type Tx = Prisma.TransactionClient;

/** Category and groups must exist in the same merchant. Reported as field errors. */
async function referenceProblems(
  tx: Tx,
  merchantId: string,
  categoryId: string | undefined,
  groupIds: readonly string[] | undefined,
): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = {};
  if (categoryId) {
    const category = await tx.category.count({ where: { id: categoryId, merchantId } });
    if (category === 0) errors["categoryId"] = ["Category not found"];
  }
  if (groupIds && groupIds.length > 0) {
    if (new Set(groupIds).size !== groupIds.length)
      errors["groupIds"] = ["A group is listed twice"];
    const found = await tx.modifierGroup.count({
      where: { id: { in: [...groupIds] }, merchantId },
    });
    if (found !== new Set(groupIds).size) errors["groupIds"] = ["Modifier group not found"];
  }
  return errors;
}

/**
 * Publish rules (B04, F03): the merchant is approved, the category is active, and every
 * attached modifier group can be satisfied with its active options.
 */
async function publishProblems(tx: Tx, productId: string): Promise<Record<string, string[]>> {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    include: {
      category: { select: { active: true } },
      groups: {
        include: {
          group: { include: { options: { where: { active: true }, select: { id: true } } } },
        },
      },
    },
  });
  const errors: Record<string, string[]> = {};
  if (!product.category.active) errors["categoryId"] = ["The category is inactive"];
  const unsatisfiable = product.groups
    .filter(({ group }) => group.options.length === 0 || group.options.length < group.minCount)
    .map(({ group }) => group.id);
  if (unsatisfiable.length > 0) {
    errors["groupIds"] = [
      `These groups do not have enough active options: ${unsatisfiable.join(", ")}`,
    ];
  }
  return errors;
}

@Controller("merchant/products")
export class ProductsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<{ data: Product[]; meta: { nextCursor: string | null } }> {
    await this.access.requireCatalogReader(actor.userId, query.merchantId);
    const rows = await this.prisma.product.findMany({
      where: {
        merchantId: query.merchantId,
        ...(query.categoryId && { categoryId: query.categoryId }),
        ...(query.status && { status: query.status }),
        ...after(decodeCursor(query.cursor)),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      include: productInclude,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toProductView),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: Product }> {
    const row = await this.prisma.product.findUnique({
      where: { id: params.id },
      include: productInclude,
    });
    if (!row) throw ApiError.notFound("Product not found");
    await within(this.access.requireCatalogReader(actor.userId, row.merchantId), "Product");
    return { data: toProductView(row) };
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createProductRequestSchema)) body: CreateProductRequest,
  ): Promise<{ data: Product }> {
    await this.access.requireCatalogWriter(actor.userId, body.merchantId);
    const row = await this.prisma.$transaction(async (tx) => {
      const problems = await referenceProblems(tx, body.merchantId, body.categoryId, body.groupIds);
      if (Object.keys(problems).length > 0) throw ApiError.validation(problems);
      const created = await tx.product.create({
        data: {
          merchantId: body.merchantId,
          categoryId: body.categoryId,
          names: body.names,
          descriptions: body.descriptions,
          baseFils: BigInt(body.priceFils),
          allergens: body.allergens,
          status: "draft",
        },
      });
      await tx.productGroup.createMany({
        data: body.groupIds.map((groupId, sort) => ({
          productId: created.id,
          groupId,
          merchantId: body.merchantId,
          sort,
        })),
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "catalog.product_created",
          targetType: "product",
          targetId: created.id,
          requestId,
          after: { names: body.names, priceFils: body.priceFils, categoryId: body.categoryId },
        },
        tx,
      );
      return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: productInclude });
    });
    return { data: toProductView(row) };
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateProductRequestSchema)) body: UpdateProductRequest,
  ): Promise<{ data: Product }> {
    const existing = await this.prisma.product.findUnique({
      where: { id: params.id },
      select: { merchantId: true },
    });
    if (!existing) throw ApiError.notFound("Product not found");
    await within(this.access.requireCatalogWriter(actor.userId, existing.merchantId), "Product");

    const row = await this.prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM products WHERE id = ${params.id}::uuid FOR UPDATE`;
        const before = await tx.product.findUniqueOrThrow({
          where: { id: params.id },
          include: { ...productInclude, merchant: { select: { status: true } } },
        });
        if (before.version !== body.expectedVersion) throw staleVersion(before.version);

        const status = body.status ?? before.status;
        if (status !== before.status && !TRANSITIONS[before.status].includes(status)) {
          throw invalidTransition(`A ${before.status} product cannot become ${status}`);
        }
        if (status === "published" && before.merchant.status !== "approved") {
          throw invalidTransition("The merchant must be approved before products can be published");
        }
        const problems = await referenceProblems(
          tx,
          before.merchantId,
          body.categoryId,
          body.groupIds,
        );
        if (Object.keys(problems).length > 0) throw ApiError.validation(problems);

        await tx.product.update({
          where: { id: params.id },
          data: {
            ...(body.categoryId && { categoryId: body.categoryId }),
            ...(body.names && { names: body.names }),
            ...(body.descriptions && { descriptions: body.descriptions }),
            ...(body.priceFils !== undefined && { baseFils: BigInt(body.priceFils) }),
            ...(body.allergens && { allergens: body.allergens }),
            status,
            version: { increment: 1 },
          },
        });
        if (body.groupIds) {
          await tx.productGroup.deleteMany({ where: { productId: params.id } });
          await tx.productGroup.createMany({
            data: body.groupIds.map((groupId, sort) => ({
              productId: params.id,
              groupId,
              merchantId: before.merchantId,
              sort,
            })),
          });
        }
        // Checked on the final state, so an edit cannot leave a published product invalid.
        if (status === "published") {
          const publish = await publishProblems(tx, params.id);
          if (Object.keys(publish).length > 0) {
            throw new ApiError(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "VALIDATION_FAILED",
              "The product cannot be published yet",
              publish,
            );
          }
        }
        await this.audit.record(
          {
            actorId: actor.userId,
            action:
              status !== before.status ? `catalog.product_${status}` : "catalog.product_updated",
            targetType: "product",
            targetId: params.id,
            requestId,
            before: {
              status: before.status,
              version: before.version,
              priceFils: before.baseFils.toString(),
              categoryId: before.categoryId,
            },
            after: body,
          },
          tx,
        );
        return tx.product.findUniqueOrThrow({ where: { id: params.id }, include: productInclude });
      })
      .catch(notApproved);
    return { data: toProductView(row) };
  }
}
