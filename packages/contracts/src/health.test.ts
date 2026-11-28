import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./health.js";

describe("healthResponseSchema", () => {
  const valid = {
    status: "ok",
    version: "0.0.0",
    time: "2026-11-27T12:00:00.000Z",
    checks: { database: "up" },
  };

  it("accepts a well-formed health response", () => {
    expect(healthResponseSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an unknown dependency status", () => {
    const result = healthResponseSchema.safeParse({
      ...valid,
      checks: { database: "maybe" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO timestamp", () => {
    expect(healthResponseSchema.safeParse({ ...valid, time: "yesterday" }).success).toBe(false);
  });
});
