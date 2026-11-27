import type { INestApplication } from "@nestjs/common";
import {
  auditListResponseSchema,
  errorResponseSchema,
  profileResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JWKS } from "../src/auth/token-verifier.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";
import { createUser, testPrisma } from "./fixtures.js";
import { TestIssuer } from "./tokens.js";

describe("admin access: roles from the database and MFA", () => {
  let app: INestApplication;
  let issuer: TestIssuer;
  const prisma = testPrisma();

  beforeAll(async () => {
    issuer = await TestIssuer.create();
    app = await createTestApp(testEnv(), { overrides: [{ provide: JWKS, useValue: issuer.jwks }] });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const audit = (token: string, query = "") =>
    request(app.getHttpServer())
      .get(`/v1/admin/audit${query}`)
      .set("Authorization", `Bearer ${token}`);

  async function admin(role?: "security" | "operations" | "super_admin") {
    const user = await createUser(prisma);
    if (role) await prisma.adminRole.create({ data: { userId: user.id, role } });
    return user;
  }

  it("denies a user without an admin role", async () => {
    const user = await admin();
    const response = await audit(await issuer.token({ sub: user.authSubject, aal: "aal2" })).expect(
      403,
    );
    expect(errorResponseSchema.parse(response.body).error.code).toBe("FORBIDDEN");
  });

  it("requires MFA (aal2) for an admin with the right role", async () => {
    const user = await admin("security");
    const response = await audit(await issuer.token({ sub: user.authSubject, aal: "aal1" })).expect(
      403,
    );
    expect(errorResponseSchema.parse(response.body).error.code).toBe("MFA_REQUIRED");
  });

  it("denies other admin roles, with no implicit super_admin bypass", async () => {
    for (const role of ["operations", "super_admin"] as const) {
      const user = await admin(role);
      await audit(await issuer.token({ sub: user.authSubject, aal: "aal2" })).expect(403);
    }
  });

  it("lets a security admin with MFA read the trail, and audits that read", async () => {
    const user = await admin("security");
    const token = await issuer.token({ sub: user.authSubject, aal: "aal2" });
    await audit(token, `?actorId=${user.id}`).expect(200);
    const second = auditListResponseSchema.parse(
      (await audit(token, `?actorId=${user.id}`).expect(200)).body,
    );
    expect(second.data[0]).toMatchObject({
      action: "audit.viewed",
      actorId: user.id,
      targetType: "audit_log",
    });
  });

  it("revoking the admin role takes effect on the next request", async () => {
    const user = await admin("security");
    const token = await issuer.token({ sub: user.authSubject, aal: "aal2" });
    await audit(token).expect(200);
    await prisma.adminRole.deleteMany({ where: { userId: user.id } });
    await audit(token).expect(403);
  });
});

describe("profile updates are audited with redaction", () => {
  let app: INestApplication;
  let issuer: TestIssuer;
  const prisma = testPrisma();

  beforeAll(async () => {
    issuer = await TestIssuer.create();
    app = await createTestApp(testEnv(), { overrides: [{ provide: JWKS, useValue: issuer.jwks }] });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("updates the profile and records a masked before/after audit event", async () => {
    const user = await createUser(prisma);
    const token = await issuer.token({ sub: user.authSubject });
    const response = await request(app.getHttpServer())
      .patch("/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Request-Id", "req-profile-test-1")
      .send({ displayName: "Mona Test", locale: "ar" })
      .expect(200);
    expect(profileResponseSchema.parse(response.body).data).toMatchObject({
      displayName: "Mona Test",
      locale: "ar",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { actorId: user.id, action: "user.profile_updated" },
    });
    expect(event.requestId).toBe("req-profile-test-1");
    expect(event.beforeRedacted).toEqual({ displayName: null, locale: "en" });
    expect(event.afterRedacted).toEqual({ displayName: "M*******t", locale: "ar" });
  });

  it("rejects unknown fields and empty updates with field errors", async () => {
    const user = await createUser(prisma);
    const token = await issuer.token({ sub: user.authSubject });
    const unknown = await request(app.getHttpServer())
      .patch("/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ locale: "en", status: "active" })
      .expect(400);
    const body = errorResponseSchema.parse(unknown.body);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fieldErrors).toBeDefined();
    await request(app.getHttpServer())
      .patch("/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(400);
    expect(await prisma.auditEvent.count({ where: { actorId: user.id } })).toBe(0);
  });

  it("the audit table rejects updates and deletes", async () => {
    const user = await createUser(prisma);
    const event = await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "test",
        targetType: "user",
        targetId: user.id,
        requestId: "r",
      },
    });
    await expect(
      prisma.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.$executeRawUnsafe('TRUNCATE "audit_events"')).rejects.toThrow(
      /append-only/,
    );
  });
});
