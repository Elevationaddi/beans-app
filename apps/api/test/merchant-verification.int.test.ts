import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  adminMerchantDetailResponseSchema,
  createVerifiedMerchantResponseSchema,
  errorResponseSchema,
  merchantApplicationResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JWKS } from "../src/auth/token-verifier.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";
import { createUser, testPrisma } from "./fixtures.js";
import { TestIssuer } from "./tokens.js";

/**
 * Cycle 4: manual merchant verification. No malware scanner is approved, so applications carry
 * no attachments and an administrator records a manual licence check before approving.
 */
describe("manual merchant verification (document uploads off)", () => {
  let app: INestApplication;
  let issuer: TestIssuer;
  const prisma = testPrisma();

  beforeAll(async () => {
    issuer = await TestIssuer.create();
    app = await createTestApp(testEnv({ FILE_SCANNER: "disabled" }), {
      overrides: [{ provide: JWKS, useValue: issuer.jwks }],
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function person(adminRole?: "operations" | "support") {
    const user = await prisma.user.update({
      where: { id: (await createUser(prisma)).id },
      data: { email: `p-${randomUUID().slice(0, 8)}@example.test`, displayName: "Test Person" },
    });
    if (adminRole) await prisma.adminRole.create({ data: { userId: user.id, role: adminRole } });
    return {
      user,
      token: await issuer.token({ sub: user.authSubject, aal: adminRole ? "aal2" : "aal1" }),
    };
  }

  const licence = () => `LIC-${randomUUID().slice(0, 12)}`;
  const fullApplication = (licenseNumber = licence()) => ({
    legalName: "Fictional Beans Trading LLC",
    brandName: "Fictional Beans",
    licenseNumber,
    contact: { name: "Owner", email: "owner@example.test", phone: "+971 50 000 0000" },
    licenseAuthority: "Abu Dhabi Department of Economic Development (fictional)",
    licenseExpiresOn: "2031-06-30",
    emirate: "abu_dhabi",
    representative: {
      name: "Owner",
      position: "Managing partner",
      email: "owner@example.test",
      phone: "+971 50 000 0000",
    },
    declaredBranchCount: 3,
    description: "Fictional specialty café for tests",
  });

  async function submitted(owner: { token: string }, body = fullApplication()) {
    const created = merchantApplicationResponseSchema.parse(
      (await http().post("/v1/merchant/applications").set(auth(owner.token)).send(body).expect(201))
        .body,
    ).data;
    await http()
      .post(`/v1/merchant/applications/${created.id}/submit`)
      .set(auth(owner.token))
      .send({})
      .expect(200);
    return created;
  }

  const verification = (licenseNumber: string, overrides: Record<string, unknown> = {}) => ({
    verifiedOn: "2026-11-01",
    licenseNumber,
    licenseAuthority: "Abu Dhabi Department of Economic Development (fictional)",
    licenseExpiresOn: "2031-06-30",
    source: "Checked by hand on the issuing authority's public register",
    notes: "Name and activity match the application",
    ...overrides,
  });

  it("tells the applicant that attachments are off and asks for every detail before submitting", async () => {
    const owner = await person();
    const draft = merchantApplicationResponseSchema.parse(
      (
        await http()
          .post("/v1/merchant/applications")
          .set(auth(owner.token))
          .send({
            legalName: "Half Done LLC",
            brandName: "Half Done",
            licenseNumber: licence(),
            contact: { name: "Owner", email: "owner@example.test", phone: "+971 50 000 0000" },
          })
          .expect(201)
      ).body,
    ).data;
    expect(draft.documentsAccepted).toBe(false);

    const incomplete = await http()
      .post(`/v1/merchant/applications/${draft.id}/submit`)
      .set(auth(owner.token))
      .send({})
      .expect(422);
    expect(
      Object.keys(errorResponseSchema.parse(incomplete.body).error.fieldErrors ?? {}).sort(),
    ).toEqual([
      "declaredBranchCount",
      "emirate",
      "licenseAuthority",
      "licenseExpiresOn",
      "representative",
    ]);

    const withDocs = await http()
      .post(`/v1/merchant/applications/${draft.id}/submit`)
      .set(auth(owner.token))
      .send({ documentIds: [randomUUID()] })
      .expect(422);
    expect(errorResponseSchema.parse(withDocs.body).error.fieldErrors?.["documentIds"]).toEqual([
      "Document attachments are switched off",
    ]);

    await http()
      .post("/v1/merchant/applications")
      .set(auth(owner.token))
      .send({ ...fullApplication(), licenseExpiresOn: "2020-01-01" })
      .expect(400);
  });

  it("needs a manual licence check before approval, records who checked it, and audits every step", async () => {
    const owner = await person();
    const admin = await person("operations");
    const application = await submitted(owner);
    const review = (decision: string, expectedStatus: string) =>
      http()
        .post(`/v1/admin/merchants/${application.id}/review`)
        .set(auth(admin.token))
        .send({ decision, reason: `Reviewer: ${decision}`, expectedStatus });

    await review("start_review", "submitted").expect(200);
    const early = await review("approve", "review").expect(422);
    expect(errorResponseSchema.parse(early.body).error.message).toMatch(/manual licence check/);

    const path = `/v1/admin/merchants/${application.id}/verifications`;
    const wrongNumber = await http()
      .post(path)
      .set(auth(admin.token))
      .send(verification("LIC-SOMETHING-ELSE"))
      .expect(400);
    expect(errorResponseSchema.parse(wrongNumber.body).error.fieldErrors).toHaveProperty(
      "licenseNumber",
    );
    await http()
      .post(path)
      .set(auth(admin.token))
      .send(verification(application.licenseNumber, { verifiedOn: "2099-01-01" }))
      .expect(400);
    await http()
      .post(path)
      .set(auth(admin.token))
      .send(verification(application.licenseNumber, { licenseExpiresOn: "2024-01-01" }))
      .expect(400);

    const recorded = adminMerchantDetailResponseSchema.parse(
      (
        await http()
          .post(path)
          .set(auth(admin.token))
          .send(verification(application.licenseNumber))
          .expect(201)
      ).body,
    ).data;
    expect(recorded.verifications).toHaveLength(1);
    expect(recorded.verifications[0]).toMatchObject({
      method: "manual_external_check",
      verifiedOn: "2026-11-01",
      verifiedBy: { id: admin.user.id, name: "Test Person" },
      licenseExpiresOn: "2031-06-30",
    });

    const noted = adminMerchantDetailResponseSchema.parse(
      (
        await http()
          .post(`/v1/admin/merchants/${application.id}/notes`)
          .set(auth(admin.token))
          .send({ body: "Called the café; owner confirmed the branch count." })
          .expect(201)
      ).body,
    ).data;
    expect(noted.notes[0]?.body).toMatch(/branch count/);

    await review("approve", "review").expect(200);
    await review("suspend", "approved").expect(200);
    await review("reinstate", "suspended").expect(200);

    const detail = adminMerchantDetailResponseSchema.parse(
      (await http().get(`/v1/admin/merchants/${application.id}`).set(auth(admin.token)).expect(200))
        .body,
    ).data;
    expect(detail.status).toBe("approved");
    expect(detail.history.map((h) => h.action)).toEqual([
      "merchant.reinstate",
      "merchant.suspend",
      "merchant.approve",
      "merchant.note_added",
      "merchant.licence_checked_manually",
      "merchant.start_review",
      "merchant.application_submitted",
      "merchant.application_created",
    ]);

    // Internal notes and verification records never reach the applicant.
    const seen = await http()
      .get(`/v1/merchant/applications/${application.id}`)
      .set(auth(owner.token))
      .expect(200);
    expect(seen.body.data).not.toHaveProperty("notes");
    expect(seen.body.data).not.toHaveProperty("verifications");
    expect(JSON.stringify(seen.body)).not.toMatch(/branch count/);
  });

  it("refuses a licence check on a draft and by an admin without the operations role", async () => {
    const owner = await person();
    const support = await person("support");
    const ops = await person("operations");
    const draft = merchantApplicationResponseSchema.parse(
      (
        await http()
          .post("/v1/merchant/applications")
          .set(auth(owner.token))
          .send(fullApplication())
          .expect(201)
      ).body,
    ).data;
    await http()
      .post(`/v1/admin/merchants/${draft.id}/verifications`)
      .set(auth(support.token))
      .send(verification(draft.licenseNumber))
      .expect(403);
    await http()
      .post(`/v1/admin/merchants/${draft.id}/verifications`)
      .set(auth(ops.token))
      .send(verification(draft.licenseNumber))
      .expect(409);
  });

  it("lets an admin create a verified merchant whose owner joins through a one-time invitation", async () => {
    const admin = await person("operations");
    const owner = await person();
    const licenseNumber = licence();
    const body = {
      legalName: "Admin Created Coffee LLC",
      brandName: "Admin Created Coffee",
      licenseNumber,
      licenseAuthority: "Dubai Economy and Tourism (fictional)",
      licenseExpiresOn: "2030-03-31",
      emirate: "dubai",
      contact: { name: "Owner", email: owner.user.email!, phone: "+971 50 111 1111" },
      representative: {
        name: "Owner",
        position: "Owner",
        email: owner.user.email!,
        phone: "+971 50 111 1111",
      },
      declaredBranchCount: 1,
      ownerEmail: owner.user.email!,
      verification: {
        verifiedOn: "2026-11-20",
        source: "Licence shown in person and checked on the public register",
      },
      reason: "Pilot café onboarded in person",
    };
    const created = createVerifiedMerchantResponseSchema.parse(
      (await http().post("/v1/admin/merchants").set(auth(admin.token)).send(body).expect(201)).body,
    ).data;
    expect(created.merchant).toMatchObject({ status: "approved", emirate: "dubai" });
    expect(created.merchant.verifications[0]?.method).toBe("manual_external_check");
    expect(created.merchant.history[0]?.action).toBe("merchant.created_verified");
    expect(created.ownerInvitationToken.length).toBeGreaterThan(30);

    await http()
      .post("/v1/merchant/invitations/accept")
      .set(auth(owner.token))
      .send({ token: created.ownerInvitationToken })
      .expect(200);
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: owner.user.id, merchantId: created.merchant.id },
    });
    expect(membership).toMatchObject({ role: "owner", status: "active" });

    await http().post("/v1/admin/merchants").set(auth(admin.token)).send(body).expect(409);
    await http()
      .post("/v1/admin/merchants")
      .set(auth(admin.token))
      .send({ ...body, licenseNumber: licence(), licenseExpiresOn: "2025-01-01" })
      .expect(400);
  });
});
