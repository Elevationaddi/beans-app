import type { IncomingMessage, ServerResponse } from "node:http";
import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap.js";
import { EnvValidationError, loadEnv } from "./config/env.js";

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let ready: Promise<NodeHandler> | undefined;

/**
 * Builds the Nest application once per function instance and reuses it for every request the
 * instance serves (Vercel Fluid compute runs many requests per instance). Nothing listens on a
 * port: Vercel hands each request to the Express instance underneath Nest.
 */
async function build(): Promise<NodeHandler> {
  const env = loadEnv();
  const app = await createApp(env);
  await app.init();
  Logger.log(`API ready on Vercel (${env.NODE_ENV})`, "Bootstrap");
  return app.getHttpAdapter().getInstance() as NodeHandler;
}

/** Vercel Node.js function entry point (see api/index.mjs and vercel.json). */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  ready ??= build().catch((error: unknown) => {
    // Let the next request retry instead of caching a failed start.
    ready = undefined;
    throw error;
  });
  let app: NodeHandler;
  try {
    app = await ready;
  } catch (error) {
    // Configuration errors list variable names only, never values.
    console.error(error instanceof EnvValidationError ? error.message : "API failed to start");
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        error: { code: "UNAVAILABLE", message: "Service unavailable", requestId: "startup" },
      }),
    );
    return;
  }
  app(req, res);
}
