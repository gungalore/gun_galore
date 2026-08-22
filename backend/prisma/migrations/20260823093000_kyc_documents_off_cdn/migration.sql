-- IDENTITY DOCUMENTS COME OFF THE PUBLIC CDN.
--
-- Operator, 2026-08-22: "remove the ID from cloudinary and save it in the
-- document centre."
--
-- ⚠️ WHAT WAS WRONG. kycIdDocumentUrl and kycSelfieUrl are Cloudinary
-- secure_urls, uploaded with the service's defaults — no `type: 'private'`,
-- no access_mode. That makes them world-readable: anybody holding the link
-- could fetch a South African identity document, and the matching selfie,
-- with no login and no audit trail. They are also retained after verification
-- by operator decision, so the exposure is permanent rather than momentary.
--
-- The bytes move into the same AES-GCM store every other document a member
-- gives us already lives in, behind an authenticated route.
--
-- ⚠️ THE COLUMNS ARE ADDED HERE; THE FILES ARE MOVED BY A SCRIPT. SQL cannot
-- read a CDN or write an encrypted blob. Until a row has a storageKey the
-- readers fall back to its old URL, so this migration is safe to deploy on its
-- own and the move can run afterwards, in its own time, per user.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "kycIdStorageKey" TEXT;
-- What the stored bytes actually are, read from their magic bytes rather than
-- from a file extension. The download route serves whatever this says, and the
-- Claude verdict sends it as the media_type, so a wrong value is a document
-- that will not open and a scan that will not run.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "kycIdMimeType" VARCHAR(64);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "kycSelfieStorageKey" TEXT;
