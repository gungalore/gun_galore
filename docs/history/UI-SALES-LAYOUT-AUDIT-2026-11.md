# Sales-side layout audit — bulk, clutter and order of importance (2026-11-24)

**Operator:** *"audit Bulk, Clutter and order of importance. […] the order of the button and option are wrong. Buy option should be first, next should be important information like the delivery methods (they are bulky. I feel they can be slimmed down a lot by putting them in one box and removing the descriptions.) Check what other marketplaces and stores do like Takealot, eBay and Amazon and implement a plan. Do this for the whole sales side of the website."* (example: the Turret Tags listing page, dark theme, phone).

**Status: Phase 1 (listing detail / buy box) implemented and deployed `90097ae1`
(frontend-only), rollback `alloutdoor-20261124-225440.dump`; Phases 2–4 specified
below.** Companion: [UI-CONTRAST-AUDIT-2026-11.md](UI-CONTRAST-AUDIT-2026-11.md),
[UI-ACTION-HIERARCHY-AUDIT-2026-11.md](UI-ACTION-HIERARCHY-AUDIT-2026-11.md).

---

## 1. What the industry does

**Amazon — the Buy Box is the page.** On desktop the buy panel sits on the right
with price, seller, delivery estimate and Add to Cart / Buy Now; on mobile the
buy box is most of the first screen, and the delivery promise is postcode-aware.
The documented failure mode to avoid is Amazon's own mobile PDP, where the title
sits below the image and the buy box requires scrolling past bullets. —
[Buy Box structure](https://amalyze.com/resources/guides/listing/amazon-listing-pdp-buy-box),
[Buy Box explained](https://sentrykit.com/blog/all-about-amazon-buy-box/),
[PDP above-the-fold framework](https://www.goaspi.com/blog/amazon-product-detail-page-above-the-fold-optimization/)

**eBay — a single grey buy box beside the photo** holds price, Buy It Now / Place
bid, shipping, delivery estimate, returns and payment, with the seller panel
alongside it; everything else (description, Q&A, item specifics) sits below. —
[eBay item-page order (title → condition → price → buy → shipping → delivery →
returns → seller)](https://www.amz123.com/ask/FEsvF6S2),
[layout description](https://www.ecommercebytes.com/2013/11/01/ebay-tests-new-listing-page-layout-wheres-seller/)

**Takealot — the Buy Box is a ranked offer block.** It leads with the fastest
delivery (with a delivery-advantage label) and shows the cheaper offer below; the
delivery comparison is part of the buy decision, not a details page. —
[MyBroadband on Takealot's Buy Box](https://mybroadband.co.za/news/business/665501-takealot-gives-south-african-sellers-an-edge-against-the-chinese.html),
[delivery-first Buy Box report](https://geekhub.co.za/2026/09/09/takealot-fastest-delivery-higher-price-same-delivery-time/)

**Baymard / CRO benchmarks** (2026): 62% of mobile product pages are rated
mediocre or worse. The buy box should hold title, price, rating, variants, add to
cart **and delivery/returns next to the button**; 60% of users look for the return
policy on the PDP while 67% of sites give no total-cost estimate near the buy
section; recommendations must never push the buy box down. —
[PDP design guide with the Baymard figures](https://www.getglued.co/insights/product-page-optimization)

**The rule this audit adopts:** the order of a product page is *buy → cost &
delivery → trust → evidence → admin*. Bulk below the buy box is fine; bulk
between the price and the buy button is the bug.

---

## 2. What the listing page did wrong (before)

Measured from the live page (`frontend/app/listings/[id]/page.tsx`, phone
column order as rendered below 1024px — gallery, then buy column, then the
reading column):

1. **Purchase column opened with admin, not the product.** Reference number
   (`UM000009`), "Listed 21 Oct", then three tags, *then* the title, rating and
   price. A buyer's first line was a support reference.
2. **Delivery was bulky and sat between price and Buy.** Two full cards
   (`Courier delivery` + a full sentence, `Meet in person` + a full sentence),
   plus a separate transfer/collection sentence above them and
   "Choose one of these at checkout" below. ~180px of prose before the buy
   button on a phone. This is exactly what the operator flagged.
3. **The Buy button came after all of it**, and on the operator's own listing
   the only thing in the buy slot was a disabled grey `Your Marketplace
   listing` block — which reads as a broken Buy button.
4. **Duplicated seller controls.** The same Edit/Cancel controls rendered at the
   bottom of the column and the sticky bar showed a disabled "Your listing".
5. **Q&A was always expanded**, including the private composer's textarea and
   help copy, before the seller/location card.
6. **Location was two sparse paragraphs** (province, then distance) with a gap
   each; the firearm dealer box repeated its own explanation; the "seller
   attests" badge used a raw green literal.
7. **Low-value metadata was interleaved with trust signals**: live wishlist
   stats and the Report button sat between the Q&A and the seller card.

## 3. Shipped: new listing buy-box order (Phase 1)

Phone column order below 1024px (desktop keeps the two-pane side column; the
left pane still owns description + specifications):

1. **Title** (first thing in the buy column)
2. Seller rating (if any)
3. Compact badges (dealer transfer, category, condition, collection-only,
   tested/working, listing type)
4. Seller-only moderation banner (self-hides)
5. **Price** + Platform Fee note, % off and urgency in the same row
6. **Buy box** — `Buy on Marketplace — R…` (T1), `Add to cart` (T2), or the
   auction/offer panel; on your **own** listing the slot is now
   **Edit listing (primary) + Cancel listing**, not a disabled button
7. One-line trust note: "Secure checkout — payment is held until you confirm receipt."
8. **Delivery & handover — one box, three rows, zero descriptions**
   (`Courier delivery — 2–10 business days · rate at checkout`,
   `Meet in person — arrange with the seller`; firearms show
   `Dealer transfer — licensed dealer to dealer` + `Arrange privately`, with a
   single "How it works" link; collection rows only invite a transporter when
   the dangerous-goods rule allows it). Footer: "Chosen at checkout."
9. `Rather make an offer?` (secondary; skipped for Take-a-Shot/auction where it
   is the primary)
10. **Questions & answers** — public answers stay visible (anchor rule), the
    private composer is behind an `Ask the seller a question` disclosure
11. **Location, one line** — province · distance (single row)
12. Firearm planned dealer-stock row (no explanatory subline)
13. **Seller card** (avatar, username, badges, sales, tier) — border raised to
    the visible control edge
14. Live wishlist stat (only when non-zero)
15. Reference number + listed date (support metadata at the foot)
16. Report button (last)

Own-listing specifics: sticky mobile bar now shows **Edit listing** instead of
a disabled "Your listing"; the duplicate bottom seller-controls block is gone.

### Files

- [page.tsx](../../frontend/app/listings/[id]/page.tsx) — column order, owner
  slot, trust line, one-line location, reference moved to foot, dealer/dealer
  box trimmed, seller card edge.
- [listing-delivery-summary.tsx](../../frontend/components/listing-delivery-summary.tsx)
  — new compact delivery box (+ spec).
- [listing-faq.tsx](../../frontend/components/listing-faq.tsx) — composer behind
  `<details>`; answers/anchors unchanged.
- [listing-distance.tsx](../../frontend/components/listing-distance.tsx) —
  renders inline for the combined location line.
- [seller-controls.tsx](../../frontend/app/listings/[id]/seller-controls.tsx) —
  `inline` mode for the buy slot (Edit becomes the primary action).

Unchanged deliberately: the sticky mobile buy bar logic, the `#buy-panel`
anchor contract, the `#faq-<id>` anchors, every marketplace/auction/offer
submit path, the two-pane desktop geometry, and the description/spec reading
column.

---

## 4. The rest of the sales side — audit + plan

### Cart (`frontend/app/cart/page.tsx`)

Current order: items (with per-line actions) → **Delivery** section (address
picker + manual address fields first, then one courier-option picker per parcel)
→ totals ("Delivery is one figure…" explanation) → `Continue to payment`.

Findings:
- The delivery block is **always expanded**: saved-address picker, manual
  address form, and per-parcel option cards all at once. A 3-item cart shows
  ~4 pickers before the total.
- Explanatory prose in the summary ("Delivery is one figure — nothing is added
  on top…") repeats what the figure shows.
- No mobile sticky total/CTA; the Continue button is below a long picker stack.

**Phase 2 in progress (2026-11-24):** the checkout-side compaction shipped with the interrupted-payment recovery (compact one-line reservation clock, one-line fee explainer, delivery method card padding, redundant copy removed); the cart collapse is still to do. **Phase 2 plan (cart):** collapse delivery into a summary row — `Deliver to: {address}
· Change` — that opens the pickers only on demand; show the chosen rate per
parcel as a single line; keep the total + Continue visible (sticky on phones);
delete the summary prose. Target: cart above-the-fold = items + total + Continue;
delivery details one tap away.

### Checkout (`frontend/app/checkout/[listingId]/checkout-form.tsx`)

Current order: listing summary → delivery method cards → address capture →
delivery option cards → payment method → `Pay R…` / order summary.

Findings: three stacked card systems (method, address, delivery option) before
payment; address capture re-expands even when a saved address exists; payment
rail is the last of four blocks.

**Phase 2 plan:** order = **order summary (what + total) → delivery (method +
address + option in one bordered block) → payment → Pay**; collapse the address
block to the default address with `Change`; keep the total and Pay CTA together;
error states stay at the top of the block they belong to.

### Sell flow (`frontend/app/listings/new/page.tsx`)

Four wizard steps (`Photos`, `About this item`, `How are you selling?`,
`Delivery & address`). The step rail is already compact; the bulk is long forms
and help copy inside each step.

**Phase 3 plan:** progress + sticky footer CTA (`Continue`/`Preview`) so the
action never scrolls away; keep optional fields collapsed; move validation
errors into a single summary at the top of the step; photo step stays first
(already the strongest step). Seller-side actions (Preview/Publish) already T1.

### Offers & auctions (`offer-panel.tsx`, `auction-panel.tsx`)

Already hierarchical: one primary (Submit/Accept/Place Bid), secondary "Take a
Shot" entry, bid modal. No order change needed; Phase 4 only removes the
remaining long explanatory copy inside the bid modal and keeps the current
stacking.

### My listings / dashboard

Out of the *buying* path; Phase 4: consistent card density and the same
"one primary per card" rule.

### Order-of-importance standard (applies to every sales surface)

1. What the buyer is buying (title, image).
2. What it costs all-in (price, fee, delivery estimate).
3. The action (one T1: Buy / Pay / Place bid / Submit offer / Publish).
4. How it arrives and what protects them (compact delivery rows, held payment).
5. Trust (seller, rating, verification, stats).
6. Evidence and questions (description, specs, Q&A).
7. Admin/reference (reference number, report, timestamps).

Anything in category 7 may not appear above category 3. Bulk that is genuinely
needed (specs, description) lives below the buy box or behind a disclosure.

---

## 5. Verification (Phase 1)

- `npm run typecheck` clean; focused specs for the new delivery summary (4) and
  Q&A (7) pass; full frontend suite 186 files / 2,088 tests pass; production
  build + theme-sync gate clean; deployed frontend-only and smoke-tested.
- Edge cases checked in code: firearm/collection/dealer rows, dangerous-goods
  collection copy, own-listing controls, auction (delivery box under the bid
  panel), Take-a-Shot primary offer, payment-pending banner, sold-out state,
  `#buy-panel` and `#faq-<id>` anchors, sticky bar overlay rules.

---

## 6. Shipped: phases 2–4 (2026-11-25)

### Cart (phase 2 remainder)

- Delivery is now a **compact block**: a header row (`Delivery` · destination ·
  **Hide/Change**) and, when collapsed, **one line per parcel**
  (`{seller} · {option.label} — {price}`, or "Choose a delivery option"). It
  opens by default, auto-collapses **once** when a saved address was picked and
  every parcel is priced, and re-opens on any address change. The saved-address
  picker, manual fields, quote state and checkout payload are untouched.
- The totals prose ("Delivery is one figure — nothing is added on top…") and
  the old "Where should we deliver?" paragraph are gone.
- **Mobile sticky total + Continue bar** (`lg:hidden`, `/cart` is a push route
  so it sits flush with safe-area padding); the CTA label/disabled state is
  shared with the unchanged desktop sidebar so both always agree.
- Files: [cart/page.tsx](../../frontend/app/cart/page.tsx).

### Sell wizard (phase 3)

- **Sticky action footer**: Back/Continue (and the final step's Preview/Publish
  block) stay visible while a step scrolls. Solid page background, hairline top
  border, z-index below modals; `/listings/new` is a push route so no tab-bar
  offset. Complete-grey → T1-red logic and every handler unchanged.
- Compacted the step header/page spacing and the amber "still needed" list;
  five verbose helper paragraphs trimmed (tidied-wording notice, specifications,
  collection-only and courier step descriptions, pickup hint) with all required
  warnings/validation copy kept verbatim.
- Files: [wizard-footer.tsx](../../frontend/components/wizard-footer.tsx),
  [listings/new/page.tsx](../../frontend/app/listings/new/page.tsx).

### Offers / auctions / listings (phase 4) and the quiet-button finish

- Auction bid help trimmed to one compact line (Place Bid = one exact amount;
  Auto Bid = private maximum, kept in front).
- The remaining honour-quiet button boundaries from the contrast audit were
  finished: **52 controls across 42 files** whose only edge was a 0.5px
  `--border` hairline now use the visible `--border-visible` control edge
  (share, questions, load-more, remove/renew, dispatch secondaries, sheets,
  nav rows, feed controls). Dismiss/close/cancel controls stay deliberately
  quiet.
- My-listings is already the compact 2-column card grid introduced in the
  earlier sales audits, so no density change was needed there.
