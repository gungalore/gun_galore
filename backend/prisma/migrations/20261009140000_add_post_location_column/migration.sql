-- Post.location is referenced by schema.prisma and written by
-- FeedService.createPost, but NO migration ever created it: the 2026-09-23
-- migration (20260923130000_post_location_place_id) added only
-- "locationPlaceId". The column had been present on the live box from an
-- earlier hand run and was later lost, leaving the generated Prisma client
-- expecting a column the database does not have — P2022 (ColumnNotFound) on
-- every community post create.
--
-- Idempotent so any environment that already has it (e.g. local dev) is a no-op.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "location" TEXT;
