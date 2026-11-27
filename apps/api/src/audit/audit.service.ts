import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { redact } from "./redact.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

type Db = Pick<Prisma.TransactionClient, "auditEvent">;

/**
 * Writes append-only audit events (the table rejects UPDATE/DELETE). Pass the transaction
 * client so the audit row commits or rolls back with the change it describes.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditEvent.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        requestId: entry.requestId,
        reason: entry.reason ?? null,
        ...(entry.before && { beforeRedacted: redact(entry.before) as Prisma.InputJsonObject }),
        ...(entry.after && { afterRedacted: redact(entry.after) as Prisma.InputJsonObject }),
      },
    });
  }
}
