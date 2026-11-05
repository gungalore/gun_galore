-- Dual payment rails. Every transaction records which gateway captured the
-- buyer's money; refunds and seller payouts must use that same provider.
-- Existing rows were captured by Ozow, so the column default is correct for
-- the backfill.

CREATE TYPE "PaymentProvider" AS ENUM ('OZOW', 'PEACH');

ALTER TABLE "Transaction"
  ADD COLUMN "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'OZOW';

CREATE INDEX "Transaction_paymentProvider_paymentStatus_paidOutAt_idx"
  ON "Transaction"("paymentProvider", "paymentStatus", "paidOutAt");

CREATE TABLE "PeachPayoutAttempt" (
  "id"                  TEXT NOT NULL,
  "transactionId"       TEXT NOT NULL,
  "payoutId"            TEXT NOT NULL,
  "requestId"           TEXT,
  "amountCents"         INTEGER NOT NULL,
  "bankName"            TEXT NOT NULL,
  "branchCode"          TEXT NOT NULL,
  "accountHolder"       TEXT NOT NULL,
  "reference"           TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'REQUESTED',
  "resultCode"          TEXT,
  "errorMessage"        TEXT,
  "lastStatusCheckedAt" TIMESTAMP(3),
  "completedAt"         TIMESTAMP(3),
  "terminalAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PeachPayoutAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PeachPayoutAttempt_payoutId_key"
  ON "PeachPayoutAttempt"("payoutId");

CREATE INDEX "PeachPayoutAttempt_transactionId_createdAt_idx"
  ON "PeachPayoutAttempt"("transactionId", "createdAt");

CREATE INDEX "PeachPayoutAttempt_terminalAt_lastStatusCheckedAt_createdAt_idx"
  ON "PeachPayoutAttempt"("terminalAt", "lastStatusCheckedAt", "createdAt");

ALTER TABLE "PeachPayoutAttempt"
  ADD CONSTRAINT "PeachPayoutAttempt_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
