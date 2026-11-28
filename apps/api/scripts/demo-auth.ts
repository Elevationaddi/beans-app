/**
 * Sign-in for the demo scripts (cycle 4).
 *
 * - "dev": local development sign-in (DEV_AUTH_ENABLED on a LOCAL API only). Staging and
 *   production refuse development sign-in, so this mode cannot reach them.
 * - "supabase": real Supabase Auth with the demo account passwords and authenticator secrets
 *   from a local credentials file written by provision-demo-accounts.ts. The file lives outside
 *   the repository and is never committed or printed.
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export type Credentials = Record<
  string,
  { userId: string; password: string; totpSecret?: string; factorId?: string }
>;

export interface Session {
  token(email: string, opts?: { mfa?: boolean }): Promise<string>;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 time-based one-time code (SHA-1, 30 seconds, 6 digits), as authenticator apps use. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export async function api<T = unknown>(
  base: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  token?: string | null,
  body?: unknown,
): Promise<T> {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(method !== "GET" ? { "idempotency-key": randomUUID() } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { data?: T; error?: unknown };
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json.error ?? json)}`);
  }
  return json.data as T;
}

export function devSession(apiUrl: string): Session {
  let accounts: { userId: string; email: string | null }[] | null = null;
  return {
    async token(email, opts) {
      accounts ??= await api(apiUrl, "GET", "/v1/dev-auth/accounts");
      const account = accounts!.find((a) => a.email === email);
      if (!account) throw new Error(`No fictional account ${email}; run pnpm db:demo first`);
      const session = await api<{ accessToken: string }>(
        apiUrl,
        "POST",
        "/v1/dev-auth/sessions",
        null,
        {
          userId: account.userId,
          mfa: opts?.mfa ?? false,
        },
      );
      return session.accessToken;
    },
  };
}

export async function gotrue<T>(
  supabaseUrl: string,
  anonKey: string,
  path: string,
  body: unknown,
  bearer?: string,
): Promise<T> {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1${path}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // Supabase error bodies carry a code and message, never the password.
    throw new Error(
      `Supabase Auth ${path.split("?")[0]} → ${response.status} ${String(json["msg"] ?? json["error_code"] ?? "")}`,
    );
  }
  return json as T;
}

export function supabaseSession(
  supabaseUrl: string,
  anonKey: string,
  credentialsFile: string,
): Session {
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8")) as Credentials;
  const cache = new Map<string, string>();
  return {
    async token(email, opts) {
      const mfa = opts?.mfa ?? false;
      const cacheKey = `${email}|${mfa}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;
      const entry = credentials[email];
      if (!entry) throw new Error(`No credentials for ${email} in the credentials file`);
      const signedIn = await gotrue<{ access_token: string }>(
        supabaseUrl,
        anonKey,
        "/token?grant_type=password",
        { email, password: entry.password },
      );
      let token = signedIn.access_token;
      if (mfa) {
        if (!entry.totpSecret || !entry.factorId)
          throw new Error(`${email} has no authenticator enrolled`);
        const challenge = await gotrue<{ id: string }>(
          supabaseUrl,
          anonKey,
          `/factors/${entry.factorId}/challenge`,
          {},
          token,
        );
        const verified = await gotrue<{ access_token: string }>(
          supabaseUrl,
          anonKey,
          `/factors/${entry.factorId}/verify`,
          { challenge_id: challenge.id, code: totp(entry.totpSecret) },
          token,
        );
        token = verified.access_token;
      }
      cache.set(cacheKey, token);
      return token;
    },
  };
}
