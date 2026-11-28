import { expect, signIn, test } from "../fixtures";

const PORTAL = "http://localhost:3001";

test.describe("Business portal", () => {
  test("owner can open every portal screen", async ({ watched: page }) => {
    await signIn(page, `${PORTAL}/dashboard`, "owner-a@example.test", false);
    for (const screen of [
      "dashboard",
      "orders",
      "branches",
      "menu",
      "availability",
      "staff",
      "finance",
      "analytics",
      "support",
      "settings",
    ]) {
      await page.getByTestId(`nav-${screen}`).click();
      await expect(page).toHaveURL(new RegExp(`/${screen}`));
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator(".banner-error")).toHaveCount(0);
    }
  });

  test("a manager runs the branch but not staff or finance", async ({ watched: page }) => {
    await signIn(page, `${PORTAL}/dashboard`, "manager-a@example.test", false);
    await expect(page.getByTestId("nav-orders")).toBeVisible();
    await expect(page.getByTestId("nav-staff")).toHaveCount(0);
    await expect(page.getByTestId("nav-finance")).toHaveCount(0);
  });

  test("switches to Arabic with right-to-left layout", async ({ watched: page }) => {
    await signIn(page, `${PORTAL}/dashboard`, "owner-a@example.test", false);
    await page.getByRole("button", { name: "العربية" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });
});
