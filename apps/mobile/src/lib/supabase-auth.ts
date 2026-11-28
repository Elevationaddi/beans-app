import { config } from "./config";

/**
 * Minimal Supabase Auth (GoTrue) client for email one-time codes (cycle 3: email only, no SMS
 * provider). Uses the public anon key only. Apple and Google sign-in need provider credentials and native setup
 * that are not configured yet, so they are not offered (see docs/16, external dependencies).
 */
export interface SupabaseSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type OtpTarget = { email: string };

export class AuthError extends Error {}

function endpoint(path: string): string {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new AuthError("Sign-in is not configured in this build.");
  }
  return `${config.supabaseUrl.replace(/\/$/, "")}/auth/v1${path}`;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint(path), {
      method: "POST",
      headers: { "content-type": "application/json", apikey: config.supabaseAnonKey ?? "" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("No connection. Check the network and try again.");
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (json["msg"] as string | undefined) ??
      (json["error_description"] as string | undefined) ??
      "That did not work. Check the details and try again.";
    throw new AuthError(message);
  }
  return json as T;
}

/** Emails a one-time code; creates the account on first use. Supabase limits resends. */
export async function sendOtp(target: OtpTarget): Promise<void> {
  await post("/otp", { ...target, create_user: true });
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

function toSession(token: TokenResponse): SupabaseSession {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

export async function verifyOtp(target: OtpTarget, code: string): Promise<SupabaseSession> {
  return toSession(
    await post<TokenResponse>("/verify", { email: target.email, token: code, type: "email" }),
  );
}

/** Staging demo accounts only (config.demoPasswordSignIn); see SignInScreen. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SupabaseSession> {
  return toSession(await post<TokenResponse>("/token?grant_type=password", { email, password }));
}

export async function refresh(refreshToken: string): Promise<SupabaseSession> {
  return toSession(
    await post<TokenResponse>("/token?grant_type=refresh_token", { refresh_token: refreshToken }),
  );
}

export const supabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
