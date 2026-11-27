import { createApiClient } from "@beans/contracts";
import { config } from "./config";

// Resolve fetch at call time so polyfills (and test doubles) installed after import are used.
export const api = createApiClient({
  baseUrl: config.apiUrl,
  fetch: (request: Request) => globalThis.fetch(request),
});

/** A failed API call, with the contract's error code when the server answered. */
export class ApiFailure extends Error {
  constructor(
    readonly kind: "offline" | "server",
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Unwraps an openapi-fetch call: returns the body, or throws an ApiFailure. */
export async function call<T>(request: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await request;
  } catch {
    throw new ApiFailure("offline", 0, "OFFLINE", "No connection");
  }
  if (result.data !== undefined && result.response.ok) return result.data;
  const body = result.error as
    | { error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> } }
    | undefined;
  throw new ApiFailure(
    "server",
    result.response.status,
    body?.error?.code ?? "INTERNAL_ERROR",
    body?.error?.message ?? "Request failed",
    body?.error?.fieldErrors ?? {},
  );
}
