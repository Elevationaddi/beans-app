import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { requestIdMiddleware } from "./common/request-id.middleware.js";
import { OutboxRelayService } from "./outbox/outbox-relay.service.js";
import type { Env } from "./config/env.js";
import { securityHeaders } from "./security/security-headers.js";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * After a successful write request (its transaction has committed and the response is sent),
 * dispatches pending outbox events straight away, so live order updates do not wait for the
 * next cron tick on serverless hosting where no background loop runs.
 */
export function outboxKick(relay: Pick<OutboxRelayService, "kick">) {
  return (
    req: { method?: string },
    res: { statusCode: number; on(event: "finish", listener: () => void): void },
    next: () => void,
  ) => {
    if (WRITES.has(req.method ?? "GET")) {
      res.on("finish", () => {
        if (res.statusCode < 400) relay.kick();
      });
    }
    next();
  };
}

/** HTTP wiring shared by the server and the test suite. */
export function configureApp(app: INestApplication, env: Env): INestApplication {
  app.use(requestIdMiddleware);
  app.use(securityHeaders(env));
  if (env.OUTBOX_KICK_ENABLED) app.use(outboxKick(app.get(OutboxRelayService)));
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
