import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import type { Env } from "./config/env.js";

/** Builds the HTTP application without listening, so tests can use the same wiring. */
export async function createApp(env: Env): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(env), {
    logger: env.NODE_ENV === "test" ? ["error", "warn"] : ["log", "error", "warn"],
  });
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: false });
  app.enableShutdownHooks();
  return app;
}
