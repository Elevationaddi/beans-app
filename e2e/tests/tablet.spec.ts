import { placeOrder, BRANCH } from "../api";
import { expect, signIn, test } from "../fixtures";

const TABLET = "http://localhost:3001/tablet";

test.describe("Barista tablet", () => {
  test("takes an order from new to collected with the pickup code", async ({ watched: page }) => {
    await signIn(page, TABLET, "barista-a@example.test", false);
    await page.getByTestId(`tablet-branch-${BRANCH}`).click();
    const order = await placeOrder("in_store");
    const card = page.getByTestId(`order-${order.publicNumber}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("accept").click();
    await page.getByTestId("confirm-accept").click();
    await page.getByRole("tab", { name: /Preparing/ }).click();
    await card.getByTestId("start").click();
    await card.getByTestId("ready").click();
    await page.getByRole("tab", { name: /Ready/ }).click();
    await card.getByTestId("complete").click();
    // A wrong code is refused; the right one completes the handoff.
    await page.getByTestId("pickup-code").fill("000000");
    await page.getByTestId("confirm-complete").click();
    await expect(page.getByTestId("pickup-code")).toBeVisible();
    await page.getByTestId("pickup-code").fill(order.pickupCode ?? "");
    await page.getByTestId("confirm-complete").click();
    await page.getByRole("tab", { name: /Completed/ }).click();
    await expect(page.getByText(`#${order.publicNumber}`)).toBeVisible();
  });

  test("reports a branch issue and toggles an item sold out", async ({ watched: page }) => {
    await signIn(page, TABLET, "barista-a@example.test", false);
    await page.getByTestId(`tablet-branch-${BRANCH}`).click();
    await page.getByRole("tab", { name: /Issues/ }).click();
    await page.getByTestId("issue-message").fill("E2E: milk fridge is warm");
    await page.getByTestId("issue-send").click();
    await expect(page.getByText("Report sent")).toBeVisible();
    const toggle = page.locator('[data-testid^="soldout-"]').first();
    await toggle.click();
    await expect(page.getByText(/Marked sold out|Available again/).first()).toBeVisible();
    await toggle.click();
  });
});
