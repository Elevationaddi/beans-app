/**
 * Release gate: refuses migrations that destroy or rewrite data without a named approval
 * (see src/release/migration-guard.ts and docs/15-release-plan.md). Runs in CI and before
 * every staging or production migration. Usage: pnpm --filter @beans/api db:check-migrations
 */
import { fileURLToPath } from "node:url";
import { blocking, scanMigrationsDir } from "../src/release/migration-guard.js";

const dir = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
const reports = scanMigrationsDir(dir);
for (const report of reports) {
  const state =
    report.findings.length === 0 ? "additive" : report.approved ? "approved" : "BLOCKED";
  console.log(`${state.padEnd(9)} ${report.name}${report.approval ? ` (${report.approval})` : ""}`);
  for (const f of report.findings)
    console.log(`          line ${f.line} ${f.rule}: ${f.statement}`);
}
const blocked = blocking(reports);
if (blocked.length > 0) {
  console.error(
    `\n${blocked.length} migration(s) change or destroy data without "-- release: destructive-approved <who and why>".`,
  );
  process.exit(1);
}
console.log(`\nOK: ${reports.length} migrations checked, none destructive without approval.`);
