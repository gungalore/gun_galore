-- Move every safe photograph onto the one kind.
--
-- ⚠️ SAFE_PHOTO IS MOVED TOO, AND THAT IS A REVERSAL WORTH READING.
-- 20260819120000_motivation_safe_photo_shots deliberately left SAFE_PHOTO rows
-- where they were, because "an existing SAFE_PHOTO row could be any of the
-- three shots, and relabelling it SAFE_PHOTO_CLOSED would assert something we
-- do not know on a pack a DFO will inspect". That objection dies with the
-- distinction: SAFE_PHOTOGRAPHS asserts only that the picture is of the safe,
-- which is exactly what SAFE_PHOTO already meant.
--
-- ⚠️ WHICH SHOT A ROW WAS IS NOT PRESERVED ANYWHERE, on purpose. The four kinds
-- were assigned either by a member's tap or by a classifier that was forced to
-- admit it could not tell them apart, so the column is not evidence of anything
-- a DFO could rely on. Keeping it would preserve a guess and invite a query to
-- trust it. The photographs themselves still show what they show.

UPDATE "MotivationUpload"
   SET "kind" = 'SAFE_PHOTOGRAPHS'
 WHERE "kind" IN (
         'SAFE_PHOTO_CLOSED',
         'SAFE_PHOTO_AJAR',
         'SAFE_PHOTO_BOLTS',
         'SAFE_INSTALLATION',
         'SAFE_PHOTO'
       );

UPDATE "Credential"
   SET "kind" = 'SAFE_PHOTOGRAPHS'
 WHERE "kind" IN (
         'SAFE_PHOTO_CLOSED',
         'SAFE_PHOTO_AJAR',
         'SAFE_PHOTO_BOLTS',
         'SAFE_INSTALLATION'
       );

-- ⚠️ SCRUB coversKinds IN THE SAME PASS, on both tables. A row that was
-- kind=SAFE_PHOTO_CLOSED covering SAFE_PHOTO_BOLTS has just become
-- kind=SAFE_PHOTOGRAPHS covering a retired value that is now the same thing —
-- so it would be covering ITSELF, which cleanAlsoCovers forbids precisely
-- because it double-matches a single checklist row. Same reasoning, same fix,
-- as 20260820170100_credential_discipline_backfill.
UPDATE "MotivationUpload"
   SET "coversKinds" = ARRAY(
         SELECT DISTINCT k FROM unnest("coversKinds") AS k
          WHERE k NOT IN (
                  'SAFE_PHOTO_CLOSED',
                  'SAFE_PHOTO_AJAR',
                  'SAFE_PHOTO_BOLTS',
                  'SAFE_INSTALLATION',
                  'SAFE_PHOTO'
                )
       )::"MotivationUploadKind"[]
 WHERE "coversKinds" && ARRAY[
         'SAFE_PHOTO_CLOSED',
         'SAFE_PHOTO_AJAR',
         'SAFE_PHOTO_BOLTS',
         'SAFE_INSTALLATION',
         'SAFE_PHOTO'
       ]::"MotivationUploadKind"[];

UPDATE "Credential"
   SET "coversKinds" = ARRAY(
         SELECT DISTINCT k FROM unnest("coversKinds") AS k
          WHERE k NOT IN (
                  'SAFE_PHOTO_CLOSED',
                  'SAFE_PHOTO_AJAR',
                  'SAFE_PHOTO_BOLTS',
                  'SAFE_INSTALLATION'
                )
       )::"CredentialKind"[]
 WHERE "coversKinds" && ARRAY[
         'SAFE_PHOTO_CLOSED',
         'SAFE_PHOTO_AJAR',
         'SAFE_PHOTO_BOLTS',
         'SAFE_INSTALLATION'
       ]::"CredentialKind"[];
