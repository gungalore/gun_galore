-- Character witness statements, completed by the witness on their own phone.
--
-- ⚠️ THE ONLY TABLE HERE WRITTEN BY SOMEBODY WHO IS NOT A MEMBER. Everything
-- else on a motivation is the applicant's own answer about themselves; this is
-- a third party putting their name, identity number and signature on a
-- document that goes to the police, from a link they opened on a phone.
--
-- The unique on (motivationId, slot) is load-bearing: deleting a witness has
-- to free its slot so the applicant can invite somebody else into it, and
-- without the constraint a race between two invites would fill the same slot
-- twice and print two statements from the same box.
CREATE TABLE "MotivationWitness" (
  "id"               TEXT NOT NULL,
  "motivationId"     TEXT NOT NULL,
  "slot"             INTEGER NOT NULL,
  "invitedName"      TEXT NOT NULL,
  "invitedPhone"     TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'INVITED',
  "otpHash"          TEXT,
  "otpExpiresAt"     TIMESTAMP(3),
  "otpAttempts"      INTEGER NOT NULL DEFAULT 0,
  "verifiedAt"       TIMESTAMP(3),
  "answersEncrypted" TEXT,
  "signatureKey"     VARCHAR(120),
  "signatureMime"    VARCHAR(40),
  "signedPlace"      VARCHAR(160),
  "signedAt"         TIMESTAMP(3),
  "openedAt"         TIMESTAMP(3),
  "submitIp"         VARCHAR(64),
  "submitUserAgent"  VARCHAR(300),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MotivationWitness_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MotivationWitness_motivationId_slot_key"
  ON "MotivationWitness"("motivationId", "slot");
CREATE INDEX "MotivationWitness_motivationId_idx"
  ON "MotivationWitness"("motivationId");

ALTER TABLE "MotivationWitness"
  ADD CONSTRAINT "MotivationWitness_motivationId_fkey"
  FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
