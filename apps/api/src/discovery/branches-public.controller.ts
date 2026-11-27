import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  type BranchMenu,
  type BranchSearchQuery,
  branchSearchQuerySchema,
  type LocalizedText,
  type PriceItemRequest,
  type PricedItem,
  priceItemRequestSchema,
  type PublicBranchCard,
  type PublicBranchDetail,
  publicSlotsQuerySchema,
  uuidSchema,
} from "@beans/contracts";
import { z } from "zod";
import { Public } from "../auth/public.decorator.js";
import { ApiError } from "../common/api-error.js";
import { decodeOffsetCursor, encodeOffsetCursor } from "../common/cursor.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { distanceMeters, localToday } from "../inventory/schedule.js";
import { SlotService } from "../inventory/slot.service.js";
import {
  availabilityOf,
  DiscoveryService,
  LISTED_BRANCH,
  scheduleInclude,
  upcomingExceptions,
  weeklyHours,
} from "./discovery.service.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

/** Upper bound of branches ranked in one search (pilot scale; see progress log). */
const SEARCH_CAP = 500;

const cardInclude = {
  ...scheduleInclude,
  merchant: { select: { brandName: true } },
} satisfies Prisma.BranchInclude;
type CardRow = Prisma.BranchGetPayload<{ include: typeof cardInclude }>;

function toCard(
  row: CardRow,
  origin: { lat: number; lng: number } | null,
  now: Date,
): PublicBranchCard {
  const lat = row.lat === null ? null : Number(row.lat);
  const lng = row.lng === null ? null : Number(row.lng);
  return {
    id: row.id,
    merchantId: row.merchantId,
    brandName: row.merchant.brandName,
    names: { en: row.nameEn, ...(row.nameAr !== null && { ar: row.nameAr }) } as LocalizedText,
    address: row.address,
    city: row.city as PublicBranchCard["city"],
    lat,
    lng,
    modes: row.modes as PublicBranchCard["modes"],
    availability: availabilityOf(row, now),
    distanceMeters:
      origin && lat !== null && lng !== null ? distanceMeters(origin, { lat, lng }) : null,
  };
}

/** Public discovery for guests and customers (C02–C05). Read-only and unauthenticated. */
@Public()
@Controller("branches")
export class BranchesPublicController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(SlotService) private readonly slots: SlotService,
  ) {}

  @Get()
  async search(
    @Query(new ZodValidationPipe(branchSearchQuerySchema)) query: BranchSearchQuery,
  ): Promise<{ data: PublicBranchCard[]; meta: { nextCursor: string | null } }> {
    const offset = decodeOffsetCursor(query.cursor);
    const rows = await this.prisma.branch.findMany({
      where: {
        AND: [
          LISTED_BRANCH,
          query.city ? { city: query.city } : {},
          query.mode ? { modes: { has: query.mode } } : {},
          query.q
            ? {
                OR: [
                  { nameEn: { contains: query.q, mode: "insensitive" } },
                  { nameAr: { contains: query.q, mode: "insensitive" } },
                  { merchant: { brandName: { contains: query.q, mode: "insensitive" } } },
                ],
              }
            : {},
        ],
      },
      include: cardInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: SEARCH_CAP,
    });
    const now = new Date();
    const origin =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng }
        : null;
    let cards = rows.map((row) => toCard(row, origin, now));
    if (query.openNow) cards = cards.filter((c) => c.availability === "open");
    cards.sort((a, b) => {
      if (origin) {
        const da = a.distanceMeters ?? Number.POSITIVE_INFINITY;
        const db = b.distanceMeters ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return (
        a.brandName.localeCompare(b.brandName) ||
        a.names.en.localeCompare(b.names.en) ||
        a.id.localeCompare(b.id)
      );
    });
    const page = cards.slice(offset, offset + query.limit);
    const next = offset + query.limit;
    return {
      data: page,
      meta: { nextCursor: next < cards.length ? encodeOffsetCursor(next) : null },
    };
  }

  @Get(":id")
  async get(@Param(idParams) params: { id: string }): Promise<{ data: PublicBranchDetail }> {
    const branch = await this.discovery.listedBranch(params.id);
    const siblings = await this.prisma.branch.findMany({
      where: { merchantId: branch.merchantId, id: { not: branch.id }, ...LISTED_BRANCH },
      select: { id: true, nameEn: true, nameAr: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const now = new Date();
    return {
      data: {
        ...toCard(branch, null, now),
        phone: branch.phone,
        timezone: branch.timezone,
        hours: weeklyHours(branch),
        exceptions: upcomingExceptions(branch, now).filter(
          (e) => e.date >= localToday(branch.timezone, now),
        ),
        siblings: siblings.map((s) => ({
          id: s.id,
          names: { en: s.nameEn, ...(s.nameAr !== null && { ar: s.nameAr }) } as LocalizedText,
        })),
      },
    };
  }

  @Get(":id/menu")
  async menu(@Param(idParams) params: { id: string }): Promise<{ data: BranchMenu }> {
    return { data: await this.discovery.menu(params.id) };
  }

  @Post(":id/items/price")
  @HttpCode(200)
  async price(
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(priceItemRequestSchema)) body: PriceItemRequest,
  ): Promise<{ data: PricedItem }> {
    return { data: await this.discovery.priceItem(params.id, body) };
  }

  @Get(":id/slots")
  async listSlots(
    @Param(idParams) params: { id: string },
    @Query(new ZodValidationPipe(publicSlotsQuerySchema))
    query: z.infer<typeof publicSlotsQuerySchema>,
  ) {
    const branch = await this.discovery.listedBranch(params.id);
    if (!branch.modes.includes(query.mode)) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "This branch does not offer that pickup type",
        {
          mode: ["Not offered at this branch"],
        },
      );
    }
    const now = new Date();
    const availability = availabilityOf(branch, now);
    // A paused branch takes no new orders, so it offers no pickup times.
    const rows =
      branch.status === "paused" ? [] : await this.slots.ensureSlots(branch.id, query.date);
    return {
      data: {
        date: query.date,
        timezone: branch.timezone,
        availability,
        slots: rows
          .filter((s) => s.startsAt > now)
          .map((s) => ({
            startsAt: s.startsAt.toISOString(),
            available: s.reserved + s.confirmed < s.capacity,
          })),
      },
    };
  }
}
