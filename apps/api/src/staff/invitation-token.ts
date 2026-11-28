import { createHash } from "node:crypto";

/** Invitation tokens are stored only as their SHA-256 hash. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
