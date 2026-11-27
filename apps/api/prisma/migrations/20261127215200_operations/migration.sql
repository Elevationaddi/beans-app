-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('order_issue', 'payment', 'account', 'privacy', 'merchant_support', 'other');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'pending', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('customer', 'merchant');

-- CreateEnum
CREATE TYPE "PrivacyRequestKind" AS ENUM ('access', 'deletion', 'correction');

-- CreateEnum
CREATE TYPE "TicketAuthorRole" AS ENUM ('customer', 'merchant', 'support');

-- CreateEnum
CREATE TYPE "TicketVisibility" AS ENUM ('public', 'internal');

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "channel" "TicketChannel" NOT NULL,
    "requester_id" UUID NOT NULL,
    "merchant_id" UUID,
    "order_id" UUID,
    "category" "TicketCategory" NOT NULL,
    "privacy_kind" "PrivacyRequestKind",
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "priority" "TicketPriority" NOT NULL DEFAULT 'normal',
    "assignee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_role" "TicketAuthorRole" NOT NULL,
    "visibility" "TicketVisibility" NOT NULL DEFAULT 'public',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tickets_requester_id_created_at_idx" ON "tickets"("requester_id", "created_at");

-- CreateIndex
CREATE INDEX "tickets_merchant_id_created_at_idx" ON "tickets"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "tickets_status_priority_created_at_idx" ON "tickets"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written guards (phase 10) ──────────────────────────────────────────
ALTER TABLE "tickets"
  -- A merchant ticket always names its merchant; a privacy ticket always says what is asked.
  ADD CONSTRAINT "tickets_merchant_channel_check" CHECK ("channel" <> 'merchant' OR "merchant_id" IS NOT NULL),
  ADD CONSTRAINT "tickets_privacy_kind_check" CHECK (("category" = 'privacy') = ("privacy_kind" IS NOT NULL));
ALTER TABLE "ticket_messages"
  ADD CONSTRAINT "ticket_messages_body_check" CHECK (char_length("body") BETWEEN 1 AND 4000),
  -- Only support writes internal notes.
  ADD CONSTRAINT "ticket_messages_internal_check" CHECK ("visibility" = 'public' OR "author_role" = 'support');
-- Conversation history is append-only (docs/04 A06).
CREATE TRIGGER "ticket_messages_append_only"
  BEFORE UPDATE OR DELETE ON "ticket_messages"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "tickets_no_delete"
  BEFORE DELETE ON "tickets"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
