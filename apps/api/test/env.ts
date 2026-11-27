import { loadEnv, type Env } from "../src/config/env.js";

/** Test configuration. Points at the local Docker Compose services unless overridden. */
export function testEnv(overrides: NodeJS.ProcessEnv = {}): Env {
  return loadEnv({
    DATABASE_URL: "postgresql://beans:beans@localhost:5432/beans_test",
    REDIS_URL: "redis://localhost:6379",
    ...process.env,
    NODE_ENV: "test",
    ...overrides,
  });
}
