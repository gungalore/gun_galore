-- Remove the Competitions / Raffle feature in its entirety.
--
-- The feature is being withdrawn from the platform. Production carries
-- ZERO live competition data (0 Ticket / PostalEntry / RaffleWinner /
-- RaffleSellerApplication / RaffleAuditEvent rows, no ACTIVE raffle, R0
-- held), so dropping these tables strands no buyer money and breaks no
-- in-flight draw.
--
-- Tables are dropped with CASCADE + IF EXISTS so the migration is
-- idempotent and self-cleans any remaining foreign-key constraints.
-- Enums are dropped after their referencing tables are gone.

-- DropTable
DROP TABLE IF EXISTS "RaffleAuditEvent" CASCADE;
DROP TABLE IF EXISTS "RaffleImage" CASCADE;
DROP TABLE IF EXISTS "RaffleWinner" CASCADE;
DROP TABLE IF EXISTS "Ticket" CASCADE;
DROP TABLE IF EXISTS "PostalEntry" CASCADE;
DROP TABLE IF EXISTS "RaffleSellerApplication" CASCADE;
DROP TABLE IF EXISTS "Raffle" CASCADE;

-- DropEnum
DROP TYPE IF EXISTS "RaffleStatus";
DROP TYPE IF EXISTS "TicketStatus";
DROP TYPE IF EXISTS "ItemSource";
