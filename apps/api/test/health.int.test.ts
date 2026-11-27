import type { INestApplication } from "@nestjs/common";
import { healthResponseSchema, livenessResponseSchema } from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { testEnv } from "./env.js";

// Needs the local PostgreSQL and Redis from docker-compose.yml (or CI service containers).
describe("GET /health with real PostgreSQL and Redis", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(testEnv());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports ok when the database and Redis are reachable", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    const body = healthResponseSchema.parse(response.body);
    expect(body.status).toBe("ok");
    expect(body.checks).toEqual({ database: "up", redis: "up" });
  });

  it("answers liveness without checking dependencies", async () => {
    const response = await request(app.getHttpServer()).get("/health/live").expect(200);
    expect(livenessResponseSchema.parse(response.body)).toEqual({ status: "ok" });
  });
});

describe("GET /health when Redis is unreachable", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Port 1 is reserved and never runs Redis, so the connection is refused.
    app = await createApp(testEnv({ REDIS_URL: "redis://127.0.0.1:1" }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers 503 and names the failing dependency", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(503);
    const body = healthResponseSchema.parse(response.body);
    expect(body.status).toBe("degraded");
    expect(body.checks).toEqual({ database: "up", redis: "down" });
  });
});
