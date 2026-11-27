// Writes openapi.json from the route registry, then generates TypeScript types for clients.
// Usage: pnpm --filter @beans/contracts openapi
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildOpenApiDocument } from "../src/openapi.js";

const document = buildOpenApiDocument("0.2.0");
writeFileSync("openapi.json", `${JSON.stringify(document, null, 2)}\n`);
execFileSync("openapi-typescript", ["openapi.json", "-o", "src/generated/openapi.ts"], {
  stdio: "inherit",
});
