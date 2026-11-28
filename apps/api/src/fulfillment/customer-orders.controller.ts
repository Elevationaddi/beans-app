import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  type MessageEvent,
  Param,
  Post,
  Sse,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { z } from "zod";
import {
  type Arrival,
  type CancelRequest,
  cancelRequestSchema,
  type CancelResult,
  type Fulfillment,
  type Receipt,
  type Totals,
  uuidSchema,
  type VersionedRequest,
  versionedRequestSchema,
} from "@beans/contracts";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import { Idempotent } from "../idempotency/idempotent.interceptor.js";
import { branchNames } from "../ordering/cart.service.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { FulfillmentService } from "./fulfillment.service.js";
import { liveStream } from "./live-stream.js";
import { type LineSnapshot, toCancellationRequest, toOrderRefund } from "./order-views.js";
import { LIMITS, RateLimit } from "../security/rate-limit.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

/** Customer side of fulfilment: curbside check-in, cancellation, receipt, live updates. */
@Controller("orders")
export class CustomerOrdersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  @Post(":id/arrival")
  @RateLimit(LIMITS.arrival)
  @HttpCode(200)
  @Idempotent()
  async arrive(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(versionedRequestSchema)) body: VersionedRequest,
  ): Promise<{ data: Arrival & { orderId: string; version: number } }> {
    await this.fulfillment.arrive(actor.userId, params.id, body.expectedVersion);
    const row = await this.prisma.order.findUniqueOrThrow({ where: { id: params.id } });
    return {
      data: {
        orderId: row.id,
        version: row.version,
        arrivedAt: row.arrivedAt?.toISOString() ?? null,
        acknowledgedAt: row.arrivalAckAt?.toISOString() ?? null,
      },
    };
  }

  @Post(":id/cancel-requests")
  @RateLimit(LIMITS.cancelRequest)
  @Idempotent()
  async requestCancellation(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(cancelRequestSchema)) body: CancelRequest,
  ): Promise<{ data: CancelResult }> {
    const result = await this.fulfillment.requestCancellation(actor.userId, params.id, body.reason);
    const [order, request, refund] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id: params.id } }),
      this.prisma.cancellationRequest.findUniqueOrThrow({ where: { id: result.requestId } }),
      result.refundId
        ? this.prisma.refund.findUniqueOrThrow({ where: { id: result.refundId } })
        : null,
    ]);
    return {
      data: {
        outcome: result.outcome,
        orderStatus: order.status,
        version: order.version,
        request: toCancellationRequest(request),
        refund: refund ? toOrderRefund(refund) : null,
      },
    };
  }

  /** Built only from immutable snapshots; available once the payment was captured. */
  @Get(":id/receipt")
  async receipt(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: Receipt }> {
    const row = await this.prisma.order.findFirst({
      where: { id: params.id, userId: actor.userId },
      include: {
        branch: {
          select: {
            nameEn: true,
            nameAr: true,
            address: true,
            merchant: { select: { brandName: true } },
          },
        },
        items: { orderBy: { lineNo: "asc" } },
        payments: { where: { status: "captured" } },
        refunds: { orderBy: { createdAt: "asc" } },
        events: { where: { toState: "received" }, take: 1 },
      },
    });
    if (!row) throw ApiError.notFound("Order not found");
    const paid = row.payments[0];
    const issued = row.events[0];
    if (!paid || !issued) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "PAYMENT_PENDING",
        "A receipt is available once the payment is confirmed",
      );
    }
    const fulfillment = row.fulfillmentSnapshot as unknown as Fulfillment;
    const refunded = row.refunds
      .filter((r) => r.status === "succeeded")
      .reduce((sum, r) => sum + r.amountFils, 0n);
    return {
      data: {
        orderId: row.id,
        publicNumber: row.publicNumber,
        status: row.status,
        issuedAt: issued.createdAt.toISOString(),
        brandName: row.branch.merchant.brandName,
        branchNames: branchNames(row.branch),
        branchAddress: row.branch.address,
        mode: row.mode,
        pickupAt: fulfillment.pickupAt,
        items: row.items.map((item) => {
          const snap = item.snapshot as unknown as LineSnapshot;
          return {
            productId: item.productId,
            names: snap.names,
            quantity: item.quantity,
            options: snap.options,
            notes: snap.notes,
            unitFils: snap.unitFils,
            totalFils: item.totalFils.toString(),
          };
        }),
        totals: row.totals as unknown as Totals,
        policyVersion: row.policyVersion,
        paidFils: paid.amountFils.toString(),
        refundedFils: refunded.toString(),
        refunds: row.refunds.map(toOrderRefund),
        sandbox: true,
        taxInvoice: false,
      },
    };
  }

  @Get(":id/live")
  async live(@CurrentActor() actor: Actor, @Param(idParams) params: { id: string }) {
    const order = await this.prisma.order.findFirst({
      where: { id: params.id, userId: actor.userId },
      select: { id: true },
    });
    if (!order) throw ApiError.notFound("Order not found");
    return { data: this.realtime.subscription("order", params.id) };
  }

  @Sse(":id/events")
  async events(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<Observable<MessageEvent>> {
    const own = () =>
      this.prisma.order
        .findFirst({ where: { id: params.id, userId: actor.userId }, select: { id: true } })
        .then((order) => {
          if (!order) throw ApiError.notFound("Order not found");
        });
    await own();
    return liveStream(
      this.realtime.stream((signal) => signal.orderId === params.id),
      own,
    );
  }
}
