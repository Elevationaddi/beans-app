-- CreateEnum
CREATE TYPE "CancellationRequestStatus" AS ENUM ('open', 'approved', 'declined');

-- AlterEnum
ALTER TYPE "RefundKind" ADD VALUE 'order_cancelled';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "accept_by" TIMESTAMPTZ(6),
ADD COLUMN     "arrival_ack_at" TIMESTAMPTZ(6),
ADD COLUMN     "arrival_ack_by" UUID,
ADD COLUMN     "arrived_at" TIMESTAMPTZ(6),
ADD COLUMN     "pickup_code_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pickup_code_locked_until" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "cancellation_requests" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "order_status" "OrderStatus" NOT NULL,
    "status" "CancellationRequestStatus" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolution_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cancellation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cancellation_requests_order_id_idx" ON "cancellation_requests"("order_id");

-- CreateIndex
CREATE INDEX "cancellation_requests_status_created_at_idx" ON "cancellation_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_accept_by_idx" ON "orders"("status", "accept_by");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_arrival_ack_by_fkey" FOREIGN KEY ("arrival_ack_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written guards (phase 8) ───────────────────────────────────────────
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_pickup_code_failures_check" CHECK ("pickup_code_failures" BETWEEN 0 AND 100),
  -- Staff acknowledge an arrival only after the customer checked in.
  ADD CONSTRAINT "orders_arrival_order_check" CHECK (
    "arrival_ack_at" IS NULL OR ("arrived_at" IS NOT NULL AND "arrival_ack_by" IS NOT NULL)
  );

ALTER TABLE "cancellation_requests"
  ADD CONSTRAINT "cancellation_requests_reason_check" CHECK (char_length("reason") BETWEEN 3 AND 500),
  ADD CONSTRAINT "cancellation_requests_resolution_check" CHECK (
    "status" = 'open' OR "resolution_reason" IS NOT NULL
  );
-- At most one open request per order, so repeated taps return the same request.
CREATE UNIQUE INDEX "cancellation_requests_one_open" ON "cancellation_requests"("order_id")
  WHERE "status" = 'open';

-- Order state machine (docs/08). The services check this first; the trigger makes any other
-- path (a script, a bug) fail too. Terminal orders never move, and arrival is curbside only.
CREATE FUNCTION guard_order_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."arrived_at" IS DISTINCT FROM OLD."arrived_at" AND (
       OLD."arrived_at" IS NOT NULL OR NEW."mode" <> 'curbside'
       OR NEW."status" NOT IN ('accepted', 'preparing', 'ready')) THEN
    RAISE EXCEPTION 'order %: arrival not allowed', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD."status" = 'pending_payment' AND NEW."status" IN ('received', 'payment_failed'))
    OR (OLD."status" = 'received' AND NEW."status" IN ('accepted', 'rejected', 'cancelled'))
    OR (OLD."status" = 'accepted' AND NEW."status" IN ('preparing', 'cancelled'))
    OR (OLD."status" = 'preparing' AND NEW."status" IN ('ready', 'cancelled'))
    OR (OLD."status" = 'ready' AND NEW."status" IN ('completed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'order %: % to % is not allowed', OLD."id", OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."version" <= OLD."version" THEN
    RAISE EXCEPTION 'order %: status change must bump the version', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "orders_state_machine"
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION guard_order_transition();
CREATE TRIGGER "orders_no_delete"
  BEFORE DELETE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
