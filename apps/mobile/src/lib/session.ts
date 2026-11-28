/**
 * The signed-in session's access token, held in memory only. The API client reads it for every
 * request. Long-lived refresh tokens (Supabase) are kept in the device keychain by `auth.ts`,
 * never in AsyncStorage.
 */
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}
export function notifyUnauthorized() {
  onUnauthorized?.();
}

/** Idempotency keys only need to be unique per request, not secret. */
export function newIdempotencyKey(): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `m-${Date.now().toString(36)}-${hex(16)}`;
}
