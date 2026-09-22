-- Background moderation + disputes. Hand-written because `prisma migrate dev`
-- sees the intentional raw-DDL FTS columns as drift and offers to reset.
-- Apply with `migrate deploy`.
--
-- `moderatedAt` distinguishes an IN-FLIGHT post (status PENDING_MODERATION,
-- moderatedAt null) from one HELD for a human (status PENDING_MODERATION,
-- moderatedAt set) — no enum change needed.
ALTER TABLE "Post" ADD COLUMN "moderatedAt" TIMESTAMP(3);
ALTER TABLE "Post" ADD COLUMN "disputedAt" TIMESTAMP(3);
ALTER TABLE "Post" ADD COLUMN "disputeNote" TEXT;
