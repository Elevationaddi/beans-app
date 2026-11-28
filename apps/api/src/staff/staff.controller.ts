import { SettingsService } from "../platform/settings.service.js";
import { createHash, randomBytes } from "node:crypto";
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
  acceptInvitationRequestSchema,
  type InviteStaffRequest,
  inviteStaffRequestSchema,
  type StaffInvitation,
  type StaffMember,
  staffQuerySchema,
  type UpdateStaffRequest,
  updateStaffRequestSchema,
  uuidSchema,
} from "@beans/contracts";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { isUniqueViolation } from "../common/db-errors.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { MembershipRole, Prisma } from "../generated/prisma/client.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { MerchantAccessService, within } from "../tenancy/merchant-access.service.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

/**
 * How long an invitation stays valid. Operational sandbox default, not a commercial policy;
 * recorded in docs/13-progress.md for confirmation.
 */

/** Merchants that can still take on staff (suspended or rejected tenants cannot). */
const OPERATING = ["draft", "submitted", "review", "approved"] as const;

const memberInclude = {
  user: { select: { displayName: true, email: true } },
  branches: { select: { branchId: true } },
} satisfies Prisma.MembershipInclude;
type MemberRow = Prisma.MembershipGetPayload<{ include: typeof memberInclude }>;
type InvitationRow = Prisma.StaffInvitationGetPayload<object>;

function toMemberView(row: MemberRow): StaffMember {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.user.displayName,
    email: row.user.email,
    role: row.role,
    status: row.status,
    branchIds: row.branches.map((b) => b.branchId).sort(),
    catalogDelegated: row.catalogDelegated,
  };
}

function toInvitationView(row: InvitationRow, now = new Date()): StaffInvitation {
  const expired = row.status === "pending" && row.expiresAt <= now;
  return {
    id: row.id,
    merchantId: row.merchantId,
    email: row.email,
    role: row.role as StaffInvitation["role"],
    branchIds: [...row.branchIds].sort(),
    catalogDelegated: row.catalogDelegated,
    status: expired ? "expired" : row.status,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function conflict(message: string): ApiError {
  return new ApiError(HttpStatus.CONFLICT, "CONFLICT", message);
}

/** Assignment rules shared by invitations and membership edits (no privilege escalation). */
async function assignmentProblems(
  tx: Prisma.TransactionClient,
  merchantId: string,
  role: MembershipRole,
  branchIds: readonly string[],
  catalogDelegated: boolean,
): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = {};
  const unique = new Set(branchIds);
  if (unique.size !== branchIds.length) errors["branchIds"] = ["A branch is listed twice"];
  if (unique.size > 0) {
    const found = await tx.branch.count({ where: { id: { in: [...unique] }, merchantId } });
    if (found !== unique.size) errors["branchIds"] = ["Branch not found"];
  }
  if ((role === "manager" || role === "barista") && unique.size === 0) {
    errors["branchIds"] = [`A ${role} needs at least one branch`];
  }
  if (catalogDelegated && role !== "manager") {
    errors["catalogDelegated"] = ["Only managers can be given menu editing"];
  }
  return errors;
}

@Controller("merchant")
export class StaffController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  @Get("staff")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(staffQuerySchema)) query: { merchantId: string },
  ): Promise<{ data: { members: StaffMember[]; invitations: StaffInvitation[] } }> {
    await this.access.requireOperatingOwner(actor.userId, query.merchantId);
    const [members, invitations] = await Promise.all([
      this.prisma.membership.findMany({
        where: { merchantId: query.merchantId },
        include: memberInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.staffInvitation.findMany({
        where: { merchantId: query.merchantId, status: "pending" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const now = new Date();
    return {
      data: {
        members: members.map(toMemberView),
        invitations: invitations.map((row) => toInvitationView(row, now)),
      },
    };
  }

  @Post("staff")
  async invite(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(inviteStaffRequestSchema)) body: InviteStaffRequest,
  ): Promise<{ data: { invitation: StaffInvitation; token: string } }> {
    await this.access.requireOperatingOwner(actor.userId, body.merchantId);
    const token = randomBytes(32).toString("base64url");
    const { invitationHours } = await this.settings.get("operations");

    const row = await this.prisma
      .$transaction(async (tx) => {
        const problems = await assignmentProblems(
          tx,
          body.merchantId,
          body.role,
          body.branchIds,
          body.catalogDelegated,
        );
        if (Object.keys(problems).length > 0) throw ApiError.validation(problems);

        const alreadyMember = await tx.membership.count({
          where: {
            merchantId: body.merchantId,
            status: "active",
            user: { email: { equals: body.email, mode: "insensitive" } },
          },
        });
        if (alreadyMember > 0) throw conflict("This person is already a member of the merchant");

        // An expired pending invitation for the same email is replaced.
        await tx.staffInvitation.updateMany({
          where: {
            merchantId: body.merchantId,
            email: body.email,
            status: "pending",
            expiresAt: { lte: new Date() },
          },
          data: { status: "revoked" },
        });
        const created = await tx.staffInvitation.create({
          data: {
            merchantId: body.merchantId,
            email: body.email,
            role: body.role,
            branchIds: [...new Set(body.branchIds)],
            catalogDelegated: body.catalogDelegated,
            tokenHash: hashInvitationToken(token),
            invitedById: actor.userId,
            expiresAt: new Date(Date.now() + invitationHours * 3_600_000),
          },
        });
        // No email is sent: delivery waits for an approved notification provider.
        await this.outbox.enqueue(tx, {
          topic: "staff.invited",
          aggregateId: created.id,
          dedupeKey: `staff.invited:${created.id}`,
          payload: { invitationId: created.id, merchantId: body.merchantId },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "staff.invited",
            targetType: "staff_invitation",
            targetId: created.id,
            requestId,
            after: {
              merchantId: body.merchantId,
              email: body.email,
              role: body.role,
              branchIds: body.branchIds,
              catalogDelegated: body.catalogDelegated,
            },
          },
          tx,
        );
        return created;
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error))
          throw conflict("An invitation for this email is already pending");
        throw error;
      });
    return { data: { invitation: toInvitationView(row), token } };
  }

  @Post("staff/invitations/:id/revoke")
  @HttpCode(200)
  async revokeInvitation(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: StaffInvitation }> {
    const existing = await this.prisma.staffInvitation.findUnique({ where: { id: params.id } });
    if (!existing) throw ApiError.notFound("Invitation not found");
    await within(
      this.access.requireOperatingOwner(actor.userId, existing.merchantId),
      "Invitation",
    );
    const row = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.staffInvitation.updateMany({
        where: { id: params.id, status: "pending" },
        data: { status: "revoked" },
      });
      if (changed.count === 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          "Only a pending invitation can be revoked",
        );
      }
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "staff.invitation_revoked",
          targetType: "staff_invitation",
          targetId: params.id,
          requestId,
        },
        tx,
      );
      return tx.staffInvitation.findUniqueOrThrow({ where: { id: params.id } });
    });
    return { data: toInvitationView(row) };
  }

  @Post("invitations/accept")
  @HttpCode(200)
  async accept(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: { token: string },
  ): Promise<{ data: StaffMember }> {
    const tokenHash = hashInvitationToken(body.token);
    const membershipId = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM staff_invitations WHERE token_hash = ${tokenHash} FOR UPDATE`;
      const id = locked[0]?.id;
      if (!id) throw ApiError.notFound("Invitation not found");
      const invitation = await tx.staffInvitation.findUniqueOrThrow({
        where: { id },
        include: { merchant: { select: { status: true } } },
      });
      if (invitation.status !== "pending") {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          `This invitation was ${invitation.status}`,
        );
      }
      if (invitation.expiresAt <= new Date()) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          "This invitation has expired",
        );
      }
      if (!(OPERATING as readonly string[]).includes(invitation.merchant.status)) {
        throw ApiError.notFound("Invitation not found");
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { email: true },
      });
      if (!user.email || user.email.toLowerCase() !== invitation.email) {
        throw ApiError.forbidden("Sign in with the email address the invitation was sent to");
      }

      const existing = await tx.membership.findUnique({
        where: { userId_merchantId: { userId: actor.userId, merchantId: invitation.merchantId } },
      });
      if (existing?.status === "active")
        throw conflict("You are already a member of this merchant");

      const fields = {
        role: invitation.role,
        status: "active" as const,
        catalogDelegated: invitation.catalogDelegated,
      };
      const membership = existing
        ? await tx.membership.update({ where: { id: existing.id }, data: fields })
        : await tx.membership.create({
            data: { ...fields, userId: actor.userId, merchantId: invitation.merchantId },
          });
      await tx.membershipBranch.deleteMany({ where: { membershipId: membership.id } });
      // Branches deleted or moved since the invitation are skipped by the merchant filter.
      const branches = await tx.branch.findMany({
        where: { id: { in: invitation.branchIds }, merchantId: invitation.merchantId },
        select: { id: true },
      });
      await tx.membershipBranch.createMany({
        data: branches.map((b) => ({
          membershipId: membership.id,
          branchId: b.id,
          merchantId: invitation.merchantId,
        })),
      });
      await tx.staffInvitation.update({
        where: { id },
        data: { status: "accepted", acceptedById: actor.userId },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "staff.invitation_accepted",
          targetType: "membership",
          targetId: membership.id,
          requestId,
          after: { invitationId: id, role: invitation.role, branchIds: branches.map((b) => b.id) },
        },
        tx,
      );
      return membership.id;
    });
    return { data: await this.loadMember(membershipId) };
  }

  @Patch("staff/:id")
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateStaffRequestSchema)) body: UpdateStaffRequest,
  ): Promise<{ data: StaffMember }> {
    const existing = await this.prisma.membership.findUnique({
      where: { id: params.id },
      select: { merchantId: true },
    });
    if (!existing) throw ApiError.notFound("Staff member not found");
    await within(
      this.access.requireOperatingOwner(actor.userId, existing.merchantId),
      "Staff member",
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM memberships WHERE id = ${params.id}::uuid FOR UPDATE`;
      const before = await tx.membership.findUniqueOrThrow({
        where: { id: params.id },
        include: memberInclude,
      });
      if (before.role === "owner") {
        throw ApiError.forbidden("Owners cannot be changed here");
      }
      const role = body.role ?? before.role;
      const branchIds = body.branchIds ?? before.branches.map((b) => b.branchId);
      // Leaving the manager role drops menu editing rather than failing.
      const catalogDelegated =
        role === "manager" ? (body.catalogDelegated ?? before.catalogDelegated) : false;
      if (body.catalogDelegated && role !== "manager") {
        throw ApiError.validation({
          catalogDelegated: ["Only managers can be given menu editing"],
        });
      }
      const status = body.status ?? before.status;
      if (status === "active") {
        const problems = await assignmentProblems(
          tx,
          before.merchantId,
          role,
          branchIds,
          catalogDelegated,
        );
        if (Object.keys(problems).length > 0) throw ApiError.validation(problems);
      }

      await tx.membership.update({
        where: { id: params.id },
        data: { role, status, catalogDelegated },
      });
      if (body.branchIds) {
        await tx.membershipBranch.deleteMany({ where: { membershipId: params.id } });
        await tx.membershipBranch.createMany({
          data: [...new Set(body.branchIds)].map((branchId) => ({
            membershipId: params.id,
            branchId,
            merchantId: before.merchantId,
          })),
        });
      }
      await this.audit.record(
        {
          actorId: actor.userId,
          action:
            status === "revoked" && before.status !== "revoked" ? "staff.revoked" : "staff.updated",
          targetType: "membership",
          targetId: params.id,
          requestId,
          reason: body.reason ?? null,
          before: {
            role: before.role,
            status: before.status,
            catalogDelegated: before.catalogDelegated,
            branchIds: before.branches.map((b) => b.branchId),
          },
          after: { role, status, catalogDelegated, branchIds },
        },
        tx,
      );
    });
    return { data: await this.loadMember(params.id) };
  }

  private async loadMember(id: string): Promise<StaffMember> {
    return toMemberView(
      await this.prisma.membership.findUniqueOrThrow({ where: { id }, include: memberInclude }),
    );
  }
}
