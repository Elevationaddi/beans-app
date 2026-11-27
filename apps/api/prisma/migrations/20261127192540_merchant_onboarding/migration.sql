-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('merchant_document');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'quarantined', 'clean', 'rejected');

-- CreateEnum
CREATE TYPE "MerchantDocumentType" AS ENUM ('trade_license', 'owner_id', 'vat_certificate', 'other');

-- CreateEnum
CREATE TYPE "DocumentReviewStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "contact" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "merchant_id" UUID,
    "purpose" "UploadPurpose" NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "declared_size" INTEGER NOT NULL,
    "actual_size" INTEGER,
    "sha256" TEXT,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "scan_result" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_documents" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "type" "MerchantDocumentType" NOT NULL,
    "review_status" "DocumentReviewStatus" NOT NULL DEFAULT 'pending',
    "object_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "merchant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploads_object_key_key" ON "uploads"("object_key");

-- CreateIndex
CREATE INDEX "uploads_owner_id_created_at_idx" ON "uploads"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "uploads_status_updated_at_idx" ON "uploads"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_id_merchant_id_key" ON "uploads"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_documents_upload_id_key" ON "merchant_documents"("upload_id");

-- CreateIndex
CREATE INDEX "merchant_documents_merchant_id_idx" ON "merchant_documents"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_documents_upload_id_merchant_id_key" ON "merchant_documents"("upload_id", "merchant_id");

-- CreateIndex
CREATE INDEX "merchants_status_submitted_at_idx" ON "merchants"("status", "submitted_at");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_upload_id_merchant_id_fkey" FOREIGN KEY ("upload_id", "merchant_id") REFERENCES "uploads"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written constraints.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "uploads"
  ADD CONSTRAINT "uploads_size_check" CHECK ("declared_size" > 0 AND ("actual_size" IS NULL OR "actual_size" >= 0)),
  ADD CONSTRAINT "uploads_merchant_scope_check"
    CHECK ("purpose" <> 'merchant_document' OR "merchant_id" IS NOT NULL);

ALTER TABLE "merchants"
  ADD CONSTRAINT "merchants_contact_check" CHECK (jsonb_typeof("contact") = 'object');

-- B01 acceptance: an unapproved merchant cannot publish. Enforced in the database so no code
-- path (API, seed, admin tool) can activate a branch or publish a product for a merchant that
-- is not approved.
CREATE FUNCTION require_approved_merchant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  merchant_status "MerchantStatus";
BEGIN
  -- Compare as text: the two tables use different enum types.
  IF NEW."status"::text NOT IN ('active', 'published') THEN
    RETURN NEW;
  END IF;
  SELECT "status" INTO merchant_status FROM "merchants" WHERE "id" = NEW."merchant_id";
  IF merchant_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'merchant % is not approved: cannot publish % %', NEW."merchant_id", TG_TABLE_NAME, NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "branches_require_approved_merchant"
  BEFORE INSERT OR UPDATE OF "status", "merchant_id" ON "branches"
  FOR EACH ROW EXECUTE FUNCTION require_approved_merchant();
CREATE TRIGGER "products_require_approved_merchant"
  BEFORE INSERT OR UPDATE OF "status", "merchant_id" ON "products"
  FOR EACH ROW EXECUTE FUNCTION require_approved_merchant();
