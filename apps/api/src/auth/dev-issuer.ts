import { randomUUID, webcrypto } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

/** Issuer claim of development tokens. Never accepted unless DEV_AUTH_ENABLED is true. */
export const DEV_ISSUER = "urn:coffee-marketplace:dev-auth";

/** Only fictional accounts can be signed into: seed rows and accounts made by dev sign-up. */
export const FICTIONAL_SUBJECT = /^(seed|dev)-[A-Za-z0-9-]+$/;

/**
 * Signs short-lived tokens for fictional accounts so protected screens can be built and tested
 * locally without Supabase credentials (D12, 2026-11-28). The key pair lives only in memory and
 * changes on every restart. The environment check refuses DEV_AUTH_ENABLED in production, and
 * the token verifier ignores this issuer when the flag is off.
 */
@Injectable()
export class DevIssuer {
  private keys?: Promise<{ privateKey: webcrypto.CryptoKey; jwks: JWTVerifyGetKey; kid: string }>;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return this.env.DEV_AUTH_ENABLED && this.env.NODE_ENV !== "production";
  }

  private material() {
    if (!this.enabled) throw new Error("development sign-in is disabled");
    this.keys ??= (async () => {
      const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
      const kid = randomUUID();
      const jwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
      return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }), kid };
    })();
    return this.keys;
  }

  async jwks(): Promise<JWTVerifyGetKey> {
    return (await this.material()).jwks;
  }

  /** One hour, like a Supabase access token. */
  readonly ttlSeconds = 3600;

  async sign(claims: {
    sub: string;
    aal: "aal1" | "aal2";
    email: string | null;
    phone: string | null;
  }): Promise<{ token: string; expiresAt: Date }> {
    if (!FICTIONAL_SUBJECT.test(claims.sub)) throw new Error("not a fictional account");
    const { privateKey, kid } = await this.material();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const token = await new SignJWT({
      role: "authenticated",
      aal: claims.aal,
      ...(claims.email ? { email: claims.email } : {}),
      ...(claims.phone ? { phone: claims.phone } : {}),
    })
      .setProtectedHeader({ alg: "ES256", kid })
      .setSubject(claims.sub)
      .setIssuer(DEV_ISSUER)
      .setAudience(this.env.SUPABASE_JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(privateKey);
    return { token, expiresAt };
  }
}
