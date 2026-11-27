import { describe, expect, it } from "vitest";
import { requestHash } from "./idempotency.service.js";

describe("requestHash", () => {
  it("ignores key order and undefined fields", () => {
    expect(requestHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      requestHash({ b: { d: 3, c: 2 }, a: 1, e: undefined }),
    );
  });

  it("distinguishes different values, types and array order", () => {
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: "1" }));
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
    expect(requestHash(null)).toBe(requestHash(undefined));
  });
});
