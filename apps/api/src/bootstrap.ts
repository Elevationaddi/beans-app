import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { requestIdMiddleware } from "./common/request-id.middleware.js";
import type { Env } from "./config/env.js";

/** HTTP wiring shared by the server and the test suite. */
export function configureApp(app: INestApplication, env: Env): INestApplication {
  app.use(requestIdMiddleware);
  app.setGlobalPrefix("v1", { exclude: ["health", "health/live"] });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: false });
  app.enableShutdownHooks();
  return app;
}

export function loggerLevels(env: Env) {
  return env.NODE_ENV === "test" ? (["error"] as const) : (["log", "error", "warn"] as const);
}

/** Builds the HTTP application without listening. */
export async function createApp(env: Env): Promise<INestApplication> {
  // rawBody keeps the exact bytes of JSON requests for webhook signature checks.
  const app = await NestFactory.create(AppModule.forRoot(env), {
    logger: [...loggerLevels(env)],
    rawBody: true,
  });
  return configureApp(app, env);
}
