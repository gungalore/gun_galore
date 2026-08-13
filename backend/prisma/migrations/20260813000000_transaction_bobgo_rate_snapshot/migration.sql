-- M34 — carry the full identity of a chosen Bob Go rate on the Transaction.
--
-- Bob Go is replacing Pudo (lockers) and TCG (door). Its POST /shipments needs
-- three things echoed back from the quote — service_code, provider_slug and
-- service_level_code — and we only persist the first
-- (Transaction.shippingServiceCode, added for Pudo).
--
-- The other two were never needed before because Pudo and TCG each had exactly
-- ONE provider, so the provider was implied by the shippingMethod. Bob Go is an
-- aggregator: a single quote response can carry different providers on
-- different rates (a sandbox reply returned provider "sandbox" on its door rate
-- and "demo" on its pickup-point rate). Without these columns the booking would
-- have to guess a provider, and a guess that happens to be wrong books the
-- buyer onto a courier and a price they did not choose.
--
-- This matters more than it looks because of WHEN the booking happens: the rate
-- is quoted at checkout but the shipment is only created when the seller
-- accepts, potentially days later. There is no live quote in hand at that
-- point — the snapshot IS the booking input.
--
-- Nullable and additive on purpose. Every existing row is a Pudo or TCG sale
-- whose provider is implied by shippingMethod, so NULL is correct for them and
-- there is nothing to backfill. New Bob Go rows fill both.
--
-- Safe to run against production: ADD COLUMN of a nullable column with no
-- default takes no table rewrite on Postgres 11+.

-- carrierProvider records WHICH API actually booked a shipment ("PUDO", "TCG"
-- or "BOBGO"). It is no longer derivable from shippingMethod, because Bob Go
-- sits behind both enum slots — the method now describes the SHAPE of the
-- delivery, not the company holding the parcel.
--
-- Every post-booking operation (waybill PDF, cancel, tracking poll, webhook
-- match) has to route on this column. Routing on shippingMethod instead would
-- call the wrong carrier's API with an id it has never heard of, and would
-- strand every in-flight Bob Go parcel the moment bobgo_enabled is switched
-- back off — which is precisely the escape hatch the flag exists to provide.
--
-- Null on every historical row. Those all predate Bob Go and are therefore
-- Pudo or TCG, so readers treat null as "derive from shippingMethod". We do not
-- backfill: a written-in value would claim knowledge the column did not have.

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "shippingProviderSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingServiceLevelCode" TEXT,
  ADD COLUMN IF NOT EXISTS "carrierProvider" TEXT;
