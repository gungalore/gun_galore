-- Community feed: per-member graphic content visibility.
--
-- Defaults to TRUE: the operator wants graphic content shown by default.
-- A member can turn it off from Feed settings; when off, the graphic gate
-- blurs all graphic posts and the "Show image" button is hidden.
ALTER TABLE "User" ADD COLUMN "feedShowGraphic" BOOLEAN NOT NULL DEFAULT true;
