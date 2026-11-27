import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PickupCodes } from "./pickup-code.js";

describe("pickup codes", () => {
  const codes = new PickupCodes("s".repeat(40));

  it("derives a stable six-digit code per order", () => {
    const id = randomUUID();
    expect(codes.codeFor(id)).toMatch(/^\d{6}$/);
    expect(codes.codeFor(id)).toBe(codes.codeFor(id));
    expect(new PickupCodes("t".repeat(40)).codeFor(id)).not.toBe(codes.codeFor(id));
  });

  it("stores a salted hash that verifies only the right code for the right order", () => {
    const id = randomUUID();
    const hash = codes.hashFor(id);
    expect(hash).not.toContain(codes.codeFor(id));
    expect(codes.hashFor(id)).not.toBe(hash); // salted
    expect(codes.verify(hash, id, codes.codeFor(id))).toBe(true);
    const wrong = codes.codeFor(id) === "000000" ? "000001" : "000000";
    expect(codes.verify(hash, id, wrong)).toBe(false);
    expect(codes.verify(hash, randomUUID(), codes.codeFor(id))).toBe(false);
    expect(codes.verify(null, id, codes.codeFor(id))).toBe(false);
    expect(codes.verify("garbage", id, codes.codeFor(id))).toBe(false);
  });
});
