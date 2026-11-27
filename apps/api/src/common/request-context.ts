import type { Locale } from "../generated/prisma/client.js";

/** The verified caller, resolved from the access token and the users table. */
export interface Actor {
  userId: string;
  authSubject: string;
  /** Authenticator assurance level from the token: "aal2" means MFA was completed. */
  aal: "aal1" | "aal2";
  locale: Locale;
}

/** Minimal request shape the API relies on, independent of the HTTP adapter. */
export interface ApiRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  requestId: string;
  actor?: Actor;
  /** Matched route template, e.g. "/v1/me". Set by Nest/Express. */
  route?: { path: string };
}

export interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): void;
}
