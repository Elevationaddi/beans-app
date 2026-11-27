import { describe, expect, it } from "vitest";
import { apiRoutes } from "./api/routes.js";
import { buildOpenApiDocument } from "./openapi.js";

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument("test") as {
    openapi: string;
    paths: Record<
      string,
      Record<string, { security?: unknown; responses: Record<string, unknown> }>
    >;
  };

  it("renders every registered route", () => {
    expect(doc.openapi).toBe("3.1.0");
    for (const route of apiRoutes) {
      expect(doc.paths[route.path]?.[route.method], `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it("requires a bearer token on every non-public route", () => {
    for (const route of apiRoutes) {
      const operation = doc.paths[route.path]![route.method]!;
      if (route.access.kind === "public") expect(operation.security).toBeUndefined();
      else expect(operation.security).toEqual([{ bearerAuth: [] }]);
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildOpenApiDocument("x"))).toBe(
      JSON.stringify(buildOpenApiDocument("x")),
    );
  });
});
