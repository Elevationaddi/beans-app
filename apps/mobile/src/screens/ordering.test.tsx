import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { mockApi, renderScreen, testSession } from "../test-utils";
import { BranchScreen } from "./BranchScreen";
import { CartScreen } from "./CartScreen";
import { CheckoutScreen } from "./CheckoutScreen";
import { BRANCH_A, branchHandlers, LATTE, MERCHANT, SMALL } from "./fixtures";
import { OrderScreen } from "./OrderScreen";
import { OrdersScreen } from "./OrdersScreen";
import { SignInScreen } from "./SignInScreen";

// Development sign-in on, real (Supabase) sign-in off: the local development setup.
jest.mock("../lib/config", () => ({
  config: {
    apiUrl: "http://localhost:3000",
    supabaseUrl: null,
    supabaseAnonKey: null,
    devAuth: true,
  },
}));

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CART_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUOTE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const cartAtA = {
  branchId: BRANCH_A,
  branchName: "Test Roasters · Branch 1",
  menuVersion: "v1",
  lines: [
    {
      key: "line-1",
      productId: LATTE,
      name: "Latte",
      optionIds: [SMALL],
      optionNames: ["Small"],
      quantity: 2,
      unitFils: "1700",
      lineFils: "3400",
      notes: "",
    },
  ],
};

const platformOpen = {
  "GET /v1/platform/status": () => ({
    body: { data: { ordersPaused: false, message: null, features: {}, sandbox: true } },
  }),
};

function checkoutHandlers(paymentStatus: "captured" | "failed") {
  return {
    ...branchHandlers(BRANCH_A),
    ...platformOpen,
    "GET /v1/cart": () => ({ body: { data: null } }),
    "PUT /v1/cart": () => ({
      body: {
        data: { id: CART_ID, version: 1, branchId: BRANCH_A, items: [], canCheckout: false },
      },
    }),
    "POST /v1/cart/items": () => ({
      body: {
        data: {
          id: CART_ID,
          version: 2,
          branchId: BRANCH_A,
          items: [{ id: "i1", issue: null }],
          canCheckout: true,
        },
      },
    }),
    "GET /v1/vehicles": () => ({ body: { data: [] } }),
    [`GET /v1/branches/${BRANCH_A}/slots`]: () => ({ body: { data: { slots: [] } } }),
    "POST /v1/quotes": () => ({
      body: {
        data: {
          id: QUOTE_ID,
          lines: [{ cartItemId: "i1", quantity: 2, names: { en: "Latte" }, lineFils: "3400" }],
          subtotalFils: "3400",
          discountFils: "0",
          taxIncludedFils: "162",
          totalFils: "3400",
          fulfillment: { pickupAt: "2026-11-28T08:15:00.000Z" },
        },
      },
    }),
    "POST /v1/checkout": () => ({
      status: 201,
      body: {
        data: {
          orderId: ORDER_ID,
          payment: { status: paymentStatus, clientAction: { type: "none" } },
        },
      },
    }),
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    publicNumber: "A1B2",
    version: 4,
    status: "ready",
    mode: "curbside",
    brandName: "Test Roasters",
    branchNames: { en: "Branch 1" },
    etaAt: null,
    pickupAt: "2026-11-28T08:15:00.000Z",
    pickupCode: "4821",
    arrival: { arrivedAt: null, acknowledgedAt: null },
    fulfillment: { vehicle: { plate: "A 12345", color: "White", model: "Patrol" } },
    items: [{ quantity: 2, names: { en: "Latte" }, totalFils: "3400", options: [], notes: null }],
    totals: { totalFils: "3400", taxIncludedFils: "162" },
    refunds: [],
    cancellationRequest: null,
    policyVersion: "sandbox-1",
    ...overrides,
  };
}

describe("C01: development sign-in", () => {
  it("lists fictional customer accounts and signs in with a server session", async () => {
    const calls = mockApi({
      "GET /v1/dev-auth/accounts": () => ({
        body: {
          data: [
            {
              userId: "u1",
              kind: "customer",
              email: "customer@example.test",
              displayName: "Test Customer",
              phone: null,
              status: "active",
            },
            {
              userId: "u2",
              kind: "merchant",
              email: "owner-a@example.test",
              displayName: "Owner",
              phone: null,
              status: "active",
            },
          ],
        },
      }),
      "POST /v1/dev-auth/sessions": () => ({
        status: 201,
        body: { data: { accessToken: "dev-token" } },
      }),
      "GET /v1/me": () => ({ body: { data: testSession.profile } }),
    });
    await renderScreen("SignIn", SignInScreen as never, undefined);
    expect(await screen.findByTestId("dev-sign-in")).toBeTruthy();
    expect(screen.queryByTestId("dev-account-owner-a@example.test")).toBeNull();
    fireEvent.press(await screen.findByTestId("dev-account-customer@example.test"));
    await waitFor(() => expect(calls.some((c) => c.path === "/v1/me")).toBe(true));
    const session = calls.find((c) => c.path === "/v1/dev-auth/sessions");
    expect(session?.body).toEqual({ userId: "u1", mfa: false });
    const me = calls.find((c) => c.path === "/v1/me");
    expect(me?.headers.get("authorization")).toBe("Bearer dev-token");
  });
});

describe("C06: cart when signed in", () => {
  it("offers checkout to a signed-in customer", async () => {
    mockApi({});
    await renderScreen("Cart", CartScreen as never, undefined, {
      cart: cartAtA,
      session: testSession,
    });
    expect(screen.queryByTestId("checkout-sign-in")).toBeNull();
    fireEvent.press(screen.getByTestId("checkout"));
    expect(await screen.findByTestId("at-Checkout")).toBeTruthy();
  });
});

describe("C07: checkout", () => {
  it("syncs the cart, shows the server quote and pays in the sandbox", async () => {
    const calls = mockApi(checkoutHandlers("captured"));
    await renderScreen("Checkout", CheckoutScreen as never, undefined, {
      cart: cartAtA,
      session: testSession,
    });
    const review = await screen.findByTestId("review");
    await waitFor(() => expect(review.props.accessibilityState?.disabled).toBeFalsy());
    fireEvent.press(review);
    expect(await screen.findByTestId("quote")).toBeTruthy();
    expect(screen.getByText("Total: AED 34.00")).toBeTruthy();
    expect(screen.getByText("Sandbox payment: no real money is charged.")).toBeTruthy();

    const quote = calls.find((c) => c.path === "/v1/quotes");
    expect(quote?.body).toEqual({ cartId: CART_ID, cartVersion: 2, mode: "in_store" });
    const item = calls.find((c) => c.path === "/v1/cart/items");
    // Only product, options and quantity go to the server: never a client price.
    expect(item?.body).toEqual({
      productId: LATTE,
      quantity: 2,
      optionIds: [SMALL],
      expectedVersion: 1,
    });

    fireEvent.press(screen.getByTestId("pay"));
    const at = await screen.findByTestId("at-Order");
    expect(JSON.parse(String(at.props.children))).toEqual({ orderId: ORDER_ID });
    const pay = calls.find((c) => c.path === "/v1/checkout");
    expect(pay?.body).toEqual({ quoteId: QUOTE_ID, sandboxOutcome: "succeed" });
    expect(pay?.headers.get("idempotency-key")).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(pay?.headers.get("authorization")).toBe("Bearer test-token");
  });

  it("shows a declined payment without leaving checkout", async () => {
    mockApi(checkoutHandlers("failed"));
    await renderScreen("Checkout", CheckoutScreen as never, undefined, {
      cart: cartAtA,
      session: testSession,
    });
    const review = await screen.findByTestId("review");
    await waitFor(() => expect(review.props.accessibilityState?.disabled).toBeFalsy());
    fireEvent.press(review);
    fireEvent.press(await screen.findByTestId("pay-decline"));
    expect(await screen.findByTestId("declined")).toBeTruthy();
    expect(screen.queryByTestId("at-Order")).toBeNull();
  });

  it("asks for the next quote on a fresh server cart after a decline", async () => {
    // Each copy of the device cart makes a new server cart; the declined one is spent.
    let copies = 0;
    const cartId = () => `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${copies}`;
    const base = checkoutHandlers("failed");
    const calls = mockApi({
      ...base,
      "PUT /v1/cart": () => {
        copies += 1;
        return {
          body: {
            data: { id: cartId(), version: 1, branchId: BRANCH_A, items: [], canCheckout: false },
          },
        };
      },
      "POST /v1/cart/items": () => ({
        body: {
          data: {
            id: cartId(),
            version: 2,
            branchId: BRANCH_A,
            items: [{ id: "i1", issue: null }],
            canCheckout: true,
          },
        },
      }),
    });
    // Hold the second copy of the cart until the test lets it through.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const mocked = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = input instanceof Request ? input.method : (init?.method ?? "GET");
      if (
        method === "PUT" &&
        String(input instanceof Request ? input.url : input).endsWith("/v1/cart") &&
        copies === 1
      )
        await held;
      return mocked(input, init);
    }) as typeof fetch;
    await renderScreen("Checkout", CheckoutScreen as never, undefined, {
      cart: cartAtA,
      session: testSession,
    });
    const review = await screen.findByTestId("review");
    await waitFor(() => expect(review.props.accessibilityState?.disabled).toBeFalsy());
    fireEvent.press(review);
    fireEvent.press(await screen.findByTestId("pay-decline"));
    expect(await screen.findByTestId("declined")).toBeTruthy();
    // While the cart is being copied again, the spent cart must not be quoted.
    expect(screen.getByTestId("review").props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("review"));
    release();
    await waitFor(() =>
      expect(screen.getByTestId("review").props.accessibilityState?.disabled).toBeFalsy(),
    );
    fireEvent.press(screen.getByTestId("review"));
    await screen.findByTestId("quote");
    const quoted = calls
      .filter((c) => c.path === "/v1/quotes")
      .map((c) => (c.body as { cartId: string }).cartId);
    expect(copies).toBe(2);
    expect(quoted).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
      "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
    ]);
  });

  it("blocks review while ordering is paused", async () => {
    mockApi({
      ...checkoutHandlers("captured"),
      "GET /v1/platform/status": () => ({
        body: {
          data: {
            ordersPaused: true,
            message: { en: "Back at 6 PM" },
            features: {},
            sandbox: true,
          },
        },
      }),
    });
    await renderScreen("Checkout", CheckoutScreen as never, undefined, {
      cart: cartAtA,
      session: testSession,
    });
    expect(await screen.findByText("Back at 6 PM")).toBeTruthy();
    const review = await screen.findByTestId("review");
    expect(review.props.accessibilityState?.disabled).toBe(true);
  });
});

describe("C08: live order", () => {
  it("shows the pickup code and sends curbside arrival with the order version", async () => {
    let current = order();
    const calls = mockApi({
      [`GET /v1/orders/${ORDER_ID}`]: () => ({ body: { data: current } }),
      [`POST /v1/orders/${ORDER_ID}/arrival`]: () => {
        current = order({
          arrival: { arrivedAt: "2026-11-28T08:10:00.000Z", acknowledgedAt: null },
        });
        return { body: { data: current } };
      },
    });
    await renderScreen(
      "Order",
      OrderScreen as never,
      { orderId: ORDER_ID },
      { session: testSession },
    );
    expect(await screen.findByTestId("pickup-code")).toBeTruthy();
    expect(screen.getByText("4821")).toBeTruthy();
    expect(screen.getByText("Your order is ready to collect.")).toBeTruthy();
    fireEvent.press(screen.getByTestId("arrive"));
    expect(await screen.findByTestId("arrived")).toBeTruthy();
    const arrival = calls.find((c) => c.path.endsWith("/arrival"));
    expect(arrival?.body).toEqual({ expectedVersion: 4 });
  });
});

describe("C09: order history", () => {
  it("asks guests to sign in", async () => {
    mockApi({});
    await renderScreen("Tabs", OrdersScreen as never, undefined);
    fireEvent.press(screen.getByTestId("orders-sign-in"));
    expect(await screen.findByTestId("at-SignIn")).toBeTruthy();
  });

  it("lists a signed-in customer's orders and opens one", async () => {
    mockApi({
      "GET /v1/orders": () => ({
        body: {
          data: [
            {
              id: ORDER_ID,
              publicNumber: "A1B2",
              status: "preparing",
              brandName: "Test Roasters",
              branchNames: { en: "Branch 1" },
              totalFils: "3400",
              pickupAt: "2026-11-28T08:15:00.000Z",
            },
          ],
          meta: { nextCursor: null },
        },
      }),
    });
    await renderScreen("Tabs", OrdersScreen as never, undefined, { session: testSession });
    fireEvent.press(await screen.findByTestId("order-row-A1B2"));
    expect(await screen.findByTestId("at-Order")).toBeTruthy();
  });
});

describe("C04: saved cafés", () => {
  it("saves a café for a signed-in customer", async () => {
    let saved = false;
    const calls = mockApi({
      ...branchHandlers(BRANCH_A),
      "GET /v1/favorites": () => ({
        body: {
          data: saved
            ? [
                {
                  merchantId: MERCHANT,
                  brandName: "Test Roasters",
                  savedAt: "2026-11-28T08:00:00Z",
                },
              ]
            : [],
          meta: { nextCursor: null },
        },
      }),
      [`PUT /v1/favorites/${MERCHANT}`]: () => {
        saved = true;
        return { body: { data: { merchantId: MERCHANT, saved: true } } };
      },
    });
    await renderScreen(
      "Branch",
      BranchScreen as never,
      { branchId: BRANCH_A },
      {
        session: testSession,
      },
    );
    fireEvent.press(await screen.findByText("Save café"));
    expect(await screen.findByText("Remove from saved")).toBeTruthy();
    expect(calls.some((c) => c.method === "PUT" && c.path === `/v1/favorites/${MERCHANT}`)).toBe(
      true,
    );
  });
});
