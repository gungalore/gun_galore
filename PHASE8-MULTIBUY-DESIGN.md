# Phase 8 — Inventory + Multi-Buy/Cart — Design & Migration Plan

> Status: **DESIGN FOR REVIEW — no code written.** Produced from a 4-area
> blast-radius map of the codebase (Transaction/money flow, Listing/inventory,
> checkout/cart/payment, promo/credit). Approve the approach before any build.

## Verdict up front

**Do NOT widen `Transaction`.** Layer a new **`Order` + `OrderLineItem`** above
the existing `Transaction`, and **fan one Order out into N Transactions (one per
seller)**. Each `Transaction` stays exactly what it is today — one seller, one
sub-order — so every Phase 1–7 money / payout / dispatch / SAPS-534 / Zoho path
keeps working untouched. This single decision makes the whole epic **additive**.

The raffle `buyTickets` flow already proves the pattern: one Stitch capture
settling N child rows. We generalize that proven shape to the marketplace.

---

## 1. Target data model

A `Transaction` remains a single seller's slice. The new Order layer owns only
what is genuinely cross-seller: **cart assembly, ONE payment capture, discount
allocation, and an aggregate buyer-facing status.** Everything below the Order
line is the per-seller code you already trust (atomic reserve, markPaid,
firearm gate, per-seller payout, Zoho invoice, dispatch SLA, fraud scoring).

**New tables (additive):**
- `Order` — buyerId, status (DRAFT|AWAITING_PAYMENT|PAID|PARTIALLY_FULFILLED|COMPLETED|CANCELLED|REFUNDED), paymentMethod (MANUAL_EFT|STITCH), ONE `stitchPaymentId @unique` / `orderReference @unique`, money snapshot (itemsSubtotal, shippingSubtotal, processingFee, discountTotal, buyerTotal), voucher/store-credit fields, `transactions Transaction[]`, `lineItems OrderLineItem[]`.
- `OrderLineItem` — orderId, transactionId?, listingId, sellerId (denormalized), quantity, unitPrice, lineSubtotal, discountAllocated.

**Additive fields on existing models (all defaulted — legacy rows unaffected):**
- `Transaction.orderId String?` (null for ALL Phase 1–7 rows), `Transaction.quantity Int @default(1)`.
- `Listing.quantityAvailable Int @default(1)` (default 1 == today's behavior bit-for-bit), `Listing.quantityReserved Int @default(0)`.

**Fan-out:** `POST /orders/checkout` (one Prisma `$transaction`) groups line items
by sellerId → calls the **existing** per-seller transaction-create logic once per
seller. The Order owns the single capture + discount; per-seller payout/firearm
gate/refund stay per-Transaction (exactly the granularity the maps require).

---

## 2. Backward-compatibility

Every change is additive; the legacy path is the `orderId == null` path.
1. Legacy transactions untouched (`orderId` null, `quantity` 1); old `POST /transactions` stays live + unchanged.
2. `Listing.quantityAvailable` defaults to 1 → existing ACTIVE→PAYMENT_PENDING→SOLD machine fires identically for qty-1.
3. Refactor `create()` so its reserve+fee+persist body is callable with `{ orderId?, quantity }`; single-item checkout passes `orderId=null, quantity=1` — no behavior change.
4. Seller statement, admin export, Zoho, dispatch SLA keep querying `Transaction` by `sellerId` — they don't care about `orderId`; they show one seller's slice, still correct.
5. Migration = `ADD COLUMN` (defaults) + `CREATE TABLE` — no backfill, reversible. Deploy: `prisma generate` before build (per memory).

---

## 3. Inventory

Quantity on `Listing.quantityAvailable`/`quantityReserved`; consumption per child `Transaction.quantity`.

**Stay qty-1 (hard):** firearms (1 serial = 1 SAPS 534 = 1 dealer chain — reject qty>1 as a compliance alarm), auctions, TAKE_A_SHOT (defer multi-qty offers). **Only BUY_NOW non-firearm gets real `quantityAvailable > 1`** (component/ammo/accessory stock).

**Atomic decrement** = generalize the FIX-2 conditional `updateMany` to a counter compare-and-set, run inside the Order's one `$transaction`, **all-or-nothing** (one failed line rolls back the whole cart — no partial locks). Flip SOLD only when `quantityAvailable==0`; on cancel/refund decrement reserved + reactivate only if stock remains. Add `quantityAvailable`/`isSoldOut` to Meilisearch; browse filters `quantityAvailable > 0`.

---

## 4. Promo / voucher / store-credit (greenfield — nothing exists today)

New tables: `Voucher`, `VoucherRedemption`, `UserStoreCredit`, `StoreCreditLedger`.

**Decision: the PLATFORM absorbs the discount.** Commission + seller payout are
computed on the **full** listing price — `FeeCalculator` needs **no new
parameter** and no per-seller change. The discount reduces only the buyer side at
the Order layer: `buyerTotal = itemsSubtotal + shippingSubtotal + processingFee − discountTotal − storeCreditUsed`.
Rationale: predictable seller payouts (no disputes/support load); a GG promo is a
marketing cost GG owns, not a seller tax.

Integrity: snapshot discount/credit/redemption at create inside the reserve
`$transaction`; reserve voucher / debit credit atomically with stock; roll all
back together on a failed charge; refunds restore proportional voucher/credit;
re-checkout idempotent (`[voucherId,userId,orderId]` unique); commission base
stays the full price.

---

## 5. Payment-method choice

Buyer picks at the **Order** level: `Order.paymentMethod` = MANUAL_EFT | STITCH
(one capture per cart; per-item choice is overkill). Keep the `PAYMENT_MODE` env
var as the allowed-set gate (don't flip prod env mode without operator OK).
MANUAL_EFT → one `orderReference` for the whole cart; reconciliation matches the
Order reference + buyerTotal, then distributes to each child `markPaid`. STITCH →
one `createCheckout(order.buyerTotal, merchantTransactionId: order.id)`; webhook
loops `markPaid` over children (same as raffle `confirmTickets`).

---

## 6. Phased build sequence (lowest-risk first, each independently shippable)

| Sub-phase | Scope | Money-path test focus |
|---|---|---|
| **8a** Quantity on single-item BUY_NOW | Listing qty fields + `Transaction.quantity` + counter-CAS reserve. **No Order table yet** — qty-3 buy = one `Transaction(quantity=3, orderId=null)` | concurrent racers on last unit (no oversell); refund restores stock; firearm/auction qty>1 rejected; Meili drops sold-out |
| **8b** Order layer, single seller | `Order`+`OrderLineItem`; `/orders/checkout` constrained to one seller (fan-out N=1); "My Orders" UI | one capture == sum of lines; EFT ref matches total; partial line refund; idempotent re-checkout |
| **8c** Promo/voucher/store-credit | 4 promo tables; discount at Order layer (platform-absorbs) | commission on full price (payout unchanged); buyerTotal == capture; voucher reserve/release atomic; refund restores; double-apply blocked |
| **8d** Multi-seller cart | group by seller → N child transactions in one `$transaction`; one capture → N `markPaid` | per-seller payouts sum to capture; seller A releases while B's firearm pending; per-seller refund = one Zoho credit note; SLA strike only the late seller |
| **8e** Payment-method choice UI | MANUAL_EFT vs STITCH on checkout, env-gated | ship last; money paths already proven |

---

## 7. Invariants to protect
1. **No oversell** — counter-CAS reserve in one `$transaction`, all-or-nothing. THE invariant.
2. **Split-payout** — `sum(child sellerPayout) + sum(commission) + processingFee + discountTotal + storeCreditUsed == order.buyerTotal == capture`. Assert at create + a reconciliation cron.
3. **Firearm qty-1 + per-seller gate** — firearm never qty>1; one firearm's pending DEALER_TRANSFER holds only its seller's child tx (free with Order-over-Transaction; never regress to an order-level gate).
4. **Refund scope** — refunds scoped to a child transaction (one seller); Order → PARTIALLY_REFUNDED; never auto-refund siblings; restore proportional voucher/credit.
5. **Discount snapshot + idempotency** — snapshot at create; capture uses snapshot; failed charge rolls back stock+voucher+credit together.
6. **Single-capture integrity** — `stitchPaymentId`/`orderReference` unique; webhook idempotent on (orderId, paymentId).

---

## 8. Recommendation

**Build 8a + 8b + 8c first; treat 8d (multi-seller cart) as a separate go/no-go epic.**
- **8a (quantity)** = highest value-to-risk; unlocks real inventory; additive; no cross-seller logic. Ship alone.
- **8b + 8c** = most of the buyer-experience win (single-seller multi-item cart + vouchers + store credit) while staying inside Phase 1–7's proven one-seller-per-Transaction envelope. Store credit is also a strong retention lever.
- **8d** concentrates the genuine new risk (one capture → N payouts, mixed firearm/non-firearm carts, per-seller refund/dispatch/SLA, N Zoho invoices). The architecture makes it tractable (loop existing code, not a rewrite) but it warrants its own design review + reconciliation tests + a SAPS/dealer sign-off on mixed-cart firearm handling. Recommend shipping 8a–8c, gathering real demand data on cross-seller carts, then committing to 8d only if justified.

Stopping after 8c is a clean, coherent product — not a half-built bridge. 8d slots in additively on top whenever chosen.
