import { z } from "zod";
import { healthResponseSchema, livenessResponseSchema } from "../health.js";
import { auditListResponseSchema, auditQuerySchema } from "./admin-audit.js";
import {
  adminMerchantDetailResponseSchema,
  adminMerchantListResponseSchema,
  adminMerchantQuerySchema,
  reviewMerchantRequestSchema,
} from "./admin-merchants.js";
import { errorResponseSchema, pageQuerySchema, uuidSchema } from "./common.js";
import {
  createApplicationRequestSchema,
  merchantApplicationListResponseSchema,
  merchantApplicationResponseSchema,
  submitApplicationRequestSchema,
  updateApplicationRequestSchema,
} from "./merchant-applications.js";
import {
  createUploadRequestSchema,
  documentMimeSchema,
  signedTokenQuerySchema,
  uploadResponseSchema,
  uploadTicketResponseSchema,
} from "./uploads.js";
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
  /** Raw (non-JSON) request body, with the accepted media types. */
  rawBody?: readonly string[];
  /** Success status and body: a JSON schema, or `binary` for a file download. */
  success: { status: number; schema: z.ZodType } | { status: number; binary: true };
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
  {
    method: "post",
    path: "/v1/merchant/applications",
    operationId: "createMerchantApplication",
    summary: "Start a merchant application; the caller becomes its owner",
    tag: "Merchant onboarding",
    access: { kind: "signed_in" },
    body: createApplicationRequestSchema,
    success: { status: 201, schema: merchantApplicationResponseSchema },
    errors: [400, 401, 403, 409],
  },
  {
    method: "get",
    path: "/v1/merchant/applications",
    operationId: "listMerchantApplications",
    summary: "Applications the caller owns",
    tag: "Merchant onboarding",
    access: { kind: "signed_in" },
    query: pageQuerySchema,
    success: { status: 200, schema: merchantApplicationListResponseSchema },
    errors: [400, 401, 403],
  },
  {
    method: "get",
    path: "/v1/merchant/applications/{id}",
    operationId: "getMerchantApplication",
    summary: "One application the caller owns, with documents and reviewer note",
    tag: "Merchant onboarding",
    access: { kind: "merchant", note: "Owner of the merchant only." },
    params: idParams,
    success: { status: 200, schema: merchantApplicationResponseSchema },
    errors: [400, 401, 403, 404],
  },
  {
    method: "patch",
    path: "/v1/merchant/applications/{id}",
    operationId: "updateMerchantApplication",
    summary: "Edit a draft application (including after corrections are requested)",
    tag: "Merchant onboarding",
    access: { kind: "merchant", note: "Owner of the merchant only; draft status only." },
    params: idParams,
    body: updateApplicationRequestSchema,
    success: { status: 200, schema: merchantApplicationResponseSchema },
    errors: [400, 401, 403, 404, 409],
  },
  {
    method: "post",
    path: "/v1/merchant/applications/{id}/submit",
    operationId: "submitMerchantApplication",
    summary: "Submit a draft for review with checked documents (one trade licence required)",
    tag: "Merchant onboarding",
    access: { kind: "merchant", note: "Owner of the merchant only." },
    params: idParams,
    body: submitApplicationRequestSchema,
    success: { status: 200, schema: merchantApplicationResponseSchema },
    errors: [400, 401, 403, 404, 409, 422],
  },
  {
    method: "post",
    path: "/v1/uploads",
    operationId: "createUpload",
    summary: "Get a short-lived link to upload one file to private storage",
    tag: "Files",
    access: { kind: "merchant", note: "Merchant documents: owner of that merchant only." },
    body: createUploadRequestSchema,
    success: { status: 201, schema: uploadTicketResponseSchema },
    errors: [400, 401, 403, 404, 409],
  },
  {
    method: "put",
    path: "/v1/uploads/{id}/content",
    operationId: "putUploadContent",
    summary: "Local development storage only: receive the bytes for a signed upload link",
    tag: "Files",
    access: { kind: "public" },
    params: idParams,
    query: signedTokenQuerySchema,
    rawBody: documentMimeSchema.options,
    success: { status: 200, schema: uploadResponseSchema },
    errors: [400, 403, 404, 409, 413],
  },
  {
    method: "post",
    path: "/v1/uploads/{id}/complete",
    operationId: "completeUpload",
    summary: "Confirm the upload; the file is quarantined until the automatic check passes",
    tag: "Files",
    access: { kind: "merchant", note: "The uploader only." },
    params: idParams,
    success: { status: 200, schema: uploadResponseSchema },
    errors: [400, 401, 403, 404, 409],
  },
  {
    method: "get",
    path: "/v1/uploads/{id}/download",
    operationId: "downloadUpload",
    summary: "Local development storage only: download through a short-lived signed link",
    tag: "Files",
    access: { kind: "public" },
    params: idParams,
    query: signedTokenQuerySchema,
    success: { status: 200, binary: true },
    errors: [400, 403, 404],
  },
  {
    method: "get",
    path: "/v1/admin/merchants",
    operationId: "listAdminMerchants",
    summary: "Merchant applications and accounts, oldest submission first",
    tag: "Admin",
    access: { kind: "admin", roles: ["operations"] },
    query: adminMerchantQuerySchema,
    success: { status: 200, schema: adminMerchantListResponseSchema },
    errors: [400, 401, 403],
  },
  {
    method: "get",
    path: "/v1/admin/merchants/{id}",
    operationId: "getAdminMerchant",
    summary: "Application details with short-lived document links (audited)",
    tag: "Admin",
    access: { kind: "admin", roles: ["operations"] },
    params: idParams,
    success: { status: 200, schema: adminMerchantDetailResponseSchema },
    errors: [400, 401, 403, 404],
  },
  {
    method: "post",
    path: "/v1/admin/merchants/{id}/review",
    operationId: "reviewMerchant",
    summary:
      "Review decision with a mandatory reason: start review, approve, reject, request changes, suspend, reinstate",
    tag: "Admin",
    access: { kind: "admin", roles: ["operations"] },
    params: idParams,
    body: reviewMerchantRequestSchema,
    success: { status: 200, schema: adminMerchantDetailResponseSchema },
    errors: [400, 401, 403, 404, 409, 422],
  },
] as const satisfies readonly RouteContract[];

export { errorResponseSchema };
