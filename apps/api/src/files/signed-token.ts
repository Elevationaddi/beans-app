import { createHmac, timingSafeEqual } from "node:crypto";

export interface FileGrant {
  /** "put" to upload, "get" to download. */
  action: "put" | "get";
  uploadId: string;
  objectKey: string;
  mime: string;
  maxBytes: number;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

/** Compact HMAC-SHA256 token binding one action to one object, type, size and expiry. */
export class FileTokenSigner {
  constructor(private readonly secret: string) {}

  sign(grant: FileGrant): string {
    const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
    return `${payload}.${this.mac(payload)}`;
  }

  /** The grant when the token is authentic, unexpired and for this action and upload. */
  verify(
    token: string,
    action: FileGrant["action"],
    uploadId: string,
    now = Date.now(),
  ): FileGrant | null {
    const [payload, mac, extra] = token.split(".");
    if (!payload || !mac || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let grant: FileGrant;
    try {
      grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as FileGrant;
    } catch {
      return null;
    }
    if (grant.action !== action || grant.uploadId !== uploadId) return null;
    if (typeof grant.exp !== "number" || grant.exp * 1000 < now) return null;
    return grant;
  }

  private mac(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}
