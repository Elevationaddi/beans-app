import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, profileResponseSchema } from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JWKS } from "../src/auth/token-verifier.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";
import { testPrisma } from "./fixtures.js";
import { newSubject, TestIssuer } from "./tokens.js";

describe("access token verification", () => {
  let app: INestApplication;
  let issuer: TestIssuer;
  let impostor: TestIssuer;
  const prisma = testPrisma();

  beforeAll(async () => {
    issuer = await TestIssuer.create();
    impostor = await TestIssuer.create();
    app = await createTestApp(testEnv(), { overrides: [{ provide: JWKS, useValue: issuer.jwks }] });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const getMe = (token?: string) => {
    const req = request(app.getHttpServer()).get("/v1/me");
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  };

  async function expectUnauthenticated(token?: string) {
    const response = await getMe(token).expect(401);
    const body = errorResponseSchema.parse(response.body);
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  }

  it("rejects a request without a token", () => expectUnauthenticated());

  it("rejects a malformed Authorization header", async () => {
    await getMe().set("Authorization", "Basic abc").expect(401);
  });

  it("rejects a token signed by another key", async () => {
    await expectUnauthenticated(await impostor.token({ sub: newSubject() }));
  });

  it("rejects the wrong issuer", async () => {
    await expectUnauthenticated(
      await issuer.token({ sub: newSubject() }, { issuer: "https://evil.example" }),
    );
  });

  it("rejects the wrong audience", async () => {
    await expectUnauthenticated(
      await issuer.token({ sub: newSubject() }, { audience: "service_role" }),
    );
  });

  it("rejects an expired token", async () => {
    await expectUnauthenticated(
      await issuer.token({ sub: newSubject() }, { expiresIn: Math.floor(Date.now() / 1000) - 60 }),
    );
  });

  it("rejects a token that is not valid yet", async () => {
    await expectUnauthenticated(
      await issuer.token({ sub: newSubject() }, { notBefore: Math.floor(Date.now() / 1000) + 600 }),
    );
  });

  it("rejects an unsigned token (alg none)", async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "none" })}.${encode({ sub: newSubject(), aud: "authenticated", exp: 9999999999 })}.`;
    await expectUnauthenticated(unsigned);
  });

  it("creates the user on first sign-in and returns the profile", async () => {
    const sub = newSubject();
    const response = await getMe(await issuer.token({ sub, email: "first@example.test" })).expect(
      200,
    );
    const { data } = profileResponseSchema.parse(response.body);
    expect(data).toMatchObject({
      email: "first@example.test",
      memberships: [],
      adminRoles: [],
      mfaVerified: false,
    });
    expect(await prisma.user.count({ where: { authSubject: sub } })).toBe(1);
  });

  it("creates exactly one user when first requests race", async () => {
    const sub = newSubject();
    const token = await issuer.token({ sub });
    const responses = await Promise.all(Array.from({ length: 5 }, () => getMe(token)));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await prisma.user.count({ where: { authSubject: sub } })).toBe(1);
  });

  it("ignores role claims in the token", async () => {
    const token = await issuer.token({
      sub: newSubject(),
      aal: "aal2",
      role: "service_role",
      app_metadata: { roles: ["super_admin"], merchantId: "anything" },
    });
    const { data } = profileResponseSchema.parse((await getMe(token).expect(200)).body);
    expect(data.adminRoles).toEqual([]);
    expect(data.memberships).toEqual([]);
    await request(app.getHttpServer())
      .get("/v1/admin/audit")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("blocks a suspended user immediately, even with a valid token", async () => {
    const sub = newSubject();
    const token = await issuer.token({ sub });
    await getMe(token).expect(200);
    await prisma.user.update({ where: { authSubject: sub }, data: { status: "suspended" } });
    const response = await getMe(token).expect(403);
    expect(errorResponseSchema.parse(response.body).error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("keeps the health endpoints public", async () => {
    await request(app.getHttpServer()).get("/health/live").expect(200);
  });
});

describe("token verification not configured", () => {
  it("answers 401 for every token instead of trusting it", async () => {
    const issuer = await TestIssuer.create();
    const app = await createTestApp(testEnv({ SUPABASE_JWT_ISSUER: "" }), {
      overrides: [{ provide: JWKS, useValue: null }],
    });
    try {
      await request(app.getHttpServer())
        .get("/v1/me")
        .set("Authorization", `Bearer ${await issuer.token({ sub: newSubject() })}`)
        .expect(401);
    } finally {
      await app.close();
    }
  });
});
