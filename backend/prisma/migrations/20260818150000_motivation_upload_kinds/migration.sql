-- Expand MotivationUploadKind to cover the full evidence bundle.
--
-- The finished submission is a PACK, not a letter: every upload becomes a
-- lettered annexure and is cross-referenced from the body of the motivation.
-- The original six values only covered the documents needed to PREFILL the
-- form; they did not cover the documents that make the argument.
--
-- SAFE_PHOTO and SAFE_INSTALLATION are the operator's addition. A motivation
-- asserts where the firearm will be kept and how the safe is anchored; a
-- photograph is the only thing that shows it. Safe storage is one of the few
-- grounds a DFO may inspect in person, so evidence of it carries weight out of
-- proportion to the effort of taking two photographs.
--
-- Safe against production: ADD VALUE on an enum is metadata-only and cannot
-- invalidate an existing row. No value is renamed or removed — every existing
-- MotivationUpload keeps its kind. The table is also empty today (nothing
-- writes it yet), so there is nothing to migrate.
--
-- NOTE for Postgres < 12: ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction block. Prisma runs each migration in one, so IF a future
-- deployment targets an older server this file must be split. The live box is
-- well past 12, so this is a note rather than a problem.

ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'PROFICIENCY_CERTIFICATE';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'ADDRESS_CONFIRMATION';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'EMPLOYMENT_CONFIRMATION';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'SAFE_PHOTO';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'SAFE_INSTALLATION';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'CHARACTER_REFERENCE';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'INCIDENT_REPORT';
