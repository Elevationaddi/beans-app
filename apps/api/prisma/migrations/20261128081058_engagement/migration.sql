-- CreateEnum
CREATE TYPE "StampEventKind" AS ENUM ('earn', 'reverse', 'redeem', 'release');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('percent', 'amount');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('held', 'confirmed', 'released');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "GiftStatus" AS ENUM ('issued', 'claimed', 'reserved', 'redeemed', 'expired');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "benefit" JSONB;

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "benefit" JSONB;

-- CreateTable
CREATE TABLE "stamp_cards" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "stamps_required" INTEGER NOT NULL,
    "reward_en" TEXT NOT NULL,
    "reward_ar" TEXT,
    "reward_max_fils" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "terms_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stamp_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stamp_accounts" (
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stamp_accounts_pkey" PRIMARY KEY ("user_id","merchant_id")
);

-- CreateTable
CREATE TABLE "stamp_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "card_id" UUID,
    "order_id" UUID,
    "kind" "StampEventKind" NOT NULL,
    "stamps" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stamp_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "kind" "PromotionKind" NOT NULL,
    "percent_basis_points" INTEGER,
    "amount_fils" BIGINT,
    "min_subtotal_fils" BIGINT NOT NULL DEFAULT 0,
    "max_discount_fils" BIGINT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "max_redemptions" INTEGER,
    "per_customer_limit" INTEGER NOT NULL DEFAULT 1,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "status" "PromotionStatus" NOT NULL DEFAULT 'draft',
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'held',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_tables" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'active',
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branch_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gifts" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "purchaser_id" UUID NOT NULL,
    "recipient_id" UUID,
    "value_fils" BIGINT NOT NULL,
    "message" TEXT,
    "claim_token_hash" TEXT NOT NULL,
    "status" "GiftStatus" NOT NULL DEFAULT 'issued',
    "order_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "claimed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stamp_cards_merchant_id_key" ON "stamp_cards"("merchant_id");

-- CreateIndex
CREATE INDEX "stamp_events_user_id_merchant_id_created_at_idx" ON "stamp_events"("user_id", "merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stamp_events_order_id_kind_key" ON "stamp_events"("order_id", "kind");

-- CreateIndex
CREATE INDEX "promotions_status_created_at_idx" ON "promotions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_merchant_id_code_key" ON "promotions"("merchant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_order_id_key" ON "promotion_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "promotion_redemptions_promotion_id_user_id_idx" ON "promotion_redemptions"("promotion_id", "user_id");

-- CreateIndex
CREATE INDEX "branch_tables_branch_id_idx" ON "branch_tables"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "gifts_claim_token_hash_key" ON "gifts"("claim_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "gifts_order_id_key" ON "gifts"("order_id");

-- CreateIndex
CREATE INDEX "gifts_purchaser_id_created_at_idx" ON "gifts"("purchaser_id", "created_at");

-- CreateIndex
CREATE INDEX "gifts_recipient_id_created_at_idx" ON "gifts"("recipient_id", "created_at");

-- AddForeignKey
ALTER TABLE "stamp_cards" ADD CONSTRAINT "stamp_cards_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_accounts" ADD CONSTRAINT "stamp_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_accounts" ADD CONSTRAINT "stamp_accounts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_events" ADD CONSTRAINT "stamp_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_events" ADD CONSTRAINT "stamp_events_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "stamp_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_events" ADD CONSTRAINT "stamp_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_tables" ADD CONSTRAINT "branch_tables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_purchaser_id_fkey" FOREIGN KEY ("purchaser_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written constraints (phase 9) ─────────────────────────────────────

ALTER TABLE "stamp_cards"
  ADD CONSTRAINT "stamp_cards_stamps_required_check" CHECK ("stamps_required" BETWEEN 2 AND 20),
  ADD CONSTRAINT "stamp_cards_reward_max_check" CHECK ("reward_max_fils" > 0),
  ADD CONSTRAINT "stamp_cards_terms_version_check" CHECK ("terms_version" >= 1);

ALTER TABLE "stamp_events"
  ADD CONSTRAINT "stamp_events_sign_check" CHECK (
    ("kind" IN ('earn', 'release') AND "stamps" > 0) OR
    ("kind" IN ('reverse', 'redeem') AND "stamps" < 0)
  );

-- Stamp history is append-only, like the audit log and the journal.
CREATE TRIGGER "stamp_events_append_only"
  BEFORE UPDATE OR DELETE ON "stamp_events"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "stamp_events_no_truncate"
  BEFORE TRUNCATE ON "stamp_events"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_code_check" CHECK ("code" ~ '^[A-Z0-9]{3,20}$'),
  ADD CONSTRAINT "promotions_window_check" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "promotions_kind_check" CHECK (
    ("kind" = 'percent' AND "percent_basis_points" BETWEEN 100 AND 10000 AND "amount_fils" IS NULL) OR
    ("kind" = 'amount' AND "amount_fils" > 0 AND "percent_basis_points" IS NULL)
  ),
  ADD CONSTRAINT "promotions_amounts_check" CHECK (
    "min_subtotal_fils" >= 0 AND ("max_discount_fils" IS NULL OR "max_discount_fils" > 0)
  ),
  ADD CONSTRAINT "promotions_limits_check" CHECK (
    "per_customer_limit" >= 1 AND ("max_redemptions" IS NULL OR "max_redemptions" >= 1)
  ),
  -- Uses never exceed the cap, even under concurrent checkouts.
  ADD CONSTRAINT "promotions_redemptions_check" CHECK (
    "redemptions" >= 0 AND ("max_redemptions" IS NULL OR "redemptions" <= "max_redemptions")
  );


-- One active table per label in a branch; retired labels can be reused.
CREATE UNIQUE INDEX "branch_tables_active_label_key"
  ON "branch_tables" ("branch_id", lower("label")) WHERE "status" = 'active';
ALTER TABLE "branch_tables"
  ADD CONSTRAINT "branch_tables_label_check" CHECK (length("label") BETWEEN 1 AND 20),
  ADD CONSTRAINT "branch_tables_token_version_check" CHECK ("token_version" >= 1);

ALTER TABLE "gifts"
  ADD CONSTRAINT "gifts_value_check" CHECK ("value_fils" > 0),
  ADD CONSTRAINT "gifts_claim_check" CHECK (
    ("status" = 'issued' AND "recipient_id" IS NULL) OR
    ("status" = 'expired') OR
    ("status" IN ('claimed', 'reserved', 'redeemed') AND "recipient_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "gifts_order_check" CHECK ("status" <> 'redeemed' OR "order_id" IS NOT NULL),
  ADD CONSTRAINT "gifts_not_self_check" CHECK ("recipient_id" IS NULL OR "recipient_id" <> "purchaser_id");
