import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  type CreateApplicationRequest,
  createApplicationRequestSchema,
  type MerchantApplication,
  type PageQuery,
  pageQuerySchema,
  type SubmitApplicationRequest,
  submitApplicationRequestSchema,
  type UpdateApplicationRequest,
  updateApplicationRequestSchema,
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
import { Prisma } from "../generated/prisma/client.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";
import { applicationInclude, toApplicationView } from "./application-view.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

function licenceConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ApiError(
      HttpStatus.CONFLICT,
      "CONFLICT",
      "A merchant with this licence number is already registered",
    );
  }
  throw error;
}

@Controller("merchant/applications")
export class ApplicationsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createApplicationRequestSchema)) body: CreateApplicationRequest,
  ): Promise<{ data: MerchantApplication }> {
    const merchant = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.merchant.create({
          data: {
            legalName: body.legalName,
            brandName: body.brandName,
            licenseNumber: body.licenseNumber,
            contact: body.contact,
            status: "draft",
            memberships: { create: { userId: actor.userId, role: "owner", status: "active" } },
          },
          include: applicationInclude,
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "merchant.application_created",
            targetType: "merchant",
            targetId: created.id,
            requestId,
            after: {
              legalName: body.legalName,
              brandName: body.brandName,
              licenseNumber: body.licenseNumber,
            },
          },
          tx,
        );
        return created;
      })
      .catch(licenceConflict);
    return { data: toApplicationView(merchant) };
  }

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<{ data: MerchantApplication[]; meta: { nextCursor: string | null } }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.merchant.findMany({
      where: {
        memberships: { some: { userId: actor.userId, role: "owner", status: "active" } },
        ...(cursor && {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      include: applicationInclude,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toApplicationView),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: MerchantApplication }> {
    await this.access.requireOwner(actor.userId, params.id);
    return { data: await this.load(params.id) };
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateApplicationRequestSchema)) body: UpdateApplicationRequest,
  ): Promise<{ data: MerchantApplication }> {
    const before = await this.access.requireOwner(actor.userId, params.id);
    await this.prisma
      .$transaction(async (tx) => {
        const changed = await tx.merchant.updateMany({
          where: { id: params.id, status: "draft" },
          data: {
            ...(body.legalName !== undefined && { legalName: body.legalName }),
            ...(body.brandName !== undefined && { brandName: body.brandName }),
            ...(body.licenseNumber !== undefined && { licenseNumber: body.licenseNumber }),
            ...(body.contact !== undefined && { contact: body.contact }),
          },
        });
        if (changed.count === 0) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            "INVALID_TRANSITION",
            "Only a draft application can be edited",
          );
        }
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "merchant.application_updated",
            targetType: "merchant",
            targetId: params.id,
            requestId,
            before: {
              legalName: before.legalName,
              brandName: before.brandName,
              licenseNumber: before.licenseNumber,
            },
            after: { ...body, contact: body.contact ? "[changed]" : undefined },
          },
          tx,
        );
      })
      .catch(licenceConflict);
    return { data: await this.load(params.id) };
  }

  @Post(":id/submit")
  @HttpCode(200)
  async submit(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(submitApplicationRequestSchema)) body: SubmitApplicationRequest,
  ): Promise<{ data: MerchantApplication }> {
    await this.access.requireOwner(actor.userId, params.id);
    const documentIds = [...new Set(body.documentIds)];
    const documents = await this.prisma.merchantDocument.findMany({
      where: { id: { in: documentIds }, merchantId: params.id },
      include: { upload: { select: { status: true } } },
    });

    const fieldErrors: Record<string, string[]> = {};
    if (documents.length !== documentIds.length) {
      // Documents of other merchants look exactly like documents that do not exist.
      fieldErrors["documentIds"] = ["One or more documents were not found on this application"];
    } else if (documents.some((doc) => doc.upload.status !== "clean")) {
      fieldErrors["documentIds"] = ["Every document must pass the file check before submitting"];
    } else if (!documents.some((doc) => doc.type === "trade_license")) {
      fieldErrors["documentIds"] = ["Include the trade licence"];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "The application cannot be submitted yet",
        fieldErrors,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const changed = await tx.merchant.updateMany({
        where: { id: params.id, status: "draft" },
        data: { status: "submitted", submittedAt: now, reviewNote: null },
      });
      if (changed.count === 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          "Only a draft application can be submitted",
        );
      }
      await tx.merchantDocument.updateMany({
        where: { id: { in: documentIds } },
        data: { reviewStatus: "pending" },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "merchant.application_submitted",
          targetType: "merchant",
          targetId: params.id,
          requestId,
          before: { status: "draft" },
          after: { status: "submitted", documentIds },
        },
        tx,
      );
      await this.outbox.enqueue(tx, {
        topic: "merchant.application_submitted",
        aggregateId: params.id,
        dedupeKey: `merchant.application_submitted:${params.id}:${now.toISOString()}`,
        payload: { merchantId: params.id },
      });
    });
    return { data: await this.load(params.id) };
  }

  private async load(id: string) {
    return toApplicationView(
      await this.prisma.merchant.findUniqueOrThrow({ where: { id }, include: applicationInclude }),
    );
  }
}
