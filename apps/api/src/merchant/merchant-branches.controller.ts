import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { type MerchantBranch, type PageQuery, pageQuerySchema, uuidSchema } from "@beans/contracts";
import { z } from "zod";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";

const branchSelect = {
  id: true,
  merchantId: true,
  nameEn: true,
  nameAr: true,
  address: true,
  timezone: true,
  status: true,
  modes: true,
  capacity: true,
  createdAt: true,
  hours: { orderBy: [{ weekday: "asc" }, { opens: "asc" }] },
} satisfies Prisma.BranchSelect;

type BranchRow = Prisma.BranchGetPayload<{ select: typeof branchSelect }>;

/** "HH:MM" from a Postgres TIME value (returned as a UTC Date on 1970-01-01). */
function hhmm(value: Date): string {
  return value.toISOString().slice(11, 16);
}

function toView(row: BranchRow): MerchantBranch {
  return {
    id: row.id,
    merchantId: row.merchantId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    address: row.address,
    timezone: row.timezone,
    status: row.status,
    modes: row.modes as MerchantBranch["modes"],
    capacity: row.capacity,
    hours: row.hours.map((h) => ({
      weekday: h.weekday,
      opens: hhmm(h.opens),
      closes: hhmm(h.closes),
    })),
  };
}

@Controller("merchant/branches")
export class MerchantBranchesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
  ) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<{ data: MerchantBranch[]; meta: { nextCursor: string | null } }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.branch.findMany({
      where: {
        AND: [
          this.access.branchScope(actor.userId),
          cursor
            ? {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      select: branchSelect,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toView),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(z.strictObject({ id: uuidSchema }))) params: { id: string },
  ): Promise<{ data: MerchantBranch }> {
    await this.access.requireBranch(actor.userId, params.id);
    const row = await this.prisma.branch.findUniqueOrThrow({
      where: { id: params.id },
      select: branchSelect,
    });
    return { data: toView(row) };
  }
}
