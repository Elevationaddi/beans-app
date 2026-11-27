import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma does not load .env files itself; load the local one when present.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Read lazily so `prisma generate` works without a database (for example in CI lint jobs).
    url: process.env.DATABASE_URL ?? "",
  },
});
