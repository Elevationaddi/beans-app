import { devices, type Page } from "@playwright/test";
import { BRANCH, call, devToken } from "../api";
import { expect, test } from "../fixtures";

const APP = "http://localhost:8081";

// The Expo customer app, exported for the web, on a phone-sized screen.
test.use({ ...devices["Pixel 7"] });

type CustomerOrder = { id: string; status: string };
type MerchantOrder = { version: number };

/** The café takes one step on the customer's newest order (barista account, through the API). */
async function cafeStep(orderId: string, body: Record<string, unknown>) {
  const barista = await devToken("barista-a@example.test");
  const current = await call<MerchantOrder>("GET", `/v1/merchant/orders/${orderId}`, barista);
  await call("POST", `/v1/merchant/orders/${orderId}/transition`, barista, {
    ...body,
    expectedVersion: current.version,
  });
}

async function chooseFirstProduct(page: Page) {
  await page.getByText(BRANCH).first().click();
  await page.locator('[data-testid^="product-"]').first().click();
  const add = page.getByTestId("add-to-cart");
  await expect(add).toBeVisible();
  // Pick options until every required group has one (the button enables itself).
  const radios = page.getByRole("radio");
  for (let i = 0; i < (await radios.count()); i++) {
    if ((await add.getAttribute("aria-disabled")) !== "true") break;
    await radios.nth(i).click();
  }
  await add.click();
}

/** Asks for a quote: as soon as possible, or the next slot with room when that time is full. */
async function getQuote(page: Page) {
  const review = page.getByTestId("review");
  await expect(review).not.toHaveAttribute("aria-disabled", "true");
  await review.click();
  const quote = page.getByTestId("quote");
  const full = page.getByText("fully booked", { exact: false });
  await expect(quote.or(full).first()).toBeVisible();
  const slots = page.getByRole("radio", { name: /^\d\d:\d\d$/ });
  for (let i = 0; i < (await slots.count()) && !(await quote.isVisible()); i++) {
    await slots.nth(i).click();
    await review.click();
    await expect(quote.or(full).first()).toBeVisible();
  }
  await expect(quote).toContainText("Sandbox payment");
}

test.describe("Customer app", () => {
  test("browses as a guest, signs in, survives a declined payment, pays and tracks to collection", async ({
    watched: page,
  }) => {
    await page.goto(APP);
    await page.getByTestId("city-abu_dhabi").click();
    await page.getByTestId("continue-guest").click();
    await expect(page.getByTestId("home")).toBeVisible();

    await chooseFirstProduct(page);
    await page.getByTestId("view-cart").click();
    // Guests can build a cart but must sign in to check out.
    await page.getByTestId("checkout-sign-in").click();
    await page.getByTestId("dev-account-customer@example.test").click();
    await page.getByTestId("checkout").click();

    await getQuote(page);

    // A declined sandbox payment keeps the customer on checkout and they can try again.
    await page.getByTestId("pay-decline").click();
    await expect(page.getByTestId("declined")).toBeVisible();
    await getQuote(page);
    await page.getByTestId("pay").click();
    await expect(page.getByTestId("order-status-text")).toHaveText(
      "Waiting for the café to accept your order.",
    );

    const customer = await devToken("customer@example.test");
    const mine = await call<CustomerOrder[]>("GET", "/v1/orders?limit=5", customer);
    const order = mine.find((o) => o.status === "received");
    expect(order).toBeTruthy();
    await cafeStep(order!.id, { action: "accept", etaMinutes: 5 });
    await cafeStep(order!.id, { action: "start" });
    await cafeStep(order!.id, { action: "ready" });

    // Live updates: the screen polls the order while it is open.
    await expect(page.getByTestId("order-status-text")).toHaveText(
      "Your order is ready to collect.",
      { timeout: 15_000 },
    );
    const codeText = await page.getByTestId("pickup-code").innerText();
    const code = codeText.match(/\d[\d ]+\d/)![0].replace(/ /g, "");
    await cafeStep(order!.id, { action: "complete", pickupCode: code });
    await expect(page.getByTestId("order-status-text")).toHaveText("Enjoy your coffee.", {
      timeout: 15_000,
    });

    await page.getByText("Receipt", { exact: true }).click();
    await expect(
      page.getByText("Sandbox receipt: no real money was charged.", { exact: false }),
    ).toBeVisible();
  });

  test("orders to a table from its QR link with a promo code (sandbox phase 9)", async ({
    watched: page,
  }) => {
    // The printed QR code holds a link with the signed table token (as the portal shows it).
    const manager = await devToken("manager-a@example.test");
    const branches = await call<{ id: string; names: { en: string } }[]>(
      "GET",
      "/v1/branches?limit=50",
    );
    const branch = branches.find((b) => b.names.en === BRANCH)!;
    const tables = await call<{ label: string; token: string | null }[]>(
      "GET",
      `/v1/merchant/branches/${branch.id}/tables`,
      manager,
    );
    const table = tables.find((t) => t.label === "T1" && t.token)!;

    await page.goto(`${APP}/?table=${encodeURIComponent(table.token!)}`);
    await page.getByTestId("city-abu_dhabi").click();
    await page.getByTestId("continue-guest").click();
    await expect(page.getByTestId("table-found")).toContainText("Table T1");
    await page.getByTestId("table-order").click();

    await page.locator('[data-testid^="product-"]').first().click();
    const add = page.getByTestId("add-to-cart");
    await expect(add).toBeVisible();
    const radios = page.getByRole("radio");
    for (let i = 0; i < (await radios.count()); i++) {
      if ((await add.getAttribute("aria-disabled")) !== "true") break;
      await radios.nth(i).click();
    }
    await add.click();
    await page.getByTestId("view-cart").click();
    await page.getByTestId("checkout-sign-in").click();
    await page.getByTestId("dev-account-customer@example.test").click();
    await page.getByTestId("checkout").click();

    await expect(page.getByTestId("checkout-table")).toHaveText("To table T1");
    await page.getByTestId("promo-code").fill("SANDBOX10");
    await page.getByTestId("apply-promo").click();
    await getQuote(page);
    await expect(page.getByTestId("quote-discount")).toContainText("Code SANDBOX10");
    await expect(page.getByTestId("quote")).toContainText("To table T1");
    await page.getByTestId("pay").click();
    await expect(page.getByTestId("order-status-text")).toHaveText(
      "Waiting for the café to accept your order.",
    );

    // The café sees the table and the discount on the ticket.
    const customer = await devToken("customer@example.test");
    const mine = await call<CustomerOrder[]>("GET", "/v1/orders?limit=5", customer);
    const order = mine.find((o) => o.status === "received")!;
    const ticket = await call<{
      table: { label: string } | null;
      benefit: { kind: string } | null;
    }>("GET", `/v1/merchant/orders/${order.id}`, await devToken("barista-a@example.test"));
    expect(ticket.table?.label).toBe("T1");
    expect(ticket.benefit?.kind).toBe("promotion");
  });

  test("shows Arabic right to left", async ({ watched: page }) => {
    await page.goto(APP);
    await page.getByRole("radio", { name: "العربية" }).click();
    await expect(page.getByTestId("app-root")).toHaveCSS("direction", "rtl");
    await expect(page.getByRole("heading", { name: "أهلاً بك" }).first()).toBeVisible();
  });
});
