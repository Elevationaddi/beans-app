import { afterAll, describe, expect, it } from "vitest";
import { createTenant, testPrisma } from "./fixtures.js";

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

describe("database constraints from docs/06", () => {
  const prisma = testPrisma();
  afterAll(() => prisma.$disconnect());

  it("rejects overlapping opening hours for the same branch and weekday", async () => {
    const { branch1 } = await createTenant(prisma, "Hours");
    await prisma.branchHour.create({
      data: { branchId: branch1.id, weekday: 1, opens: time("07:00"), closes: time("12:00") },
    });
    await prisma.branchHour.create({
      data: { branchId: branch1.id, weekday: 1, opens: time("13:00"), closes: time("22:00") },
    });
    await expect(
      prisma.branchHour.create({
        data: { branchId: branch1.id, weekday: 1, opens: time("11:00"), closes: time("14:00") },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.branchHour.create({
        data: { branchId: branch1.id, weekday: 8, opens: time("07:00"), closes: time("08:00") },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.branchHour.create({
        data: { branchId: branch1.id, weekday: 2, opens: time("22:00"), closes: time("02:00") },
      }),
    ).rejects.toThrow();
  });

  it("rejects negative money, invalid modifier counts and over-reserved stock", async () => {
    const { merchant, branch1 } = await createTenant(prisma, "Money");
    const category = await prisma.category.create({
      data: { merchantId: merchant.id, nameEn: "Hot" },
    });
    await expect(
      prisma.product.create({
        data: {
          merchantId: merchant.id,
          categoryId: category.id,
          names: { en: "X" },
          baseFils: -1n,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.product.create({
        data: {
          merchantId: merchant.id,
          categoryId: category.id,
          names: { ar: "X" },
          baseFils: 1n,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.modifierGroup.create({
        data: { merchantId: merchant.id, name: { en: "Milk" }, minCount: 2, maxCount: 1 },
      }),
    ).rejects.toThrow();
    const product = await prisma.product.create({
      data: {
        merchantId: merchant.id,
        categoryId: category.id,
        names: { en: "Latte" },
        baseFils: 1500n,
      },
    });
    await expect(
      prisma.branchProduct.create({
        data: {
          branchId: branch1.id,
          productId: product.id,
          merchantId: merchant.id,
          stockOnHand: 2,
          stockReserved: 3,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.branch.create({
        data: {
          merchantId: merchant.id,
          nameEn: "Bad",
          address: "x",
          modes: ["delivery"],
          capacity: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("makes a policy immutable once it is approved and effective", async () => {
    const approver = await prisma.user.create({
      data: { authSubject: `test-${crypto.randomUUID()}` },
    });
    const draft = await prisma.policy.create({
      data: {
        type: "test",
        version: `draft-${crypto.randomUUID()}`,
        effectiveAt: new Date(Date.now() + 86_400_000),
        configuration: { a: 1 },
      },
    });
    await prisma.policy.update({ where: { id: draft.id }, data: { configuration: { a: 2 } } });

    const effective = await prisma.policy.create({
      data: {
        type: "test",
        version: `live-${crypto.randomUUID()}`,
        effectiveAt: new Date(Date.now() - 1_000),
        configuration: { a: 1 },
        approvedById: approver.id,
      },
    });
    await expect(
      prisma.policy.update({ where: { id: effective.id }, data: { configuration: { a: 3 } } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.policy.delete({ where: { id: effective.id } })).rejects.toThrow(
      /immutable/,
    );
  });
});
