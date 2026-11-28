import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the customer app (web build), business portal, barista tablet and admin
 * console against the real
 * API, PostgreSQL and Redis with seeded fictional data. Development sign-in only (never in
 * production). Servers are started here unless already running locally.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "report" }]]
    : [["list"]],
  outputDir: "results",
  globalSetup: "./global-setup.ts",
  use: {
    trace: "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 860 },
  },
  webServer: [
    {
      command: "node --env-file-if-exists=.env dist/main.js",
      cwd: "../apps/api",
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm start",
      cwd: "../apps/merchant",
      url: "http://localhost:3001/dashboard",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm start",
      cwd: "../apps/admin",
      url: "http://localhost:3002/overview",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The Expo app exported for the web (pnpm --filter @beans/mobile export:web).
      command: "node static-server.mjs",
      url: "http://localhost:8081",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
