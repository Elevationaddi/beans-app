/** Keys whose values never belong in audit history or logs. */
const SECRET_KEYS = /pass(word)?|secret|token|authorization|api[_-]?key|card|cvv|pan|iban|otp|pin/i;
/** Personal data kept only masked (docs/10-security.md). */
const PII_KEYS = /^(email|phone|plate|display_?name)$/i;

function maskString(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  return `${value[0]}${"*".repeat(Math.min(value.length - 2, 8))}${value.at(-1)}`;
}

/**
 * Copies a value for storage in audit_events: secrets become "[REDACTED]", personal data is
 * masked, and nesting is limited so a large payload cannot bloat the audit table.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(key)) out[key] = "[REDACTED]";
      else if (PII_KEYS.test(key) && typeof item === "string") out[key] = maskString(item);
      else out[key] = redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}
