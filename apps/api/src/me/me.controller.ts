import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Patch, Post } from "@nestjs/common";
import {
  type DeleteAccountRequest,
  deleteAccountRequestSchema,
  type Profile,
  type UpdateProfileRequest,
  updateProfileRequestSchema,
} from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { ACCOUNT_DELETED_TOPIC } from "../auth/supabase-admin.service.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import type { Actor } from "../common/request-context.js";
import { ApiError } from "../common/api-error.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OrderStatus } from "../generated/prisma/client.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { LIMITS, RateLimit } from "../security/rate-limit.js";

/** Orders still in progress; deletion waits until they finish or are cancelled. */
const OPEN_ORDER_STATUSES: OrderStatus[] = [
  "pending_payment",
  "received",
  "accepted",
  "preparing",
  "ready",
];

@Controller("me")
export class MeController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  @Get()
  async get(@CurrentActor() actor: Actor): Promise<{ data: Profile }> {
    return { data: await this.profile(actor) };
  }

  @Patch()
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(updateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<{ data: Profile }> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { displayName: true, locale: true },
      });
      const after = await tx.user.update({
        where: { id: actor.userId },
        data: {
          ...(body.displayName !== undefined && { displayName: body.displayName }),
          ...(body.locale !== undefined && { locale: body.locale }),
        },
        select: { displayName: true, locale: true },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "user.profile_updated",
          targetType: "user",
          targetId: actor.userId,
          requestId,
          before,
          after,
        },
        tx,
      );
    });
    return { data: await this.profile(actor) };
  }

  /**
   * Self-service account deletion (cycle 3). Personal details, saved cafés, vehicles and
   * notifications are removed; orders and financial records stay for retention but no longer
   * name the person. The Supabase sign-in is deleted through the outbox, so a failure there is
   * retried rather than lost. The auth guard refuses the account from the next request on.
   * Stamp cards, gifts and orders are not transferred or refunded by deletion.
   */
  @Post("deletion")
  @HttpCode(HttpStatus.OK)
  @RateLimit(LIMITS.privacy)
  async delete(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(deleteAccountRequestSchema)) _body: DeleteAccountRequest,
  ): Promise<{ data: { deleted: true } }> {
    await this.prisma.$transaction(async (tx) => {
      // Lock the row so two deletions (or a deletion and a checkout) cannot interleave.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: actor.userId },
        include: {
          adminRoles: { select: { id: true } },
          memberships: { where: { status: { in: ["active", "invited"] } }, select: { id: true } },
        },
      });
      if (user.adminRoles.length > 0 || user.memberships.length > 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "CONFLICT",
          "This account has business or admin access. Ask an owner or administrator to remove it first.",
        );
      }
      const open = await tx.order.count({
        where: { userId: actor.userId, status: { in: OPEN_ORDER_STATUSES } },
      });
      if (open > 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "CONFLICT",
          "You have an order in progress. You can delete your account once it is finished.",
        );
      }
      await tx.favorite.deleteMany({ where: { userId: actor.userId } });
      await tx.vehicle.deleteMany({ where: { userId: actor.userId } });
      await tx.notification.deleteMany({ where: { userId: actor.userId } });
      await tx.user.update({
        where: { id: actor.userId },
        data: {
          status: "deleted",
          displayName: null,
          email: null,
          phone: null,
          // The subject stays, so the auth guard keeps refusing this sign-in (403) until the
          // Supabase user is gone; a later sign-up gets a new subject and a fresh account.
        },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "user.account_deleted",
          targetType: "user",
          targetId: actor.userId,
          requestId,
        },
        tx,
      );
      await this.outbox.enqueue(tx, {
        topic: ACCOUNT_DELETED_TOPIC,
        aggregateId: actor.userId,
        dedupeKey: `account.deleted:${actor.userId}`,
        payload: { authSubject: user.authSubject },
      });
    });
    return { data: { deleted: true } };
  }

  private async profile(actor: Actor): Promise<Profile> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      include: {
        adminRoles: { select: { role: true }, orderBy: { role: "asc" } },
        memberships: {
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
          include: {
            merchant: { select: { brandName: true } },
            branches: { select: { branchId: true } },
          },
        },
      },
    });
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      locale: user.locale,
      memberships: user.memberships.map((m) => ({
        merchantId: m.merchantId,
        brandName: m.merchant.brandName,
        role: m.role,
        branchIds: m.role === "owner" ? [] : m.branches.map((b) => b.branchId),
      })),
      adminRoles: user.adminRoles.map((r) => r.role),
      mfaVerified: actor.aal === "aal2",
    };
  }
}
