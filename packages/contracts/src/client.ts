import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./generated/openapi.js";

/**
 * Typed API client generated from openapi.json. Pass the user's Supabase access token per
 * request or through a fetch wrapper; never embed server secrets in a client bundle.
 */
export function createApiClient(options: ClientOptions) {
  return createClient<paths>(options);
}

export type { paths as ApiPaths } from "./generated/openapi.js";
