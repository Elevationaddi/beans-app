import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "./env.js";

/** Obviously fake keys, assembled at runtime so secret scanners do not flag the test. */
const fakeTapKey = (mode: "test" | "live") => ["sk", mode, "notarealkey"].join("_");

const base = {
  DATABASE_URL: "postgresql://user:secret-password@localhost:5432/beans",
};

function issuesFor(source: NodeJS.ProcessEnv): string[] {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.issues;
    throw error;
  }
  throw new Error("expected loadEnv to throw");
}

describe("loadEnv", () => {
  it("applies safe development defaults", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      PAYMENT_PROVIDER: "fake",
      LIVE_PAYMENTS_ENABLED: false,
      CORS_ORIGINS: [],
    });
  });

  it("accepts Tap only with a test key, a return URL and a public API URL", () => {
    const tap = {
      ...base,
      PAYMENT_PROVIDER: "tap",
      TAP_SECRET_KEY: fakeTapKey("test"),
      TAP_RETURN_URL: "https://app.example.test/paid",
      API_PUBLIC_URL: "https://api.example.test",
    };
    expect(loadEnv(tap).PAYMENT_PROVIDER).toBe("tap");
    expect(issuesFor({ ...tap, TAP_SECRET_KEY: fakeTapKey("live") }).join(" ")).toMatch(
      /TAP_SECRET_KEY/,
    );
    expect(issuesFor({ ...tap, TAP_RETURN_URL: "" }).join(" ")).toMatch(/TAP_RETURN_URL/);
    expect(issuesFor({ ...tap, API_PUBLIC_URL: "" }).join(" ")).toMatch(/API_PUBLIC_URL/);
  });

  it("treats empty optional values as unset", () => {
    const env = loadEnv({ ...base, SUPABASE_URL: "", SUPABASE_JWKS_URL: "", PORT: "" });
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.PORT).toBe(3000);
  });

  it("parses a comma-separated CORS allowlist", () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: "http://localhost:3001, http://localhost:3002" });
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3001", "http://localhost:3002"]);
  });

  it("requires the database URL and no longer needs Redis", () => {
    const issues = issuesFor({});
    expect(issues.some((issue) => issue.startsWith("DATABASE_URL"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("REDIS_URL"))).toBe(false);
  });

  it("needs Supabase settings for shared live updates and a cron secret in production", () => {
    expect(issuesFor({ ...base, REALTIME_DRIVER: "supabase" }).sort()).toEqual([
      "REALTIME_CHANNEL_SECRET: required with REALTIME_DRIVER=supabase",
      "SUPABASE_SERVICE_ROLE_KEY: required with REALTIME_DRIVER=supabase",
      "SUPABASE_URL: required with REALTIME_DRIVER=supabase",
    ]);
    const prod = issuesFor({ ...base, NODE_ENV: "production" }).join("\n");
    expect(prod).toMatch(/CRON_SECRET: required in production/);
    expect(prod).toMatch(/REALTIME_DRIVER: in-process live updates/);
  });

  it("needs the Supabase URL and server key for the Storage driver, and checks the bucket name", () => {
    expect(issuesFor({ ...base, STORAGE_DRIVER: "supabase" }).sort()).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY: required with STORAGE_DRIVER=supabase",
      "SUPABASE_URL: required with STORAGE_DRIVER=supabase",
    ]);
    expect(issuesFor({ ...base, SUPABASE_STORAGE_BUCKET: "../Public" })).toEqual([
      "SUPABASE_STORAGE_BUCKET: lowercase letters, digits and dashes",
    ]);
    // A real storage driver alone is not enough for production: the file check still blocks it.
    const prod = issuesFor({ ...base, NODE_ENV: "production", STORAGE_DRIVER: "supabase" });
    expect(prod.join("\n")).not.toMatch(/^STORAGE_DRIVER:/m);
    expect(prod.join("\n")).toMatch(/FILE_SCANNER: the basic file checker cannot run/);
    // With uploads switched off (no scanner approved) the file check no longer blocks start-up.
    const off = issuesFor({ ...base, NODE_ENV: "production", FILE_SCANNER: "disabled" });
    expect(off.join("\n")).not.toMatch(/^FILE_SCANNER:/m);
  });

  it("rejects a non-postgres database URL", () => {
    expect(issuesFor({ ...base, DATABASE_URL: "mysql://localhost/beans" })).toEqual([
      "DATABASE_URL: must be a postgres:// URL",
    ]);
  });

  it("refuses every development-only adapter in production", () => {
    const issues = issuesFor({
      ...base,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://merchant.example.com",
      SUPABASE_JWKS_URL: "https://auth.example.com/auth/v1/.well-known/jwks.json",
      SUPABASE_JWT_ISSUER: "https://auth.example.com/auth/v1",
      API_PUBLIC_URL: "https://api.example.com",
      FILE_SIGNING_SECRET: "x".repeat(40),
      PAYMENT_WEBHOOK_SECRET: "y".repeat(40),
      PICKUP_CODE_SECRET: "p".repeat(40),
      TABLE_TOKEN_SECRET: "t".repeat(40),
      CRON_SECRET: "c".repeat(40),
      REALTIME_DRIVER: "supabase",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-tests",
      REALTIME_CHANNEL_SECRET: "r".repeat(40),
    });
    expect(issues.sort()).toEqual([
      "FILE_SCANNER: the basic file checker cannot run with NODE_ENV=production",
      "PAYMENT_PROVIDER: the fake payment provider cannot run with NODE_ENV=production",
      "STORAGE_DRIVER: local file storage cannot run with NODE_ENV=production",
    ]);
  });

  it("refuses switching rate limits off in production", () => {
    const issues = issuesFor({ ...base, NODE_ENV: "production", RATE_LIMIT_ENABLED: "false" });
    expect(issues).toContain(
      "RATE_LIMIT_ENABLED: rate limits cannot be switched off with NODE_ENV=production",
    );
  });

  it("requires token verification settings in production", () => {
    const issues = issuesFor({ ...base, NODE_ENV: "production" });
    expect(issues).toContain("SUPABASE_JWKS_URL: required in production");
    expect(issues).toContain("SUPABASE_JWT_ISSUER: required in production");
    expect(issues).toContain("PAYMENT_WEBHOOK_SECRET: required in production");
    expect(issues).toContain("PICKUP_CODE_SECRET: required in production");
    expect(issues).toContain("TABLE_TOKEN_SECRET: required in production");
  });

  it("requires a CORS allowlist in production", () => {
    const issues = issuesFor({ ...base, NODE_ENV: "production" });
    expect(issues).toContain("CORS_ORIGINS: an explicit CORS allowlist is required in production");
  });

  it("blocks live payments until the money decisions are approved", () => {
    expect(issuesFor({ ...base, LIVE_PAYMENTS_ENABLED: "true" })).toEqual([
      "LIVE_PAYMENTS_ENABLED: live payments are blocked until decisions D02-D08 are approved",
    ]);
  });

  it("never echoes variable values in error messages", () => {
    const issues = issuesFor({ ...base, SUPABASE_URL: "not a url with secret-token" });
    expect(issues.join("\n")).not.toContain("secret-token");
    expect(issues.join("\n")).not.toContain("secret-password");
  });
});
