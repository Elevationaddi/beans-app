import { randomUUID } from "node:crypto";
import {
  branchOptionResponseSchema,
  branchProductResponseSchema,
  ticketListResponseSchema,
  ticketResponseSchema,
} from "@beans/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MerchantWorld } from "./merchant-world.js";

/** docs/05 T06: what a barista may change at the counter, and nothing more. */
describe("barista tablet: sold out toggles and issue reports", () => {
  let world: MerchantWorld;
  let tenant: Awaited<ReturnType<MerchantWorld["tenant"]>>;
  let other: Awaited<ReturnType<MerchantWorld["tenant"]>>;
  let productId: string;
  let optionId: string;

  beforeAll(async () => {
    world = await MerchantWorld.create();
    tenant = await world.tenant("Tablet");
    other = await world.tenant("Elsewhere");
    const category = await world.prisma.category.create({
      data: { merchantId: tenant.merchant.id, nameEn: "Hot" },
    });
    const product = await world.prisma.product.create({
      data: {
        merchantId: tenant.merchant.id,
        categoryId: category.id,
        names: { en: "Cortado" },
        baseFils: 1500n,
        status: "published",
      },
    });
    productId = product.id;
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
    optionId = option.id;
    // A branch price and tracked stock the barista must not be able to change.
    await world.prisma.branchProduct.create({
      data: {
        branchId: tenant.branch1.id,
        productId,
        merchantId: tenant.merchant.id,
        priceOverrideFils: 1600n,
        stockOnHand: 7,
      },
    });
  });
  afterAll(() => world.close());

  const soldOut = (path: string, token: string, value: boolean) =>
    world.post(path, token, { soldOut: value }).set("Idempotency-Key", randomUUID());

  it("lets a barista mark items sold out at their branch only, keeping price and stock", async () => {
    const barista = await world.person({
      merchantId: tenant.merchant.id,
      role: "barista",
      branchIds: [tenant.branch1.id],
    });
    const path = `/v1/merchant/branches/${tenant.branch1.id}/products/${productId}/sold-out`;
    const off = branchProductResponseSchema.parse(
      (await soldOut(path, barista.token, true).expect(200)).body,
    ).data;
    expect(off).toMatchObject({ enabled: false, priceOverrideFils: "1600", stockOnHand: 7 });
    const on = branchProductResponseSchema.parse(
      (await soldOut(path, barista.token, false).expect(200)).body,
    ).data;
    expect(on.enabled).toBe(true);
    expect(
      await world.prisma.auditEvent.count({
        where: { action: "branch.product_sold_out_set", actorId: barista.user.id },
      }),
    ).toBe(2);

    // Not their branch, not their business, and never the full availability editor.
    await soldOut(
      `/v1/merchant/branches/${tenant.branch2.id}/products/${productId}/sold-out`,
      barista.token,
      true,
    ).expect(404);
    await soldOut(
      `/v1/merchant/branches/${other.branch1.id}/products/${productId}/sold-out`,
      barista.token,
      true,
    ).expect(404);
    await world
      .put(`/v1/merchant/branches/${tenant.branch1.id}/products/${productId}`, barista.token, {
        enabled: true,
        priceOverrideFils: "1",
        stockOnHand: 999,
      })
      .expect(403);

    const option = branchOptionResponseSchema.parse(
      (
        await soldOut(
          `/v1/merchant/branches/${tenant.branch1.id}/options/${optionId}/sold-out`,
          barista.token,
          true,
        ).expect(200)
      ).body,
    ).data;
    expect(option).toMatchObject({ enabled: false, deltaOverrideFils: null });
  });

  it("refuses analysts and products of another business", async () => {
    const analyst = await world.person({
      merchantId: tenant.merchant.id,
      role: "analyst",
      branchIds: [tenant.branch1.id],
    });
    const owner = await world.person({ merchantId: tenant.merchant.id, role: "owner" });
    await soldOut(
      `/v1/merchant/branches/${tenant.branch1.id}/products/${productId}/sold-out`,
      analyst.token,
      true,
    ).expect(403);
    const foreign = await world.prisma.product.create({
      data: {
        merchantId: other.merchant.id,
        categoryId: (
          await world.prisma.category.create({
            data: { merchantId: other.merchant.id, nameEn: "X" },
          })
        ).id,
        names: { en: "Foreign" },
        baseFils: 100n,
      },
    });
    await soldOut(
      `/v1/merchant/branches/${tenant.branch1.id}/products/${foreign.id}/sold-out`,
      owner.token,
      true,
    ).expect(404);
  });

  it("lets a barista report an issue and see only their own reports", async () => {
    const barista = await world.person({
      merchantId: tenant.merchant.id,
      role: "barista",
      branchIds: [tenant.branch1.id],
    });
    const colleague = await world.person({
      merchantId: tenant.merchant.id,
      role: "barista",
      branchIds: [tenant.branch1.id],
    });
    const owner = await world.person({ merchantId: tenant.merchant.id, role: "owner" });
    const created = ticketResponseSchema.parse(
      (
        await world
          .post("/v1/tickets", barista.token, {
            category: "other",
            message: "Grinder is down at branch one",
            merchantId: tenant.merchant.id,
          })
          .set("Idempotency-Key", randomUUID())
          .expect(201)
      ).body,
    ).data;
    expect(created).toMatchObject({ channel: "merchant", merchantId: tenant.merchant.id });

    const mine = ticketListResponseSchema.parse(
      (await world.get(`/v1/tickets?merchantId=${tenant.merchant.id}`, barista.token).expect(200))
        .body,
    ).data;
    expect(mine.map((t) => t.id)).toEqual([created.id]);
    const theirs = ticketListResponseSchema.parse(
      (await world.get(`/v1/tickets?merchantId=${tenant.merchant.id}`, colleague.token).expect(200))
        .body,
    ).data;
    expect(theirs).toEqual([]);
    await world.get(`/v1/tickets/${created.id}`, barista.token).expect(200);
    await world.get(`/v1/tickets/${created.id}`, colleague.token).expect(404);
    const all = ticketListResponseSchema.parse(
      (await world.get(`/v1/tickets?merchantId=${tenant.merchant.id}`, owner.token).expect(200))
        .body,
    ).data;
    expect(all.map((t) => t.id)).toContain(created.id);

    // A barista of another business cannot raise tickets for this one.
    const outsider = await world.person({
      merchantId: other.merchant.id,
      role: "barista",
      branchIds: [other.branch1.id],
    });
    await world
      .post("/v1/tickets", outsider.token, {
        category: "other",
        message: "x",
        merchantId: tenant.merchant.id,
      })
      .set("Idempotency-Key", randomUUID())
      .expect(404);
  });
});
