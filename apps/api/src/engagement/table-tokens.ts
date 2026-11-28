import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

export const TABLE_TOKEN_SECRET = Symbol("TABLE_TOKEN_SECRET");

export function tableTokenSecret(env: Env): string {
  if (env.TABLE_TOKEN_SECRET) return env.TABLE_TOKEN_SECRET;
  // env.ts requires the secret in production; elsewhere a per-process secret is enough.
  new Logger("TableTokens").warn(
    "TABLE_TOKEN_SECRET not set; using a random per-process secret (table codes change on restart)",
  );
  return randomBytes(32).toString("hex");
}

const PREFIX = "t1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Dine-in table QR tokens (docs/08: "signed opaque table token ... no trusted client table
 * ID; rotate/revoke compromised codes"). The token names the table and its token version and
 * carries an HMAC over both; the server still checks that the table is active, that the
 * version is current and that the table belongs to the cart's branch.
 */
@Injectable()
export class TableTokens {
  constructor(@Inject(TABLE_TOKEN_SECRET) private readonly secret: string) {}

  tokenFor(tableId: string, version: number): string {
    const id = Buffer.from(tableId.replace(/-/g, ""), "hex").toString("base64url");
    return `${PREFIX}.${id}.${version}.${this.mac(tableId, version)}`;
  }

  /** The table ID and version of a well-formed, correctly signed token; null otherwise. */
  parse(token: string): { tableId: string; version: number } | null {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    const [, id, versionText, mac] = parts as [string, string, string, string];
    if (!/^[1-9]\d{0,8}$/.test(versionText)) return null;
    const hex = Buffer.from(id, "base64url").toString("hex");
    if (hex.length !== 32) return null;
    const tableId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    if (!UUID.test(tableId)) return null;
    const version = Number(versionText);
    const expected = Buffer.from(this.mac(tableId, version));
    const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return { tableId, version };
  }

  private mac(tableId: string, version: number): string {
    return createHmac("sha256", this.secret)
      .update(`table:${tableId}:${version}`)
      .digest()
      .subarray(0, 16)
      .toString("base64url");
  }
}

export const tableTokenProviders = [
  { provide: TABLE_TOKEN_SECRET, inject: [ENV], useFactory: tableTokenSecret },
  TableTokens,
];
