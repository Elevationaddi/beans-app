import type { INestApplication } from "@nestjs/common";
import {
  errorResponseSchema,
  merchantBranchListResponseSchema,
  profileResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JWKS } from "../src/auth/token-verifier.js";
import { createTestApp } from "./app.js";
import { testEnv } from "./env.js";
import { addMember, createTenant, createUser, testPrisma } from "./fixtures.js";
import { TestIssuer } from "./tokens.js";

describe("tenant isolation and role revocation (merchant branches)", () => {
  let app: INestApplication;
  let issuer: TestIssuer;
  const prisma = testPrisma();
  let tenantA: Awaited<ReturnType<typeof createTenant>>;
  let tenantB: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    issuer = await TestIssuer.create();
    app = await createTestApp(testEnv(), { overrides: [{ provide: JWKS, useValue: issuer.jwks }] });
    tenantA = await createTenant(prisma, "TenantA");
    tenantB = await createTenant(prisma, "TenantB");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function member(
    role: "owner" | "manager" | "barista" | "analyst",
    merchantId: string,
    branchIds: string[] = [],
  ) {
    const user = await createUser(prisma);
    const membership = await addMember(prisma, { userId: user.id, merchantId, role, branchIds });
    return { user, membership, token: await issuer.token({ sub: user.authSubject }) };
  }

  const http = () => request(app.getHttpServer());
  const listIds = async (token: string) =>
    merchantBranchListResponseSchema
      .parse(
        (
          await http()
            .get("/v1/merchant/branches")
            .set("Authorization", `Bearer ${token}`)
            .expect(200)
        ).body,
      )
      .data.map((b) => b.id)
      .sort();
  const getBranch = (token: string, id: string) =>
    http().get(`/v1/merchant/branches/${id}`).set("Authorization", `Bearer ${token}`);

  it("an owner sees every branch of their merchant and nothing of another", async () => {
    const { token } = await member("owner", tenantA.merchant.id);
    expect(await listIds(token)).toEqual([tenantA.branch1.id, tenantA.branch2.id].sort());
    await getBranch(token, tenantA.branch2.id).expect(200);
  });

  it("cross-tenant branch IDs answer 404, not 403", async () => {
    const { token } = await member("owner", tenantA.merchant.id);
    const response = await getBranch(token, tenantB.branch1.id).expect(404);
    expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    // Same answer as a branch that does not exist at all.
    await getBranch(token, "00000000-0000-4000-8000-ffffffffffff").expect(404);
  });

  it("a barista sees only assigned branches", async () => {
    const { token } = await member("barista", tenantA.merchant.id, [tenantA.branch1.id]);
    expect(await listIds(token)).toEqual([tenantA.branch1.id]);
    await getBranch(token, tenantA.branch1.id).expect(200);
    await getBranch(token, tenantA.branch2.id).expect(404);
  });

  it("revoking a membership takes effect on the next request", async () => {
    const { membership, token } = await member("manager", tenantA.merchant.id, [
      tenantA.branch1.id,
    ]);
    await getBranch(token, tenantA.branch1.id).expect(200);
    await prisma.membership.update({ where: { id: membership.id }, data: { status: "revoked" } });
    await getBranch(token, tenantA.branch1.id).expect(404);
    expect(await listIds(token)).toEqual([]);
    const me = profileResponseSchema.parse(
      (await http().get("/v1/me").set("Authorization", `Bearer ${token}`)).body,
    );
    expect(me.data.memberships).toEqual([]);
  });

  it("removing a branch assignment takes effect on the next request", async () => {
    const { membership, token } = await member("barista", tenantA.merchant.id, [
      tenantA.branch1.id,
      tenantA.branch2.id,
    ]);
    await prisma.membershipBranch.deleteMany({
      where: { membershipId: membership.id, branchId: tenantA.branch2.id },
    });
    await getBranch(token, tenantA.branch2.id).expect(404);
    await getBranch(token, tenantA.branch1.id).expect(200);
  });

  it("suspending a merchant locks out its staff, including the owner", async () => {
    const tenant = await createTenant(prisma, "Suspended");
    const { token } = await member("owner", tenant.merchant.id);
    await getBranch(token, tenant.branch1.id).expect(200);
    await prisma.merchant.update({
      where: { id: tenant.merchant.id },
      data: { status: "suspended" },
    });
    await getBranch(token, tenant.branch1.id).expect(404);
  });

  it("a customer with no membership sees no branches", async () => {
    const user = await createUser(prisma);
    expect(await listIds(await issuer.token({ sub: user.authSubject }))).toEqual([]);
  });

  it("narrows the list to one business with merchantId, never widening the caller's scope", async () => {
    const { token, user: owner } = await member("owner", tenantA.merchant.id);
    await addMember(prisma, {
      userId: owner.id,
      merchantId: tenantB.merchant.id,
      role: "manager",
      branchIds: [tenantB.branch1.id],
    });
    const ids = async (query: string) =>
      merchantBranchListResponseSchema
        .parse(
          (
            await http()
              .get(`/v1/merchant/branches${query}`)
              .set("Authorization", `Bearer ${token}`)
              .expect(200)
          ).body,
        )
        .data.map((b) => b.id)
        .sort();
    expect(await ids("")).toEqual(
      [tenantA.branch1.id, tenantA.branch2.id, tenantB.branch1.id].sort(),
    );
    expect(await ids(`?merchantId=${tenantA.merchant.id}`)).toEqual(
      [tenantA.branch1.id, tenantA.branch2.id].sort(),
    );
    expect(await ids(`?merchantId=${tenantB.merchant.id}`)).toEqual([tenantB.branch1.id]);
    const stranger = await member("owner", tenantB.merchant.id);
    const strangerIds = merchantBranchListResponseSchema.parse(
      (
        await http()
          .get(`/v1/merchant/branches?merchantId=${tenantA.merchant.id}`)
          .set("Authorization", `Bearer ${stranger.token}`)
          .expect(200)
      ).body,
    ).data;
    expect(strangerIds).toEqual([]);
  });

  it("paginates with an opaque cursor and validates query input", async () => {
    const { token } = await member("owner", tenantA.merchant.id);
    const first = merchantBranchListResponseSchema.parse(
      (
        await http()
          .get("/v1/merchant/branches?limit=1")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(first.data).toHaveLength(1);
    expect(first.meta.nextCursor).toEqual(expect.any(String));
    const second = merchantBranchListResponseSchema.parse(
      (
        await http()
          .get(`/v1/merchant/branches?limit=1&cursor=${first.meta.nextCursor}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(second.data[0]?.id).not.toBe(first.data[0]?.id);
    expect(second.meta.nextCursor).toBeNull();

    await http()
      .get("/v1/merchant/branches?limit=500")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    await http()
      .get("/v1/merchant/branches?merchantId=x")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    await http()
      .get("/v1/merchant/branches?cursor=garbage")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    await getBranch(token, "not-a-uuid").expect(400);
  });
});

describe("database-level tenant consistency", () => {
  const prisma = testPrisma();
  afterAll(() => prisma.$disconnect());

  it("cannot assign a member of merchant A to a branch of merchant B", async () => {
    const a = await createTenant(prisma, "FkA");
    const b = await createTenant(prisma, "FkB");
    const user = await createUser(prisma);
    const membership = await addMember(prisma, {
      userId: user.id,
      merchantId: a.merchant.id,
      role: "barista",
    });
    await expect(
      prisma.membershipBranch.create({
        data: { membershipId: membership.id, branchId: b.branch1.id, merchantId: a.merchant.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.membershipBranch.create({
        data: { membershipId: membership.id, branchId: b.branch1.id, merchantId: b.merchant.id },
      }),
    ).rejects.toThrow();
  });

  it("cannot list merchant A's product at merchant B's branch", async () => {
    const a = await createTenant(prisma, "CatA");
    const b = await createTenant(prisma, "CatB");
    const category = await prisma.category.create({
      data: { merchantId: a.merchant.id, nameEn: "Hot" },
    });
    const product = await prisma.product.create({
      data: {
        merchantId: a.merchant.id,
        categoryId: category.id,
        names: { en: "Latte" },
        baseFils: 1500n,
      },
    });
    await expect(
      prisma.branchProduct.create({
        data: { branchId: b.branch1.id, productId: product.id, merchantId: b.merchant.id },
      }),
    ).rejects.toThrow();
    await prisma.branchProduct.create({
      data: { branchId: a.branch1.id, productId: product.id, merchantId: a.merchant.id },
    });
  });
});
