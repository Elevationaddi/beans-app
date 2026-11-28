import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { setTable } from "../lib/table";
import { mockApi, renderScreen, testSession } from "../test-utils";
import { CheckoutScreen } from "./CheckoutScreen";
import { BRANCH_A, branchHandlers, detail, LATTE, MERCHANT, SMALL } from "./fixtures";
import { RewardsScreen } from "./RewardsScreen";
import { TableScreen } from "./TableScreen";

jest.mock("../lib/config", () => ({
  config: {
    apiUrl: "http://localhost:3000",
    supabaseUrl: null,
    supabaseAnonKey: null,
    devAuth: true,
  },
}));

const CART_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUOTE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CARD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GIFT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TABLE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TOKEN = "t1.signed-table-token.1.mac";

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
      quantity: 1,
      unitFils: "1700",
      lineFils: "1700",
      notes: "",
    },
  ],
};

const stampCard = {
  id: CARD_ID,
  merchantId: MERCHANT,
  names: { en: "Coffee card" },
  stampsRequired: 5,
  reward: { en: "One drink on us" },
  rewardMaxFils: "2500",
  active: true,
  termsVersion: 1,
  updatedAt: "2026-11-28T08:00:00.000Z",
};

function handlers(extra: Record<string, unknown> = {}, benefit: unknown = null, discount = "0") {
  return {
    ...branchHandlers(BRANCH_A),
    [`GET /v1/branches/${BRANCH_A}`]: () => ({
      body: { data: { ...detail(BRANCH_A), modes: ["in_store", "dine_in"] } },
    }),
    "GET /v1/platform/status": () => ({
      body: { data: { ordersPaused: false, message: null, features: {}, sandbox: true } },
    }),
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
    "GET /v1/me/stamps": () => ({
      body: {
        data: [
          {
            merchantId: MERCHANT,
            brandName: "Test Roasters",
            balance: 5,
            card: stampCard,
            rewardAvailable: true,
          },
        ],
      },
    }),
    "GET /v1/gifts": () => ({ body: { data: [] } }),
    [`GET /v1/branches/${BRANCH_A}/slots`]: () => ({ body: { data: { slots: [] } } }),
    "POST /v1/quotes": () => ({
      status: 201,
      body: {
        data: {
          id: QUOTE_ID,
          lines: [{ cartItemId: "i1", quantity: 1, names: { en: "Latte" }, lineFils: "1700" }],
          subtotalFils: "1700",
          discountFils: discount,
          taxIncludedFils: "81",
          totalFils: String(1700 - Number(discount)),
          fulfillment: { pickupAt: "2026-11-28T08:15:00.000Z", table: null },
          benefit,
        },
      },
    }),
    ...extra,
  };
}

async function openCheckout() {
  await renderScreen("Checkout", CheckoutScreen as never, undefined, {
    cart: cartAtA,
    session: testSession,
  });
  const review = await screen.findByTestId("review");
  await waitFor(() => expect(review.props.accessibilityState?.disabled).toBeFalsy());
  return review;
}

beforeEach(() => setTable(null));

describe("C06/C10: savings at checkout", () => {
  it("sends only the promo code; the server works out the discount", async () => {
    const calls = mockApi(
      handlers(
        {},
        { kind: "promotion", promotionId: CARD_ID, code: "SANDBOX10", discountFils: "170" },
        "170",
      ),
    );
    await openCheckout();
    fireEvent.changeText(screen.getByTestId("promo-code"), "sandbox10");
    await waitFor(() =>
      expect(screen.getByTestId("apply-promo").props.accessibilityState?.disabled).toBeFalsy(),
    );
    fireEvent.press(screen.getByTestId("apply-promo"));
    await waitFor(() =>
      expect(screen.getByTestId("apply-promo")).toHaveTextContent("Code applied"),
    );
    fireEvent.press(screen.getByTestId("review"));
    expect(await screen.findByTestId("quote")).toBeTruthy();
    expect(screen.getByTestId("quote-discount")).toHaveTextContent("Code SANDBOX10: -AED 1.70");
    const quote = calls.find((c) => c.path === "/v1/quotes");
    expect(quote?.body).toEqual({
      cartId: CART_ID,
      cartVersion: 2,
      mode: "in_store",
      promoCode: "SANDBOX10",
    });
  });

  it("offers an earned stamp reward and sends the card, never an amount", async () => {
    const calls = mockApi(
      handlers(
        {},
        {
          kind: "reward",
          stampCardId: CARD_ID,
          stamps: 5,
          label: { en: "One drink on us" },
          discountFils: "1600",
        },
        "1600",
      ),
    );
    await openCheckout();
    fireEvent.press(await screen.findByTestId("saving-reward"));
    await waitFor(() =>
      expect(screen.getByTestId("saving-reward").props.accessibilityState?.checked).toBe(true),
    );
    fireEvent.press(screen.getByTestId("review"));
    expect(await screen.findByTestId("quote")).toBeTruthy();
    expect(screen.getByTestId("quote-discount")).toHaveTextContent("Stamp reward: -AED 16.00");
    expect(calls.find((c) => c.path === "/v1/quotes")?.body).toEqual({
      cartId: CART_ID,
      cartVersion: 2,
      mode: "in_store",
      rewardId: CARD_ID,
    });
  });

  it("still checks out when stamps and gifts are switched off", async () => {
    mockApi(
      handlers({
        "GET /v1/me/stamps": () => ({
          status: 422,
          body: { error: { code: "FEATURE_DISABLED", message: "Off", requestId: "t" } },
        }),
        "GET /v1/gifts": () => ({
          status: 422,
          body: { error: { code: "FEATURE_DISABLED", message: "Off", requestId: "t" } },
        }),
      }),
    );
    await openCheckout();
    expect(screen.queryByTestId("saving-reward")).toBeNull();
  });
});

describe("Dine-in by table code", () => {
  it("checks the scanned code with the server, then orders to that table", async () => {
    const calls = mockApi({
      "GET /v1/tables/resolve": () => ({
        body: {
          data: {
            branchId: BRANCH_A,
            brandName: "Test Roasters",
            branchNames: { en: "Branch 1" },
            table: { id: TABLE_ID, label: "T7" },
          },
        },
      }),
    });
    await renderScreen("Table", TableScreen as never, { token: TOKEN });
    expect(await screen.findByText("Table T7")).toBeTruthy();
    expect(calls.find((c) => c.path === "/v1/tables/resolve")?.query.get("token")).toBe(TOKEN);
    fireEvent.press(screen.getByTestId("table-order"));
    const at = await screen.findByTestId("at-Branch");
    expect(JSON.parse(String(at.props.children))).toEqual({ branchId: BRANCH_A });
  });

  it("sends the signed table code with a dine-in quote", async () => {
    setTable({ token: TOKEN, branchId: BRANCH_A, label: "T7" });
    const calls = mockApi(handlers());
    const review = await openCheckout();
    expect(screen.getByTestId("checkout-table")).toHaveTextContent("To table T7");
    fireEvent.press(review);
    await screen.findByTestId("quote");
    expect(calls.find((c) => c.path === "/v1/quotes")?.body).toEqual({
      cartId: CART_ID,
      cartVersion: 2,
      mode: "dine_in",
      tableToken: TOKEN,
    });
  });

  it("shows the server's refusal of a rotated or forged code", async () => {
    mockApi({
      "GET /v1/tables/resolve": () => ({
        status: 404,
        body: {
          error: { code: "NOT_FOUND", message: "This table code is not valid", requestId: "t" },
        },
      }),
    });
    await renderScreen("Table", TableScreen as never, { token: TOKEN });
    expect(await screen.findByText("This table code is not valid")).toBeTruthy();
    expect(screen.queryByTestId("table-order")).toBeNull();
  });
});

describe("C11: sandbox gifts", () => {
  it("claims a gift with its code and an idempotency key", async () => {
    const gift = {
      id: GIFT_ID,
      merchantId: MERCHANT,
      brandName: "Test Roasters",
      productId: LATTE,
      productNames: { en: "Latte" },
      valueFils: "1700",
      message: null,
      status: "claimed",
      role: "received",
      expiresAt: "2026-12-28T08:00:00.000Z",
      createdAt: "2026-11-28T08:00:00.000Z",
      sandbox: true,
    };
    const calls = mockApi({
      "GET /v1/me/stamps": () => ({ body: { data: [] } }),
      "GET /v1/gifts": () => ({ body: { data: [] } }),
      "POST /v1/gifts/claim": () => ({ body: { data: gift } }),
    });
    await renderScreen("Rewards", RewardsScreen as never, undefined, { session: testSession });
    const code = "x".repeat(32);
    fireEvent.changeText(await screen.findByTestId("gift-claim-code"), code);
    await waitFor(() =>
      expect(screen.getByTestId("gift-claim").props.accessibilityState?.disabled).toBeFalsy(),
    );
    fireEvent.press(screen.getByTestId("gift-claim"));
    expect(await screen.findByTestId("gift-claimed")).toHaveTextContent(
      "Latte is yours. Use it at checkout at that café.",
    );
    const claim = calls.find((c) => c.path === "/v1/gifts/claim");
    expect(claim?.body).toEqual({ token: code });
    expect(claim?.headers.get("idempotency-key")).toBeTruthy();
  });

  it("shows a one-time code to share after sending a gift", async () => {
    mockApi({
      "GET /v1/me/stamps": () => ({ body: { data: [] } }),
      "GET /v1/gifts": () => ({ body: { data: [] } }),
    });
    await renderScreen(
      "Rewards",
      RewardsScreen as never,
      { sentCode: "share-me-123" },
      {
        session: testSession,
      },
    );
    expect(await screen.findByTestId("gift-code")).toHaveTextContent("share-me-123");
  });
});
