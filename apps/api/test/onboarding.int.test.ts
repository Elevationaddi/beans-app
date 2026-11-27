import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  adminMerchantDetailResponseSchema,
  adminMerchantListResponseSchema,
  errorResponseSchema,
  merchantApplicationListResponseSchema,
  merchantApplicationResponseSchema,
  merchantBranchListResponseSchema,
  uploadResponseSchema,
  uploadTicketResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JWKS } from "../src/auth/token-verifier.js";
import { FilesService } from "../src/files/files.service.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";
import { createUser, testPrisma } from "./fixtures.js";
import { TestIssuer } from "./tokens.js";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", "latin1");
const FAKE_PDF = Buffer.from("MZ this is not a pdf at all", "latin1");

describe("merchant onboarding: applications, documents and review", () => {
  let app: INestApplication;
  let issuer: TestIssuer;
  let files: FilesService;
  const prisma = testPrisma();

  beforeAll(async () => {
    issuer = await TestIssuer.create();
    app = await createTestApp(testEnv(), { overrides: [{ provide: JWKS, useValue: issuer.jwks }] });
    files = app.get(FilesService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function person(adminRole?: "operations" | "security") {
    const user = await createUser(prisma);
    if (adminRole) await prisma.adminRole.create({ data: { userId: user.id, role: adminRole } });
    return {
      user,
      token: await issuer.token({ sub: user.authSubject, aal: adminRole ? "aal2" : "aal1" }),
    };
  }

  const applicationBody = () => ({
    legalName: "Test Roasters LLC",
    brandName: "Test Roasters",
    licenseNumber: `LIC-${randomUUID().slice(0, 12)}`,
    contact: { name: "Test Owner", email: "owner@example.test", phone: "+971 50 000 0000" },
  });

  async function apply(token: string) {
    const response = await http()
      .post("/v1/merchant/applications")
      .set(auth(token))
      .send(applicationBody())
      .expect(201);
    return merchantApplicationResponseSchema.parse(response.body).data;
  }

  /** Ticket → upload bytes through the signed link → complete. Returns the upload ID. */
  async function uploadDocument(
    token: string,
    merchantId: string,
    options: { type?: string; bytes?: Buffer; scan?: boolean } = {},
  ) {
    const bytes = options.bytes ?? PDF;
    const ticket = uploadTicketResponseSchema.parse(
      (
        await http()
          .post("/v1/uploads")
          .set(auth(token))
          .send({
            purpose: "merchant_document",
            merchantId,
            documentType: options.type ?? "trade_license",
            mime: "application/pdf",
            size: bytes.length,
          })
          .expect(201)
      ).body,
    ).data;
    const url = new URL(ticket.uploadUrl);
    await http().put(`${url.pathname}${url.search}`).set(ticket.headers).send(bytes).expect(200);
    const completed = uploadResponseSchema.parse(
      (await http().post(`/v1/uploads/${ticket.id}/complete`).set(auth(token)).expect(200)).body,
    ).data;
    expect(completed.status).toBe("quarantined");
    if (options.scan !== false) await files.scan(ticket.id);
    const document = await prisma.merchantDocument.findUniqueOrThrow({
      where: { uploadId: ticket.id },
    });
    return { uploadId: ticket.id, documentId: document.id, ticket };
  }

  function review(
    token: string,
    merchantId: string,
    decision: string,
    expectedStatus: string,
    reason = "Checked against licence register",
  ) {
    return http()
      .post(`/v1/admin/merchants/${merchantId}/review`)
      .set(auth(token))
      .send({ decision, reason, expectedStatus });
  }

  describe("applications", () => {
    it("creates a draft owned by the applicant, visible only to them", async () => {
      const applicant = await person();
      const stranger = await person();
      const application = await apply(applicant.token);
      expect(application).toMatchObject({ status: "draft", documents: [], reviewNote: null });

      await http()
        .get(`/v1/merchant/applications/${application.id}`)
        .set(auth(applicant.token))
        .expect(200);
      await http()
        .get(`/v1/merchant/applications/${application.id}`)
        .set(auth(stranger.token))
        .expect(404);
      const list = merchantApplicationListResponseSchema.parse(
        (await http().get("/v1/merchant/applications").set(auth(stranger.token)).expect(200)).body,
      );
      expect(list.data).toEqual([]);
      const created = await prisma.auditEvent.count({
        where: { targetId: application.id, action: "merchant.application_created" },
      });
      expect(created).toBe(1);
    });

    it("rejects a licence number that is already registered", async () => {
      const a = await person();
      const body = applicationBody();
      await http().post("/v1/merchant/applications").set(auth(a.token)).send(body).expect(201);
      const response = await http()
        .post("/v1/merchant/applications")
        .set(auth(a.token))
        .send(body)
        .expect(409);
      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
    });

    it("validates input strictly", async () => {
      const a = await person();
      await http()
        .post("/v1/merchant/applications")
        .set(auth(a.token))
        .send({ ...applicationBody(), status: "approved" })
        .expect(400);
      await http()
        .post("/v1/merchant/applications")
        .set(auth(a.token))
        .send({ ...applicationBody(), contact: { name: "x", email: "not-an-email", phone: "1" } })
        .expect(400);
    });

    it("needs a checked trade licence to submit", async () => {
      const a = await person();
      const application = await apply(a.token);
      const other = await uploadDocument(a.token, application.id, { type: "owner_id" });
      const noLicence = await http()
        .post(`/v1/merchant/applications/${application.id}/submit`)
        .set(auth(a.token))
        .send({ documentIds: [other.documentId] })
        .expect(422);
      expect(errorResponseSchema.parse(noLicence.body).error.fieldErrors?.["documentIds"]).toEqual([
        "Include the trade licence",
      ]);

      const unchecked = await uploadDocument(a.token, application.id, { scan: false });
      await http()
        .post(`/v1/merchant/applications/${application.id}/submit`)
        .set(auth(a.token))
        .send({ documentIds: [other.documentId, unchecked.documentId] })
        .expect(422);
    });

    it("submits once, then locks editing", async () => {
      const a = await person();
      const application = await apply(a.token);
      const licence = await uploadDocument(a.token, application.id);
      const submitted = merchantApplicationResponseSchema.parse(
        (
          await http()
            .post(`/v1/merchant/applications/${application.id}/submit`)
            .set(auth(a.token))
            .send({ documentIds: [licence.documentId] })
            .expect(200)
        ).body,
      ).data;
      expect(submitted.status).toBe("submitted");
      expect(submitted.submittedAt).not.toBeNull();
      await http()
        .post(`/v1/merchant/applications/${application.id}/submit`)
        .set(auth(a.token))
        .send({ documentIds: [licence.documentId] })
        .expect(409);
      await http()
        .patch(`/v1/merchant/applications/${application.id}`)
        .set(auth(a.token))
        .send({ brandName: "New" })
        .expect(409);
      expect(
        await prisma.outboxMessage.count({
          where: { aggregateId: application.id, topic: "merchant.application_submitted" },
        }),
      ).toBe(1);
    });
  });

  describe("uploads", () => {
    it("quarantines, then checks, and rejects content that does not match its type", async () => {
      const a = await person();
      const application = await apply(a.token);
      const { uploadId } = await uploadDocument(a.token, application.id, { bytes: FAKE_PDF });
      const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
      expect(upload).toMatchObject({
        status: "rejected",
        scanResult: "File content does not match its declared type",
      });
      expect(
        await prisma.outboxMessage.count({
          where: { dedupeKey: `file.scan_requested:${uploadId}` },
        }),
      ).toBe(1);
      expect(
        await prisma.auditEvent.count({
          where: { targetId: uploadId, action: "file.scan_rejected" },
        }),
      ).toBe(1);
    });

    it("refuses wrong content types, oversize bodies and tampered or foreign links", async () => {
      const a = await person();
      const application = await apply(a.token);
      const make = async () =>
        uploadTicketResponseSchema.parse(
          (
            await http()
              .post("/v1/uploads")
              .set(auth(a.token))
              .send({
                purpose: "merchant_document",
                merchantId: application.id,
                documentType: "other",
                mime: "application/pdf",
                size: PDF.length,
              })
              .expect(201)
          ).body,
        ).data;
      const first = await make();
      const second = await make();
      const firstUrl = new URL(first.uploadUrl);
      const token = firstUrl.searchParams.get("token")!;

      await http()
        .put(`${firstUrl.pathname}${firstUrl.search}`)
        .set("Content-Type", "image/png")
        .send(PDF)
        .expect(400);
      await http()
        .put(`${firstUrl.pathname}${firstUrl.search}`)
        .set("Content-Type", "application/pdf")
        .send(Buffer.concat([PDF, Buffer.alloc(100)]))
        .expect(413);
      // A valid token for upload 1 does not open upload 2.
      await http()
        .put(`/v1/uploads/${second.id}/content?token=${token}`)
        .set("Content-Type", "application/pdf")
        .send(PDF)
        .expect(403);
      await http()
        .put(`${firstUrl.pathname}?token=${token}x`)
        .set("Content-Type", "application/pdf")
        .send(PDF)
        .expect(403);
      // An upload link cannot be used to download.
      await http().get(`/v1/uploads/${first.id}/download?token=${token}`).expect(403);
      // Completing before any bytes arrive is refused.
      await http().post(`/v1/uploads/${second.id}/complete`).set(auth(a.token)).expect(409);
    });

    it("rejects a file whose size differs from the declared size", async () => {
      const a = await person();
      const application = await apply(a.token);
      const ticket = uploadTicketResponseSchema.parse(
        (
          await http()
            .post("/v1/uploads")
            .set(auth(a.token))
            .send({
              purpose: "merchant_document",
              merchantId: application.id,
              documentType: "other",
              mime: "application/pdf",
              size: PDF.length,
            })
            .expect(201)
        ).body,
      ).data;
      const url = new URL(ticket.uploadUrl);
      await http()
        .put(`${url.pathname}${url.search}`)
        .set(ticket.headers)
        .send(PDF.subarray(0, 20))
        .expect(200);
      const done = uploadResponseSchema.parse(
        (await http().post(`/v1/uploads/${ticket.id}/complete`).set(auth(a.token)).expect(200))
          .body,
      );
      expect(done.data).toMatchObject({
        status: "rejected",
        rejectionReason: "File size does not match the declared size",
      });
    });
  });

  describe("cross-tenant file access is denied", () => {
    it("in every channel: ticket, complete, submit, download link", async () => {
      const ownerA = await person();
      const ownerB = await person();
      const appA = await apply(ownerA.token);
      const appB = await apply(ownerB.token);
      const docA = await uploadDocument(ownerA.token, appA.id);

      // B cannot request an upload into A's application.
      await http()
        .post("/v1/uploads")
        .set(auth(ownerB.token))
        .send({
          purpose: "merchant_document",
          merchantId: appA.id,
          documentType: "other",
          mime: "application/pdf",
          size: 10,
        })
        .expect(404);
      // B cannot complete A's upload.
      await http()
        .post(`/v1/uploads/${docA.uploadId}/complete`)
        .set(auth(ownerB.token))
        .expect(404);
      // B cannot attach A's document to B's application.
      const steal = await http()
        .post(`/v1/merchant/applications/${appB.id}/submit`)
        .set(auth(ownerB.token))
        .send({ documentIds: [docA.documentId] })
        .expect(422);
      expect(errorResponseSchema.parse(steal.body).error.fieldErrors?.["documentIds"]).toEqual([
        "One or more documents were not found on this application",
      ]);
      // B's application view never lists A's document.
      const viewB = merchantApplicationResponseSchema.parse(
        (
          await http()
            .get(`/v1/merchant/applications/${appB.id}`)
            .set(auth(ownerB.token))
            .expect(200)
        ).body,
      );
      expect(viewB.data.documents).toEqual([]);
    });

    it("download links work only for checked files and only for the file they name", async () => {
      const owner = await person();
      const admin = await person("operations");
      const application = await apply(owner.token);
      const clean = await uploadDocument(owner.token, application.id);
      const quarantined = await uploadDocument(owner.token, application.id, {
        type: "other",
        scan: false,
      });

      const detail = adminMerchantDetailResponseSchema.parse(
        (
          await http()
            .get(`/v1/admin/merchants/${application.id}`)
            .set(auth(admin.token))
            .expect(200)
        ).body,
      ).data;
      const cleanDoc = detail.documents.find((d) => d.uploadId === clean.uploadId)!;
      const quarantinedDoc = detail.documents.find((d) => d.uploadId === quarantined.uploadId)!;
      expect(cleanDoc.downloadUrl).not.toBeNull();
      expect(quarantinedDoc.downloadUrl).toBeNull();

      const link = new URL(cleanDoc.downloadUrl!);
      const download = await http().get(`${link.pathname}${link.search}`).buffer(true).expect(200);
      expect(Buffer.from(download.body as Buffer).equals(PDF)).toBe(true);
      expect(download.headers["content-disposition"]).toBe("attachment");
      expect(download.headers["x-content-type-options"]).toBe("nosniff");

      const token = link.searchParams.get("token")!;
      await http().get(`/v1/uploads/${quarantined.uploadId}/download?token=${token}`).expect(403);
      expect(
        await prisma.auditEvent.count({
          where: { targetId: application.id, action: "merchant.documents_link_issued" },
        }),
      ).toBe(1);
    });
  });

  describe("admin review", () => {
    async function submittedApplication() {
      const owner = await person();
      const application = await apply(owner.token);
      const licence = await uploadDocument(owner.token, application.id);
      await http()
        .post(`/v1/merchant/applications/${application.id}/submit`)
        .set(auth(owner.token))
        .send({ documentIds: [licence.documentId] })
        .expect(200);
      return { owner, application, licence };
    }

    it("only operations admins with MFA see the queue", async () => {
      const security = await person("security");
      const plain = await person();
      await http().get("/v1/admin/merchants").set(auth(security.token)).expect(403);
      await http().get("/v1/admin/merchants").set(auth(plain.token)).expect(403);
      const ops = await createUser(prisma);
      await prisma.adminRole.create({ data: { userId: ops.id, role: "operations" } });
      const noMfa = await http()
        .get("/v1/admin/merchants")
        .set(auth(await issuer.token({ sub: ops.authSubject })))
        .expect(403);
      expect(errorResponseSchema.parse(noMfa.body).error.code).toBe("MFA_REQUIRED");
    });

    it("lists submitted applications", async () => {
      const admin = await person("operations");
      const { application } = await submittedApplication();
      const list = adminMerchantListResponseSchema.parse(
        (
          await http()
            .get("/v1/admin/merchants?status=submitted&limit=100")
            .set(auth(admin.token))
            .expect(200)
        ).body,
      );
      let ids = list.data.map((m) => m.id);
      let cursor = list.meta.nextCursor;
      while (cursor && !ids.includes(application.id)) {
        const next = adminMerchantListResponseSchema.parse(
          (
            await http()
              .get(`/v1/admin/merchants?status=submitted&limit=100&cursor=${cursor}`)
              .set(auth(admin.token))
              .expect(200)
          ).body,
        );
        ids = ids.concat(next.data.map((m) => m.id));
        cursor = next.meta.nextCursor;
      }
      expect(ids).toContain(application.id);
    });

    it("runs the full cycle with mandatory reasons, every step audited", async () => {
      const admin = await person("operations");
      const { owner, application, licence } = await submittedApplication();

      // Reason is mandatory; skipping review is not allowed; a stale view conflicts.
      await http()
        .post(`/v1/admin/merchants/${application.id}/review`)
        .set(auth(admin.token))
        .send({ decision: "start_review", expectedStatus: "submitted" })
        .expect(400);
      await review(admin.token, application.id, "approve", "submitted").expect(409);
      await review(admin.token, application.id, "start_review", "draft").expect(409);

      await review(admin.token, application.id, "start_review", "submitted").expect(200);
      await review(
        admin.token,
        application.id,
        "request_changes",
        "review",
        "Licence photo is cut off; upload the full page",
      ).expect(200);

      // The applicant sees the note, fixes the draft and resubmits.
      const draft = merchantApplicationResponseSchema.parse(
        (
          await http()
            .get(`/v1/merchant/applications/${application.id}`)
            .set(auth(owner.token))
            .expect(200)
        ).body,
      ).data;
      expect(draft).toMatchObject({
        status: "draft",
        reviewNote: "Licence photo is cut off; upload the full page",
      });
      await http()
        .patch(`/v1/merchant/applications/${application.id}`)
        .set(auth(owner.token))
        .send({ brandName: "Fixed Roasters" })
        .expect(200);
      await http()
        .post(`/v1/merchant/applications/${application.id}/submit`)
        .set(auth(owner.token))
        .send({ documentIds: [licence.documentId] })
        .expect(200);

      await review(admin.token, application.id, "start_review", "submitted").expect(200);
      const approved = adminMerchantDetailResponseSchema.parse(
        (await review(admin.token, application.id, "approve", "review").expect(200)).body,
      ).data;
      expect(approved).toMatchObject({ status: "approved", reviewNote: null });
      expect(approved.documents.every((d) => d.reviewStatus === "accepted")).toBe(true);

      const events = await prisma.auditEvent.findMany({
        where: {
          targetId: application.id,
          actorId: admin.user.id,
          action: { startsWith: "merchant." },
        },
        orderBy: { createdAt: "asc" },
      });
      const decisions = events.filter((e) => e.reason !== null);
      expect(decisions.map((e) => e.action)).toEqual([
        "merchant.start_review",
        "merchant.request_changes",
        "merchant.start_review",
        "merchant.approve",
      ]);
      expect(decisions.every((e) => e.reason && e.reason.length >= 3 && e.requestId)).toBe(true);
      expect(
        await prisma.outboxMessage.count({
          where: { aggregateId: application.id, topic: "merchant.status_changed" },
        }),
      ).toBe(4);
    });

    it("rejection is final and shown to the applicant", async () => {
      const admin = await person("operations");
      const { owner, application } = await submittedApplication();
      await review(admin.token, application.id, "start_review", "submitted").expect(200);
      await review(
        admin.token,
        application.id,
        "reject",
        "review",
        "Licence is not valid for food service",
      ).expect(200);
      const view = merchantApplicationResponseSchema.parse(
        (
          await http()
            .get(`/v1/merchant/applications/${application.id}`)
            .set(auth(owner.token))
            .expect(200)
        ).body,
      ).data;
      expect(view).toMatchObject({
        status: "rejected",
        reviewNote: "Licence is not valid for food service",
      });
      await review(admin.token, application.id, "approve", "rejected").expect(409);
    });

    it("an admin cannot review a merchant they belong to", async () => {
      const ownerAdmin = await person("operations");
      const application = await apply(ownerAdmin.token);
      const licence = await uploadDocument(ownerAdmin.token, application.id);
      await http()
        .post(`/v1/merchant/applications/${application.id}/submit`)
        .set(auth(ownerAdmin.token))
        .send({ documentIds: [licence.documentId] })
        .expect(200);
      await review(ownerAdmin.token, application.id, "start_review", "submitted").expect(403);
    });

    it("two admins acting at once: one succeeds, the other conflicts", async () => {
      const first = await person("operations");
      const second = await person("operations");
      const { application } = await submittedApplication();
      const responses = await Promise.all([
        review(first.token, application.id, "start_review", "submitted"),
        review(second.token, application.id, "start_review", "submitted"),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.auditEvent.count({
          where: { targetId: application.id, action: "merchant.start_review" },
        }),
      ).toBe(1);
    });

    it("suspension locks out staff and reinstatement restores access", async () => {
      const admin = await person("operations");
      const { owner, application } = await submittedApplication();
      await review(admin.token, application.id, "start_review", "submitted").expect(200);
      await review(admin.token, application.id, "approve", "review").expect(200);
      const branch = await prisma.branch.create({
        data: {
          merchantId: application.id,
          nameEn: "Main",
          address: "Test",
          modes: ["in_store"],
          capacity: 4,
          status: "active",
        },
      });
      const branchIds = async () =>
        merchantBranchListResponseSchema
          .parse(
            (await http().get("/v1/merchant/branches").set(auth(owner.token)).expect(200)).body,
          )
          .data.map((b) => b.id);
      expect(await branchIds()).toEqual([branch.id]);

      await review(
        admin.token,
        application.id,
        "suspend",
        "approved",
        "Repeated food safety complaints",
      ).expect(200);
      expect(await branchIds()).toEqual([]);
      // The owner can still read the application and its status.
      await http()
        .get(`/v1/merchant/applications/${application.id}`)
        .set(auth(owner.token))
        .expect(200);

      await review(
        admin.token,
        application.id,
        "reinstate",
        "suspended",
        "Inspection passed",
      ).expect(200);
      expect(await branchIds()).toEqual([branch.id]);
    });
  });

  describe("an unapproved merchant cannot publish", () => {
    it("blocks active branches and published products until approval, and again after suspension", async () => {
      const owner = await person();
      const application = await apply(owner.token);
      const merchantId = application.id;
      const activeBranch = () =>
        prisma.branch.create({
          data: {
            merchantId,
            nameEn: "B",
            address: "x",
            modes: ["in_store"],
            capacity: 1,
            status: "active",
          },
        });

      await expect(activeBranch()).rejects.toThrow(/not approved/);
      const draftBranch = await prisma.branch.create({
        data: { merchantId, nameEn: "Draft", address: "x", modes: ["in_store"], capacity: 1 },
      });
      await expect(
        prisma.branch.update({ where: { id: draftBranch.id }, data: { status: "active" } }),
      ).rejects.toThrow(/not approved/);
      const category = await prisma.category.create({ data: { merchantId, nameEn: "Hot" } });
      await expect(
        prisma.product.create({
          data: {
            merchantId,
            categoryId: category.id,
            names: { en: "Latte" },
            baseFils: 1500n,
            status: "published",
          },
        }),
      ).rejects.toThrow(/not approved/);
      // Drafts are fine.
      const product = await prisma.product.create({
        data: { merchantId, categoryId: category.id, names: { en: "Latte" }, baseFils: 1500n },
      });

      await prisma.merchant.update({ where: { id: merchantId }, data: { status: "approved" } });
      await prisma.branch.update({ where: { id: draftBranch.id }, data: { status: "active" } });
      await prisma.product.update({ where: { id: product.id }, data: { status: "published" } });

      await prisma.merchant.update({ where: { id: merchantId }, data: { status: "suspended" } });
      await expect(activeBranch()).rejects.toThrow(/not approved/);
    });
  });
});

describe("file check runs through the outbox and worker", () => {
  it("moves a completed upload from quarantined to clean without manual steps", async () => {
    const issuer = await TestIssuer.create();
    const prisma = testPrisma();
    const app = await createTestApp(
      testEnv({ OUTBOX_RELAY_ENABLED: "true", OUTBOX_WORKER_ENABLED: "true" }),
      {
        overrides: [{ provide: JWKS, useValue: issuer.jwks }],
      },
    );
    try {
      const user = await createUser(prisma);
      const token = await issuer.token({ sub: user.authSubject });
      const http = () => request(app.getHttpServer());
      const created = await http()
        .post("/v1/merchant/applications")
        .set("Authorization", `Bearer ${token}`)
        .send({
          legalName: "Worker Test LLC",
          brandName: "Worker Test",
          licenseNumber: `LIC-${randomUUID().slice(0, 12)}`,
          contact: { name: "W", email: "w@example.test", phone: "+971500000000" },
        })
        .expect(201);
      const merchantId = merchantApplicationResponseSchema.parse(created.body).data.id;
      const ticket = uploadTicketResponseSchema.parse(
        (
          await http()
            .post("/v1/uploads")
            .set("Authorization", `Bearer ${token}`)
            .send({
              purpose: "merchant_document",
              merchantId,
              documentType: "trade_license",
              mime: "application/pdf",
              size: PDF.length,
            })
            .expect(201)
        ).body,
      ).data;
      const url = new URL(ticket.uploadUrl);
      await http().put(`${url.pathname}${url.search}`).set(ticket.headers).send(PDF).expect(200);
      // Park rows left pending by other tests so the relay picks this one up promptly.
      await prisma.outboxMessage.updateMany({
        where: { state: "pending" },
        data: { state: "failed" },
      });
      await http()
        .post(`/v1/uploads/${ticket.id}/complete`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      let status = "quarantined";
      for (let i = 0; i < 50 && status === "quarantined"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        status = (await prisma.upload.findUniqueOrThrow({ where: { id: ticket.id } })).status;
      }
      expect(status).toBe("clean");
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });
});
