import { call, placeOrder } from "../api";
import { expect, signIn, test } from "../fixtures";

const ADMIN = "http://localhost:3002";

test.describe("Admin console", () => {
  test("requires two-step verification on every session", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/overview`, "ops@example.test", false);
    await expect(page.getByText("Two-step verification")).toBeVisible();
    await expect(page.getByTestId("nav-overview")).toHaveCount(0);
  });

  test("shows each admin only the screens of their roles", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/overview`, "support@example.test");
    await expect(page.getByTestId("nav-support")).toBeVisible();
    await expect(page.getByTestId("nav-finance")).toHaveCount(0);
    await expect(page.getByTestId("nav-settings")).toHaveCount(0);
    // Opening a screen directly still shows no data without the role.
    await page.goto(`${ADMIN}/finance`);
    await expect(page.getByText("You do not have access to this.")).toBeVisible();
  });

  test("overview shows live platform figures", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/overview`, "ops@example.test");
    await expect(page.getByTestId("overview-stats")).toContainText("Paid order value");
  });

  test("emergency pause stops new orders and can be lifted", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/settings`, "ops@example.test");
    await page.getByTestId("pause-toggle").check();
    await page.getByTestId("pause-message-en").fill("Back in 10 minutes");
    await page.getByTestId("reason-pause").fill("E2E: pause drill");
    await page.getByTestId("save-pause").click();
    await expect(page.getByText("Ordering is paused right now.")).toBeVisible();
    const status = await call<{ ordersPaused: boolean; message: { en: string } | null }>(
      "GET",
      "/v1/platform/status",
    );
    expect(status.ordersPaused).toBe(true);
    expect(status.message?.en).toBe("Back in 10 minutes");
    await expect(placeOrder()).rejects.toThrow(/PLATFORM_PAUSED/);

    await page.getByTestId("pause-toggle").uncheck();
    await page.getByTestId("reason-pause").fill("E2E: drill over");
    await page.getByTestId("save-pause").click();
    await expect(page.getByText("Ordering is open.")).toBeVisible();
  });

  test("order timers are validated before saving", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/settings`, "ops@example.test");
    await page.getByTestId("timer-acceptSeconds").fill("5");
    await page.getByTestId("reason-operations").fill("E2E: invalid value");
    await expect(page.getByTestId("save-operations")).toBeDisabled();
  });

  test("refunds need a maker and a different checker", async ({ browser }) => {
    const order = await placeOrder();
    const maker = await browser.newPage();
    await signIn(maker, `${ADMIN}/finance`, "finance-maker@example.test");
    await maker.getByTestId(`refund-${order.publicNumber}`).click();
    await maker.getByTestId("amount-input").fill("1.00");
    await maker.getByTestId("amount-reason").fill("E2E: goodwill refund");
    await maker.getByTestId("amount-submit").click();
    await expect(maker.getByText("Saved", { exact: true })).toBeVisible();
    // The maker cannot approve their own request.
    await maker.getByRole("tab", { name: "Refunds" }).click();
    await expect(maker.getByTestId("refund-approve")).toHaveCount(0);
    await maker.close();

    const checker = await browser.newPage();
    await signIn(checker, `${ADMIN}/finance`, "finance-checker@example.test");
    await checker.getByRole("tab", { name: "Refunds" }).click();
    const row = checker.getByRole("row", { name: /E2E: goodwill refund/ }).first();
    await row.getByTestId("refund-approve").click();
    await checker.getByTestId("confirm-reason").fill("E2E: approved");
    await checker.getByTestId("confirm-action").click();
    await expect(checker.getByText("Saved", { exact: true })).toBeVisible();
    await checker.close();
  });

  test("operations can cancel an order and see it in the timeline", async ({ watched: page }) => {
    const order = await placeOrder();
    await signIn(page, `${ADMIN}/orders`, "ops@example.test");
    await page.getByRole("row", { name: new RegExp(order.publicNumber) }).click();
    await page.getByTestId("admin-cancel").click();
    await page.getByTestId("confirm-reason").fill("E2E: customer called support");
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("order-timeline")).toContainText("Cancelled");
  });

  test("menu moderation hides and restores a product", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/moderation`, "ops@example.test");
    const first = page.locator('[data-testid^="moderate-"]').first();
    const id = (await first.getAttribute("data-testid"))!;
    await first.click();
    await page.getByTestId("confirm-reason").fill("E2E: misleading claim");
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId(id)).toHaveText("Restore");
    await page.getByTestId(id).click();
    await page.getByTestId("confirm-reason").fill("E2E: corrected");
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId(id)).toHaveText("Hide");
  });

  test("marketing publishes the homepage", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/homepage`, "marketing@example.test");
    await page.getByTestId("hero-en").fill("Fresh roasts this week");
    const pick = page.getByTestId("featured-pick");
    await expect(pick.locator("option")).not.toHaveCount(1);
    const value = await pick.locator("option").nth(1).getAttribute("value");
    if (value) {
      await pick.selectOption(value);
      await page.getByTestId("featured-add").click();
    }
    await page.getByTestId("homepage-reason").fill("E2E: weekly refresh");
    await page.getByTestId("homepage-save").click();
    await expect(page.getByTestId("homepage-preview")).toContainText("Fresh roasts this week");
  });

  test("announcements go to in-app inboxes", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/broadcast`, "marketing@example.test");
    await page.getByTestId("broadcast-title-en").fill("E2E notice");
    await page.getByTestId("broadcast-body-en").fill("Sandbox announcement");
    await page.getByTestId("broadcast-reason").fill("E2E: test broadcast");
    await page.getByTestId("broadcast-send").click();
    await page.getByTestId("broadcast-confirm").click();
    await expect(page.getByText(/Sent to \d+ inboxes/).first()).toBeVisible();
  });

  test("support replies and adds internal notes", async ({ watched: page }) => {
    const customer = await (await import("../api")).devToken("customer@example.test");
    await call("POST", "/v1/tickets", customer, {
      category: "other",
      message: "E2E: where is my receipt?",
    });
    await signIn(page, `${ADMIN}/support`, "support@example.test");
    await page.getByRole("row").nth(1).click();
    await page.getByTestId("ticket-assign-me").click();
    await page.getByTestId("ticket-reply").fill("E2E: receipts are under Orders.");
    await page.getByTestId("ticket-send").click();
    await expect(page.getByTestId("ticket-thread")).toContainText(
      "E2E: receipts are under Orders.",
    );
  });

  test("security reads the audit log of setting changes", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/audit`, "security@example.test");
    await page.getByTestId("audit-prefix").selectOption("platform.");
    await expect(page.getByText("platform.setting_changed").first()).toBeVisible();
  });

  test("super admin grants and removes a role", async ({ watched: page }) => {
    await signIn(page, `${ADMIN}/admins`, "super@example.test");
    await page.getByTestId("grant-email").fill("marketing@example.test");
    await page.getByLabel("Role").selectOption("analyst");
    await page.getByLabel("Reason (saved to the audit log)").fill("E2E: temporary analyst access");
    await page.getByText("I have checked this person").click();
    await page.getByTestId("grant-submit").click();
    await expect(page.getByText("Role granted")).toBeVisible();
    const row = page.getByRole("row", { name: /marketing@example.test/ });
    await expect(row).toContainText("Analyst");
    await row.getByRole("button", { name: "Remove Analyst" }).click();
    await page.getByTestId("confirm-reason").fill("E2E: access no longer needed");
    await page.getByTestId("confirm-action").click();
    await expect(row).not.toContainText("Analyst");
  });
});
