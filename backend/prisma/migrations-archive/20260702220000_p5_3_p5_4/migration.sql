-- P5.3 (stuck-funds admin alert) + P5.4 (tested-&-working attestation).
-- All additive columns + an idempotent flag seed. Nothing existing is dropped.

-- ── P5.3 — stuck-funds admin-alert idempotency stamp ─────────────────────────
-- Set once when the cron alerts the admin that a courier order was delivered
-- but the buyer never confirmed receipt while funds are still HELD.
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "adminAlertedForStuckFundsAt" TIMESTAMP(3);

-- ── P5.4 — tested-&-working seller attestation ───────────────────────────────
-- The seller's OWN claim (never a GG certification, CPA s41), stamped when the
-- seller ticks the optional checkbox at listing creation.
ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "testedWorkingAttestedAt" TIMESTAMP(3);

-- Per-category flag: which categories show the "tested & working" checkbox.
ALTER TABLE "Category"
  ADD COLUMN IF NOT EXISTS "showTestedWorkingAttestation" BOOLEAN NOT NULL DEFAULT false;

-- Turn the flag ON for powered-electronics / appliance leaves where "does it
-- power on / does the compressor work" is the exact secondhand buyer fear.
-- Idempotent: replay just re-sets true; unknown slugs update 0 rows.
UPDATE "Category" SET "showTestedWorkingAttestation" = true
WHERE "slug" IN (
  'overlanding--fridges-and-freezers',
  'overlanding--dual-battery-and-solar',
  'overlanding--vehicle-lighting',
  'camping-outdoor--lights',
  'camping-outdoor--navigation-and-gps',
  'fishing--fish-finders-and-electronics',
  'optics--drones',
  'optics--gps-and-comms',
  'optics--thermal-imaging',
  'optics--trail-cameras',
  'shooting-accessories--weapons-mounted-lights'
);
