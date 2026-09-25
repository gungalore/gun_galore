-- Retire the community "groups" feature (operator, 2026-09-25). Group /
-- GroupMember and Post.groupId were only ever used by the members-only
-- community feed; the feature is removed from the app entirely. Destructive
-- by design — group data is disposable. Guards make a re-run a no-op.
--
-- Hand-authored (migrate dev is unusable in this repo — raw-DDL FTS drift).

-- Per-user feed mute axis that stored muted Group ids.
ALTER TABLE "User" DROP COLUMN IF EXISTS "feedMutedTopicIds";

-- Composite index + FK on Post.groupId are dropped with the column.
ALTER TABLE "Post" DROP COLUMN IF EXISTS "groupId";

-- GroupMember references Group, so it goes first.
DROP TABLE IF EXISTS "GroupMember";
DROP TABLE IF EXISTS "Group";
