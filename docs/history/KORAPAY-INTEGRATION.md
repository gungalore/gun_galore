# KoraPay (Kora) — Technical Integration Investigation

**Status:** investigation only — no code written. Prepared 2026-07-17.
**Scope:** how Gun Galore (NestJS backend, Prisma, Next.js) would integrate Kora as a
pay-in + **third-party payout** rail, mapped onto the existing `StitchService` seam.

> Two commercial confirmations still gate go-live (not integration blockers, but do them
> in parallel): (1) will Kora onboard a SA **firearms** marketplace operating as a
> client-funds-holding TPPP? (2) does Kora do **ZAR card acquiring** for SA buyers, or is
> SA pay-in Instant-EFT-only? Kora marketing implies cards for SA; the dev docs say
> ZAR = EFT only. Design below assumes **EFT for ZAR collection**, with the hosted card
> channel wired behind a flag if/when Kora enables ZAR-card on the account.

---

## 1. API architecture

| Item | Value |
|---|---|
| Base host | `https://api.korapay.com` |
| Path prefixes | `/api/v1` (pay-with-bank/EFT charge, bulk payout) · `/merchant/api/v1` (card charge, charge verify, refunds, single disburse, banks, balances) |
| Auth | `Authorization: Bearer <SECRET_KEY>` on all server calls (`sk_test_…` / `sk_live_…`) |
| Public key | client-side only — used by the hosted checkout modal SDK |
| Encryption key | only needed for the RAW card API (AES-256-GCM). **Not needed** if we use EFT + hosted checkout → keeps PCI scope low |
| Test vs live | same host; distinguished by key mode. Sandbox has ZAR test bank accounts |
| SDKs | **no official Node SDK** — integrate via direct REST + manual webhook HMAC (same as our Stitch adapter) |

**Env vars to add** (mirror `STITCH_*`):
```
KORAPAY_API_URL=https://api.korapay.com
KORAPAY_PUBLIC_KEY=pk_live_...
KORAPAY_SECRET_KEY=sk_live_...
KORAPAY_WEBHOOK_SECRET=            # = secret key (Kora signs webhooks with the secret key)
```
(No separate encryption key unless we ever use the raw-card API. Payout IP-whitelisting is configured in the Kora dashboard, not via env.)

---

## 2. The integration seam in our codebase

Kora drops into the **exact adapter shape** we already have. `StitchService`
(`backend/src/payments/stitch.service.ts`) is injected as `this.stitch` and used in only a
handful of places:

| Method | Call sites |
|---|---|
| `createCheckout(...)` | `transactions.service.ts:766` |
| `getPaymentStatus(id)` | `transactions.service.ts:1262, 1347` |
| `verifyWebhookSignature(raw, headers)` | `transactions.service.ts:1294` |
| `parseWebhookEvent(body)` | `transactions.service.ts:1306` |
| `refundPayment(id, cents, reason)` | `transactions.service.ts:1982, 2195`; `admin.service.ts:1498`; `featured.service.ts:1066`; `dispatch-sla.service.ts:168` |

**Plan:** build `KorapayService` implementing the **same five methods** (near drop-in), plus
one method Stitch Express structurally cannot do:

- `disburse({ reference, amountCents, bankCode, accountNumber, accountName, email, narration })` — **programmatic ZAR payout to a third-party seller bank account.** This is the leg our current rail is missing (see the comment at `stitch.service.ts:363-367`: Express "withdrawal" only moves our own balance to our own bank).

The `Transaction.peachPaymentId` column already stores the provider payment reference in a
provider-agnostic way, so Kora's `reference` slots straight in. The money-state machine is
rail-agnostic — no schema change needed for collect/verify/refund. Payouts need a small
schema addition (below).

---

## 3. Endpoint-by-endpoint mapping to our flows

### 3.1 Collect (ZAR) — Instant EFT
`POST /api/v1/charge/pay-with-bank`
```jsonc
// request
{
  "reference": "<Transaction.id>",   // ≥8 chars, unique  (idempotency key)
  "amount": 14500,                    // ⚠️ CENTS per docs (1450 = R14.50) — VERIFY in sandbox
  "currency": "ZAR",
  "bank_code": "250655",             // buyer's bank (FNB shown); list below
  "customer": { "email": "...", "name": "..." },
  "merchant_bears_cost": false,       // false = buyer pays the fee
  "notification_url": "https://api.gungalore.co.za/api/payments/korapay/webhook"
}
// response
{ "status": true, "data": { "auth_data": { "redirect_url": "https://..." },
  "reference": "...", "status": "processing" } }
```
→ redirect the buyer to `data.auth_data.redirect_url`; they log into their bank and approve.
This replaces the Stitch `createCheckout` → `redirectUrl` shape 1:1.

SA bank codes (also `GET /api/v1/charge/pay-with-bank/banks`):
ABSA `632005` · African Bank `430000` · Bidvest `462005` · FNB `250655` · Investec `580105` · Nedbank `198765` · Standard Bank `051001` · TymeBank `678910`.
→ We must add a **bank picker** to checkout (Instant EFT needs the buyer's bank up front — unlike Stitch's single hosted link). Or use the hosted modal (§3.6) which renders the picker for us.

### 3.2 Verify (authoritative status) — reconciliation
`GET /merchant/api/v1/charges/:reference` → final `status`, `amount`, `currency`, `fee`.
Same role as `stitch.getPaymentStatus`. **Always verify server-side** after both the browser
return and the webhook (never trust the client). Success statuses: `success` (add `settled` if surfaced).

### 3.3 Webhook — `verifyWebhookSignature` + `parseWebhookEvent`
- Header: `x-korapay-signature`
- Value: **HMAC-SHA256 of ONLY `body.data`** (not the raw body), keyed by the **secret key**, hex.
  ```
  expected = hmacSHA256(JSON.stringify(req.body.data), SECRET_KEY).hex()
  timingSafeEqual(expected, header)
  ```
- Events: `charge.success` / `charge.failed` (pay-in) · `transfer.success` / `transfer.failed` (payout) · `refund.success` / `refund.failed`.
- Respond **200**; Kora retries for ~72h otherwise.
- `parseWebhookEvent`: pull `data.reference` (+ `data.status`, `data.payment_reference` for refunds), then re-verify via §3.2.

> ⚠️ **Signature gotcha** — Kora signs the **parsed `data` object re-stringified**, not the raw
> request bytes. This is more fragile than our Stitch Svix path (which HMACs the raw body):
> `JSON.stringify(req.body.data)` must reproduce Kora's exact serialization (key order/spacing).
> It generally works, but **must be validated in sandbox**, and the webhook route must capture
> `req.body` parsed (not rawBody) for the `data` object. Keep the fail-closed rule we use for
> Stitch: reject if `KORAPAY_WEBHOOK_SECRET` unset in production.

### 3.4 Refund — `refundPayment`
`POST /merchant/api/v1/refunds/initiate`
```jsonc
{ "payment_reference": "<original charge reference>",
  "reference": "<unique refund id>",   // idempotency
  "amount": 145.00,                     // ⚠️ omit for FULL; partial = amount. UNITS: verify (docs show major units)
  "reason": "..." }
```
- **Constraint: the original charge must be SETTLED first** — a refund can't be issued on an
  unsettled EFT payment. This needs an SLA in our order/cancel flow (mirrors the deal-aware
  refund-SLA note already tracked).
- Docs center on **NGN** (min 100); **confirm ZAR refund support + minimum + timing with Kora**
  before relying on instant buyer refunds.

### 3.5 Payout (NEW capability) — third-party seller disbursement
`POST /merchant/api/v1/transactions/disburse`
```jsonc
{ "reference": "<unique payout id>",            // ≥5 chars, idempotency
  "destination": {
    "type": "bank_account",
    "amount": 850.00,                            // ⚠️ MAJOR units, 2dp (R850.00) — NOT cents
    "currency": "ZAR",
    "narration": "Gun Galore payout <order ref>",
    "bank_account": { "bank": "250655", "account": "62xxxxxxxx",
                      "account_name": "SELLER NAME" },  // account_name REQUIRED for ZAR
    "customer": { "email": "seller@..." } } }
// response: data.status = processing → (webhook) success/failed, data.fee
```
- **Preflight with the Balance API** (`GET /merchant/api/v1/balances` → `data.ZAR.available_balance`)
  before disbursing — Kora pays out of the positive ZAR balance only.
- SA bank codes: `GET /merchant/api/v1/misc/banks?countryCode=ZA`.
- **No SA name-resolve** (Kora AVS is NG/KE only) → `account_name` is asserted by us. This matches
  our existing manual bank-ownership check; do **not** claim automated AVS.
- **Bulk**: `POST /api/v1/transactions/disburse/bulk` (2–50 per batch) for the daily payout run.

### 3.6 Optional — hosted checkout modal (card, if enabled for ZAR)
Load `https://korablobstorage.blob.core.windows.net/modal-bucket/korapay-collections.min.js`,
call `Korapay.initialize({ key: PUBLIC_KEY, reference, amount /* MAJOR units */, currency,
customer, channels: ["pay_with_bank","card"], notification_url, onSuccess, onClose, onFailed })`.
The modal renders the bank picker for us and (if Kora enables ZAR-card on the account) a card tab.
**Docs currently list modal `currency` as NGN/KES/GHS — ZAR not shown — so confirm ZAR renders on
the modal before relying on it.** Until then, server-driven pay-with-bank redirect (§3.1) is the
safe ZAR path.

---

## 4. Money lifecycle (collect → hold → pay seller → keep commission)

Kora has **no native escrow/split** — it's the same build-it-yourself model we already run,
which is fine because our money-state machine already owns hold/release.

1. **Collect** — buyer pays full ZAR order total via §3.1 (or §3.6). `charge.success` webhook → verify → mark `HELD`. Funds land in **our Kora ZAR balance**.
2. **Hold** — set settlement destination = Kora Balance (default) and don't auto-sweep. Our order state machine (accept → dispatch → delivered) governs release, exactly as today. *(Note: Kora may hold a 10% rolling reserve for 180 days — model this into payout liquidity.)*
3. **Release** — on release trigger, compute `sellerShare = orderTotal − commission`, `disburse()` (§3.5) only the seller share to their SA bank. Commission simply **stays in our Kora balance** (no native split needed).
4. **Refund** — via §3.4 (after settlement).

Zoho hooks (`ZohoBooksService`) stay unchanged — they fire off our own transaction state, not the provider.

---

## 5. Critical integration gotchas (must-handle)

1. **Amount units differ per endpoint.** Pay-with-bank charge = **cents** (docs), disburse + balance = **major units, 2dp**, hosted modal = **major units**. Our codebase is **cents-native**, so the adapter must convert cents→`(cents/100).toFixed(2)` for payouts/refunds. **Verify every endpoint's unit in sandbox** — the cross-endpoint inconsistency is the single biggest footgun.
2. **Webhook signs `data`-object-only** (parse+re-stringify), not raw body — validate serialization in sandbox; keep fail-closed.
3. **Refund-after-settlement** — buyer refunds can lag until the EFT settles; needs an SLA + "refund pending settlement" state.
4. **ZAR refund support unconfirmed** in docs (NGN-centric) — confirm with Kora.
5. **No SA AVS** — `account_name` asserted; keep our manual bank-ownership review; payout to a wrong-but-valid account is our risk.
6. **10% / 180-day rolling reserve** reduces available payout balance — the balance preflight (§3.5) must account for it so seller payouts don't fail for insufficient funds.
7. **Payout IP allow-listing** — the server's egress IP must be whitelisted in the Kora dashboard or disburse calls fail.
8. **Idempotency = the `reference`** on every charge/refund/payout (no separate Idempotency-Key header). Reusing a reference is rejected — reuse `Transaction.id` / a deterministic payout ref so retries are safe.

---

## 6. Phased plan (when/if approved — no build yet)

- **Phase 0 — de-risk (parallel, no code):** open sandbox; get written answers on (a) firearms/TPPP onboarding, (b) ZAR card acquiring, (c) ZAR refund support + min, (d) ZAR EFT settlement timing + the reserve terms; whitelist payout IP.
- **Phase 1 — collect adapter:** `KorapayService.createCheckout/getPaymentStatus/verifyWebhookSignature/parseWebhookEvent/refundPayment` behind a `PAYMENT_PROVIDER=korapay|stitch` flag; add the EFT bank picker to checkout; sandbox-verify amount units + webhook signature.
- **Phase 2 — payouts (the differentiator):** `disburse()` + balance preflight + payout schema fields (`payoutProvider`, `payoutReference`, `payoutStatus`) + `transfer.success/failed` webhook handling + idempotent payout reference. Wire into the existing `getPayoutsDue`/release path.
- **Phase 3 — scale + books:** bulk payout for the daily run; reconciliation via verify endpoints; confirm Zoho payout/receipt hooks fire correctly; run through the offline `dummy-run` harness.

**Effort:** Phase 1 ≈ small (adapter mirrors Stitch). Phase 2 ≈ the real work (new payout surface + reconciliation + schema). Nothing architecturally novel — the seam and money-state machine already exist.
