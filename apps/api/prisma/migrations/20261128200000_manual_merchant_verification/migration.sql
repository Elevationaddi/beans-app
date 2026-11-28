-- CreateEnum
CREATE TYPE "Emirate" AS ENUM ('abu_dhabi', 'dubai', 'sharjah', 'ajman', 'umm_al_quwain', 'ras_al_khaimah', 'fujairah');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "declared_branch_count" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "emirate" "Emirate",
ADD COLUMN     "license_authority" TEXT,
ADD COLUMN     "license_expires_on" DATE,
ADD COLUMN     "representative" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "merchant_verifications" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "verified_by" UUID NOT NULL,
    "verified_on" DATE NOT NULL,
    "license_number" TEXT NOT NULL,
    "license_authority" TEXT NOT NULL,
    "license_expires_on" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_notes" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_verifications_merchant_id_created_at_idx" ON "merchant_verifications"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "merchant_notes_merchant_id_created_at_idx" ON "merchant_notes"("merchant_id", "created_at");

-- AddForeignKey
ALTER TABLE "merchant_verifications" ADD CONSTRAINT "merchant_verifications_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_verifications" ADD CONSTRAINT "merchant_verifications_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_notes" ADD CONSTRAINT "merchant_notes_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_notes" ADD CONSTRAINT "merchant_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Manual verification rules (cycle 4)
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_declared_branch_count_check" CHECK ("declared_branch_count" IS NULL OR "declared_branch_count" BETWEEN 1 AND 500);
ALTER TABLE "merchant_verifications" ADD CONSTRAINT "merchant_verifications_expiry_check" CHECK ("license_expires_on" > "verified_on");
ALTER TABLE "merchant_notes" ADD CONSTRAINT "merchant_notes_body_check" CHECK (length("body") BETWEEN 1 AND 2000);
-- Admins may invite the owner of a merchant they created after a manual check; owners still
-- cannot invite other owners (enforced by the API's staff role list).
ALTER TABLE "staff_invitations" DROP CONSTRAINT "staff_invitations_role_check";
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_role_check" CHECK ("role" <> 'owner' OR cardinality("branch_ids") = 0);
