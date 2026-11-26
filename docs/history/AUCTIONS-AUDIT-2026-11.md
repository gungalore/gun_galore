# Auctions — audit (2026-11-25)

**Scope:** the auction product end to end — bidding engine, close/relist lifecycle, unpaid-win
enforcement, money/checkout, frontend surfaces (PDP panel, SMS token pages, My Bids, sell/cancel),
notifications, admin, gates, search, tests — plus the live production data and HTTP behaviour.

**Method:** code read at `09a492b6` (branch `feat/takealot-ux-parity`) by four passes (this session and
three read-only sub-audits, cross-checked line by line by the lead); read-only production DB queries
over `ssh alloutdoor`; unauthenticated live HTTP probes through Cloudflare. **No files were changed,
nothing was deployed, no tests were altered.** The only commands run locally were read-only
(`rg`, `git log`, targeted Jest specs).

**Baseline checks:** `auctions.service.spec.ts`, `automation-reminders.spec.ts`,
`content-visibility.spec.ts` — 68/68 pass (jest writes to stderr; the PowerShell exit 1 is noise).

---

## 0. Production reality (read this first)

The live database has **no auction activity at all**:

| table | rows |
|---|---|
| `Listing` (all types) | 17 — 4 BUY_NOW ACTIVE, 10 CANCELLED, 2 SOLD, **1 AUCTION EXPIRED** |
| `Bid` | **0** (ever) |
| `Offer` | 0 |
| `User` | 7 |
| `Transaction` | 3 |

- The one auction ever created was "Inca Premium Junior Mummy Sleeping Bag | Trekking Green"
  (3 days, no reserve), which got **0 bids** and was finalised **37 seconds** after `endTime`
  (2026-10-28 19:32:23 → endedAt 19:33:00). `cron:lastrun:auction-end` is current, so the every-minute
  close cron is alive.
- Conclusion: the auction engine has never carried a bid, a winner, a payment or a strike. Everything
  below is code-level (and several defects are only findable that way), and the feature should be
  **rehearsed with two real accounts before a campaign leans on it** — the same warning HANDOFF
  recorded on 2026-11-06 is still unaddressed.
- No data rows are in the stuck/“zombie” states below; the defects are latent.

---

## 1. Findings by severity

### HIGH

#### H1 — The 18+ gate broke the auction winner's SMS/email pay link

`/a/<CHECKOUT token>` (minted by `notifyAuctionWon`, `auctions.service.ts:1579-1601`) redirects to
`/checkout/<listingId>?t=<token>` (`action-tokens.controller.ts:~858-895`; `app/a/[token]/page.tsx:134-155`).
Middleware deliberately lets that URL through both walls because "the token is the credential"
(`frontend/middleware.ts:174-187`). But the checkout page then fetches the listing with the plain
`apiFetch` and forwards **only the member session token** (`frontend/app/checkout/[listingId]/page.tsx:40-46`),
not the `ao_cat` cookie and not the action token. `GET /listings/:id` is behind
`OptionalAuthGuard + ContentAccessGuard` (`listings.controller.ts:262-266`), and a server-side fetch
carries no cookie jar → 404 → `notFound()`.

Live proof (no cookies, through Cloudflare):

- `/checkout/cmww67jbj001fopvnlnv60ewx?t=test` → HTTP 200 streaming but the body is the “404 — Page
  not found” route, **byte-identical in visible terms to `/checkout/thislistingdoesnotexist?t=test`**;
  the stream contains Next's `NEXT_HTTP_ERROR_FALLBACK` marker.
- The same URL without `?t=` → 307 to `/sign-in?redirect_url=…` (middleware behaves as designed).
- `/api/listings/<id>` anonymous → 404; `/listings/<id>` → 307 to `/gate`.

Impact: a winner who opens the "You WON — pay within 24h" link on a browser without their session
(the normal SMS case) gets a 404 instead of checkout. After 24h `sweepUnpaidWins` expires the sale
**and records a non-payment strike**; the seller loses the sale. It works only when the winner is
already signed in on that device (in-app `/my/bids` and the PDP CTA use the session).

Fix direction: make the listing read on that page token-aware — either a `viewerFetchForActionToken`
that forwards `?t=` to a backend-accepted header for the token's **target listing only** (extend
`ContentAccessGuard`), or have the backend serve the checkout projection from the already-resolved
`/actions/:token` payload. Using `viewerFetch` alone is not enough: a fresh SMS browser has no
`ao_cat` either.

#### H2 — A proxy maximum above the reserve never “meets” the reserve, so reserve auctions can expire unsold

`reserveMet` is computed only from the **visible** bid (`auctions.service.ts:623-624`), and a proxy bid
only advances the visible price by an increment over the previous ceiling — the first bid opens at the
starting bid (`auctions.service.ts:595-601, 609-615`). The bidder's private `maxAmount` is never compared
with the reserve.

Worked example (all values reachable through the published sell rules): reserve R10,000 → derived
starting bid R7,000. A lone buyer sets Auto Bid max R12,000. Visible bid stays R7,000, `reserveMet`
stays false, and at close the auction is EXPIRED as “reserve not met” (`:946-958`) — **no sale even
though the bidder was willing to pay above the reserve**. With two bidders (max R12,000 and R9,000) the
visible duel tops out around R9,250 and it still expires. Only a one-shot "Place Bid" above the reserve
(which raises the visible bid to the typed amount) can meet it.

Standard proxy-auction semantics: if the highest max ≥ reserve, lift the visible bid to the reserve and
mark reserve met. Current docs match the code (`project-reference.md:932-937`) — so this is a
**product decision with a clear commercial bug shape**; it needs an explicit call, not a silent carry-over.
The existing spec only covers “visible bid clears the reserve” (`auctions.service.spec.ts:295-309`), which
is why the single-bidder case is untested.

#### H3 — A lapsed unpaid win's retry can resurrect an ended auction as an ACTIVE zombie

The only release path that was not written for auctions: `releaseLapsedUnpaidAttempt` flips
`PAYMENT_PENDING → ACTIVE` with no auction branch (`transactions.service.ts:2653-2658`), and it is
reached when the winner re-attempts checkout after their window lapses
(`assertNoLiveUnpaidAttempt`, `:2470-2492`; also the `abandon` route, `:2499-2549`). The subsequent
auction gate then rejects with 400 (`:389-407`) **after** the destructive write.

Resulting row: `status=ACTIVE`, `endedAt` set, `expiresAt` null. Every healing sweep misses it —
`endStale` needs `endedAt null` (`auctions.service.ts:830-849`), `sweepUnpaidWins` needs
`PAYMENT_PENDING` + non-null `expiresAt` (`:1088-1099`), checkout needs `PAYMENT_PENDING`. The auction
is now a public-but-unbuyable, unfinalisable “live” auction: **sale lost, no EXPIRED, no strike, no
runner-up invite, no seller notice** — the non-payment loop bypasses itself. The window is the gap
between the attempt deadline and the 10-minute `reconcileStaleGatewayCheckouts` cron (longer when the
provider status is unknown). Fix: keep the auction on its lifecycle — set `expiresAt` into the past and
leave `PAYMENT_PENDING` (exactly what the reconcile cron does, `:6935-6942`) or expire it explicitly;
never `ACTIVE`. Add a spec for the auction branch of the release helper.

#### H4 — Sellers can cancel a live auction with bids; bidders are silent; three UI surfaces promise consequences that do not exist

`listings.service.ts:3879-3924` guards `PAYMENT_PENDING`/`SOLD` and live money, but **not `bidCount`**
(unlike the edit lock at `:4763-4771`, and unlike account closure, which is blocked because a
bid-bearing auction “cannot be cancelled”, `account-closure.service.ts:253-268`). The cancel write
carries no bid/leader predicate (`:3906-3912`), so a bid committing in the race is cancelled out from
under the bidder. `cancel()` sets no `endedAt`, sends no bidder/watchlist notification and resolves no
inbox rows — and `CANCELLED` is not in `AUCTION_PUBLIC_STATUSES` (`auctions.service.ts:37`), so the
auction endpoint starts 404ing immediately.

The seller UI asserts the opposite:

- “All bidders will be notified and any holds released. Cancelling an auction with bids hurts your
  seller trust score.” (`my/listings/cancel-button.tsx:139-157`)
- “cancelling will refund all bidders” (`listings/[id]/seller-controls.tsx:112`)
- “all bids will be refunded” (`listings/[id]/edit/page.tsx:691`)

None of the three is true (auction bids move no money, there is no refund to make, no trust-score write,
no notification). Bidders' non-dismissible `bid_outbid` rows never resolve, because
`resolveAndNotifyLosers` only runs from `finalizeAuction`. `/my/bids` then shows the row as
**“Active”** because the card's pill is derived from `endedAt`/`isWinner`, not `listingStatus`
(`my/bids/page.tsx:299-357`).

Fix: block cancel when `bidCount > 0` (consistent with edit lock) **or** implement bidder fan-out,
`endedAt`, and a standing consequence — and delete the false copy either way.

#### H5 — Accepting a Take-a-Shot offer can end a running auction below a standing proxy max, in the final seconds, silently

Offers are on every ACTIVE listing (`offers.service.ts:104-127`); the only auction constraint is
`offerAmount >= (currentBid ?? price)`, which never consults the leader's stored `maxAmount`. On accept,
the auction is force-promoted to `PAYMENT_PENDING` with `endedAt`, the offer buyer as `currentBidderId`,
`reserveMet: true`, a synthetic winning Bid row and a 24h window
(`offers.service.ts:934-970`), guarded only by `status ACTIVE`, `endedAt null`, `endTime > now`,
`currentBid <= amount`.

So: leader at visible R5,000 with a R10,000 proxy; second user offers R5,100; seller accepts in the
closing seconds → the auction ends at R5,100 and the R10,000 proxy is never exercised. Anti-snipe only
extends on **bids** (`auctions.service.ts:617-621`), so the offer is not bounded by it. No bidder is
notified, no loser fan-out runs (that exists only in `finalizeAuction`,
`auctions.service.ts:981-1014, 1039-1077`), and the losers' `bid_outbid` rows stay open.

Fix: on an auction with bids, require the offer to beat the leader's stored max (or block offers while
bids exist, or route the close through the normal finalisation so losers are notified), and always run
the loser fan-out when an auction ends off the bid path. Product decision needed.

---

### MEDIUM

#### M1 — Auction fields can be PATCHed with none of the creation rules applied
`update()` locks only on live money/bids/offers (`listings.service.ts:4748-4798`) and spreads the raw
DTO into Prisma (`:3592-3611, 3772-3775`); `UpdateListingDto` is `PartialType(CreateListingDto)`.
Create-only rules therefore never re-run (`:1734-1780`): the reserve→starting-bid 70% derivation, the
`AUCTION_MIN_VALUE_CENTS` duration floor, and the `buyNowPrice` rejection. A 14-day auction (floor
R10,000) can be edited down to a R1 starting bid before its first bid, `reservePrice` can be changed
without touching `price`, `buyNowPrice` can be reintroduced (a dead field with no buyer path), and
`durationDays` can be changed while `endTime` stays put (then admin approval restarts the clock from
`durationDays`, `admin.service.ts:448-455`). Fix: add an AUCTION branch to `update()` mirroring the
create validation; reject the retired/derived fields outright.

#### M2 — The “hidden” reserve is derivable from the public starting bid
Create enforces `starting bid = floor(reserve × 0.7)` (`listings.service.ts:1760-1766`) and the 70%
rule is published (sell form and Terms). The starting bid is public (`auctions.service.ts:207-222`) with
`hasReserve`, so `reserve ≈ ceil(startingBid / 0.7)`: a R7,000 starting bid means a R10,000/R10,001
reserve. The module's own contract says the reserve amount is never shown, and HANDOFF has this as an
open product decision (2026-11-06 item 3, “opens the auction suppressing bids, and half publishes the
reserve”). Decide: keep the 70% rule and stop advertising it as hidden, or change the derivation.

#### M3 — EXPIRED outcomes are unreachable pages and every “auction ended” notification link 404s
`PUBLICLY_VISIBLE_STATUSES` excludes EXPIRED (`listing-visibility.ts:9-19`), so a fresh PDP load 404s
for a non-owner — yet the auction panel contains a whole EXPIRED outcome branch (reserve not met /
winner never paid / no bids; `auction-panel.tsx:893-919`) that therefore never renders on a fresh load.
The notifications we send link to exactly that URL: loser notice (`notifications.service.ts:3276-3301`),
winner-lapsed (`:3306-3339`), plus their inbox rows. So bidders who lose a reserve-not-met or
unpaid-winner auction tap “View listing” and get the generic 404, never the explanation. Fix: a public
ended-auction view (server-side the state endpoint already serves EXPIRED — only the PDP gate blocks it)
and keep notification links pointing at it.

#### M4 — Auction close side effects are fire-and-forget after the terminal CAS
`finalizeAuction` and `sweepUnpaidWins` commit the status flip, then fire
`notify…`, `strikeUnpaidWinner`, `notifyWinnerLapsed`, `inviteRunnerUpOffer` as un-awaited `void` calls
(`auctions.service.ts:970-1014, 1130-1152`). Each has an internal try/catch, but a process death or DB
failure after the CAS loses the side effect permanently: the row is no longer selected by the sweep, so
there is no retry. The strike is the only enforcement on non-payers; the seller/notice and runner-up
invite are the recovery. Add an outbox/retry or await-and-retry idempotently.

#### M5 — `auctionStrikes` is a one-way ratchet with no admin clear path, and an alert that says “review” for an automatic suspension
`placeBid` and offer submit both refuse at `>= 3` (`auctions.service.ts:397-399`, `offers.service.ts:91-93`);
the only increments are `strikeUnpaidWinner` (`:1428-1452`) and `strikeUnpaidOfferBuyer`
(`offers.service.ts:1099-1126`), and the only other writes are account-closure restore. The admin API
can list/remove **seller reject** strikes (`admin.controller.ts:730-761`) but has no way to clear an
auction strike; the dossier displays the count (`people/[id]/page.tsx:322`) with no action. The alert
copy says “review for bidding suspension” and the alert reconciler expects `auctionStrikes === 0` to
clear (`admin-alert-reconciler.service.ts:180-184`), but the suspension is already automatic and can
only be undone in SQL. Also one of the two increment sources is an unpaid **buy-now offer**, which feeds
a bidding ban. Fix: admin clear/ledger path, and separate the auction non-payment count from offer
non-payment.

#### M6 — Crash between the pay-window claim and the Transaction insert strands a won auction forever
Checkout CAS-nulls `expiresAt` (`transactions.service.ts:740-748`) and only later inserts the
Transaction (`:888-902`); the compensating restore lives in a JS catch (`:903-932`). A process death or
DB failure with both the insert and the restore failing leaves `PAYMENT_PENDING`, `endedAt` set,
`expiresAt` null, no Transaction — a state every sweep misses (the same state list as H3). Add a
recovery sweep for “ended, PAYMENT_PENDING, expiresAt null, no live Transaction” or make the claim +
insert one DB transaction.

#### M7 — Admin takedown can CANCELLED a won auction that is awaiting payment
`admin.service.ts:504-556` sets `CANCELLED` for any status and notifies only the seller. Seller cancel
is deliberately blocked in `PAYMENT_PENDING` (`listings.service.ts:3887-3896`) to protect the winner's
checkout, but the admin route has no such guard: the winner holds a pay link that can never succeed, and
no winner/bidder notice is sent. Guard the admin path (refuse or explicitly notify/refund the winner).

#### M8 — The public edit-lock endpoint is an existence/state oracle for hidden listings
`GET /listings/:id/edit-lock` has **no guards at all** (`listings.controller.ts:400-411`) and returns
status-derived copy (`"Listing is cancelled."`, `"Bids have been placed (N)"`,
`listings.service.ts:4803-4864`). Anyone can probe DRAFT/PENDING_REVIEW/CANCELLED ids and read live
auction `bidCount` even though the 18+ gate exists to stop exactly that, and the response distinguishes
“not found” from “exists but hidden”. Add `OptionalAuthGuard + ContentAccessGuard` and an owner check
(or collapse the answer to the same shape for non-owners).

#### M9 — The Auto Bid modal can silently LOWER the bidder's proxy ceiling
The CTA is labelled “Auto Bid · ACTIVE · R{max} (Raise)” (`auction-panel.tsx:590-596`), but both modals
open on `state.nextMinBid` (`:649-668, 961-963`), not on the existing max. If the same user is leading,
the backend's `isSameBidder` branch accepts any `maxAmount >= nextMinBid`, keeps the visible bid and
persists the **lower** ceiling (`auctions.service.ts:505-511, 540-544, 590-594`). Leading at R400 with a
R500 max, one tap on “Set Auto Bid” silently drops the ceiling to R450; a later R460 bid then wins an
item the user had already authorised R500 for. Fix: pre-fill at `max(existingMax, nextMinBid)`, show the
current max in the modal, and/or reject a reduction while the bidder is leading (cancel-proxy is the
offered path for lowering).

#### M10 — `/a/<token>` auction page violates the Rules of Hooks and can crash at the close boundary
`auction-bid.tsx:72-79` returns `<AuctionEndedScreen/>` based on `Date.now()` **before** the first
`useState` at `:84`. Any re-render after the clock crosses `endTime` (e.g. a stepper/choice `setView`)
renders fewer hooks than the previous render → React “Rendered fewer hooks than expected” and the SMS
bidding page dies exactly when it matters. Move the hook calls above the conditional (or make the
time-dependent branch a child component).

#### M11 — No-reserve auctions show a reserve warning on the outbid SMS page
The page renders “Reserve price not yet met … the auction won't close unless the reserve is met”
whenever `auction.reserveMet === false` (`auction-bid.tsx:175-185`). The backend returns
`reserveMet: false` for a listing with **no reserve** (`auctions.service.ts:217-218, 623-624`) and ships
`hasReserve` alongside it — which the page ignores. Every no-reserve outbid SMS therefore carries a
false reason not to bid. Gate on `hasReserve`.

#### M12 — Cancelled auctions leave a “Reconnecting…” loop, an enabled bid CTA and an “Active” My Bids row
`CANCELLED` is excluded from `AUCTION_PUBLIC_STATUSES` (`auctions.service.ts:37`), so an open panel's
poll starts failing; after three misses it shows “Reconnecting… the bid shown may be out of date” forever
while the bid buttons remain live (`auction-panel.tsx:161-190, 368-397, 555-614`); its CANCELLED outcome
branch (`:885-891`) is unreachable. In `/my/bids` the row lands in the Closed section but the pill reads
**“Active”** and the status label “High bidder” because both derive from `endedAt`/`isWinner`, and
`cancel()` never sets `endedAt` (`my/bids/page.tsx:299-357`; `listings.service.ts:3903-3923`). Fix: set
`endedAt` on cancel, expose a terminal cancelled state to the panel (or a generic “no longer available”
poll response), and derive the My Bids pill from `listingStatus` too.

---

### LOW (worth fixing, not release-blocking)

- **L1 Winner lapsed/abandoned checkout gets no 6-hour reminder but still gets the strike.**
  `remindUnpaidWinners` selects `expiresAt` in the next 6h (`auctions.service.ts:1386-1399`), but starting
  checkout nulls it (`transactions.service.ts:740-748`) and the reconcile cron hands the row back with an
  *already-past* window (`:6935-6942`) → `sweepUnpaidWins` strikes with no nudge. Only the initial “you
  won” mail warns them.
- **L2 `AuctionsService.notifyWinnerUnpaid()` is dead code** (`auctions.service.ts:1454-1481`, zero call
  sites) whose comment claims the freeze sweep calls it. Today's Path B is handled by the reconcile cron,
  so no user-visible defect — but a future refactor could trust the comment.
- **L3 `cancelProxy` CAS omits `bidCount`** (`auctions.service.ts:299-307`) while the bid CAS includes it
  (`:697-717`); two concurrent cancels can both commit, writing duplicate cancellation rows and
  inflating `bidCount`.
- **L4 Snipe extensions are not written to the search index and the “ending soon” alert is one-shot**
  (`auctions.service.ts:617-621` never reindexes; `wishlist-alerts.service.ts:206-238` stamps
  `endingSoonNotifiedAt` inside the last hour). Text-search `ending_soon` ordering and watcher alerts can
  be stale after an extension. Winner correctness is unaffected.
- **L5 Seller-side auction notifications badge to the buyer's `/my/bids`.**
  `notification-module.ts:27` maps any `auction_*`/`bid_*` type to `/my/bids` without checking
  `category === 'SELLER'` (seller types: `auction_ended_*`, `auction_runner_up_available`).
- **L6 `AuctionWatch` is a dormant stub.** The watch endpoints exist (`auctions.controller.ts:77-88`) but
  no frontend writes them (documented stub in `admin.service.ts:2097-2104`); the auction PDP's
  “Watching” count is therefore always 0 (`listings.service.ts:2251`), while the wishlist path does the
  real watching and the ending-soon alert targets wishlisters.
- **L7 Auction copy misstatements.** “this firearm is yours” on the SMS success screen for *any*
  category (`auction-bid.tsx:466-468`); “Sign in to bid” is a `<button>` inside a `<Link>`
  (`auction-panel.tsx:541-554` + `lib/auth.tsx:282-301`); the winner CTA says “Complete checkout —
  R{hammer}” while checkout adds the buyer's 5% fee + delivery (`auction-panel.tsx:844-855`,
  `my/bids/page.tsx:467`); and whole-rand `formatPrice` (`lib/utils.ts:1-8`) can make summary lines not
  foot for cent-bearing hammers.
- **L8 Bid modal / live updates are not accessible:** no focus trap, no initial focus, no Escape handler,
  no scroll lock, no focus restore on the bid dialog (`auction-panel.tsx:968-1069`); bid confirmations and
  the outbid banner have no `role="status"`/`aria-live` (`:482-507, 639-646`); the odometer's digits are
  all `aria-hidden`, so a price change announces “Current bid rand” with no number
  (`auction-odometer.tsx:163-181`).
- **L9 Meilisearch filter injection via unescaped `categoryId`/`categorySlug`** in the shared filter
  builder (`listings.service.ts:2801-2806`) while `make` and `attr_*` are escaped (`:2817-2858`);
  DTO is `@IsString()` only (`dto/browse-listings.dto.ts:29-35`). The hydration gate re-asserts
  `status ACTIVE`, so no hidden-row leak was found, but result sets/facets can be manipulated or the
  request 500s. This is browse-wide, not auction-only.
- **L10 `placeBid` leaks existence/status** for hidden listings (404 vs 400, `auctions.service.ts:490-496`);
  ids are cuids and L8/M8 makes ids easier to obtain.
- **L11 A crafted create can publish a photo-less ACTIVE auction.** `imageCount` is only moderation
  metadata (`listings.service.ts:1815-1817`); no image count check before ACTIVE. Grids require card
  media, so it is reachable by direct id only — but adding photos is locked once a bid lands.
- **L12 `AuctionsModule` has no boot spec**, against the repo rule that every module mounting a guarded
  controller has one (`auctions.module.ts:7-11`; compare `bench.module.spec.ts`, `feed.module.spec.ts`).
  No boot defect found; the local guard providers are correct.
- **L13 Reserve status is invisible on the PDP.** The panel never reads `hasReserve`/`reserveMet`
  (`auction-panel.tsx:24-51`), so a bidder can see “High bidder: You” on an auction that will not sell
  for reserve reasons. `/my/bids` already surfaces it, so the buyer-facing page should too.
- **L14 Client-clock-only close.** `auctionOver` uses the device clock (`auction-panel.tsx:63-87, 270`)
  with no `serverNow` in the payload; a clock minutes ahead hides the bid CTAs while the server still
  accepts bids (the checkout hold path already normalises this; the auction state endpoint does not).
- **L15 Post-bid refresh drops the Authorization header** (`auction-panel.tsx:301-312`), contradicting the
  fetch just above it; same-origin cookies mask it in the web app but a cross-site app-shell loses the
  refresh (and a failed `/me` leaves a stale “You ✓”).
- **L16 Seller's own auction PDP has no Edit/Cancel control** — `SellerControls` mounts only in the
  BUY_NOW branch (`listings/[id]/page.tsx:818-828`) while the mobile sticky bar offers “Edit listing”;
  sellers must use `/my/listings`.
- **L17 Test gaps.** Frontend: no specs for `auction-panel.tsx`, `auction-bid.tsx`, `runner-up.tsx`,
  `auction-odometer.tsx`, `my/bids` (only `auction-minimums.spec.ts` exists). Backend: no test for
  `sweepUnpaidWins`, `maskBidderUsername`, the auction module boot, or the cancelProxy/dupe-cancel case;
  `auctions.service.spec.ts` covers bidding, finalisation, cancelProxy and runner-up only
  (`:92-555`). The reserve single-bidder bug (H2) and H3's release branch are exactly the untested cases.
- **L18 Dark-theme “closing/urgent” contrast is below AA.** Auction urgency text uses `var(--red)`, which
  in dark mode is `#0967F5` (`globals.css:435-437`, sized for the light-mode ochre `#B45309` at
  `:177`). Applied as 11px chip text on `--red-wash` over the card (`listing-card.tsx:446-449`) that is
  ≈3.1:1 (≈3.6:1 on the card itself) and as 13px ring numbers with a pulse to 0.55 opacity
  (`auction-odometer.tsx:90-93, 145-146, 239-242`), so auction closing states fail WCAG AA 4.5:1 for
  small text in the dark theme — the one theme most bidders use.

---

## 2. Verified sound (so the fix work does not re-litigate these)

- **Bidding core:** tiered increments R50/100/250/500/1,000 match the client copy (`bid-stepper.tsx`);
  strict `>` gives ties to the earlier bidder; dual-row proxy history is written in one transaction with
  `bidCount +2`; `maxAmount` is selected but never returned by any public payload; `reservePrice` is never
  returned publicly (only `hasReserve`/`reserveMet`).
- **Bid validation:** self-bid, banned, closed-account, 3-strike, non-ACTIVE, ended-by-clock, below-minimum,
  KYC is correctly **not** a bid gate, contact-verification is.
- **Concurrency:** CAS on the exact snapshot read (including `bidCount`, `status`, `endedAt`, `endTime`),
  3 attempts with jittered backoff, notifications only after commit; a bid racing finalisation loses
  cleanly and is re-evaluated. Sniping is server-side and absolute-ms (no DST/timezone arithmetic).
- **Close/recovery:** `endStale` is idempotent and CAS-guarded; a late cron still produces the correct
  winner (no bids can land after `endTime`); the single production auction finalised 37s after close.
- **Unpaid-win lifecycle (Path A):** 24h window, CAS-safe expired flip, seller notice, winner notice,
  strike at 3 with an urgent admin alert, accepted-auction-offer expiry, seller-confirmed runner-up
  promotion with eligibility re-checks and a 48h token, and the runner-up's own window policed by the
  same sweep.
- **Money:** the auction split is 5% buyer / 5% seller of the hammer (flat 10%), `SELLER_DEDUCT`,
  `sellerPayout = hammer − 5%`; the fee preview and the charge come from one source
  (`fee.calculator.ts`, `fee-presentation.ts`, `fee-sync.cjs`); the rail is locked at checkout;
  a second checkout for the same win is CAS-blocked; `markPaid` binds gateway reference + exact amount
  and is idempotent; refund/reversal helpers put ended auctions on `EXPIRED`, never ACTIVE
  (`inventory.ts:76-95`); gateway-failure rollback restores the pay window (`auction-win-rollback.spec.ts`);
  no wallet/ledger was introduced.
- **Gate wiring:** auction reads mount `OptionalAuthGuard + ContentAccessGuard`; every write mounts
  `AuthGuard`; `/actions/:token` is deliberately public and token-authorised; no auction endpoint leaks a
  seller real name, the reserve amount, `maxAmount`, or biddable state for hidden listings.
- **Search/filter:** auctions are filterable/sortable on both browse paths; `publicVisible` is legacy-only
  as a display filter (pinned by `content-visibility.spec.ts`); finalisation evicts the Meili document.

---

## 3. Recommended fix order

1. **H1** (pay link) — otherwise the first real auction winner who is not signed in on that device cannot
   pay. Treat as release-blocking for any auction campaign.
2. **H3** and **M6** (both are “won auction cannot pay and no sweep recovers it”) — small, surgical:
   add the auction branch to the release helper, keep `expiresAt` lapsed rather than ACTIVE; add the
   recovery sweep.
3. **H2** (reserve) — needs a product decision + a visible-bid fix; it decides whether reserve auctions
   can sell at all.
4. **H4** + **M12** (cancellation integrity: block or notify, set `endedAt`, fix the three false promises,
   fix the My Bids pill and the panel's cancelled state).
5. **H5** (offer-vs-proxy) — needs a product decision; at minimum run the loser fan-out on any early close.
6. **M9 / M10 / M11** (best-bid UX traps + SMS crash + false reserve copy) — cheap and directly bidding-facing.
7. **M1, M3, M7, M8** (edit rules, ended-auction visibility, admin guard, edit-lock guard).
8. **M4, M5** (durable close side effects, strike governance).
9. Then the LOW list, especially **L17** (add the specs for everything above — the highest-value ones are
   the reserve single-bid case, the lapsed-attempt auction branch, cancelProxy duplicate and the panel/bid
   components), plus **L13/L8** (reserve visibility, a11y).

## 4. Open product decisions (no code decision possible in an audit)

- Reserve semantics (H2): is a stored max above the reserve a sale, and does the visible bid then jump to
  the reserve?
- The 70%-of-reserve starting bid (M2): change the rule, stop publishing it, or accept that the reserve is
  derivable.
- Offers vs bids (H5): may a seller accept a Take-a-Shot offer on a live auction with bids, at any point
  including the last seconds, and what should the standing proxy leader be told?
- Cancellation (H4): is a seller allowed to withdraw an auction with bids at all? If yes, what consequence
  (strike/standing) and what notice do bidders get?
- Strike permanence (M5): should 3 non-payment strikes block bidding forever, and what is the appeal path?
- Whether `AUCTION_BID`/`CHECKOUT` action links should also count as 18+ declaration-equivalent access for
  the target listing (H1's cleanest fix) or whether the checkout page should carry the token to the backend
  explicitly.
