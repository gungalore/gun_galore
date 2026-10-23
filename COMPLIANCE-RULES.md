# All Outdoor - Compliance Rules (as enforced in code)

Compiled 2026-09-29 from the local build at `C:\dev\gun-galore` (branch HEAD `f8c4094f`, plus uncommitted working-tree changes). Only the code was treated as authoritative. Where the docs (`docs/project-reference.md`, `README.md`) say something different, the code value is used here and the conflict is listed in section 9.

Scope: the two selling platforms (**Marketplace** = Buy Now listings with offers, and **Auctions**), plus the **Motivation Creator**, **the Vault** (Document Centre), **the Bench** and the **SAPS Application Tracker**.

Legal references were checked against the bundled Firearms Control Act 60 of 2000 text where a rule depends on a section number. This is a code inventory, not legal advice.

---

## 1. Platform-wide rules (apply to every module)

### 1.1 Account standing
| Rule | Where |
|---|---|
| A closed account is refused before a banned one, so a returning member is told "closed", not "suspended". | `common/account-standing.ts` |
| Banned accounts (`isBanned`) cannot list, buy, bid or make offers. | listings, offers, auctions, transactions services |
| Closing an account removes the person from every public surface but keeps the transaction, complaint and strike records (not a POPIA erasure button; erasure is a separate support-reviewed path). | `users/account-closure.service.ts` |
| On closure, username, email and phone are released, but the SA ID hash (`kycIdHash`) is held so a banned seller cannot come back clean. Banned members cannot use self-service closure. | `users/account-closure.service.ts` |
| Closure is blocked while anything is open (checked twice, once for the screen and again inside the closure transaction). Reason must come from a ticklist, no free text. | `users/account-closure.service.ts` |
| Reserved usernames (admin, support, staff, alloutdoor, gungalore, moderator, etc.) cannot be taken. Shape `^[a-z0-9_]{3,30}$`. | `users/username-policy.ts` |

### 1.2 Privacy and public exposure
| Rule | Where |
|---|---|
| Public surfaces show `username` only, never first/last name, initials or an `@` prefix. Fallbacks: "Anonymous bidder" / "Anonymous seller". | `PUBLIC_LISTING_SELECT` allowlist, `listings.service.ts` |
| Public auction payload masks bidder usernames server-side (`r***t`, fixed-length mask). | `auctions.service.ts` `maskBidderUsername` |
| `sellerAskCents` (seller take-home) is owner-only and must never enter the public select. | `listings.service.ts` |
| Auth wall, not cloaking: signed-out visitors only see `publicVisible` listings/categories, identical for every user-agent. Every public read path uses `OptionalAuthGuard` + `publicOnly()`. | `listings.service.ts:1743` |
| Hidden listing/category returns 404, never 403 or "sign in to view". | `listings.service.ts` |
| Categories are members-only by default (`publicVisible` is an opt-in allowlist). Public roots: Cleaning Equipment, Optics, Fishing, Camping & Outdoor, Knives, Paintball, Overlanding & 4x4, Hunting, Outdoor Clothing & Footwear, Archery & Bowhunting. Carve-outs under public roots are forced members-only (rifle/handgun/rimfire/air-rifle/rangefinding scopes, shooting sticks & bipods, crossbows). | `prisma/seed.ts` |
| Seed refuses to publish any category whose name or slug contains a weapon word (firearm, gun, rifle, handgun, pistol, shotgun, revolver, ammo, ammunition, calibre/caliber, muzzle, silencer, suppressor, magazine, holster, shooting). | `prisma/seed.ts` `assertNoWeaponWordInPublic` |
| Viewer-varying responses are never shared-cached (`no-store`). | frontend `viewerFetch`, Bench `@NoStore()` |

### 1.3 Encryption and data handling
| Rule | Where |
|---|---|
| SA ID numbers stored AES-256-GCM encrypted; separate HKDF domain for other sensitive blobs. Key from `ID_HASH_SECRET`; no fallback key, throws if missing. | `common/id-crypto.ts`, `common/blob-crypto.ts` |
| Uploaded documents stored encrypted on disk (dirs `0700`, files `0600`). | `common/secure-file-storage.service.ts` |
| One SA ID = one account (keyed hash lookup). | `kyc/kyc.service.ts` |
| No wallet, stored balance or ledger. No raw card numbers ever touch the platform. | architecture (Ozow hosted page) |

### 1.4 Copy rules
| Rule | Where |
|---|---|
| Never "escrow" in user-facing copy. Use "funds held" / "payment held" / "payment protected". | house rule in legal pages |
| Never "KYC" in user-facing copy. Use "Verified" / "Verification". | house rule (see violations, 9.3) |
| Never claim a Home Affairs check (none runs since the move to Didit). | `kyc/kyc.service.ts`, `app/kyc/verify/page.tsx` |
| Never promise outcomes on licence applications or renewals ("we remind, we never ensure"). | motivations, vault, tracker |
| Never claim SAPS affiliation on the tracker. | `licence-tracker.service.ts` |

### 1.5 Contact-detail (fee-bypass) filter
Two-layer filter on user-to-user free text: regex (fail-closed) then model check (fail-open). Blocks phone numbers in any form, emails, own URLs/domains, social handles and platform names, "DM me / WhatsApp me / meet me at", street addresses. Wired into: offer buyer note, counter-offer seller note, ratings comments. Listing text/photos and public Q&A have their own moderators. (`moderation/contact-detail-filter.service.ts`)

---

## 2. Marketplace (Buy Now) - listing rules

### 2.1 Who may list
| Rule | Where |
|---|---|
| Account must exist, not closed, not banned. | `listings.service.ts create()` |
| `sellingBannedAt` set = no new listings (buying unaffected). | `listings.service.ts` |
| Seller verification is **not** required to list. It is triggered (fire-and-forget) when a buyer starts checkout on an unverified seller's listing. | `transactions.service.ts` |

### 2.2 Prohibited goods (all write paths: preview, create, update)
| Rule | Where |
|---|---|
| **Live ammunition is permanently banned.** Category layer: nothing may be listed into an ammo category (the `ammo` tree is `isActive:false`). Term layer: a signal guard catches loaded-round adverts in innocent categories (calibre + count/price with no component noun, "N rounds of <calibre>", etc.). | `listings.service.ts` `assertNotLiveAmmunition`, `findLiveAmmunitionListing` |
| **Primers and propellant are banned** (separate rule, separate message; no category exists for them). | `RELOADING_SUPPLY_BAN_MESSAGE` |
| Allowed: projectiles/bullets, brass cases (once-fired, unprimed or primed), reloading equipment incl. powder measures, ammo carriers/boxes/pouches, wear copy ("1200 rounds, one owner"), capacity, disclaimers. | same |
| Error copy states the ban is permanent and that rewording will not help. | same |
| Listing into an inactive category, or one with `availableSecondhand=false`, is refused. | `listings.service.ts` |

### 2.3 Listing content
| Rule | Where |
|---|---|
| Title 5 to 200 chars; description 10 to 5000 chars; price min R1.00 (100 cents). | `dto/create-listing.dto.ts` |
| Max 10 images per listing. ACTIVE listings with zero photos after 1h are flipped back to DRAFT and de-indexed. | `listings.service.ts:3334`, `tasks.service.ts photolessListingSweep` |
| Category attributes validated server-side; unknown keys dropped. | `listings/attribute-validation.ts` |
| A pickup address (street, city, postal code) is required on every listing. Firearm and collection-only listings must also have a readable town. | `listings.service.ts` |
| Compare-at ("was") price: Buy Now only, must be higher than the buyer-facing price, max 4x the sale price (CPA s41 anti-anchoring); displayed % capped at 70%. | `listings.service.ts` |
| Inventory quantity above 1 only on non-firearm Buy Now listings (max 9999). Firearms are always 1. | `listings.service.ts`, `payments/inventory.ts` |

### 2.4 AI moderation (relaxed mode)
Checks only two things: (1) personal contact details, (2) ammunition/primers/propellant offered for sale.
| Outcome | Result |
|---|---|
| Contact details in title | REJECT, seller told to remove |
| Contact details in description only | AUTO_FIX_AND_APPROVE, silently redacted (original kept), local regex pass on top |
| Contact details / QR code / identifying shop signage in a photo | REJECT naming the photo |
| Ammo / primers / powder offered | REJECT with ban message |
| Product markings (brands, models, calibre stamps, serials, proof marks) | never a violation |
| REJECT | listing goes PENDING_REVIEW |
| Moderation flag off or no model key | publishes ACTIVE (fail-open) |
(`moderation/listing-moderation.service.ts`, `listings.service.ts`)

### 2.5 Firearms and barrels
| Rule | Where |
|---|---|
| Firearm categories: Firearms tree (`isFirearm`, `requiresLicence`) and Barrels (licensed part). | `prisma/seed.ts` |
| Seller must give typed serial + serial photo + licence photo. | `listings.service.ts` |
| AI licence verification BLOCKs if: serial photo illegible, licence unreadable or not an SA firearm licence, serial photo does not match typed serial, licence serial does not match, **licence holder does not match the seller's account name**, expiry unreadable, licence expired or under 30 days to expiry. 31 to 90 days = WARN (listed with warning). No model configured = BLOCK all firearm listings. Match floor 80/100. | `listings/firearm-licence.service.ts` |
| Every firearm listing must offer `DEALER_TRANSFER`. `PRIVATE_ARRANGE` may be added, never on its own. | `listings.service.ts` |
| Daily 06:00: ACTIVE firearm listings with licence expired or within 30 days are delisted (EXPIRED) and the seller told to renew; 31 to 90 days gets a one-time warning. | `tasks.service.ts checkFirearmLicenceExpiry` |
| Air rifles are not firearms; they list and ship as ordinary goods. | seed / shipping |

### 2.6 Collection-only and dangerous goods
| Rule | Where |
|---|---|
| Collection-only categories (e.g. Trailers & Off-Road Caravans, Batteries) force `COLLECTION`; `COLLECTION` is refused on anything else. | `listings.service.ts`, `transactions.service.ts validateShipping` |
| Loose lithium battery above the Wh threshold (default 100 Wh, admin-tunable, UN3480) is forced collection-only. | `FLAGS.dgLithiumWhThreshold` |
| Collection-only items may only be Buy Now or Auction. | `listings.service.ts` |
| NaTIS goods (`requiresPapers`): seller must attest they hold registration/roadworthy papers and will hand them over. Only the attestation is stored, never the documents (POPIA). | `listings.service.ts` |
| A category cannot be both firearm and collection-only. | `listings.service.ts` |

### 2.7 Listing lifecycle
| Rule | Where |
|---|---|
| Non-auction listings age on `lastRenewedAt`: nudge at 75 days, EXPIRED and de-indexed at 90 (daily 04:00). | `tasks.service.ts staleListingSweep` |
| Sold or cancelled listings cannot be edited. Only an ACTIVE listing can be renewed. | `listings.service.ts` |

---

## 3. Marketplace - offers

| Rule | Where |
|---|---|
| Every ACTIVE listing accepts offers (no per-listing off switch; seller can only mute notifications). | `offers.service.ts` |
| Buyer must not be closed, banned, or on 3+ unpaid-win strikes. Seller cannot offer on own listing. | `offers.service.ts` |
| Offer floor: at most 30% under the asking price (min 70%). Below the floor is refused outright, nothing stored, no attempt used. | `MIN_OFFER_RATIO = 0.7` |
| On auctions an offer must be at least the current high bid (or starting bid). | `offers.service.ts` |
| One offer per buyer per listing, one attempt only (`MAX_OFFER_ATTEMPTS = 1`). | `offers.service.ts` |
| No new offers once any offer on the listing is ACCEPTED. Listing-banned seller's listings refuse offers. | `offers.service.ts` |
| Offer TTL 48h; counter TTL 24h; accepted-offer checkout window 24h. Seller may counter once, only above the buyer's offer. | `offers.service.ts` |
| Seller auto-decline threshold records the offer as REJECTED (seller not notified); auto-accept threshold still goes to the seller as PENDING. Decline threshold must be below accept threshold. | `offers.service.ts`, `listings.service.ts` |
| Seller must give a structured reason to decline; OTHER needs 10+ characters. | `offers.service.ts` |
| On sale, all sibling offers from other buyers are rejected. | `transactions.service.ts` |

### 3.1 Seller reject strikes (offers and sales)
Ban threshold `BAN_AT = 2` strikes: sets `sellingBannedAt` and cancels all ACTIVE listings. Every strike is written to the `SellerStrike` ledger and raises an admin alert; admins can remove a single strike and the ban is recomputed. (`common/seller-reject-policy.ts`)

| Offer decline reason | Consequence |
|---|---|
| Item no longer available | Strike + delist |
| Item damaged | Strike + delist |
| Offer too low | Strike |
| Concerns about the buyer | Trust review only (no strike) |
| Listing error | Strike |
| No longer selling | Strike + delist |
| Other | Strike + trust review |

| Sale reject reason | Consequence |
|---|---|
| Sold elsewhere / stock issue / item damaged / changed mind | Strike + delist |
| Can't fulfil shipping | Strike |
| Buyer suspicious | Trust review only |
| Other | Strike + trust review |

---

## 4. Auctions

| Rule | Where |
|---|---|
| Duration required. Minimum committed value by length: 3 days R1,000; 5 days R2,500; 7 days R6,000; 14 days R10,000. The floor applies to the reserve if set, else the starting bid. | `AUCTION_MIN_VALUE_CENTS` |
| With a reserve, starting bid is forced server-side to 70% of the reserve (floor). Without one, the seller's starting bid stands (must be > 0). | `listings.service.ts` |
| Buy Now price must exceed the starting bid; Buy Now only while there are zero bids. | `listings.service.ts`, `auctions.service.ts` |
| Reserve amount never exposed; only `hasReserve` and `reserveMet`. Proxy `maxAmount` never public. | `auctions.service.ts` |
| Bid increments: under R1,000 = R50; under R5,000 = R100; under R10,000 = R250; under R50,000 = R500; R50,000+ = R1,000. | `INCREMENT_TIERS` |
| Proxy bidding with stored max; ties go to the earlier bidder. | `auctions.service.ts` |
| Anti-snipe: a bid inside the last 2 minutes pushes the end to now + 2 minutes. | `SNIPE_WINDOW_MS` |
| Cannot bid on own auction. Banned bidders and bidders with 3+ `auctionStrikes` cannot bid or use Buy Now. | `auctions.service.ts` |
| Auction ends without a sale if a reserve exists and was not met. | `auctions.service.ts` |
| Winner has 24h to pay; only the winner can check out. Unpaid win: listing EXPIRED, winner gets an unpaid strike (admin alert at 3), seller may offer the item to the runner-up (seller-confirmed, never automatic) with a fresh 24h window. Runner-up must not be banned, closed or on 3+ strikes. Runner-up decision window 48h. | `auctions.service.ts` |
| Auctions are single-item and not marked up (commission comes out of the seller). | fee model |

---

## 5. Checkout, payment, fulfilment (Marketplace and Auctions)

### 5.1 Checkout gates (server-enforced, every checkout)
| Rule | Where |
|---|---|
| Buyer not closed or banned; seller cannot buy own listing. | `transactions.service.ts` |
| **Buyers never need identity verification** for buying, bidding or offers. | project rule, no `kycStatus` check on buyer paths |
| `buyerTermsAccepted === true` on every checkout: buyer has seen where the item is and location/distance is not a refund ground. | `create-transaction.dto.ts` |
| Firearm checkout requires `firearmAttestation18Plus === true` (over 18 and holds relevant SAPS competency where applicable). Stamped as `firearmAttestationAcceptedAt`. | `transactions.service.ts` |
| Papers items require the buyer's collection-papers acknowledgement. | `transactions.service.ts` |
| Offer checkout is hard-bound to the offer's own listing (anti price-substitution). | `transactions.service.ts` |
| Shipping is re-quoted server-side; the browser never sends a price. | `ShippingService.quoteForSelection` |
| Payment verification re-fetches Ozow status and checks the transaction and amount match. | `transactions.service.ts` |

### 5.2 Shipping routes
| Item class | Allowed methods |
|---|---|
| Firearms and barrels | `DEALER_TRANSFER` or `PRIVATE_ARRANGE` only. Never by courier (the courier quote endpoint also refuses firearms). |
| Collection-only | `COLLECTION` only |
| Everything else | `COURIER` only (Cheapest Door, Fastest Door or Store Pickup from one Bob Go quote) |
The buyer can only pick a method the seller offered. (`validateShipping`, `shipping.service.ts`)

### 5.3 Private arrangement (firearms)
| Rule | Where |
|---|---|
| Buyer accepts the in-person handover terms with the Terms of Service at registration (no checkout consent screen); the client sends `privateArrangeConsent === true` and the API requires it. Stamped `privateArrangeAcceptedAt`. | `create-transaction.dto.ts`, Terms §7 |
| Funds are released to the seller **immediately on payment** (buyer waives payment protection); contact details are revealed. No release without the consent stamp. | `maybeImmediatePayout` |
| Private-arrange orders cannot be seller-rejected, buyer-cancelled or disputed after payment (payment is no longer HELD). | `transactions.service.ts` |

### 5.4 Dealer transfer (firearms)
| Rule | Where |
|---|---|
| Buyer does not pre-pick a dealer; seller proves stock-in with 3 photos: completed SAPS 534 (stamp or signed + printed name, block letters, dealer licence visible), the **last line only** of the dealer stock register (Reg 86 register, privacy), and the firearm with serial next to the order reference. | `dealer-verification.service.ts` |
| AI scoring: all criteria >= 80 = APPROVED; any 50 to 79 = admin review; any < 50 = REJECTED (reshoot). Serials cross-checked across all three photos and against the listing. | same |
| Payout cannot release until dealer verification is APPROVED. Admin review over 48h raises an urgent alert; a scan stuck > 1h goes to admin review. | `confirmDelivery`, `tasks.service.ts` |
| Dealer transfers can be disputed at any time while HELD (no dispatch event). | `transactions.service.ts` |

### 5.5 Fees (code values)
| Item | Value |
|---|---|
| Platform Fee (marketplace, marginal) | First R25,000 at 10%; R25,001–R50,000 at 9%; R50,001–R75,000 at 8%; above R75,000 at 7% |
| Minimum Platform Fee | R10, never more than the amount charged |
| Top Seller discount | **None** — the tier is badge-only |
| Buyer-paid fee | One **Platform Fee**, calculated last on (item + delivery); the old Buyer Protection Fee is retired |
| Auction split | Flat 10% total: 5% buyer on (hammer + delivery), 5% seller on the hammer |
| Manual rail fee | Retired (included in the Platform Fee) |
| Delivery margin | 10% of the carrier rate, folded into one inclusive delivery price (never shown separately) |
| Marketplace fee model | `BUYNOW_MARKUP`: listed price = seller ask; seller receives the full ask; buyer pays the Platform Fee |
| Auctions | `SELLER_DEDUCT`: seller pays 5% off the hammer; buyer pays 5% on top |
| Buyer cancellation | 4% transaction handling fee; delivery retained once a waybill is booked; no cancellation after dispatch |
(`payments/fee.calculator.ts`, `transactions.service.ts`)

### 5.6 Seller obligations after payment
| Rule | Where |
|---|---|
| Accept or reject within 48h; missed deadline is escalated to admin (no auto-refund). | `ACCEPT_DEADLINE_HOURS`, `acceptEscalationSweep` |
| On accept the seller picks a collection day/window from the two offered (courier cut-offs apply). | `transactions.service.ts` |
| Courier orders must be dispatched within 5 days of accepting; nudge 24h before; then auto-refund to buyer, listing reactivated, carrier booking cancelled, **seller strike** (`dispatchStrikes`, admin alert at 3). Seller is blameless if our Bob Go booking never completed. | `dispatch-sla.service.ts` |
| Seller reject: reason 3 to 500 chars, only while HELD, before accept/dispatch; refund must succeed before the row flips; consolidated parcels go through support. | `rejectTransaction` |

### 5.7 Buyer rights
| Rule | Where |
|---|---|
| Buyer self-cancel with full refund: courier orders only, paid, HELD, not dispatched, reason 3 to 500 chars, no seller strike. | `cancelByBuyer` |
| Disputes: paid orders only, while HELD, not after confirming delivery, 10+ character description. Courier orders only after dispatch. | `raiseDispute` |
| Complaints register (CO- case numbers). Item not as described / damaged / not arrived on a HELD order freezes payout (flips to DISPUTED). "Not as described" and "damaged" require at least one photo (max 6 photos + 1 video). Location/access complaints never freeze payout. | `complaints.service.ts` |
| Refunds: money moves at Ozow first, then the row flips to REFUNDED. Missing payment id = no flip, urgent admin alert. | transactions / dispatch SLA |

### 5.8 Payouts
| Rule | Where |
|---|---|
| Nothing pays a seller automatically (except private arrange). Admin runs the due batch. | `manual-payments.service.ts` |
| Payout hard gate: seller verification VERIFIED and profile complete; blocked sellers are shown as blocked money, not dropped. | `manual-payments.service.ts:712` |
| Courier door orders: admin payout option opens after delivery (+24h); Store Pickup: collected + 24h or the pickup deadline. Buyer confirm-receipt nudge at 48h, admin alert at 72h, no auto-release. | `dispatch-sla.service.ts`, `tasks.service.ts` |
| Webhooks with bad signatures return 200 and write nothing (alert raised). | Ozow / Didit controllers |

### 5.9 Seller identity verification (seller-only)
| Rule | Where |
|---|---|
| POPIA consent must be given before any verification step. | `kyc.service.ts` |
| SA ID must pass Luhn; seller must be 18+; one ID per account. | `kyc.service.ts` |
| Didit workflow: OCR + passive liveness + face match + IP analysis. Production refuses to boot unless `DIDIT_MODE=live`. | `didit.service.ts` |
| An approved Didit session whose document disagrees with the typed ID/DOB is parked UNDER_REVIEW, never VERIFIED. Rejection copy never names the DOB check. | `kyc.service.ts`, `kyc-cross-check.ts` |
| Names are taken from the verified document. | `kyc.service.ts` |

---

## 6. Motivation Creator

Feature flag `motivation_writer_enabled` defaults **off**. Price R199, discount R99 (`motivation-pricing.ts`).

### 6.1 Licence types and eligibility
Types: S13 self-defence, S14 restricted self-defence, S15 occasional hunter/sport, S16 dedicated hunter, S16 dedicated sport, S24 renewal.

The generator is **blocked** (with a message naming the section that would work) when stated facts show: (`motivation-eligibility.ts`, `common/sa-competency.ts sectionAllows`)
| Section | Refused |
|---|---|
| Any | Muzzle-loader (no licence exists; competency only) |
| S13 | Any rifle/carbine; a semi-automatic shotgun |
| S14 | Any handgun; a manually operated rifle or shotgun |
| S15 | Semi-automatic rifle or shotgun (handguns allowed) |
| All | Competency missing the needed endorsement; competency expired (s6(2)) |
Unanswered facts never produce a block. Renewals are never blocked on section.

S24 renewals are lodged on the SAPS 518(a), which the product does not fill; an S24 pack ships the motivation only and says so. The SAPS 271 is an opt-in extra. Renewal copy states the s24(1) 90-day rule and tells the member not to sign the 518(a) before the DFO.

### 6.2 Writing rules (enforced in the generation prompt and scope gate)
1. Use only supplied facts; never invent a circumstance, date, place, qualification, incident, membership or statistic.
2. No recalled figures: no measurements, velocities, energies, bullet weights, capacities, dates or design history unless in the applicant's answers or the research block. "Approximately" does not rescue a recalled figure.
3. SAPS precinct crime figures only from a named release in the research block, quoted exactly with period and source, no extrapolated trend. Press clippings cited by paper, date and annexure letter only.
4. First person as the applicant; never mention a service, platform or drafter.
5. Never predict, promise or estimate the outcome (the closing request for a licence is allowed).
6. Never quote the Act or Regulations from memory; only verbatim from the supplied `<statutory-text>` (consolidated text as amended to Act 37 of 2013). Quote only subsections actually applied.
7. Never state a competency expiry date.
8. Never claim a clean record or good character; if a declaration item is YES, state year, station, CAS number, charge and outcome only.
9. Never imply firearms the applicant does not own ("backup", "secondary", comparisons).
10. S14: nothing military, never suggest carrying in public; describe firearms only with what a licence card carries.
11. Catalogue/marketing phrases are refused and fail the whole document (stopping power, muzzle energy, magazine capacity, tactical, battle-proven, etc.). (`motivation-scope.ts CATALOGUE_PHRASES`)
12. Applicant text is treated as untrusted input (prompt-injection posture).
13. False statement warning in the declaration: s120(9)(f).

### 6.3 Third-party links
| Token | TTL | Rule |
|---|---|---|
| `WITNESS_STATEMENT` | 1 hour | Link + SMS verification code (10 min) both required; token resolves to one witness row only, never impersonates the applicant. |
| `SELLER_CONSENT` | 48 hours | Current licence holder consents over a named firearm (make, model, serial), signs, and photographs front and back of their licence; no OTP; token touches one consent row only. |
| `SCAN_HANDOFF` | 15 minutes | Desktop to own phone; write credential to the member's vault. |

### 6.4 Document tiers
`required` (SAPS will not process without it, but never blocks drafting), `expected`, `strengthens`, `extra`.

### 6.5 Retention (POPIA)
| Rule | Where |
|---|---|
| Completed motivation: scans purged at `retentionPurgeAt` (default 730 days, admin range 30 to 3650); row kept so the annexure list survives. | `motivation-retention.service.ts`, `FLAGS.motivationRetentionDays` |
| Motivation text lives with the account (storyline reuse); erased immediately on request or account deletion. | same |
| Abandoned drafts / failed-gate uploads with no date: purged after 365 days. | `ORPHAN_RETENTION_DAYS` |
| Retention never runs through the feature flag (runs even when the writer is off). Files deleted before rows; derived artifacts deleted with the document. | same |

---

## 7. The Vault (Document Centre)

Flag `licenceCentreEnabled` (off by default); when off, every route 404s. Reminders and SMS have their own flags.

| Rule | Where |
|---|---|
| **Consent to keep documents** is versioned and server-stamped (`VAULT_CONSENT_VERSION = 2026-09-07`, bumped when the processor changed to Google Gemini). States: never-asked, declined, given, stale, withdrawn. Only `given` allows keeping new documents. Withdrawal wins over everything. A changed wording re-asks; stale consent keeps existing documents but stops new ones. Declined/withdrawn stops cross-application reuse. | `vault-consent.ts`, `vault-consent-version.ts` |
| Upload limits: 10 MB, JPEG/PNG/WebP/PDF only, 60 uploads per minute. Max documents per member admin-set (default 60); max 30 evidence items. Exact duplicate files refused. | `upload-limits.ts`, `FLAGS.licenceCentreMaxCredentials`, `EVIDENCE_VAULT_MAX` |
| Ownership is always enforced in the query (`WHERE userId`), never after fetch. | `licence-centre.service.ts` |
| Documents stored encrypted; vault bytes are separate from motivation copies (neither purge may touch the other). | `licence-centre-retention.service.ts` |
| Retention is user-controlled: a document lives as long as the account unless the member deletes it. Nightly 03:35 sweep removes orphaned bytes, OCR "identify" leftovers, and deactivated trackers older than 365 days. | same |
| Decision ledger logs every automatic step but **never document contents** (no names, serials, IDs, addresses). | `common/vault-log.service.ts` |
| Expiry reminders at T-180, T-120, T-100, T-30 and on the day, only for settled dates (member-confirmed or auto-armed with high confidence). Member can mute per document. Copy: "we remind, we never ensure"; the printed document always governs. | `licence-dates.ts`, `licence-centre-reminders.service.ts` |
| "Expiring" state at 90 days (s24(1)); renewal offered from 180 days. | `licence-dates.ts` |

---

## 8. The Bench

| Rule | Where |
|---|---|
| Members only: every `/api/bench` route has `AuthGuard` and `Cache-Control: private, no-store`. Shares are member-only too (8 KB max, 90-day permalink). | `bench.controller.ts`, `bench.service.ts` |
| **No provenance anywhere** (copyright boundary): no "source", "manual", "page", "CIP", "SAAMI", "published" in any response value; enforced by a sanitiser and a leak spec. Say "start charge" / "max charge". | `FORBIDDEN_WORDS`, `bench.leak.spec.ts` |
| Consolidation: one row per combination, start = lowest start published, max = highest max published; never an average; each velocity travels with its own charge. | `consolidate.ts` |
| Safety flags computed server-side only: COAL over max, COAL within 0.5 mm of max, COAL range; logged loads flagged above max / below start. | `bench.types.ts` |
| A bullet is a weight in a calibre, never a brand (default tolerance 5 gr). | `bullet-weight.ts` |
| Results capped at 600 rows with a `truncated` flag; empty results explain which axis emptied. | `bench.service.ts` |
| Safety line on every load card: "Work every load up from the start charge while watching for pressure signs." Velocities marked indicative. | `components/bench/contract.ts` |
| Source load files never live in the repo. | project rule |

---

## 9. SAPS Application Tracker

| Rule | Where |
|---|---|
| SAPS is the authority, we are a mirror: every figure is dated as printed by SAPS; no outcome promises; no claim of SAPS affiliation. | `licence-tracker.service.ts` |
| A failed or empty poll never blanks the last real status. Empty cells never overwrite a known value. | same |
| Application reference and serial stored encrypted; matching uses a keyed hash, never plaintext; digests exclude reference and serial. | same |
| Competency trackers never hold or send a serial. | same |
| Manual re-check cooldown per tracker: 6h default (1 to 168); returns 429 with retry time. | `FLAGS.licenceTrackerCheckCooldownHours` |
| Weekly sweep (Sunday 04:40) off by default; max 50 references per sweep (up to 500); 700 ms + jitter between calls; single flight; one bad row never blocks others. | settings, `licence-tracker-sweep.service.ts` |
| Member milestones are labelled as the member's own, never as SAPS statements. | same |
| Deactivated trackers hard-deleted after 365 days. | vault retention sweep |

---

## 10. Gaps, contradictions and violations found

### 10.1 Bugs / live risks
1. **Tracker flag defaults ON.** `licenceTrackerEnabled` default is `true` with a comment saying it must be flipped back to `false` before a production deploy.
2. **S16 semi-auto shotgun five-shot limit not enforced.** `sectionAllows` returns ok for anything under S16. FCA s16(1)(c) (five-shot limit) is still in force (the Act 28 of 2006 deletion never commenced), so a semi-auto shotgun holding more than five rounds under S16 is not blocked.
3. **Moderation fails open** for text-only listings (flag off, no key, or model error = ACTIVE). Deliberate, but it means firearm listings can publish without the content check (the licence verifier still blocks).

### 10.2 Code vs documentation drift
1. **Commission bands:** docs say 9% / 7% / 5% / 3% (R5k / R20k / R100k); code and the public fees page say 10% / 8% / 6% / 4% (R5k / R15k / R25k).
2. **Seller ban threshold:** code bans at **2** reject strikes (`BAN_AT = 2`); a comment in `listings.service.ts` still says 3.
3. `rejectTransaction` comment says rejecting carries no strike, but it applies the sale-reject strike policy.
4. **Vault vs checklist on s24:** `licence-dates.ts` says not to print a statutory day count until an attorney confirms, while `motivation-checklist.ts` already prints "at least 90 days". The bundled Act confirms s24(1) is 90 days, so the vault caution can be lifted.
5. Three admin settings (`claude_confidence_threshold`, `new_seller_firearm_review_count`, `high_value_review_threshold`) are read by nothing.

### 10.3 User-facing copy violations
1. `frontend/app/members/regulated-items/page.tsx:121` and `:272` claim a **Home Affairs** lookup, and line 272 uses the word **"KYC"**.
2. `frontend/components/profile-completion-modal.tsx:412` tells sellers their ID is used for a "Home Affairs identity check".
3. `frontend/app/profile/edit/page.tsx:889` and `:918` say "triggers KYC" and "Locks to the Home Affairs name".
None of these checks run any more (Didit only reads the document), so these are false claims as well as house-rule breaches.

### 10.4 Honest limits recorded in code
- Buyer-side bans can be evaded by closing and re-registering (verification only happens for sellers).
- No Home Affairs or bank-account verification runs; bank details are checked manually before payout.
- An applicant supplies the previous owner's phone number for seller consent; the licence-card photos are the only possession check.
