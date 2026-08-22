-- THE VAULT LEARNS THE DOCUMENTS THAT DO NOT EXPIRE.
--
-- Operator, 2026-08-22: "maybe combine the licence centre and the document
-- vault into one module where they can keep everything".
--
-- The two stores split on EXPIRY, which is not a distinction any member
-- recognises. A competency certificate lived in the Licence Centre, safe from
-- any clock and manageable by hand; an ID copy and photographs of the same
-- member's safe lived only as uploads against one application, on a two-year
-- deletion clock, with no way to add or remove one except from inside that
-- application. The most reusable documents a person owns were the ones they
-- could not manage. These eight values close that.
--
-- ⚠️ NAMED IDENTICALLY TO THEIR MotivationUploadKind COUNTERPARTS, so
-- CREDENTIAL_TO_UPLOAD is an identity map for all eight and nobody has to
-- remember a translation table.
--
-- ⚠️ THIS FILE ADDS THE VALUES AND NOTHING ELSE, ON PURPOSE. Postgres refuses
-- to USE a new enum value in the same transaction that added it, and Prisma
-- wraps each migration file in one transaction — so an ADD VALUE followed by
-- anything that references it dies with "unsafe use of new value of enum
-- type". The columns and the CHECK constraint are the next migration. This
-- has already cost this codebase two-file migrations more than once.
--
-- ADD VALUE is one-way: there is no ALTER TYPE ... DROP VALUE.
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'IDENTITY_DOCUMENT';
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'ADDRESS_CONFIRMATION';
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'EMPLOYMENT_CONFIRMATION';
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'SAFE_PHOTO_CLOSED';
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'SAFE_PHOTO_AJAR';
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'SAFE_PHOTO_BOLTS';
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'SAFE_INSTALLATION';
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'SHOOTING_ACTIVITY_LOG';
