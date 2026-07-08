# Gun Galore — End-to-End Dummy Run Report

Generated: 2026-07-08T08:27:50.647Z

Fully offline simulation against the isolated throwaway DB `gun_galore_dummyrun`. Every external integration (payments gateway, courier, KYC, email/SMS, Zoho, Cloudinary, Anthropic) is a no-op/stub. The harness calls the REAL service methods and invokes each sweep directly (all crons stopped).

## Module results

| Module | Result | Steps (pass/total) |
|---|---|---|
| Marketplace BUY_NOW | **PASS** | 24/24 |
| Firearm DEALER_TRANSFER | **PASS** | 5/5 |
| Auctions | **PASS** | 13/13 |
| Take-a-Shot offers | **PASS** | 7/7 |
| Cart / Orders (multi-seller) | **PASS** | 6/6 |
| Experiences (on-site) | **PASS** | 6/6 |
| Subscriptions | **PASS** | 3/3 |
| Featured slots | **PARTIAL** | 5/6 |
| Swop / Trade | **PASS** | 11/11 |
| Raffles | **PARTIAL** | 6/7 |
| Content smoke | **PASS** | 3/3 |
| Held-funds closing balance | **PASS** | 3/3 |

## Step detail

### Marketplace BUY_NOW — PASS

- ✅ PUDO: checkout created a manual-EFT transaction
- ✅ PUDO: persisted fee breakdown matches FeeCalculator
- ✅ PUDO: payment confirmed → HELD + paidAt + listing SOLD
- ✅ PUDO: listing flipped SOLD
- ✅ PUDO: re-confirm payment is idempotent (paidAt unchanged)
- ✅ PUDO: seller accepted (acceptedAt + dispatch deadline)
- ✅ PUDO: dispatched (dispatchedAt + shippingStatus COLLECTED)
- ✅ PUDO: buyer confirmed delivery → RELEASED (exactly once)
- ✅ PUDO: releasedAt is exactly-once (no double release)
- ✅ PUDO: money conserved on the settled transaction
- ✅ PUDO: payout batch settled the seller (paidOutAt + batch id)
- ✅ COLLECTION: no shipping cost + no handling margin
- ✅ COLLECTION: payment confirmed → HELD + paidAt + listing SOLD
- ✅ COLLECTION: listing flipped SOLD
- ✅ COLLECTION: re-confirm payment is idempotent (paidAt unchanged)
- ✅ COLLECTION: seller accepted (acceptedAt + dispatch deadline)
- ✅ COLLECTION: dispatched (dispatchedAt + shippingStatus COLLECTED)
- ✅ COLLECTION: buyer confirmed delivery → RELEASED (exactly once)
- ✅ COLLECTION: releasedAt is exactly-once (no double release)
- ✅ COLLECTION: money conserved on the settled transaction
- ✅ COLLECTION: payout batch settled the seller (paidOutAt + batch id)
- ✅ PRIVATE_ARRANGE: released immediately at payment (no delivery step)
- ✅ PRIVATE_ARRANGE: money conserved
- ✅ PRIVATE_ARRANGE: payout batch settled the seller (paidOutAt + batch id)

### Firearm DEALER_TRANSFER — PASS

- ✅ DEALER_TRANSFER: paid → HELD, no shipping/handling
- ✅ DEALER_TRANSFER: confirm-delivery blocked until dealer verify APPROVED
- ✅ DEALER_TRANSFER: admin APPROVE released funds (HELD→RELEASED)
- ✅ DEALER_TRANSFER: money conserved
- ✅ DEALER_TRANSFER: payout batch settled the seller (paidOutAt + batch id)

### Auctions — PASS

- ✅ AUCTION: two bids registered, high bidder + bidCount tracked
- ✅ AUCTION: winning auction finalised → PAYMENT_PENDING for high bidder
- ✅ AUCTION: no-bids auction → EXPIRED
- ✅ AUCTION: winner checkout priced at winning bid
- ✅ AUCTION: payment confirmed → HELD + paidAt + listing SOLD
- ✅ AUCTION: listing flipped SOLD
- ✅ AUCTION: re-confirm payment is idempotent (paidAt unchanged)
- ✅ AUCTION: seller accepted (acceptedAt + dispatch deadline)
- ✅ AUCTION: dispatched (dispatchedAt + shippingStatus COLLECTED)
- ✅ AUCTION: buyer confirmed delivery → RELEASED (exactly once)
- ✅ AUCTION: releasedAt is exactly-once (no double release)
- ✅ AUCTION: money conserved on the settled transaction
- ✅ AUCTION: payout batch settled the seller (paidOutAt + batch id)

### Take-a-Shot offers — PASS

- ✅ OFFER: buyer offer submitted → PENDING
- ✅ OFFER: seller countered → COUNTERED w/ counterAmount
- ✅ OFFER: buyer accepted counter → ACCEPTED
- ✅ OFFER: checkout priced at counter + offer → CONVERTED
- ✅ OFFER: sibling offer auto-rejected on sale (markPaid)
- ✅ OFFER: released after delivery + money conserved
- ✅ OFFER (Take-a-Shot): payout batch settled the seller (paidOutAt + batch id)

### Cart / Orders (multi-seller) — PASS

- ✅ ORDER: multi-seller checkout created (1 order, 2 lines)
- ✅ ORDER: confirm → Order PAID, both children HELD
- ✅ ORDER: order total equals sum of child buyerTotals
- ✅ ORDER: all children RELEASED after delivery + conserved
- ✅ ORDER: rollup sweep advanced Order → COMPLETED
- ✅ ORDER: both children paid out

### Experiences (on-site) — PASS

- ✅ EXPERIENCE: booked + paid → HELD, ON_SITE_SERVICE, no shipping
- ✅ EXPERIENCE: goods confirm-delivery refused for on-site service
- ✅ EXPERIENCE: outfitter accepted booking (bookingConfirmedAt)
- ✅ EXPERIENCE: completion refused before the event date
- ✅ EXPERIENCE: post-event confirm → RELEASED + conserved
- ✅ EXPERIENCE: payout batch settled the seller (paidOutAt + batch id)

### Subscriptions — PASS

- ✅ SUBSCRIPTION: checkout created a subscription (SUSPENDED) + PENDING charge
- ✅ SUBSCRIPTION: a PENDING EFT charge was allocated
- ✅ SUBSCRIPTION: confirm → ACTIVE, tier MEMBER on subscription + user

### Featured slots — PARTIAL

- ✅ FEATURED: auction opened → slot AUCTION_RUNNING
- ✅ FEATURED: bid registered (ACTIVE)
- ✅ FEATURED: auction closed → CLOSED_AWARDED, slot BIND_WINDOW
- ✅ FEATURED: bind on manual rail → awaiting payment (bid WON)
- ❌ FEATURED: payment confirmed → slot OCCUPIED — slot stuck at BIND_WINDOW; confirmSlotPayment returned bound=false. bid.paidAt=true (money captured, slot NOT bound)
- ✅ FEATURED: (impact) money was captured despite the failed bind

### Swop / Trade — PASS

- ✅ SWAP: proposal created → PENDING
- ✅ SWAP: accepted → Swap parent (AWAITING_FUNDING) + 2 legs
- ✅ SWAP: two zero-money proof legs created
- ✅ SWAP: funding set up — per-party amounts priced
- ✅ SWAP: both funded → LOCKED (both verified stamped)
- ✅ SWAP: onSwapLocked advanced LOCKED → IN_TRANSIT
- ✅ SWAP: both legs delivered → AWAITING_VERIFICATION + 48h window
- ✅ SWAP: verification sweep → COMPLETED + cashReleasedAt (exactly once)
- ✅ SWAP: RELEASED cash child pays the recipient net of cash commission
- ✅ SWAP: money conserved across both funding EFTs
- ✅ SWAP: cash recipient settled via payout batch

### Raffles — PARTIAL

- ✅ RAFFLE: created (DRAFT, subscriber-restricted)
- ✅ RAFFLE: opened → ACTIVE + subscribers auto-entered (free CONFIRMED tickets)
- ❌ RAFFLE: postal entry creates free POSTAL tickets
- ✅ RAFFLE: draw ran → DRAWN with a position-1 winner
- ✅ RAFFLE: a position-1 winner row exists
- ✅ RAFFLE: subscriber winner claimed the prize
- ✅ RAFFLE: prize dispatched (tracking stamped, no money moved)

### Content smoke — PASS

- ✅ CONTENT: Ask-GG quota read returns without AI
- ✅ CONTENT: Load-Lab recommended-loads returns gracefully
- ✅ CONTENT: price-estimate returns gracefully (no Anthropic)

### Held-funds closing balance — PASS

- ✅ HELD-FUNDS: no funds left owed to sellers after settlement
- ✅ HELD-FUNDS: no swap cash / funding left in flight
- ✅ HELD-FUNDS: total client funds fully settled to 0

## Money-conservation ledger

All amounts ZAR. For every settled lifecycle:

`buyerPaid == sellerPaid + ggRevenue + carrier + refunded`

| Module | Flow | Buyer in | Seller out | GG revenue | Carrier | Refunded | Balances? |
|---|---|--:|--:|--:|--:|--:|:--:|
| Marketplace BUY_NOW | PUDO | R2580.00 | R2249.02 | R265.98 | R65.00 | R0.00 | ✅ |
| Marketplace BUY_NOW | COLLECTION | R1800.00 | R1620.00 | R180.00 | R0.00 | R0.00 | ✅ |
| Marketplace BUY_NOW | PRIVATE_ARRANGE | R9000.00 | R8180.00 | R820.00 | R0.00 | R0.00 | ✅ |
| Firearm DEALER_TRANSFER | DEALER_TRANSFER | R12000.00 | R10940.00 | R1060.00 | R0.00 | R0.00 | ✅ |
| Auctions | AUCTION | R330.00 | R215.27 | R49.73 | R65.00 | R0.00 | ✅ |
| Take-a-Shot offers | OFFER (Take-a-Shot) | R2380.00 | R2069.02 | R245.98 | R65.00 | R0.00 | ✅ |
| Cart / Orders (multi-seller) | ORDER child seller2 | R980.00 | R804.52 | R110.48 | R65.00 | R0.00 | ✅ |
| Cart / Orders (multi-seller) | ORDER child seller1 | R1280.00 | R1079.02 | R135.98 | R65.00 | R0.00 | ✅ |
| Experiences (on-site) | EXPERIENCE | R3500.00 | R3132.50 | R367.50 | R0.00 | R0.00 | ✅ |
| Swop / Trade | SWAP (cash top-up) | R1848.00 | R1455.00 | R145.00 | R248.00 | R0.00 | ✅ |
| Raffles | RAFFLE (free entries) | R0.00 | R0.00 | R0.00 | R0.00 | R0.00 | ✅ |
| Held-funds closing balance | HELD-FUNDS closing balance | R0.00 | R0.00 | R0.00 | R0.00 | R0.00 | ✅ |
| **TOTAL** | | **R35698.00** | **R31744.35** | **R3380.65** | **R573.00** | **R0.00** | ✅ |

## Bugs found (product code, not harness)

### [Featured slots] src/featured/featured.service.ts:683 (tx.featuredSlot.update) + :693/:698 (this.recordEvent) inside bindListingToSlot occupy $transaction
- **Symptom:** On the MANUAL EFT rail (production rail), confirmSlotPayment captures the slot fee (bid.paidAt set) but the occupy step self-deadlocks and never binds the slot. Inside the interactive $transaction, bindListingToSlot first runs tx.featuredSlot.update({ status: OCCUPIED, currentListingId, ... }) — updating the @unique currentListingId column takes a key-level row lock on the slot — and then awaits this.recordEvent() (LISTING_BOUND / FEATURED_LIVE, lines 693/698), which writes FeaturedSlotAuditEvent via the BASE this.prisma client on a SEPARATE connection, FK-referencing that same locked slot row. The audit INSERT blocks on the key lock while the outer transaction awaits it → self-deadlock resolved only when the 5000ms interactive-transaction timeout fires, rolling the whole bind back. Net effect: the winning bidder is charged but their slot never reaches OCCUPIED (reproduced deterministically at ~5009ms); a manual re-bind hits the same path. PrismaService uses the same @prisma/adapter-pg driver adapter in production. Same class as the raffles createPostalEntry bug. Fix: write the audit rows with the tx client (inside the transaction), or move recordEvent outside it.
- **Failing assertion:** slot.status expected OCCUPIED, got BIND_WINDOW — Prisma "A query/commit cannot be executed on an expired transaction (5000 ms)"

### [Raffles] src/raffles/raffles.service.ts:1006 + 1039/1058 (recordEvent inside createPostalEntry $transaction)
- **Symptom:** createPostalEntry ALWAYS fails: its interactive $transaction runs `SELECT id FROM "Raffle" ... FOR UPDATE` (line 1006) to lock the raffle row, then awaits this.recordEvent() (lines 1039/1058) which writes RaffleAuditEvent via the BASE this.prisma client on a SEPARATE connection, FK-referencing the FOR UPDATE-locked raffle row. The audit INSERT blocks on that lock while the outer transaction awaits it → self-deadlock resolved only when the 5000ms interactive-transaction timeout fires, aborting the whole postal entry (reproduced at ~5010ms). PrismaService uses the same @prisma/adapter-pg (PrismaPg) driver adapter in production, so free postal raffle entries are broken on prod. Same recordEvent-inside-tx anti-pattern as the featured-slot bind. Fix: pass the tx client to recordEvent (write the audit row inside the transaction) or move recordEvent outside it.
- **Failing assertion:** createPostalEntry threw "A query cannot be executed on an expired transaction (5000 ms)"

