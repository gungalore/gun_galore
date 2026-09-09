-- A PHOTOGRAPH HAS NO EXPIRY DATE, SO STOP LEAVING THE QUESTION OPEN.
--
-- Operator, 2026-09-09: "the safe pictures should automatically be set that
-- the date never expires."
--
-- ⚠️ TICKED IS NOT THE SAME AS SETTLED, AND THE GAP IS WHY SAFE PHOTOGRAPHS
-- NEVER REACHED AN APPLICATION. `neverExpires` says what the answer is;
-- `dateSource` says somebody stands behind it, and the auto-attach candidate
-- query reads the SECOND one — "a date somebody stands behind, whether that
-- somebody is the member or our own arming". A photograph of a safe had
-- neither, so it was never a candidate.
--
-- On this database at the time of writing: four safe photographs, all adopted
-- from an application, THREE of them with neverExpires false, dateSource null
-- and confirmedAt null. The adoption path never applied the default; only the
-- Document Centre's own upload path did, and even that one stopped at the tick.
--
-- ⚠️ NEVER OVER A DATE SOMEBODY ALREADY SET. `Credential_never_expires_has_no_date`
-- refuses a standing tick beside an expiry, and more to the point a row with a
-- date is a row where somebody made a decision. `expiresOn IS NULL` is the
-- guard, and it is not only about the constraint.
--
-- ⚠️ AND NEVER OVER A SETTLED ROW. A member who confirmed the row, or an
-- arming that already ran, has answered the question — this is only for the
-- rows where nobody ever did.
--
-- Idempotent: re-running matches nothing, because the first run settles them.
UPDATE "Credential"
SET
  "neverExpires"   = true,
  "dateSource"     = 'none',
  "dateSourceNote" = 'A photograph has no expiry date on it, so we have marked this one as never expiring. Change it if you want a reminder about it.'
WHERE "kind" IN (
    'SAFE_PHOTOGRAPHS',
    -- The retired four. Nothing new is filed under them, but a row that
    -- slipped through the 2026-08-23 consolidation is still a photograph.
    'SAFE_PHOTO_CLOSED',
    'SAFE_PHOTO_AJAR',
    'SAFE_PHOTO_BOLTS',
    'SAFE_INSTALLATION'
  )
  AND "expiresOn" IS NULL
  AND "dateSource" IS NULL
  AND "confirmedAt" IS NULL;
