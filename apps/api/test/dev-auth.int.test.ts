import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  devAccountListResponseSchema,
  devSessionResponseSchema,
  errorResponseSchema,
  profileResponseSchema,
} from "@beans/contracts";
import { SignJWT, generateKeyPair } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEV_ISSUER } from "../src/auth/dev-issuer.js";
import { JWKS } from "../src/auth/token-verifier.js";
import { loadEnv } from "../src/config/env.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";
import { testPrisma } from "./fixtures.js";
import { newSubject, TestIssuer } from "./tokens.js";

describe("development sign-in (D12, local only)", () => {
  let on: INestApplication;
  let off: INestApplication;
  let issuer: TestIssuer;
  const prisma = testPrisma();
  let fictionalId: string;
  let realId: string;

  beforeAll(async () => {
    issuer = await TestIssuer.create();
    const overrides = [{ provide: JWKS, useValue: issuer.jwks }];
    on = await createTestApp(testEnv({ DEV_AUTH_ENABLED: "true" }), { overrides });
    off = await createTestApp(testEnv(), { overrides });
    fictionalId = (
      await prisma.user.create({
        data: { authSubject: `seed-test-${randomUUID()}`, displayName: "Fictional", email: null },
      })
    ).id;
    realId = (await prisma.user.create({ data: { authSubject: newSubject() } })).id;
  });

  afterAll(async () => {
    await on.close();
    await off.close();
    await prisma.$disconnect();
  });

  it("is refused in production by the environment check", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgresql://x@localhost/x",
        NODE_ENV: "production",
        DEV_AUTH_ENABLED: "true",
      }),
    ).toThrow(/DEV_AUTH_ENABLED/);
  });

  it("answers 404 on every route when switched off", async () => {
    await request(off.getHttpServer()).get("/v1/dev-auth/accounts").expect(404);
    await request(off.getHttpServer())
      .post("/v1/dev-auth/sessions")
      .send({ userId: fictionalId })
      .expect(404);
    await request(off.getHttpServer())
      .post("/v1/dev-auth/accounts")
      .send({ displayName: "X", email: "x@example.test" })
      .expect(404);
  });

  it("lists only fictional accounts", async () => {
    const res = await request(on.getHttpServer()).get("/v1/dev-auth/accounts").expect(200);
    const ids = devAccountListResponseSchema.parse(res.body).data.map((a) => a.userId);
    expect(ids).toContain(fictionalId);
    expect(ids).not.toContain(realId);
  });

  it("signs in as a fictional account, with or without the MFA step", async () => {
    const res = await request(on.getHttpServer())
      .post("/v1/dev-auth/sessions")
      .send({ userId: fictionalId, mfa: true })
      .expect(200);
    const session = devSessionResponseSchema.parse(res.body).data;
    expect(session.aal).toBe("aal2");
    const me = await request(on.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .expect(200);
    const profile = profileResponseSchema.parse(me.body).data;
    expect(profile.id).toBe(fictionalId);
    expect(profile.mfaVerified).toBe(true);
  });

  it("never signs in as a real account", async () => {
    await request(on.getHttpServer())
      .post("/v1/dev-auth/sessions")
      .send({ userId: realId })
      .expect(404);
  });

  it("ignores development tokens when switched off", async () => {
    const res = await request(on.getHttpServer())
      .post("/v1/dev-auth/sessions")
      .send({ userId: fictionalId })
      .expect(200);
    const token = devSessionResponseSchema.parse(res.body).data.accessToken;
    const denied = await request(off.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(errorResponseSchema.parse(denied.body).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a forged token that claims the development issuer", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const forged = await new SignJWT({ aal: "aal2" })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(`seed-test-${randomUUID()}`)
      .setIssuer(DEV_ISSUER)
      .setAudience("authenticated")
      .setExpirationTime("5m")
      .sign(privateKey);
    await request(on.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${forged}`)
      .expect(401);
  });

  it("creates a fictional customer, once per email", async () => {
    const email = `new-${randomUUID()}@example.test`;
    const res = await request(on.getHttpServer())
      .post("/v1/dev-auth/accounts")
      .send({ displayName: "New Customer", email })
      .expect(201);
    const session = devSessionResponseSchema.parse(res.body).data;
    const me = await request(on.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .expect(200);
    expect(profileResponseSchema.parse(me.body).data.email).toBe(email);
    await request(on.getHttpServer())
      .post("/v1/dev-auth/accounts")
      .send({ displayName: "Again", email })
      .expect(400);
  });

  it("still accepts real provider tokens when switched on", async () => {
    await request(on.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${await issuer.token({ sub: newSubject() })}`)
      .expect(200);
  });
});
