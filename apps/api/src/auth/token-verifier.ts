import { Inject, Injectable } from "@nestjs/common";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

/** Key source for signature verification. Tests provide a local key set. */
export const JWKS = Symbol("JWKS");

export function jwksFromEnv(env: Env): JWTVerifyGetKey | null {
  return env.SUPABASE_JWKS_URL
    ? createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL), { cooldownDuration: 30_000 })
    : null;
}

export interface VerifiedToken {
  subject: string;
  aal: "aal1" | "aal2";
  email: string | null;
  phone: string | null;
}

export class TokenRejectedError extends Error {}

/**
 * Verifies a Supabase access token: signature against the JWKS (asymmetric algorithms only),
 * issuer, audience, expiry and not-before. Role claims in the token are ignored; roles come
 * from the database.
 */
@Injectable()
export class TokenVerifier {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(JWKS) private readonly keys: JWTVerifyGetKey | null,
  ) {}

  async verify(token: string): Promise<VerifiedToken> {
    if (!this.keys || !this.env.SUPABASE_JWT_ISSUER) {
      throw new TokenRejectedError("token verification is not configured");
    }
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.env.SUPABASE_JWT_ISSUER,
        audience: this.env.SUPABASE_JWT_AUDIENCE,
        algorithms: ["RS256", "ES256", "EdDSA"],
        requiredClaims: ["sub", "exp"],
        clockTolerance: 5,
      });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new TokenRejectedError("token has no subject");
      }
      return {
        subject: payload.sub,
        aal: payload["aal"] === "aal2" ? "aal2" : "aal1",
        email: typeof payload["email"] === "string" && payload["email"] ? payload["email"] : null,
        phone: typeof payload["phone"] === "string" && payload["phone"] ? payload["phone"] : null,
      };
    } catch (error) {
      if (error instanceof TokenRejectedError) throw error;
      if (error instanceof errors.JOSEError) {
        throw new TokenRejectedError(error.code);
      }
      // Network failure fetching the JWKS and similar: not the caller's fault.
      throw error;
    }
  }
}
