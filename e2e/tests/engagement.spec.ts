import { expect, signIn, test } from "../fixtures";

const PORTAL = "http://localhost:3001";
const ADMIN = "http://localhost:3002";

/** Phase 9 (sandbox): loyalty, promotions with admin review, and dine-in table QR codes. */
test.describe("Loyalty, promotions and tables", () => {
  test("an owner's promotion goes live only after a marketing admin approves it", async ({
    browser,
  }) => {
    const code = `E2E${Date.now().toString().slice(-8)}`;
    const owner = await browser.newPage();
    await signIn(owner, `${PORTAL}/loyalty`, "owner-a@example.test", false);
    // Stamp card from the sandbox seed, editable by the owner.
    await expect(owner.getByTestId("terms-version")).toBeVisible();
    await owner.getByTestId("save-card").click();
    await expect(owner.getByText("Saved", { exact: true })).toBeVisible();

    await owner.getByTestId("tab-promotions").click();
    await owner.getByTestId("new-promotion").click();
    await owner.getByTestId("promo-code").fill(code);
    await owner.getByTestId("promo-name").fill("E2E launch week");
    await owner.getByTestId("promo-percent").fill("15");
    await owner.getByTestId("save-promotion").click();
    const row = owner.getByRole("row", { name: new RegExp(code) });
    await expect(row).toContainText("Draft");
    await row.click();
    await owner.getByTestId("promo-submit").click();
    await expect(row).toContainText("In review");
    await owner.close();

    // Operations can see the queue but only marketing decides.
    const marketing = await browser.newPage();
    await signIn(marketing, `${ADMIN}/promotions`, "marketing@example.test");
    await marketing.getByTestId(`approve-${code}`).click();
    await marketing.getByTestId("confirm-reason").fill("E2E: clear terms");
    await marketing.getByTestId("confirm-action").click();
    await marketing.getByTestId("promo-status").selectOption("approved");
    await expect(marketing.getByRole("row", { name: new RegExp(code) })).toContainText("Live");
    await marketing.getByTestId("tab-gifts").click();
    await expect(
      marketing.getByRole("table").or(marketing.getByText("No gifts yet")).first(),
    ).toBeVisible();
    await expect(marketing.locator(".banner-error")).toHaveCount(0);
    await marketing.close();

    const back = await browser.newPage();
    await signIn(back, `${PORTAL}/loyalty`, "owner-a@example.test", false);
    await back.getByTestId("tab-promotions").click();
    await expect(back.getByRole("row", { name: new RegExp(code) })).toContainText("Live");
    await back.close();
  });

  test("a manager adds a table, sees its QR code and replaces the code", async ({
    watched: page,
  }) => {
    const label = `E${Date.now().toString().slice(-6)}`;
    await signIn(page, `${PORTAL}/loyalty`, "manager-a@example.test", false);
    // Managers see tables only: no stamp card or promotions.
    await expect(page.getByTestId("tab-stamps")).toHaveCount(0);
    await page.getByTestId("table-label").fill(label);
    await page.getByTestId("add-table").click();
    const card = page.getByTestId(`table-${label}`);
    await expect(card.getByRole("img", { name: `QR code for table ${label}` })).toBeVisible();
    await expect(card).toContainText("Code version 1");
    await page.getByTestId(`rotate-${label}`).click();
    await page.getByTestId("confirm-action").click();
    await expect(card).toContainText("Code version 2");
    await page.getByTestId(`retire-${label}`).click();
    await page.getByTestId("confirm-action").click();
    await expect(card).toContainText("Removed");
  });
});
