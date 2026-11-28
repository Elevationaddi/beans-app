import { randomUUID } from "node:crypto";

/** Small API client for test setup: development sign-in and sandbox orders. */
export const API = process.env.E2E_API_URL ?? "http://localhost:3000";

export async function call<T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  token?: string | null,
  body?: unknown,
): Promise<T> {
  const response = await fetch(API + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(method !== "GET" ? { "idempotency-key": randomUUID() } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { data?: T };
  if (!response.ok) throw new Error(`${method} ${path} ${response.status} ${JSON.stringify(json)}`);
  return json.data as T;
}

type DevAccount = { userId: string; email: string | null };

/** A session token for a seeded fictional account. */
export async function devToken(email: string, mfa = false): Promise<string> {
  const accounts = await call<DevAccount[]>("GET", "/v1/dev-auth/accounts");
  const account = accounts.find((a) => a.email === email);
  if (!account) throw new Error(`No seeded account ${email}`);
  const session = await call<{ accessToken: string }>("POST", "/v1/dev-auth/sessions", null, {
    userId: account.userId,
    mfa,
  });
  return session.accessToken;
}

export const BRANCH = "Roastery A Corniche";

type Branch = { id: string; names: { en: string } };
type MenuProduct = {
  id: string;
  available?: boolean;
  groups?: { minCount?: number; options: { id: string }[] }[];
};

export interface PlacedOrder {
  orderId: string;
  publicNumber: string;
  pickupCode: string | null;
}

/** Places and pays (sandbox provider) a customer order at the seeded test branch. */
export async function placeOrder(mode: "in_store" | "curbside" = "in_store"): Promise<PlacedOrder> {
  const token = await devToken("customer@example.test");
  const branches = await call<Branch[]>("GET", "/v1/branches?limit=50", token);
  const branch = branches.find((b) => b.names.en === BRANCH);
  if (!branch) throw new Error(`Branch ${BRANCH} is not listed`);
  const menu = await call<{ categories: { products: MenuProduct[] }[] }>(
    "GET",
    `/v1/branches/${branch.id}/menu`,
    token,
  );
  const product = menu.categories.flatMap((c) => c.products).find((p) => p.available !== false);
  if (!product) throw new Error("No available product");
  const optionIds = (product.groups ?? [])
    .filter((g) => (g.minCount ?? 0) > 0)
    .map((g) => g.options[0]!.id);
  const cart = await call<{ id: string; version: number }>("PUT", "/v1/cart", token, {
    branchId: branch.id,
  });
  const filled = await call<{ id: string; version: number }>("POST", "/v1/cart/items", token, {
    productId: product.id,
    quantity: 1,
    optionIds,
    expectedVersion: cart.version,
  });
  let vehicleId: string | undefined;
  if (mode === "curbside") {
    const vehicles = await call<{ id: string }[]>("GET", "/v1/vehicles", token);
    vehicleId =
      vehicles[0]?.id ??
      (
        await call<{ id: string }>("POST", "/v1/vehicles", token, {
          plate: "12345",
          plateRegion: "abu_dhabi",
          color: "White",
          model: "Sedan",
        })
      ).id;
  }
  const quote = await call<{ id: string }>("POST", "/v1/quotes", token, {
    cartId: filled.id,
    cartVersion: filled.version,
    mode,
    ...(vehicleId ? { vehicleId } : {}),
  });
  const result = await call<{ orderId: string }>("POST", "/v1/checkout", token, {
    quoteId: quote.id,
    sandboxOutcome: "succeed",
  });
  // The sandbox provider confirms payment through its webhook; wait for the order to be paid.
  for (let i = 0; i < 20; i++) {
    const order = await call<{ publicNumber: string; status: string; pickupCode: string | null }>(
      "GET",
      `/v1/orders/${result.orderId}`,
      token,
    );
    if (order.status !== "pending_payment") {
      return {
        orderId: result.orderId,
        publicNumber: order.publicNumber,
        pickupCode: order.pickupCode,
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Order was not paid in time");
}
