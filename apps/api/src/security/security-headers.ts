import type { Env } from "../config/env.js";

type Res = { setHeader(name: string, value: string): void; removeHeader(name: string): void };

/**
 * Conservative headers for a JSON API (docs/10): no sniffing, no framing, no referrer, a CSP
 * that allows nothing, and HSTS in production (TLS terminates in front of the API there).
 */
export function securityHeaders(env: Env) {
  return (_req: unknown, res: Res, next: () => void) => {
    res.removeHeader("X-Powered-By");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    // Pre-launch: keep every deployment out of search engines, whatever host serves it.
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}
