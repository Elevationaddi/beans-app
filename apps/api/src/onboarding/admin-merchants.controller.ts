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
  type AddMerchantNoteRequest,
  addMerchantNoteRequestSchema,
  type AdminMerchantDetail,
  type AdminMerchantQuery,
  adminMerchantQuerySchema,
  type CreateVerifiedMerchantRequest,
  createVerifiedMerchantRequestSchema,
  type RecordVerificationRequest,
  recordVerificationRequestSchema,
  type ReviewDecision,
  type ReviewMerchantRequest,
  reviewMerchantRequestSchema,
  uuidSchema,
} from "@beans/contracts";
import { randomBytes } from "node:crypto";
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
import { Prisma, type MerchantStatus } from "../generated/prisma/client.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { SettingsService } from "../platform/settings.service.js";
import { hashInvitationToken } from "../staff/invitation-token.js";
import {
  applicationInclude,
  fromLocalDate,
  toApplicationView,
  toLocalDate,
} from "./application-view.js";

/** Today in Asia/Dubai as YYYY-MM-DD (licence dates are calendar dates in the UAE). */
function dubaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}

/**
 * A licence counts as verified when an administrator recorded a manual check of this licence
 * number and the licence has not expired. Never an automatic or government verification.
 */
function hasCurrentManualVerification(
  merchant: { licenseNumber: string },
  verifications: { licenseNumber: string; licenseExpiresOn: Date }[],
): boolean {
  const today = dubaiToday();
  return verifications.some(
    (v) =>
      v.licenseNumber === merchant.licenseNumber && (toLocalDate(v.licenseExpiresOn) ?? "") > today,
  );
}

function verificationDateProblems(input: {
  verifiedOn: string;
  licenseExpiresOn: string;
}): Record<string, string[]> {
  const problems: Record<string, string[]> = {};
  const today = dubaiToday();
  if (input.verifiedOn > today) problems["verifiedOn"] = ["Cannot be in the future"];
  if (input.licenseExpiresOn <= today) problems["licenseExpiresOn"] = ["The licence has expired"];
  if (input.licenseExpiresOn <= input.verifiedOn) {
    problems["licenseExpiresOn"] = ["Must be after the verification date"];
  }
  return problems;
}

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
    @Inject(SettingsService) private readonly settings: SettingsService,
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
      include: {
        _count: { select: { branches: true } },
        verifications: { orderBy: { verifiedOn: "desc" }, take: 1, select: { verifiedOn: true } },
      },
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
        emirate: m.emirate,
        licenseExpiresOn: toLocalDate(m.licenseExpiresOn),
        lastVerifiedOn: toLocalDate(m.verifications[0]?.verifiedOn ?? null),
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
        verifications: { select: { licenseNumber: true, licenseExpiresOn: true } },
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
      if (!licence && !hasCurrentManualVerification(merchant, merchant.verifications)) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "VALIDATION_FAILED",
          "Record a manual licence check (licence number matching, not expired) before approval",
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

  @Post(":id/verifications")
  @RequireAdmin("operations")
  async recordVerification(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(recordVerificationRequestSchema)) body: RecordVerificationRequest,
  ): Promise<{ data: AdminMerchantDetail }> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: params.id },
      include: { memberships: { where: { userId: actor.userId }, select: { id: true } } },
    });
    if (!merchant) throw ApiError.notFound("Merchant not found");
    if (merchant.memberships.length > 0) {
      throw ApiError.forbidden("You cannot verify a merchant you belong to");
    }
    if (merchant.status === "draft" || merchant.status === "rejected") {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "INVALID_TRANSITION",
        `Cannot record a licence check for a merchant that is ${merchant.status}`,
      );
    }
    const problems = verificationDateProblems(body);
    if (body.licenseNumber !== merchant.licenseNumber) {
      problems["licenseNumber"] = ["Does not match the licence number on the application"];
    }
    if (Object.keys(problems).length > 0) throw ApiError.validation(problems);

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.merchantVerification.create({
        data: {
          merchantId: params.id,
          verifiedById: actor.userId,
          verifiedOn: fromLocalDate(body.verifiedOn),
          licenseNumber: body.licenseNumber,
          licenseAuthority: body.licenseAuthority,
          licenseExpiresOn: fromLocalDate(body.licenseExpiresOn),
          source: body.source,
          notes: body.notes ?? null,
        },
      });
      await tx.merchant.update({
        where: { id: params.id },
        data: {
          licenseAuthority: body.licenseAuthority,
          licenseExpiresOn: fromLocalDate(body.licenseExpiresOn),
        },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "merchant.licence_checked_manually",
          targetType: "merchant",
          targetId: params.id,
          requestId,
          after: {
            verificationId: created.id,
            method: "manual_external_check",
            verifiedOn: body.verifiedOn,
            licenseExpiresOn: body.licenseExpiresOn,
            source: body.source,
          },
        },
        tx,
      );
    });
    return { data: await this.detail(params.id, actor, requestId) };
  }

  @Post(":id/notes")
  @RequireAdmin("operations")
  async addNote(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(addMerchantNoteRequestSchema)) body: AddMerchantNoteRequest,
  ): Promise<{ data: AdminMerchantDetail }> {
    const exists = await this.prisma.merchant.count({ where: { id: params.id } });
    if (exists === 0) throw ApiError.notFound("Merchant not found");
    await this.prisma.$transaction(async (tx) => {
      const note = await tx.merchantNote.create({
        data: { merchantId: params.id, authorId: actor.userId, body: body.body },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "merchant.note_added",
          targetType: "merchant",
          targetId: params.id,
          requestId,
          after: { noteId: note.id },
        },
        tx,
      );
    });
    return { data: await this.detail(params.id, actor, requestId) };
  }

  @Post()
  @RequireAdmin("operations")
  async createVerified(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createVerifiedMerchantRequestSchema))
    body: CreateVerifiedMerchantRequest,
  ): Promise<{ data: { merchant: AdminMerchantDetail; ownerInvitationToken: string } }> {
    const problems = verificationDateProblems({
      verifiedOn: body.verification.verifiedOn,
      licenseExpiresOn: body.licenseExpiresOn,
    });
    if (Object.keys(problems).length > 0) throw ApiError.validation(problems);
    const token = randomBytes(32).toString("base64url");
    const { invitationHours } = await this.settings.get("operations");
    const ownerEmail = body.ownerEmail.toLowerCase();
    const merchantId = await this.prisma
      .$transaction(async (tx) => {
        const now = new Date();
        const merchant = await tx.merchant.create({
          data: {
            legalName: body.legalName,
            brandName: body.brandName,
            licenseNumber: body.licenseNumber,
            licenseAuthority: body.licenseAuthority,
            licenseExpiresOn: fromLocalDate(body.licenseExpiresOn),
            emirate: body.emirate,
            contact: body.contact,
            representative: body.representative,
            declaredBranchCount: body.declaredBranchCount,
            description: body.description ?? null,
            status: "approved",
            submittedAt: now,
            reviewedAt: now,
          },
        });
        const verification = await tx.merchantVerification.create({
          data: {
            merchantId: merchant.id,
            verifiedById: actor.userId,
            verifiedOn: fromLocalDate(body.verification.verifiedOn),
            licenseNumber: body.licenseNumber,
            licenseAuthority: body.licenseAuthority,
            licenseExpiresOn: fromLocalDate(body.licenseExpiresOn),
            source: body.verification.source,
            notes: body.verification.notes ?? null,
          },
        });
        const invitation = await tx.staffInvitation.create({
          data: {
            merchantId: merchant.id,
            email: ownerEmail,
            role: "owner",
            branchIds: [],
            tokenHash: hashInvitationToken(token),
            invitedById: actor.userId,
            expiresAt: new Date(now.getTime() + invitationHours * 3_600_000),
          },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "merchant.created_verified",
            targetType: "merchant",
            targetId: merchant.id,
            requestId,
            reason: body.reason,
            after: {
              status: "approved",
              licenseNumber: body.licenseNumber,
              verificationId: verification.id,
              method: "manual_external_check",
              ownerInvitationId: invitation.id,
            },
          },
          tx,
        );
        await this.outbox.enqueue(tx, {
          topic: "staff.invited",
          aggregateId: invitation.id,
          dedupeKey: `staff.invited:${invitation.id}`,
          payload: { invitationId: invitation.id, merchantId: merchant.id },
        });
        return merchant.id;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ApiError(
            HttpStatus.CONFLICT,
            "CONFLICT",
            "A merchant with this licence number is already registered",
          );
        }
        throw error;
      });
    return {
      data: {
        merchant: await this.detail(merchantId, actor, requestId),
        ownerInvitationToken: token,
      },
    };
  }

  private async detail(id: string, actor: Actor, requestId: string): Promise<AdminMerchantDetail> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        ...applicationInclude,
        _count: { select: { branches: true } },
        verifications: {
          orderBy: [{ verifiedOn: "desc" }, { createdAt: "desc" }],
          include: { verifiedBy: { select: { id: true, displayName: true, email: true } } },
        },
        internalNotes: {
          orderBy: { createdAt: "desc" },
          include: { author: { select: { id: true, displayName: true, email: true } } },
        },
      },
    });
    if (!merchant) throw ApiError.notFound("Merchant not found");
    const history = await this.prisma.auditEvent.findMany({
      where: { targetType: "merchant", targetId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { actor: { select: { displayName: true, email: true } } },
    });
    const view = toApplicationView(merchant, this.files.documentsAccepted);
    const links = new Map(
      await Promise.all(
        merchant.documents.map(
          async (doc) => [doc.id, await this.files.downloadLink(doc.upload)] as const,
        ),
      ),
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
      verifications: merchant.verifications.map((v) => ({
        id: v.id,
        method: "manual_external_check" as const,
        verifiedOn: toLocalDate(v.verifiedOn)!,
        verifiedBy: { id: v.verifiedBy.id, name: v.verifiedBy.displayName ?? v.verifiedBy.email },
        licenseNumber: v.licenseNumber,
        licenseAuthority: v.licenseAuthority,
        licenseExpiresOn: toLocalDate(v.licenseExpiresOn)!,
        source: v.source,
        notes: v.notes,
        createdAt: v.createdAt.toISOString(),
      })),
      notes: merchant.internalNotes.map((n) => ({
        id: n.id,
        author: { id: n.author.id, name: n.author.displayName ?? n.author.email },
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      })),
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        actorName: h.actor?.displayName ?? h.actor?.email ?? null,
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
    };
  }
}
