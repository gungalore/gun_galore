# TAKEALOT UX PARITY REPORT

**Date:** 2026-07-05
**Source material:** 12 desktop screenshots of Takealot.com's shopper journey (captured by the operator, 2026-07-05) + a two-agent code exploration of the Gun Galore frontend/backend on the same day. Every "GG today" claim below was verified against the codebase, not assumed.
**Purpose:** an execution-ready gap analysis a future Opus 4.8 session can build from, batch by batch.

---

## 1. How to use this report

You (the executing session) should work the roadmap in Section 5 **batch by batch (UX-1 → UX-8)**, committing and verifying per batch. Each batch has a spec block in Section 6 with files, reused utilities, acceptance criteria, and verification. House rules that override anything in this report:

- **Never use the word "escrow"** in any user-facing copy — always "funds held" / "payment held" (regulated SA term; standing rule).
- **Username only on public surfaces** — never real names (usernames exist to stop social-media bypass).
- **The manual-EFT rail is temporary** — a card paygate (Ivori/Nedbank or Peach + PayJustNow) is pending. Build everything gateway-neutral; never hard-code EFT-only UX where a payment-method abstraction fits.
- **PWA-first mobile** — the bottom tab bar + Shop/More sheets are the mobile nav; desktop-only patterns (hover mega-menu) must not regress mobile.
- **Adversarial review before deploy** for anything touching checkout/cart/money display (UX-3, UX-4, UX-7, UX-8).
- Deploy via `ssh gungalore` (never `user@ip`); frontend dev server from `C:\dev\gun-galore\frontend` (Webpack, not Turbopack); `git push` together with any CLAUDE.md change.
- **Don't regress GG's strengths** (things Takealot doesn't have): 4 selling modes (Marketplace / Auction / Take a Shot / Swop), firearm compliance routing (DEALER_TRANSFER / SAPS 534), Claude-moderated Q&A panel, featured-slot rail, saved searches with notify, sold-comps price strip, per-category attribute filters, the Experiences module.

---

## 2. Method

The 12 screenshots covered, in journey order:

| # | Screenshot showed |
|---|---|
| 1 | Homepage with **"Shop by Department" mega-menu open** (dept list → subcategory columns → featured stores + promo panel) + "Pick Up Where You Left Off" rail |
| 2 | **Footer sitemap** — 5 link groups (Shop / Account / Help / Company / Terms), app-store badges, social links, full category index row, payment-method logo bar |
| 3 | **Registration modal** — Google/Facebook first, minimal fields, SMS OTP for mobile, marketing opt-in checkbox |
| 4 | **My Account hub** — single landing page with 6 grouped cards (Orders / Payments & Credit / TakealotMORE / Profile / My Lists / Support) |
| 5 | **Product detail page** — "ONLY 6 LEFT" chip, R3,000 with ~~R7,499~~ strikethrough + 59% OFF, delivery-date estimate ("Delivery 9 Jul – 12 Jul"), star rating + review count, seller card with Seller Score, Add to Cart + Add to List, trust bullets (COD-eligible, free delivery, 30-day exchanges, warranty) |
| 6 | **Seller store page** — branded storefront, "29 results", Refine by Category, Seller/Deal/In-Stock-near-you filters, sort dropdown, grid/list toggle, per-card delivery promise |
| 7 | **Added-to-cart side drawer** — item confirmation + "Go to Cart" + Related Products rail + Popular in this Category, all inside the drawer |
| 8 | **Cart** — per-item ship-time, COD-eligibility note, "Promotion Applied" tag, Remove / Move to List, sticky Cart Summary with trust bullets (Secure checkout · Many ways to pay · Fast reliable delivery) |
| 9 | **Checkout step 1** — stripped-down secure layout (`secure.takealot.com`), Delivery Method card + Change, voucher/coupon expander, sticky Order Summary, donation checkbox |
| 10 | **Delivery-method modal** — two big option cards (Delivery / Collect) with icons |
| 11 | **Address picker** — saved-address radio cards (label chip, name, phone) + Add Address + Continue |
| 12 | **Checkout final** — chosen address with Change, **delivery-date choice** (Sunday "FASTEST" badge vs Monday, both Free), Payment Method section with card logos, Pay with Card CTA, voucher + eBucks expanders |

GG's current state was mapped by two Explore agents (shopper journey; post-purchase/trust/engagement) on 2026-07-05. Condensed maps are in the Appendix.

---

## 3. Screenshot-by-screenshot findings

### 3.1 Category mega-menu (screenshot 1)
**Takealot:** persistent "Shop by Department" button; hover opens a two-level flyout (departments → subcategory columns) plus featured stores and a promo panel. Category reach is one hover from anywhere.
**GG today:** flat 5-link nav — Marketplace, Auctions, Take a Shot, Swop/Trade, Competitions (`frontend/components/nav.tsx`). Category discovery only via the homepage tile curtain and `/category/[slug]` subcategory chips. From a PDP or any deep page, there is **no path to browse categories** without going home.
**Gap:** no category navigation from the nav bar at all.
**Recommendation:** UX-5 — "Shop by Category" hover/click flyout on desktop using the existing `/categories/with-counts` hierarchy (root → children, counts included). Keep the 5 mode links. Mobile unchanged (Shop sheet already covers it).

### 3.2 Personalised homepage rails (screenshot 1)
**Takealot:** "Pick Up Where You Left Off" (View More / Clear All), deals strips, brand carousel.
**GG today:** hero → category curtain → featured marquee → recently-viewed rail (`frontend/app/page.tsx`). Recently-viewed is localStorage-only, self-hides under 2 items, no Clear All.
**Gap:** modest — GG has the core rail. No deals strip (no RRP data — see 3.6), no personalised recommendations.
**Recommendation:** low priority. Add "Clear all" to the recently-viewed rail (trivial); a wishlist-price-drop rail becomes possible after UX-7. Skip algorithmic recommendations at current catalogue scale.

### 3.3 Footer sitemap (screenshot 2)
**Takealot:** 5 columns (Shop / Account / Help / Company / Terms & Policies), app badges, social icons, full category text-link row, payment logos (Visa/MC/Amex/Payflex/…).
**GG today:** `frontend/components/site-footer.tsx` — brand block, Shop links, Legal links, ECT §43 company info. **No Account column, no payment-method logos, no app badges** (noted in code comments as intended), no category index row.
**Gap:** footer under-used as both trust surface and SEO surface.
**Recommendation:** UX-1f — add an Account column (Orders, Wishlist, Saved searches, Support), payment logos (EFT now; render from a config array so card logos slot in at paygate go-live), a "Get the app" install CTA (reuse the existing PWA install prompt hook), and a category text-link row from `/categories/with-counts` (SEO win — crawlable category links on every page).

### 3.4 Registration (screenshot 3)
**Takealot:** social-first (Google/Facebook), 6 fields, inline password rules, SMS OTP, marketing opt-in.
**GG today:** Clerk-managed sign-in; custom sign-up form collects firstName/lastName/username/email/phone/password (`frontend/app/sign-up/[[...sign-up]]/page.tsx`); phone OTP enforced in ProfileCompletionModal (LOW-24, done).
**Gap:** small. Social sign-in depends on Clerk config, not code.
**Recommendation:** verify Google sign-in is enabled in the Clerk dashboard (operator action, not code); otherwise no build work. Not in the roadmap batches.

### 3.5 My Account hub (screenshot 4)
**Takealot:** one `/account` landing — six cards, each a titled group of links with an icon, plus inline data (Available Credit: R0, "Saved so far: R0").
**GG today:** **no account landing page at all.** `ACCOUNT_GROUPS` in `frontend/lib/account-menu.tsx` (Buying / Selling / Competitions / Account) renders as a dropdown (desktop), drawer section (mobile browser), and More sheet (PWA). `/dashboard` is seller-trust-score only.
**Gap:** the single clearest structural miss. Every account task starts from a menu, never from an overview.
**Recommendation:** UX-2 — build `/account` from ACCOUNT_GROUPS as grouped cards, enriched with live counts (active orders, unread notifications, wishlist count, GG+ tier + expiry). Point the account chip / More-sheet profile header at it.

### 3.6 PDP conversion kit (screenshot 5)
**Takealot:** stacks urgency ("ONLY 6 LEFT" red chip), value anchor (~~R7,499~~ → R3,000, 59% off), certainty ("Delivery 9 Jul – 12 Jul"), social proof (★5, 4 Reviews at top), seller trust (Seller Score 4.6, 30 Reviews card), and 4 trust bullets — all beside the price.
**GG today (`frontend/app/listings/[id]/page.tsx`):**
- Stock: text-only status when `trackInventory`; **no urgency chip**, nothing on cards.
- **No compare-at price field exists in the Listing schema** — no strikethrough, no "% off", no deal messaging anywhere on the site.
- **No delivery estimate on the PDP** — the buyer first sees courier options at checkout. Delivery-estimate logic already exists post-purchase (estimated-delivery window on `/transactions/[id]`, P5.1).
- Seller card is good (avatar, username, badges, rating, sales, join date) — **parity here**.
- **No trust bullets at point of decision** — funds-held/KYC/dispute copy lives on `/faq` and `/how-selling-works` only.
- Ratings appear on the seller card but **not near the title**, and item-level review display doesn't exist (ratings are seller-level).
**Gap:** GG's PDP explains the item well but does almost no *conversion* work — no urgency, no anchor, no certainty, trust buried two clicks away.
**Recommendation:** UX-1a/b/c/d (urgency chip, card stars, ETA line, trust bullets) + UX-7 (compare-at price, schema change, CPA-guarded).

### 3.7 Seller storefront (screenshot 6)
**Takealot:** result count, Refine by Category, seller/deal/in-stock filters, sort, grid/list toggle, per-card delivery promise.
**GG today (`frontend/app/sellers/[clerkId]/page.tsx`):** profile header + **fixed 8 listings** + reviews panel. No filters, no pagination, no sort, no "view all".
**Gap:** a TOP_SELLER or DEALER-tier seller with 60 listings can only surface 8. This matters most for exactly the sellers GG wants to retain (dealers).
**Recommendation:** UX-6 — the browse backend already accepts `sellerClerkId` alongside every other filter, so this is UI assembly: mount FilterBar (category/condition/price/sort) + the standard 24-item paginated grid on the seller page.

### 3.8 Added-to-cart drawer (screenshot 7)
**Takealot:** add-to-cart opens a right drawer: confirmation + Go to Cart + Related Products + Popular in this Category. Keeps the buyer in flow and cross-sells at peak intent.
**GG today:** add-to-cart flips button state in place; no drawer/toast; the existing cross-sell endpoint (`GET /listings/cross-sell`, "you might also need…") renders on browse results but **not at add-to-cart** — the single highest-intent moment.
**Gap:** confirmation feedback + cross-sell placement.
**Recommendation:** UX-4 — slide-in drawer (item, subtotal, Go to Cart, Continue shopping) with a cross-sell rail fed by the existing endpoint. Bottom-sheet variant on mobile.

### 3.9 Cart (screenshot 8)
**Takealot:** per-item ship-time + eligibility notes + promo tag + Move to List; summary panel with three trust bullets; "cart does not reserve stock" honesty line.
**GG today (`frontend/app/cart/page.tsx`):** strong mechanics — multi-seller grouping, qty stepper, Remove, **Move to wishlist (parity)**, firearm routing + attestations, PUDO locker picker / TCG address fields, sticky summary. **Missing:** trust bullets on the summary, per-item context lines, payment-method signalling.
**Gap:** mechanics ahead of Takealot in places (firearms, swaps); *reassurance* behind.
**Recommendation:** UX-1e — trust bullets under the summary CTA ("Payment held until you confirm delivery" · "Every seller ID-verified" · "Dispute protection on every order") + a "How payment protection works" link to /faq. Per-item ETA lines arrive with UX-8's quote surfacing.

### 3.10 Checkout (screenshots 9–12)
**Takealot:** dedicated secure layout (logo + Help only), delivery-method modal (two big cards), **saved-address radio cards + Add Address**, **delivery-date choice** ("FASTEST" badge), payment-method section with logos, sticky Order Summary throughout, voucher + donation hooks.
**GG today (`frontend/app/checkout/[listingId]/page.tsx` + `checkout-form.tsx`, cart checkout):**
- Full nav retained on checkout pages (no stripped secure framing).
- Delivery method is functional (PUDO/TCG/collection/firearm routes) but rendered as form controls, not option cards.
- **Address: single-profile-address only.** Checkout already wires `AddressAutocomplete` + a "Delivering to" confirmation chip for the ONE address saved on `/users/me` (`checkout-form.tsx:1300-1378`). But the **multi-address book** (P2.3 — `Address` model, `GET/POST/PATCH/DELETE /users/me/addresses` in `backend/src/users/users.controller.ts:276-301`) is **not referenced anywhere in checkout or cart** — a buyer with Home + Work + farm addresses can't pick between them; changing destination means overwriting their profile address.
- No delivery-date choice (single courier quote; Pudo/TCG selection is implicitly speed-vs-price — never framed that way).
- EFT-only payment presented as the endpoint; no payment-method section shell for the coming paygate.
- Order summary panel exists on single-item checkout (parity) and cart.
**Gap:** address book at checkout is the #1 repeat-buyer friction; secure framing and method-cards are polish; a payment-method section shell is paygate prep.
**Recommendation:** UX-3 (address picker — biggest win) + UX-8 (checkout chrome: minimal header, method option cards, payment-method section shell with EFT as today's single method).

---

## 4. Master gap table

| # | Gap | Takealot evidence | GG status | Impact | Effort | Priority |
|---|---|---|---|---|---|---|
| G1 | "Only X left" urgency chip (PDP + cards) | Screenshot 5 | PARTIAL — `trackInventory` exists; PDP text-only, cards nothing (`components/listing-card.tsx`) | High (conversion) | Low | **UX-1a** |
| G2 | Stars + review count on listing cards & PDP top | Screenshot 5 | ABSENT on cards; seller-card-only on PDP | High (trust at a glance) | Low | **UX-1b** |
| G3 | Delivery ETA on PDP | Screenshot 5 "Delivery 9–12 Jul" | ABSENT pre-purchase; estimate logic exists post-purchase (P5.1) | High (certainty) | Low–Med | **UX-1c** |
| G4 | Trust bullets at point of decision (PDP + cart) | Screenshots 5, 8 | ABSENT — copy exists on /faq only | High (trust) | Low | **UX-1d/e** |
| G5 | Footer: account links, payment logos, app badges, category index | Screenshot 2 | PARTIAL (`components/site-footer.tsx`) | Med (trust + SEO) | Low | **UX-1f** |
| G6 | My Account hub landing | Screenshot 4 | ABSENT — menu-only (`lib/account-menu.tsx`) | High (orientation) | Med | **UX-2** |
| G7 | Multi-address picker at checkout | Screenshot 11 | PARTIAL — single profile address + autocomplete wired; P2.3 multi-address book backend exists, unreferenced by checkout/cart | **Very high** (repeat friction) | Med | **UX-3** |
| G8 | Added-to-cart drawer + cross-sell | Screenshot 7 | ABSENT — button state flip only; cross-sell endpoint exists | High (AOV + feedback) | Med | **UX-4** |
| G9 | Category mega-menu in nav | Screenshot 1 | ABSENT — flat 5 links (`components/nav.tsx`) | Med–High (discovery) | Med | **UX-5** |
| G10 | Seller storefront filters/pagination | Screenshot 6 | ABSENT — fixed 8 items (`app/sellers/[clerkId]/page.tsx`) | Med (dealer retention) | Med | **UX-6** |
| G11 | RRP/was-price + % off | Screenshot 5 | ABSENT — no schema field | High (value anchoring) | Med (migration + CPA guard) | **UX-7** |
| G12 | Checkout secure framing + method cards + payment section shell | Screenshots 9, 10, 12 | PARTIAL | Med | Med | **UX-8** |
| G13 | Delivery-date choice at checkout | Screenshot 12 | ABSENT (single quote per method) | Low–Med | High (carrier API) | Backlog |
| G14 | Voucher/coupon at checkout | Screenshots 9, 12 | ABSENT (P8c parked) | Med | High | Deferred to paygate |
| G15 | Social sign-in prominence | Screenshot 3 | PARTIAL (Clerk config) | Low | None (config) | Operator action |
| G16 | Order timeline stepper post-purchase | (Takealot standard) | PARTIAL — tracking timeline exists; no macro stepper | Low–Med | Low | Backlog |
| G17 | "Clear all" on recently-viewed rail | Screenshot 1 | ABSENT | Low | Trivial | Fold into UX-1 |

**Deliberate non-goals** (Takealot has them; GG should not copy — reasons):
- **Cash on Delivery** — incompatible with the funds-held protection model.
- **Charity donation checkbox** — nice-to-have, revisit post-paygate.
- **TakealotMORE free-delivery subscription economics** — GG+ perks are deliberately different (Ask GG, badges, featured discounts, raffles); GG doesn't control carrier margins the way a 1P retailer does.
- **Gift vouchers / coupons / store credit** — P8c, parked until the card paygate lands (voucher liability on a manual rail is an AML/reconciliation headache).
- **Multiple named lists** — single wishlist is right at current catalogue scale.
- **Guest checkout** — impossible: KYC, firearm attestations, funds-held all need an account.
- **Live chat** — Q&A panel + support tickets + Ask GG cover the need without staffing cost.

---

## 5. Prioritised build roadmap

Execute in order. UX-1 is one deploy; each later batch is its own commit + deploy.

| Batch | Name | Contents | Risk |
|---|---|---|---|
| **UX-1** | Conversion & trust quick wins | a: urgency chips · b: card/PDP stars · c: PDP delivery-ETA · d: PDP trust bullets · e: cart trust bullets · f: footer upgrade · g: recently-viewed Clear all | Display-only, low |
| **UX-2** | `/account` hub | Grouped-card landing from ACCOUNT_GROUPS + live counts | Low |
| **UX-3** | Address book at checkout | Saved-address picker in checkout + cart | **Money-adjacent — adversarial review** |
| **UX-4** | Added-to-cart drawer | Drawer + cross-sell rail | Low–Med |
| **UX-5** | Category mega-menu | Desktop nav flyout | Low |
| **UX-6** | Seller storefront | Filters + pagination + sort | Low |
| **UX-7** | Compare-at pricing | Schema + sell form + display + CPA guard | **Schema migration — adversarial review** |
| **UX-8** | Checkout polish | Secure framing, method cards, payment-method shell | **Checkout — adversarial review** |

---

## 6. Per-item spec blocks

### UX-1 — Conversion & trust quick wins

**UX-1a — "Only X left" urgency chip**
- Files: `frontend/components/listing-card.tsx`, `frontend/app/listings/[id]/page.tsx`.
- Behaviour: when the listing tracks inventory and `quantityAvailable` ≤ 5 (threshold constant), render a red chip "Only {n} left" on the card image (near the condition chip) and beside the PDP price. Never render at higher stock (fake urgency = CPA s41 risk). Verify the browse/card API selection already includes the quantity fields; if not, add them to the public selection — availability count is not sensitive.
- Accept: chip at qty ≤ 5 only; no layout shift; PWA + desktop.

**UX-1b — Stars + review count on cards and PDP top**
- Files: `frontend/components/listing-card.tsx`, PDP header block, and the backend browse/listing selections (seller `averageRating`/rating count are already public on `/sellers/:clerkId` — extend the listing card payload with the seller aggregate).
- Behaviour: card: one filled star + "4.5 (12)" under the seller line (seller-level rating; label the PDP one "Seller rating 4.5 · 12 reviews" and link to `/sellers/[clerkId]` — don't imply item-level reviews exist). Hide entirely when no ratings.
- Accept: no N+1 (aggregate joins the existing browse query); hidden at zero ratings.

**UX-1c — Delivery-ETA line on PDP**
- Files: PDP details column; reuse the estimated-delivery logic that powers the post-purchase window (P5.1 — find it in `backend/src/` shipping/dispatch services) via a light public endpoint or a computed field on the listing GET.
- Behaviour: for courier-shippable listings: "Estimated delivery: {window} via courier" under the price; collection-only: "Collection from seller ({province})"; firearms: "Transfer via licensed dealer — see how it works". Keep it a *range*, never a promise.
- Accept: correct branch per shippingMethod/isFirearm/collectionOnly; no extra blocking fetch (compute server-side into the listing response).

**UX-1d — PDP trust bullets**
- Files: PDP details column (new small component `frontend/components/trust-bullets.tsx` so UX-1e reuses it).
- Copy (exact, house-rule-safe): "✓ Payment held until you confirm delivery" · "✓ Every seller ID-verified" · "✓ Dispute protection on every order" · (firearm only) "✓ Legal dealer transfer handled on-platform". Each links /faq or /firearms-compliance. **Never "escrow".**
- Accept: renders under the CTA on every listing type incl. auction/experience variants; links resolve.

**UX-1e — Cart summary trust bullets** — same component under the cart summary CTA (`frontend/app/cart/page.tsx`).

**UX-1f — Footer upgrade**
- Files: `frontend/components/site-footer.tsx`.
- Add: Account column (My orders, Wishlist, Saved searches, Support, FAQ); payment row driven by a config array (today: "Secure EFT — payment held"; card logos slot in at paygate); "Get the app" install CTA (reuse the PWA install-prompt hook from the nav drawer); category text-link row (server-fetch `/categories/with-counts`, roots only).
- Accept: footer stays SSR (no client fetch waterfall — fetch in the layout/server component); mobile wrap clean.

**UX-1g — Recently-viewed "Clear all"** — button on the rail calling the existing localStorage store's clear (`useRecentlyViewed`).

**Verification (batch):** `cd frontend && npx tsc --noEmit`; dev server from `C:\dev\gun-galore\frontend` (Webpack); check PDP (normal/firearm/collection/auction), cart, footer, a card grid. Backend: `tsc --noEmit` + jest if selections changed.

### UX-2 — `/account` hub
- Files: new `frontend/app/account/page.tsx`; `frontend/lib/account-menu.tsx` (single source — render the SAME groups; add optional per-group icon/description fields); point nav account chip + More-sheet profile header at `/account`.
- Behaviour: header card (avatar, username, GG+ tier chip + period end, KYC status chip) + one card per ACCOUNT_GROUP with its links; live counts where cheap (active orders, unread notifications via the existing active-count endpoint, wishlist size from WishlistProvider). Support card links /support + /faq.
- Accept: every ACCOUNT_GROUPS link present exactly once; loads in one server fetch + existing polls; PWA More sheet still works (it keeps the flat list — the hub is additive).

### UX-3 — Address book at checkout ⚠ adversarial review
- Files: `frontend/app/checkout/[listingId]/checkout-form.tsx` (TCG block ~L1300 already has the single-address "Delivering to" chip + AddressAutocomplete capture — extend, don't rebuild), the offer-checkout variant, `frontend/app/cart/page.tsx` (TCG ManualAddressFields block). Backend: P2.3 endpoints already exist (`backend/src/users/users.controller.ts:276-301`, `Address` model `schema.prisma:3220`); add none unless a "save from checkout" hook is missing.
- Behaviour: fetch `/users/me/addresses`; **2+ saved addresses** → radio cards (Takealot pattern: label chip, recipient, first line, phone) + "Add new address" expander (the existing AddressAutocomplete + ManualAddressFields, saving to the address book, not overwriting the profile) — replacing the single-address chip. **0–1 addresses** → today's behaviour unchanged. Selection populates the same state the form already submits — **the submitted payload shape must not change.**
- Accept: zero change to the checkout POST contract; picker never blocks a first-time buyer; stale-address warning (MED-9) still fires; works on single-item, offer, and cart checkouts.
- Review lens: payload-identity (a picked address produces byte-identical order lines vs typed), no PII leak to non-owners.

### UX-4 — Added-to-cart drawer
- Files: new `frontend/components/added-to-cart-drawer.tsx`; wire where add-to-cart fires (PDP add-to-cart button; `lib/cart-store.ts` stays untouched — drawer is presentation).
- Behaviour: on add → right drawer (desktop) / bottom sheet (mobile): item thumb + title + price, cart subtotal + count, "Go to Cart" primary + "Continue shopping" dismiss, cross-sell rail from the existing `GET /listings/cross-sell` for the added listing's category (reuse the browse-page cross-sell row component). Esc/backdrop closes. Respect `prefers-reduced-motion`.
- Accept: cart store unchanged; drawer never blocks checkout paths; cross-sell excludes the added item; empty cross-sell → section hidden.

### UX-5 — Category mega-menu
- Files: `frontend/components/nav.tsx` (+ new `frontend/components/category-menu.tsx`).
- Behaviour: "Shop by Category ▾" button left of the mode links (desktop ≥ md only). Open on click AND hover-intent (150 ms); panel: left column = root categories (from `/categories/with-counts` — cache it, it's the same call the homepage curtain makes), right = hovered root's children + "View all in {root}". Full keyboard nav (arrows/Esc/Tab) + `aria-expanded`/`role="menu"`. Links → `/category/[slug]`.
- Accept: no CLS on open (overlay, not push); mobile untouched; categories with 0 listings still listed (counts shown).

### UX-6 — Seller storefront upgrade
- Files: `frontend/app/sellers/[clerkId]/page.tsx`.
- Behaviour: replace the fixed 8-grid with the standard browse assembly scoped to `sellerClerkId`: FilterBar (category/condition/price/sort — hide province, seller is one person) + 24-item grid + pagination (reuse the components from `app/page.tsx`). Reviews panel moves below on mobile, stays sticky-right on desktop. Header shows "{n} active listings".
- Accept: URL-driven filter state (shareable); backend browse already accepts `sellerClerkId` with all filters — no backend change expected; empty state kept.

### UX-7 — Compare-at pricing ⚠ schema migration + adversarial review
- Schema: `Listing.compareAtPriceZarCents Int?` — additive migration (`ADD COLUMN IF NOT EXISTS`), no backfill.
- Backend: `backend/src/listings/listings.service.ts` create/update — validate `compareAtPriceZarCents > priceZarCents` else reject; **cap displayed discount at 70%** and reject compare-at > 4× price (anti-anchoring guard, CPA s41); expose in public selections; include in the moderation payload so Claude review sees claimed originals.
- Sell form (`frontend/app/listings/new/page.tsx` + edit): optional "Original / retail price" field, helper: "Only if truthful — you're accountable for this claim (CPA s41). Shown as a strikethrough comparison."
- Display: cards + PDP: `R 3,000  ~~R 7,499~~  59% off` red chip; PDP tooltip/fine print: "Original price stated by the seller — Gun Galore does not verify it."
- Accept: migration additive + deployed with `prisma generate` before build (standing deploy rule); listings without the field render exactly as today; validation + cap tested (jest on the service); auction listings: applies to Buy-Now-price display only if present — never to bid amounts.
- Review lens: no money-path contamination — the field is display-only and must never enter fee/checkout calculations (`fee.calculator.ts` untouched).

### UX-8 — Checkout polish ⚠ adversarial review
- Files: checkout pages + a new minimal layout for the checkout route group; delivery-method UI inside `checkout-form.tsx` + cart shipping section; new `frontend/components/payment-method-section.tsx`.
- Behaviour: (1) minimal checkout chrome — logo + "Secure checkout 🔒" + Help link (keep it a *variant*, PWA tab bar still reachable via back); (2) delivery-method as option cards with icon/title/one-liner/price (Courier to door / Pudo locker / Collect from seller / Dealer transfer — render only applicable ones per listing flags); (3) payment-method section shell: today one selected card "Instant EFT — pay by bank transfer, payment held until delivery confirmed"; the paygate PR adds cards beside it (gateway-neutral seam P8e in the UI).
- Accept: zero change to submitted payloads or the EFT flow; method-cards produce the same state the form already holds; adversarial review on the full checkout diff before deploy.

---

## 7. Appendix — GG current-state maps (condensed, verified 2026-07-05)

### A. Shopper journey
- **Homepage** `frontend/app/page.tsx`: hero → category tile curtain (all roots, counts, `/categories/with-counts`) → featured marquee (`/featured/listings`) → recently-viewed rail (localStorage, hides <2) → filtered browse grid (24/page, FilterBar, cross-sell row, save-search).
- **Nav** `frontend/components/nav.tsx`: sticky; logo · 5 flat mode links · Ask GG · LiveSearch (autocomplete) · Sell CTA · bell · cart · account chip dropdown. Mobile drawer: search/shop/install/assistant/account. **No category menu.**
- **PWA tab bar** `frontend/components/bottom-tab-bar.tsx`: Shop sheet · Alerts · Sell FAB · Ask GG · More sheet (full ACCOUNT_GROUPS). Standalone-mode only; auto-hides on scroll.
- **Browse**: FilterBar = category, condition, province, brand facet (counts), price min/max, sort, per-category attribute filters (`attrs` JSON param); facets endpoint AND-consistent. No grid/list toggle.
- **Category** `frontend/app/category/[slug]/page.tsx`: breadcrumb, child chips, sold-comps strip (P5.6), 24-grid.
- **PDP** `frontend/app/listings/[id]/page.tsx`: gallery + lightbox; ref badge; category/condition/attestation chips; price (mode-dependent panels: Auction/Offer/Swap/Experience); stock text if trackInventory; seller card (username, badges, rating, sales, join); wishlist heart; share; report; spec rows from category attribute defs; Q&A panel; recently-viewed rail; Product JSON-LD. No ETA, no urgency chip, no trust bullets, no reviews section.
- **Seller store** `frontend/app/sellers/[clerkId]/page.tsx`: profile header + fixed 8 listings + latest-10 reviews panel. No filters/pagination.
- **Cart** `frontend/app/cart/page.tsx` (Zustand `lib/cart-store.ts`): multi-seller groups, qty stepper, remove, move-to-wishlist; shippable vs firearm vs collection split; PUDO LockerPicker / TCG ManualAddressFields; firearm route pickers + attestations; sticky summary; gates on completeness → `POST /orders/checkout` → ManualEftInstructions.
- **Checkout** `frontend/app/checkout/[listingId]` + offer variant: CheckoutForm (method, address manual, firearm consent, attestations for experiences) + sticky listing summary; auction winner reuses at winning bid. Address: AddressAutocomplete + single profile-address chip wired; P2.3 multi-address book backend exists but is unreferenced by checkout/cart.
- **Footer** `frontend/components/site-footer.tsx`: brand, Shop links, Legal links, ECT §43 block. No account links / payment logos / app badges / category row.
- **Account**: no landing; `frontend/lib/account-menu.tsx` ACCOUNT_GROUPS = Buying (Orders, Offers made, Bids, Wishlist, Saved searches) / Selling (Listings, Sales, Offers received) / Competitions (Tickets, Wins) / Account (Dashboard, Profile, Settings, Notifications).

### B. Post-purchase, trust, engagement
- **Transaction detail** `frontend/app/transactions/[id]/page.tsx` is the post-purchase centre: role-aware payment sidebar (HELD/RELEASED/DISPUTED/REFUNDED + breakdown), shipping status + carrier-linked tracking + timeline, estimated-delivery window, PoD, accept/dispatch countdowns, confirm-delivery + dispute escape, rating widget (5-star + comment, seller-level, RELEASED-gated), receipt download ("not a tax invoice"), SAPS 534 download + dealer-verification flow, collection/PA contact-reveal, experience panel.
- **Orders**: `/my/orders` card list (thumb, status pill); `/orders/[id]` multi-item breakdown. No stepper, no reorder, no list filters.
- **Reviews**: seller-level only; captured post-release; shown on seller page (avg + latest 10). Not on cards/PDP; no histogram.
- **Wishlist**: single list; live items + terminal tombstones; heart on cards via WishlistProvider. Saved searches with notify toggle. Price-drop: backend throttle field only, no UI.
- **Vouchers/credit**: nothing user-facing (P8c parked).
- **GG+** `/subscribe`: MEMBER/PRO prepaid-EFT (SB refs, stacking, no auto-renew); perks = Ask GG limits, photo-ID, ballistics/Load Lab, badges, featured-bid discounts (25/50%), weekly subscriber raffles.
- **Notifications**: 3-tab centre (BUYER/SELLER/ACCOUNT), active/resolved, entity-resolve; push opt-in banner; bell polls active-count 60 s.
- **Trust**: tier pills (NEW→DEALER), GG+/Verified-expert/ID badges, funds-held copy on FAQ + transaction chips, ReportButton (product/seller), Claude-moderated Q&A.
- **Help**: `/faq` (10 Q&As + JSON-LD), `/support` tickets + threads, `/how-selling-works`, Ask GG.
- **Promos**: featured-slot auctions only. **No RRP field, no % off, no stock-urgency chips, no deals surfaces.**
- **Invoices**: transaction receipt (buyer) + SAPS 534 (seller). No order-level invoice, no tax invoice.

---

*Report generated 2026-07-05. GG codebase refs current as of branch `feat/hunt-ballistics-range-estimator` (post-Experiences-module deploy). If executing months later, re-verify Section 7 file paths before large batches.*
