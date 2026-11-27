import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";
import {
  type Fulfillment,
  type LocalizedText,
  type OrderDetail,
  orderListQuerySchema,
  type OrderStatus,
  type OrderSummary,
  type Totals,
  uuidSchema,
} from "@beans/contracts";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { branchNames } from "./cart.service.js";
import { PickupCodes } from "./pickup-code.js";

/** The handoff code is shown only while the order can still be handed over. */
const CODE_VISIBLE = new Set<OrderStatus>(["received", "accepted", "preparing", "ready"]);

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

const summaryInclude = {
  branch: { select: { nameEn: true, nameAr: true, merchant: { select: { brandName: true } } } },
} satisfies Prisma.OrderInclude;

type SummaryRow = Prisma.OrderGetPayload<{ include: typeof summaryInclude }>;

function toSummary(row: SummaryRow): OrderSummary {
  const totals = row.totals as unknown as Totals;
  const fulfillment = row.fulfillmentSnapshot as unknown as Fulfillment;
  return {
    id: row.id,
    publicNumber: row.publicNumber,
    branchId: row.branchId,
    branchNames: branchNames(row.branch),
    brandName: row.branch.merchant.brandName,
    status: row.status,
    mode: row.mode,
    pickupAt: fulfillment.pickupAt,
    totalFils: totals.totalFils,
    currency: "AED",
    createdAt: row.createdAt.toISOString(),
  };
}

/** The customer's own orders. Someone else's order answers 404, like a missing one. */
@Controller("orders")
export class OrdersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PickupCodes) private readonly pickupCodes: PickupCodes,
  ) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(orderListQuerySchema))
    query: { cursor?: string; limit: number; status?: OrderStatus },
  ): Promise<{ data: OrderSummary[]; meta: { nextCursor: string | null } }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.order.findMany({
      where: {
        userId: actor.userId,
        ...(query.status && { status: query.status }),
        ...(cursor && {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      include: summaryInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toSummary),
      meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
    };
  }

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: OrderDetail }> {
    const row = await this.prisma.order.findFirst({
      where: { id: params.id, userId: actor.userId },
      include: {
        ...summaryInclude,
        items: { orderBy: { lineNo: "asc" } },
        events: { orderBy: { seq: "asc" } },
        payments: { orderBy: { attempt: "desc" }, take: 1 },
        reservation: { select: { state: true, expiresAt: true } },
        refunds: { orderBy: { createdAt: "asc" } },
        cancellationRequests: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!row) throw ApiError.notFound("Order not found");
    const payment = row.payments[0];
    const request = row.cancellationRequests[0];
    const holdValid = row.reservation.state === "held" && row.reservation.expiresAt > new Date();
    return {
      data: {
        ...toSummary(row),
        version: row.version,
        items: row.items.map((item) => {
          const snap = item.snapshot as unknown as {
            names: LocalizedText;
            options: OrderDetail["items"][number]["options"];
            notes: string | null;
            unitFils: string;
          };
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
        fulfillment: row.fulfillmentSnapshot as unknown as Fulfillment,
        policyVersion: row.policyVersion,
        payment: payment
          ? {
              attempt: payment.attempt,
              status: payment.status,
              retryable:
                row.status === "pending_payment" && payment.status === "failed" && holdValid,
            }
          : null,
        timeline: row.events.map((e) => ({
          seq: e.seq,
          fromState: e.fromState as OrderStatus | null,
          toState: e.toState as OrderStatus,
          at: e.createdAt.toISOString(),
        })),
        etaAt: row.etaAt?.toISOString() ?? null,
        pickupCode:
          CODE_VISIBLE.has(row.status) && row.pickupCodeHash
            ? this.pickupCodes.codeFor(row.id)
            : null,
        arrival: {
          arrivedAt: row.arrivedAt?.toISOString() ?? null,
          acknowledgedAt: row.arrivalAckAt?.toISOString() ?? null,
        },
        refunds: row.refunds.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          amountFils: r.amountFils.toString(),
          currency: "AED" as const,
          createdAt: r.createdAt.toISOString(),
        })),
        cancellationRequest: request
          ? {
              id: request.id,
              orderId: request.orderId,
              status: request.status,
              orderStatus: request.orderStatus,
              reason: request.reason,
              resolutionReason: request.resolutionReason,
              createdAt: request.createdAt.toISOString(),
            }
          : null,
      },
    };
  }
}
