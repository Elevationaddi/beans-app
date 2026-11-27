-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "city" TEXT;

-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorites_user_id_created_at_idx" ON "favorites"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_merchant_id_key" ON "favorites"("user_id", "merchant_id");

-- CreateIndex
CREATE INDEX "branches_city_status_idx" ON "branches"("city", "status");

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written constraints (phase 5).
-- ════════════════════════════════════════════════════════════════════════════

-- The seven UAE emirates (D01: UAE only). Which ones are live is configuration, not schema.
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_city_check" CHECK (
    "city" IS NULL OR "city" IN ('abu_dhabi', 'dubai', 'sharjah', 'ajman', 'umm_al_quwain', 'ras_al_khaimah', 'fujairah')
  );

-- Public discovery search on branch and brand names.
CREATE INDEX "branches_public_idx" ON "branches" ("status") WHERE "status" IN ('active', 'paused');
