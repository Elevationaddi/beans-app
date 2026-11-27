import { Inject, Injectable } from "@nestjs/common";
import type {
  BranchMenu,
  CreateQuoteRequest,
  Fulfillment,
  Quote,
  QuoteLine,
  Totals,
} from "@beans/contracts";
import { ApiError } from "../common/api-error.js";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../database/prisma.service.js";
import { availabilityOf, DiscoveryService, resolveLine } from "../discovery/discovery.service.js";
import type { Prisma, Quote as QuoteRow, Slot } from "../generated/prisma/client.js";
import { localToday, SLOT_MINUTES } from "../inventory/schedule.js";
import { SlotService } from "../inventory/slot.service.js";
import { optionIdsOf } from "./cart.service.js";
import {
  branchClosed,
  featureDisabled,
  outOfStock,
  semantic,
  slotFull,
  staleCart,
} from "./ordering-errors.js";
import { SANDBOX_PRICING_POLICY, totalsFor } from "./pricing.js";

type Db = Prisma.TransactionClient | PrismaService;

type CartItemRow = {
  id: string;
  productId: string;
  quantity: number;
  options: Prisma.JsonValue;
  notes: string | null;
};

/** Prices every cart line against the menu. Throws OUT_OF_STOCK or VALIDATION_FAILED per line. */
export function priceLines(menu: BranchMenu, items: CartItemRow[]): QuoteLine[] {
  const soldOut: Record<string, string[]> = {};
  const invalid: Record<string, string[]> = {};
  const lines: QuoteLine[] = [];
  for (const item of items) {
    try {
      const line = resolveLine(menu, {
        productId: item.productId,
        optionIds: optionIdsOf(item.options),
        quantity: item.quantity,
      });
      lines.push({
        cartItemId: item.id,
        productId: item.productId,
        names: line.product.names,
        quantity: item.quantity,
        options: line.options.map((o) => ({
          id: o.id,
          names: o.names,
          deltaFils: o.deltaFils.toString(),
        })),
        notes: item.notes,
        unitFils: line.unitFils.toString(),
        lineFils: line.lineFils.toString(),
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === "VALIDATION_FAILED") invalid[`items.${item.id}`] = [error.message];
      else soldOut[`items.${item.id}`] = ["No longer available"];
    }
  }
  if (Object.keys(soldOut).length > 0) throw outOfStock(soldOut);
  if (Object.keys(invalid).length > 0)
    throw semantic("Some items need their options checked", invalid);
  return lines;
}

/** Quantity per product across lines, sorted by product ID (the stock lock order). */
export function quantitiesByProduct(lines: { productId: string; quantity: number }[]) {
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.quantity);
  return [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function quoteView(row: QuoteRow): Quote {
  const totals = row.totals as unknown as Totals;
  return {
    ...totals,
    id: row.id,
    cartId: row.cartId,
    cartVersion: row.cartVersion,
    branchId: row.branchId,
    expiresAt: row.expiresAt.toISOString(),
    policyVersion: row.policyVersion,
    menuVersion: row.menuVersion,
    lines: row.lineSnapshot as unknown as QuoteLine[],
    fulfillment: row.fulfillment as unknown as Fulfillment,
  };
}

/**
 * Server quote for the cart (F05): validated lines, branch prices, sandbox tax and fee, the
 * pickup slot and vehicle, all snapshotted and immutable. A quote holds nothing; checkout
 * holds the slot and stock and re-checks every price against this snapshot.
 */
@Injectable()
export class QuoteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(SlotService) private readonly slots: SlotService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(userId: string, body: CreateQuoteRequest): Promise<Quote> {
    // Phase-two features stay off until approved (D07, D14, D16).
    if (body.tableToken !== undefined) throw featureDisabled("tableToken", "Dine-in by table QR");
    if (body.promoCode !== undefined) throw featureDisabled("promoCode", "Promo codes");
    if (body.rewardId !== undefined) throw featureDisabled("rewardId", "Rewards");
    if (body.mode === "dine_in") throw featureDisabled("mode", "Dine-in");

    const cart = await this.prisma.cart.findFirst({
      where: { id: body.cartId, userId, status: "active" },
      include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!cart) throw ApiError.notFound("Cart not found");
    if (cart.version !== body.cartVersion) throw staleCart(cart.version);
    if (cart.items.length === 0)
      throw semantic("Your cart is empty", { cartId: ["Add an item first"] });

    const branch = await this.discovery.listedBranch(cart.branchId);
    if (branch.status === "paused")
      throw branchClosed("This branch is not taking orders right now");
    if (!branch.modes.includes(body.mode)) {
      throw semantic("This branch does not offer that pickup type", {
        mode: ["Not offered at this branch"],
      });
    }

    const vehicle = await this.vehicleFor(userId, body);
    const now = new Date();
    const asap = body.slotId === undefined;
    const slot = asap
      ? await this.asapSlot(branch, now)
      : await this.chosenSlot(branch.id, body.slotId ?? "", now);
    if (slot.reserved + slot.confirmed >= slot.capacity) throw slotFull();

    const menu = await this.discovery.menu(branch.id);
    const lines = priceLines(menu, cart.items);
    await this.checkStock(this.prisma, branch.id, lines);
    const subtotal = lines.reduce((sum, l) => sum + BigInt(l.lineFils), 0n);
    const totals = totalsFor(subtotal);
    const fulfillment: Fulfillment = {
      mode: body.mode,
      asap,
      slotId: slot.id,
      pickupAt: slot.startsAt.toISOString(),
      timezone: branch.timezone,
      vehicle,
    };

    const row = await this.prisma.quote.create({
      data: {
        cartId: cart.id,
        cartVersion: cart.version,
        userId,
        branchId: branch.id,
        mode: body.mode,
        slotId: slot.id,
        totals: totals as unknown as Prisma.InputJsonObject,
        lineSnapshot: lines as unknown as Prisma.InputJsonArray,
        fulfillment: fulfillment as unknown as Prisma.InputJsonObject,
        menuVersion: menu.version,
        policyVersion: SANDBOX_PRICING_POLICY.version,
        expiresAt: new Date(now.getTime() + this.env.QUOTE_TTL_SECONDS * 1000),
      },
    });
    return quoteView(row);
  }

  /** Early, advisory stock check; checkout's hold is the authoritative one. */
  async checkStock(db: Db, branchId: string, lines: QuoteLine[]): Promise<void> {
    const wanted = quantitiesByProduct(lines);
    const rows = await db.branchProduct.findMany({
      where: { branchId, productId: { in: wanted.map(([id]) => id) } },
    });
    const short = wanted.filter(([productId, quantity]) => {
      const row = rows.find((r) => r.productId === productId);
      return row?.stockOnHand != null && row.stockOnHand - row.stockReserved < quantity;
    });
    if (short.length > 0) {
      const fieldErrors: Record<string, string[]> = {};
      for (const [productId] of short) fieldErrors[`products.${productId}`] = ["Not enough left"];
      throw outOfStock(fieldErrors);
    }
  }

  private async vehicleFor(
    userId: string,
    body: CreateQuoteRequest,
  ): Promise<Fulfillment["vehicle"]> {
    if (body.mode !== "curbside") {
      if (body.vehicleId !== undefined) {
        throw semantic("A car is only needed for curbside pickup", {
          vehicleId: ["Only for curbside pickup"],
        });
      }
      return null;
    }
    if (body.vehicleId === undefined) {
      throw semantic("Choose a car for curbside pickup", { vehicleId: ["Required for curbside"] });
    }
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: body.vehicleId, userId } });
    if (!vehicle) throw ApiError.notFound("Vehicle not found");
    return {
      plate: vehicle.plate,
      plateRegion: vehicle.plateRegion as NonNullable<Fulfillment["vehicle"]>["plateRegion"],
      color: vehicle.color,
      model: vehicle.model,
    };
  }

  private async chosenSlot(branchId: string, slotId: string, now: Date): Promise<Slot> {
    const slot = await this.prisma.slot.findFirst({ where: { id: slotId, branchId } });
    if (!slot) throw ApiError.notFound("Pickup time not found");
    if (slot.startsAt <= now) {
      throw semantic("This pickup time has passed", { slotId: ["Choose a later time"] });
    }
    return slot;
  }

  /** ASAP: the branch must be open now; uses the current 15-minute slot, else the next one. */
  private async asapSlot(
    branch: Awaited<ReturnType<DiscoveryService["listedBranch"]>>,
    now: Date,
  ): Promise<Slot> {
    if (availabilityOf(branch, now) !== "open") {
      throw branchClosed("This branch is closed now. Choose a pickup time when it is open.");
    }
    const slots = await this.slots.ensureSlots(branch.id, localToday(branch.timezone, now));
    const slotMs = SLOT_MINUTES * 60_000;
    const slot =
      slots.find((s) => s.startsAt <= now && now.getTime() < s.startsAt.getTime() + slotMs) ??
      slots.find((s) => s.startsAt > now);
    if (!slot) throw branchClosed("This branch has no pickup times left today");
    return slot;
  }
}
