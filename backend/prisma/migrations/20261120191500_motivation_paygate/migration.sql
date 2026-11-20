-- The motivation paygate (operator, 2026-11-20: "On the motivations. I want to
-- paygate it." — R295, charged at Write my motivation).
--
-- Additive only: one nullable column on Motivation and one new table. An
-- existing row reads paidAt = NULL, which means unpaid, which is exactly what
-- every row in production is today.
--
-- ⚠️ THE TABLE IS THE MONEY RECORD AND OUTLIVES THE DOCUMENT. Both foreign
-- keys are nullable with ON DELETE SET NULL, because the nightly retention
-- purge and a POPIA erasure DELETE the Motivation row (and the User row on an
-- erasure). A sale that vanished with the document would leave turnover tax
-- unfiled and no evidence a refund was owed; `motivationRef` snapshots the MO
-- number so the surviving row still says what was sold.
--
-- The status column is an enum rather than a string: unlike MotivationStatus
-- there is no "new state costs no migration" argument here, because the payment
-- lifecycle is fixed and every value has a money consequence.

CREATE TYPE "MotivationPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

ALTER TABLE "Motivation"
  ADD COLUMN "paidAt" TIMESTAMP(3);

CREATE TABLE "MotivationPayment" (
  "id" TEXT NOT NULL,
  "motivationId" TEXT,
  "userId" TEXT,
  "motivationRef" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'OZOW',
  "status" "MotivationPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "gatewayCheckoutId" TEXT,
  "redirectUrl" TEXT,
  "gatewayMerchantRef" TEXT,
  "gatewayPaymentId" TEXT,
  "paidAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MotivationPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MotivationPayment_gatewayMerchantRef_key"
  ON "MotivationPayment"("gatewayMerchantRef");
CREATE INDEX "MotivationPayment_motivationId_status_idx"
  ON "MotivationPayment"("motivationId", "status");
CREATE INDEX "MotivationPayment_status_createdAt_idx"
  ON "MotivationPayment"("status", "createdAt");
CREATE INDEX "MotivationPayment_userId_createdAt_idx"
  ON "MotivationPayment"("userId", "createdAt");

ALTER TABLE "MotivationPayment"
  ADD CONSTRAINT "MotivationPayment_motivationId_fkey"
  FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MotivationPayment"
  ADD CONSTRAINT "MotivationPayment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
