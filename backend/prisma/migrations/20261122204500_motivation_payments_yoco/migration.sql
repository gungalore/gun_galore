-- The motivation paygate moves from Ozow to Yoco.
--
-- Operator, 2026-11-22: "We are removing it completely from zoho and moving
-- over to yoco api ... no more peach and ozow, just yoco for motivation
-- payments."
--
-- YOCO is added to PaymentProvider because a payment row must record the rail
-- that actually took the money — refunds go back through the same rail. It is
-- NOT offered to the marketplace: no Transaction is ever stamped YOCO, so the
-- shop's Ozow + Peach pair is untouched.
--
-- gatewayMode stores what the gateway said the checkout was ("live" or
-- "test"). A test-mode capture in production is not revenue, and settle()
-- refuses to mark one paid; keeping the value on the row is what lets support
-- see why.
--
-- Safe against production: the enum addition is metadata-only, the column is
-- nullable with no default, and no existing row changes. The table may well be
-- empty (the paygate was never switched on), and empty or not, every existing
-- OZOW attempt keeps settling through Ozow exactly as before.
--
-- NOTE for Postgres < 12: ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction block, and Prisma runs each migration in one. The live box is
-- well past 12, so this is a note rather than a problem.

ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'YOCO';

ALTER TABLE "MotivationPayment" ADD COLUMN IF NOT EXISTS "gatewayMode" TEXT;
