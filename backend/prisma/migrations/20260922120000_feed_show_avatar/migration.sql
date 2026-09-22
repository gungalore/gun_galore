-- Community feed: per-member profile-picture visibility.
--
-- Defaults to TRUE: the operator wants member pictures viewable in the feed.
-- A member can turn it off from Feed settings; when off, the API returns a
-- null avatarUrl for that member (the UI falls back to their initial).
ALTER TABLE "User" ADD COLUMN "feedShowAvatar" BOOLEAN NOT NULL DEFAULT true;
