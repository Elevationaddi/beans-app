import { randomUUID } from "node:crypto";
import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import {
  type DevAccount,
  type DevSession,
  type DevSessionRequest,
  devSessionRequestSchema,
  type DevSignUpRequest,
  devSignUpRequestSchema,
} from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/api-error.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import { RateLimit, LIMITS } from "../security/rate-limit.js";
import { RequestId } from "./current-actor.decorator.js";
import { DevIssuer, FICTIONAL_SUBJECT } from "./dev-issuer.js";
import { Public } from "./public.decorator.js";

const fictional = { authSubject: { startsWith: "seed-" } };
const devMade = { authSubject: { startsWith: "dev-" } };

/**
 * Local development sign-in for fictional accounts (D12, 2026-11-28). Every route answers 404
 * unless DEV_AUTH_ENABLED is true, which the environment check refuses in production.
 */
@Public()
@Controller("dev-auth")
export class DevAuthController {
  constructor(
    @Inject(DevIssuer) private readonly issuer: DevIssuer,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private assertEnabled() {
    if (!this.issuer.enabled) throw ApiError.notFound();
  }

  @Get("accounts")
  async accounts(): Promise<{ data: DevAccount[] }> {
    this.assertEnabled();
    const users = await this.prisma.user.findMany({
      where: { OR: [fictional, devMade] },
      orderBy: [{ authSubject: "asc" }],
      take: 200,
      include: {
        adminRoles: { select: { role: true }, orderBy: { role: "asc" } },
        memberships: { where: { status: "active" }, select: { role: true } },
      },
    });
    return {
      data: users.map((user) => {
        const membershipRoles = [...new Set(user.memberships.map((m) => m.role))];
        const adminRoles = user.adminRoles.map((r) => r.role);
        const kind: DevAccount["kind"] =
          adminRoles.length > 0
            ? "admin"
            : membershipRoles.some((r) => r === "owner")
              ? "business"
              : membershipRoles.length > 0
                ? "staff"
                : "customer";
        return {
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          phone: user.phone,
          kind,
          membershipRoles,
          adminRoles,
          status: user.status,
        };
      }),
    };
  }

  @Post("sessions")
  @HttpCode(200)
  @RateLimit(LIMITS.devAuth)
  async session(
    @Body(new ZodValidationPipe(devSessionRequestSchema)) body: DevSessionRequest,
  ): Promise<{ data: DevSession }> {
    this.assertEnabled();
    const user = await this.prisma.user.findUnique({ where: { id: body.userId } });
    if (!user || !FICTIONAL_SUBJECT.test(user.authSubject)) throw ApiError.notFound();
    const aal = body.mfa ? "aal2" : "aal1";
    const { token, expiresAt } = await this.issuer.sign({
      sub: user.authSubject,
      aal,
      email: user.email,
      phone: user.phone,
    });
    return {
      data: { accessToken: token, expiresAt: expiresAt.toISOString(), aal, userId: user.id },
    };
  }

  /** Creates a fictional customer account, standing in for Supabase sign-up locally. */
  @Post("accounts")
  @RateLimit(LIMITS.devAuth)
  async signUp(
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(devSignUpRequestSchema)) body: DevSignUpRequest,
  ): Promise<{ data: DevSession }> {
    this.assertEnabled();
    const taken = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(body.email ? [{ email: body.email }] : []),
          ...(body.phone ? [{ phone: body.phone }] : []),
        ],
      },
      select: { id: true },
    });
    if (taken) {
      throw ApiError.validation({ email: ["an account with these details already exists"] });
    }
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          authSubject: `dev-${randomUUID()}`,
          displayName: body.displayName,
          email: body.email ?? null,
          phone: body.phone ?? null,
        },
      });
      await this.audit.record(
        {
          actorId: created.id,
          action: "user.dev_signed_up",
          targetType: "user",
          targetId: created.id,
          requestId,
        },
        tx,
      );
      return created;
    });
    const { token, expiresAt } = await this.issuer.sign({
      sub: user.authSubject,
      aal: "aal1",
      email: user.email,
      phone: user.phone,
    });
    return {
      data: {
        accessToken: token,
        expiresAt: expiresAt.toISOString(),
        aal: "aal1",
        userId: user.id,
      },
    };
  }
}
