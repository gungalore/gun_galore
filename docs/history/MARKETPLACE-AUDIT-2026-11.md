# Marketplace audit (2026-11-25/26) — findings and resolution

Companion to [`AUCTIONS-AUDIT-2026-11.md`](AUCTIONS-AUDIT-2026-11.md). The operator asked for the
auctions to be fixed, then the **marketplace** audited and fixed. Three read-only sub-audits covered
(a) listings/search/sell/moderation, (b) offers/cart/checkout/payments/orders/shipping, (c) the
gate/session, notifications, admin, security and PWA layers. Every reported finding was re-checked by
the lead before a fix, and **all confirmed findings below were fixed in the same deploy as the auction
fixes** (2026-11-26, full deploy). Production data was not modified.

## Critical / High

| # | Finding | Resolution |
|---|---|---|
| 1 | `GET /wishlist` returned **every scalar column of the Listing row** (firearm serial, licence holder's real name, seller's private address/coords, hidden reserve/auto-accept) because `list()` used `include` with no `select`; `POST /wishlist/:id` accepted DRAFT/PENDING_REVIEW/CANCELLED ids, so it was a hidden-listing oracle too. | `wishlist.service.ts` now selects `PUBLIC_LISTING_SELECT` (the same PDP allow-list), saves only `PUBLICLY_VISIBLE_STATUSES` and returns the same 404 as a missing row for hidden ids. |
| 2 | **Service worker cached private HTML**: `defaultCache`'s same-origin NetworkFirst rule swallowed document navigations, so `/account`, `/my/orders`, `/transactions/<id>`, `/messages`, `/notifications`, `/documents`, `/cart` HTML could be served from cache after sign-out on a shared device. | `lib/sw-caching.ts` (pure, tested) wraps every `defaultCache` matcher so a navigation or any member-only route can never be cached; first runtime rule is NetworkOnly for documents/private paths; sign-out purges the private caches. |
| 3 | Accepted-offer "pay now" SMS/email links carried **no credential**; a signed-out buyer was bounced to sign-in and could then be struck for non-payment. | The offer accept/counter-accept/pay-reminder paths mint a CHECKOUT action token targeting the offer; `/a/<token>` redirects to `/checkout/offer/<id>?t=`, and the page reads its offer+listing through `GET /actions/:token/offer-checkout`. |
| 4 | Winner/loser auction notification links pointed at `/listings/<id>`, which 404s an EXPIRED listing — every "auction ended" link was dead (covered in the auctions audit). | New `/listings/<id>/result` page reads the public auction-state endpoint (which serves EXPIRED/CANCELLED); notifications link there. |

## Medium

- **`/listings/:id/edit-lock` was unguarded** — unauthenticated existence oracle for hidden listings plus live offer state. Now `OptionalAuthGuard + ContentAccessGuard` + owner-only; non-owners get the generic "not found" body. Frontend probes send the token.
- **Complaint status notifications had no member destination** (`/complaints` is the public procedure page). New `/account/complaints` (member-only) lists the caller's complaints from `GET /complaints/mine`; notification module + account menu + closure-blocker href all point there.
- **Admin had no listing takedown or bulk-review UI** although the audited, notification-sending backend endpoints existed. Operate page now has per-row/row-drawer take-down (reason required) and bulk Approve/Reject; admin API client extended.
- **Public valuation capture** had no per-route throttle on three token routes accepting 10 MB photos; **public shipping quote/delivery-options** were unthrottled paid Bob Go proxies. Explicit per-IP throttles added.
- **`raiseDispute` was non-atomic** and could relabel a RELEASED transaction DISPUTED (stalling payout). Now a CAS on `paymentStatus: 'HELD', paidAt != null`.
- **Orphan-reservation reclaim could resurrect a CANCELLED/EXPIRED tracked listing** (`listing.update({where:{id}})` with no status guard). Now `updateMany({ id, status: 'ACTIVE' })` with a warning when the stock cannot be restored.
- **Fee-parity build gate compared constants, not the calculation.** Added `fee.calculator.spec.ts` pinning bands, rounding, floors and the auction 5/5 split so an algorithm-only change cannot desync the charged total from the preview.

## Low (all fixed)

Offer `counter()` missing the listing-still-ACTIVE check; `accept()` ignoring an expired-but-unswept
offer; 90-day stale sweep expiring a listing with a live accepted offer/checkout hold; the COUNTED buyer
getting no expiry warning; bulk-review bad input returning 500; `/listings/<id>/edit` classified content
(lost sign-in return path); `/v/<token>` missing from the gate-exempt credential links; `/my/offers`
empty state linking the retired TAKE_A_SHOT type; stale "Clerk/Stitch" comments in checkout code;
complaint-status module/url mapping (see above); a DTO comment claiming a firearm checkout gate that no
longer exists.

## Checked and found sound (not re-reported)

Offer IDOR + offer→listing→buyer price binding; double-sell CAS on accept/reserve/tracked stock; atomic
hold claim/delete; resume/abandon double-charge gates; rail locking on refunds/payouts; webhook
signature + provider-status re-check; no double refund; firearm routing at checkout; offers
unconditional by product decision; photoless listings swept within an hour; reject-never-publishes;
firearm/ammo/collection/DG gates server-side; gate mechanics (audience-separated declaration, no UA
branching, 404 on hidden rows, no-store viewer fetches); SEO/PWA invariants (robots, no sitemap,
neutral gate copy, no skipWaiting); token handling and cookie flags.

## Not a defect (flagged for the operator)

Cart checkout is deliberately off (`CART_CHECKOUT_LIVE` false) and has no paygate wiring — do not flip
it without finishing the payment path. `config/cart` routes return the coming-soon state by design.
