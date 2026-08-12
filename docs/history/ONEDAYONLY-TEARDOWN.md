# OneDayOnly.co.za — Competitor Teardown

**Date:** 2026-07-15 · **Method:** live site walkthrough (desktop, anonymous, ~17:40 SAST) + sourced business-model research
**Purpose:** blueprint for a Gun Galore first-party "Daily Deals" module (GG creates the listings, GG is the seller). Companion doc: `DAILY-DEALS-PLAN.md`.
**Sourcing:** [V] = verified (named source) · [PV] = single/weak source · [INF] = inference.

---

## 1. What OneDayOnly is

SA's original daily-deals retailer. Registered Jan 2009, soft-launched April 2010 by Chris Oberhofer + Maurits Vermeulen — bootstrapped from a garage, founder-led to this day, **no VC, no corporate parent** (a data-broker claim of a Silvertree stake is unverified; no Naspers/Takealot link exists) [V/PV — Bizcommunity "turns 15" Sep 2025, MarkLives 2019]. Poetic detail: **their first deal ever was a Weber braai** — and Weber was running a 12-deal mini-shop the day of this walkthrough, 16 years later.

Core promise: **a fresh, curated batch of deep-discount deals every day, live for 24 hours or while stocks last.** They are the **first-party seller of record** — customers buy from ODO, not from third parties. Suppliers feed stock per deal; ODO does marketing, checkout, fulfilment and customer service.

**Scale today** [V — Bizcommunity Sep 2025, ITWeb Jun 2026]: 350+ deals loaded per day (was ~40/day in 2016, ~150 in 2019) · 5,000–10,000 orders/day · 3.8M+ registered shoppers · ~300 staff · 2 distribution centres (Ndabeni CPT + Steeledale JHB) · ~2.9M monthly web visits (SimilarWeb May 2026) · app ~1.3M cumulative Android installs. Healthy and expanding: first-ever CTO appointed June 2026 on a 5-year platform plan. Revenue: private, never disclosed; all public figures unreliable.

## 2. The deal-format ladder (the model has evolved far beyond "one day only")

The site is **a ladder of formats stacked by urgency** — each one an admission that pure 24h ephemerality caps revenue, and each adding another daily touchpoint:

| Format | Mechanics | Urgency lever |
|---|---|---|
| **Today's Deals** | Midnight-to-midnight SAST full reset — *"every night at 00:00 we wipe the slate clean"* [V — their help centre] | Site-wide header countdown "DEALS EXPIRE IN: HH:MM:SS" on every page |
| **Lunchtime Deal** | Every day at **13:00, one deal, live for ONE HOUR** — invented when morning email opens decayed; it's the second daily push/email hook [V] | 1-hour fuse |
| **Deal Rush Drops** | Sporadic loss-leader drops through the day, **capped 1 per household** [V — their T&Cs] | surprise + rationing |
| **Extra Time** | Winners from the past ~week extended, "big deals on repeat" (observed drop-dates up to 9 days old) | **"43 Left"** stock counters |
| **Everyday Essentials** | Permanent FMCG repeat-purchase shop (toothpaste, detergent, pet food) at shallow 12–22% off | none — habit/frequency play |
| **Clearance** | Permanent shelf, up to 90% off — **where their residual stock risk goes to die** | scarcity |
| + Brand stores, Black Friday portal, PR-stunt deals (R19 flights, an apartment) | | |

Other observed drop mechanics:
- **Brand mini-shops per day** — one supplier negotiation ⇒ 8–15 deal cards (observed: Weber ×12, Orial Outdoor ×11, Hurley, Jockey, Soundcore, Linen House, Mars Petcare…). This is how 350 deals/day stays operationally sane.
- **Themed weekly appointments** — a "Wine Wednesday Shop" (11 wine estates) inside the daily drop.
- **Outdoor validates hard inside their generalist mix**: on one random Tuesday — CADAC patio heater, full Weber range, coolers/drybags/tumblers, trekking poles, SUP board, FOX MTB apparel, Tramontina knives + axe, camping mattress, Garmin watch, even a 2-night lodge stay. *The niche GG owns is one of their best-performing themes.*

## 3. Deal-card & pricing anatomy (observed)

- **SAVE %** badge — switches to **absolute rands** on big tickets ("SAVE R10,000" on a R11,999 couch) because 45% sounds smaller than ten grand.
- **Now price** bold, **was price** struck (R1,199 ~~R4,000~~); list views add *"You save R2,200 (44%)"* in words.
- **"From R…"** when variants differ in price.
- Badges: **BEST SELLER**, **MORE OPTIONS** (variants), **LIMITED DELIVERY AREA** (bulky), low-stock counter (**"43 Left"**).
- Card = small brand name + title + prices. The *brand* is the trust anchor; ODO is the store. No clutter.

## 4. Product page anatomy (observed on a live deal)

1. Breadcrumb + SAVE badge
2. Brand + title + variant swatches + gallery
3. **BNPL line:** "Buy Now, Pay Later from as little as R300 per instalment with **Payflex**"
4. Price pair
5. **Delivery promise block — per deal, not global:** "Delivery in 3-5 working days" + "**98% on-time delivery**" + "Shipping calculated at checkout"
6. Variant + **quantity selector capped at 10** (fair-share / anti-reseller cap)
7. CTA: **"I WANT ONE!"** (never "Add to cart")
8. Trust row: *Easy returns within 7 days · Send as a gift · 4.5/5 on Google*
9. Structured copy: About / Features bullets / Specifications table
10. **Related products** (same brand's deals today) + "You may also like" cross-sell
11. Share: WhatsApp (pre-written playful message), email, Facebook
12. Newsletter capture: *"WANT EEEEVEN MORE DEALS? … LESS SCROLLING AND MORE LOLING!"*

## 5. Cart & checkout (probed to the payment gate)

- **Cart is a slide-out drawer.** Its header copy is the single best conversion hack on the site: **"Hurry! Stuff in your cart can sell out before you finalise your order. Checkout before someone else does."** → **the cart does NOT reserve stock** — first-paid-first-sold, stated bluntly in their help centre ("items in your cart are only yours once you pay for them") [V].
- Per-line ETA ("ETA: 3-5 working days"), qty dropdown, subtotal, "Shipping: calculated at checkout".
- Checkout gate: Log in / Google / Facebook / Create account / **CHECKOUT AS GUEST** + a **WhatsApp support link** right on the checkout screen.
- Payments: cards, **Payflex** BNPL, **Ozow** instant EFT, and **manual EFT** (dedicated "Our Banking Details" footer page — they still honour bank-transfer buyers, same rail GG runs today). Free-shipping promos are **payment-partner-funded** (Ozow covers the R69; Payflex R59) — the PSP pays for acquisition, not ODO [V].
- **Standard shipping R69**, distance/weight-calculated at checkout, bulky/remote surcharges passed on. No blanket free-shipping threshold. No waitlist/back-in-stock anywhere — sold out = gone, tomorrow is a new slate.

## 6. Supply model — the strategically crucial part [V — their own sell-with-us page]

**This is a just-in-time purchase-order model. They sell first, buy after:**

1. Supplier applies; ODO curates and negotiates offer, price, stock depth.
2. Deal built; supplier gets an **electronic sign-off link the day before go-live**.
3. Deal runs from midnight for 24 hours.
4. **Next day, ODO places a purchase order for EXACTLY the units sold.**
5. Supplier must deliver to a DC **within 3 days** of the PO.
6. **ODO pays the supplier on invoice once stock is delivered and checked — "no waiting period"** (fast payment is their supplier-recruitment pitch vs retail chains' 30–90 day terms).
7. ODO picks/packs/ships and owns all customer service.

Implications [INF]: they take title (first-party margin = deal price − negotiated cost) but carry **near-zero inventory risk** — they only buy what's already sold *and paid for*. Buyer cash arrives before the supplier is paid: **negative working capital on every deal**. The cost is latency — the generic **"shipped within 5–10 working days"** FAQ promise exists because stock only starts moving after the deal closes. Where they hold stock (Essentials, re-runs) the PDP promises 3–5 days. Clearance absorbs the overs.

Couriers: Fastway + DPD confirmed, Pargo/Pudo pickup points mentioned [PV].

## 7. Returns / CPA (first-party obligations) [V — their T&Cs/help centre]

- **Change of mind: 7 days** from receipt, re-sellable, original packaging — the ECTA §44 legal floor (deliberately NOT matching Takealot's voluntary 30 days).
- **Defective: 6 months** — straight CPA §56.
- Refund timing: EFT up to 5 working days; card up to 2 weeks.
- Process: log from My Orders → CS team **manually screens eligibility** → processed.
- **The trade-off is visible and structural:** Trustpilot 1.5/5, Hellopeter ~2/10 — dominant themes are delivery slower than the flash-sale excitement implies and sluggish returns handling. That's the JIT model's bill arriving. They survive on it because the deals keep coming.

## 8. The habit engine ("we're a marketing company that sells products" — their own words)

- **Email is the spine**: claimed 1M+ daily newsletter subscribers; two scheduled sends/day (morning drop + 13:00 Lunchtime Deal) + monthly best-sellers. The copywriting persona is a deliberate moat — *"people open the emails just to read the copy"* [V — MarkLives].
- **Quantified ritual:** Direct = 49% of traffic, Mail = #2 source [V — SimilarWeb]. The list, not the website, is the company.
- **App exists to own the push channel**: app-only deals + app-exclusive shipping promos migrate users to notifications.
- **No loyalty points/subscription.** Instead: an invite-only, engagement-based VIP email segment ("OneDayOnlyFans") + birthday deal drops. Perks are payment-partner-funded.
- **FOMO stack**: countdown → limited stock → cart-doesn't-reserve → "43 Left" → BEST SELLER badges → 1-hour lunchtime fuse. Every layer says *decide now*; the playful voice ("Cookies: nom nom nom", 404 page starring a cute dog) converts the pressure into fun.

## 9. Why ODO lived while SA daily-deals died [V facts / INF framing]

Groupon SA closed Nov 2016; the 2011–13 group-buying wave (Ubuntudeal, Wicount, CitySlicker…) collapsed; Citymob pivoted into Superbalist. ODO survived because it was never a coupon middleman: **curated physical products, first-party fulfilment, own CS, and a supply chain that only buys sold units**. It's a retailer wearing a flash-sale costume. Its three structural weaknesses, visible in its own record: (a) JIT delivery latency → worst review scores of the big SA e-tailers; (b) scarcity theatre erodes with scale (Extra Time/Essentials/Clearance are the admissions); (c) discovery is push-driven — the email list IS the business.

## 10. What Gun Galore should copy / adapt / skip

**Copy (high confidence):**
1. **The daily drop moment + header countdown** — the habit loop is the product.
2. **Deal-card grammar**: SAVE badge (% or R), was/now, "You save R… (%)", low-stock counter.
3. **Cart does not reserve stock** + honest urgency copy (GG's P8a rails already decrement at order-creation, not add-to-cart — zero work).
4. **Per-deal delivery promise** ("Ships in X working days") set by admin per deal — this is what makes the JIT supply pattern honest.
5. **Supplier mini-drops**: one negotiation = 8–15 cards (a "CZ week", "Jack Pyke drop", biltong-gear day).
6. **Quantity cap per customer** per deal.
7. **Drop-time push + email** — GG already has web-push and broadcast infra.
8. **The sell-first-buy-after ops pattern** — the operator can run ODO's exact supply model solo: close the drop, order exactly the sold units from the supplier, ship on GG's existing courier rails. Zero warehouse required.

**Adapt (GG-specific):**
- **Niche curation is the edge.** ODO proves outdoor sells inside a generalist drop; GG inverts it — every deal on-mission. "SA's daily deal for the outdoors" is a sharper promise than ODO's own.
- **Start at credible-small.** ODO ran ~1 deal/day in year one and ~40/day at year six. A GG drop of **3–10 curated deals** is fully credible — curation density, not count, is what the format sells.
- **Drop time is a setting, not code**: midnight is ODO-proven; 06:00 "with your coffee" may fit hunters better. Test.
- **Two surfaces at launch**: Today's Deals + Extra Time. Essentials/Clearance only when stock reality demands.
- Returns at the legal floor (7-day ECTA change-of-mind + 6-month CPA defects), manual eligibility review — exactly what ODO runs.

**Skip (for now):** travel/experience deals inside the module (GG's Experiences rails stay separate) · app-only deals & vouchers · BNPL until the card paygate lands (Payflex/Peach instalments pair naturally with deals later) · **firearms/ammo in first-party deals — excluded by design, structurally, since GG (Pty) Ltd is not a SAPS-licensed dealer.** Optics, knives, camping, braai, fishing, packs, clothing are all clean.

## 11. Legal/ops implications of first-party selling (flag for accountant + attorney)

1. **CPA/ECTA applies to GG directly** as seller of record: §44 7-day cooling-off + §56 six-month defect remedies → refund-policy page needs a first-party section.
2. **Returns become GG's physical problem** — reverse logistics to the GG address via existing Pudo/TCG rails; manual eligibility gate like ODO's.
3. **VAT & accounting**: first-party revenue is GG **turnover**, not commission. Zoho = full-amount Sales Receipt/Tax Invoice to buyer (the featured-slot pattern generalises); supplier invoices on the cost side. Confirm VAT posture with the accountant pre-launch.
4. **All seller-side machinery must be bypassed** for house sales: no payout batch, no KYC gate, no commission invoice, no 48h accept window.
5. **Every deal is a P&L line** — admin must capture cost price and show sell-through/margin per deal.

---

*Live walkthrough: onedayonly.co.za homepage, Extra Time, Everyday Essentials, PDP (`genuine-leather-brooklyn-duffel-bag-20260713`), cart drawer, checkout gate, help centre — 2026-07-15. Research sources: help.onedayonly.co.za; onedayonly.co.za/sell-with-us; Bizcommunity (Sep 2025, Jun 2026); ITWeb (Jun 2026, BF 2025); ecommerce.co.za (2021); MarkLives (2019); SimilarWeb (May 2026); AppBrain; Trustpilot/Hellopeter. Ownership/revenue specifics flagged unverified above.*
