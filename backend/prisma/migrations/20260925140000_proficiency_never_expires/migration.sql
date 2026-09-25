-- A PROFICIENCY DOES NOT RUN OUT, SO STOP LEAVING ITS DATE QUESTION OPEN.
--
-- Operator, 2026-08-28: "proficiencies never expires, only competencies". That
-- ruling has been in `defaultsToNeverExpires` since it was given, so a
-- statement of results already arrives from the Document Centre with the
-- Never-Expires box PRE-TICKED. What it never got was the provenance.
--
-- ⚠️ TICKED IS NOT THE SAME AS SETTLED, AND THIS IS THE SAFE-PHOTOGRAPH
-- FAILURE A SECOND TIME. `neverExpires` says what the answer is; `dateSource`
-- says somebody stands behind it, and both the auto-attach candidate query and
-- the Centre's own review rules read the SECOND one. So a statement of results
-- sat at neverExpires true, dateSource null, confirmedAt null, and read as
-- `dateSource === null` — a document nobody had answered for. On this database
-- on 2026-09-25 that was FOUR statements of results, and they were the whole of
-- what the Document Centre was asking the member about: it told them "we were
-- not sure what type these documents are" on rows filed with
-- `namedConfident: true`, which is a claim about the TYPE that was simply
-- false. The same four could never be attached to an application on their own.
--
-- ⚠️ 20260909160000_photographs_never_expire IS THE SAME UPDATE FOR THE SAME
-- REASON and is deliberately not merged into this one: that migration has
-- already been applied, and amending an applied migration is how a baseline
-- stops matching the database.
--
-- ⚠️ NEVER OVER A DATE SOMEBODY ALREADY SET. `Credential_never_expires_has_no_date`
-- refuses a standing tick beside an expiry, and more to the point a row with a
-- date is a row where somebody made a decision. `expiresOn IS NULL` is the
-- guard, and it is not only about the constraint.
--
-- ⚠️ AND NEVER OVER A SETTLED ROW. A member who confirmed the row, or an arming
-- that already ran, has answered the question — this is only for the rows where
-- nobody ever did. A proficient statement read on an application can carry an
-- `issuedOn`; that is not an expiry and is not touched here.
--
-- Idempotent: re-running matches nothing, because the first run settles them.
UPDATE "Credential"
SET
  "neverExpires"   = true,
  "dateSource"     = 'none',
  "dateSourceNote" = 'A proficiency does not run out, so we have marked this one as never expiring. Change it if you want a reminder about it.'
WHERE "kind" = 'PROFICIENCY'
  AND "expiresOn" IS NULL
  AND "dateSource" IS NULL
  AND "confirmedAt" IS NULL;
