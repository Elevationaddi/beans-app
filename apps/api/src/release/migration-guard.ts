import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Release check for migrations (docs/11 release procedure: "never blindly reverse money
 * migrations"). Flags statements that destroy or rewrite data so they cannot reach staging or
 * production without a named, reviewed approval written in the migration itself:
 *
 *   -- release: destructive-approved <who and why>
 *
 * The marker covers the whole migration file. Comments are ignored when scanning, so a
 * statement mentioned in a comment is not flagged, and trigger clauses such as
 * `BEFORE TRUNCATE ON` (used to block truncation) are not statements and are not flagged.
 */
export interface DestructiveFinding {
  rule: string;
  line: number;
  statement: string;
}

export interface MigrationReport {
  name: string;
  findings: DestructiveFinding[];
  approved: boolean;
  approval?: string;
}

const RULES: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "drop-table", pattern: /^\s*DROP\s+TABLE\b/i },
  { rule: "drop-schema", pattern: /^\s*DROP\s+SCHEMA\b/i },
  { rule: "drop-type", pattern: /^\s*DROP\s+TYPE\b/i },
  { rule: "drop-trigger", pattern: /^\s*DROP\s+TRIGGER\b/i },
  { rule: "drop-function", pattern: /^\s*DROP\s+FUNCTION\b/i },
  { rule: "truncate", pattern: /^\s*TRUNCATE\b/i },
  { rule: "delete", pattern: /^\s*DELETE\s+FROM\b/i },
  { rule: "update-without-where", pattern: /^\s*UPDATE\s+(?![\s\S]*\bWHERE\b)/i },
  { rule: "drop-column", pattern: /\bDROP\s+COLUMN\b/i },
  { rule: "drop-constraint", pattern: /\bDROP\s+CONSTRAINT\b/i },
  { rule: "alter-column-type", pattern: /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i },
  { rule: "rename", pattern: /\bRENAME\s+(COLUMN\s+|TO\b)/i },
  { rule: "disable-trigger", pattern: /\bDISABLE\s+TRIGGER\b/i },
];

const APPROVAL = /--[ \t]*release:[ \t]*destructive-approved[ \t]+(\S[^\n]*)$/im;

/** Replaces comments and string/dollar-quoted bodies with spaces, keeping line numbers. */
function blankNonCode(sql: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, blank)
    .replace(/'(?:[^']|'')*'/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/--[^\n]*/g, blank);
}

export function scanMigration(name: string, sql: string): MigrationReport {
  const code = blankNonCode(sql);
  const findings: DestructiveFinding[] = [];
  let offset = 0;
  for (const raw of code.split(";")) {
    const start = offset + (raw.length - raw.trimStart().length);
    offset += raw.length + 1;
    const statement = raw.trim();
    if (!statement) continue;
    const line = code.slice(0, start).split("\n").length;
    for (const { rule, pattern } of RULES) {
      if (pattern.test(statement)) {
        findings.push({ rule, line, statement: statement.replace(/\s+/g, " ").slice(0, 120) });
      }
    }
  }
  const approval = APPROVAL.exec(sql)?.[1]?.trim();
  return {
    name,
    findings,
    approved: Boolean(approval),
    ...(approval ? { approval } : {}),
  };
}

/** Scans every `<dir>/<migration>/migration.sql`, oldest first. */
export function scanMigrationsDir(dir: string): MigrationReport[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => scanMigration(name, readFileSync(join(dir, name, "migration.sql"), "utf8")));
}

/** Migrations that have destructive statements and no approval marker. */
export const blocking = (reports: MigrationReport[]) =>
  reports.filter((report) => report.findings.length > 0 && !report.approved);
