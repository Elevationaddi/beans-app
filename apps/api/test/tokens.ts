import { randomUUID, webcrypto } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { TEST_ISSUER } from "./env.js";

/**
 * A throwaway signing key standing in for Supabase Auth. Tokens are signed locally and
 * verified through the real TokenVerifier via a local JWKS.
 */
export class TestIssuer {
  private constructor(
    private readonly privateKey: webcrypto.CryptoKey,
    readonly jwks: JWTVerifyGetKey,
    private readonly kid: string,
  ) {}

  static async create(): Promise<TestIssuer> {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const kid = randomUUID();
    const jwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
    return new TestIssuer(privateKey, createLocalJWKSet({ keys: [jwk] }), kid);
  }

  async token(
    claims: { sub: string; aal?: "aal1" | "aal2"; [claim: string]: unknown },
    options: {
      issuer?: string;
      audience?: string;
      expiresIn?: string | number;
      notBefore?: string | number;
    } = {},
  ): Promise<string> {
    const jwt = new SignJWT({ role: "authenticated", aal: "aal1", ...claims })
      .setProtectedHeader({ alg: "ES256", kid: this.kid })
      .setIssuer(options.issuer ?? TEST_ISSUER)
      .setAudience(options.audience ?? "authenticated")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m");
    if (options.notBefore !== undefined) jwt.setNotBefore(options.notBefore);
    return jwt.sign(this.privateKey);
  }
}

/** A fresh auth subject so tests never collide with each other or with seed data. */
export const newSubject = () => `test-${randomUUID()}`;
