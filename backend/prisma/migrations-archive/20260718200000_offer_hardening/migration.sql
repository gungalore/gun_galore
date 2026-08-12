-- Take a Shot hardening (2026-07-18 audit): lowball auto-decline
-- threshold on listings + per-buyer offer attempt counter. Both
-- additive; no data loss.
ALTER TABLE "Listing" ADD COLUMN "autoDeclineThreshold" INTEGER;
ALTER TABLE "Offer" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 1;
