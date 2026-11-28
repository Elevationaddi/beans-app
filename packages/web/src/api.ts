import type { z } from "zod";

/** A failed API call. `code` is the contract error code; `offline` when no answer arrived. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
    readonly requestId?: string,
  ) {
    super(message);
  }
  get offline() {
    return this.code === "OFFLINE";
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions<S extends z.ZodType> {
  query?: Query;
  body?: unknown;
  schema: S;
  /** Reuse a key on retry of the same action; a new key is made per call otherwise. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl: string;
  token: () => string | null;
  /** Called when the API answers 401 to a signed-in request: the session has expired. */
  onUnauthorized?: () => void;
  locale?: () => string;
}

export function newKey(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Small JSON client for the `/v1` API. Every response is checked against the shared contract
 * schema, so a screen never renders data the contract does not promise.
 */
export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  url(path: string, query?: Query): string {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "")
        url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<S extends z.ZodType>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: RequestOptions<S>,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = this.options.token();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (this.options.locale) headers["Accept-Language"] = this.options.locale();
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") headers["Idempotency-Key"] = options.idempotencyKey ?? newKey();
    let response: Response;
    try {
      response = await fetch(this.url(path, options.query), {
        method,
        headers,
        body: options.body === undefined ? null : JSON.stringify(options.body),
        signal: options.signal ?? null,
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new ApiError(0, "OFFLINE", "No connection. Check the network and try again.");
    }
    const text = await response.text();
    const json: unknown = text ? safeJson(text) : undefined;
    if (!response.ok) {
      const err = (
        json as {
          error?: {
            code?: string;
            message?: string;
            fieldErrors?: Record<string, string[]>;
            requestId?: string;
          };
        }
      )?.error;
      if (response.status === 401 && token) this.options.onUnauthorized?.();
      throw new ApiError(
        response.status,
        err?.code ?? "INTERNAL_ERROR",
        err?.message ?? `Request failed (${response.status})`,
        err?.fieldErrors ?? {},
        err?.requestId,
      );
    }
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        "INTERNAL_ERROR",
        "The server sent an unexpected answer.",
      );
    }
    return parsed.data;
  }

  get<S extends z.ZodType>(path: string, schema: S, query?: Query, signal?: AbortSignal) {
    return this.request("GET", path, { schema, query, ...(signal ? { signal } : {}) });
  }
  post<S extends z.ZodType>(path: string, schema: S, body?: unknown, idempotencyKey?: string) {
    return this.request("POST", path, {
      schema,
      body: body ?? {},
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
  put<S extends z.ZodType>(path: string, schema: S, body?: unknown) {
    return this.request("PUT", path, { schema, body: body ?? {} });
  }
  patch<S extends z.ZodType>(path: string, schema: S, body?: unknown) {
    return this.request("PATCH", path, { schema, body: body ?? {} });
  }
  delete<S extends z.ZodType>(path: string, schema: S) {
    return this.request("DELETE", path, { schema });
  }

  /** Authenticated binary download (receipts, exports) saved through the browser. */
  async download(path: string, filename: string, query?: Query): Promise<void> {
    const token = this.options.token();
    const response = await fetch(this.url(path, query), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new ApiError(response.status, "INTERNAL_ERROR", "Download failed");
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
