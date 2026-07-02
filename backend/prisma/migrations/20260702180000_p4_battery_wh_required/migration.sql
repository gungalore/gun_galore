-- P4.3b fix — make the battery_wh attribute REQUIRED.
--
-- The dangerous-goods gate (a loose lithium battery over 100 Wh is forced
-- collection-only, never couriered) only fires when battery_wh is supplied.
-- With battery_wh optional, a seller could list a >100 Wh battery leaving the
-- Wh blank and it would route through the Pudo/TCG courier path — the exact
-- carrier dangerous-goods hole the gate exists to close (adversarial review,
-- HIGH). Requiring the value means the item can't be listed without a Wh that
-- trips the gate. The label guides non-battery items (panels/wiring) in this
-- mixed category to enter 0. Idempotent UPDATE; kept in lockstep with seed.ts.
UPDATE "CategoryAttribute"
SET "required" = true,
    "label" = 'Battery energy (Wh — enter 0 if not a battery)'
WHERE "key" = 'battery_wh';
