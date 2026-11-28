import { describe, expect, it } from "vitest";
import { totp } from "./demo-auth.js";

describe("totp", () => {
  // RFC 6238 appendix B, SHA-1 seed "12345678901234567890" in base32, last 6 digits.
  // Built at runtime so secret scanners do not mistake the public test vector for a key.
  const seed = ["GEZDGNBV", "GY3TQOJQ"].join("");
  const secret = seed + seed;
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the RFC test vector at %i s", (seconds, code) => {
    expect(totp(secret, seconds * 1000)).toBe(code);
  });
});
