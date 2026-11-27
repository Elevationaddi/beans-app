import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  type AdminMerchantDetail,
  type AdminMerchantQuery,
  adminMerchantQuerySchema,
  type ReviewDecision,
  type ReviewMerchantRequest,
  reviewMerchantRequestSchema,
  uuidSchema,
} from "@beans/contracts";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import { FilesService } from "../files/files.service.js";
import type { MerchantStatus } from "../generated/prisma/client.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { applicationInclude, toApplicationView } from "./application-view.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

/** Review state machine (docs/03 B01, docs/04 A02). One decision, one transition. */
export const REVIEW_TRANSITIONS: Record<
  ReviewDecision,
  { from: MerchantStatus; to: MerchantStatus }
> = {
  start_review: { from: "submitted", to: "review" },
  approve: { from: "review", to: "approved" },
  reject: { from: "review", to: "rejected" },
  request_changes: { from: "review", to: "draft" },
  suspend: { from: "approved", to: "suspended" },
  reinstate: { from: "suspended", to: "approved" },
};

@Controller("admin/merchants")
export class AdminMerchantsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  @Get()
  @RequireAdmin("operations")
  async list(@Query(new ZodValidationPipe(adminMerchantQuerySchema)) query: AdminMerchantQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.merchant.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(cursor && {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      include: { _count: { select: { branches: true } } },
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((m) => ({
        id: m.id,
        legalName: m.legalName,
        brandName: m.brandName,
        status: m.status,
        submittedAt: m.submittedAt?.toISOString() ?? null,
        branchCount: m._count.branches,
      })),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Get(":id")
  @RequireAdmin("operations")
  async get(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: AdminMerchantDetail }> {
    return { data: await this.detail(params.id, actor, requestId) };
  }

  @Post(":id/review")
  @HttpCode(200)
  @RequireAdmin("operations")
  async review(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(reviewMerchantRequestSchema)) body: ReviewMerchantRequest,
  ): Promise<{ data: AdminMerchantDetail }> {
    const transition = REVIEW_TRANSITIONS[body.decision];
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: params.id },
      include: {
        memberships: { where: { userId: actor.userId }, select: { id: true } },
        ...applicationInclude,
      },
    });
    if (!merchant) throw ApiError.notFound("Merchant not found");
    if (merchant.memberships.length > 0) {
      throw ApiError.forbidden("You cannot review a merchant you belong to");
    }
    if (merchant.status !== body.expectedStatus || merchant.status !== transition.from) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "INVALID_TRANSITION",
        `Cannot ${body.decision.replace("_", " ")} a merchant that is ${merchant.status}`,
      );
    }
    if (body.decision === "approve") {
      const licence = merchant.documents.find(
        (d) => d.type === "trade_license" && d.upload.status === "clean",
      );
      if (!licence) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "VALIDATION_FAILED",
          "A checked trade licence is required before approval",
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const changed = await tx.merchant.updateMany({
        where: { id: params.id, status: transition.from },
        data: {
          status: transition.to,
          reviewedAt: now,
          // Shown to the applicant when it explains what to fix or why it was declined.
          ...(["request_changes", "reject"].includes(body.decision) && { reviewNote: body.reason }),
          ...(body.decision === "approve" && { reviewNote: null }),
        },
      });
      if (changed.count === 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          "Someone else changed this merchant first",
        );
      }
      if (body.decision === "approve") {
        await tx.merchantDocument.updateMany({
          where: { merchantId: params.id },
          data: { reviewStatus: "accepted" },
        });
      }
      await this.audit.record(
        {
          actorId: actor.userId,
          action: `merchant.${body.decision}`,
          targetType: "merchant",
          targetId: params.id,
          requestId,
          reason: body.reason,
          before: { status: transition.from },
          after: { status: transition.to },
        },
        tx,
      );
      await this.outbox.enqueue(tx, {
        topic: "merchant.status_changed",
        aggregateId: params.id,
        dedupeKey: `merchant.status_changed:${params.id}:${requestId}`,
        payload: {
          merchantId: params.id,
          from: transition.from,
          to: transition.to,
          decision: body.decision,
        },
      });
    });
    return { data: await this.detail(params.id, actor, requestId) };
  }

  private async detail(id: string, actor: Actor, requestId: string): Promise<AdminMerchantDetail> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: { ...applicationInclude, _count: { select: { branches: true } } },
    });
    if (!merchant) throw ApiError.notFound("Merchant not found");
    const view = toApplicationView(merchant);
    const links = new Map(
      merchant.documents.map((doc) => [doc.id, this.files.downloadLink(doc.upload)]),
    );
    const issued = [...links.entries()].filter(([, url]) => url !== null).map(([docId]) => docId);
    if (issued.length > 0) {
      // Privileged read of applicant documents (docs/10-security.md).
      await this.audit.record({
        actorId: actor.userId,
        action: "merchant.documents_link_issued",
        targetType: "merchant",
        targetId: id,
        requestId,
        after: { documentIds: issued },
      });
    }
    return {
      ...view,
      documents: view.documents.map((doc) => ({ ...doc, downloadUrl: links.get(doc.id) ?? null })),
      branchCount: merchant._count.branches,
    };
  }
}
