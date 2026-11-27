import { z } from "zod";
import { healthResponseSchema, livenessResponseSchema } from "../health.js";
import { auditListResponseSchema, auditQuerySchema } from "./admin-audit.js";
import { errorResponseSchema, pageQuerySchema, uuidSchema } from "./common.js";
import { profileResponseSchema, updateProfileRequestSchema } from "./me.js";
import {
  merchantBranchListResponseSchema,
  merchantBranchResponseSchema,
} from "./merchant-branches.js";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** Who may call a route. Authority always comes from the verified token plus the database. */
export type RouteAccess =
  | { kind: "public" }
  | { kind: "signed_in" }
  | { kind: "merchant"; note: string }
  | { kind: "admin"; roles: readonly string[] };

export interface RouteContract {
  method: HttpMethod;
  /** OpenAPI path template, for example `/v1/merchant/branches/{id}`. */
  path: string;
  operationId: string;
  summary: string;
  tag: string;
  access: RouteAccess;
  /** Route requires an `Idempotency-Key` header (docs/07 conventions). */
  idempotent?: boolean;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Success status and body schema. */
  success: { status: number; schema: z.ZodType };
  /** Error statuses this route can return, besides 500. */
  errors: number[];
}

const idParams = z.strictObject({ id: uuidSchema });

/**
 * Every HTTP route the API exposes. The API test suite checks that NestJS registers exactly
 * these routes, and `pnpm --filter @beans/contracts openapi` renders them to openapi.json.
 */
export const apiRoutes = [
  {
    method: "get",
    path: "/health",
    operationId: "getHealth",
    summary: "Readiness: database and Redis reachable",
    tag: "Health",
    access: { kind: "public" },
    success: { status: 200, schema: healthResponseSchema },
    errors: [503],
  },
  {
    method: "get",
    path: "/health/live",
    operationId: "getLiveness",
    summary: "Liveness: the process is running",
    tag: "Health",
    access: { kind: "public" },
    success: { status: 200, schema: livenessResponseSchema },
    errors: [],
  },
  {
    method: "get",
    path: "/v1/me",
    operationId: "getMe",
    summary: "Current user's profile, memberships and admin roles",
    tag: "Identity",
    access: { kind: "signed_in" },
    success: { status: 200, schema: profileResponseSchema },
    errors: [401, 403],
  },
  {
    method: "patch",
    path: "/v1/me",
    operationId: "updateMe",
    summary: "Update display name or language",
    tag: "Identity",
    access: { kind: "signed_in" },
    body: updateProfileRequestSchema,
    success: { status: 200, schema: profileResponseSchema },
    errors: [400, 401, 403],
  },
  {
    method: "get",
    path: "/v1/merchant/branches",
    operationId: "listMerchantBranches",
    summary: "Branches the caller may operate, across their merchants",
    tag: "Merchant",
    access: {
      kind: "merchant",
      note: "Owners see every branch of their merchants; other roles see assigned branches.",
    },
    query: pageQuerySchema,
    success: { status: 200, schema: merchantBranchListResponseSchema },
    errors: [400, 401, 403],
  },
  {
    method: "get",
    path: "/v1/merchant/branches/{id}",
    operationId: "getMerchantBranch",
    summary: "One branch the caller may operate",
    tag: "Merchant",
    access: { kind: "merchant", note: "Out-of-scope branches answer 404." },
    params: idParams,
    success: { status: 200, schema: merchantBranchResponseSchema },
    errors: [400, 401, 403, 404],
  },
  {
    method: "get",
    path: "/v1/admin/audit",
    operationId: "listAuditEvents",
    summary: "Redacted audit trail (each read is itself audited)",
    tag: "Admin",
    access: { kind: "admin", roles: ["security"] },
    query: auditQuerySchema,
    success: { status: 200, schema: auditListResponseSchema },
    errors: [400, 401, 403],
  },
] as const satisfies readonly RouteContract[];

export { errorResponseSchema };
