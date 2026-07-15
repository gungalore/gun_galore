-- Daily Deals (DD-2) — first-party money path.
--
-- Additive + safe: two nullable idempotency columns on Transaction for the
-- house-deal Zoho documents (a full-amount Sales Receipt at RELEASED + a
-- Credit Note on a post-release refund). Kept separate from the commission
-- invoice/credit-note ids because a Sales Receipt is a different Books
-- object type. No backfill; no existing rows change meaning.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "zohoDealReceiptId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "zohoDealCreditNoteId" TEXT;
