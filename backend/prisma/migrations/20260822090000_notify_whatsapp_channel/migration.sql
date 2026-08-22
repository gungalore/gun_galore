-- A third notification channel: WhatsApp.
--
-- Nothing is sent over it yet. There is no provider, no client and no webhook
-- in this phase — the member-facing toggle ships DISABLED and labelled "coming
-- soon", because the plan while we build sender reputation with Meta is
-- shipping updates only, not a general opt-in channel.
--
-- ⚠️ The default is TRUE, and it is the global `whatsapp_enabled` Setting
-- (default false) that keeps the channel inert — not this column. The two are
-- easy to confuse, and getting it backwards is expensive: because the toggle
-- is greyed out, a member sitting on false has no way to switch themselves
-- back on, so defaulting to false would silently mute everyone on the day the
-- operator finally throws the switch. Existing rows are backfilled true by the
-- DEFAULT for the same reason.
--
-- Email and SMS are untouched. The "at least one channel must stay on" floor
-- the API enforces still counts only those two: a channel the member cannot
-- control is not a channel we may leave them alone with.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "notifyWhatsappEnabled" BOOLEAN NOT NULL DEFAULT true;
