import { loadEnv, type Env } from "../src/config/env.js";

export const TEST_ISSUER = "https://auth.test.invalid/auth/v1";

/** Test configuration. Points at the local Docker Compose services unless overridden. */
export function testEnv(overrides: NodeJS.ProcessEnv = {}): Env {
  return loadEnv({
    DATABASE_URL: "postgresql://beans:beans@localhost:5432/beans_test",
    REDIS_URL: "redis://localhost:6379",
    ...process.env,
    NODE_ENV: "test",
    SUPABASE_JWT_ISSUER: TEST_ISSUER,
    SUPABASE_JWKS_URL: "https://auth.test.invalid/auth/v1/.well-known/jwks.json",
    OUTBOX_RELAY_ENABLED: "false",
    OUTBOX_WORKER_ENABLED: "false",
    CHECKOUT_SWEEP_ENABLED: "false",
    RATE_LIMIT_ENABLED: "false",
    STORAGE_LOCAL_DIR: ".storage-test",
    ...overrides,
  });
}
