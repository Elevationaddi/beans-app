/**
 * Staging demo catalog (cycle 4): five fictional cafés that differ in menus, branches, hours,
 * prices, customizations, loyalty rules, promotions, pickup methods and table QR codes, plus one
 * application waiting for a manual licence check, and demo accounts for every role.
 *
 * - Every business, person, address and licence number is fictional. Emails use the reserved
 *   example.test domain, so nothing can ever be delivered to a real inbox.
 * - Arabic strings are drafts marked "[للمراجعة]" (needs review), for right-to-left testing only.
 * - Prices are sample values in integer fils (100 fils = AED 1), tax inclusive.
 * - Safe to re-run: fixed IDs, upserts, and existing rows are left as they are.
 *
 * Orders in every lifecycle stage are created separately through the API by
 * scripts/demo-orders.ts, so that payments, the journal and loyalty follow the real rules.
 *
 * Usage: pnpm db:demo (after pnpm db:migrate). Refuses DEPLOY_ENV=production.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client.js";

if (process.env.DEPLOY_ENV === "production") {
  console.error("Refusing to load demo data into production (DEPLOY_ENV=production).");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

/** Deterministic UUIDs in a range the base seed does not use (groups 0x200 and up). */
const id = (group: number, n: number) =>
  `00000000-0000-4000-8000-${(0x200 + group).toString(16).padStart(4, "0")}${n.toString(16).padStart(8, "0")}`;
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const review = (ar: string) => `[للمراجعة] ${ar}`;

// ── Accounts ────────────────────────────────────────────────────────────────

interface DemoUser {
  key: string;
  name: string;
  email: string;
  locale?: "en" | "ar";
  admin?: Prisma.AdminRoleCreateManyInput["role"][];
}

/** auth_subject starts with "seed-" so local development sign-in can list these accounts. */
const DEMO_USERS: DemoUser[] = [
  { key: "customer", name: "Demo Customer", email: "customer.demo@example.test" },
  {
    key: "customer-ar",
    name: "Demo Customer (Arabic)",
    email: "customer-ar.demo@example.test",
    locale: "ar",
  },
  { key: "owner", name: "Demo Owner", email: "owner.demo@example.test" },
  { key: "manager", name: "Demo Branch Manager", email: "manager.demo@example.test" },
  { key: "barista", name: "Demo Barista", email: "barista.demo@example.test", locale: "ar" },
  { key: "owner-2", name: "Demo Owner Saltpan", email: "owner2.demo@example.test" },
  { key: "owner-3", name: "Demo Owner Mangrove", email: "owner3.demo@example.test" },
  { key: "owner-4", name: "Demo Owner Falcon", email: "owner4.demo@example.test" },
  { key: "owner-5", name: "Demo Owner Pearl", email: "owner5.demo@example.test" },
  { key: "applicant", name: "Demo Applicant", email: "applicant.demo@example.test" },
  {
    key: "ops",
    name: "Demo Operations Admin",
    email: "ops.demo@example.test",
    admin: ["operations"],
  },
  {
    key: "finance",
    name: "Demo Finance Admin",
    email: "finance.demo@example.test",
    admin: ["finance_maker"],
  },
  {
    key: "finance-checker",
    name: "Demo Finance Checker",
    email: "finance-checker.demo@example.test",
    admin: ["finance_checker"],
  },
  {
    key: "support",
    name: "Demo Support Admin",
    email: "support.demo@example.test",
    admin: ["support"],
  },
  {
    key: "marketing",
    name: "Demo Marketing Admin",
    email: "marketing.demo@example.test",
    admin: ["marketing"],
  },
  {
    key: "super",
    name: "Demo Super Admin",
    email: "super.demo@example.test",
    admin: ["super_admin", "security"],
  },
];
const userId = (key: string) => id(1, DEMO_USERS.findIndex((u) => u.key === key) + 1);

async function upsertUsers() {
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { id: userId(u.key) },
      create: {
        id: userId(u.key),
        authSubject: `seed-demo-${u.key}`,
        displayName: u.name,
        email: u.email,
        locale: u.locale ?? "en",
      },
      update: {},
    });
    for (const role of u.admin ?? []) {
      await prisma.adminRole.upsert({
        where: { userId_role: { userId: userId(u.key), role } },
        create: { userId: userId(u.key), role },
        update: {},
      });
    }
  }
}

// ── Cafés ───────────────────────────────────────────────────────────────────

type Hours = { weekday: number; opens: string; closes: string }[];
const everyDay = (opens: string, closes: string): Hours =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens, closes }));
/** Friday (weekday 5) closes for midday prayers; other days run straight through. */
const fridayBreak = (opens: string, closes: string): Hours => [
  ...[1, 2, 3, 4, 6, 7].map((weekday) => ({ weekday, opens, closes })),
  { weekday: 5, opens, closes: "11:30" },
  { weekday: 5, opens: "13:30", closes },
];

interface Option {
  en: string;
  ar: string;
  fils: number;
}
interface Group {
  en: string;
  ar: string;
  min: number;
  max: number;
  options: Option[];
}
interface Product {
  en: string;
  ar: string;
  fils: number;
  category: number;
  groups?: number[];
  allergens?: string[];
  stock?: number;
}
interface Cafe {
  key: string;
  brand: string;
  legal: string;
  licence: string;
  owner: string;
  description: string;
  branches: {
    en: string;
    ar: string;
    address: string;
    lat: number;
    lng: number;
    modes: string[];
    capacity: number;
    hours: Hours;
    tables?: string[];
  }[];
  categories: { en: string; ar: string }[];
  groups: Group[];
  products: Product[];
  stampCard?: Omit<Prisma.StampCardUncheckedCreateInput, "id" | "merchantId">;
  promotions?: Omit<
    Prisma.PromotionUncheckedCreateInput,
    "id" | "merchantId" | "startsAt" | "endsAt"
  >[];
}

const size: Group = {
  en: "Size",
  ar: "الحجم",
  min: 1,
  max: 1,
  options: [
    { en: "Small", ar: "صغير", fils: 0 },
    { en: "Medium", ar: "وسط", fils: 300 },
    { en: "Large", ar: "كبير", fils: 600 },
  ],
};
const milk: Group = {
  en: "Milk",
  ar: "الحليب",
  min: 1,
  max: 1,
  options: [
    { en: "Full fat", ar: "كامل الدسم", fils: 0 },
    { en: "Skimmed", ar: "قليل الدسم", fils: 0 },
    { en: "Oat", ar: "شوفان", fils: 300 },
    { en: "Almond", ar: "لوز", fils: 300 },
  ],
};

const CAFES: Cafe[] = [
  {
    key: "dune",
    brand: "Dune Lantern Coffee",
    legal: "Dune Lantern Coffee Trading LLC (fictional)",
    licence: "DEMO-LIC-1001",
    owner: "owner",
    description: "Specialty espresso bar with seating, curbside pickup and table ordering.",
    branches: [
      {
        en: "Dune Lantern Corniche",
        ar: "فانوس الكثبان - الكورنيش",
        address: "Demo street 10, Corniche, Abu Dhabi (fictional)",
        lat: 24.4781,
        lng: 54.3213,
        modes: ["in_store", "curbside", "dine_in"],
        capacity: 14,
        hours: fridayBreak("07:00", "22:00"),
        tables: ["T1", "T2", "T3"],
      },
      {
        en: "Dune Lantern Al Maryah",
        ar: "فانوس الكثبان - جزيرة الماريه",
        address: "Demo tower 2, Al Maryah Island, Abu Dhabi (fictional)",
        lat: 24.5005,
        lng: 54.3903,
        modes: ["in_store", "curbside"],
        capacity: 10,
        hours: everyDay("06:30", "20:00"),
      },
    ],
    categories: [
      { en: "Espresso", ar: "إسبريسو" },
      { en: "Pastries", ar: "معجنات" },
    ],
    groups: [
      size,
      milk,
      {
        en: "Extra shot",
        ar: "جرعة إضافية",
        min: 0,
        max: 2,
        options: [{ en: "Espresso shot", ar: "جرعة إسبريسو", fils: 400 }],
      },
    ],
    products: [
      {
        en: "Flat white",
        ar: "فلات وايت",
        fils: 1900,
        category: 0,
        groups: [0, 1, 2],
        allergens: ["milk"],
      },
      {
        en: "Cortado",
        ar: "كورتادو",
        fils: 1700,
        category: 0,
        groups: [1, 2],
        allergens: ["milk"],
      },
      { en: "Double espresso", ar: "إسبريسو مزدوج", fils: 1400, category: 0, groups: [2] },
      {
        en: "Spanish latte",
        ar: "لاتيه إسباني",
        fils: 2200,
        category: 0,
        groups: [0, 1, 2],
        allergens: ["milk"],
      },
      {
        en: "Butter croissant",
        ar: "كرواسون بالزبدة",
        fils: 1300,
        category: 1,
        allergens: ["gluten", "milk", "egg"],
        stock: 12,
      },
    ],
    stampCard: {
      nameEn: "Lantern card",
      nameAr: review("بطاقة الفانوس"),
      stampsRequired: 8,
      rewardEn: "Any espresso drink free",
      rewardAr: review("مشروب إسبريسو مجاني"),
      rewardMaxFils: 2200n,
    },
    promotions: [
      {
        code: "LANTERN15",
        nameEn: "15% off espresso drinks (demo)",
        nameAr: review("خصم 15٪"),
        kind: "percent",
        percentBasisPoints: 1500,
        maxDiscountFils: 1500n,
        perCustomerLimit: 50,
        status: "approved",
        reviewNote: "Demo data",
      },
      {
        code: "LANTERNNEW",
        nameEn: "AED 10 off a first order (waiting for marketing review)",
        kind: "amount",
        amountFils: 1000n,
        minSubtotalFils: 3000n,
        perCustomerLimit: 1,
        status: "pending_review",
      },
    ],
  },
  {
    key: "saltpan",
    brand: "Saltpan Roasters",
    legal: "Saltpan Roasters LLC (fictional)",
    licence: "DEMO-LIC-1002",
    owner: "owner-2",
    description: "Morning-only roastery: filter coffee by origin and beans to take home.",
    branches: [
      {
        en: "Saltpan Mussafah Roastery",
        ar: "سولت بان - مصفح",
        address: "Demo warehouse 7, Mussafah, Abu Dhabi (fictional)",
        lat: 24.3517,
        lng: 54.5017,
        modes: ["in_store"],
        capacity: 6,
        hours: [1, 2, 3, 4, 6, 7].map((weekday) => ({ weekday, opens: "06:00", closes: "14:00" })),
      },
    ],
    categories: [
      { en: "Filter coffee", ar: "قهوة مقطرة" },
      { en: "Beans", ar: "حبوب القهوة" },
    ],
    groups: [
      {
        en: "Origin",
        ar: "المنشأ",
        min: 1,
        max: 1,
        options: [
          { en: "Ethiopia washed", ar: "إثيوبيا مغسولة", fils: 0 },
          { en: "Colombia natural", ar: "كولومبيا طبيعية", fils: 200 },
          { en: "Yemen (limited)", ar: "يمني (كمية محدودة)", fils: 900 },
        ],
      },
      {
        en: "Grind",
        ar: "الطحن",
        min: 1,
        max: 1,
        options: [
          { en: "Whole bean", ar: "حبوب كاملة", fils: 0 },
          { en: "Filter grind", ar: "طحن للتقطير", fils: 0 },
          { en: "Espresso grind", ar: "طحن للإسبريسو", fils: 0 },
        ],
      },
    ],
    products: [
      { en: "V60 pour over", ar: "في 60", fils: 2600, category: 0, groups: [0] },
      { en: "Batch brew", ar: "قهوة مقطرة يومية", fils: 1500, category: 0 },
      { en: "Beans 250 g", ar: "حبوب 250 غ", fils: 7500, category: 1, groups: [0, 1], stock: 20 },
    ],
    stampCard: {
      nameEn: "Roastery card",
      nameAr: review("بطاقة المحمصة"),
      stampsRequired: 6,
      rewardEn: "A free pour over",
      rewardAr: review("قهوة مقطرة مجانية"),
      rewardMaxFils: 2600n,
      redeemMinSubtotalFils: 1500n,
    },
    promotions: [
      {
        code: "SALT5",
        nameEn: "AED 5 off orders over AED 30 (demo)",
        kind: "amount",
        amountFils: 500n,
        minSubtotalFils: 3000n,
        perCustomerLimit: 10,
        status: "approved",
        reviewNote: "Demo data",
      },
    ],
  },
  {
    key: "mangrove",
    brand: "Mangrove Brew Bar",
    legal: "Mangrove Brew Bar LLC (fictional)",
    licence: "DEMO-LIC-1003",
    owner: "owner-3",
    description: "Evening cold brew bar built around curbside pickup.",
    branches: [
      {
        en: "Mangrove Eastern Road",
        ar: "منغروف - الطريق الشرقي",
        address: "Demo plot 3, Eastern Mangroves, Abu Dhabi (fictional)",
        lat: 24.4561,
        lng: 54.4268,
        modes: ["curbside"],
        capacity: 8,
        hours: everyDay("15:00", "23:59"),
      },
      {
        en: "Mangrove Yas Drive-up",
        ar: "منغروف - ياس",
        address: "Demo lot 12, Yas Island, Abu Dhabi (fictional)",
        lat: 24.4886,
        lng: 54.6061,
        modes: ["in_store", "curbside"],
        capacity: 8,
        hours: everyDay("12:00", "23:00"),
      },
    ],
    categories: [{ en: "Cold drinks", ar: "مشروبات باردة" }],
    groups: [
      size,
      {
        en: "Sweetness",
        ar: "السكر",
        min: 1,
        max: 1,
        options: [
          { en: "No sugar", ar: "بدون سكر", fils: 0 },
          { en: "Light", ar: "خفيف", fils: 0 },
          { en: "Regular", ar: "عادي", fils: 0 },
        ],
      },
      {
        en: "Extras",
        ar: "إضافات",
        min: 0,
        max: 3,
        options: [
          { en: "Vanilla syrup", ar: "شراب الفانيليا", fils: 200 },
          { en: "Salted caramel", ar: "كراميل مملح", fils: 250 },
          { en: "Cold foam", ar: "رغوة باردة", fils: 350 },
        ],
      },
    ],
    products: [
      { en: "Cold brew", ar: "كولد برو", fils: 2000, category: 0, groups: [0, 1, 2] },
      {
        en: "Iced latte",
        ar: "لاتيه مثلج",
        fils: 2100,
        category: 0,
        groups: [0, 1, 2],
        allergens: ["milk"],
      },
      { en: "Sparkling espresso tonic", ar: "إسبريسو تونيك", fils: 2400, category: 0, groups: [1] },
    ],
    promotions: [
      {
        code: "MANGROVE10",
        nameEn: "10% off, up to AED 6 (demo)",
        kind: "percent",
        percentBasisPoints: 1000,
        maxDiscountFils: 600n,
        perCustomerLimit: 20,
        status: "approved",
        reviewNote: "Demo data",
      },
    ],
  },
  {
    key: "falcon",
    brand: "Falcon Courtyard Café",
    legal: "Falcon Courtyard Hospitality LLC (fictional)",
    licence: "DEMO-LIC-1004",
    owner: "owner-4",
    description: "All-day café with food and table ordering in a shaded courtyard.",
    branches: [
      {
        en: "Falcon Courtyard Al Bateen",
        ar: "فناء الصقر - البطين",
        address: "Demo villa 21, Al Bateen, Abu Dhabi (fictional)",
        lat: 24.4537,
        lng: 54.3335,
        modes: ["in_store", "dine_in"],
        capacity: 20,
        hours: fridayBreak("08:00", "23:00"),
        tables: ["A1", "A2", "A3", "B1", "B2", "B3"],
      },
    ],
    categories: [
      { en: "Coffee", ar: "قهوة" },
      { en: "Breakfast", ar: "فطور" },
    ],
    groups: [
      milk,
      {
        en: "Bread",
        ar: "الخبز",
        min: 1,
        max: 1,
        options: [
          { en: "Sourdough", ar: "خبز العجين المخمر", fils: 0 },
          { en: "Gluten-free", ar: "خالٍ من الغلوتين", fils: 400 },
        ],
      },
    ],
    products: [
      {
        en: "Cappuccino",
        ar: "كابتشينو",
        fils: 1800,
        category: 0,
        groups: [0],
        allergens: ["milk"],
      },
      { en: "Turkish coffee", ar: "قهوة تركية", fils: 1500, category: 0 },
      {
        en: "Shakshuka",
        ar: "شكشوكة",
        fils: 3900,
        category: 1,
        groups: [1],
        allergens: ["egg", "gluten"],
      },
      {
        en: "Halloumi toast",
        ar: "توست الحلوم",
        fils: 3400,
        category: 1,
        groups: [1],
        allergens: ["milk", "gluten"],
      },
    ],
    stampCard: {
      nameEn: "Courtyard card",
      nameAr: review("بطاقة الفناء"),
      stampsRequired: 10,
      stampsPerItem: 2,
      rewardEn: "A free coffee",
      rewardAr: review("قهوة مجانية"),
      rewardMaxFils: 1800n,
      redeemDailyLimit: 1,
    },
  },
  {
    key: "pearl",
    brand: "Pearl Tea & Coffee House",
    legal: "Pearl House Cafeteria LLC (fictional)",
    licence: "DEMO-LIC-1005",
    owner: "owner-5",
    description: "Early-to-late karak and Arabic coffee at neighbourhood prices.",
    branches: [
      {
        en: "Pearl House Khalifa City",
        ar: "بيت اللؤلؤ - مدينة خليفة",
        address: "Demo shop 4, Khalifa City, Abu Dhabi (fictional)",
        lat: 24.4207,
        lng: 54.5772,
        modes: ["in_store", "curbside"],
        capacity: 16,
        hours: everyDay("05:00", "23:00"),
      },
      {
        en: "Pearl House Al Reem",
        ar: "بيت اللؤلؤ - جزيرة الريم",
        address: "Demo podium 9, Al Reem Island, Abu Dhabi (fictional)",
        lat: 24.4985,
        lng: 54.4055,
        modes: ["in_store"],
        capacity: 12,
        hours: everyDay("06:00", "22:00"),
      },
    ],
    categories: [
      { en: "Tea", ar: "شاي" },
      { en: "Arabic coffee", ar: "قهوة عربية" },
    ],
    groups: [
      {
        en: "Spice",
        ar: "البهارات",
        min: 0,
        max: 2,
        options: [
          { en: "Cardamom", ar: "هيل", fils: 0 },
          { en: "Saffron", ar: "زعفران", fils: 200 },
        ],
      },
    ],
    products: [
      { en: "Karak chai", ar: "شاي كرك", fils: 500, category: 0, groups: [0], allergens: ["milk"] },
      {
        en: "Zaatar manousheh",
        ar: "مناقيش زعتر",
        fils: 900,
        category: 0,
        allergens: ["gluten", "sesame"],
      },
      { en: "Arabic coffee pot", ar: "دلة قهوة عربية", fils: 2500, category: 1, groups: [0] },
    ],
    stampCard: {
      nameEn: "Pearl card",
      nameAr: review("بطاقة اللؤلؤ"),
      stampsRequired: 5,
      rewardEn: "A free karak",
      rewardAr: review("كرك مجاني"),
      rewardMaxFils: 700n,
      redeemDailyLimit: 2,
    },
    promotions: [
      {
        code: "PEARL3",
        nameEn: "AED 3 off (demo)",
        kind: "amount",
        amountFils: 300n,
        minSubtotalFils: 1000n,
        perCustomerLimit: 5,
        status: "approved",
        reviewNote: "Demo data",
      },
    ],
  },
];

async function upsertCafe(cafe: Cafe, c: number) {
  const g = 10 + c * 10; // ID groups g .. g+9 belong to this café
  const merchantId = id(g, 1);
  await prisma.merchant.upsert({
    where: { id: merchantId },
    create: {
      id: merchantId,
      legalName: cafe.legal,
      brandName: cafe.brand,
      licenseNumber: cafe.licence,
      status: "approved",
      licenseAuthority: "Abu Dhabi economic department (fictional record)",
      licenseExpiresOn: new Date("2031-06-30"),
      emirate: "abu_dhabi",
      declaredBranchCount: cafe.branches.length,
      description: cafe.description,
      contact: {
        name: "Demo contact",
        email: `contact.${cafe.key}@example.test`,
        phone: "+971 50 000 0000",
      },
      representative: {
        name: "Demo representative",
        position: "Managing partner",
        email: `rep.${cafe.key}@example.test`,
        phone: "+971 50 000 0000",
      },
    },
    update: {},
  });
  await prisma.membership.upsert({
    where: { userId_merchantId: { userId: userId(cafe.owner), merchantId } },
    create: { id: id(g, 2), userId: userId(cafe.owner), merchantId, role: "owner" },
    update: {},
  });

  const branchIds = cafe.branches.map((_, b) => id(g + 1, b + 1));
  for (const [b, branch] of cafe.branches.entries()) {
    const { hours, tables, en, ar, ...fields } = branch;
    await prisma.branch.upsert({
      where: { id: branchIds[b]! },
      create: {
        ...fields,
        id: branchIds[b]!,
        nameEn: en,
        nameAr: review(ar),
        merchantId,
        city: "abu_dhabi",
        timezone: "Asia/Dubai",
        status: "active",
      },
      update: {},
    });
    if ((await prisma.branchHour.count({ where: { branchId: branchIds[b]! } })) === 0) {
      await prisma.branchHour.createMany({
        data: hours.map((h) => ({
          branchId: branchIds[b]!,
          weekday: h.weekday,
          opens: time(h.opens),
          closes: time(h.closes),
        })),
      });
    }
    for (const [t, label] of (tables ?? []).entries()) {
      await prisma.branchTable.upsert({
        where: { id: id(g + 2, b * 100 + t + 1) },
        create: { id: id(g + 2, b * 100 + t + 1), branchId: branchIds[b]!, label },
        update: {},
      });
    }
  }

  const categoryIds = cafe.categories.map((_, k) => id(g + 3, k + 1));
  for (const [k, category] of cafe.categories.entries()) {
    await prisma.category.upsert({
      where: { id: categoryIds[k]! },
      create: {
        id: categoryIds[k]!,
        merchantId,
        nameEn: category.en,
        nameAr: review(category.ar),
        sort: k,
      },
      update: {},
    });
  }
  const groupIds = cafe.groups.map((_, k) => id(g + 4, k + 1));
  for (const [k, group] of cafe.groups.entries()) {
    await prisma.modifierGroup.upsert({
      where: { id: groupIds[k]! },
      create: {
        id: groupIds[k]!,
        merchantId,
        name: { en: group.en, ar: review(group.ar) },
        minCount: group.min,
        maxCount: group.max,
        sort: k,
      },
      update: {},
    });
    for (const [o, option] of group.options.entries()) {
      const optionId = id(g + 5, k * 100 + o + 1);
      await prisma.modifierOption.upsert({
        where: { id: optionId },
        create: {
          id: optionId,
          groupId: groupIds[k]!,
          merchantId,
          name: { en: option.en, ar: review(option.ar) },
          deltaFils: BigInt(option.fils),
        },
        update: {},
      });
      for (const branchId of branchIds) {
        await prisma.branchOption.upsert({
          where: { branchId_optionId: { branchId, optionId } },
          create: { branchId, optionId, merchantId },
          update: {},
        });
      }
    }
  }
  const productIds = cafe.products.map((_, k) => id(g + 6, k + 1));
  for (const [k, product] of cafe.products.entries()) {
    await prisma.product.upsert({
      where: { id: productIds[k]! },
      create: {
        id: productIds[k]!,
        merchantId,
        categoryId: categoryIds[product.category]!,
        names: { en: product.en, ar: review(product.ar) },
        baseFils: BigInt(product.fils),
        allergens: product.allergens ?? [],
        status: "published",
      },
      update: {},
    });
    for (const [sort, groupIndex] of (product.groups ?? []).entries()) {
      await prisma.productGroup.upsert({
        where: { productId_groupId: { productId: productIds[k]!, groupId: groupIds[groupIndex]! } },
        create: { productId: productIds[k]!, groupId: groupIds[groupIndex]!, merchantId, sort },
        update: {},
      });
    }
    for (const branchId of branchIds) {
      await prisma.branchProduct.upsert({
        where: { branchId_productId: { branchId, productId: productIds[k]! } },
        create: {
          branchId,
          productId: productIds[k]!,
          merchantId,
          stockOnHand: product.stock ?? null,
        },
        update: {},
      });
    }
  }

  if (cafe.stampCard) {
    await prisma.stampCard.upsert({
      where: { merchantId },
      create: { ...cafe.stampCard, id: id(g + 7, 1), merchantId },
      update: {},
    });
  }
  const now = new Date();
  for (const [k, promo] of (cafe.promotions ?? []).entries()) {
    await prisma.promotion.upsert({
      where: { merchantId_code: { merchantId, code: promo.code } },
      create: {
        ...promo,
        id: id(g + 8, k + 1),
        merchantId,
        startsAt: now,
        endsAt: new Date(now.getTime() + 180 * 86_400_000),
      },
      update: {},
    });
  }
  return { merchantId, branchIds };
}

/** Café 1 gets the demo branch manager (both branches) and barista (first branch). */
async function upsertCafeStaff(merchantId: string, branchIds: string[]) {
  for (const [n, key, role, branches] of [
    [3, "manager", "manager", branchIds],
    [4, "barista", "barista", branchIds.slice(0, 1)],
  ] as const) {
    const membership = await prisma.membership.upsert({
      where: { userId_merchantId: { userId: userId(key), merchantId } },
      create: { id: id(10, n), userId: userId(key), merchantId, role },
      update: {},
    });
    for (const branchId of branches) {
      await prisma.membershipBranch.upsert({
        where: { membershipId_branchId: { membershipId: membership.id, branchId } },
        create: { membershipId: membership.id, branchId, merchantId },
        update: {},
      });
    }
  }
}

/** A submitted application with every field filled, waiting for a manual licence check. */
async function upsertPendingApplication() {
  const merchantId = id(90, 1);
  await prisma.merchant.upsert({
    where: { id: merchantId },
    create: {
      id: merchantId,
      legalName: "Oasis Bean Kiosk LLC (fictional)",
      brandName: "Oasis Bean Kiosk",
      licenseNumber: "DEMO-LIC-2001",
      status: "submitted",
      submittedAt: new Date(),
      licenseAuthority: "Abu Dhabi economic department (fictional record)",
      licenseExpiresOn: new Date("2029-12-31"),
      emirate: "abu_dhabi",
      declaredBranchCount: 1,
      description: "A single kiosk planning to open in a fictional mall.",
      contact: {
        name: "Demo Applicant",
        email: "applicant.demo@example.test",
        phone: "+971 50 000 0000",
      },
      representative: {
        name: "Demo Applicant",
        position: "Owner",
        email: "applicant.demo@example.test",
        phone: "+971 50 000 0000",
      },
    },
    update: {},
  });
  await prisma.membership.upsert({
    where: { userId_merchantId: { userId: userId("applicant"), merchantId } },
    create: { id: id(90, 2), userId: userId("applicant"), merchantId, role: "owner" },
    update: {},
  });
}

async function main() {
  await upsertUsers();
  const cafes = [];
  for (const [c, cafe] of CAFES.entries()) cafes.push(await upsertCafe(cafe, c));
  await upsertCafeStaff(cafes[0]!.merchantId, cafes[0]!.branchIds);
  await upsertPendingApplication();
  // Loyalty, promotions and dine-in must be switched on for the demo (sandbox features).
  const features = await prisma.platformSetting.findUnique({ where: { key: "features" } });
  if (!features) {
    await prisma.platformSetting.create({
      data: {
        key: "features",
        value: { stampCards: true, promotions: true, dineIn: true, sandboxGifts: true },
      },
    });
  }
  console.log("Demo catalog ready (fictional data only):", {
    cafes: CAFES.length,
    branches: CAFES.reduce((n, c) => n + c.branches.length, 0),
    products: CAFES.reduce((n, c) => n + c.products.length, 0),
    tables: CAFES.reduce(
      (n, c) => n + c.branches.reduce((t, b) => t + (b.tables?.length ?? 0), 0),
      0,
    ),
    accounts: DEMO_USERS.length,
  });
}

main()
  .catch((error: unknown) => {
    console.error("Demo data failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
