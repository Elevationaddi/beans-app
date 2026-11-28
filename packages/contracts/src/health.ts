import { z } from "zod";

/** State of a single dependency checked by the API health endpoint. */
export const dependencyStatusSchema = z.enum(["up", "down"]);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

/**
 * Response body of `GET /health`.
 * `status` is "ok" only when every dependency is up; otherwise the API answers HTTP 503
 * with status "degraded" so load balancers stop routing traffic to it.
 */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  time: z.iso.datetime(),
  checks: z.object({
    database: dependencyStatusSchema,
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Response body of `GET /health/live`: the process is running, dependencies not checked. */
export const livenessResponseSchema = z.object({ status: z.literal("ok") });
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
