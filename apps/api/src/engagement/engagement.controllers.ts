import { createHash, randomBytes } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  type AdminPromotionQuery,
  adminPromotionQuerySchema,
  adminGiftQuerySchema,
  type BranchTable,
  branchTableActionRequestSchema,
  branchTableParamsSchema,
  claimGiftRequestSchema,
  createBranchTableRequestSchema,
  type CreateBranchTableRequest,
  createGiftRequestSchema,
  type CreateGiftRequest,
  createPromotionRequestSchema,
  type CreatePromotionRequest,
  type Gift,
  type LocalizedText,
  merchantPromotionQuerySchema,
  type MerchantPromotionQuery,
  type Promotion,
  promotionActionRequestSchema,
  type PromotionActionRequest,
  putStampCardRequestSchema,
  type PutStampCardRequest,
  resolveTableQuerySchema,
  reviewPromotionRequestSchema,
  type ReviewPromotionRequest,
  type StampBalance,
  type StampCard,
  stampCardQuerySchema,
  stampEventsQuerySchema,
  updatePromotionRequestSchema,
  type UpdatePromotionRequest,
} from "@beans/contracts";
import { AuditService } from "../audit/audit.service.js";
import { RequireAdmin } from "../auth/admin.guard.js";
import { CurrentActor, RequestId } from "../auth/current-actor.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { idParams } from "../common/params.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  BranchTable as TableRow,
  Gift as GiftRow,
  Prisma,
  Promotion as PromotionRow,
  PromotionStatus,
  StampCard as StampCardRow,
} from "../generated/prisma/client.js";
import { Idempotent } from "../idempotency/idempotent.interceptor.js";
import { featureDisabled, semantic } from "../ordering/ordering-errors.js";
import { SettingsService } from "../platform/settings.service.js";
import { MerchantAccessService } from "../tenancy/merchant-access.service.js";
import { BenefitsService } from "./benefits.service.js";
import { TableTokens } from "./table-tokens.js";

/** SANDBOX: how long a gift can be claimed and used. Not approved (D08 is open). */
export const GIFT_VALID_DAYS = 30;

const text = (en: string, ar: string | null): LocalizedText => ({ en, ...(ar && { ar }) });
const conflict = (message: string) => new ApiError(HttpStatus.CONFLICT, "CONFLICT", message);
const staleVersion = (current: number) =>
  new ApiError(
    HttpStatus.CONFLICT,
    "CONFLICT",
    `This was changed by someone else (now version ${current}). Reload and try again.`,
  );
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

type Cursor = ReturnType<typeof decodeCursor>;
const before = (cursor: Cursor) =>
  cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }
    : {};
function page<T extends { id: string; createdAt: Date }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

export function toStampCard(row: StampCardRow): StampCard {
  return {
    id: row.id,
    merchantId: row.merchantId,
    names: text(row.nameEn, row.nameAr),
    stampsRequired: row.stampsRequired,
    reward: text(row.rewardEn, row.rewardAr),
    rewardMaxFils: row.rewardMaxFils.toString(),
    active: row.active,
    termsVersion: row.termsVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPromotion(row: PromotionRow & { merchant: { brandName: string } }): Promotion {
  return {
    id: row.id,
    merchantId: row.merchantId,
    brandName: row.merchant.brandName,
    code: row.code,
    names: text(row.nameEn, row.nameAr),
    kind: row.kind,
    percentBasisPoints: row.percentBasisPoints,
    amountFils: row.amountFils?.toString() ?? null,
    minSubtotalFils: row.minSubtotalFils.toString(),
    maxDiscountFils: row.maxDiscountFils?.toString() ?? null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    maxRedemptions: row.maxRedemptions,
    perCustomerLimit: row.perCustomerLimit,
    redemptions: row.redemptions,
    status: row.status,
    reviewNote: row.reviewNote,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

type GiftWithNames = GiftRow & {
  merchant: { brandName: string };
  product: { names: Prisma.JsonValue };
};

/** Issued or claimed gifts past their date read as expired (no job needed). */
function giftStatus(row: GiftRow, now = new Date()): Gift["status"] {
  if ((row.status === "issued" || row.status === "claimed") && row.expiresAt <= now)
    return "expired";
  return row.status;
}

function giftView(row: GiftWithNames, role: Gift["role"]): Gift {
  return {
    id: row.id,
    merchantId: row.merchantId,
    brandName: row.merchant.brandName,
    productId: row.productId,
    productNames: row.product.names as unknown as LocalizedText,
    valueFils: row.valueFils.toString(),
    message: row.message,
    status: giftStatus(row),
    role,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    sandbox: true,
  };
}

const giftInclude = {
  merchant: { select: { brandName: true } },
  product: { select: { names: true } },
} as const;

function promotionProblems(body: CreatePromotionRequest | UpdatePromotionRequest) {
  const errors: Record<string, string[]> = {};
  if (body.kind === "percent" && (body.percentBasisPoints === null || body.amountFils !== null)) {
    errors["percentBasisPoints"] = ["Give a percentage (and no amount) for a percent code"];
  }
  if (body.kind === "amount" && (body.amountFils === null || body.percentBasisPoints !== null)) {
    errors["amountFils"] = ["Give an amount (and no percentage) for an amount code"];
  }
  if (body.amountFils !== null && BigInt(body.amountFils) <= 0n) {
    errors["amountFils"] = ["Must be more than zero"];
  }
  if (body.maxDiscountFils !== null && BigInt(body.maxDiscountFils) <= 0n) {
    errors["maxDiscountFils"] = ["Must be more than zero"];
  }
  if (new Date(body.endsAt) <= new Date(body.startsAt)) {
    errors["endsAt"] = ["Must be after the start"];
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);
}

function promotionData(body: CreatePromotionRequest | UpdatePromotionRequest) {
  return {
    code: body.code,
    nameEn: body.names.en,
    nameAr: body.names.ar ?? null,
    kind: body.kind,
    percentBasisPoints: body.percentBasisPoints,
    amountFils: body.amountFils === null ? null : BigInt(body.amountFils),
    minSubtotalFils: BigInt(body.minSubtotalFils),
    maxDiscountFils: body.maxDiscountFils === null ? null : BigInt(body.maxDiscountFils),
    startsAt: new Date(body.startsAt),
    endsAt: new Date(body.endsAt),
    maxRedemptions: body.maxRedemptions,
    perCustomerLimit: body.perCustomerLimit,
  };
}

/** Merchant promotion steps: from these statuses, to that status. */
const PROMOTION_ACTIONS: Record<
  PromotionActionRequest["action"],
  { from: readonly PromotionStatus[]; to: PromotionStatus }
> = {
  submit: { from: ["draft", "rejected"], to: "pending_review" },
  pause: { from: ["approved"], to: "paused" },
  resume: { from: ["paused"], to: "approved" },
  end: { from: ["draft", "pending_review", "approved", "paused", "rejected"], to: "ended" },
};

// ── Public and customer ──────────────────────────────────────────────────────

@Controller()
export class EngagementController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(BenefitsService) private readonly benefits: BenefitsService,
  ) {}

  @Public()
  @Get("branches/:id/stamp-card")
  async branchStampCard(
    @Param(idParams) params: { id: string },
  ): Promise<{ data: StampCard | null }> {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: params.id,
        status: { in: ["active", "paused"] },
        merchant: { status: "approved" },
      },
      select: { merchantId: true },
    });
    if (!branch) throw ApiError.notFound("Branch not found");
    if (!(await this.settings.get("features")).stampCards) return { data: null };
    const card = await this.prisma.stampCard.findFirst({
      where: { merchantId: branch.merchantId, active: true },
    });
    return { data: card ? toStampCard(card) : null };
  }

  /** Scanned table QR code: which café and table. Rotated, retired or forged codes are 404. */
  @Public()
  @Get("tables/resolve")
  async resolveTable(
    @Query(new ZodValidationPipe(resolveTableQuerySchema)) query: { token: string },
  ) {
    if (!(await this.settings.get("features")).dineIn) throw featureDisabled("token", "Dine-in");
    const table = await this.benefits.verifiedTable(query.token);
    if (!table) throw ApiError.notFound("This table code is not valid");
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: table.branchId,
        status: { in: ["active", "paused"] },
        merchant: { status: "approved" },
      },
      select: { id: true, nameEn: true, nameAr: true, merchant: { select: { brandName: true } } },
    });
    if (!branch) throw ApiError.notFound("This table code is not valid");
    return {
      data: {
        branchId: branch.id,
        brandName: branch.merchant.brandName,
        branchNames: text(branch.nameEn, branch.nameAr),
        table: { id: table.id, label: table.label },
      },
    };
  }

  @Get("me/stamps")
  async myStamps(@CurrentActor() actor: Actor): Promise<{ data: StampBalance[] }> {
    if (!(await this.settings.get("features")).stampCards)
      throw featureDisabled("stamps", "Stamp cards");
    const accounts = await this.prisma.stampAccount.findMany({
      where: { userId: actor.userId },
      include: { merchant: { select: { brandName: true, stampCard: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return {
      data: accounts.map((a) => {
        const card = a.merchant.stampCard?.active ? a.merchant.stampCard : null;
        return {
          merchantId: a.merchantId,
          brandName: a.merchant.brandName,
          balance: a.balance,
          card: card ? toStampCard(card) : null,
          rewardAvailable: card !== null && a.balance >= card.stampsRequired,
        };
      }),
    };
  }

  @Get("me/stamps/events")
  async myStampEvents(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(stampEventsQuerySchema)) query: { merchantId: string },
  ) {
    if (!(await this.settings.get("features")).stampCards)
      throw featureDisabled("stamps", "Stamp cards");
    const events = await this.prisma.stampEvent.findMany({
      where: { userId: actor.userId, merchantId: query.merchantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return {
      data: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        stamps: e.stamps,
        orderId: e.orderId,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  @Get("gifts")
  async listGifts(@CurrentActor() actor: Actor): Promise<{ data: Gift[] }> {
    if (!(await this.benefits.giftsEnabled())) throw featureDisabled("gifts", "Gifts");
    const rows = await this.prisma.gift.findMany({
      where: { OR: [{ purchaserId: actor.userId }, { recipientId: actor.userId }] },
      include: giftInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return {
      data: rows.map((g) => giftView(g, g.purchaserId === actor.userId ? "sent" : "received")),
    };
  }

  /**
   * Sandbox gift of one drink at its current base price. No payment is taken and nothing is
   * posted to the journal: it is a test entitlement, not a sale (CLAUDE.md: no gift sales until
   * approved). The claim token is returned once and stored only as a hash.
   */
  @Post("gifts")
  @Idempotent()
  async createGift(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createGiftRequestSchema)) body: CreateGiftRequest,
  ): Promise<{ data: { gift: Gift; claimToken: string } }> {
    if (!(await this.benefits.giftsEnabled())) throw featureDisabled("productId", "Gifts");
    const product = await this.prisma.product.findFirst({
      where: {
        id: body.productId,
        status: "published",
        moderationHiddenAt: null,
        merchant: { status: "approved" },
      },
    });
    if (!product) throw ApiError.notFound("Drink not found");
    const claimToken = randomBytes(24).toString("base64url");
    const gift = await this.prisma.gift.create({
      data: {
        merchantId: product.merchantId,
        productId: product.id,
        purchaserId: actor.userId,
        valueFils: product.baseFils,
        message: body.message ?? null,
        claimTokenHash: sha256(claimToken),
        expiresAt: new Date(Date.now() + GIFT_VALID_DAYS * 86_400_000),
      },
      include: giftInclude,
    });
    return { data: { gift: giftView(gift, "sent"), claimToken } };
  }

  /** One claimant only: a conditional update wins exactly once under concurrent claims (Q20). */
  @Post("gifts/claim")
  @HttpCode(200)
  @Idempotent()
  async claimGift(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(claimGiftRequestSchema)) body: { token: string },
  ): Promise<{ data: Gift }> {
    if (!(await this.benefits.giftsEnabled())) throw featureDisabled("token", "Gifts");
    const gift = await this.prisma.gift.findUnique({
      where: { claimTokenHash: sha256(body.token) },
    });
    if (!gift) throw ApiError.notFound("Gift not found");
    if (gift.recipientId === actor.userId) {
      const mine = await this.prisma.gift.findUniqueOrThrow({
        where: { id: gift.id },
        include: giftInclude,
      });
      return { data: giftView(mine, "received") };
    }
    if (gift.purchaserId === actor.userId) {
      throw semantic("Share this gift with someone else to claim it", { token: ["Your own gift"] });
    }
    if (gift.expiresAt <= new Date())
      throw semantic("This gift has expired", { token: ["Expired"] });
    const won = await this.prisma.gift.updateMany({
      where: { id: gift.id, status: "issued", recipientId: null, expiresAt: { gt: new Date() } },
      data: { status: "claimed", recipientId: actor.userId, claimedAt: new Date() },
    });
    if (won.count !== 1) throw conflict("This gift has already been claimed");
    const claimed = await this.prisma.gift.findUniqueOrThrow({
      where: { id: gift.id },
      include: giftInclude,
    });
    return { data: giftView(claimed, "received") };
  }
}

// ── Merchant ─────────────────────────────────────────────────────────────────

@Controller("merchant")
export class MerchantEngagementController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantAccessService) private readonly access: MerchantAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TableTokens) private readonly tokens: TableTokens,
  ) {}

  @Get("stamp-card")
  async getStampCard(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(stampCardQuerySchema)) query: { merchantId: string },
  ): Promise<{ data: StampCard | null }> {
    await this.access.requireMember(actor.userId, query.merchantId);
    const card = await this.prisma.stampCard.findUnique({
      where: { merchantId: query.merchantId },
    });
    return { data: card ? toStampCard(card) : null };
  }

  @Put("stamp-card")
  @Idempotent()
  async putStampCard(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Query(new ZodValidationPipe(stampCardQuerySchema)) query: { merchantId: string },
    @Body(new ZodValidationPipe(putStampCardRequestSchema)) body: PutStampCardRequest,
  ): Promise<{ data: StampCard }> {
    await this.access.requireOperatingOwner(actor.userId, query.merchantId);
    if (BigInt(body.rewardMaxFils) <= 0n) {
      throw ApiError.validation({ rewardMaxFils: ["Must be more than zero"] });
    }
    const data = {
      nameEn: body.names.en,
      nameAr: body.names.ar ?? null,
      stampsRequired: body.stampsRequired,
      rewardEn: body.reward.en,
      rewardAr: body.reward.ar ?? null,
      rewardMaxFils: BigInt(body.rewardMaxFils),
      active: body.active,
    };
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.stampCard.findUnique({ where: { merchantId: query.merchantId } });
      const saved = before
        ? await tx.stampCard.update({
            where: { id: before.id },
            data: { ...data, termsVersion: { increment: 1 } },
          })
        : await tx.stampCard.create({ data: { ...data, merchantId: query.merchantId } });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: before ? "stamp_card.updated" : "stamp_card.created",
          targetType: "stamp_card",
          targetId: saved.id,
          requestId,
          ...(before && { before: toStampCard(before) as unknown as Record<string, unknown> }),
          after: toStampCard(saved) as unknown as Record<string, unknown>,
        },
        tx,
      );
      return { data: toStampCard(saved) };
    });
  }

  @Get("promotions")
  async listPromotions(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(merchantPromotionQuerySchema)) query: MerchantPromotionQuery,
  ) {
    await this.access.requireCatalogReader(actor.userId, query.merchantId);
    const rows = await this.prisma.promotion.findMany({
      where: { merchantId: query.merchantId, ...before(decodeCursor(query.cursor)) },
      include: { merchant: { select: { brandName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toPromotion), meta: { nextCursor } };
  }

  @Post("promotions")
  @Idempotent()
  async createPromotion(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Body(new ZodValidationPipe(createPromotionRequestSchema)) body: CreatePromotionRequest,
  ): Promise<{ data: Promotion }> {
    await this.access.requireOperatingOwner(actor.userId, body.merchantId);
    promotionProblems(body);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.promotion.create({
          data: { ...promotionData(body), merchantId: body.merchantId },
          include: { merchant: { select: { brandName: true } } },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "promotion.created",
            targetType: "promotion",
            targetId: row.id,
            requestId,
            after: toPromotion(row) as unknown as Record<string, unknown>,
          },
          tx,
        );
        return { data: toPromotion(row) };
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw conflict("This business already has a promotion with that code");
      throw error;
    }
  }

  @Put("promotions/:id")
  @Idempotent()
  async updatePromotion(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updatePromotionRequestSchema)) body: UpdatePromotionRequest,
  ): Promise<{ data: Promotion }> {
    const current = await this.ownedPromotion(actor.userId, params.id);
    if (current.version !== body.expectedVersion) throw staleVersion(current.version);
    if (current.status !== "draft" && current.status !== "rejected") {
      throw semantic("Only a draft or rejected promotion can be changed", {
        status: ["End it and create a new one instead"],
      });
    }
    promotionProblems(body);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const moved = await tx.promotion.updateMany({
          where: { id: current.id, version: body.expectedVersion },
          data: { ...promotionData(body), status: "draft", version: { increment: 1 } },
        });
        if (moved.count !== 1) throw staleVersion(current.version + 1);
        const row = await tx.promotion.findUniqueOrThrow({
          where: { id: current.id },
          include: { merchant: { select: { brandName: true } } },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "promotion.updated",
            targetType: "promotion",
            targetId: row.id,
            requestId,
            before: toPromotion(current) as unknown as Record<string, unknown>,
            after: toPromotion(row) as unknown as Record<string, unknown>,
          },
          tx,
        );
        return { data: toPromotion(row) };
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw conflict("This business already has a promotion with that code");
      throw error;
    }
  }

  @Post("promotions/:id/actions")
  @HttpCode(200)
  @Idempotent()
  async promotionAction(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(promotionActionRequestSchema)) body: PromotionActionRequest,
  ): Promise<{ data: Promotion }> {
    const current = await this.ownedPromotion(actor.userId, params.id);
    if (current.version !== body.expectedVersion) throw staleVersion(current.version);
    const step = PROMOTION_ACTIONS[body.action];
    if (!step.from.includes(current.status)) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "INVALID_TRANSITION",
        `A ${current.status.replace("_", " ")} promotion cannot be ${body.action === "end" ? "ended" : `${body.action}d`}`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.promotion.updateMany({
        where: { id: current.id, version: body.expectedVersion },
        data: { status: step.to, version: { increment: 1 } },
      });
      if (moved.count !== 1) throw staleVersion(current.version + 1);
      const row = await tx.promotion.findUniqueOrThrow({
        where: { id: current.id },
        include: { merchant: { select: { brandName: true } } },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: `promotion.${body.action}`,
          targetType: "promotion",
          targetId: row.id,
          requestId,
          before: { status: current.status },
          after: { status: row.status },
        },
        tx,
      );
      return { data: toPromotion(row) };
    });
  }

  private async ownedPromotion(userId: string, id: string) {
    const row = await this.prisma.promotion.findUnique({
      where: { id },
      include: { merchant: { select: { brandName: true } } },
    });
    if (!row) throw ApiError.notFound("Promotion not found");
    try {
      await this.access.requireOperatingOwner(userId, row.merchantId);
    } catch (error) {
      // Other businesses' promotions do not exist for this caller.
      if (error instanceof ApiError && error.code === "FORBIDDEN") throw error;
      throw ApiError.notFound("Promotion not found");
    }
    return row;
  }

  @Get("branches/:id/tables")
  async listTables(@CurrentActor() actor: Actor, @Param(idParams) params: { id: string }) {
    await this.access.requireBranchManager(actor.userId, params.id);
    const rows = await this.prisma.branchTable.findMany({
      where: { branchId: params.id },
      orderBy: [{ status: "asc" }, { label: "asc" }],
    });
    return { data: rows.map((t) => this.tableView(t)) };
  }

  @Post("branches/:id/tables")
  @Idempotent()
  async createTable(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(createBranchTableRequestSchema)) body: CreateBranchTableRequest,
  ): Promise<{ data: BranchTable }> {
    await this.access.requireBranchManager(actor.userId, params.id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.branchTable.create({
          data: { branchId: params.id, label: body.label },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            action: "table.created",
            targetType: "branch_table",
            targetId: row.id,
            requestId,
            after: { branchId: row.branchId, label: row.label },
          },
          tx,
        );
        return { data: this.tableView(row) };
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw conflict("This branch already has a table with that name");
      throw error;
    }
  }

  @Post("branches/:id/tables/:tableId/actions")
  @HttpCode(200)
  @Idempotent()
  async tableAction(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(branchTableParamsSchema)) params: { id: string; tableId: string },
    @Body(new ZodValidationPipe(branchTableActionRequestSchema))
    body: { action: "rotate" | "retire" },
  ): Promise<{ data: BranchTable }> {
    await this.access.requireBranchManager(actor.userId, params.id);
    const table = await this.prisma.branchTable.findFirst({
      where: { id: params.tableId, branchId: params.id },
    });
    if (!table) throw ApiError.notFound("Table not found");
    if (table.status === "retired") {
      throw semantic("This table is retired", { tableId: ["Add a new table instead"] });
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.branchTable.update({
        where: { id: table.id },
        data:
          body.action === "rotate"
            ? { tokenVersion: { increment: 1 } }
            : { status: "retired", tokenVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: `table.${body.action === "rotate" ? "rotated" : "retired"}`,
          targetType: "branch_table",
          targetId: row.id,
          requestId,
          before: { tokenVersion: table.tokenVersion, status: table.status },
          after: { tokenVersion: row.tokenVersion, status: row.status },
        },
        tx,
      );
      return { data: this.tableView(row) };
    });
  }

  private tableView(row: TableRow): BranchTable {
    const active = row.status === "active";
    return {
      id: row.id,
      branchId: row.branchId,
      label: row.label,
      active,
      token: active ? this.tokens.tokenFor(row.id, row.tokenVersion) : null,
      tokenVersion: row.tokenVersion,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// ── Admin ────────────────────────────────────────────────────────────────────

@Controller("admin")
export class AdminEngagementController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("promotions")
  @RequireAdmin("marketing", "operations")
  async listPromotions(
    @Query(new ZodValidationPipe(adminPromotionQuerySchema)) query: AdminPromotionQuery,
  ) {
    const rows = await this.prisma.promotion.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...before(decodeCursor(query.cursor)),
      },
      include: { merchant: { select: { brandName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return { data: items.map(toPromotion), meta: { nextCursor } };
  }

  @Post("promotions/:id/review")
  @HttpCode(200)
  @Idempotent()
  @RequireAdmin("marketing")
  async reviewPromotion(
    @CurrentActor() actor: Actor,
    @RequestId() requestId: string,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(reviewPromotionRequestSchema)) body: ReviewPromotionRequest,
  ): Promise<{ data: Promotion }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.promotion.findUnique({ where: { id: params.id } });
      if (!current) throw ApiError.notFound("Promotion not found");
      if (current.version !== body.expectedVersion) throw staleVersion(current.version);
      if (current.status !== "pending_review") {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "INVALID_TRANSITION",
          "Only submitted promotions can be reviewed",
        );
      }
      const status: PromotionStatus = body.decision === "approve" ? "approved" : "rejected";
      const moved = await tx.promotion.updateMany({
        where: { id: current.id, version: body.expectedVersion },
        data: {
          status,
          reviewNote: body.reason,
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (moved.count !== 1) throw staleVersion(current.version + 1);
      const row = await tx.promotion.findUniqueOrThrow({
        where: { id: current.id },
        include: { merchant: { select: { brandName: true } } },
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: `promotion.${status}`,
          targetType: "promotion",
          targetId: row.id,
          requestId,
          reason: body.reason,
          before: { status: current.status },
          after: { status },
        },
        tx,
      );
      return { data: toPromotion(row) };
    });
  }

  @Get("gifts")
  @RequireAdmin("marketing", "operations")
  async listGifts(
    @Query(new ZodValidationPipe(adminGiftQuerySchema))
    query: {
      status?: Gift["status"];
      cursor?: string;
      limit: number;
    },
  ) {
    const now = new Date();
    const status =
      query.status === "expired"
        ? { status: { in: ["issued", "claimed"] as GiftRow["status"][] }, expiresAt: { lte: now } }
        : query.status === "issued" || query.status === "claimed"
          ? { status: query.status, expiresAt: { gt: now } }
          : query.status
            ? { status: query.status }
            : {};
    const rows = await this.prisma.gift.findMany({
      where: { ...status, ...before(decodeCursor(query.cursor)) },
      include: giftInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, nextCursor } = page(rows, query.limit);
    return {
      data: items.map((g) => {
        const view: Partial<Gift> = giftView(g, "sent");
        delete view.role;
        return {
          ...view,
          purchaserId: g.purchaserId,
          recipientId: g.recipientId,
          orderId: g.orderId,
        };
      }),
      meta: { nextCursor },
    };
  }
}
