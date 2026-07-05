-- UX-7 — compare-at ("was") price. Additive, nullable, no backfill.
-- Display-only column: strikethrough + "% off" on cards + the PDP. It NEVER
-- enters fee/checkout math. Guarded in the listings service (BUY_NOW only,
-- must exceed price, capped at 4x price — CPA s41 anti-anchoring).
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "compareAtPriceZarCents" INTEGER;
