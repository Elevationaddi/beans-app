import type { AuthConfig } from "@beans/web";

/** Public settings only. Never put a secret in a NEXT_PUBLIC_ variable. */
export const adminAuth: AuthConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
  /** Development sign-in. The API refuses it in production regardless of this flag. */
  devAuth: process.env.NEXT_PUBLIC_DEV_AUTH === "true",
  storageKey: "cm.admin",
};

/** Business portal address, used to build the one-time owner invitation link. */
export const merchantPortalUrl = (
  process.env.NEXT_PUBLIC_MERCHANT_URL ?? "http://localhost:3001"
).replace(/\/$/, "");
