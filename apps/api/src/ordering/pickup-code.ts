import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

export const PICKUP_CODE_SECRET = Symbol("PICKUP_CODE_SECRET");

export function pickupCodeSecret(env: Env): string {
  if (env.PICKUP_CODE_SECRET) return env.PICKUP_CODE_SECRET;
  // env.ts requires the secret in production; elsewhere a per-process secret is enough.
  new Logger("PickupCodes").warn(
    "PICKUP_CODE_SECRET not set; using a random per-process secret (codes change on restart)",
  );
  return randomBytes(32).toString("hex");
}

/** Wrong codes in a row before completion is locked, and for how long. Security defaults. */
export const PICKUP_CODE_MAX_FAILURES = 5;
export const PICKUP_CODE_LOCK_MS = 5 * 60_000;

/**
 * Handoff codes (docs/10: "store pickup code salted hash, rate limit attempts"). The code is
 * derived from the order ID with a server secret, so the customer's app can always be shown
 * it without the database holding it; the database keeps only a salted hash for checking.
 */
@Injectable()
export class PickupCodes {
  constructor(@Inject(PICKUP_CODE_SECRET) private readonly secret: string) {}

  /** The six-digit code for an order. */
  codeFor(orderId: string): string {
    const digest = createHmac("sha256", this.secret).update(`pickup:${orderId}`).digest();
    return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
  }

  /** `salt$sha256(salt:orderId:code)` for storage. */
  hashFor(orderId: string): string {
    const salt = randomBytes(16).toString("hex");
    return `${salt}$${digest(salt, orderId, this.codeFor(orderId))}`;
  }

  /** Constant-time check of a typed code against the stored hash. */
  verify(stored: string | null, orderId: string, code: string): boolean {
    if (!stored) return false;
    const [salt, expected] = stored.split("$");
    if (!salt || !expected) return false;
    const actual = Buffer.from(digest(salt, orderId, code), "hex");
    const wanted = Buffer.from(expected, "hex");
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  }
}

function digest(salt: string, orderId: string, code: string): string {
  return createHash("sha256").update(`${salt}:${orderId}:${code}`).digest("hex");
}

export const pickupCodeProviders = [
  { provide: PICKUP_CODE_SECRET, inject: [ENV], useFactory: pickupCodeSecret },
  PickupCodes,
];
