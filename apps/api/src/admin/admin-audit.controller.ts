import { Controller, Get, Inject, Query } from "@nestjs/common";
import { type AuditEventView, type AuditQuery, auditQuerySchema } from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

@Controller("admin/audit")
export class AdminAuditController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Newest first. Every read is itself audited (privileged read, docs/10-security.md). */
  @Get()
  @RequireAdmin("security")
  async list(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ): Promise<{ data: AuditEventView[]; meta: { nextCursor: string | null } }> {
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.AuditEventWhereInput = {
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.targetId && { targetId: query.targetId }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lt: new Date(query.to) }),
        },
      }),
      ...(cursor && {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }),
    };
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    await this.audit.record({
      actorId: actor.userId,
      action: "audit.viewed",
      targetType: "audit_log",
      targetId: "*",
      requestId,
      after: { filters: { ...query, cursor: undefined }, returned: page.length },
    });

    return {
      data: page.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        before: asRecord(row.beforeRedacted),
        after: asRecord(row.afterRedacted),
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }
}
