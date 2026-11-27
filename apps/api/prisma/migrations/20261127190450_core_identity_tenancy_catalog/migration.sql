-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ar');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "AdminRoleName" AS ENUM ('super_admin', 'operations', 'finance_maker', 'finance_checker', 'support', 'marketing', 'analyst', 'security');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('draft', 'submitted', 'review', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('draft', 'active', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'manager', 'barista', 'analyst');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'active', 'revoked');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('in_progress', 'completed');

-- CreateEnum
CREATE TYPE "OutboxState" AS ENUM ('pending', 'dispatched', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "display_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "AdminRoleName" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "license_number" TEXT NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'draft',
    "provider_account_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "status" "BranchStatus" NOT NULL DEFAULT 'draft',
    "modes" TEXT[],
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_hours" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opens" TIME(0) NOT NULL,
    "closes" TIME(0) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branch_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_exceptions" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL,
    "intervals" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branch_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_branches" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,

    CONSTRAINT "membership_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "names" JSONB NOT NULL,
    "descriptions" JSONB NOT NULL DEFAULT '{}',
    "photo_key" TEXT,
    "base_fils" BIGINT NOT NULL,
    "allergens" TEXT[],
    "status" "ProductStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "min_count" INTEGER NOT NULL,
    "max_count" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_options" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "delta_fils" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_groups" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_products" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "price_override_fils" BIGINT,
    "stock_on_hand" INTEGER,
    "stock_reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branch_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_options" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "delta_override_fils" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branch_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "configuration" JSONB NOT NULL,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "actor_scope" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'in_progress',
    "response_code" INTEGER,
    "response" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "OutboxState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "before_redacted" JSONB,
    "after_redacted" JSONB,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_subject_key" ON "users"("auth_subject");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_user_id_role_key" ON "admin_roles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_license_number_key" ON "merchants"("license_number");

-- CreateIndex
CREATE INDEX "branches_merchant_id_status_idx" ON "branches"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_merchant_id_key" ON "branches"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "branch_hours_branch_id_weekday_idx" ON "branch_hours"("branch_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "branch_exceptions_branch_id_local_date_key" ON "branch_exceptions"("branch_id", "local_date");

-- CreateIndex
CREATE INDEX "memberships_merchant_id_idx" ON "memberships"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_merchant_id_key" ON "memberships"("user_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_id_merchant_id_key" ON "memberships"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "membership_branches_branch_id_idx" ON "membership_branches"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_branches_membership_id_branch_id_key" ON "membership_branches"("membership_id", "branch_id");

-- CreateIndex
CREATE INDEX "categories_merchant_id_sort_idx" ON "categories"("merchant_id", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "categories_id_merchant_id_key" ON "categories"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "products_merchant_id_category_id_status_idx" ON "products"("merchant_id", "category_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_merchant_id_key" ON "products"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "modifier_groups_merchant_id_idx" ON "modifier_groups"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_groups_id_merchant_id_key" ON "modifier_groups"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "modifier_options_group_id_idx" ON "modifier_options"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_options_id_merchant_id_key" ON "modifier_options"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_groups_product_id_group_id_key" ON "product_groups"("product_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_products_branch_id_product_id_key" ON "branch_products"("branch_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_options_branch_id_option_id_key" ON "branch_options"("branch_id", "option_id");

-- CreateIndex
CREATE UNIQUE INDEX "policies_type_version_key" ON "policies"("type", "version");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_actor_scope_route_key_key" ON "idempotency_keys"("actor_scope", "route", "key");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_dedupe_key_key" ON "outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_state_next_run_at_idx" ON "outbox"("state", "next_run_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_created_at_idx" ON "audit_events"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_exceptions" ADD CONSTRAINT "branch_exceptions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_membership_id_merchant_id_fkey" FOREIGN KEY ("membership_id", "merchant_id") REFERENCES "memberships"("id", "merchant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_branch_id_merchant_id_fkey" FOREIGN KEY ("branch_id", "merchant_id") REFERENCES "branches"("id", "merchant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_merchant_id_fkey" FOREIGN KEY ("category_id", "merchant_id") REFERENCES "categories"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_group_id_merchant_id_fkey" FOREIGN KEY ("group_id", "merchant_id") REFERENCES "modifier_groups"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_product_id_merchant_id_fkey" FOREIGN KEY ("product_id", "merchant_id") REFERENCES "products"("id", "merchant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_group_id_merchant_id_fkey" FOREIGN KEY ("group_id", "merchant_id") REFERENCES "modifier_groups"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_products" ADD CONSTRAINT "branch_products_branch_id_merchant_id_fkey" FOREIGN KEY ("branch_id", "merchant_id") REFERENCES "branches"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_products" ADD CONSTRAINT "branch_products_product_id_merchant_id_fkey" FOREIGN KEY ("product_id", "merchant_id") REFERENCES "products"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_options" ADD CONSTRAINT "branch_options_branch_id_merchant_id_fkey" FOREIGN KEY ("branch_id", "merchant_id") REFERENCES "branches"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_options" ADD CONSTRAINT "branch_options_option_id_merchant_id_fkey" FOREIGN KEY ("option_id", "merchant_id") REFERENCES "modifier_options"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written constraints that Prisma cannot express (docs/06-database-schema.md).
-- ════════════════════════════════════════════════════════════════════════════

-- Identity
CREATE INDEX "users_email_normalized_idx" ON "users" (lower("email")) WHERE "email" IS NOT NULL;
CREATE INDEX "users_phone_idx" ON "users" ("phone") WHERE "phone" IS NOT NULL;

-- Branches
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_capacity_check" CHECK ("capacity" >= 0),
  ADD CONSTRAINT "branches_modes_check"
    CHECK ("modes" <@ ARRAY['in_store', 'curbside', 'dine_in']::text[]),
  ADD CONSTRAINT "branches_lat_check" CHECK ("lat" IS NULL OR "lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "branches_lng_check" CHECK ("lng" IS NULL OR "lng" BETWEEN -180 AND 180);

-- Opening hours: ISO weekday; overnight hours are stored as two intervals, so opens < closes.
ALTER TABLE "branch_hours"
  ADD CONSTRAINT "branch_hours_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "branch_hours_interval_check" CHECK ("opens" < "closes");

-- No overlapping intervals for the same branch and weekday.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "branch_hours"
  ADD CONSTRAINT "branch_hours_no_overlap" EXCLUDE USING gist (
    "branch_id" WITH =,
    "weekday" WITH =,
    tsrange('2000-01-01'::date + "opens", '2000-01-01'::date + "closes") WITH &&
  );

ALTER TABLE "branch_exceptions"
  ADD CONSTRAINT "branch_exceptions_intervals_check" CHECK (jsonb_typeof("intervals") = 'array');

-- Catalog money and counts
ALTER TABLE "products"
  ADD CONSTRAINT "products_base_fils_check" CHECK ("base_fils" >= 0),
  ADD CONSTRAINT "products_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "products_names_check" CHECK (jsonb_typeof("names") = 'object' AND "names" ? 'en');

ALTER TABLE "modifier_groups"
  ADD CONSTRAINT "modifier_groups_count_check" CHECK ("min_count" >= 0 AND "min_count" <= "max_count");

-- MVP: options only add to the price.
ALTER TABLE "modifier_options"
  ADD CONSTRAINT "modifier_options_delta_check" CHECK ("delta_fils" >= 0);

ALTER TABLE "branch_products"
  ADD CONSTRAINT "branch_products_price_check"
    CHECK ("price_override_fils" IS NULL OR "price_override_fils" >= 0),
  ADD CONSTRAINT "branch_products_stock_check" CHECK (
    "stock_reserved" >= 0
    AND ("stock_on_hand" IS NULL OR ("stock_on_hand" >= 0 AND "stock_reserved" <= "stock_on_hand"))
  );

ALTER TABLE "branch_options"
  ADD CONSTRAINT "branch_options_delta_check"
    CHECK ("delta_override_fils" IS NULL OR "delta_override_fils" >= 0);

-- Platform
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_completed_check"
    CHECK ("status" <> 'completed' OR "response_code" IS NOT NULL);

-- Append-only tables: reject UPDATE and DELETE, whoever runs them.
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- Policies are immutable once effective: only the approval of a not-yet-effective version
-- may change, and nothing may be deleted after it takes effect.
CREATE FUNCTION protect_effective_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."effective_at" <= now() AND OLD."approved_by" IS NOT NULL THEN
    RAISE EXCEPTION 'policy %/% is effective and immutable', OLD."type", OLD."version"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "policies_immutable_once_effective"
  BEFORE UPDATE OR DELETE ON "policies"
  FOR EACH ROW EXECUTE FUNCTION protect_effective_policy();
