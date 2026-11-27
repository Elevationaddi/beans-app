import { Body, Controller, Get, Inject, Patch } from "@nestjs/common";
import {
  type Profile,
  type UpdateProfileRequest,
  updateProfileRequestSchema,
} from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";

@Controller("me")
export class MeController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
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
