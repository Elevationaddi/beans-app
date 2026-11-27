import { describe, expect, it } from "vitest";
import { FileTokenSigner, type FileGrant } from "./signed-token.js";

const grant: FileGrant = {
  action: "put",
  uploadId: "u1",
  objectKey: "merchants/m1/documents/u1",
  mime: "application/pdf",
  maxBytes: 100,
  exp: Math.floor(Date.now() / 1000) + 60,
};

describe("FileTokenSigner", () => {
  const signer = new FileTokenSigner("s".repeat(32));

  it("verifies its own token for the same action and upload", () => {
    expect(signer.verify(signer.sign(grant), "put", "u1")).toEqual(grant);
  });

  it("rejects another action, another upload, expiry, tampering and other keys", () => {
    const token = signer.sign(grant);
    expect(signer.verify(token, "get", "u1")).toBeNull();
    expect(signer.verify(token, "put", "u2")).toBeNull();
    expect(signer.verify(signer.sign({ ...grant, exp: 1 }), "put", "u1")).toBeNull();
    const [payload, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...grant, maxBytes: 10_000_000 })).toString(
      "base64url",
    );
    expect(signer.verify(`${forged}.${mac}`, "put", "u1")).toBeNull();
    expect(signer.verify(`${payload}.${mac}x`, "put", "u1")).toBeNull();
    expect(new FileTokenSigner("t".repeat(32)).verify(token, "put", "u1")).toBeNull();
    expect(signer.verify("garbage", "put", "u1")).toBeNull();
  });
});
