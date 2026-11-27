import { Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { MembershipRole, Prisma } from "../generated/prisma/client.js";

/** Merchants whose staff may still operate. Suspended or rejected tenants are locked out. */
const OPERATING_MERCHANT_STATUSES = ["draft", "submitted", "review", "approved"] as const;

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
}
