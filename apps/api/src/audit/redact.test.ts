import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("removes secrets at any depth", () => {
    expect(
      redact({ password: "hunter2", nested: { accessToken: "abc", apiKey: "k", ok: 1 } }),
    ).toEqual({
      password: "[REDACTED]",
      nested: { accessToken: "[REDACTED]", apiKey: "[REDACTED]", ok: 1 },
    });
  });

  it("masks personal data", () => {
    expect(
      redact({ email: "mona@example.com", phone: "+971500000000", displayName: "Mona" }),
    ).toEqual({
      email: "m********m",
      phone: "+********0",
      displayName: "M**a",
    });
  });

  it("serialises bigint and dates and truncates deep or long values", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(redact({ amount: 2200n, at: new Date("2026-01-01T00:00:00Z") })).toEqual({
      amount: "2200",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(redact(deep))).toContain("[TRUNCATED]");
    expect((redact("x".repeat(600)) as string).length).toBe(501);
  });
});
