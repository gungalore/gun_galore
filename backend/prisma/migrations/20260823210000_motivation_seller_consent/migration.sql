-- The previous owner's consent, for a private firearm transfer.
--
-- Mirrors MotivationWitness closely but deliberately does not reuse it: a
-- witness row carries slot 1|2 with a unique constraint per motivation, and a
-- consent is one-per-application. See the model comment in schema.prisma.
--
-- Nullable throughout after the invite columns, because a row exists from the
-- moment the applicant sends the link and is filled in progressively as the
-- seller verifies, signs and photographs their licence.
CREATE TABLE "MotivationSellerConsent" (
    "id" TEXT NOT NULL,
    "motivationId" TEXT NOT NULL,
    "invitedName" TEXT NOT NULL,
    "invitedPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "answersEncrypted" TEXT,
    "firearmSnapshotEncrypted" TEXT,
    "signatureKey" VARCHAR(120),
    "signatureMime" VARCHAR(40),
    "licenceFrontKey" VARCHAR(120),
    "licenceBackKey" VARCHAR(120),
    "licenceMime" VARCHAR(40),
    "signedPlace" VARCHAR(160),
    "signedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "submitIp" VARCHAR(64),
    "submitUserAgent" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivationSellerConsent_pkey" PRIMARY KEY ("id")
);

-- One firearm, one current owner, one consent. A second row would mean two
-- people had each consented to the same transfer, which is not a real state.
CREATE UNIQUE INDEX "MotivationSellerConsent_motivationId_key"
    ON "MotivationSellerConsent"("motivationId");

CREATE INDEX "MotivationSellerConsent_motivationId_idx"
    ON "MotivationSellerConsent"("motivationId");

-- Cascade: a deleted application takes its consent row with it. The signature
-- and licence photographs live in the encrypted upload tree and are removed by
-- the same retention sweep that clears a motivation's other files.
ALTER TABLE "MotivationSellerConsent"
    ADD CONSTRAINT "MotivationSellerConsent_motivationId_fkey"
    FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
