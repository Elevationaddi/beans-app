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
  type Category,
  categoryListQuerySchema,
  type CreateCategoryRequest,
  createCategoryRequestSchema,
  type UpdateCategoryRequest,
  updateCategoryRequestSchema,
  uuidSchema,
} from "@beans/contracts";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import { MerchantAccessService, within } from "../tenancy/merchant-access.service.js";
import { after, toCategoryView } from "./catalog-view.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

@Controller("merchant/categories")
export class CategoriesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(categoryListQuerySchema))
    query: z.infer<typeof categoryListQuerySchema>,
  ): Promise<{ data: Category[]; meta: { nextCursor: string | null } }> {
    await this.access.requireCatalogReader(actor.userId, query.merchantId);
    const rows = await this.prisma.category.findMany({
      where: { merchantId: query.merchantId, ...after(decodeCursor(query.cursor)) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toCategoryView),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createCategoryRequestSchema)) body: CreateCategoryRequest,
  ): Promise<{ data: Category }> {
    await this.access.requireCatalogWriter(actor.userId, body.merchantId);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          merchantId: body.merchantId,
          nameEn: body.names.en,
          nameAr: body.names.ar ?? null,
          sort: body.sort,
        },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "catalog.category_created",
          targetType: "category",
          targetId: created.id,
          requestId,
          after: { names: body.names, sort: body.sort },
        },
        tx,
      );
      return created;
    });
    return { data: toCategoryView(row) };
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateCategoryRequestSchema)) body: UpdateCategoryRequest,
  ): Promise<{ data: Category }> {
    const existing = await this.prisma.category.findUnique({
      where: { id: params.id },
      select: { merchantId: true },
    });
    if (!existing) throw ApiError.notFound("Category not found");
    await within(this.access.requireCatalogWriter(actor.userId, existing.merchantId), "Category");

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM categories WHERE id = ${params.id}::uuid FOR UPDATE`;
      const before = await tx.category.findUniqueOrThrow({ where: { id: params.id } });
      if (body.active === false && before.active) {
        const published = await tx.product.count({
          where: { categoryId: params.id, status: "published" },
        });
        if (published > 0) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            "CONFLICT",
            `Unpublish or move the ${published} published products in this category first`,
          );
        }
      }
      const updated = await tx.category.update({
        where: { id: params.id },
        data: {
          ...(body.names && { nameEn: body.names.en, nameAr: body.names.ar ?? null }),
          ...(body.sort !== undefined && { sort: body.sort }),
          ...(body.active !== undefined && { active: body.active }),
        },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "catalog.category_updated",
          targetType: "category",
          targetId: params.id,
          requestId,
          before: { nameEn: before.nameEn, sort: before.sort, active: before.active },
          after: body,
        },
        tx,
      );
      return updated;
    });
    return { data: toCategoryView(row) };
  }
}
