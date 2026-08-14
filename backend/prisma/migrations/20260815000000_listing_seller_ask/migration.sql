-- M37 — the seller's take-home price on a BUY_NOW listing.
--
-- Operator decision 2026-08-15: our cut is now built INTO the listed price
-- rather than deducted from the seller. The seller names what they want to
-- receive, we mark it up by commission + the Peach fee, and Listing.price
-- becomes that marked-up figure — the number the buyer sees and pays.
--
-- Listing.price keeps its meaning ("the buyer-facing price"), so every card,
-- search result, PDP and checkout path reads it unchanged. This column carries
-- the other half: what the seller gets.
--
-- Stored rather than derived because the markup is not reliably invertible —
-- the commission is banded, floored at a R30 minimum and may carry a Top Seller
-- discount. Recomputing forward from the ask always reproduces the figure the
-- seller was shown, which is the one that matters in a dispute.
--
-- Nullable with no backfill: auctions, swaps and take-a-shot listings have no
-- ask, and any listing predating the markup model was priced under the old
-- deduct-from-seller rules. A NULL here means "not a marked-up listing" and
-- readers must fall back to the old behaviour rather than assume a value.
--
-- Safe against production: ADD COLUMN of a nullable column with no default is
-- metadata-only on Postgres 11+.

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "sellerAskCents" INTEGER;
