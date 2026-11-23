-- Hiking becomes a first-class community post type, the primary carrier of a
-- GPX route. Appended after GENERAL in the enum's declaration order; Postgres
-- enum order is irrelevant to the app (it never sorts on it).
--
-- IF NOT EXISTS keeps a replay against a database that somehow already has the
-- value from failing — the same guard style used for other enum additions.

ALTER TYPE "PostType" ADD VALUE IF NOT EXISTS 'HIKING';
