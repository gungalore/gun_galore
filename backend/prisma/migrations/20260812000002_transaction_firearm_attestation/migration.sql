-- M33 — persist the firearm 18+/SAPS-competency attestation on the Transaction.
--
-- The checkout gate has always been hard (transactions.service refuses a
-- firearm checkout without an explicit `true`), but the acceptance itself was
-- only written to the application log. A grep-able log line is not a record a
-- regulator can be shown, and it rotates away; the sale row has to carry its
-- own proof. This is the same boolean-gate → *At-evidence-column pattern
-- already used by privateArrangeAcceptedAt, collectionPapersAckAt and the five
-- experience attestation stamps.
--
-- Nullable and additive on purpose: existing rows predate the column and we do
-- NOT backfill. A NULL here means "not recorded", not "not attested" — for a
-- pre-migration firearm sale the evidence is still the log line plus the fact
-- that the gate could not have been passed without it. Backfilling a timestamp
-- we did not observe would manufacture evidence, which is worse than a gap.
--
-- Safe to run against production: ADD COLUMN of a nullable column with no
-- default takes no table rewrite on Postgres 11+.

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "firearmAttestationAcceptedAt" TIMESTAMP(3);
