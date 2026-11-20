-- Zoho Books wiring for the motivation paygate.
--
-- The motivation is ALL Outdoor's OWN supply: it is invoiced as principal
-- revenue ("Motivation Revenue"), never as an agent collection into Client
-- Funds Payable. These columns hold the Books document ids and the sync state,
-- following the Transaction.zoho* precedent: FAILED is retried by the hourly
-- sweep, UNCERTAIN is never retried automatically because a Books write may
-- have landed and Books has no idempotency key.
--
-- Additive and nullable: every existing payment row reads as "not yet raised".

ALTER TABLE "MotivationPayment"
  ADD COLUMN "zohoInvoiceId" TEXT,
  ADD COLUMN "zohoPaymentId" TEXT,
  ADD COLUMN "zohoInvoiceEmailedAt" TIMESTAMP(3),
  ADD COLUMN "zohoSyncStatus" TEXT,
  ADD COLUMN "zohoSyncError" TEXT,
  ADD COLUMN "zohoSyncLastAttemptAt" TIMESTAMP(3);
