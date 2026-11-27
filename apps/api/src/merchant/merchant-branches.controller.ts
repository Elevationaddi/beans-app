import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  type BranchException,
  type BranchHours,
  type BranchOptionAvailability,
  type BranchProductAvailability,
  type BranchSlot,
  branchExceptionParamsSchema,
  branchOptionParamsSchema,
  branchProductParamsSchema,
  branchSlotsQuerySchema,
  type CreateBranchRequest,
  createBranchRequestSchema,
  type MerchantBranch,
  type PageQuery,
  pageQuerySchema,
  type PutBranchExceptionRequest,
  putBranchExceptionRequestSchema,
  type PutBranchOptionRequest,
  putBranchOptionRequestSchema,
  type PutBranchProductRequest,
  putBranchProductRequestSchema,
  type UpdateBranchRequest,
  updateBranchRequestSchema,
  uuidSchema,
} from "@beans/contracts";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import { isCheckViolation, isExclusionViolation } from "../common/db-errors.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { BranchStatus, Prisma } from "../generated/prisma/client.js";
import { clockToTime, intervalProblems, localToday } from "../inventory/schedule.js";
import { SlotService } from "../inventory/slot.service.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";
import { branchSelect, toBranchView } from "./branch-view.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

/** Allowed status changes. Pausing stops new checkouts only; accepted orders stay fulfillable. */
const TRANSITIONS: Record<BranchStatus, readonly BranchStatus[]> = {
  draft: ["active", "closed"],
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: ["active"],
};

/** Fields a branch manager may change; everything else is the owner's. */
const MANAGER_FIELDS = new Set(["hours", "status"]);
const MANAGER_STATUSES = new Set<BranchStatus>(["active", "paused"]);

function hoursProblems(hours: readonly BranchHours[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const problems = intervalProblems(hours.filter((h) => h.weekday === weekday));
    if (problems.length > 0) errors[`hours.weekday${weekday}`] = problems;
  }
  return errors;
}

function invalidTransition(message: string): ApiError {
  return new ApiError(HttpStatus.CONFLICT, "INVALID_TRANSITION", message);
}

function notApproved(error: unknown): never {
  if (isCheckViolation(error, "is not approved")) {
    throw invalidTransition("The merchant must be approved before a branch can open");
  }
  if (isExclusionViolation(error)) {
    throw ApiError.validation({ hours: ["Opening intervals overlap"] });
  }
  throw error;
}

const fils = (value: bigint | null) => (value === null ? null : value.toString());

@Controller("merchant/branches")
export class MerchantBranchesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SlotService) private readonly slots: SlotService,
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
      data: page.map((row) => toBranchView(row)),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: MerchantBranch }> {
    await this.access.requireBranch(actor.userId, params.id);
    return { data: await this.load(params.id) };
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createBranchRequestSchema)) body: CreateBranchRequest,
  ): Promise<{ data: MerchantBranch }> {
    await this.access.requireOperatingOwner(actor.userId, body.merchantId);
    const problems = hoursProblems(body.hours);
    if (Object.keys(problems).length > 0) throw ApiError.validation(problems);

    const branch = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.branch.create({
          data: {
            merchantId: body.merchantId,
            nameEn: body.nameEn,
            nameAr: body.nameAr ?? null,
            address: body.address,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            phone: body.phone ?? null,
            modes: body.modes,
            capacity: body.capacity,
            status: "draft",
            hours: {
              create: body.hours.map((h) => ({
                weekday: h.weekday,
                opens: clockToTime(h.opens),
                closes: clockToTime(h.closes),
              })),
            },
          },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "branch.created",
            targetType: "branch",
            targetId: created.id,
            requestId,
            after: { merchantId: body.merchantId, nameEn: body.nameEn, capacity: body.capacity },
          },
          tx,
        );
        return created;
      })
      .catch(notApproved);
    return { data: await this.load(branch.id) };
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateBranchRequestSchema)) body: UpdateBranchRequest,
  ): Promise<{ data: MerchantBranch }> {
    const access = await this.access.requireBranchManager(actor.userId, params.id);
    if (access.role !== "owner") {
      const ownerOnly = Object.keys(body).filter((key) => !MANAGER_FIELDS.has(key));
      if (ownerOnly.length > 0 || (body.status && !MANAGER_STATUSES.has(body.status))) {
        throw ApiError.forbidden(
          "Managers can change opening hours and pause or resume the branch",
        );
      }
    }
    if (body.hours) {
      const problems = hoursProblems(body.hours);
      if (Object.keys(problems).length > 0) throw ApiError.validation(problems);
    }

    await this.prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM branches WHERE id = ${params.id}::uuid FOR UPDATE`;
        const before = await tx.branch.findUniqueOrThrow({
          where: { id: params.id },
          include: { hours: true, merchant: { select: { status: true } } },
        });

        if (body.status && body.status !== before.status) {
          if (!TRANSITIONS[before.status].includes(body.status)) {
            throw invalidTransition(`A ${before.status} branch cannot become ${body.status}`);
          }
          if (body.status === "active") {
            if (before.merchant.status !== "approved") {
              throw invalidTransition("The merchant must be approved before a branch can open");
            }
            const hourCount = body.hours ? body.hours.length : before.hours.length;
            if (hourCount === 0) {
              throw new ApiError(
                HttpStatus.UNPROCESSABLE_ENTITY,
                "VALIDATION_FAILED",
                "Add opening hours before opening the branch",
                { hours: ["At least one opening interval is required to open"] },
              );
            }
          }
        }

        const data: Prisma.BranchUpdateInput = {
          ...(body.nameEn !== undefined && { nameEn: body.nameEn }),
          ...(body.nameAr !== undefined && { nameAr: body.nameAr }),
          ...(body.address !== undefined && { address: body.address }),
          ...(body.lat !== undefined && { lat: body.lat }),
          ...(body.lng !== undefined && { lng: body.lng }),
          ...(body.phone !== undefined && { phone: body.phone }),
          ...(body.modes !== undefined && { modes: body.modes }),
          ...(body.capacity !== undefined && { capacity: body.capacity }),
          ...(body.status !== undefined && { status: body.status }),
        };
        await tx.branch.update({ where: { id: params.id }, data });

        if (body.hours) {
          await tx.branchHour.deleteMany({ where: { branchId: params.id } });
          await tx.branchHour.createMany({
            data: body.hours.map((h) => ({
              branchId: params.id,
              weekday: h.weekday,
              opens: clockToTime(h.opens),
              closes: clockToTime(h.closes),
            })),
          });
        }
        if (body.capacity !== undefined && body.capacity !== before.capacity) {
          await this.slots.applyCapacity(tx, params.id, body.capacity);
        }

        await this.audit.record(
          {
            actorId: actor.userId,
            action:
              body.status && body.status !== before.status
                ? `branch.${body.status}`
                : "branch.updated",
            targetType: "branch",
            targetId: params.id,
            requestId,
            before: {
              status: before.status,
              capacity: before.capacity,
              nameEn: before.nameEn,
              hourCount: before.hours.length,
            },
            after: { ...body, hours: body.hours ? `${body.hours.length} intervals` : undefined },
          },
          tx,
        );
      })
      .catch(notApproved);
    return { data: await this.load(params.id) };
  }

  @Put(":id/exceptions/:date")
  async putException(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(branchExceptionParamsSchema)) params: { id: string; date: string },
    @Body(new ZodValidationPipe(putBranchExceptionRequestSchema)) body: PutBranchExceptionRequest,
  ): Promise<{ data: BranchException }> {
    await this.access.requireBranchManager(actor.userId, params.id);
    if (body.closed && body.intervals.length > 0) {
      throw ApiError.validation({ intervals: ["A closed day has no opening intervals"] });
    }
    if (!body.closed && body.intervals.length === 0) {
      throw ApiError.validation({ intervals: ["Send the opening intervals, or closed: true"] });
    }
    const problems = intervalProblems(body.intervals);
    if (problems.length > 0) throw ApiError.validation({ intervals: problems });

    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: params.id },
      select: { timezone: true },
    });
    if (params.date < localToday(branch.timezone)) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "The date has passed",
        {
          date: ["Choose today or a later date"],
        },
      );
    }

    const localDate = new Date(`${params.date}T00:00:00.000Z`);
    const intervals = [...body.intervals].sort((a, b) => a.opens.localeCompare(b.opens));
    await this.prisma.$transaction(async (tx) => {
      await tx.branchException.upsert({
        where: { branchId_localDate: { branchId: params.id, localDate } },
        create: { branchId: params.id, localDate, closed: body.closed, intervals },
        update: { closed: body.closed, intervals },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "branch.exception_set",
          targetType: "branch",
          targetId: params.id,
          requestId,
          after: { date: params.date, closed: body.closed, intervals },
        },
        tx,
      );
    });
    return { data: { date: params.date, closed: body.closed, intervals } };
  }

  @Get(":id/slots")
  async listSlots(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
    @Query(new ZodValidationPipe(branchSlotsQuerySchema)) query: { date: string },
  ): Promise<{ data: { date: string; timezone: string; slots: BranchSlot[] } }> {
    const access = await this.access.requireBranch(actor.userId, params.id);
    if (access.role === "analyst") throw ApiError.forbidden();
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: params.id },
      select: { timezone: true },
    });
    const rows = await this.slots.ensureSlots(params.id, query.date);
    return {
      data: {
        date: query.date,
        timezone: branch.timezone,
        slots: rows.map((s) => ({
          id: s.id,
          startsAt: s.startsAt.toISOString(),
          capacity: s.capacity,
          reserved: s.reserved,
          confirmed: s.confirmed,
        })),
      },
    };
  }

  @Put(":id/products/:productId")
  async putProduct(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(branchProductParamsSchema))
    params: { id: string; productId: string },
    @Body(new ZodValidationPipe(putBranchProductRequestSchema)) body: PutBranchProductRequest,
  ): Promise<{ data: BranchProductAvailability }> {
    const access = await this.access.requireBranchManager(actor.userId, params.id);
    const product = await this.prisma.product.findFirst({
      where: { id: params.productId, merchantId: access.merchantId },
      select: { status: true },
    });
    if (!product) throw ApiError.notFound("Product not found");
    if (body.enabled && product.status === "archived") {
      throw invalidTransition("An archived product cannot be enabled at a branch");
    }

    const values = {
      enabled: body.enabled,
      priceOverrideFils: body.priceOverrideFils === null ? null : BigInt(body.priceOverrideFils),
      stockOnHand: body.stockOnHand,
    };
    const row = await this.prisma
      .$transaction(async (tx) => {
        const before = await tx.branchProduct.findUnique({
          where: { branchId_productId: { branchId: params.id, productId: params.productId } },
        });
        const saved = await tx.branchProduct.upsert({
          where: { branchId_productId: { branchId: params.id, productId: params.productId } },
          create: {
            branchId: params.id,
            productId: params.productId,
            merchantId: access.merchantId,
            ...values,
          },
          update: values,
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "branch.product_availability_set",
            targetType: "branch_product",
            targetId: saved.id,
            requestId,
            before: before && {
              enabled: before.enabled,
              priceOverrideFils: fils(before.priceOverrideFils),
              stockOnHand: before.stockOnHand,
            },
            after: { ...body, branchId: params.id, productId: params.productId },
          },
          tx,
        );
        return saved;
      })
      .catch(async (error: unknown) => {
        if (isCheckViolation(error, "branch_products_stock_check")) {
          const held = await this.prisma.branchProduct.findUnique({
            where: { branchId_productId: { branchId: params.id, productId: params.productId } },
            select: { stockReserved: true },
          });
          throw new ApiError(
            HttpStatus.CONFLICT,
            "CONFLICT",
            `Stock on hand cannot be lower than the ${held?.stockReserved ?? 0} units held for open orders`,
          );
        }
        throw error;
      });
    return {
      data: {
        branchId: row.branchId,
        productId: row.productId,
        enabled: row.enabled,
        priceOverrideFils: fils(row.priceOverrideFils),
        stockOnHand: row.stockOnHand,
        stockReserved: row.stockReserved,
      },
    };
  }

  @Put(":id/options/:optionId")
  async putOption(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(branchOptionParamsSchema))
    params: { id: string; optionId: string },
    @Body(new ZodValidationPipe(putBranchOptionRequestSchema)) body: PutBranchOptionRequest,
  ): Promise<{ data: BranchOptionAvailability }> {
    const access = await this.access.requireBranchManager(actor.userId, params.id);
    const option = await this.prisma.modifierOption.findFirst({
      where: { id: params.optionId, merchantId: access.merchantId },
      select: { active: true },
    });
    if (!option) throw ApiError.notFound("Option not found");
    if (body.enabled && !option.active) {
      throw invalidTransition("A removed option cannot be enabled at a branch");
    }
    const values = {
      enabled: body.enabled,
      deltaOverrideFils: body.deltaOverrideFils === null ? null : BigInt(body.deltaOverrideFils),
    };
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.branchOption.upsert({
        where: { branchId_optionId: { branchId: params.id, optionId: params.optionId } },
        create: {
          branchId: params.id,
          optionId: params.optionId,
          merchantId: access.merchantId,
          ...values,
        },
        update: values,
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "branch.option_availability_set",
          targetType: "branch_option",
          targetId: saved.id,
          requestId,
          after: { ...body, branchId: params.id, optionId: params.optionId },
        },
        tx,
      );
      return saved;
    });
    return {
      data: {
        branchId: row.branchId,
        optionId: row.optionId,
        enabled: row.enabled,
        deltaOverrideFils: fils(row.deltaOverrideFils),
      },
    };
  }

  private async load(id: string): Promise<MerchantBranch> {
    const row = await this.prisma.branch.findUniqueOrThrow({ where: { id }, select: branchSelect });
    return toBranchView(row);
  }
}
