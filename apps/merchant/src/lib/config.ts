import type { AuthConfig } from "@beans/web";

/** Public settings only. Never put a secret in a NEXT_PUBLIC_ variable. */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;
/** Development sign-in. The API refuses it in production regardless of this flag. */
const devAuth = process.env.NEXT_PUBLIC_DEV_AUTH === "true";

export const portalAuth: AuthConfig = {
  apiUrl,
  supabaseUrl,
  supabaseAnonKey,
  devAuth,
  storageKey: "cm.portal",
};
export const tabletAuth: AuthConfig = {
  apiUrl,
  supabaseUrl,
  supabaseAnonKey,
  devAuth,
  storageKey: "cm.tablet",
};
