import { test as base, expect, type Page } from "@playwright/test";

/** Fails a test on uncaught page errors and on unexpected API server errors (5xx). */
export const test = base.extend<{ watched: Page }>({
  watched: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("response", (r) => {
      if (r.url().includes(":3000") && r.status() >= 500) {
        problems.push(`API ${r.status()} ${r.request().method()} ${r.url()}`);
      }
    });
    await use(page);
    expect(problems, problems.join("\n")).toEqual([]);
  },
});
export { expect };

/** Development sign-in as a seeded account from the sign-in screen of any web surface. */
export async function signIn(page: Page, url: string, email: string, mfa = true) {
  await page.goto(url);
  const box = page.getByTestId("dev-mfa");
  if (mfa) await box.check();
  else await box.uncheck();
  await page.getByTestId(`dev-account-${email}`).click();
  await expect(
    page.getByTestId("signed-in-user").or(page.getByText("Two-step verification")),
  ).toBeVisible();
}
