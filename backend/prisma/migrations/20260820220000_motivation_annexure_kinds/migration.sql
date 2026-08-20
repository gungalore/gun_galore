-- Annexure kinds a professional motivation pack carries and we did not.
--
-- Taken from the operator's own reference pack (2026-08-20), reconciled with
-- SAPS's published application guidance:
--   J. SHOOTING ACTIVITIES              -> SHOOTING_ACTIVITY_LOG
--   M. dealer receipt OR the current licence holder's permission letter
--                                       -> FIREARM_SOURCE_PROOF
--   N. copy of the current owner's licence
--                                       -> SELLER_LICENCE
--   O. letter of appointment as executor, where the firearm is inherited
--                                       -> EXECUTOR_APPOINTMENT
--
-- ⚠️ ADD VALUE ONLY, AND NOTHING IN THIS FILE USES THEM. Postgres forbids
-- USING an enum value in the same transaction that adds it, and ALTER TYPE ...
-- ADD VALUE cannot be rolled back. Adding alone is safe in one file; any
-- migration that also writes one of these values needs a second file.
--
-- IF NOT EXISTS so a re-run against a partially-migrated database is a no-op
-- rather than a failure that leaves the enum half-extended.
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'SHOOTING_ACTIVITY_LOG';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'FIREARM_SOURCE_PROOF';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'SELLER_LICENCE';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'EXECUTOR_APPOINTMENT';
