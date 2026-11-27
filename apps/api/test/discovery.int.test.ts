import { randomUUID } from "node:crypto";
import {
  branchMenuResponseSchema,
  errorResponseSchema,
  favoriteListResponseSchema,
  pricedItemResponseSchema,
  publicBranchListResponseSchema,
  publicBranchResponseSchema,
  publicSlotsResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";

const allWeek = (opens: string, closes: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    opens: new Date(`1970-01-01T${opens}:00Z`),
    closes: new Date(`1970-01-01T${closes}:00Z`),
  }));

describe("customer discovery: search, branch, menu, item pricing, slots, favorites", () => {
  let world: MerchantWorld;
  /** Unique word in every brand name so tests ignore cafés created by other suites. */
  const tag = `zq${randomUUID().slice(0, 6)}`;
  let cafe: Awaited<ReturnType<typeof makeCafe>>;

  async function makeCafe(
    label: string,
    opts: { city?: string; lat?: number; lng?: number; open?: boolean } = {},
  ) {
    const merchant = await world.prisma.merchant.create({
      data: {
        legalName: `${label} LLC`,
        brandName: `${label} ${tag}`,
        licenseNumber: `DISC-${randomUUID().slice(0, 12)}`,
        status: "approved",
      },
    });
    const branch = await world.prisma.branch.create({
      data: {
        merchantId: merchant.id,
        nameEn: `${label} Corniche`,
        nameAr: "[للمراجعة] فرع",
        address: "Test",
        city: opts.city ?? "abu_dhabi",
        lat: opts.lat ?? null,
        lng: opts.lng ?? null,
        modes: ["in_store", "curbside"],
        capacity: 2,
        status: "active",
        // Open all day, or never (a 1-minute window at 00:00).
        hours: {
          create: opts.open === false ? allWeek("00:00", "00:01") : allWeek("00:00", "23:59"),
        },
      },
    });
    return { merchant, branch };
  }

  async function menuFor(merchantId: string, branchId: string) {
    const category = await world.prisma.category.create({ data: { merchantId, nameEn: "Coffee" } });
    const size = await world.prisma.modifierGroup.create({
      data: { merchantId, name: { en: "Size" }, minCount: 1, maxCount: 1 },
    });
    const small = await world.prisma.modifierOption.create({
      data: { groupId: size.id, merchantId, name: { en: "Small" }, deltaFils: 0n },
    });
    const large = await world.prisma.modifierOption.create({
      data: { groupId: size.id, merchantId, name: { en: "Large" }, deltaFils: 300n },
    });
    const extras = await world.prisma.modifierGroup.create({
      data: { merchantId, name: { en: "Extras" }, minCount: 0, maxCount: 2 },
    });
    const shot = await world.prisma.modifierOption.create({
      data: { groupId: extras.id, merchantId, name: { en: "Extra shot" }, deltaFils: 250n },
    });
    const syrup = await world.prisma.modifierOption.create({
      data: { groupId: extras.id, merchantId, name: { en: "Syrup" }, deltaFils: 150n },
    });
    const latte = await world.prisma.product.create({
      data: {
        merchantId,
        categoryId: category.id,
        names: { en: "Latte" },
        baseFils: 1800n,
        status: "published",
      },
    });
    await world.prisma.productGroup.createMany({
      data: [
        { productId: latte.id, groupId: size.id, merchantId, sort: 0 },
        { productId: latte.id, groupId: extras.id, merchantId, sort: 1 },
      ],
    });
    const draft = await world.prisma.product.create({
      data: { merchantId, categoryId: category.id, names: { en: "Secret draft" }, baseFils: 100n },
    });
    // Branch price for the latte and a branch-disabled syrup.
    await world.prisma.branchProduct.create({
      data: { branchId, productId: latte.id, merchantId, priceOverrideFils: 1700n },
    });
    await world.prisma.branchOption.create({
      data: { branchId, optionId: syrup.id, merchantId, enabled: false },
    });
    return { latte, draft, small, large, shot, syrup, size, extras };
  }

  beforeAll(async () => {
    world = await MerchantWorld.create();
    cafe = await makeCafe("Alpha", { lat: 24.47, lng: 54.37 });
  });
  afterAll(() => world.close());

  const http = () => request(world.app.getHttpServer());
  const search = async (query: string) =>
    publicBranchListResponseSchema.parse(
      (await http().get(`/v1/branches?q=${tag}&${query}`).expect(200)).body,
    );

  it("Q01: a guest without location browses by a manually chosen emirate", async () => {
    await makeCafe("Dubai", { city: "dubai" });
    const result = await search("city=abu_dhabi");
    expect(result.data.map((c) => c.brandName)).toContain(`Alpha ${tag}`);
    expect(result.data.every((c) => c.city === "abu_dhabi")).toBe(true);
    expect(result.data.every((c) => c.distanceMeters === null)).toBe(true);
    const card = result.data.find((c) => c.id === cafe.branch.id);
    expect(card).toMatchObject({ availability: "open", names: { en: "Alpha Corniche" } });
  });

  it("sorts nearest first only when a location is sent, and needs both coordinates", async () => {
    await makeCafe("Far", { lat: 24.6, lng: 54.6 });
    await makeCafe("Near", { lat: 24.471, lng: 54.371 });
    const ranked = await search("city=abu_dhabi&lat=24.47&lng=54.37");
    const withDistance = ranked.data.filter((c) => c.distanceMeters !== null);
    expect(withDistance.map((c) => c.brandName.split(" ")[0])).toEqual(["Alpha", "Near", "Far"]);
    await http().get("/v1/branches?lat=24.47").expect(400);
  });

  it("filters by pickup type and open now; closed branches stay visible, paused ones are marked", async () => {
    const closed = await makeCafe("Sleepy", { open: false });
    const paused = await makeCafe("Paused");
    await world.prisma.branch.update({
      where: { id: paused.branch.id },
      data: { status: "paused" },
    });

    const all = await search("limit=100");
    const byId = new Map(all.data.map((c) => [c.id, c]));
    expect(byId.get(closed.branch.id)?.availability).toBe("closed");
    expect(byId.get(paused.branch.id)?.availability).toBe("paused");

    const open = await search("openNow=true&limit=100");
    expect(open.data.every((c) => c.availability === "open")).toBe(true);
    expect(open.data.map((c) => c.id)).not.toContain(closed.branch.id);
    expect((await search("mode=dine_in")).data).toEqual([]);
  });

  it("hides drafts, closed branches and unapproved merchants", async () => {
    const hidden = await makeCafe("Hidden");
    await world.prisma.branch.update({
      where: { id: hidden.branch.id },
      data: { status: "closed" },
    });
    const unapproved = await makeCafe("Pending");
    await world.prisma.merchant.update({
      where: { id: unapproved.merchant.id },
      data: { status: "suspended" },
    });
    const ids = (await search("limit=100")).data.map((c) => c.id);
    expect(ids).not.toContain(hidden.branch.id);
    expect(ids).not.toContain(unapproved.branch.id);
    await http().get(`/v1/branches/${hidden.branch.id}`).expect(404);
    await http().get(`/v1/branches/${unapproved.branch.id}/menu`).expect(404);
  });

  it("pages through results with an opaque cursor", async () => {
    const first = await search("limit=2");
    expect(first.data).toHaveLength(2);
    expect(first.meta.nextCursor).not.toBeNull();
    const second = await search(`limit=2&cursor=${first.meta.nextCursor}`);
    expect(second.data.map((c) => c.id)).not.toContain(first.data[0]?.id);
    await http().get("/v1/branches?cursor=bogus").expect(400);
  });

  it("shows branch details with hours, sibling branches and no staff-only data", async () => {
    const sibling = await world.prisma.branch.create({
      data: {
        merchantId: cafe.merchant.id,
        nameEn: "Alpha Marina",
        address: "T",
        modes: ["in_store"],
        capacity: 1,
        status: "active",
      },
    });
    const detail = publicBranchResponseSchema.parse(
      (await http().get(`/v1/branches/${cafe.branch.id}`).expect(200)).body,
    ).data;
    expect(detail).toMatchObject({
      timezone: "Asia/Dubai",
      siblings: [{ id: sibling.id, names: { en: "Alpha Marina" } }],
    });
    expect(detail.hours).toHaveLength(7);
    expect(detail).not.toHaveProperty("capacity");
  });

  it("serves the published menu with branch prices and sold-out flags", async () => {
    const m = await menuFor(cafe.merchant.id, cafe.branch.id);
    const menu = branchMenuResponseSchema.parse(
      (await http().get(`/v1/branches/${cafe.branch.id}/menu`).expect(200)).body,
    ).data;
    const products = menu.categories.flatMap((c) => c.products);
    expect(products.map((p) => p.names.en)).toEqual(["Latte"]);
    const latte = products[0];
    expect(latte).toMatchObject({ priceFils: "1700", available: true });
    const syrup = latte?.groups[1]?.options.find((o) => o.id === m.syrup.id);
    expect(syrup).toMatchObject({ available: false, deltaFils: "150" });

    // Tracked stock exhausted → sold out, and the menu version changes.
    await world.prisma.branchProduct.update({
      where: { branchId_productId: { branchId: cafe.branch.id, productId: m.latte.id } },
      data: { stockOnHand: 0 },
    });
    const after = branchMenuResponseSchema.parse(
      (await http().get(`/v1/branches/${cafe.branch.id}/menu`).expect(200)).body,
    ).data;
    expect(after.categories[0]?.products[0]?.available).toBe(false);
    expect(after.version).not.toBe(menu.version);
    await world.prisma.branchProduct.update({
      where: { branchId_productId: { branchId: cafe.branch.id, productId: m.latte.id } },
      data: { stockOnHand: null },
    });
  });

  describe("Q02: server-side item pricing", () => {
    let m: Awaited<ReturnType<typeof menuFor>>;
    let branchId: string;
    const price = (body: object) => http().post(`/v1/branches/${branchId}/items/price`).send(body);

    beforeAll(async () => {
      const c = await makeCafe("Pricing");
      branchId = c.branch.id;
      m = await menuFor(c.merchant.id, c.branch.id);
    });

    it("computes the canonical total from branch prices", async () => {
      const res = await price({
        productId: m.latte.id,
        optionIds: [m.large.id, m.shot.id],
        quantity: 2,
      }).expect(200);
      // (1700 branch price + 300 large + 250 shot) × 2
      expect(pricedItemResponseSchema.parse(res.body).data).toMatchObject({
        unitFils: "2250",
        lineFils: "4500",
      });
    });

    it("rejects a missing required option", async () => {
      const res = await price({
        productId: m.latte.id,
        optionIds: [m.shot.id],
        quantity: 1,
      }).expect(422);
      expect(errorResponseSchema.parse(res.body).error.fieldErrors).toHaveProperty(
        `groups.${m.size.id}`,
      );
    });

    it("rejects a client-supplied price (unknown field) instead of trusting it", async () => {
      const res = await price({
        productId: m.latte.id,
        optionIds: [m.small.id],
        quantity: 1,
        unitFils: "1",
      }).expect(400);
      expect(errorResponseSchema.parse(res.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects too many choices, duplicates, foreign options, unavailable options and bad quantities", async () => {
      await price({
        productId: m.latte.id,
        optionIds: [m.small.id, m.large.id],
        quantity: 1,
      }).expect(422);
      await price({
        productId: m.latte.id,
        optionIds: [m.small.id, m.small.id],
        quantity: 1,
      }).expect(422);
      await price({
        productId: m.latte.id,
        optionIds: [m.small.id, randomUUID()],
        quantity: 1,
      }).expect(422);
      const off = await price({
        productId: m.latte.id,
        optionIds: [m.small.id, m.syrup.id],
        quantity: 1,
      }).expect(409);
      expect(errorResponseSchema.parse(off.body).error.code).toBe("OUT_OF_STOCK");
      await price({ productId: m.latte.id, optionIds: [m.small.id], quantity: 0 }).expect(400);
      await price({ productId: m.latte.id, optionIds: [m.small.id], quantity: 21 }).expect(400);
    });

    it("refuses drafts and products of other cafés", async () => {
      await price({ productId: m.draft.id, optionIds: [], quantity: 1 }).expect(404);
      await http()
        .post(`/v1/branches/${cafe.branch.id}/items/price`)
        .send({ productId: m.latte.id, quantity: 1 })
        .expect(404);
    });
  });

  it("lists future pickup times as available or full, never with counts", async () => {
    const c = await makeCafe("Slots");
    const date = dubaiDate(2);
    const res = await http()
      .get(`/v1/branches/${c.branch.id}/slots?date=${date}&mode=curbside`)
      .expect(200);
    const data = publicSlotsResponseSchema.parse(res.body).data;
    expect(data.slots.length).toBeGreaterThan(90);
    expect(Object.keys(data.slots[0] ?? {}).sort()).toEqual(["available", "id", "startsAt"]);

    const first = await world.prisma.slot.findFirstOrThrow({
      where: { branchId: c.branch.id },
      orderBy: { startsAt: "asc" },
    });
    await world.prisma.slot.update({ where: { id: first.id }, data: { reserved: 2 } });
    const again = publicSlotsResponseSchema.parse(
      (await http().get(`/v1/branches/${c.branch.id}/slots?date=${date}&mode=in_store`).expect(200))
        .body,
    ).data;
    expect(again.slots[0]).toEqual({
      id: first.id,
      startsAt: first.startsAt.toISOString(),
      available: false,
    });

    await http().get(`/v1/branches/${c.branch.id}/slots?date=${date}&mode=dine_in`).expect(422);
    await world.prisma.branch.update({ where: { id: c.branch.id }, data: { status: "paused" } });
    const paused = publicSlotsResponseSchema.parse(
      (await http().get(`/v1/branches/${c.branch.id}/slots?date=${date}&mode=in_store`).expect(200))
        .body,
    ).data;
    expect(paused).toMatchObject({ availability: "paused", slots: [] });
  });

  it("favorites need sign-in, only approved cafés can be saved, and saving twice is harmless", async () => {
    await http().get("/v1/favorites").expect(401);
    await http().put(`/v1/favorites/${cafe.merchant.id}`).expect(401);
    const customer = await world.person();
    await world.put(`/v1/favorites/${cafe.merchant.id}`, customer.token, {}).expect(200);
    await world.put(`/v1/favorites/${cafe.merchant.id}`, customer.token, {}).expect(200);
    await world.put(`/v1/favorites/${randomUUID()}`, customer.token, {}).expect(404);

    const list = favoriteListResponseSchema.parse(
      (await world.get("/v1/favorites", customer.token).expect(200)).body,
    );
    expect(list.data.map((f) => f.merchantId)).toEqual([cafe.merchant.id]);
    // Another customer sees only their own.
    const other = await world.person();
    expect(
      favoriteListResponseSchema.parse(
        (await world.get("/v1/favorites", other.token).expect(200)).body,
      ).data,
    ).toEqual([]);

    await request(world.app.getHttpServer())
      .delete(`/v1/favorites/${cafe.merchant.id}`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);
    expect(
      favoriteListResponseSchema.parse(
        (await world.get("/v1/favorites", customer.token).expect(200)).body,
      ).data,
    ).toEqual([]);
  });
});
