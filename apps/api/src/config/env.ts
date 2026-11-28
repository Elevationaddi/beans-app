import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

/**
 * Server configuration, validated once at startup. The process refuses to start when
 * anything is missing or unsafe, rather than failing later on first use.
 *
 * Token verification settings (SUPABASE_JWKS_URL, SUPABASE_JWT_ISSUER) are required in
 * production. Without them in development, every authenticated request answers 401, so
 * nothing is silently trusted.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_VERSION: z.string().min(1).default("0.0.0"),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(ql)?:\/\//.test(value), "must be a postgres:// URL"),
    /**
     * Most connections one API instance opens. On Vercel each function instance has its own
     * pool, so keep this small (1–3) and connect through Supabase's transaction pooler.
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url())),
    SUPABASE_URL: z.string().url().optional(),
    /** JSON Web Key Set used to verify access token signatures (asymmetric keys only). */
    SUPABASE_JWKS_URL: z.string().url().optional(),
    /** Expected "iss" claim, normally `${SUPABASE_URL}/auth/v1`. */
    SUPABASE_JWT_ISSUER: z.string().min(1).optional(),
    /** Expected "aud" claim. Supabase uses "authenticated" for signed-in users. */
    SUPABASE_JWT_AUDIENCE: z.string().min(1).default("authenticated"),
    /**
     * Server-only Supabase key, used to broadcast live order signals (REALTIME_DRIVER=supabase)
     * and for the Supabase Storage driver. Never put it in a web or mobile build.
     */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    /**
     * Where live order signals go. "memory": this process only (local development and tests;
     * the event-stream endpoints read it). "supabase": Supabase Realtime Broadcast, for
     * serverless hosting where instances share no memory. Clients always refetch the order.
     */
    REALTIME_DRIVER: z.enum(["memory", "supabase"]).default("memory"),
    /** HMAC secret that makes live-update channel names unguessable (32+ chars). */
    REALTIME_CHANNEL_SECRET: z.string().min(32).optional(),
    /**
     * Bearer secret the scheduler (Vercel Cron) sends to /v1/internal/cron/tick (32+ chars).
     * Without it the endpoint answers 404. Required in production.
     */
    CRON_SECRET: z.string().min(32).optional(),
    /**
     * Dispatch pending outbox events right after each successful write request (default on).
     * This is what makes live updates prompt on serverless hosting.
     */
    OUTBOX_KICK_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    /**
     * Run the outbox relay every second in this process (long-running servers). On Vercel set it
     * to false: each write request dispatches its own events and the cron tick catches the rest.
     */
    OUTBOX_RELAY_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    /** Public base URL of this API, used to build upload and download links. */
    API_PUBLIC_URL: z.string().url().optional(),
    /** Private object storage. Only the local development driver exists so far. */
    STORAGE_DRIVER: z.enum(["local"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().min(1).default(".storage"),
    /** HMAC secret for signed file links (32+ chars). Random per process when unset outside production. */
    FILE_SIGNING_SECRET: z.string().min(32).optional(),
    /** Uploaded-file check. Only the basic development checker exists so far. */
    FILE_SCANNER: z.enum(["basic"]).default("basic"),
    PAYMENT_PROVIDER: z.enum(["fake", "tap"]).default("fake"),
    /** Tap test secret key (sk_test_…), only with PAYMENT_PROVIDER=tap. Never commit it. */
    TAP_SECRET_KEY: z
      .string()
      .regex(/^sk_test_[A-Za-z0-9]+$/, "only Tap test keys (sk_test_…) are accepted")
      .optional(),
    /** Where Tap's hosted payment page returns the customer (the customer app). */
    TAP_RETURN_URL: z.url().optional(),
    LIVE_PAYMENTS_ENABLED: booleanFlag,
    /** Webhook signing secret (32+ chars). Random per process when unset outside production. */
    PAYMENT_WEBHOOK_SECRET: z.string().min(32).optional(),
    /** How long a price quote stays valid. Sandbox: docs/07 proposes 5 minutes; confirm before launch. */
    QUOTE_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    /** How long checkout holds a slot place and stock while payment completes. Sandbox value. */
    RESERVATION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    /** How long a branch has to accept a received order before it is cancelled and refunded. Sandbox D10. */
    ACCEPT_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
    /** HMAC secret for handoff codes (32+ chars). Random per process when unset outside production. */
    PICKUP_CODE_SECRET: z.string().min(32).optional(),
    /** HMAC secret for dine-in table QR tokens (32+ chars). Random per process when unset outside production. */
    TABLE_TOKEN_SECRET: z.string().min(32).optional(),
    /**
     * Run the money sweep every 15 s in this process (long-running servers). On Vercel set it to
     * false and let the cron tick run the same sweep every minute.
     */
    CHECKOUT_SWEEP_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    /** Per-actor and per-IP request limits on sensitive routes (docs/10). Must stay on in production. */
    RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    /**
     * Local development sign-in for fictional seed accounts (founder decision D12, 2026-11-28).
     * Off by default and refused with NODE_ENV=production.
     */
    DEV_AUTH_ENABLED: booleanFlag,
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === "tap") {
      for (const key of ["TAP_SECRET_KEY", "TAP_RETURN_URL", "API_PUBLIC_URL"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required with PAYMENT_PROVIDER=tap",
          });
        }
      }
    }
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    // docs/11-testing-deployment.md: refuse the fake provider in production.
    if (env.PAYMENT_PROVIDER === "fake") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message: "the fake payment provider cannot run with NODE_ENV=production",
      });
    }
    // Development-only adapters must never run in production (release blockers until a
    // storage provider and malware scanner are chosen; see docs/13-progress.md).
    if (env.STORAGE_DRIVER === "local") {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_DRIVER"],
        message: "local file storage cannot run with NODE_ENV=production",
      });
    }
    if (env.DEV_AUTH_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["DEV_AUTH_ENABLED"],
        message: "development sign-in cannot run with NODE_ENV=production",
      });
    }
    if (!env.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_ENABLED"],
        message: "rate limits cannot be switched off with NODE_ENV=production",
      });
    }
    if (env.FILE_SCANNER === "basic") {
      ctx.addIssue({
        code: "custom",
        path: ["FILE_SCANNER"],
        message: "the basic file checker cannot run with NODE_ENV=production",
      });
    }
    for (const key of [
      "SUPABASE_JWKS_URL",
      "SUPABASE_JWT_ISSUER",
      "API_PUBLIC_URL",
      "FILE_SIGNING_SECRET",
      "PAYMENT_WEBHOOK_SECRET",
      "PICKUP_CODE_SECRET",
      "TABLE_TOKEN_SECRET",
      "CRON_SECRET",
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "required in production" });
      }
    }
    if (env.REALTIME_DRIVER === "memory") {
      ctx.addIssue({
        code: "custom",
        path: ["REALTIME_DRIVER"],
        message: "in-process live updates cannot reach other instances; use supabase in production",
      });
    }
    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: "an explicit CORS allowlist is required in production",
      });
    }
  })
  .superRefine((env, ctx) => {
    if (env.REALTIME_DRIVER === "supabase") {
      for (const key of [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "REALTIME_CHANNEL_SECRET",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required with REALTIME_DRIVER=supabase",
          });
        }
      }
    }
  })
  .superRefine((env, ctx) => {
    // Live money stays off until decisions D02-D08 are approved (docs/00-decisions.md).
    if (env.LIVE_PAYMENTS_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["LIVE_PAYMENTS_ENABLED"],
        message: "live payments are blocked until decisions D02-D08 are approved",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "EnvValidationError";
  }
}

/**
 * Parses and validates the environment. Error messages name the variable and the rule,
 * never the value, so secrets do not end up in logs.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty values (for example `SUPABASE_URL=` copied from .env.example) as unset.
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = envSchema.safeParse(present);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}
