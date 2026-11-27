import {
  errorResponseSchema,
  inviteStaffResponseSchema,
  merchantBranchListResponseSchema,
  staffListResponseSchema,
  staffMemberResponseSchema,
} from "@beans/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MerchantWorld } from "./merchant-world.js";

describe("staff: invitations, branch assignment and revocation", () => {
  let world: MerchantWorld;
  let tenant: Awaited<ReturnType<MerchantWorld["tenant"]>>;
  let owner: Awaited<ReturnType<MerchantWorld["person"]>>;

  beforeAll(async () => {
    world = await MerchantWorld.create();
    tenant = await world.tenant("Staff");
    owner = await world.person({ merchantId: tenant.merchant.id, role: "owner" });
  });
  afterAll(() => world.close());

  async function invite(
    email: string,
    role: "manager" | "barista" | "analyst",
    branchIds: string[],
    extra = {},
  ) {
    const res = await world
      .post("/v1/merchant/staff", owner.token, {
        merchantId: tenant.merchant.id,
        email,
        role,
        branchIds,
        ...extra,
      })
      .expect(201);
    return inviteStaffResponseSchema.parse(res.body).data;
  }

  const branchIdsSeenBy = async (token: string) =>
    merchantBranchListResponseSchema
      .parse((await world.get("/v1/merchant/branches", token).expect(200)).body)
      .data.map((b) => b.id)
      .sort();

  it("an invited barista accepts and sees only the assigned branch", async () => {
    const person = await world.person(undefined, "barista.one@example.test");
    const { invitation, token } = await invite("Barista.One@Example.test", "barista", [
      tenant.branch1.id,
    ]);
    expect(invitation).toMatchObject({
      email: "barista.one@example.test",
      status: "pending",
      role: "barista",
    });
    expect(token.length).toBeGreaterThanOrEqual(40);

    // Only a hash is stored; an outbox event is queued instead of a real email.
    const stored = await world.prisma.staffInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(stored.tokenHash).not.toContain(token);
    expect(
      await world.prisma.outboxMessage.count({
        where: { aggregateId: invitation.id, topic: "staff.invited" },
      }),
    ).toBe(1);

    const member = staffMemberResponseSchema.parse(
      (await world.post("/v1/merchant/invitations/accept", person.token, { token }).expect(200))
        .body,
    ).data;
    expect(member).toMatchObject({
      role: "barista",
      status: "active",
      branchIds: [tenant.branch1.id],
    });
    expect(await branchIdsSeenBy(person.token)).toEqual([tenant.branch1.id]);

    // One-time: a second accept fails.
    const again = await world
      .post("/v1/merchant/invitations/accept", person.token, { token })
      .expect(409);
    expect(errorResponseSchema.parse(again.body).error.code).toBe("INVALID_TRANSITION");
  });

  it("only the invited email can accept, and unknown or expired tokens fail", async () => {
    const { invitation, token } = await invite("someone@example.test", "analyst", []);
    const stranger = await world.person(undefined, "stranger@example.test");
    await world.post("/v1/merchant/invitations/accept", stranger.token, { token }).expect(403);
    await world
      .post("/v1/merchant/invitations/accept", stranger.token, { token: "x".repeat(43) })
      .expect(404);

    await world.prisma.staffInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const invited = await world.person(undefined, "someone@example.test");
    const expired = await world
      .post("/v1/merchant/invitations/accept", invited.token, { token })
      .expect(409);
    expect(errorResponseSchema.parse(expired.body).error.message).toMatch(/expired/);

    const list = staffListResponseSchema.parse(
      (
        await world
          .get(`/v1/merchant/staff?merchantId=${tenant.merchant.id}`, owner.token)
          .expect(200)
      ).body,
    ).data;
    expect(list.invitations.find((i) => i.id === invitation.id)?.status).toBe("expired");
  });

  it("prohibits privilege escalation: no owner invitations, no owner edits, delegation for managers only", async () => {
    await world
      .post("/v1/merchant/staff", owner.token, {
        merchantId: tenant.merchant.id,
        email: "boss@example.test",
        role: "owner",
        branchIds: [],
      })
      .expect(400);
    await world
      .post("/v1/merchant/staff", owner.token, {
        merchantId: tenant.merchant.id,
        email: "b@example.test",
        role: "barista",
        branchIds: [tenant.branch1.id],
        catalogDelegated: true,
      })
      .expect(400);
    // The owner cannot demote or revoke an owner, including themselves.
    await world
      .patch(`/v1/merchant/staff/${owner.membership?.id}`, owner.token, { status: "revoked" })
      .expect(403);
    await world
      .patch(`/v1/merchant/staff/${owner.membership?.id}`, owner.token, { role: "manager" })
      .expect(403);
    // "owner" is not a role that can be granted at all.
    const manager = await world.person({
      merchantId: tenant.merchant.id,
      role: "manager",
      branchIds: [tenant.branch1.id],
    });
    await world
      .patch(`/v1/merchant/staff/${manager.membership?.id}`, owner.token, { role: "owner" })
      .expect(400);
  });

  it("managers and baristas need a branch, and branches must belong to the merchant", async () => {
    const other = await world.tenant("OtherStaff");
    const noBranch = await world
      .post("/v1/merchant/staff", owner.token, {
        merchantId: tenant.merchant.id,
        email: "m@example.test",
        role: "manager",
        branchIds: [],
      })
      .expect(400);
    expect(errorResponseSchema.parse(noBranch.body).error.fieldErrors).toHaveProperty("branchIds");
    await world
      .post("/v1/merchant/staff", owner.token, {
        merchantId: tenant.merchant.id,
        email: "m@example.test",
        role: "manager",
        branchIds: [other.branch1.id],
      })
      .expect(400);
  });

  it("only owners manage staff; managers and other tenants are refused", async () => {
    const manager = await world.person({
      merchantId: tenant.merchant.id,
      role: "manager",
      branchIds: [tenant.branch1.id],
    });
    await world
      .get(`/v1/merchant/staff?merchantId=${tenant.merchant.id}`, manager.token)
      .expect(403);
    await world
      .post("/v1/merchant/staff", manager.token, {
        merchantId: tenant.merchant.id,
        email: "x@example.test",
        role: "barista",
        branchIds: [tenant.branch1.id],
      })
      .expect(403);
    await world
      .patch(`/v1/merchant/staff/${manager.membership?.id}`, manager.token, { role: "analyst" })
      .expect(403);

    const other = await world.tenant("ForeignStaff");
    const otherOwner = await world.person({ merchantId: other.merchant.id, role: "owner" });
    await world
      .get(`/v1/merchant/staff?merchantId=${tenant.merchant.id}`, otherOwner.token)
      .expect(404);
    const res = await world
      .patch(`/v1/merchant/staff/${manager.membership?.id}`, otherOwner.token, {
        status: "revoked",
      })
      .expect(404);
    expect(errorResponseSchema.parse(res.body).error.message).toBe("Staff member not found");
  });

  it("reassigning branches changes what the member sees on the next request", async () => {
    const manager = await world.person({
      merchantId: tenant.merchant.id,
      role: "manager",
      branchIds: [tenant.branch1.id],
    });
    expect(await branchIdsSeenBy(manager.token)).toEqual([tenant.branch1.id]);
    await world
      .patch(`/v1/merchant/staff/${manager.membership?.id}`, owner.token, {
        branchIds: [tenant.branch2.id],
      })
      .expect(200);
    expect(await branchIdsSeenBy(manager.token)).toEqual([tenant.branch2.id]);
    await world.get(`/v1/merchant/branches/${tenant.branch1.id}`, manager.token).expect(404);
  });

  it("revoked staff lose access on their next request, with the reason audited", async () => {
    const barista = await world.person({
      merchantId: tenant.merchant.id,
      role: "barista",
      branchIds: [tenant.branch1.id],
    });
    await world.get(`/v1/merchant/branches/${tenant.branch1.id}`, barista.token).expect(200);
    await world
      .patch(`/v1/merchant/staff/${barista.membership?.id}`, owner.token, {
        status: "revoked",
        reason: "Left the company",
      })
      .expect(200);
    await world.get(`/v1/merchant/branches/${tenant.branch1.id}`, barista.token).expect(404);
    expect(await branchIdsSeenBy(barista.token)).toEqual([]);

    const audit = await world.prisma.auditEvent.findFirstOrThrow({
      where: { targetId: barista.membership?.id ?? "", action: "staff.revoked" },
    });
    expect(audit.reason).toBe("Left the company");
  });

  it("menu editing can be granted to a manager and is dropped when the role changes", async () => {
    const manager = await world.person({
      merchantId: tenant.merchant.id,
      role: "manager",
      branchIds: [tenant.branch1.id],
    });
    const body = { merchantId: tenant.merchant.id, names: { en: "Seasonal" } };
    await world.post("/v1/merchant/categories", manager.token, body).expect(403);
    await world
      .patch(`/v1/merchant/staff/${manager.membership?.id}`, owner.token, {
        catalogDelegated: true,
      })
      .expect(200);
    await world.post("/v1/merchant/categories", manager.token, body).expect(201);
    const demoted = staffMemberResponseSchema.parse(
      (
        await world
          .patch(`/v1/merchant/staff/${manager.membership?.id}`, owner.token, { role: "barista" })
          .expect(200)
      ).body,
    ).data;
    expect(demoted.catalogDelegated).toBe(false);
    await world.post("/v1/merchant/categories", manager.token, body).expect(403);
  });

  it("a pending invitation can be revoked and then no longer accepted; duplicates are refused", async () => {
    const { invitation, token } = await invite("dup@example.test", "analyst", []);
    await world
      .post("/v1/merchant/staff", owner.token, {
        merchantId: tenant.merchant.id,
        email: "dup@example.test",
        role: "analyst",
      })
      .expect(409);
    await world
      .post(`/v1/merchant/staff/invitations/${invitation.id}/revoke`, owner.token)
      .expect(200);
    const invited = await world.person(undefined, "dup@example.test");
    await world.post("/v1/merchant/invitations/accept", invited.token, { token }).expect(409);
  });
});
