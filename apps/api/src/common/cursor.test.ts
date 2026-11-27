import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

describe("cursor", () => {
  it("round-trips", () => {
    const cursor = {
      createdAt: new Date("2026-11-27T10:00:00.123Z"),
      id: "00000000-0000-4000-8000-000000000001",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects tampered input with a validation error", () => {
    expect(() => decodeCursor("not-base64-json")).toThrow(ApiError);
    expect(() => decodeCursor(Buffer.from('["nope", 1]').toString("base64url"))).toThrow(ApiError);
  });
});
