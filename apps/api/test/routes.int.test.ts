import { type INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { DiscoveryModule, DiscoveryService, MetadataScanner } from "@nestjs/core";
import { apiRoutes } from "@beans/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";

const UNPREFIXED = new Set(["health"]);

function join(...parts: string[]): string {
  const path = parts
    .flatMap((part) => part.split("/"))
    .filter(Boolean)
    .map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment))
    .join("/");
  return `/${path}`;
}

describe("route registry matches the running API", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp(testEnv(), { extraImports: [DiscoveryModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it("every Nest route is in packages/contracts apiRoutes and vice versa", () => {
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const registered: string[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance || !wrapper.metatype) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, wrapper.metatype) ?? "");
      const prefix = UNPREFIXED.has(base.split("/")[0] ?? "") ? "" : "v1";
      for (const name of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
        const handler = (instance as Record<string, unknown>)[name];
        const path = Reflect.getMetadata(PATH_METADATA, handler as object) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler as object) as
          RequestMethod | undefined;
        if (path === undefined || method === undefined) continue;
        registered.push(`${RequestMethod[method].toLowerCase()} ${join(prefix, base, path)}`);
      }
    }

    const declared = apiRoutes.map((route) => `${route.method} ${route.path}`);
    expect(registered.sort()).toEqual([...declared].sort());
  });
});
