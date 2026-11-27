import { Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Branch stock holds (B05: "stock hold atomic; concurrent last unit cannot oversell").
 * Tracked stock is held with one conditional UPDATE, backed by the database CHECK
 * stock_reserved <= stock_on_hand. Untracked products only need to be enabled.
 * Checkout (phase 6) calls these inside its reservation transaction.
 */
@Injectable()
export class StockService {
  /** Holds `quantity` units at a branch. Returns false when sold out or not available there. */
  async hold(tx: Db, branchId: string, productId: string, quantity: number): Promise<boolean> {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw ApiError.validation({ quantity: ["Must be a positive integer"] });
    }
    const updated = await tx.$executeRaw`
      UPDATE branch_products
      SET stock_reserved = CASE WHEN stock_on_hand IS NULL THEN stock_reserved
                                ELSE stock_reserved + ${quantity}::int END,
          updated_at = now()
      WHERE branch_id = ${branchId}::uuid AND product_id = ${productId}::uuid AND enabled
        AND (stock_on_hand IS NULL OR stock_reserved + ${quantity}::int <= stock_on_hand)`;
    return updated === 1;
  }

  /** Returns held units of tracked stock (an order that was not prepared). */
  async release(tx: Db, branchId: string, productId: string, quantity: number): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE branch_products SET stock_reserved = stock_reserved - ${quantity}::int, updated_at = now()
      WHERE branch_id = ${branchId}::uuid AND product_id = ${productId}::uuid
        AND stock_on_hand IS NOT NULL AND stock_reserved >= ${quantity}::int`;
    return updated === 1;
  }

  /** Held units leave stock for good: the order was handed over (or made and then cancelled). */
  async consume(tx: Db, branchId: string, productId: string, quantity: number): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE branch_products
      SET stock_reserved = stock_reserved - ${quantity}::int,
          stock_on_hand = stock_on_hand - ${quantity}::int, updated_at = now()
      WHERE branch_id = ${branchId}::uuid AND product_id = ${productId}::uuid
        AND stock_on_hand IS NOT NULL AND stock_reserved >= ${quantity}::int
        AND stock_on_hand >= ${quantity}::int`;
    return updated === 1;
  }
}
