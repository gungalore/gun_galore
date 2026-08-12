-- EXP-E1 — Hunting Packages / Experiences: checkout → HELD (money-IN).
-- Additive only (new nullable columns + one index). Every column is
-- nullable and needs no backfill, so this is safe to run against the live
-- Transaction table with zero downtime. Postgres 16.

-- Event booking details captured at experience checkout. eventDate = the
-- specific offered date the buyer booked (validated in-app to fall inside
-- the listing's eventStartDate..eventEndDate window); eventEndDate copies the
-- listing's window end for multi-day packages; partySize = guests on this
-- booking (validated 1..capacitySlots).
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "eventDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eventEndDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "partySize" INTEGER;

-- Buyer attestation evidence stamps — mirror the firearm 18+ boolean →
-- hard server check → *At evidence column pattern. All five HARD-required
-- true at experience checkout; each stamp is durable proof the buyer
-- affirmed (CPA disclosure + dispute defence).
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "experienceAttested18PlusAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "experienceLicenceOrSupervisionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "experienceIntermediaryAckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "experienceCancellationAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "experienceRisksAcceptedAt" TIMESTAMP(3);

-- Experience booking lifecycle columns (added inert in E1; driven by E2
-- accept/release, E3 cancellation, E4 SLA cron/dispute). Added now so the
-- whole set ships in one migration and later phases need no further
-- Transaction migration.
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "bookingConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bookingDeclinedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bookingDeclinedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "bookingConfirmDeadlineAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bookingConfirmNudgedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bookingConfirmEscalatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eventCompletedConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eventPreReminderSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eventCompletionNudgedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "adminAlertedForEventUnconfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cpaCancelTier" TEXT,
  ADD COLUMN IF NOT EXISTS "cpaAdminFeeCents" INTEGER;

-- Experience SLA sweep index: HELD ON_SITE_SERVICE rows scanned by event
-- date (nudge / reminder / escalate windows).
CREATE INDEX IF NOT EXISTS "Transaction_shippingMethod_paymentStatus_eventDate_idx"
  ON "Transaction" ("shippingMethod", "paymentStatus", "eventDate");
