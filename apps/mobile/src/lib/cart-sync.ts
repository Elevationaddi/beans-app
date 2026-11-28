import type { Cart as LocalCart } from "../state/cart";
import { api, call } from "./api";

/**
 * Copies the cart on the device to the server cart before checkout. The server prices every
 * line again and is the only source of the amount charged (CLAUDE.md: never trust client
 * totals). Existing server lines are removed first so the two always match.
 */
export async function syncCart(local: LocalCart) {
  if (!local.branchId) throw new Error("Empty cart");
  const current = (await call(api.GET("/v1/cart"))).data;
  let version = current?.version;
  if (current && current.branchId === local.branchId) {
    for (const item of current.items) {
      const removed = await call(
        api.DELETE("/v1/cart/items/{id}", {
          params: { path: { id: item.id }, query: { expectedVersion: version ?? 1 } },
        }),
      );
      version = removed.data.version;
    }
  }
  let cart = (
    await call(
      api.PUT("/v1/cart", {
        body: {
          branchId: local.branchId,
          ...(version !== undefined && { expectedVersion: version }),
          replaceConfirmed: true,
        },
      }),
    )
  ).data;
  for (const line of local.lines) {
    cart = (
      await call(
        api.POST("/v1/cart/items", {
          body: {
            productId: line.productId,
            quantity: line.quantity,
            optionIds: line.optionIds,
            ...(line.notes.trim() && { notes: line.notes.trim() }),
            expectedVersion: cart.version,
          },
        }),
      )
    ).data;
  }
  return cart;
}

/** Today's date in Dubai (UTC+4, no daylight saving), as the API's local date. */
export function dubaiDate(now = Date.now()): string {
  return new Date(now + 4 * 3600_000).toISOString().slice(0, 10);
}

/** Time of day in Dubai for a UTC timestamp, HH:MM. */
export function dubaiTime(iso: string): string {
  return new Date(new Date(iso).getTime() + 4 * 3600_000).toISOString().slice(11, 16);
}
