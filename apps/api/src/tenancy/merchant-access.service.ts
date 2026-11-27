import { Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { MembershipRole, Prisma } from "../generated/prisma/client.js";

/** Merchants whose staff may still operate. Suspended or rejected tenants are locked out. */
const OPERATING_MERCHANT_STATUSES = ["draft", "submitted", "review", "approved"] as const;

export interface MemberAccess {
  membershipId: string;
  merchantId: string;
  role: MembershipRole;
  catalogDelegated: boolean;
}

export interface BranchAccess {
  branchId: string;
  merchantId: string;
  role: MembershipRole;
}

/**
 * Resolves what a user may touch inside merchant tenants, from active memberships in the
 * database on every call. Merchant and branch IDs from requests are only lookup keys:
 * anything outside the caller's scope is reported as not found.
 */
@Injectable()
export class MerchantAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Prisma filter selecting exactly the branches a user may operate. */
  branchScope(userId: string): Prisma.BranchWhereInput {
    const activeMembership = {
      userId,
      status: "active" as const,
      merchant: { status: { in: [...OPERATING_MERCHANT_STATUSES] } },
    };
    return {
      OR: [
        // Owners operate every branch of their merchant.
        { merchant: { memberships: { some: { ...activeMembership, role: "owner" } } } },
        // Other roles operate only assigned branches.
        { members: { some: { membership: activeMembership } } },
      ],
    };
  }

  /**
   * The merchant when the user is its active owner, whatever the merchant's status (owners
   * must see a rejected or suspended application). 404 otherwise.
   */
  async requireOwner(userId: string, merchantId: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { id: merchantId, memberships: { some: { userId, role: "owner", status: "active" } } },
    });
    if (!merchant) throw ApiError.notFound("Merchant not found");
    return merchant;
  }

  /** Access to one branch, or 404 when it does not exist or is out of scope. */
  async requireBranch(userId: string, branchId: string): Promise<BranchAccess> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, ...this.branchScope(userId) },
      select: {
        id: true,
        merchantId: true,
        merchant: {
          select: { memberships: { where: { userId, status: "active" }, select: { role: true } } },
        },
      },
    });
    const role = branch?.merchant.memberships[0]?.role;
    if (!branch || !role) throw ApiError.notFound("Branch not found");
    return { branchId: branch.id, merchantId: branch.merchantId, role };
  }

  /**
   * The caller's active membership in an operating merchant (not suspended or rejected).
   * 404 when the caller does not belong to it, so merchant IDs cannot be probed.
   */
  async requireMember(userId: string, merchantId: string): Promise<MemberAccess> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        merchantId,
        status: "active",
        merchant: { status: { in: [...OPERATING_MERCHANT_STATUSES] } },
      },
      select: { id: true, merchantId: true, role: true, catalogDelegated: true },
    });
    if (!membership) throw ApiError.notFound("Merchant not found");
    return { membershipId: membership.id, ...membership };
  }

  /** Read the menu: owners and managers (docs/10: baristas see only their queue). */
  async requireCatalogReader(userId: string, merchantId: string): Promise<MemberAccess> {
    const member = await this.requireMember(userId, merchantId);
    if (member.role !== "owner" && member.role !== "manager") throw ApiError.forbidden();
    return member;
  }

  /** Edit the menu: owners, and managers the owner delegated catalog work to. */
  async requireCatalogWriter(userId: string, merchantId: string): Promise<MemberAccess> {
    const member = await this.requireMember(userId, merchantId);
    const allowed =
      member.role === "owner" || (member.role === "manager" && member.catalogDelegated);
    if (!allowed)
      throw ApiError.forbidden("Only the owner or a delegated manager can edit the menu");
    return member;
  }

  /** Owner of an operating merchant: branches, staff. */
  async requireOperatingOwner(userId: string, merchantId: string): Promise<MemberAccess> {
    const member = await this.requireMember(userId, merchantId);
    if (member.role !== "owner") throw ApiError.forbidden("Only the merchant owner can do this");
    return member;
  }

  /** Run one branch day to day (hours, pause, availability): owner or an assigned manager. */
  async requireBranchManager(userId: string, branchId: string): Promise<BranchAccess> {
    const access = await this.requireBranch(userId, branchId);
    if (access.role !== "owner" && access.role !== "manager") {
      throw ApiError.forbidden("Only the owner or a branch manager can change this branch");
    }
    return access;
  }
}

/**
 * Re-labels a tenant 404 with the resource the caller asked for, so a "Merchant not found"
 * never reveals that a product or category ID exists in someone else's tenant.
 */
export async function within<T>(check: Promise<T>, resource: string): Promise<T> {
  try {
    return await check;
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND")
      throw ApiError.notFound(`${resource} not found`);
    throw error;
  }
}
