-- THE SELLER'S HALF: an email address, his section F answers, and one row per
-- document he sends.
--
-- Operator, 2026-08-28: "we need to get the sellers email address and cell
-- number. Email so we can send him an email with the link to open a form he
-- can fill out with an upload and Scan QR method to get any documents to us
-- along with a display of what he uploaded so he can delete it if he uploaded
-- the wrong document. So as soon as he uploads or captures it must send it to
-- us and display what he sent with a delete option next to each."

-- ── the invite now carries an address as well as a number ────────────
--
-- NULLABLE, and it stays nullable even though invite() requires it from here
-- on. Rows created before this migration have no email on file and there is
-- nothing honest to backfill them with; NULL means "never captured", which is
-- a different thing from invalid. A resend of one of those rows has to ask.
ALTER TABLE "MotivationSellerConsent" ADD COLUMN "invitedEmail" VARCHAR(200);

-- ── his section F answers ────────────────────────────────────────────
--
-- Addresses, contact details, where the firearm is kept, designation, place.
-- Encrypted for the same reason answersEncrypted beside it is: this is a named
-- person's home address and identity number, and he is not our user.
ALTER TABLE "MotivationSellerConsent" ADD COLUMN "sectionFEncrypted" TEXT;

-- ── one row per document he sends ────────────────────────────────────
--
-- ⚠️ ITS OWN TABLE RATHER THAN A FLAG ON "MotivationUpload". The applicant's
-- delete route is scoped by motivationId and an upload id; if the seller's
-- files lived in that table on the same motivation, that route could reach
-- them and the only thing stopping it would be a guard somebody has to
-- remember to write. Two tables make "the applicant can never delete the
-- seller's documents, and he can never delete theirs" true by construction.
--
-- ⚠️ NO UNIQUE INDEX ON sha256, UNLIKE "MotivationUpload". That constraint
-- works there because deletes are hard and free the slot. Deletes here are
-- SOFT, so the same index would permanently refuse a seller who removed a
-- blurred photograph and re-sent a better copy of the identical bytes.
CREATE TABLE "MotivationSellerConsentDocument" (
  "id"         TEXT NOT NULL,
  "consentId"  TEXT NOT NULL,
  -- 'UPLOAD' | 'SCAN'. There is no third value: no webcam, on any surface.
  "source"     VARCHAR(16) NOT NULL DEFAULT 'UPLOAD',
  -- 'LICENCE_FRONT' | 'LICENCE_BACK' | 'IDENTITY' | 'OTHER'
  "role"       VARCHAR(24) NOT NULL DEFAULT 'OTHER',
  -- Nulled on delete, in the same write that stamps "deletedAt".
  "storageKey" VARCHAR(120),
  "mimeType"   VARCHAR(80) NOT NULL,
  "byteSize"   INTEGER NOT NULL,
  "sha256"     VARCHAR(64) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- SOFT DELETE. The row outlives the bytes so there is still a record that a
  -- document was sent and withdrawn.
  "deletedAt"  TIMESTAMP(3),

  CONSTRAINT "MotivationSellerConsentDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MotivationSellerConsentDocument_consentId_idx"
  ON "MotivationSellerConsentDocument"("consentId");

ALTER TABLE "MotivationSellerConsentDocument"
  ADD CONSTRAINT "MotivationSellerConsentDocument_consentId_fkey"
  FOREIGN KEY ("consentId") REFERENCES "MotivationSellerConsent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
