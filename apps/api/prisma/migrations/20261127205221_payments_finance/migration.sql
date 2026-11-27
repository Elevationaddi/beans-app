-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('received', 'processed', 'ignored', 'failed');

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('manual', 'late_capture');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('requested', 'approved', 'rejected', 'submitted', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending_approval', 'approved', 'rejected', 'submitted', 'paid', 'failed');

-- CreateEnum
CREATE TYPE "ReconciliationExceptionStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider_ref" TEXT,
    "payload_sha256" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "RefundKind" NOT NULL,
    "amount_fils" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'requested',
    "requested_by" UUID,
    "decided_by" UUID,
    "decision_reason" TEXT,
    "provider_key" TEXT NOT NULL,
    "provider_ref" TEXT,
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_transactions" (
    "id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'AED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "merchant_id" UUID,
    "debit_fils" BIGINT NOT NULL DEFAULT 0,
    "credit_fils" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "amount_fils" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'AED',
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending_approval',
    "maker_id" UUID NOT NULL,
    "checker_id" UUID,
    "decision_reason" TEXT,
    "provider_key" TEXT NOT NULL,
    "provider_ref" TEXT,
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_allocations" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "journal_line_id" UUID NOT NULL,
    "amount_fils" BIGINT NOT NULL,

    CONSTRAINT "payout_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "started_by" UUID,
    "matched" INTEGER NOT NULL,
    "mismatched" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_exceptions" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "local_id" UUID,
    "provider_ref" TEXT,
    "merchant_id" UUID,
    "expected" JSONB NOT NULL,
    "actual" JSONB NOT NULL,
    "status" "ReconciliationExceptionStatus" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolution_reason" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_webhook_events_status_received_at_idx" ON "payment_webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_key_key" ON "refunds"("provider_key");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_ref_key" ON "refunds"("provider_ref");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE INDEX "journal_transactions_created_at_idx" ON "journal_transactions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "journal_transactions_source_type_source_id_event_type_key" ON "journal_transactions"("source_type", "source_id", "event_type");

-- CreateIndex
CREATE INDEX "journal_lines_journal_id_idx" ON "journal_lines"("journal_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_code_merchant_id_created_at_idx" ON "journal_lines"("account_code", "merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_provider_key_key" ON "payouts"("provider_key");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_provider_ref_key" ON "payouts"("provider_ref");

-- CreateIndex
CREATE INDEX "payouts_merchant_id_status_idx" ON "payouts"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "payout_allocations_journal_line_id_idx" ON "payout_allocations"("journal_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_allocations_payout_id_journal_line_id_key" ON "payout_allocations"("payout_id", "journal_line_id");

-- CreateIndex
CREATE INDEX "reconciliation_runs_created_at_idx" ON "reconciliation_runs"("created_at");

-- CreateIndex
CREATE INDEX "reconciliation_exceptions_status_merchant_id_idx" ON "reconciliation_exceptions"("status", "merchant_id");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journal_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_maker_id_fkey" FOREIGN KEY ("maker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written constraints.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_attempts_check" CHECK ("attempts" >= 0);

-- ── Refunds ────────────────────────────────────────────────────────────────
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_check" CHECK ("amount_fils" > 0),
  ADD CONSTRAINT "refunds_currency_check" CHECK ("currency" = 'AED'),
  ADD CONSTRAINT "refunds_reason_check" CHECK (char_length("reason") BETWEEN 3 AND 500),
  -- A manual refund always has a maker; an approved one has a different checker.
  ADD CONSTRAINT "refunds_manual_maker_check" CHECK ("kind" <> 'manual' OR "requested_by" IS NOT NULL),
  ADD CONSTRAINT "refunds_dual_control_check" CHECK (
    "kind" <> 'manual' OR "status" = 'requested'
    OR ("decided_by" IS NOT NULL AND "decided_by" <> "requested_by")
  );

-- Pending, approved, submitted and succeeded refunds never exceed the captured amount.
-- Locks the payment row so concurrent requests are checked one at a time (Q13).
CREATE FUNCTION refunds_within_captured() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  captured bigint;
  committed bigint;
BEGIN
  IF NEW."status" NOT IN ('requested', 'approved', 'submitted', 'succeeded') THEN
    RETURN NEW;
  END IF;
  SELECT "amount_fils" INTO captured FROM "payments"
    WHERE "id" = NEW."payment_id" AND "status" = 'captured' FOR UPDATE;
  IF captured IS NULL THEN
    RAISE EXCEPTION 'payment % is not captured', NEW."payment_id" USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM("amount_fils"), 0) INTO committed FROM "refunds"
    WHERE "payment_id" = NEW."payment_id" AND "id" <> NEW."id"
      AND "status" IN ('requested', 'approved', 'submitted', 'succeeded');
  IF committed + NEW."amount_fils" > captured THEN
    RAISE EXCEPTION 'refund_limit: refunds would exceed the captured amount of payment %', NEW."payment_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "refunds_within_captured"
  BEFORE INSERT OR UPDATE OF "status", "amount_fils" ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION refunds_within_captured();

-- Amount, payment and kind never change; final statuses are final.
CREATE FUNCTION protect_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amount_fils" <> OLD."amount_fils" OR NEW."payment_id" <> OLD."payment_id"
     OR NEW."kind" <> OLD."kind" OR NEW."provider_key" <> OLD."provider_key"
     OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by" THEN
    RAISE EXCEPTION 'refund % identity cannot change', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('rejected', 'succeeded', 'failed') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'refund % is final (%)', OLD."id", OLD."status" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "refunds_protected"
  BEFORE UPDATE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION protect_refund();
CREATE TRIGGER "refunds_no_delete"
  BEFORE DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ── Journal ────────────────────────────────────────────────────────────────
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_currency_check" CHECK ("currency" = 'AED');
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_one_side_check" CHECK (
    ("debit_fils" > 0 AND "credit_fils" = 0) OR ("credit_fils" > 0 AND "debit_fils" = 0)
  ),
  ADD CONSTRAINT "journal_lines_account_check" CHECK ("account_code" IN (
    'provider_clearing', 'customer_order_liability', 'merchant_payable',
    'platform_commission_revenue', 'refund_liability', 'processor_fee_expense', 'payout_clearing'
  )),
  ADD CONSTRAINT "journal_lines_merchant_check" CHECK (
    "account_code" <> 'merchant_payable' OR "merchant_id" IS NOT NULL
  );

CREATE TRIGGER "journal_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "journal_transactions"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "journal_transactions_no_truncate"
  BEFORE TRUNCATE ON "journal_transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "journal_lines_append_only"
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "journal_lines_no_truncate"
  BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- Q23: every journal transaction has at least two lines and debits equal credits.
-- Checked at commit (deferred), after all lines of the posting are written.
CREATE FUNCTION journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  journal uuid;
  debits bigint;
  credits bigint;
  line_count int;
BEGIN
  IF TG_TABLE_NAME = 'journal_transactions' THEN
    journal := NEW."id";
  ELSE
    journal := NEW."journal_id";
  END IF;
  SELECT COALESCE(SUM("debit_fils"), 0), COALESCE(SUM("credit_fils"), 0), COUNT(*)
    INTO debits, credits, line_count
    FROM "journal_lines" WHERE "journal_id" = journal;
  IF line_count < 2 OR debits <> credits THEN
    RAISE EXCEPTION 'journal % is unbalanced (debits %, credits %, lines %)', journal, debits, credits, line_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "journal_transactions_balanced"
  AFTER INSERT ON "journal_transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_balanced();
CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_balanced();

-- ── Payouts ────────────────────────────────────────────────────────────────
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amount_check" CHECK ("amount_fils" > 0),
  ADD CONSTRAINT "payouts_currency_check" CHECK ("currency" = 'AED'),
  ADD CONSTRAINT "payouts_dual_control_check" CHECK (
    "status" = 'pending_approval' OR ("checker_id" IS NOT NULL AND "checker_id" <> "maker_id")
  );
CREATE FUNCTION protect_payout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amount_fils" <> OLD."amount_fils" OR NEW."merchant_id" <> OLD."merchant_id"
     OR NEW."maker_id" <> OLD."maker_id" OR NEW."provider_key" <> OLD."provider_key" THEN
    RAISE EXCEPTION 'payout % identity cannot change', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('rejected', 'paid', 'failed') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'payout % is final (%)', OLD."id", OLD."status" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payouts_protected"
  BEFORE UPDATE ON "payouts"
  FOR EACH ROW EXECUTE FUNCTION protect_payout();
CREATE TRIGGER "payouts_no_delete"
  BEFORE DELETE ON "payouts"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_amount_check" CHECK ("amount_fils" > 0);
CREATE TRIGGER "payout_allocations_append_only"
  BEFORE UPDATE OR DELETE ON "payout_allocations"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ── Reconciliation ─────────────────────────────────────────────────────────
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_period_check" CHECK ("period_start" < "period_end");
ALTER TABLE "reconciliation_exceptions"
  ADD CONSTRAINT "reconciliation_exceptions_resolution_check" CHECK (
    ("status" = 'open' AND "resolved_by" IS NULL)
    OR ("status" = 'resolved' AND "resolved_by" IS NOT NULL AND "resolution_reason" IS NOT NULL)
  );
