-- A dedicated certificate is also the section 16 letter of good standing while
-- its validity is unexpired (operator, 2026-09-14). The vault-attach path now
-- applies that when it files a credential, and addUpload applies it to a
-- document uploaded straight to an application — but rows that arrived before
-- that change carry no good-standing role, so the checklist keeps asking for a
-- letter the pack already holds.
--
-- Matched by CONTENT: a directly-uploaded association card carries no
-- sourceCredentialId, and its own reading is the motivation registry, which
-- never asks an ASSOCIATION_CARD for an expiry. The identical bytes in the
-- vault do carry that reading, so the row is found by sha256.
--
-- ONLY ON STILL-EDITABLE APPLICATIONS. coversKinds drives the checklist and the
-- annexure sheet; rewriting it under a pack that has already been generated
-- would change a document the member has signed.
UPDATE "MotivationUpload" mu
SET "coversKinds" = array_append(
  mu."coversKinds",
  'GOOD_STANDING_LETTER'::"MotivationUploadKind"
)
FROM "Motivation" m, "Credential" c
WHERE mu."motivationId" = m."id"
  AND m."status" IN ('DRAFT', 'INTERVIEW', 'NEEDS_MORE_INFO')
  AND mu."kind" = 'ASSOCIATION_CARD'
  AND mu."sha256" = c."sha256"
  AND c."userId" = m."userId"
  AND c."kind" = 'DEDICATED_DISCIPLINE'
  AND c."purgedAt" IS NULL
  AND c."expiresOn" IS NOT NULL
  AND c."expiresOn" > now()
  AND NOT ('GOOD_STANDING_LETTER'::"MotivationUploadKind" = ANY(mu."coversKinds"));
