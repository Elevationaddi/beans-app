import { createServer } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testEnv } from "./env.js";

const CRON_SECRET = "v".repeat(48);

/**
 * The Vercel function entry point (src/serverless.ts, loaded by api/index.mjs) serves the real
 * application through a plain Node request handler, as Vercel calls it: no listening port, the
 * app built once and reused across requests.
 */
describe("Vercel function entry point", () => {
  const saved = { ...process.env };

  beforeAll(() => {
    const env = testEnv();
    Object.assign(process.env, {
      DATABASE_URL: env.DATABASE_URL,
      NODE_ENV: "test",
      CRON_SECRET,
      OUTBOX_RELAY_ENABLED: "false",
      CHECKOUT_SWEEP_ENABLED: "false",
      DATABASE_POOL_MAX: "2",
    });
  });

  afterAll(() => {
    process.env = saved;
  });

  it("answers health, routes and the cron tick through one cached app", async () => {
    const { default: handler } = await import("../src/serverless.js");
    const server = createServer((req, res) => void handler(req, res));
    const health = await request(server).get("/health").expect(200);
    expect(health.body.checks).toEqual({ database: "up" });
    await request(server).get("/v1/platform/status").expect(200);
    await request(server).get("/v1/no-such-route").expect(404);
    await request(server)
      .get("/v1/internal/cron/tick")
      .set("Authorization", `Bearer ${CRON_SECRET}`)
      .expect(200);
    // Security headers and request IDs survive the serverless path.
    expect(health.headers["x-request-id"]).toBeTruthy();
  });

  it("answers 503 with no detail when the configuration is invalid", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "not-a-url-secret-value";
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => void errors.push(m));
    try {
      const { default: handler } = await import("../src/serverless.js");
      const server = createServer((req, res) => void handler(req, res));
      const response = await request(server).get("/health").expect(503);
      expect(JSON.stringify(response.body)).not.toContain("secret-value");
      expect(errors.join("\n")).toContain("DATABASE_URL");
      expect(errors.join("\n")).not.toContain("secret-value");
    } finally {
      spy.mockRestore();
      process.env.DATABASE_URL = before;
    }
  });
});
