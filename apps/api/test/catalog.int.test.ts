import {
  categoryResponseSchema,
  errorResponseSchema,
  modifierGroupResponseSchema,
  productListResponseSchema,
  productResponseSchema,
} from "@beans/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MerchantWorld } from "./merchant-world.js";

describe("menu: categories, drink options, products and publish rules", () => {
  let world: MerchantWorld;
  let tenant: Awaited<ReturnType<MerchantWorld["tenant"]>>;
  let owner: Awaited<ReturnType<MerchantWorld["person"]>>;

  beforeAll(async () => {
    world = await MerchantWorld.create();
    tenant = await world.tenant("Menu");
    owner = await world.person({ merchantId: tenant.merchant.id, role: "owner" });
  });
  afterAll(() => world.close());

  const merchantId = () => tenant.merchant.id;

  async function category(token = owner.token, names = { en: "Hot drinks" }) {
    const res = await world
      .post("/v1/merchant/categories", token, { merchantId: merchantId(), names })
      .expect(201);
    return categoryResponseSchema.parse(res.body).data;
  }

  async function group(minCount = 1, maxCount = 1) {
    const res = await world
      .post("/v1/merchant/modifier-groups", owner.token, {
        merchantId: merchantId(),
        names: { en: "Size" },
        minCount,
        maxCount,
        options: [
          { names: { en: "Small" }, deltaFils: "0" },
          { names: { en: "Large" }, deltaFils: "350" },
        ],
      })
      .expect(201);
    return modifierGroupResponseSchema.parse(res.body).data;
  }

  async function product(categoryId: string, groupIds: string[] = []) {
    const res = await world
      .post("/v1/merchant/products", owner.token, {
        merchantId: merchantId(),
        categoryId,
        names: { en: "Flat white" },
        priceFils: "1800",
        allergens: ["milk"],
        groupIds,
      })
      .expect(201);
    return productResponseSchema.parse(res.body).data;
  }

  const patchProduct = (id: string, body: object, token = owner.token) =>
    world.patch(`/v1/merchant/products/${id}`, token, body);

  it("creates products as drafts with money as fils strings and publishes them", async () => {
    const cat = await category();
    const size = await group();
    const created = await product(cat.id, [size.id]);
    expect(created).toMatchObject({
      status: "draft",
      version: 1,
      priceFils: "1800",
      groupIds: [size.id],
    });

    const published = productResponseSchema.parse(
      (await patchProduct(created.id, { expectedVersion: 1, status: "published" }).expect(200))
        .body,
    ).data;
    expect(published).toMatchObject({ status: "published", version: 2 });

    const list = productListResponseSchema.parse(
      (
        await world
          .get(`/v1/merchant/products?merchantId=${merchantId()}&status=published`, owner.token)
          .expect(200)
      ).body,
    );
    expect(list.data.map((p) => p.id)).toContain(created.id);
  });

  it("rejects a client-supplied price that is not whole fils", async () => {
    const cat = await category();
    const res = await world
      .post("/v1/merchant/products", owner.token, {
        merchantId: merchantId(),
        categoryId: cat.id,
        names: { en: "Bad" },
        priceFils: "18.50",
      })
      .expect(400);
    expect(errorResponseSchema.parse(res.body).error.fieldErrors).toHaveProperty("priceFils");
  });

  it("answers 409 with the current version when the edit is stale", async () => {
    const created = await product((await category()).id);
    await patchProduct(created.id, { expectedVersion: 1, priceFils: "1900" }).expect(200);
    const stale = await patchProduct(created.id, { expectedVersion: 1, priceFils: "2000" }).expect(
      409,
    );
    expect(errorResponseSchema.parse(stale.body).error.fieldErrors?.["expectedVersion"]).toEqual([
      "Current version is 2",
    ]);
    const fresh = await world.get(`/v1/merchant/products/${created.id}`, owner.token).expect(200);
    expect(productResponseSchema.parse(fresh.body).data.priceFils).toBe("1900");
  });

  it("publish rule: an unapproved merchant cannot publish (API and database)", async () => {
    const cat = await category();
    const created = await product(cat.id);
    await world.prisma.merchant.update({ where: { id: merchantId() }, data: { status: "review" } });
    try {
      const res = await patchProduct(created.id, {
        expectedVersion: 1,
        status: "published",
      }).expect(409);
      expect(errorResponseSchema.parse(res.body).error.code).toBe("INVALID_TRANSITION");
      await expect(
        world.prisma.product.update({ where: { id: created.id }, data: { status: "published" } }),
      ).rejects.toThrow(/not approved/);
    } finally {
      await world.prisma.merchant.update({
        where: { id: merchantId() },
        data: { status: "approved" },
      });
    }
  });

  it("publish rule: the category must be active, and an active category with published products cannot be deactivated", async () => {
    const cat = await category();
    const live = await product(cat.id);
    await patchProduct(live.id, { expectedVersion: 1, status: "published" }).expect(200);
    const blocked = await world
      .patch(`/v1/merchant/categories/${cat.id}`, owner.token, { active: false })
      .expect(409);
    expect(errorResponseSchema.parse(blocked.body).error.message).toMatch(/1 published products/);

    const quiet = await category();
    const draft = await product(quiet.id);
    await world
      .patch(`/v1/merchant/categories/${quiet.id}`, owner.token, { active: false })
      .expect(200);
    const res = await patchProduct(draft.id, { expectedVersion: 1, status: "published" }).expect(
      422,
    );
    expect(errorResponseSchema.parse(res.body).error.fieldErrors).toHaveProperty("categoryId");
    // The failed publish rolled back: still a draft at version 1.
    const after = await world.get(`/v1/merchant/products/${draft.id}`, owner.token).expect(200);
    expect(productResponseSchema.parse(after.body).data).toMatchObject({
      status: "draft",
      version: 1,
    });
  });

  it("validates option rules: min ≤ max and enough active options for min", async () => {
    const bad = await world
      .post("/v1/merchant/modifier-groups", owner.token, {
        merchantId: merchantId(),
        names: { en: "Shots" },
        minCount: 2,
        maxCount: 3,
        options: [{ names: { en: "Single" }, deltaFils: "0" }],
      })
      .expect(400);
    expect(errorResponseSchema.parse(bad.body).error.fieldErrors).toHaveProperty("options");

    const size = await group(1, 1);
    const reversed = await world
      .patch(`/v1/merchant/modifier-groups/${size.id}`, owner.token, {
        expectedVersion: 1,
        minCount: 2,
        maxCount: 1,
      })
      .expect(400);
    expect(errorResponseSchema.parse(reversed.body).error.fieldErrors).toHaveProperty("minCount");
    await world
      .patch(`/v1/merchant/modifier-groups/${size.id}`, owner.token, {
        expectedVersion: 1,
        minCount: -1,
      })
      .expect(400);
  });

  it("deactivates options left out of an update instead of deleting them, and adds new ones", async () => {
    const size = await group();
    const [small, large] = size.options;
    const res = await world
      .patch(`/v1/merchant/modifier-groups/${size.id}`, owner.token, {
        expectedVersion: 1,
        options: [
          { id: small?.id, names: { en: "Small" }, deltaFils: "0" },
          { names: { en: "Medium" }, deltaFils: "200" },
        ],
      })
      .expect(200);
    const updated = modifierGroupResponseSchema.parse(res.body).data;
    expect(updated.version).toBe(2);
    expect(updated.options.map((o) => [o.names.en, o.active])).toEqual([
      ["Small", true],
      ["Large", false],
      ["Medium", true],
    ]);
    expect(await world.prisma.modifierOption.count({ where: { id: large?.id ?? "" } })).toBe(1);

    const foreign = await world
      .patch(`/v1/merchant/modifier-groups/${size.id}`, owner.token, {
        expectedVersion: 2,
        options: [
          { id: "00000000-0000-4000-8000-000000000000", names: { en: "X" }, deltaFils: "0" },
        ],
      })
      .expect(400);
    expect(errorResponseSchema.parse(foreign.body).error.fieldErrors).toHaveProperty("options");
  });

  it("archives instead of deleting, and an archived product must go back to draft before publishing", async () => {
    const created = await product((await category()).id);
    await patchProduct(created.id, { expectedVersion: 1, status: "archived" }).expect(200);
    const res = await patchProduct(created.id, { expectedVersion: 2, status: "published" }).expect(
      409,
    );
    expect(errorResponseSchema.parse(res.body).error.code).toBe("INVALID_TRANSITION");
    await patchProduct(created.id, { expectedVersion: 2, status: "draft" }).expect(200);
  });

  it("menu editing: owner and delegated manager may write; plain manager reads; barista and analyst are refused", async () => {
    const managerBranch = [tenant.branch1.id];
    const delegated = await world.person({
      merchantId: merchantId(),
      role: "manager",
      branchIds: managerBranch,
      catalogDelegated: true,
    });
    const manager = await world.person({
      merchantId: merchantId(),
      role: "manager",
      branchIds: managerBranch,
    });
    const barista = await world.person({
      merchantId: merchantId(),
      role: "barista",
      branchIds: managerBranch,
    });
    const analyst = await world.person({ merchantId: merchantId(), role: "analyst" });

    await category(delegated.token, { en: "By manager" });
    await world
      .post("/v1/merchant/categories", manager.token, {
        merchantId: merchantId(),
        names: { en: "No" },
      })
      .expect(403);
    await world
      .get(`/v1/merchant/categories?merchantId=${merchantId()}`, manager.token)
      .expect(200);
    await world
      .get(`/v1/merchant/categories?merchantId=${merchantId()}`, barista.token)
      .expect(403);
    await world.get(`/v1/merchant/products?merchantId=${merchantId()}`, analyst.token).expect(403);
  });

  it("other tenants' menus are not found, and IDs from another tenant cannot be attached", async () => {
    const other = await world.tenant("OtherMenu");
    const otherOwner = await world.person({ merchantId: other.merchant.id, role: "owner" });
    const mine = await product((await category()).id);

    await world.get(`/v1/merchant/products/${mine.id}`, otherOwner.token).expect(404);
    const res = await patchProduct(
      mine.id,
      { expectedVersion: 1, priceFils: "1" },
      otherOwner.token,
    ).expect(404);
    expect(errorResponseSchema.parse(res.body).error.message).toBe("Product not found");
    await world
      .get(`/v1/merchant/categories?merchantId=${merchantId()}`, otherOwner.token)
      .expect(404);

    const theirCategory = categoryResponseSchema.parse(
      (
        await world
          .post("/v1/merchant/categories", otherOwner.token, {
            merchantId: other.merchant.id,
            names: { en: "Theirs" },
          })
          .expect(201)
      ).body,
    ).data;
    const cross = await patchProduct(mine.id, {
      expectedVersion: 1,
      categoryId: theirCategory.id,
    }).expect(400);
    expect(errorResponseSchema.parse(cross.body).error.fieldErrors).toHaveProperty("categoryId");
  });

  it("audits menu changes", async () => {
    const created = await product((await category()).id);
    const events = await world.prisma.auditEvent.findMany({ where: { targetId: created.id } });
    expect(events.map((e) => e.action)).toContain("catalog.product_created");
  });
});
