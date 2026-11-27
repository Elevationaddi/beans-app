import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  AddCartItemRequest,
  BranchMenu,
  Cart,
  CartItem,
  LocalizedText,
  PutCartRequest,
  UpdateCartItemRequest,
} from "@beans/contracts";
import { MAX_ITEM_QUANTITY } from "@beans/contracts";
import { ApiError } from "../common/api-error.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import { DiscoveryService, resolveLine } from "../discovery/discovery.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { semantic, staleCart } from "./ordering-errors.js";

/** Most distinct lines in one cart (technical bound, not a commercial rule). */
export const MAX_CART_LINES = 30;

const cartInclude = {
  items: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { product: { select: { names: true } } },
  },
  branch: { select: { nameEn: true, nameAr: true, status: true } },
} satisfies Prisma.CartInclude;

export type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export function branchNames(b: { nameEn: string; nameAr: string | null }): LocalizedText {
  return { en: b.nameEn, ...(b.nameAr !== null && { ar: b.nameAr }) };
}

export function optionIdsOf(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const sameOptions = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

/**
 * The customer's single-branch cart (F04). Every change is checked against the menu on the
 * server and bumps the cart version with a conditional update, so two devices editing the
 * same cart cannot overwrite each other silently.
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
  ) {}

  async activeCart(userId: string): Promise<CartRow | null> {
    return this.prisma.cart.findFirst({
      where: { userId, status: "active" },
      include: cartInclude,
    });
  }

  async requireActive(userId: string): Promise<CartRow> {
    const cart = await this.activeCart(userId);
    if (!cart) throw ApiError.notFound("You have no cart. Choose a branch first.");
    return cart;
  }

  /** The cart with current server prices. Lines that can no longer be ordered carry an issue. */
  async view(cart: CartRow): Promise<Cart> {
    let menu: BranchMenu | null = null;
    try {
      menu = await this.discovery.menu(cart.branchId);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "NOT_FOUND")) throw error;
      // The branch is no longer listed: every line is unavailable.
    }
    const allOptionIds = [...new Set(cart.items.flatMap((i) => optionIdsOf(i.options)))];
    const optionRows =
      allOptionIds.length > 0
        ? await this.prisma.modifierOption.findMany({
            where: { id: { in: allOptionIds } },
            select: { id: true, name: true },
          })
        : [];
    const optionNames = new Map(optionRows.map((o) => [o.id, o.name as unknown as LocalizedText]));

    let subtotal = 0n;
    const items = cart.items.map((item): CartItem => {
      const optionIds = optionIdsOf(item.options);
      const base = {
        id: item.id,
        productId: item.productId,
        names: (item.product.names as unknown as LocalizedText | null) ?? null,
        quantity: item.quantity,
        optionIds,
        options: optionIds.flatMap((id) => {
          const names = optionNames.get(id);
          return names ? [{ id, names }] : [];
        }),
        notes: item.notes,
      };
      if (!menu) return { ...base, unitFils: null, lineFils: null, issue: "unavailable" };
      try {
        const line = resolveLine(menu, { ...base, optionIds });
        subtotal += line.lineFils;
        return {
          ...base,
          names: line.product.names,
          options: line.options.map((o) => ({ id: o.id, names: o.names })),
          unitFils: line.unitFils.toString(),
          lineFils: line.lineFils.toString(),
          issue: null,
        };
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        const issue = error.code === "VALIDATION_FAILED" ? "options_changed" : "unavailable";
        return { ...base, unitFils: null, lineFils: null, issue };
      }
    });

    return {
      id: cart.id,
      branchId: cart.branchId,
      branchNames: branchNames(cart.branch),
      version: cart.version,
      currency: "AED",
      items,
      subtotalFils: subtotal.toString(),
      menuVersion: menu?.version ?? null,
      canCheckout:
        menu !== null &&
        cart.branch.status === "active" &&
        items.length > 0 &&
        items.every((i) => i.issue === null),
    };
  }

  /** Starts a cart at a branch. Replacing a non-empty cart of another branch needs consent (Q03). */
  async put(userId: string, body: PutCartRequest): Promise<CartRow> {
    await this.discovery.listedBranch(body.branchId);
    try {
      return await this.putOnce(userId, body);
    } catch (error) {
      // Another request created the active cart at the same moment: decide again against it.
      if (isUniqueViolation(error)) return this.putOnce(userId, body);
      throw error;
    }
  }

  private async putOnce(userId: string, body: PutCartRequest): Promise<CartRow> {
    const cartId = await this.prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ id: string; branch_id: string; version: number }[]>`
        SELECT id, branch_id, version FROM carts
        WHERE user_id = ${userId}::uuid AND status = 'active' FOR UPDATE`;
      if (current) {
        if (body.expectedVersion !== undefined && body.expectedVersion !== current.version)
          throw staleCart(current.version);
        if (current.branch_id === body.branchId) return current.id;
        const items = await tx.cartItem.count({ where: { cartId: current.id } });
        if (items > 0 && !body.replaceConfirmed) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            "CONFLICT",
            "Your cart has items from another branch. Confirm to empty it and start here.",
            { replaceConfirmed: ["Confirm replacing the cart"] },
          );
        }
        await tx.cart.update({ where: { id: current.id }, data: { status: "abandoned" } });
      }
      const created = await tx.cart.create({ data: { userId, branchId: body.branchId } });
      return created.id;
    });
    return this.prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: cartInclude });
  }

  async addItem(userId: string, body: AddCartItemRequest): Promise<CartRow> {
    const cart = await this.requireActive(userId);
    const menu = await this.discovery.menu(cart.branchId);
    resolveLine(menu, body);
    const optionIds = [...body.optionIds].sort();
    const notes = body.notes ?? null;

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, cart.id, body.expectedVersion);
      const lines = await tx.cartItem.findMany({ where: { cartId: cart.id } });
      const same = lines.find(
        (l) =>
          l.productId === body.productId &&
          l.notes === notes &&
          sameOptions(optionIdsOf(l.options), optionIds),
      );
      if (same) {
        const quantity = same.quantity + body.quantity;
        if (quantity > MAX_ITEM_QUANTITY) {
          throw semantic(`At most ${MAX_ITEM_QUANTITY} of one item`, {
            quantity: [`At most ${MAX_ITEM_QUANTITY} in total; you already have ${same.quantity}`],
          });
        }
        await tx.cartItem.update({ where: { id: same.id }, data: { quantity } });
        return;
      }
      if (lines.length >= MAX_CART_LINES) {
        throw semantic(`At most ${MAX_CART_LINES} different items in one cart`, {
          productId: ["The cart is full"],
        });
      }
      await tx.cartItem.create({
        data: {
          cartId: cart.id,
          productId: body.productId,
          quantity: body.quantity,
          options: optionIds,
          notes,
        },
      });
    });
    return this.reload(cart.id);
  }

  async updateItem(userId: string, itemId: string, body: UpdateCartItemRequest): Promise<CartRow> {
    const cart = await this.requireActive(userId);
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) throw ApiError.notFound("Cart item not found");
    const menu = await this.discovery.menu(cart.branchId);
    resolveLine(menu, { productId: item.productId, ...body });
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, cart.id, body.expectedVersion);
      await tx.cartItem.update({
        where: { id: item.id },
        data: {
          quantity: body.quantity,
          options: [...body.optionIds].sort(),
          ...(body.notes !== undefined && { notes: body.notes }),
        },
      });
    });
    return this.reload(cart.id);
  }

  async removeItem(userId: string, itemId: string, expectedVersion: number): Promise<CartRow> {
    const cart = await this.requireActive(userId);
    if (!cart.items.some((i) => i.id === itemId)) throw ApiError.notFound("Cart item not found");
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, cart.id, expectedVersion);
      await tx.cartItem.delete({ where: { id: itemId } });
    });
    return this.reload(cart.id);
  }

  private reload(cartId: string): Promise<CartRow> {
    return this.prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: cartInclude });
  }

  /** Version check and bump in one conditional update; locks the cart for the transaction. */
  private async bump(
    tx: Prisma.TransactionClient,
    cartId: string,
    expectedVersion: number,
  ): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE carts SET version = version + 1, updated_at = now()
      WHERE id = ${cartId}::uuid AND version = ${expectedVersion}::int AND status = 'active'`;
    if (updated === 1) return;
    const current = await tx.cart.findUnique({ where: { id: cartId } });
    if (!current || current.status !== "active")
      throw ApiError.notFound("You have no cart. Choose a branch first.");
    throw staleCart(current.version);
  }
}
