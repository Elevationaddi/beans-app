import {
  branchExceptionResponseSchema,
  branchOptionResponseSchema,
  branchProductResponseSchema,
  branchSlotsResponseSchema,
  errorResponseSchema,
  merchantBranchResponseSchema,
} from "@beans/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";

const weekdays = (opens: string, closes: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens, closes }));

describe("branches: hours, holidays, slots and branch overrides", () => {
  let world: MerchantWorld;
  let tenant: Awaited<ReturnType<MerchantWorld["tenant"]>>;
  let owner: Awaited<ReturnType<MerchantWorld["person"]>>;
  let manager: Awaited<ReturnType<MerchantWorld["person"]>>;
  let barista: Awaited<ReturnType<MerchantWorld["person"]>>;

  beforeAll(async () => {
    world = await MerchantWorld.create();
    tenant = await world.tenant("Branches");
    owner = await world.person({ merchantId: tenant.merchant.id, role: "owner" });
    manager = await world.person({
      merchantId: tenant.merchant.id,
      role: "manager",
      branchIds: [tenant.branch1.id],
    });
    barista = await world.person({
      merchantId: tenant.merchant.id,
      role: "barista",
      branchIds: [tenant.branch1.id],
    });
  });
  afterAll(() => world.close());

  async function newBranch(hours = weekdays("07:00", "12:00"), capacity = 3) {
    const res = await world
      .post("/v1/merchant/branches", owner.token, {
        merchantId: tenant.merchant.id,
        nameEn: "Marina kiosk",
        address: "Test address",
        lat: 25.08,
        lng: 55.14,
        modes: ["in_store", "curbside"],
        capacity,
        hours,
      })
      .expect(201);
    return merchantBranchResponseSchema.parse(res.body).data;
  }

  it("owners create draft branches; managers and baristas cannot", async () => {
    const branch = await newBranch();
    expect(branch).toMatchObject({
      status: "draft",
      timezone: "Asia/Dubai",
      capacity: 3,
      lat: 25.08,
    });
    expect(branch.hours).toHaveLength(7);
    const body = {
      merchantId: tenant.merchant.id,
      nameEn: "X",
      address: "Y",
      modes: ["in_store"],
      capacity: 1,
    };
    await world.post("/v1/merchant/branches", manager.token, body).expect(403);
    await world.post("/v1/merchant/branches", barista.token, body).expect(403);
  });

  it("rejects overlapping and overnight intervals; split overnight hours are accepted", async () => {
    const overlap = await world
      .post("/v1/merchant/branches", owner.token, {
        merchantId: tenant.merchant.id,
        nameEn: "Bad",
        address: "Y",
        modes: ["in_store"],
        capacity: 1,
        hours: [
          { weekday: 1, opens: "07:00", closes: "12:00" },
          { weekday: 1, opens: "11:00", closes: "14:00" },
          { weekday: 2, opens: "22:00", closes: "02:00" },
        ],
      })
      .expect(400);
    const fields = errorResponseSchema.parse(overlap.body).error.fieldErrors ?? {};
    expect(Object.keys(fields).sort()).toEqual(["hours.weekday1", "hours.weekday2"]);

    const split = await newBranch([
      { weekday: 5, opens: "18:00", closes: "23:59" },
      { weekday: 6, opens: "00:00", closes: "02:00" },
    ]);
    expect(split.hours).toHaveLength(2);
  });

  it("opening needs an approved merchant and opening hours; status follows the transition rules", async () => {
    const empty = await newBranch([]);
    const noHours = await world
      .patch(`/v1/merchant/branches/${empty.id}`, owner.token, { status: "active" })
      .expect(422);
    expect(errorResponseSchema.parse(noHours.body).error.fieldErrors).toHaveProperty("hours");

    const branch = await newBranch();
    await world.prisma.merchant.update({
      where: { id: tenant.merchant.id },
      data: { status: "review" },
    });
    try {
      const res = await world
        .patch(`/v1/merchant/branches/${branch.id}`, owner.token, { status: "active" })
        .expect(409);
      expect(errorResponseSchema.parse(res.body).error.code).toBe("INVALID_TRANSITION");
    } finally {
      await world.prisma.merchant.update({
        where: { id: tenant.merchant.id },
        data: { status: "approved" },
      });
    }
    await world
      .patch(`/v1/merchant/branches/${branch.id}`, owner.token, { status: "active" })
      .expect(200);
    await world
      .patch(`/v1/merchant/branches/${branch.id}`, owner.token, { status: "paused" })
      .expect(200);
    await world
      .patch(`/v1/merchant/branches/${branch.id}`, owner.token, { status: "closed" })
      .expect(200);
    const back = await world
      .patch(`/v1/merchant/branches/${branch.id}`, owner.token, { status: "paused" })
      .expect(409);
    expect(errorResponseSchema.parse(back.body).error.code).toBe("INVALID_TRANSITION");
  });

  it("an assigned manager can change hours and pause, but not capacity, close, or another branch", async () => {
    const id = tenant.branch1.id;
    await world
      .patch(`/v1/merchant/branches/${id}`, manager.token, { hours: weekdays("08:00", "16:00") })
      .expect(200);
    await world
      .patch(`/v1/merchant/branches/${id}`, manager.token, { status: "paused" })
      .expect(200);
    await world
      .patch(`/v1/merchant/branches/${id}`, manager.token, { status: "active" })
      .expect(200);
    await world.patch(`/v1/merchant/branches/${id}`, manager.token, { capacity: 50 }).expect(403);
    await world
      .patch(`/v1/merchant/branches/${id}`, manager.token, { status: "closed" })
      .expect(403);
    await world
      .patch(`/v1/merchant/branches/${id}`, barista.token, { status: "paused" })
      .expect(403);
    await world
      .patch(`/v1/merchant/branches/${tenant.branch2.id}`, manager.token, { status: "paused" })
      .expect(404);
  });

  it("holiday exceptions replace the weekly hours for a date and drive the slots", async () => {
    const branch = await newBranch(weekdays("07:00", "08:00"), 4);
    const date = dubaiDate(3);
    const regular = branchSlotsResponseSchema.parse(
      (
        await world
          .get(`/v1/merchant/branches/${branch.id}/slots?date=${date}`, owner.token)
          .expect(200)
      ).body,
    ).data;
    expect(regular.slots).toHaveLength(4);
    expect(regular.slots.every((s) => s.capacity === 4)).toBe(true);
    // 07:00 Dubai = 03:00 UTC.
    expect(regular.slots[0]?.startsAt).toBe(`${date}T03:00:00.000Z`);

    const special = branchExceptionResponseSchema.parse(
      (
        await world
          .put(`/v1/merchant/branches/${branch.id}/exceptions/${date}`, owner.token, {
            closed: false,
            intervals: [{ opens: "09:00", closes: "09:30" }],
          })
          .expect(200)
      ).body,
    ).data;
    expect(special.intervals).toEqual([{ opens: "09:00", closes: "09:30" }]);
    const shifted = branchSlotsResponseSchema.parse(
      (
        await world
          .get(`/v1/merchant/branches/${branch.id}/slots?date=${date}`, owner.token)
          .expect(200)
      ).body,
    ).data;
    expect(shifted.slots.map((s) => s.startsAt)).toEqual([
      `${date}T05:00:00.000Z`,
      `${date}T05:15:00.000Z`,
    ]);

    await world
      .put(`/v1/merchant/branches/${branch.id}/exceptions/${date}`, owner.token, {
        closed: true,
        intervals: [],
      })
      .expect(200);
    const closed = branchSlotsResponseSchema.parse(
      (
        await world
          .get(`/v1/merchant/branches/${branch.id}/slots?date=${date}`, owner.token)
          .expect(200)
      ).body,
    ).data;
    expect(closed.slots).toEqual([]);

    const view = merchantBranchResponseSchema.parse(
      (await world.get(`/v1/merchant/branches/${branch.id}`, owner.token).expect(200)).body,
    ).data;
    expect(view.exceptions).toEqual([{ date, closed: true, intervals: [] }]);
  });

  it("validates exceptions: closed days have no intervals, open days need them, past dates are refused", async () => {
    const id = tenant.branch1.id;
    const date = dubaiDate(2);
    await world
      .put(`/v1/merchant/branches/${id}/exceptions/${date}`, owner.token, {
        closed: true,
        intervals: [{ opens: "07:00", closes: "08:00" }],
      })
      .expect(400);
    await world
      .put(`/v1/merchant/branches/${id}/exceptions/${date}`, owner.token, {
        closed: false,
        intervals: [],
      })
      .expect(400);
    await world
      .put(`/v1/merchant/branches/${id}/exceptions/${dubaiDate(-2)}`, owner.token, {
        closed: true,
        intervals: [],
      })
      .expect(422);
    await world
      .put(`/v1/merchant/branches/${id}/exceptions/${date}`, barista.token, {
        closed: true,
        intervals: [],
      })
      .expect(403);
  });

  it("schedule changes keep slots that already hold orders, and capacity never drops below what is held", async () => {
    const branch = await newBranch(weekdays("07:00", "07:30"), 2);
    const date = dubaiDate(4);
    const slots = branchSlotsResponseSchema.parse(
      (
        await world
          .get(`/v1/merchant/branches/${branch.id}/slots?date=${date}`, owner.token)
          .expect(200)
      ).body,
    ).data.slots;
    const held = slots[0];
    if (!held) throw new Error("expected a slot");
    await world.prisma.slot.update({ where: { id: held.id }, data: { reserved: 2 } });

    await world
      .patch(`/v1/merchant/branches/${branch.id}`, owner.token, { capacity: 1 })
      .expect(200);
    await world
      .put(`/v1/merchant/branches/${branch.id}/exceptions/${date}`, owner.token, {
        closed: true,
        intervals: [],
      })
      .expect(200);
    const after = branchSlotsResponseSchema.parse(
      (
        await world
          .get(`/v1/merchant/branches/${branch.id}/slots?date=${date}`, owner.token)
          .expect(200)
      ).body,
    ).data.slots;
    expect(after).toEqual([{ ...held, capacity: 2, reserved: 2 }]);
  });

  describe("branch overrides", () => {
    async function catalog() {
      const category = await world.prisma.category.create({
        data: { merchantId: tenant.merchant.id, nameEn: "Cat" },
      });
      const product = await world.prisma.product.create({
        data: {
          merchantId: tenant.merchant.id,
          categoryId: category.id,
          names: { en: "Latte" },
          baseFils: 1700n,
        },
      });
      const group = await world.prisma.modifierGroup.create({
        data: { merchantId: tenant.merchant.id, name: { en: "Milk" }, minCount: 0, maxCount: 1 },
      });
      const option = await world.prisma.modifierOption.create({
        data: {
          groupId: group.id,
          merchantId: tenant.merchant.id,
          name: { en: "Oat" },
          deltaFils: 200n,
        },
      });
      return { product, option };
    }
    const productPath = (branchId: string, productId: string) =>
      `/v1/merchant/branches/${branchId}/products/${productId}`;

    it("sets a branch price, sold-out flag and tracked stock, and audits each change", async () => {
      const { product } = await catalog();
      const path = productPath(tenant.branch1.id, product.id);
      const set = branchProductResponseSchema.parse(
        (
          await world
            .put(path, manager.token, { enabled: true, priceOverrideFils: "1600", stockOnHand: 5 })
            .expect(200)
        ).body,
      ).data;
      expect(set).toMatchObject({
        enabled: true,
        priceOverrideFils: "1600",
        stockOnHand: 5,
        stockReserved: 0,
      });

      const soldOut = branchProductResponseSchema.parse(
        (await world.put(path, manager.token, { enabled: false }).expect(200)).body,
      ).data;
      expect(soldOut).toMatchObject({ enabled: false, priceOverrideFils: null, stockOnHand: null });

      const row = await world.prisma.branchProduct.findUniqueOrThrow({
        where: { branchId_productId: { branchId: tenant.branch1.id, productId: product.id } },
      });
      const audits = await world.prisma.auditEvent.findMany({
        where: { targetId: row.id, action: "branch.product_availability_set" },
      });
      expect(audits).toHaveLength(2);
    });

    it("stock on hand cannot be set below units held for open orders", async () => {
      const { product } = await catalog();
      const path = productPath(tenant.branch1.id, product.id);
      await world.put(path, owner.token, { enabled: true, stockOnHand: 3 }).expect(200);
      await world.prisma.branchProduct.update({
        where: { branchId_productId: { branchId: tenant.branch1.id, productId: product.id } },
        data: { stockReserved: 2 },
      });
      const res = await world.put(path, owner.token, { enabled: true, stockOnHand: 1 }).expect(409);
      expect(errorResponseSchema.parse(res.body).error.message).toMatch(/2 units held/);
      await world.put(path, owner.token, { enabled: true, stockOnHand: 2 }).expect(200);
    });

    it("an archived product cannot be enabled at a branch", async () => {
      const { product } = await catalog();
      await world.prisma.product.update({
        where: { id: product.id },
        data: { status: "archived" },
      });
      const res = await world
        .put(productPath(tenant.branch1.id, product.id), owner.token, { enabled: true })
        .expect(409);
      expect(errorResponseSchema.parse(res.body).error.code).toBe("INVALID_TRANSITION");
      await world
        .put(productPath(tenant.branch1.id, product.id), owner.token, { enabled: false })
        .expect(200);
    });

    it("option overrides work the same way", async () => {
      const { option } = await catalog();
      const res = await world
        .put(`/v1/merchant/branches/${tenant.branch1.id}/options/${option.id}`, manager.token, {
          enabled: true,
          deltaOverrideFils: "150",
        })
        .expect(200);
      expect(branchOptionResponseSchema.parse(res.body).data).toMatchObject({
        enabled: true,
        deltaOverrideFils: "150",
      });
    });

    it("baristas, unassigned managers and other tenants cannot change availability", async () => {
      const { product } = await catalog();
      await world
        .put(productPath(tenant.branch1.id, product.id), barista.token, { enabled: false })
        .expect(403);
      await world
        .put(productPath(tenant.branch2.id, product.id), manager.token, { enabled: false })
        .expect(404);

      const other = await world.tenant("OtherBranches");
      const otherOwner = await world.person({ merchantId: other.merchant.id, role: "owner" });
      // Their branch, our product: the product is not found in their tenant.
      await world
        .put(productPath(other.branch1.id, product.id), otherOwner.token, { enabled: false })
        .expect(404);
      // Our branch: not found.
      await world
        .put(productPath(tenant.branch1.id, product.id), otherOwner.token, { enabled: false })
        .expect(404);
    });
  });
});
