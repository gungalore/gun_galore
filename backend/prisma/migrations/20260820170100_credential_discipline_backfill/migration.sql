-- Move the four association kinds onto DEDICATED_DISCIPLINE.
--
-- Dedicated sport shooter, dedicated hunter, professional hunter registration
-- and the section 16 letter of good standing are one kind now, because the
-- paper is usually one document saying several things at once.

-- WHICH of the four a row was, in the clear. The extraction reads status_type
-- off the certificate, but that lives inside an AES-GCM blob which SQL cannot
-- read — so without this column the distinction would be lost by the UPDATE
-- below, and no query could ever group by discipline again.
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "disciplineType" TEXT;

UPDATE "Credential"
   SET "disciplineType" = COALESCE("disciplineType", "kind"::text)
 WHERE "kind" IN ('DEDICATED_STATUS','DEDICATED_HUNTER','PROFESSIONAL_HUNTER','GOOD_STANDING');

UPDATE "Credential"
   SET "kind" = 'DEDICATED_DISCIPLINE'
 WHERE "kind" IN ('DEDICATED_STATUS','DEDICATED_HUNTER','PROFESSIONAL_HUNTER','GOOD_STANDING');

-- ⚠️ SCRUB coversKinds IN THE SAME PASS. A row that was
-- kind=DEDICATED_STATUS covering GOOD_STANDING has just become
-- kind=DEDICATED_DISCIPLINE covering a retired value — and the two are now the
-- same thing, so it would be covering ITSELF. cleanAlsoCovers forbids that
-- precisely because it double-matches a single checklist row.
UPDATE "Credential"
   SET "coversKinds" = ARRAY(
         SELECT DISTINCT k FROM unnest("coversKinds") AS k
          WHERE k NOT IN ('DEDICATED_STATUS','DEDICATED_HUNTER','PROFESSIONAL_HUNTER','GOOD_STANDING')
       )::"CredentialKind"[]
 WHERE "coversKinds" && ARRAY['DEDICATED_STATUS','DEDICATED_HUNTER','PROFESSIONAL_HUNTER','GOOD_STANDING']::"CredentialKind"[];
