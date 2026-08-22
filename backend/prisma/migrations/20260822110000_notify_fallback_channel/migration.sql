-- A fallback channel: the one we retry on when a send FAILS.
--
-- Operator: "Also we can have them select a comms method as a fall back
-- channel." Three toggles say WHICH channels carry traffic; this says where a
-- message goes when the channel that should have carried it did not.
--
-- ⚠️ SEMANTICS, because this is the part that is easy to get backwards. This
-- is NOT a primary/secondary ordering. Every ENABLED channel still receives
-- every message it is eligible for — the fallback is tried ONLY after a send
-- on an enabled channel has FAILED, and it is tried even when the channel it
-- names is switched off in the toggles above. Reading it as "second choice"
-- would have us sending everything twice.
--
-- ⚠️ AND IT DOES NOT COUNT TOWARDS THE at-least-one-of-EMAIL-or-SMS FLOOR the
-- API enforces. A channel that only wakes up on a delivery failure is not a
-- channel anybody is reachable on in the normal case, so a member whose only
-- live channel is the fallback is a member we cannot reach. Same reasoning
-- that keeps WhatsApp outside the floor, different reason. Nor does setting
-- this field alone trip the floor: it never touches the email/SMS pair.
--
-- DEFAULT EMAIL, and existing rows are backfilled to it by that DEFAULT. Email
-- costs us nothing per message and is the likeliest of the three to arrive —
-- SMS bills per send and WhatsApp is still operator-gated and template-bound.
--
-- ⚠️ ORDERING: the type must exist before the column that is typed on it, so
-- CREATE TYPE comes first. Both statements are written to be re-runnable —
-- Postgres has no CREATE TYPE IF NOT EXISTS, hence the DO block swallowing
-- duplicate_object, which is the same shape every other enum in this tree uses.
--
-- Nothing consumes this yet. NotificationsService is untouched in this phase:
-- there is no WhatsApp provider to fall back to or from, and wiring a retry
-- path before the column exists everywhere would be the wrong order.

DO $$ BEGIN
  CREATE TYPE "NotifyFallbackChannel" AS ENUM (
    'NONE',
    'WHATSAPP',
    'SMS',
    'EMAIL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "notifyFallbackChannel" "NotifyFallbackChannel" NOT NULL DEFAULT 'EMAIL';
