-- Gate Optics, Hunting and Hunting Packages — operator decision, 2026-08-21.
--
-- NOT A POLICY READING THIS TIME. The previous migration
-- (20260821120000_gate_meta_prohibited_categories) gated exactly what Meta
-- itemises by name, and deliberately LEFT optics and hunting public on the
-- reasoning that night vision and thermal appear only in Meta's advertising
-- standard, and that hunting trips are lawful and mainstream.
--
-- The operator has overruled that, and the reasoning is sound for a business
-- in this position: "not taking any chances. This is a startup so the shop can
-- afford to look bare." A second Meta restriction is an existential problem;
-- an empty Optics tree is not. When the cost of a false negative is losing the
-- payments rail and the cost of a false positive is a thinner catalogue, you
-- take the thinner catalogue.
--
-- What this removes from public view:
--   optics--*          binoculars, spotting scopes, rangefinders, trail
--                      cameras, night vision, thermal, drones, tripods, GPS
--   hunting--*         game calls, blinds, packs, field dressing, scent
--                      control, accessories
--   hunting-packages-experiences   guided hunts / experiences
--
-- WHAT REMAINS PUBLIC — four roots, 59 categories: camping-outdoor, fishing,
-- overlanding, outdoor-clothing-footwear. A camping-and-fishing store. That is
-- a coherent, honest shopfront; it is not a firearms business wearing a
-- costume, which matters because misrepresenting the nature of the business is
-- itself a Meta violation (WhatsApp Business Messaging Policy s.1).
--
-- ⚠️ THIS DOES NOT TOUCH THE STATUTORY PAGES. /terms, /privacy, /aml-policy,
-- /refund-policy, /acceptable-use, /cookies, /paia, /legal, /complaints,
-- /contact, /fees and /about stay public and complete — the banks vet the
-- public site during TPPP onboarding and need to find the paperwork there.
-- Gating a product tree is not the same as hiding the company.

UPDATE "Category"
SET "publicVisible" = false
WHERE split_part(slug, '--', 1) IN ('optics', 'hunting')
   OR slug LIKE 'hunting-packages%';

-- Re-snapshot affected listings. ONE-DIRECTIONAL, as in every gating migration
-- before this one: it only ever HIDES. A migration must never be the thing
-- that publishes something.
UPDATE "Listing" l
SET "publicVisible" = false
FROM "Category" c
WHERE l."categoryId" = c.id
  AND c."publicVisible" = false
  AND l."publicVisible" = true;
