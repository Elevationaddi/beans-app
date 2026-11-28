import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  type CreateTicketMessageRequest,
  createTicketMessageRequestSchema,
  type CreateTicketRequest,
  createTicketRequestSchema,
  type PrivacyRequest,
  privacyRequestSchema,
  type TicketDetail,
  ticketQuerySchema,
  type TicketView,
  type UpdateTicketRequest,
  updateTicketRequestSchema,
  uuidSchema,
} from "@beans/contracts";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, TicketCategory, TicketStatus } from "../generated/prisma/client.js";
import { TicketsService, toTicket, toTicketDetail } from "./tickets.service.js";
import { LIMITS, RateLimit } from "../security/rate-limit.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));
type TicketQuery = {
  cursor?: string;
  limit: number;
  status?: TicketStatus;
  merchantId?: string;
  category?: TicketCategory;
};

async function page(
  prisma: PrismaService,
  where: Prisma.TicketWhereInput,
  query: TicketQuery,
  forSupport: boolean,
): Promise<{ data: TicketView[]; meta: { nextCursor: string | null } }> {
  const cursor = decodeCursor(query.cursor);
  const rows = await prisma.ticket.findMany({
    where: {
      ...where,
      ...(query.status && { status: query.status }),
      ...(query.category && { category: query.category }),
      ...(cursor && {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    data: items.map((t) => toTicket(t, forSupport)),
    meta: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null },
  };
}

/** Customers and merchant members: their own tickets. */
@Controller("tickets")
export class TicketsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
  ) {}

  @Post()
  @RateLimit(LIMITS.ticket)
  async create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createTicketRequestSchema)) body: CreateTicketRequest,
  ): Promise<{ data: TicketDetail }> {
    return { data: toTicketDetail(await this.tickets.create(actor.userId, body), false) };
  }

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(ticketQuerySchema)) query: TicketQuery,
  ) {
    return page(
      this.prisma,
      await this.tickets.listWhere(actor.userId, query.merchantId),
      query,
      false,
    );
  }

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: TicketDetail }> {
    const { ticket } = await this.tickets.requireVisible(actor.userId, params.id);
    return { data: toTicketDetail(ticket, false) };
  }

  @Post(":id/messages")
  @RateLimit(LIMITS.ticket)
  async reply(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(createTicketMessageRequestSchema)) body: CreateTicketMessageRequest,
  ): Promise<{ data: TicketDetail }> {
    const ticket = await this.tickets.reply(actor.userId, params.id, body.body, body.visibility);
    return { data: toTicketDetail(ticket, false) };
  }
}

/** Privacy requests (docs/07 POST /me/privacy-requests). */
@Controller("me/privacy-requests")
export class PrivacyRequestsController {
  constructor(@Inject(TicketsService) private readonly tickets: TicketsService) {}

  @Post()
  @RateLimit(LIMITS.privacy)
  async create(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(privacyRequestSchema)) body: PrivacyRequest,
  ): Promise<{ data: { ticketId: string; kind: PrivacyRequest["kind"]; status: TicketStatus } }> {
    const ticket = await this.tickets.privacyRequest(actor.userId, requestId, body);
    return { data: { ticketId: ticket.id, kind: body.kind, status: ticket.status } };
  }
}

/** Support queue (docs/04 A06): every ticket, with internal notes. */
@Controller("admin/tickets")
export class AdminTicketsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
  ) {}

  @Get()
  @RequireAdmin("support", "operations")
  list(@Query(new ZodValidationPipe(ticketQuerySchema)) query: TicketQuery) {
    return page(this.prisma, query.merchantId ? { merchantId: query.merchantId } : {}, query, true);
  }

  @Get(":id")
  @RequireAdmin("support", "operations")
  async get(@Param(idParams) params: { id: string }): Promise<{ data: TicketDetail }> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: params.id },
      include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!ticket) throw ApiError.notFound("Ticket not found");
    return { data: toTicketDetail(ticket, true) };
  }

  @Post(":id/messages")
  @RequireAdmin("support", "operations")
  async reply(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(createTicketMessageRequestSchema)) body: CreateTicketMessageRequest,
  ): Promise<{ data: TicketDetail }> {
    const ticket = await this.tickets.supportReply(
      { userId: actor.userId, requestId },
      params.id,
      body.body,
      body.visibility,
    );
    return { data: toTicketDetail(ticket, true) };
  }

  @Patch(":id")
  @RequireAdmin("support", "operations")
  async update(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateTicketRequestSchema)) body: UpdateTicketRequest,
  ): Promise<{ data: TicketDetail }> {
    const ticket = await this.tickets.update({ userId: actor.userId, requestId }, params.id, body);
    return { data: toTicketDetail(ticket, true) };
  }
}
