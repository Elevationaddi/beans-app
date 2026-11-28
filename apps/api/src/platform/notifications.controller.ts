import { Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { type NotificationView, pageQuerySchema } from "@beans/contracts";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import { idParams } from "../common/params.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Notification } from "../generated/prisma/client.js";

function toView(n: Notification): NotificationView {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title as NotificationView["title"],
    body: n.body as NotificationView["body"],
    data: (n.data ?? {}) as Record<string, unknown>,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Everyone's own in-app inbox (customers, staff, admins). Only the owner can read it. */
@Controller("me/notifications")
export class NotificationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: { cursor?: string; limit: number },
  ): Promise<{ data: NotificationView[]; meta: { nextCursor: string | null }; unread: number }> {
    const cursor = decodeCursor(query.cursor);
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          userId: actor.userId,
          ...(cursor && {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
      }),
      this.prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
    ]);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      data: items.map(toView),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
      unread,
    };
  }

  @Post(":id/read")
  @HttpCode(200)
  async read(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: NotificationView }> {
    await this.prisma.notification.updateMany({
      where: { id: params.id, userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id: params.id, userId: actor.userId },
    });
    if (!row) throw ApiError.notFound("Notification not found");
    return { data: toView(row) };
  }

  @Post("read-all")
  @HttpCode(200)
  async readAll(@CurrentActor() actor: Actor): Promise<{ data: { updated: number } }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { data: { updated: count } };
  }
}
