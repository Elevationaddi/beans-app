import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blocking, scanMigration, scanMigrationsDir } from "./migration-guard.js";

const rules = (sql: string) => scanMigration("m", sql).findings.map((f) => f.rule);

describe("migration guard", () => {
  it("passes additive migrations", () => {
    expect(
      rules(`CREATE TABLE "t" ("id" UUID PRIMARY KEY);
ALTER TABLE "t" ADD COLUMN "name" TEXT;
CREATE UNIQUE INDEX "t_name" ON "t" ("name");
UPDATE "t" SET "name" = 'x' WHERE "name" IS NULL;`),
    ).toEqual([]);
  });

  it("flags statements that destroy or rewrite data", () => {
    expect(
      rules(`DROP TABLE "orders";
ALTER TABLE "payments" DROP COLUMN "amount_fils";
ALTER TABLE "payments" ALTER COLUMN "amount_fils" TYPE NUMERIC;
TRUNCATE "journal_lines";
DELETE FROM "refunds";
UPDATE "orders" SET "status" = 'cancelled';
ALTER TABLE "orders" RENAME COLUMN "a" TO "b";
ALTER TABLE "journal_lines" DISABLE TRIGGER ALL;
DROP TRIGGER "journal_balanced" ON "journal_lines";`),
    ).toEqual([
      "drop-table",
      "drop-column",
      "alter-column-type",
      "truncate",
      "delete",
      "update-without-where",
      "rename",
      "disable-trigger",
      "drop-trigger",
    ]);
  });

  it("ignores comments, strings, function bodies and trigger clauses", () => {
    expect(
      rules(`-- DROP TABLE "orders";
/* TRUNCATE "x"; */
CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN DELETE FROM "x"; RETURN NULL; END $$ LANGUAGE plpgsql;
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON "journal_lines" FOR EACH STATEMENT EXECUTE FUNCTION f();
INSERT INTO "notes" ("body") VALUES ('DROP TABLE x; DELETE FROM y');`),
    ).toEqual([]);
  });

  it("reports the line of each finding", () => {
    const report = scanMigration("m", `CREATE TABLE "a" ("id" INT);\n\nDROP TABLE "b";`);
    expect(report.findings).toEqual([{ rule: "drop-table", line: 3, statement: 'DROP TABLE "b"' }]);
  });

  it("lets a named approval through, and only then", () => {
    const sql = `DROP TABLE "legacy";`;
    expect(blocking([scanMigration("m", sql)])).toHaveLength(1);
    const approved = scanMigration(
      "m",
      `-- release: destructive-approved Finance lead 2026-12-01, table unused since v0.7\n${sql}`,
    );
    expect(approved.approved).toBe(true);
    expect(approved.approval).toContain("Finance lead");
    expect(blocking([approved])).toEqual([]);
    expect(scanMigration("m", `-- release: destructive-approved\n${sql}`).approved).toBe(false);
  });

  it("finds nothing blocking in this repository's migrations", () => {
    const dir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
    const reports = scanMigrationsDir(dir);
    expect(reports.length).toBeGreaterThanOrEqual(8);
    expect(blocking(reports)).toEqual([]);
  });
});
