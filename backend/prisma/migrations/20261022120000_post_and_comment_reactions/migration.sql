-- Community reactions: Like / Dislike on posts AND comments.
-- `kind` on the existing join tables makes the two mutually exclusive at the
-- database level: one row per (post, user) / (comment, user), either LIKE or
-- DISLIKE. Existing rows are all likes, so the default backfills correctly.
CREATE TYPE "ReactionKind" AS ENUM ('LIKE', 'DISLIKE');

ALTER TABLE "Post" ADD COLUMN "dislikeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Comment" ADD COLUMN "dislikeCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PostLike" ADD COLUMN "kind" "ReactionKind" NOT NULL DEFAULT 'LIKE';
ALTER TABLE "CommentLike" ADD COLUMN "kind" "ReactionKind" NOT NULL DEFAULT 'LIKE';
