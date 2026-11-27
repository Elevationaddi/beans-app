import { randomUUID } from "node:crypto";
import type { ApiRequest, ApiResponse } from "./request-context.js";

const ACCEPTABLE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Gives every request an ID for logs, errors and audit events. A caller-supplied
 * X-Request-Id is reused only when it is a short safe token, so it cannot inject log lines.
 */
export function requestIdMiddleware(req: ApiRequest, res: ApiResponse, next: () => void): void {
  const incoming = req.headers["x-request-id"];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  req.requestId = candidate && ACCEPTABLE_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
