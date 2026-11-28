import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  CreateTicketRequest,
  PrivacyRequest,
  TicketDetail,
  TicketView,
  UpdateTicketRequest,
} from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, Ticket, TicketMessage } from "../generated/prisma/client.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";

/** Merchant roles that handle support for their merchant. */
const MERCHANT_SUPPORT_ROLES = new Set(["owner", "manager"]);
/** What a barista may report from the tablet (docs/05 T06). */
const BARISTA_ISSUE_CATEGORIES = new Set(["order_issue", "other"]);

export function toTicket(row: Ticket, forSupport: boolean): TicketView {
  return {
    id: row.id,
    channel: row.channel,
    category: row.category,
    privacyKind: row.privacyKind,
    status: row.status,
    priority: row.priority,
    orderId: row.orderId,
    merchantId: row.merchantId,
    assigneeId: forSupport ? row.assigneeId : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTicketDetail(
  row: Ticket & { messages: TicketMessage[] },
  forSupport: boolean,
): TicketDetail {
  return {
    ...toTicket(row, forSupport),
    messages: row.messages
      .filter((m) => forSupport || m.visibility === "public")
      .map((m) => ({
        id: m.id,
        authorRole: m.authorRole,
        visibility: m.visibility,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
  };
}

const withMessages = {
  messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.TicketInclude;

/**
 * Support tickets (docs/04 A06). Who may see a ticket is decided here, from the database:
 * the customer who raised it; owners and managers of the merchant a merchant ticket belongs
 * to; support and operations admins. Anyone else gets 404. Messages are append-only and
 * internal notes never reach customers or merchants.
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(userId: string, body: CreateTicketRequest) {
    let merchantId: string | null = null;
    let barista = false;
    if (body.merchantId) {
      const member = await this.access.requireMember(userId, body.merchantId);
      // Baristas may report an issue (docs/05 T06) but do not handle the merchant's support.
      barista = member.role === "barista";
      if (barista && !BARISTA_ISSUE_CATEGORIES.has(body.category)) {
        throw ApiError.forbidden("Baristas can report order problems and other issues only");
      }
      if (!barista && !MERCHANT_SUPPORT_ROLES.has(member.role)) {
        throw ApiError.forbidden("Only the owner or a manager can handle support for the merchant");
      }
      merchantId = body.merchantId;
    }
    if (body.orderId) {
      // Customer: only their own order. Merchant: only an order of that merchant, and for a
      // barista only an order at a branch they are assigned to.
      const order = await this.prisma.order.findFirst({
        where: merchantId
          ? {
              id: body.orderId,
              merchantId,
              ...(barista ? { branch: this.access.branchScope(userId) } : {}),
            }
          : { id: body.orderId, userId },
        select: { id: true },
      });
      if (!order) throw ApiError.notFound("Order not found");
    }
    return this.prisma.ticket.create({
      data: {
        channel: merchantId ? "merchant" : "customer",
        requesterId: userId,
        merchantId,
        orderId: body.orderId ?? null,
        category: body.category,
        messages: {
          create: {
            authorId: userId,
            authorRole: merchantId ? "merchant" : "customer",
            body: body.message,
          },
        },
      },
      include: withMessages,
    });
  }

  /** Privacy request (Q24): a ticket for support; nothing is deleted automatically (D11). */
  async privacyRequest(userId: string, requestId: string, body: PrivacyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          channel: "customer",
          requesterId: userId,
          category: "privacy",
          privacyKind: body.kind,
          priority: "high",
          messages: {
            create: {
              authorId: userId,
              authorRole: "customer",
              body: body.message ?? `Privacy request: ${body.kind}`,
            },
          },
        },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: "privacy.requested",
          targetType: "ticket",
          targetId: ticket.id,
          requestId,
          after: { kind: body.kind },
        },
        tx,
      );
      return ticket;
    });
  }

  /** Tickets the caller raised, or (with merchantId) the merchant's tickets. */
  async listWhere(userId: string, merchantId?: string): Promise<Prisma.TicketWhereInput> {
    if (!merchantId) return { requesterId: userId, channel: "customer" };
    const member = await this.access.requireMember(userId, merchantId);
    // Baristas list only the issues they reported.
    if (member.role === "barista") return { merchantId, channel: "merchant", requesterId: userId };
    await this.requireMerchantSupport(userId, merchantId);
    return { merchantId, channel: "merchant" };
  }

  /** A ticket the caller may see as a customer or merchant member, else 404. */
  async requireVisible(userId: string, ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: withMessages,
    });
    if (!ticket) throw ApiError.notFound("Ticket not found");
    if (ticket.channel === "customer") {
      if (ticket.requesterId !== userId) throw ApiError.notFound("Ticket not found");
      return { ticket, role: "customer" as const };
    }
    // A barista sees the issues they reported; the owner and managers see all of the merchant's.
    if (ticket.requesterId === userId && ticket.merchantId) {
      await this.access.requireMember(userId, ticket.merchantId).catch(() => {
        throw ApiError.notFound("Ticket not found");
      });
      return { ticket, role: "merchant" as const };
    }
    try {
      await this.requireMerchantSupport(userId, ticket.merchantId ?? "");
    } catch {
      throw ApiError.notFound("Ticket not found");
    }
    return { ticket, role: "merchant" as const };
  }

  async reply(userId: string, ticketId: string, body: string, visibility: "public" | "internal") {
    const { ticket, role } = await this.requireVisible(userId, ticketId);
    if (visibility === "internal")
      throw ApiError.forbidden("Only support can write internal notes");
    if (ticket.status === "closed") throw closed();
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: { ticketId, authorId: userId, authorRole: role, body },
      }),
      // A reply from the requester side reopens a ticket waiting on them.
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status:
            ticket.status === "resolved" || ticket.status === "pending" ? "open" : ticket.status,
        },
      }),
    ]);
    return this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: withMessages });
  }

  // ── Support ──────────────────────────────────────────────────────────────

  async supportReply(
    actor: { userId: string; requestId: string },
    ticketId: string,
    body: string,
    visibility: "public" | "internal",
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw ApiError.notFound("Ticket not found");
    if (ticket.status === "closed") throw closed();
    await this.prisma.ticketMessage.create({
      data: { ticketId, authorId: actor.userId, authorRole: "support", visibility, body },
    });
    return this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: withMessages });
  }

  async update(
    actor: { userId: string; requestId: string },
    ticketId: string,
    body: UpdateTicketRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.ticket.findUnique({ where: { id: ticketId } });
      if (!before) throw ApiError.notFound("Ticket not found");
      if (body.assigneeId) {
        const staff = await tx.adminRole.count({
          where: { userId: body.assigneeId, role: { in: ["support", "operations"] } },
        });
        if (staff === 0) {
          throw ApiError.validation({ assigneeId: ["Must be a support or operations admin"] });
        }
      }
      const after = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          ...(body.status !== undefined && { status: body.status }),
          ...(body.priority !== undefined && { priority: body.priority }),
          ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
        },
        include: withMessages,
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: "ticket.updated",
          targetType: "ticket",
          targetId: ticketId,
          requestId: actor.requestId,
          before: {
            status: before.status,
            priority: before.priority,
            assigneeId: before.assigneeId,
          },
          after: { status: after.status, priority: after.priority, assigneeId: after.assigneeId },
        },
        tx,
      );
      return after;
    });
  }

  private async requireMerchantSupport(userId: string, merchantId: string) {
    const member = await this.access.requireMember(userId, merchantId);
    if (!MERCHANT_SUPPORT_ROLES.has(member.role)) {
      throw ApiError.forbidden("Only the owner or a manager can handle support for the merchant");
    }
    return member;
  }
}

const closed = () =>
  new ApiError(HttpStatus.CONFLICT, "CONFLICT", "This ticket is closed. Open a new one instead.");
