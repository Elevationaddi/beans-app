import { z } from "zod";
import { errorResponseSchema } from "./api/common.js";
import { apiRoutes, type RouteContract } from "./api/routes.js";

type JsonSchema = Record<string, unknown>;

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  400: "Malformed request or failed validation",
  401: "Missing, invalid or expired access token",
  403: "Authenticated but not permitted (role, MFA or account status)",
  404: "Not found or outside the caller's scope",
  413: "Payload larger than allowed",
  409: "Conflict (stale version or idempotency key reuse)",
  422: "Semantically invalid",
  429: "Rate limited",
  503: "Temporarily unavailable",
};

function toSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const json = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as JsonSchema;
  delete json.$schema;
  return json;
}

function parametersFor(route: RouteContract): JsonSchema[] {
  const params: JsonSchema[] = [];
  for (const [location, object] of [
    ["path", route.params],
    ["query", route.query],
  ] as const) {
    if (!object) continue;
    const json = toSchema(object, "input") as {
      properties?: Record<string, JsonSchema>;
      required?: string[];
    };
    for (const [name, schema] of Object.entries(json.properties ?? {})) {
      params.push({
        name,
        in: location,
        required: location === "path" || (json.required ?? []).includes(name),
        schema,
      });
    }
  }
  if (route.idempotent) {
    params.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" },
    });
  }
  return params;
}

/** Renders the route registry as an OpenAPI 3.1 document. Deterministic output. */
export function buildOpenApiDocument(version: string): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  const errorSchema = toSchema(errorResponseSchema, "output");

  for (const route of apiRoutes as readonly RouteContract[]) {
    const success = route.success;
    const responses: Record<string, JsonSchema> = {
      [success.status]: {
        description: STATUS_TEXT[success.status] ?? "Success",
        content:
          "binary" in success
            ? { "application/octet-stream": { schema: { type: "string", format: "binary" } } }
            : "eventStream" in success
              ? {
                  "text/event-stream": {
                    schema: { type: "string" },
                    "x-event-data": toSchema(success.eventStream, "output"),
                  },
                }
              : { "application/json": { schema: toSchema(success.schema, "output") } },
      },
    };
    for (const status of route.errors) {
      // The health endpoint answers 503 with its own body so load balancers can read it.
      const schema =
        route.path.startsWith("/health") && status === 503 && "schema" in success
          ? toSchema(success.schema, "output")
          : { $ref: "#/components/schemas/ErrorResponse" };
      responses[status] = {
        description: STATUS_TEXT[status] ?? "Error",
        content: { "application/json": { schema } },
      };
    }

    const operation: JsonSchema = {
      operationId: route.operationId,
      summary: route.summary,
      tags: [route.tag],
      "x-access": route.access,
      responses,
    };
    if (route.access.kind !== "public") operation.security = [{ bearerAuth: [] }];
    const parameters = parametersFor(route);
    if (parameters.length > 0) operation.parameters = parameters;
    if (route.rawBody) {
      operation.requestBody = {
        required: true,
        content: Object.fromEntries(
          route.rawBody.map((type) => [type, { schema: { type: "string", format: "binary" } }]),
        ),
      };
    }
    if (route.body) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: toSchema(route.body, "input") } },
      };
    }
    (paths[route.path] ??= {})[route.method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Coffee Marketplace API",
      version,
      description:
        "Generated from packages/contracts/src/api/routes.ts. Amounts are integer fils encoded as decimal strings; timestamps are RFC 3339 UTC.",
    },
    servers: [{ url: "http://localhost:3000", description: "Local development" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Supabase Auth access token. Admin routes also need an aal2 (MFA) session.",
        },
      },
      schemas: { ErrorResponse: errorSchema },
    },
    paths,
  };
}
