-- MAKES THE CHAIN REPLAYABLE INTO AN EMPTY DATABASE. Nothing else.
--
-- ⚠️ THIS MIGRATION EXISTS ONLY BECAUSE OF A FOLDER-ORDERING MISTAKE.
--
-- `20260819160000_credential_hunter_kinds` runs
-- `ALTER TYPE "CredentialKind" ADD VALUE ...`, and the type is created by
-- `20260820090000_licence_centre` — which sorts AFTER it. In production that
-- never mattered: those two were applied historically in a working order and
-- the type has existed there since. Against a FRESH database, `prisma migrate
-- deploy` applies strictly in folder order and dies on migration 13 of 48:
--
--     Migration name: 20260819160000_credential_hunter_kinds
--     Database error code: 42704
--     ERROR: type "CredentialKind" does not exist
--
-- Which meant nobody could build a working local database from this repo.
--
-- ⚠️ WHY A NEW FILE AND NOT A FIX TO EITHER OF THOSE TWO. Both are already
-- applied in production. Editing an applied migration changes its recorded
-- checksum, and renaming one makes production see the new name as pending
-- while the old name becomes an orphan Prisma reports as "not found locally"
-- for ever — which is precisely the drift this repository already suffers
-- from. Adding a correctly-sorted, idempotent file changes nothing that has
-- run and leaves no orphan.
--
-- ⚠️ IT MUST BE A NO-OP WHERE THE TYPE ALREADY EXISTS, because production will
-- meet it as a pending migration and apply it. The DO block below is the same
-- guard `20260820090000_licence_centre` already uses for this very type, so
-- the two agree by construction: whichever runs first creates it, the other
-- silently does nothing.
--
-- ⚠️ THE VALUE LIST IS THE BASE SET ONLY — deliberately identical to the one
-- in licence_centre, and NOT the full set the enum has today. Every later
-- value is added by its own migration with `ADD VALUE IF NOT EXISTS`
-- (hunter_kinds, s16_endorsement_and_good_standing, dedicated_discipline,
-- person_kinds, safe_photographs_one_kind). Listing them here would duplicate
-- that history in two places and guarantee the two lists drift apart.
DO $$ BEGIN
  CREATE TYPE "CredentialKind" AS ENUM (
    'FIREARM_LICENCE',
    'COMPETENCY_CERTIFICATE',
    'DEDICATED_STATUS',
    'PROFICIENCY',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;
