import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SlotService } from "../src/inventory/slot.service.js";
import { StockService } from "../src/inventory/stock.service.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";

describe("stock and pickup capacity holds under concurrency", () => {
  let world: MerchantWorld;
  let tenant: Awaited<ReturnType<MerchantWorld["tenant"]>>;
  let stock: StockService;
  let slots: SlotService;
  let prisma: PrismaService;

  beforeAll(async () => {
    world = await MerchantWorld.create();
    tenant = await world.tenant("Inventory");
    stock = world.app.get(StockService);
    slots = world.app.get(SlotService);
    prisma = world.app.get(PrismaService);
  });
  afterAll(() => world.close());

  async function branchProduct(stockOnHand: number | null, enabled = true) {
    const category = await world.prisma.category.create({
      data: { merchantId: tenant.merchant.id, nameEn: "C" },
    });
    const product = await world.prisma.product.create({
      data: {
        merchantId: tenant.merchant.id,
        categoryId: category.id,
        names: { en: "Cortado" },
        baseFils: 1500n,
      },
    });
    await world.prisma.branchProduct.create({
      data: {
        branchId: tenant.branch1.id,
        productId: product.id,
        merchantId: tenant.merchant.id,
        enabled,
        stockOnHand,
      },
    });
    return product.id;
  }

  const reserved = async (productId: string) =>
    (
      await world.prisma.branchProduct.findUniqueOrThrow({
        where: { branchId_productId: { branchId: tenant.branch1.id, productId } },
      })
    ).stockReserved;

  it("the last unit goes to exactly one of many concurrent checkouts", async () => {
    const productId = await branchProduct(1);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        prisma.$transaction((tx) => stock.hold(tx, tenant.branch1.id, productId, 1)),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await reserved(productId)).toBe(1);
  });

  it("holds several units only when they are all available, and releases them", async () => {
    const productId = await branchProduct(5);
    expect(await stock.hold(prisma, tenant.branch1.id, productId, 4)).toBe(true);
    expect(await stock.hold(prisma, tenant.branch1.id, productId, 2)).toBe(false);
    expect(await stock.release(prisma, tenant.branch1.id, productId, 4)).toBe(true);
    expect(await stock.release(prisma, tenant.branch1.id, productId, 1)).toBe(false);
    expect(await reserved(productId)).toBe(0);
  });

  it("untracked stock only needs the product to be enabled at the branch", async () => {
    const open = await branchProduct(null);
    expect(await stock.hold(prisma, tenant.branch1.id, open, 50)).toBe(true);
    expect(await reserved(open)).toBe(0);
    const soldOut = await branchProduct(null, false);
    expect(await stock.hold(prisma, tenant.branch1.id, soldOut, 1)).toBe(false);
  });

  it("the database refuses reserved stock above stock on hand whatever the code path", async () => {
    const productId = await branchProduct(1);
    await expect(
      world.prisma.branchProduct.update({
        where: { branchId_productId: { branchId: tenant.branch1.id, productId } },
        data: { stockReserved: 2 },
      }),
    ).rejects.toThrow(/branch_products_stock_check/);
  });

  it("a slot never takes more orders than its capacity, even concurrently", async () => {
    await world.prisma.branch.update({ where: { id: tenant.branch1.id }, data: { capacity: 3 } });
    await world.prisma.branchHour.create({
      data: {
        branchId: tenant.branch1.id,
        weekday: 1,
        opens: new Date("1970-01-01T07:00:00Z"),
        closes: new Date("1970-01-01T07:15:00Z"),
      },
    });
    // Next Monday in Dubai.
    let date = dubaiDate(1);
    for (let i = 2; new Date(`${date}T00:00:00Z`).getUTCDay() !== 1; i += 1) date = dubaiDate(i);
    const [slot] = await slots.ensureSlots(tenant.branch1.id, date);
    if (!slot) throw new Error("expected one slot");
    expect(slot.capacity).toBe(3);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => prisma.$transaction((tx) => slots.hold(tx, slot.id, 1))),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    const after = await world.prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.reserved).toBe(3);
    await expect(
      world.prisma.slot.update({ where: { id: slot.id }, data: { confirmed: 1 } }),
    ).rejects.toThrow(/slots_counts_check/);

    // Reconciling the same day twice is idempotent.
    expect(await slots.ensureSlots(tenant.branch1.id, date)).toHaveLength(1);
  });
});
