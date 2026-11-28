/**
 * Public build-time configuration. Only EXPO_PUBLIC_* values reach the bundle, and none of
 * them are secrets. The API URL defaults to a local development server.
 */
export const config = {
  apiUrl: process.env["EXPO_PUBLIC_API_URL"] ?? "http://localhost:3000",
  /** Supabase project for real sign-in (D12). Without it, only development sign-in exists. */
  supabaseUrl: process.env["EXPO_PUBLIC_SUPABASE_URL"] || null,
  /** Public (anon) key: safe in the app. The service role key never is. */
  supabaseAnonKey: process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] || null,
  /** Development sign-in with fictional accounts. The API refuses it in production. */
  devAuth: process.env["EXPO_PUBLIC_DEV_AUTH"] === "true",
} as const;
