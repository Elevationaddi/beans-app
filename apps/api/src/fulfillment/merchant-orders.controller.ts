import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type MessageEvent,
  Param,
  Post,
  Query,
  Sse,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { z } from "zod";
import {
  ACTIVE_ORDER_STATUSES,
  type MerchantOrder,
  type MerchantOrderQuery,
  merchantOrderQuerySchema,
  type TransitionRequest,
  transitionRequestSchema,
  uuidSchema,
  type VersionedRequest,
  versionedRequestSchema,
} from "@beans/contracts";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import { Idempotent } from "../idempotency/idempotent.interceptor.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { FulfillmentService } from "./fulfillment.service.js";
import { liveStream } from "./live-stream.js";
import { merchantOrderInclude, toMerchantOrder } from "./order-views.js";
import { LIMITS, RateLimit } from "../security/rate-limit.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

/**
 * Branch order queue for the merchant portal and the branch tablet (docs/03 B06, docs/05).
 * Owners see every branch; managers and baristas only the branches they are assigned to.
 * Orders outside the caller's branches answer 404.
 */
@Controller("merchant")
export class MerchantOrdersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  @Get("orders")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(merchantOrderQuerySchema)) query: MerchantOrderQuery,
  ): Promise<{ data: MerchantOrder[]; meta: { nextCursor: string | null } }> {
    await this.fulfillment.requireBranchQueue(actor.userId, query.branchId);
    if (query.status === "pending_payment" || query.status === "payment_failed") {
      // Unpaid orders never reach staff (docs/08).
      throw ApiError.validation({ status: ["Staff only see paid orders"] });
    }
    const cursor = decodeCursor(query.cursor);
    // Live queue: oldest first, so the next order to make is on top. One status: newest first.
    const live = query.status === undefined;
    const rows = await this.prisma.order.findMany({
      where: {
        branchId: query.branchId,
        status: query.status ?? { in: [...ACTIVE_ORDER_STATUSES] },
        ...(cursor && {
          OR: live
            ? [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ]
            : [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
        }),
      },
      include: merchantOrderInclude,
      orderBy: live
        ? [{ createdAt: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toMerchantOrder),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Get("orders/:id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: MerchantOrder }> {
    await this.fulfillment.requireQueueAccess(actor.userId, params.id);
    return { data: await this.view(params.id) };
  }

  @Post("orders/:id/transition")
  @RateLimit(LIMITS.staffAction)
  @HttpCode(200)
  @Idempotent()
  async transition(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(transitionRequestSchema)) body: TransitionRequest,
  ): Promise<{ data: MerchantOrder }> {
    await this.fulfillment.transition({ userId: actor.userId, requestId }, params.id, body);
    return { data: await this.view(params.id) };
  }

  @Post("orders/:id/ack-arrival")
  @RateLimit(LIMITS.staffAction)
  @HttpCode(200)
  @Idempotent()
  async acknowledgeArrival(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(versionedRequestSchema)) body: VersionedRequest,
  ): Promise<{ data: MerchantOrder }> {
    await this.fulfillment.acknowledgeArrival(
      { userId: actor.userId, requestId },
      params.id,
      body.expectedVersion,
    );
    return { data: await this.view(params.id) };
  }

  @Sse("branches/:id/order-events")
  async branchEvents(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<Observable<MessageEvent>> {
    await this.fulfillment.requireBranchQueue(actor.userId, params.id);
    await this.realtime.ensureSubscribed();
    return liveStream(
      this.realtime.stream((signal) => signal.branchId === params.id),
      () => this.fulfillment.requireBranchQueue(actor.userId, params.id),
    );
  }

  private async view(orderId: string): Promise<MerchantOrder> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: merchantOrderInclude,
    });
    if (!row) throw ApiError.notFound("Order not found");
    return toMerchantOrder(row);
  }
}
