# Gun Galore "Daily Deals" — Module Plan

**Date:** 2026-07-15 · **Basis:** `ONEDAYONLY-TEARDOWN.md` (read that first)
**One-liner:** an OneDayOnly-style daily-drop deals surface where **Gun Galore is the seller** — the operator creates every deal in a new admin panel, buyers purchase on the existing cart/order/EFT rails, GG ships via the existing courier rails.

---

## 0. The shape of the thing

- A **drop** = a batch of deals that goes live at a fixed time and expires at the next drop (ODO: midnight→midnight; GG drop hour is an admin setting).
- A **deal** = one product, first-party: cost price (what GG pays the supplier), was-price (RRP anchor), deal price, limited stock, per-customer cap, its own "ships in X working days" promise.
- Two public surfaces at launch, exactly like ODO's core: **Today's Deals** (live drop + countdown) and **Extra Time** (extended winners). No Essentials/Clearance yet.
- **The ops pattern is ODO's own sell-first-buy-after JIT**: operator agrees a deal with a supplier → drop runs → order exactly the sold units → supplier delivers → GG ships. Zero warehouse needed; the per-deal ships-in promise makes the latency honest.
- **Firearms/ammo/licensed items are structurally excluded** (server-enforced category gate). Optics, knives, camping, braai, fishing, packs, clothing, pet/working-dog, biltong gear — all clean.

## 1. Why this is mostly assembly, not construction

The heavy machinery already exists and is live in prod:

| Need | Already-live rail |
|---|---|
| Limited stock, oversell-safe | P8a `Listing.quantity` + atomic decrement at order-creation + stock-leak sweep — **and it already means "cart doesn't reserve stock"**, ODO's best trick |
| Cart + multi-item checkout | P8b/P8d Order-over-Transaction rails |
| Payment | live manual-EFT rail (reference → inContact/statement reconcile → HELD); paygate slots in later untouched |
| Shipping | P5.2 platform-arranged courier booking on accept (Pudo L2L / TCG D2D) — books automatically, sends waybill+PIN+label to the "seller" = the operator |
| Delivery→release lifecycle | existing HELD → dispatched → delivered → RELEASED machine |
| Refunds | existing manual-rail refund CSV + bank-capture flow (money leaves GG's account — exactly right for first-party) |
| Photos/upload, categories, structured specs | listing-creation infra |
| Push + email | web-push service + admin broadcast |
| Countdown UI | auction countdown components |
| Admin kit | page-header/section/form/status-chip components + grouped sidebar |
| Accounting | Zoho rails — the featured-slot **full-amount Sales Receipt** pattern generalises to first-party sales |

What's genuinely new: a `Deal` overlay model + house-seller identity + a drop scheduler cron + the `/deals` surface + the admin deal builder + the first-party money-path branches (auto-accept, payout exclusion, Zoho branch).

## 2. Architecture

### 2.1 House seller
A system User row **"Gun Galore"** (username e.g. `gungalore_official`, its id stored in a Setting). Deal listings belong to it. Its transactions are **first-party**: no KYC gate, no payout, no commission — enforced by id checks at the few chokepoints listed in §2.4. Its seller shipping profile = the operator's dispatch address (courier collection point).

### 2.2 Schema (one additive migration)

```
enum DealStatus { DRAFT SCHEDULED LIVE EXTENDED ENDED SOLD_OUT CANCELLED }

model Deal {
  id               String     @id @default(cuid())
  listingId        String     @unique          // 1:1 overlay on a BUY_NOW listing
  status           DealStatus @default(DRAFT)
  costPriceCents   Int                          // internal — per-unit supplier cost
  wasPriceCents    Int                          // RRP anchor (struck-through price)
  // deal sell price = Listing.priceCents (single source of truth for checkout)
  startsAt         DateTime?
  endsAt           DateTime?
  extendedUntil    DateTime?                    // Extra Time
  dropDate         DateTime?                    // which drop this belongs to (grouping/calendar)
  heroRank         Int        @default(0)       // ordering within the drop
  initialStock     Int                          // snapshot at go-live → sell-through %
  perCustomerCap   Int        @default(10)      // ODO-style fair-share cap
  shipsInDaysMin   Int        @default(3)       // per-deal delivery promise
  shipsInDaysMax   Int        @default(7)
  supplierName     String?                      // internal
  supplierRef      String?                      // internal PO/agreement note
  createdByAdminId String
  liveAt / endedAt / soldOutAt / createdAt / updatedAt
  @@index([status, startsAt]) @@index([dropDate])
}

Listing additions:  isDealListing Boolean @default(false)  (+ index)
```

`isDealListing` keeps deal listings **out of every normal marketplace surface** (browse, search, category/brand pages, cross-sell, sitemap listing set, wanted-ad responses) via one cheap filter — a careful sweep of every listing query is part of Wave 1.

### 2.3 Buyer surface
- **`/deals`** (public → **middleware `isPublicRoute` entry — the standing gotcha**): header countdown to drop end · hero-ranked grid of LIVE deals · Extra Time section · sold-out/ended cards greyed ("Missed it — new drop at {time}") · empty state teases next drop.
- **Deal PDP** = existing `/listings/[id]` + deal chrome when `isDealListing`: SAVE badge (% or R, ODO's big-ticket rule) · was/now + "You save R… (%)" · stock bar when stock < 30% of initial ("only N left") · "Ships in X–Y working days" · countdown chip · qty selector capped `min(perCustomerCap, stock)` · **"Sold & shipped by Gun Galore"** instead of the seller card · offers/auction/swap/Q&A hidden (pure BUY_NOW).
- **Entry points:** nav "Deals" (red-hover like the rest), bottom-tab shop sheet entry, homepage deals rail near the top, sitemap.
- **Drop notification:** web-push "Today's deals are live 🔥 {n} new deals" at drop time (respects notification prefs) + optional email via existing broadcast.
- Deal-card share buttons (WhatsApp pre-written message — ODO's trick, GG voice).

### 2.4 First-party money path (the sensitive part — adversarial review before deploy)
Buyer-side flow is IDENTICAL to today (cart → EFT reference → reconcile → HELD → dispatch → delivered → RELEASED). Branches keyed on `sellerId === houseSellerId`:
1. **Auto-accept on payment confirmed** — skip the 48h accept token/escalation entirely; `acceptedAt` stamped immediately → the P5.2 courier booking fires → operator gets waybill+PIN+label by SMS/email, same as any seller today.
2. **Payout exclusion** — payout-batch collection skips house rows (money already in GG's account IS the settlement). KYC/profile gates never trigger (never reaches payout).
3. **Zoho branch** — instead of commission invoice + payout marking: **full-amount Sales Receipt to the buyer** (featured-slot pattern), fired at RELEASED; refund → Credit Note against it. House rows excluded from commission reporting.
4. **Held-funds (CFP) report** — decision for the accountant: conservative default = house HELD money still counts as refundable client funds until RELEASED, then simply never enqueues a payout. (Flagged, not assumed.)
5. **Per-customer cap** enforced at order-creation (count buyer's prior paid/pending units for the deal).
6. **Refunds** — existing manual-rail refund flow unchanged (bank-capture + admin CSV); only the Zoho leg branches.

### 2.5 Drop engine
- `dealDropTick` cron (every minute, with cron-health heartbeat): `SCHEDULED→LIVE` at startsAt (stamps liveAt + initialStock, fires the push once per drop) · `LIVE→ENDED` at endsAt unless `extendedUntil` (→ `EXTENDED`, surfaces in Extra Time) · `→SOLD_OUT` when stock hits 0 (also stamped inline at order time).
- Settings (admin-editable, no deploy): `deals_enabled` (killswitch), `deal_drop_hour` (default TBD — see decisions), `deal_default_per_customer_cap`, `deal_push_enabled`.

### 2.6 Admin panel — `/admin/deals` (Marketplace sidebar group)
Because the operator creates every listing, this is the module's cockpit:

1. **Pipeline list** — tabs Draft / Scheduled / Live / Extra Time / Ended / Sold out; columns: product, drop date, cost / deal / was, margin %, sold / initial (sell-through bar), revenue, status chip; row actions.
2. **Deal builder** (create/edit):
   - *Product half* (reuses listing infra): title, brand, category picker with **licensed categories greyed out and server-rejected**, condition (default NEW), description, specs, photo upload, shipping methods.
   - *Deal half*: cost price, was price, deal price with **live margin-% + SAVE-% preview** ("R499 → 38% margin, shows SAVE 44%"), stock, per-customer cap, ships-in min/max, drop date or explicit start/end, hero rank, supplier name/ref.
   - Guards: wasPrice > dealPrice > 0; category gate; warn (not block) on margin < configurable floor.
3. **Actions:** Schedule · Go live now · **Extend** (→ Extra Time until date) · End now · **Duplicate** (re-run — ODO's "when are you running this again?" answered) · Cancel.
4. **Performance dashboard:** per-deal units/revenue/COGS/gross margin/sell-through %, per-drop rollups, all-time best-sellers. Every deal is a P&L line.
5. Command-center card later: "Deals live today · units sold · revenue".

## 3. Build waves (house rules per wave: tsc + jest + builds → review → DB backup → migration → deploy → verify)

| Wave | Ships | Gate |
|---|---|---|
| **DD-1** | Schema + migration + house-seller seed script + `isDealListing` exclusion sweep across all listing queries + admin CRUD (pipeline list + deal builder, inert) | tsc/build; verify deals invisible everywhere public |
| **DD-2** | First-party money path: auto-accept, payout exclusion, Zoho Sales Receipt/Credit-Note branch, per-customer cap, dummy-run module for the whole cycle | **adversarial review (money)** + dummy-run green |
| **DD-3** | Buyer surface behind `deals_enabled`: `/deals`, PDP deal chrome, nav/homepage/tab entries, middleware+sitemap, refund-policy first-party section, "Sold & shipped by Gun Galore" | visual QA desktop+mobile+PWA; legal copy check (no "escrow"; usernames-only untouched) |
| **DD-4** | Drop engine: scheduler cron + heartbeat, drop push/email, Extra Time, sold-out sweep, countdowns | cron heartbeat green in /admin/health; test drop end-to-end on prod with a R1 test deal |
| **DD-5** | Performance dashboard + duplicate/re-run + share buttons + command-center card + polish | operator click-test, then first real drop |

Rollback story: every wave is flag- or surface-isolated; `deals_enabled=false` hides the entire buyer surface instantly; the cron no-ops when nothing is SCHEDULED/LIVE.

## 4. Operator decisions needed (none block DD-1)

1. **Name** — "Daily Deals" / "GG Deals" / "The Drop"? (CTA voice too: ODO's "I WANT ONE!" energy, GG flavour.)
2. **Drop time** — midnight (ODO-proven) vs 06:00 "with your coffee" (hunter-friendly). It's a setting; pick a default.
3. **Cadence at launch** — daily needs 3+ deals/day sourced; a **weekly drop** (e.g. Wednesday 06:00, 5–10 deals) is the credible-small start ODO themselves grew from (~1 deal/day their whole first year). The engine supports any cadence.
4. **Accountant sign-off** — VAT posture on first-party turnover + the CFP/held-funds treatment in §2.4(4) + Zoho account for "Deals Revenue".
5. **Dispatch address** — where couriers collect (house seller's shipping profile).
6. **Attorney glance** — refund-policy first-party section (7-day ECTA cooling-off + 6-month CPA defects, ODO-style manual eligibility review).

## 5. Later (explicitly parked)
Lunchtime-style 1-hour flash slot (second daily push) · Deal Rush drops (1/household) · Clearance shelf · payment-partner-funded shipping promos + BNPL instalments (when Peach lands — pairs with the parked auth/capture plan) · GG+ early access to drops (subscriber perk synergy) · Ask GG "today's deals" tool + deal page-guide.
