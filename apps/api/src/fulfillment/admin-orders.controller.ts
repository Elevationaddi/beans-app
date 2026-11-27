import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  type AdminCancellationView,
  adminCancellationQuerySchema,
  type AdminCancelOrderRequest,
  adminCancelOrderRequestSchema,
  declineCancellationRequestSchema,
  type OrderStatus,
  uuidSchema,
} from "@beans/contracts";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { CancellationRequestStatus } from "../generated/prisma/client.js";
import { Idempotent } from "../idempotency/idempotent.interceptor.js";
import { FulfillmentService } from "./fulfillment.service.js";
import { toCancellationRequest, toOrderRefund } from "./order-views.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

const requestInclude = { order: { select: { publicNumber: true, branchId: true } } } as const;

/** Operations: cancel orders and review customer cancellation requests (D05, Q12). */
@Controller("admin")
export class AdminOrdersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
  ) {}

  @Post("orders/:id/cancel")
  @HttpCode(200)
  @RequireAdmin("operations")
  @Idempotent()
  async cancel(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(adminCancelOrderRequestSchema)) body: AdminCancelOrderRequest,
  ) {
    const { refundId } = await this.fulfillment.adminCancel(
      { userId: actor.userId, requestId },
      params.id,
      body.reason,
      body.expectedVersion,
    );
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: params.id } });
    const refund = refundId
      ? await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } })
      : null;
    return {
      data: {
        orderId: order.id,
        status: order.status as OrderStatus,
        version: order.version,
        refund: refund ? toOrderRefund(refund) : null,
      },
    };
  }

  @Get("cancellation-requests")
  @RequireAdmin("operations", "support")
  async list(
    @Query(new ZodValidationPipe(adminCancellationQuerySchema))
    query: {
      cursor?: string;
      limit: number;
      status?: CancellationRequestStatus;
    },
  ): Promise<{ data: AdminCancellationView[]; meta: { nextCursor: string | null } }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.cancellationRequest.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(cursor && {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        ...toCancellationRequest(row),
        publicNumber: row.order.publicNumber,
        branchId: row.order.branchId,
      })),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Post("cancellation-requests/:id/decline")
  @HttpCode(200)
  @RequireAdmin("operations")
  @Idempotent()
  async decline(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(declineCancellationRequestSchema)) body: { reason: string },
  ): Promise<{ data: AdminCancellationView }> {
    await this.fulfillment.declineCancellation(
      { userId: actor.userId, requestId },
      params.id,
      body.reason,
    );
    const row = await this.prisma.cancellationRequest.findUniqueOrThrow({
      where: { id: params.id },
      include: requestInclude,
    });
    return {
      data: {
        ...toCancellationRequest(row),
        publicNumber: row.order.publicNumber,
        branchId: row.order.branchId,
      },
    };
  }
}
