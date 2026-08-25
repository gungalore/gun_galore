-- How a document got its name, and how sure we were of it.
--
-- Both values were already computed on upload and thrown away with the
-- response. Persisting them is what lets the review screen keep telling the
-- documents that need a human from the ones that do not, across a refresh.

ALTER TABLE "Credential"
  ADD COLUMN "autoFiled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "namedConfident" BOOLEAN NOT NULL DEFAULT false;

-- BACKFILL: every UNCONFIRMED row keeps exactly the behaviour it has today.
--
-- The page currently rebuilds its check-these queue from the list and marks
-- every unconfirmed row as auto-filed and not confident, because it has
-- nothing better to go on. Writing that same answer here means no member's
-- existing backlog changes under them on the day this ships; only documents
-- uploaded from now on carry what actually happened.
--
-- Confirmed rows are left at the defaults. The member has already settled
-- those, so the name is theirs and there is nothing left to check.
UPDATE "Credential"
   SET "autoFiled" = true
 WHERE "confirmedAt" IS NULL;
