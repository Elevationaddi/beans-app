import { Controller, Delete, Get, Inject, Param, Put, Query } from "@nestjs/common";
import {
  type Favorite,
  favoriteParamsSchema,
  type PageQuery,
  pageQuerySchema,
} from "@beans/contracts";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";

const params = new ZodValidationPipe(favoriteParamsSchema);

/** Saved cafés of the signed-in customer. Only approved cafés can be saved or listed. */
@Controller("favorites")
export class FavoritesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<{ data: Favorite[]; meta: { nextCursor: string | null } }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.favorite.findMany({
      where: {
        userId: actor.userId,
        merchant: { status: "approved" },
        ...(cursor && {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      include: { merchant: { select: { brandName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((f) => ({
        merchantId: f.merchantId,
        brandName: f.merchant.brandName,
        savedAt: f.createdAt.toISOString(),
      })),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Put(":merchantId")
  async save(
    @CurrentActor() actor: Actor,
    @Param(params) p: { merchantId: string },
  ): Promise<{ data: { merchantId: string; saved: boolean } }> {
    const merchant = await this.prisma.merchant.count({
      where: { id: p.merchantId, status: "approved" },
    });
    if (merchant === 0) throw ApiError.notFound("Café not found");
    await this.prisma.favorite.createMany({
      data: [{ userId: actor.userId, merchantId: p.merchantId }],
      skipDuplicates: true,
    });
    return { data: { merchantId: p.merchantId, saved: true } };
  }

  @Delete(":merchantId")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(params) p: { merchantId: string },
  ): Promise<{ data: { merchantId: string; saved: boolean } }> {
    await this.prisma.favorite.deleteMany({
      where: { userId: actor.userId, merchantId: p.merchantId },
    });
    return { data: { merchantId: p.merchantId, saved: false } };
  }
}
