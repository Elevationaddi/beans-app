import { describe, expect, it } from "vitest";
import { BasicFileScanner } from "./file-scanner.js";

const pdf = (body = "") => Buffer.from(`%PDF-1.7\n${body}\n%%EOF`, "latin1");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("BasicFileScanner", () => {
  const scanner = new BasicFileScanner();

  it("accepts files whose content matches the declared type", async () => {
    expect(await scanner.scan(pdf("1 0 obj << /Type /Catalog >>"), "application/pdf")).toEqual({
      clean: true,
    });
    expect(await scanner.scan(png, "image/png")).toEqual({ clean: true });
    expect(await scanner.scan(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]), "image/jpeg")).toEqual({
      clean: true,
    });
  });

  it("rejects a type mismatch, the EICAR test file and active PDF content", async () => {
    expect((await scanner.scan(png, "application/pdf")).clean).toBe(false);
    expect((await scanner.scan(Buffer.from("MZ executable"), "image/png")).clean).toBe(false);
    const eicar = pdf("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect(await scanner.scan(eicar, "application/pdf")).toEqual({
      clean: false,
      reason: "File failed the security check",
    });
    expect(
      (
        await scanner.scan(
          pdf("<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"),
          "application/pdf",
        )
      ).clean,
    ).toBe(false);
    expect(
      (await scanner.scan(pdf("<< /S /Launch /F (cmd.exe) >>"), "application/pdf")).clean,
    ).toBe(false);
    expect((await scanner.scan(pdf(), "text/html")).clean).toBe(false);
  });
});
