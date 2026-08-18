-- Firearm-licence Motivation Writer (Phase 1).
--
-- See LICENCE-SERVICES-AND-FEED.md. The applicant answers a structured form,
-- scans their existing licence and previous motivations, Boet fills the gaps
-- with targeted follow-ups, and we generate a formal motivation they sign and
-- hand to the DFO. Launches as a capped free beta; R199 once the paygate is
-- live.
--
-- WHY SO MANY ENCRYPTED COLUMNS. A motivation is one of the most sensitive
-- artefacts on this platform: SA ID number, home address, the security
-- circumstances behind a self-defence application, firearm serials. Those
-- columns hold AES-256-GCM ciphertext (common/blob-crypto.ts), not text. They
-- are deliberately NOT queryable — they are only ever read whole, by their
-- owner or by an admin through an audited reveal. Everything left in the clear
-- is metadata: status, timestamps, token costs, and FIELD KEYS (never values).
--
-- WHY applicationRef IS NOT NULL WITH A "" DEFAULT. It is the throttle key —
-- one motivation per licence type per application. Postgres treats NULLs as
-- DISTINCT, so a nullable column would let the unique index pass every single
-- time and the throttle would silently never fire. An empty string is a real
-- value, so the constraint bites on the first duplicate. Voiding a motivation
-- rewrites this to 'voided:<id>', which frees the slot without deleting the row.
--
-- WHY THERE IS NO CLOUDINARY URL ON MotivationUpload. Every other upload rail
-- in this codebase lands on a PUBLIC Cloudinary secure_url — obscurity, not
-- access control. These are photographs of ID books and firearm licences, so
-- the bytes live encrypted on our own server (SecureFileStorageService) and
-- "storageKey" is an opaque key into it, never a path and never a URL.
--
-- Safe against production: three brand-new enums and three brand-new tables.
-- The only change to an existing table is a foreign key pointing AT User; User
-- itself is untouched. Nothing existing reads or writes any of this, and the
-- feature ships behind motivation_writer_enabled which defaults to false.

-- ── Enums ────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "MotivationLicenceType" AS ENUM (
    'S13_SELF_DEFENCE',
    'S15_OCCASIONAL_HUNTER',
    'S16_DEDICATED_HUNTER',
    'S16_DEDICATED_SPORT',
    'S24_RENEWAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MotivationStatus" AS ENUM (
    'DRAFT',
    'INTERVIEW',
    'GENERATING',
    'QUALITY_REVIEW',
    'NEEDS_MORE_INFO',
    'COMPLETED',
    'FAILED',
    'ABANDONED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MotivationUploadKind" AS ENUM (
    'CURRENT_LICENCE',
    'PREVIOUS_MOTIVATION',
    'COMPETENCY_CERTIFICATE',
    'ASSOCIATION_CARD',
    'IDENTITY_DOCUMENT',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Motivation ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Motivation" (
  "id"                    TEXT NOT NULL,
  "referenceNumber"       TEXT NOT NULL,
  "userId"                TEXT NOT NULL,
  "licenceType"           "MotivationLicenceType" NOT NULL,
  "applicationRef"        TEXT NOT NULL DEFAULT '',
  "status"                "MotivationStatus" NOT NULL DEFAULT 'DRAFT',

  "answersEncrypted"      TEXT,
  "answersSchemaVersion"  VARCHAR(40),
  "documentTextEncrypted" TEXT,
  "documentVersion"       INTEGER NOT NULL DEFAULT 0,
  "templateVersion"       VARCHAR(40),
  "disclaimerVersion"     VARCHAR(40),

  "variantSeed"           INTEGER NOT NULL,
  "structurePlan"         JSONB,
  "structureFingerprint"  TEXT[],

  "qualityScore"          INTEGER,
  "qualityFindings"       JSONB,
  "thinFields"            TEXT[],
  "gateCycles"            INTEGER NOT NULL DEFAULT 0,

  "modelUsed"             TEXT,
  "promptTokens"          INTEGER,
  "completionTokens"      INTEGER,
  "costUsd"               DECIMAL(10,6),

  "betaSeatNo"            INTEGER,
  "billedCents"           INTEGER NOT NULL DEFAULT 0,
  "testimonialConsentAt"  TIMESTAMP(3),
  "declarationAcceptedAt" TIMESTAMP(3),

  "outcomeAskedAt"        TIMESTAMP(3),
  "outcomeReportedAt"     TIMESTAMP(3),
  "outcome"               TEXT,

  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  "submittedAt"           TIMESTAMP(3),
  "generatedAt"           TIMESTAMP(3),
  "qualityPassedAt"       TIMESTAMP(3),
  "completedAt"           TIMESTAMP(3),
  "failedAt"              TIMESTAMP(3),
  "failureReason"         TEXT,
  "retentionPurgeAt"      TIMESTAMP(3),

  CONSTRAINT "Motivation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Motivation_referenceNumber_key"
  ON "Motivation"("referenceNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Motivation_betaSeatNo_key"
  ON "Motivation"("betaSeatNo");
-- The throttle.
CREATE UNIQUE INDEX IF NOT EXISTS "Motivation_userId_licenceType_applicationRef_key"
  ON "Motivation"("userId", "licenceType", "applicationRef");
CREATE INDEX IF NOT EXISTS "Motivation_userId_createdAt_idx"
  ON "Motivation"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Motivation_status_createdAt_idx"
  ON "Motivation"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Motivation_retentionPurgeAt_idx"
  ON "Motivation"("retentionPurgeAt");

-- ── MotivationMessage ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MotivationMessage" (
  "id"               TEXT NOT NULL,
  "motivationId"     TEXT NOT NULL,
  "role"             TEXT NOT NULL,
  "contentEncrypted" TEXT NOT NULL,
  "fieldKey"         TEXT,
  "model"            TEXT,
  "promptTokens"     INTEGER,
  "completionTokens" INTEGER,
  "costUsd"          DECIMAL(10,6),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MotivationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MotivationMessage_motivationId_createdAt_idx"
  ON "MotivationMessage"("motivationId", "createdAt");

-- ── MotivationUpload ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MotivationUpload" (
  "id"                  TEXT NOT NULL,
  "motivationId"        TEXT NOT NULL,
  "kind"                "MotivationUploadKind" NOT NULL,
  "storageKey"          TEXT,
  "mimeType"            TEXT NOT NULL,
  "byteSize"            INTEGER NOT NULL,
  "sha256"              TEXT NOT NULL,
  "extractionEncrypted" TEXT,
  "extractionOk"        BOOLEAN NOT NULL DEFAULT false,
  "extractedFields"     TEXT[],
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purgedAt"            TIMESTAMP(3),

  CONSTRAINT "MotivationUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MotivationUpload_motivationId_idx"
  ON "MotivationUpload"("motivationId");
CREATE INDEX IF NOT EXISTS "MotivationUpload_sha256_idx"
  ON "MotivationUpload"("sha256");

-- ── Foreign keys ─────────────────────────────────────────────────────
-- ON DELETE CASCADE throughout: deleting a user or a motivation must take its
-- messages and upload rows with it. The stored FILES are removed separately by
-- the erasure/retention path — a cascade cannot reach the filesystem, which is
-- exactly why those paths exist.
DO $$ BEGIN
  ALTER TABLE "Motivation"
    ADD CONSTRAINT "Motivation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MotivationMessage"
    ADD CONSTRAINT "MotivationMessage_motivationId_fkey"
    FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MotivationUpload"
    ADD CONSTRAINT "MotivationUpload_motivationId_fkey"
    FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
