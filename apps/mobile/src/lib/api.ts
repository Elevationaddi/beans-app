import { createApiClient } from "@beans/contracts";
import { config } from "./config";
import { getAccessToken, newIdempotencyKey, notifyUnauthorized } from "./session";

/**
 * Typed client for the `/v1` API. Adds the session token and, on writes, an Idempotency-Key so
 * a retried request is never applied twice. Fetch is resolved at call time so test doubles
 * installed after import are used.
 */
export const api = createApiClient({
  baseUrl: config.apiUrl,
  fetch: async (request: Request) => {
    const token = getAccessToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    if (request.method !== "GET" && !request.headers.has("Idempotency-Key")) {
      request.headers.set("Idempotency-Key", newIdempotencyKey());
    }
    const response = await globalThis.fetch(request);
    if (response.status === 401 && token) notifyUnauthorized();
    return response;
  },
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
  if (result.response.ok && (result.data !== undefined || result.response.status === 204)) {
    return result.data as T;
  }
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
