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
  type CreateModifierGroupRequest,
  createModifierGroupRequestSchema,
  type ModifierGroup,
  modifierGroupListQuerySchema,
  type UpdateModifierGroupRequest,
  updateModifierGroupRequestSchema,
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
import { after, groupInclude, toGroupView } from "./catalog-view.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

export function staleVersion(current: number): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    "CONFLICT",
    "This item was changed by someone else. Reload and try again.",
    { expectedVersion: [`Current version is ${current}`] },
  );
}

/** min ≤ max, and the required choices can actually be made from the active options. */
function countProblems(
  minCount: number,
  maxCount: number,
  activeOptions: number,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (minCount > maxCount) errors["minCount"] = ["Must not exceed maxCount"];
  if (minCount > activeOptions) {
    errors["options"] = [`At least ${minCount} active options are needed for minCount ${minCount}`];
  }
  return errors;
}

@Controller("merchant/modifier-groups")
export class ModifierGroupsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(modifierGroupListQuerySchema))
    query: z.infer<typeof modifierGroupListQuerySchema>,
  ): Promise<{ data: ModifierGroup[]; meta: { nextCursor: string | null } }> {
    await this.access.requireCatalogReader(actor.userId, query.merchantId);
    const rows = await this.prisma.modifierGroup.findMany({
      where: { merchantId: query.merchantId, ...after(decodeCursor(query.cursor)) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      include: groupInclude,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toGroupView),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createModifierGroupRequestSchema)) body: CreateModifierGroupRequest,
  ): Promise<{ data: ModifierGroup }> {
    await this.access.requireCatalogWriter(actor.userId, body.merchantId);
    const problems = countProblems(body.minCount, body.maxCount, body.options.length);
    if (Object.keys(problems).length > 0) throw ApiError.validation(problems);

    const row = await this.prisma.$transaction(async (tx) => {
      const group = await tx.modifierGroup.create({
        data: {
          merchantId: body.merchantId,
          name: body.names,
          minCount: body.minCount,
          maxCount: body.maxCount,
          sort: body.sort,
        },
      });
      // Options display in creation order. Two inserts can share a millisecond, so each gets
      // its own strictly increasing timestamp; otherwise the order fell back to random IDs.
      const createdBase = Date.now();
      for (const [index, option] of body.options.entries()) {
        await tx.modifierOption.create({
          data: {
            groupId: group.id,
            merchantId: body.merchantId,
            name: option.names,
            deltaFils: BigInt(option.deltaFils),
            createdAt: new Date(createdBase + index),
          },
        });
      }
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "catalog.modifier_group_created",
          targetType: "modifier_group",
          targetId: group.id,
          requestId,
          after: {
            names: body.names,
            minCount: body.minCount,
            maxCount: body.maxCount,
            options: body.options,
          },
        },
        tx,
      );
      return tx.modifierGroup.findUniqueOrThrow({ where: { id: group.id }, include: groupInclude });
    });
    return { data: toGroupView(row) };
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateModifierGroupRequestSchema)) body: UpdateModifierGroupRequest,
  ): Promise<{ data: ModifierGroup }> {
    const existing = await this.prisma.modifierGroup.findUnique({
      where: { id: params.id },
      select: { merchantId: true },
    });
    if (!existing) throw ApiError.notFound("Modifier group not found");
    await within(
      this.access.requireCatalogWriter(actor.userId, existing.merchantId),
      "Modifier group",
    );

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM modifier_groups WHERE id = ${params.id}::uuid FOR UPDATE`;
      const before = await tx.modifierGroup.findUniqueOrThrow({
        where: { id: params.id },
        include: groupInclude,
      });
      if (before.version !== body.expectedVersion) throw staleVersion(before.version);

      const known = new Set(before.options.map((o) => o.id));
      let activeCount = before.options.filter((o) => o.active).length;
      if (body.options) {
        const listed = body.options.flatMap((o) => (o.id ? [o.id] : []));
        const unknown = listed.filter((id) => !known.has(id));
        if (unknown.length > 0)
          throw ApiError.validation({ options: [`Unknown option IDs: ${unknown.join(", ")}`] });
        if (new Set(listed).size !== listed.length)
          throw ApiError.validation({ options: ["An option is listed twice"] });
        activeCount = body.options.length;
      }
      const minCount = body.minCount ?? before.minCount;
      const maxCount = body.maxCount ?? before.maxCount;
      const problems = countProblems(minCount, maxCount, activeCount);
      if (Object.keys(problems).length > 0) throw ApiError.validation(problems);

      if (body.options) {
        const keep = new Set<string>();
        const createdBase = Date.now();
        for (const [index, option] of body.options.entries()) {
          const data = { name: option.names, deltaFils: BigInt(option.deltaFils), active: true };
          if (option.id) {
            keep.add(option.id);
            await tx.modifierOption.update({ where: { id: option.id }, data });
          } else {
            const created = await tx.modifierOption.create({
              data: {
                ...data,
                groupId: params.id,
                merchantId: before.merchantId,
                createdAt: new Date(createdBase + index),
              },
            });
            keep.add(created.id);
          }
        }
        // Options left out are deactivated, never deleted: past orders refer to them.
        await tx.modifierOption.updateMany({
          where: { groupId: params.id, id: { notIn: [...keep] }, active: true },
          data: { active: false },
        });
      }
      await tx.modifierGroup.update({
        where: { id: params.id },
        data: {
          ...(body.names && { name: body.names }),
          ...(body.minCount !== undefined && { minCount: body.minCount }),
          ...(body.maxCount !== undefined && { maxCount: body.maxCount }),
          ...(body.sort !== undefined && { sort: body.sort }),
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "catalog.modifier_group_updated",
          targetType: "modifier_group",
          targetId: params.id,
          requestId,
          before: toGroupView(before),
          after: body,
        },
        tx,
      );
      return tx.modifierGroup.findUniqueOrThrow({
        where: { id: params.id },
        include: groupInclude,
      });
    });
    return { data: toGroupView(row) };
  }
}
