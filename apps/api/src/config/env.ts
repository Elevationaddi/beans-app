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
    REDIS_URL: z
      .string()
      .url()
      .refine((value) => /^rediss?:\/\//.test(value), "must be a redis:// or rediss:// URL"),
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
    /** Poll the outbox and publish to BullMQ from this process. */
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
    /** Consume outbox jobs (file checks) in this process. */
    OUTBOX_WORKER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    PAYMENT_PROVIDER: z.enum(["fake"]).default("fake"),
    LIVE_PAYMENTS_ENABLED: booleanFlag,
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
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "required in production" });
      }
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
