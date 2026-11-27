-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "catalog_delegated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "modifier_groups" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "slots" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "branch_ids" UUID[],
    "catalog_delegated" BOOLEAN NOT NULL DEFAULT false,
    "token_hash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invited_by" UUID NOT NULL,
    "accepted_by" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slots_branch_id_starts_at_key" ON "slots"("branch_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invitations_merchant_id_status_idx" ON "staff_invitations"("merchant_id", "status");

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written constraints that Prisma cannot express (phase 4).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "modifier_groups"
  ADD CONSTRAINT "modifier_groups_version_check" CHECK ("version" >= 1);

-- Pickup capacity: never oversell a slot, whatever code path writes to it.
ALTER TABLE "slots"
  ADD CONSTRAINT "slots_counts_check" CHECK (
    "capacity" >= 0 AND "reserved" >= 0 AND "confirmed" >= 0
    AND "reserved" + "confirmed" <= "capacity"
  );

-- Invitations: who invited and who accepted are real users; owners are never invited.
ALTER TABLE "staff_invitations"
  ADD CONSTRAINT "staff_invitations_invited_by_fkey"
    FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_invitations_accepted_by_fkey"
    FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_invitations_role_check" CHECK ("role" <> 'owner'),
  ADD CONSTRAINT "staff_invitations_delegation_check" CHECK (NOT "catalog_delegated" OR "role" = 'manager'),
  ADD CONSTRAINT "staff_invitations_accepted_check"
    CHECK (("status" = 'accepted') = ("accepted_by" IS NOT NULL)),
  ADD CONSTRAINT "staff_invitations_email_check" CHECK ("email" = lower("email") AND position('@' IN "email") > 1);

-- One open invitation per email per merchant.
CREATE UNIQUE INDEX "staff_invitations_pending_email_key"
  ON "staff_invitations" ("merchant_id", "email") WHERE "status" = 'pending';
