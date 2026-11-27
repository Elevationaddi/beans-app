import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  type INestApplication,
  Module,
  Post,
} from "@nestjs/common";
import { errorResponseSchema } from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JWKS } from "../src/auth/token-verifier.js";
import { Idempotent } from "../src/idempotency/idempotent.interceptor.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";
import { createUser, testPrisma } from "./fixtures.js";
import { TestIssuer } from "./tokens.js";

/** Test-only route exercising the interceptor. It is not part of the real API. */
const calls = { count: 0, failNext: false };

@Controller("test-idempotency")
class IdempotencyProbeController {
  @Post()
  @Idempotent()
  async create(@Body() body: { amount: number }) {
    calls.count += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (calls.failNext) {
      calls.failNext = false;
      throw new HttpException("temporary failure", HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { data: { run: calls.count, amount: body.amount } };
  }
}

@Module({ controllers: [IdempotencyProbeController] })
class ProbeModule {}

describe("idempotent writes", () => {
  let app: INestApplication;
  let issuer: TestIssuer;
  let token: string;
  let otherToken: string;
  const prisma = testPrisma();

  beforeAll(async () => {
    issuer = await TestIssuer.create();
    app = await createTestApp(testEnv(), {
      overrides: [{ provide: JWKS, useValue: issuer.jwks }],
      extraImports: [ProbeModule],
    });
    token = await issuer.token({ sub: (await createUser(prisma)).authSubject });
    otherToken = await issuer.token({ sub: (await createUser(prisma)).authSubject });
  });

  beforeEach(() => {
    calls.count = 0;
    calls.failNext = false;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const post = (key: string | null, body: object, bearer = token) => {
    const req = request(app.getHttpServer())
      .post("/v1/test-idempotency")
      .set("Authorization", `Bearer ${bearer}`);
    return (key ? req.set("Idempotency-Key", key) : req).send(body);
  };
  const newKey = () => `key-${crypto.randomUUID()}`;

  it("requires an Idempotency-Key header", async () => {
    const response = await post(null, { amount: 1 }).expect(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    await post("short", { amount: 1 }).expect(400);
    expect(calls.count).toBe(0);
  });

  it("replays the stored outcome for the same key and body", async () => {
    const key = newKey();
    const first = await post(key, { amount: 5 }).expect(201);
    const second = await post(key, { amount: 5 }).expect(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(calls.count).toBe(1);
  });

  it("treats key order in the body as the same request", async () => {
    const key = newKey();
    await post(key, { amount: 5, note: "x" }).expect(201);
    await post(key, { note: "x", amount: 5 }).expect(201);
    expect(calls.count).toBe(1);
  });

  it("rejects the same key with a different body", async () => {
    const key = newKey();
    await post(key, { amount: 5 }).expect(201);
    const response = await post(key, { amount: 6 }).expect(409);
    expect(errorResponseSchema.parse(response.body).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(calls.count).toBe(1);
  });

  it("scopes keys per actor", async () => {
    const key = newKey();
    await post(key, { amount: 5 }).expect(201);
    await post(key, { amount: 5 }, otherToken).expect(201);
    expect(calls.count).toBe(2);
  });

  it("runs the handler once under concurrent duplicates", async () => {
    const key = newKey();
    const responses = await Promise.all(Array.from({ length: 6 }, () => post(key, { amount: 9 })));
    expect(calls.count).toBe(1);
    for (const response of responses) {
      if (response.status === 409) {
        expect(errorResponseSchema.parse(response.body).error.code).toBe("REQUEST_IN_PROGRESS");
      } else {
        expect(response.status).toBe(201);
      }
    }
    expect(responses.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
  });

  it("releases the key when the handler fails, so a retry runs", async () => {
    const key = newKey();
    calls.failNext = true;
    await post(key, { amount: 3 }).expect(503);
    await post(key, { amount: 3 }).expect(201);
    expect(calls.count).toBe(2);
  });
});
