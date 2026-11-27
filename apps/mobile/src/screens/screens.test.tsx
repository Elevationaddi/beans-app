import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as Location from "expo-location";
import type { TestInstance } from "test-renderer";
import { guestPrefs, mockApi, renderApp, renderScreen } from "../test-utils";
import { CartScreen } from "./CartScreen";
import { BRANCH_A, BRANCH_B, branchHandlers, card, LARGE, LATTE, SMALL } from "./fixtures";
import { ProductScreen } from "./ProductScreen";

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

/** Every pressable has a role and an accessible name (accessibility smoke test). */
function expectAccessiblePressables(root: TestInstance | null) {
  if (!root) throw new Error("nothing rendered");
  const pressables = root.queryAll((node) => typeof node.props["onClick"] === "function");
  expect(pressables.length).toBeGreaterThan(0);
  for (const node of pressables) {
    // React Navigation sets the newer `role` prop; our controls set accessibilityRole.
    const role = String(node.props["accessibilityRole"] ?? node.props["role"] ?? "");
    expect(role).toMatch(/^(button|checkbox|radio|switch|tab|link)$/);
    expect(String(node.props["accessibilityLabel"] ?? "").trim()).not.toBe("");
  }
  for (const input of root.queryAll((node) => node.type === "TextInput")) {
    expect(String(input.props["accessibilityLabel"] ?? "").trim()).not.toBe("");
  }
}

describe("Q01: guest declines location", () => {
  it("chooses an emirate manually and browses cafés without location", async () => {
    const calls = mockApi({
      "GET /v1/branches": (req) => ({
        body: {
          data: [card(BRANCH_A, { city: (req.query.get("city") ?? "abu_dhabi") as "dubai" })],
          meta: { nextCursor: null },
        },
      }),
    });
    await renderApp({ ...guestPrefs, onboarded: false });

    await fireEvent.press(screen.getByTestId("use-location"));
    expect(
      await screen.findByText("Location not shared. Choose your emirate instead."),
    ).toBeTruthy();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("city-dubai"));
    await fireEvent.press(screen.getByTestId("continue-guest"));

    expect(await screen.findByText("Cafés in Dubai")).toBeTruthy();
    expect(await screen.findByText("Test Roasters")).toBeTruthy();
    const search = calls.find((c) => c.path === "/v1/branches");
    expect(search?.query.get("city")).toBe("dubai");
    expect(search?.query.has("lat")).toBe(false);
    expect(search?.query.has("lng")).toBe(false);
  });

  it("shows an error with retry, then the results", async () => {
    let fail = true;
    mockApi({
      "GET /v1/branches": () =>
        fail
          ? {
              status: 503,
              body: { error: { code: "SERVICE_UNAVAILABLE", message: "down", requestId: "r" } },
            }
          : { body: { data: [card(BRANCH_A)], meta: { nextCursor: null } } },
    });
    await renderApp(guestPrefs);
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Test Roasters")).toBeTruthy();
  });
});

describe("Q02 (app side): required options and server price", () => {
  it("blocks adding until the required option is chosen and shows the server's price", async () => {
    const calls = mockApi(branchHandlers(BRANCH_A));
    await renderScreen("Product", ProductScreen as never, { branchId: BRANCH_A, productId: LATTE });

    const add = await screen.findByTestId("add-to-cart");
    expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText("Choose an option for Size")).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith("/items/price"))).toBe(false);

    await fireEvent.press(screen.getByTestId(`option-${LARGE}`));
    await fireEvent.press(screen.getByTestId("qty-increase"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to cart · AED 40.00" })).toBeTruthy(),
    );

    const priceCall = calls.filter((c) => c.path.endsWith("/items/price")).at(-1);
    // The app sends choices only; the server decides the price.
    expect(priceCall?.body).toEqual({ productId: LATTE, optionIds: [LARGE], quantity: 2 });
  });
});

describe("Q03: switching branch with a cart", () => {
  it("asks before replacing the cart, and cancelling keeps it", async () => {
    mockApi(branchHandlers(BRANCH_B));
    await renderScreen(
      "Product",
      ProductScreen as never,
      { branchId: BRANCH_B, productId: LATTE },
      { cart: cartAtA },
    );

    await fireEvent.press(await screen.findByTestId(`option-${SMALL}`));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to cart · AED 17.00" })).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("add-to-cart"));

    expect(await screen.findByText("Start a new cart?")).toBeTruthy();
    expect(screen.getByText(/Your cart has items from Test Roasters · Branch 1/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(screen.queryByText("Start a new cart?")).toBeNull());
  });
});

describe("guest cannot check out", () => {
  it("shows the cart with server prices but no checkout action for guests", async () => {
    await renderScreen("Cart", CartScreen as never, undefined, { cart: cartAtA });
    expect(screen.getByText("2 × Latte")).toBeTruthy();
    expect(screen.getByText("Subtotal: AED 34.00")).toBeTruthy();
    expect(screen.getByTestId("checkout-sign-in")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /checkout/i })).toBeNull();
  });
});

describe("accessibility smoke tests", () => {
  it("labels every control on home, product and cart screens", async () => {
    mockApi({
      "GET /v1/branches": () => ({ body: { data: [card(BRANCH_A)], meta: { nextCursor: null } } }),
      ...branchHandlers(BRANCH_A),
    });
    const home = await renderApp(guestPrefs);
    await screen.findByText("Test Roasters");
    expectAccessiblePressables(home.root);
    await home.unmount();

    const product = await renderScreen("Product", ProductScreen as never, {
      branchId: BRANCH_A,
      productId: LATTE,
    });
    await screen.findByTestId("add-to-cart");
    expectAccessiblePressables(product.root);
    expect(screen.getAllByRole("header").length).toBeGreaterThan(0);
    await product.unmount();

    const cart = await renderScreen("Cart", CartScreen as never, undefined, { cart: cartAtA });
    expectAccessiblePressables(cart.root);
  });

  it("lays out right-to-left in Arabic and flags the draft translation", async () => {
    mockApi({
      "GET /v1/branches": () => ({ body: { data: [card(BRANCH_A)], meta: { nextCursor: null } } }),
    });
    await renderApp({ ...guestPrefs, locale: "ar" });
    expect(screen.getByTestId("app-root").props.style).toMatchObject({ direction: "rtl" });
    expect(await screen.findByText("مقاهٍ في أبوظبي")).toBeTruthy();
    expect(
      screen.getAllByText("النص العربي مسودة بانتظار مراجعة متحدث أصلي.").length,
    ).toBeGreaterThan(0);
  });
});
