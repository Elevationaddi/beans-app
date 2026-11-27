/**
 * Public build-time configuration. Only EXPO_PUBLIC_* values reach the bundle, and none of
 * them are secrets. The API URL defaults to a local development server.
 */
export const config = {
  apiUrl: process.env["EXPO_PUBLIC_API_URL"] ?? "http://localhost:3000",
  /** Sign-in needs a Supabase project (decision D12); until it is set, guests only. */
  supabaseUrl: process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? null,
} as const;
