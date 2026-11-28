/**
 * Synthetic development data (docs/06-database-schema.md, "Migration and seed rules"):
 * two merchants with two branches each, an English/Arabic test menu, staff roles, admin
 * roles, opening hours, stock and a SANDBOX commission policy.
 *
 * - Every person, business and licence number here is fictional.
 * - Arabic strings are placeholders for testing right-to-left layout. They are NOT reviewed
 *   translations and must not be used as production copy.
 * - The commission policy is a sandbox value (decision D02 is not approved) and is left
 *   unapproved (approved_by is null).
 * - auth_subject values are fake. Sign in as these accounts locally with development sign-in
 *   (DEV_AUTH_ENABLED=true, never in production), or point them at a test Supabase project.
 *
 * Safe to re-run: every row has a fixed ID and is upserted.
 * Usage: pnpm db:seed (refuses to run with NODE_ENV=production).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed synthetic data with NODE_ENV=production.");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

/** Deterministic UUIDs so the seed is idempotent and tests can refer to rows. */
const id = (group: number, n: number) =>
  `00000000-0000-4000-8000-${group.toString(16).padStart(4, "0")}${n.toString(16).padStart(8, "0")}`;

const SEED = {
  users: {
    customer: id(1, 1),
    ownerA: id(1, 2),
    managerA: id(1, 3),
    baristaA: id(1, 4),
    ownerB: id(1, 5),
    adminSecurity: id(1, 6),
    adminOps: id(1, 7),
    adminFinanceMaker: id(1, 8),
    adminFinanceChecker: id(1, 9),
    adminSupport: id(1, 10),
    adminMarketing: id(1, 11),
    adminSuper: id(1, 12),
    customer2: id(1, 13),
  },
  merchants: { a: id(2, 1), b: id(2, 2) },
  branches: { a1: id(3, 1), a2: id(3, 2), b1: id(3, 3), b2: id(3, 4) },
};

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

async function upsertUsers() {
  const users: Prisma.UserCreateInput[] = [
    {
      id: SEED.users.customer,
      authSubject: "seed-customer",
      displayName: "Test Customer",
      email: "customer@example.test",
      locale: "en",
    },
    {
      id: SEED.users.ownerA,
      authSubject: "seed-owner-a",
      displayName: "Test Owner A",
      email: "owner-a@example.test",
    },
    {
      id: SEED.users.managerA,
      authSubject: "seed-manager-a",
      displayName: "Test Manager A",
      email: "manager-a@example.test",
    },
    {
      id: SEED.users.baristaA,
      authSubject: "seed-barista-a",
      displayName: "Test Barista A",
      email: "barista-a@example.test",
      locale: "ar",
    },
    {
      id: SEED.users.ownerB,
      authSubject: "seed-owner-b",
      displayName: "Test Owner B",
      email: "owner-b@example.test",
    },
    {
      id: SEED.users.adminSecurity,
      authSubject: "seed-admin-security",
      displayName: "Test Security Admin",
      email: "security@example.test",
    },
    {
      id: SEED.users.adminOps,
      authSubject: "seed-admin-ops",
      displayName: "Test Operations Admin",
      email: "ops@example.test",
    },
    {
      id: SEED.users.adminFinanceMaker,
      authSubject: "seed-admin-finance-maker",
      displayName: "Test Finance Maker",
      email: "finance-maker@example.test",
    },
    {
      id: SEED.users.adminFinanceChecker,
      authSubject: "seed-admin-finance-checker",
      displayName: "Test Finance Checker",
      email: "finance-checker@example.test",
    },
    {
      id: SEED.users.adminSupport,
      authSubject: "seed-admin-support",
      displayName: "Test Support Agent",
      email: "support@example.test",
    },
    {
      id: SEED.users.adminMarketing,
      authSubject: "seed-admin-marketing",
      displayName: "Test Marketing Admin",
      email: "marketing@example.test",
    },
    {
      id: SEED.users.adminSuper,
      authSubject: "seed-admin-super",
      displayName: "Test Super Admin",
      email: "super@example.test",
    },
    {
      id: SEED.users.customer2,
      authSubject: "seed-customer-2",
      displayName: "Test Customer Two",
      phone: "+971500000002",
      locale: "ar",
    },
  ];
  for (const user of users) {
    await prisma.user.upsert({ where: { id: user.id! }, create: user, update: {} });
  }
  for (const [userId, role] of [
    [SEED.users.adminSecurity, "security"],
    [SEED.users.adminOps, "operations"],
    [SEED.users.adminFinanceMaker, "finance_maker"],
    [SEED.users.adminFinanceChecker, "finance_checker"],
    [SEED.users.adminSupport, "support"],
    [SEED.users.adminMarketing, "marketing"],
    [SEED.users.adminSuper, "super_admin"],
    [SEED.users.adminSuper, "security"],
  ] as const) {
    await prisma.adminRole.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role },
      update: {},
    });
  }
}

interface MerchantSeed {
  id: string;
  legalName: string;
  brandName: string;
  licenseNumber: string;
  ownerId: string;
  branches: {
    id: string;
    nameEn: string;
    nameAr: string;
    address: string;
    lat: number;
    lng: number;
    modes: string[];
  }[];
}

const merchants: MerchantSeed[] = [
  {
    id: SEED.merchants.a,
    legalName: "Sandbox Roastery A LLC (fictional)",
    brandName: "Sandbox Roastery A",
    licenseNumber: "TEST-LIC-0001",
    ownerId: SEED.users.ownerA,
    branches: [
      {
        id: SEED.branches.a1,
        nameEn: "Roastery A Corniche",
        nameAr: "[للمراجعة] فرع الكورنيش",
        address: "Test address 1, Abu Dhabi",
        lat: 24.4764,
        lng: 54.3227,
        modes: ["in_store", "curbside", "dine_in"],
      },
      {
        id: SEED.branches.a2,
        nameEn: "Roastery A Saadiyat",
        nameAr: "[للمراجعة] فرع السعديات",
        address: "Test address 2, Abu Dhabi",
        lat: 24.5394,
        lng: 54.4334,
        modes: ["in_store"],
      },
    ],
  },
  {
    id: SEED.merchants.b,
    legalName: "Sandbox Cafe B LLC (fictional)",
    brandName: "Sandbox Cafe B",
    licenseNumber: "TEST-LIC-0002",
    ownerId: SEED.users.ownerB,
    branches: [
      {
        id: SEED.branches.b1,
        nameEn: "Cafe B Al Reem",
        nameAr: "[للمراجعة] فرع الريم",
        address: "Test address 3, Abu Dhabi",
        lat: 24.4991,
        lng: 54.4039,
        modes: ["in_store", "curbside"],
      },
      {
        id: SEED.branches.b2,
        nameEn: "Cafe B Khalifa City",
        nameAr: "[للمراجعة] فرع مدينة خليفة",
        address: "Test address 4, Abu Dhabi",
        lat: 24.4199,
        lng: 54.5786,
        modes: ["curbside"],
      },
    ],
  },
];

/** Same test menu for both merchants; IDs differ per merchant. */
function menuFor(merchantIndex: number) {
  const g = 10 + merchantIndex * 10;
  return {
    category: { id: id(g, 1), nameEn: "Hot drinks", nameAr: "[للمراجعة] مشروبات ساخنة" },
    groups: [
      {
        id: id(g + 1, 1),
        name: { en: "Milk", ar: "[للمراجعة] الحليب" },
        minCount: 1,
        maxCount: 1,
        options: [
          {
            id: id(g + 2, 1),
            name: { en: "Full fat", ar: "[للمراجعة] كامل الدسم" },
            deltaFils: 0n,
          },
          { id: id(g + 2, 2), name: { en: "Oat", ar: "[للمراجعة] شوفان" }, deltaFils: 300n },
        ],
      },
      {
        id: id(g + 1, 2),
        name: { en: "Extra shot", ar: "[للمراجعة] جرعة إضافية" },
        minCount: 0,
        maxCount: 2,
        options: [
          {
            id: id(g + 2, 3),
            name: { en: "Espresso shot", ar: "[للمراجعة] جرعة إسبريسو" },
            deltaFils: 400n,
          },
        ],
      },
    ],
    products: [
      {
        id: id(g + 3, 1),
        names: { en: "Flat white", ar: "[للمراجعة] فلات وايت" },
        baseFils: 1800n,
        allergens: ["milk"],
        groups: [0, 1],
      },
      {
        id: id(g + 3, 2),
        names: { en: "Espresso", ar: "[للمراجعة] إسبريسو" },
        baseFils: 1200n,
        allergens: [],
        groups: [1],
      },
      {
        id: id(g + 3, 3),
        names: { en: "Pour over", ar: "[للمراجعة] قهوة مقطرة" },
        baseFils: 2400n,
        allergens: [],
        groups: [],
      },
    ],
  };
}

async function upsertMerchant(m: MerchantSeed, index: number) {
  await prisma.merchant.upsert({
    where: { id: m.id },
    create: {
      id: m.id,
      legalName: m.legalName,
      brandName: m.brandName,
      licenseNumber: m.licenseNumber,
      status: "approved",
    },
    update: {},
  });

  for (const b of m.branches) {
    await prisma.branch.upsert({
      where: { id: b.id },
      // All sample branches are in the proposed Abu Dhabi pilot (D01).
      create: {
        ...b,
        merchantId: m.id,
        city: "abu_dhabi",
        timezone: "Asia/Dubai",
        status: "active",
        capacity: 12,
      },
      update: { city: "abu_dhabi" },
    });
    // Saturday-Thursday 07:00-22:00; Friday 07:00-11:30 and 13:30-23:00 (sample only).
    const existing = await prisma.branchHour.count({ where: { branchId: b.id } });
    if (existing === 0) {
      const rows: Prisma.BranchHourCreateManyInput[] = [];
      for (const weekday of [1, 2, 3, 4, 6, 7])
        rows.push({ branchId: b.id, weekday, opens: time("07:00"), closes: time("22:00") });
      rows.push({ branchId: b.id, weekday: 5, opens: time("07:00"), closes: time("11:30") });
      rows.push({ branchId: b.id, weekday: 5, opens: time("13:30"), closes: time("23:00") });
      await prisma.branchHour.createMany({ data: rows });
    }
  }

  await prisma.membership.upsert({
    where: { userId_merchantId: { userId: m.ownerId, merchantId: m.id } },
    create: { id: id(4, index * 10 + 1), userId: m.ownerId, merchantId: m.id, role: "owner" },
    update: {},
  });

  const menu = menuFor(index);
  await prisma.category.upsert({
    where: { id: menu.category.id },
    create: { ...menu.category, merchantId: m.id, sort: 0 },
    update: {},
  });
  for (const [sort, group] of menu.groups.entries()) {
    await prisma.modifierGroup.upsert({
      where: { id: group.id },
      create: {
        id: group.id,
        merchantId: m.id,
        name: group.name,
        minCount: group.minCount,
        maxCount: group.maxCount,
        sort,
      },
      update: {},
    });
    for (const option of group.options) {
      await prisma.modifierOption.upsert({
        where: { id: option.id },
        create: { ...option, groupId: group.id, merchantId: m.id },
        update: {},
      });
      for (const b of m.branches) {
        await prisma.branchOption.upsert({
          where: { branchId_optionId: { branchId: b.id, optionId: option.id } },
          create: { branchId: b.id, optionId: option.id, merchantId: m.id },
          update: {},
        });
      }
    }
  }
  for (const product of menu.products) {
    await prisma.product.upsert({
      where: { id: product.id },
      create: {
        id: product.id,
        merchantId: m.id,
        categoryId: menu.category.id,
        names: product.names,
        baseFils: product.baseFils,
        allergens: product.allergens,
        status: "published",
      },
      update: {},
    });
    for (const [sort, groupIndex] of product.groups.entries()) {
      const groupId = menu.groups[groupIndex]!.id;
      await prisma.productGroup.upsert({
        where: { productId_groupId: { productId: product.id, groupId } },
        create: { productId: product.id, groupId, merchantId: m.id, sort },
        update: {},
      });
    }
    for (const [branchIndex, b] of m.branches.entries()) {
      await prisma.branchProduct.upsert({
        where: { branchId_productId: { branchId: b.id, productId: product.id } },
        create: {
          branchId: b.id,
          productId: product.id,
          merchantId: m.id,
          // Second branch tracks stock for the pour over, to exercise stock rules later.
          stockOnHand: branchIndex === 1 && product.baseFils === 2400n ? 5 : null,
        },
        update: {},
      });
    }
  }
}

async function upsertStaffA() {
  // Manager assigned to both A branches; barista assigned to A1 only.
  const manager = await prisma.membership.upsert({
    where: { userId_merchantId: { userId: SEED.users.managerA, merchantId: SEED.merchants.a } },
    create: {
      id: id(4, 2),
      userId: SEED.users.managerA,
      merchantId: SEED.merchants.a,
      role: "manager",
    },
    update: {},
  });
  const barista = await prisma.membership.upsert({
    where: { userId_merchantId: { userId: SEED.users.baristaA, merchantId: SEED.merchants.a } },
    create: {
      id: id(4, 3),
      userId: SEED.users.baristaA,
      merchantId: SEED.merchants.a,
      role: "barista",
    },
    update: {},
  });
  for (const [membershipId, branchId] of [
    [manager.id, SEED.branches.a1],
    [manager.id, SEED.branches.a2],
    [barista.id, SEED.branches.a1],
  ] as const) {
    await prisma.membershipBranch.upsert({
      where: { membershipId_branchId: { membershipId, branchId } },
      create: { membershipId, branchId, merchantId: SEED.merchants.a },
      update: {},
    });
  }
}

async function upsertSandboxPolicy() {
  await prisma.policy.upsert({
    where: { type_version: { type: "commission", version: "sandbox-v1" } },
    create: {
      type: "commission",
      version: "sandbox-v1",
      effectiveAt: new Date("2026-01-01T00:00:00Z"),
      configuration: {
        sandbox: true,
        notice: "SANDBOX ONLY. Decision D02 (commission basis, rate and VAT) is not approved.",
        rateBasisPoints: 1000,
        basis: "merchandise_net_of_merchant_funded_discount",
      },
    },
    update: {},
  });
  // Founder decision D02, 2026-11-28 (development and sandbox only): 10% on net merchandise value
  // excluding VAT and refunded amounts; no registration, subscription or customer service fee.
  await prisma.policy.upsert({
    where: { type_version: { type: "commission", version: "sandbox-v2" } },
    create: {
      type: "commission",
      version: "sandbox-v2",
      effectiveAt: new Date("2026-11-28T00:00:00Z"),
      configuration: {
        sandbox: true,
        notice:
          "SANDBOX DEFAULT (founder decision D02, 2026-11-28). Not approved for real transactions.",
        rateBasisPoints: 1000,
        vatExcluded: true,
        basis: "net_merchandise_excluding_vat_and_refunds",
        registrationFeeFils: 0,
        subscriptionFeeFils: 0,
        customerServiceFeeFils: 0,
        payoutSchedule: "weekly",
        reserveBasisPoints: 0,
      },
    },
    update: {},
  });
}

/**
 * Phase 9 sandbox data: features on, a stamp card and an approved promo code for café A, and a
 * dine-in table at its first branch. Created once; later admin or merchant changes are kept.
 */
async function upsertEngagement() {
  await prisma.platformSetting.upsert({
    where: { key: "features" },
    create: {
      key: "features",
      value: { stampCards: true, promotions: true, dineIn: true, sandboxGifts: true },
    },
    update: {},
  });
  await prisma.branch.update({
    where: { id: SEED.branches.a1 },
    data: { modes: ["in_store", "curbside", "dine_in"] },
  });
  await prisma.stampCard.upsert({
    where: { merchantId: SEED.merchants.a },
    create: {
      id: id(90, 1),
      merchantId: SEED.merchants.a,
      nameEn: "Sandbox stamp card",
      nameAr: "[للمراجعة] بطاقة الطوابع التجريبية",
      stampsRequired: 5,
      rewardEn: "One drink on us",
      rewardAr: "[للمراجعة] مشروب مجاني",
      rewardMaxFils: 2500n,
    },
    update: {},
  });
  const now = new Date();
  await prisma.promotion.upsert({
    where: { merchantId_code: { merchantId: SEED.merchants.a, code: "SANDBOX10" } },
    create: {
      id: id(90, 2),
      merchantId: SEED.merchants.a,
      code: "SANDBOX10",
      nameEn: "Sandbox 10% off",
      kind: "percent",
      percentBasisPoints: 1000,
      maxDiscountFils: 1000n,
      startsAt: now,
      endsAt: new Date(now.getTime() + 365 * 86_400_000),
      perCustomerLimit: 100,
      status: "approved",
      reviewNote: "Sandbox seed",
    },
    update: {},
  });
  await prisma.branchTable.upsert({
    where: { id: id(90, 3) },
    create: { id: id(90, 3), branchId: SEED.branches.a1, label: "T1" },
    update: {},
  });
}

async function main() {
  await upsertUsers();
  for (const [index, merchant] of merchants.entries()) await upsertMerchant(merchant, index);
  await upsertStaffA();
  await upsertSandboxPolicy();
  await upsertEngagement();
  const counts = {
    users: await prisma.user.count(),
    merchants: await prisma.merchant.count(),
    branches: await prisma.branch.count(),
    products: await prisma.product.count(),
    memberships: await prisma.membership.count(),
    policies: await prisma.policy.count(),
  };
  console.log("Seed complete (synthetic data only):", counts);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
