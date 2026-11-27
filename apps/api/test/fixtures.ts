import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type MembershipRole } from "../src/generated/prisma/client.js";
import { testEnv } from "./env.js";

/** Direct database access for arranging and checking test state. */
export function testPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testEnv().DATABASE_URL }) });
}

export async function createUser(prisma: PrismaClient, authSubject = `test-${randomUUID()}`) {
  return prisma.user.create({ data: { authSubject } });
}

/** A merchant with two branches, unique per call so tests stay independent. */
export async function createTenant(prisma: PrismaClient, label: string) {
  const suffix = randomUUID().slice(0, 8);
  const merchant = await prisma.merchant.create({
    data: {
      legalName: `${label} LLC ${suffix}`,
      brandName: `${label} ${suffix}`,
      licenseNumber: `TEST-${label}-${suffix}`,
      status: "approved",
    },
  });
  const branch = (name: string) =>
    prisma.branch.create({
      data: {
        merchantId: merchant.id,
        nameEn: `${label} ${name}`,
        address: "Test",
        modes: ["in_store"],
        capacity: 5,
        status: "active",
      },
    });
  return { merchant, branch1: await branch("one"), branch2: await branch("two") };
}

export async function addMember(
  prisma: PrismaClient,
  input: { userId: string; merchantId: string; role: MembershipRole; branchIds?: string[] },
) {
  return prisma.membership.create({
    data: {
      userId: input.userId,
      merchantId: input.merchantId,
      role: input.role,
      branches: { create: (input.branchIds ?? []).map((branchId) => ({ branchId })) },
    },
  });
}
