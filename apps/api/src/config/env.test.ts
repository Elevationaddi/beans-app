import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://user:secret-password@localhost:5432/beans",
  REDIS_URL: "redis://localhost:6379",
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

  it("treats empty optional values as unset", () => {
    const env = loadEnv({ ...base, SUPABASE_URL: "", SUPABASE_JWKS_URL: "", PORT: "" });
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.PORT).toBe(3000);
  });

  it("parses a comma-separated CORS allowlist", () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: "http://localhost:3001, http://localhost:3002" });
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3001", "http://localhost:3002"]);
  });

  it("requires the database and Redis URLs", () => {
    const issues = issuesFor({});
    expect(issues.some((issue) => issue.startsWith("DATABASE_URL"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("REDIS_URL"))).toBe(true);
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
    });
    expect(issues.sort()).toEqual([
      "FILE_SCANNER: the basic file checker cannot run with NODE_ENV=production",
      "PAYMENT_PROVIDER: the fake payment provider cannot run with NODE_ENV=production",
      "STORAGE_DRIVER: local file storage cannot run with NODE_ENV=production",
    ]);
  });

  it("requires token verification settings in production", () => {
    const issues = issuesFor({ ...base, NODE_ENV: "production" });
    expect(issues).toContain("SUPABASE_JWKS_URL: required in production");
    expect(issues).toContain("SUPABASE_JWT_ISSUER: required in production");
    expect(issues).toContain("PAYMENT_WEBHOOK_SECRET: required in production");
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
    const issues = issuesFor({ ...base, REDIS_URL: "not a url with secret-token" });
    expect(issues.join("\n")).not.toContain("secret-token");
    expect(issues.join("\n")).not.toContain("secret-password");
  });
});
