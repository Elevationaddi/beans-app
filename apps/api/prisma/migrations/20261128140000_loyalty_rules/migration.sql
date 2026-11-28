-- Cycle 3: configurable stamp-card rules per café (eligible and excluded products, stamps per
-- item, reward products, campaign dates, redemption restrictions) and one stamp reversal per
-- refund, so partial refunds take back their share. Additive; existing cards keep behaving as
-- before (all products, one stamp per item, reward on any item, no window, one a day).
-- Rollback: drop the new columns and index, recreate "stamp_events_order_id_kind_key" once no
-- order has more than one reversal.

-- DropIndex
DROP INDEX "stamp_events_order_id_kind_key";

-- AlterTable
ALTER TABLE "stamp_cards" ADD COLUMN     "eligible_product_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "ends_at" TIMESTAMPTZ(6),
ADD COLUMN     "excluded_product_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "redeem_daily_limit" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "redeem_min_subtotal_fils" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "reward_product_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "stamps_per_item" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "starts_at" TIMESTAMPTZ(6);

ALTER TABLE "stamp_cards"
  ADD CONSTRAINT "stamp_cards_stamps_per_item_range" CHECK ("stamps_per_item" BETWEEN 1 AND 10),
  ADD CONSTRAINT "stamp_cards_redeem_daily_limit_range" CHECK ("redeem_daily_limit" BETWEEN 1 AND 10),
  ADD CONSTRAINT "stamp_cards_redeem_min_subtotal_nonnegative" CHECK ("redeem_min_subtotal_fils" >= 0),
  ADD CONSTRAINT "stamp_cards_window_order" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at");

-- AlterTable
ALTER TABLE "stamp_events" ADD COLUMN     "ref" TEXT NOT NULL DEFAULT '';

-- Only reversals carry a reference (the refund ID; empty on reversals made before this change).
ALTER TABLE "stamp_events"
  ADD CONSTRAINT "stamp_events_ref_only_on_reverse" CHECK ("kind" = 'reverse' OR "ref" = '');

-- CreateIndex
CREATE UNIQUE INDEX "stamp_events_order_id_kind_ref_key" ON "stamp_events"("order_id", "kind", "ref");
