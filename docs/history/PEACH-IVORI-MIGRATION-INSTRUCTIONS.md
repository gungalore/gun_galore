# Gun Galore — Payment Migration Instruction Sheet
## Remove EFT completely · Pay-in via Peach Payments · Pay-out via Ivori
### For the implementing Claude Opus 4.8 session

**Date:** 2026-07-09 · **Operator decision (locked):** Gun Galore will use **Peach Payments and Ivori to receive and make payments. Manual EFT is removed COMPLETELY — both for receiving money (buyer payments) and making payments (seller payouts + buyer refunds).**

**Companion docs (read both before starting):** `CLAUDE.md` (house rules) and `ADMIN-AUDIT-REPORT.md` (ADM-0…ADM-10 — Phase 6 below re-scopes it for the no-EFT world). The repo is `C:\dev\gun-galore` (backend NestJS + Prisma, frontend Next.js App Router; prod = Vultr VPS via ssh alias `gungalore`, pm2, branch currently `feat/takealot-ux-parity`).

---

## 0. Non-negotiable rules for the implementing session

1. **Every phase below is money code.** Adversarial-review each phase before deploy. Deploy each phase separately, each gated on explicit operator approval. Never deploy pay-in and pay-out changes in the same reload.
2. **Sandbox first, always.** Build and verify everything against Peach/Ivori **sandbox/test** credentials. Do NOT flip to production credentials or change `PAYMENT_MODE` on prod without the operator explicitly saying so (standing rule: never flip sandbox/prod modes unilaterally).
3. **Never use the word "escrow"** in any UI copy, email, SMS, or legal text — say "funds held" / "payment held".
4. **Additive migrations only.** Never drop the manual-rail tables (`ManualPayment`, `StatementUpload`, `PayoutBatch`, EFT columns on `Transaction`) — they hold financial history (SARS retention). Remove *code paths and UI*, keep *data*.
5. Deploy sequence: `git push` → `ssh gungalore` → `cd /home/gungalore/app && git pull --ff-only` → (`npx prisma migrate deploy` + `npx prisma generate` if schema changed) → **build DETACHED via `setsid`** → `pm2 reload` → verify `pm2` restarts flat + uptime growing + `curl` home & `/api/categories` 200. A green migrate ≠ app up.
6. Any new admin controller outside AdminModule MUST import `JwtModule.register({})` + provide `AdminJwtGuard`, or the backend crash-loops at boot.
7. **Run the dummy-run harness before every deploy** (`backend`: `npm run dummy-run:setup` once, then `npm run dummy-run`). Phase 7.1 updates the harness for the gateway rail FIRST so this stays possible.
8. The operator is not a coder: when you need anything from them (credentials, dashboard settings, test cards), give exact step-by-step instructions and complete ready-to-run PowerShell commands.
9. Usernames only on public surfaces — never real names. POPIA discipline on any new surface.

---

## 1. Phase 0 — Operator inputs → **PLACEHOLDER POLICY (adopted 2026-07-09)**

**Operator instruction: "just add placeholders for everything for now."** Phase 0 is therefore NOT blocking. Build the ENTIRE migration against the placeholder values below — complete code paths, complete UI, complete tests — and keep it inert on prod (prod stays `PAYMENT_MODE=manual` until the real values are swapped in and the operator orders cutover). Do not stop to ask for any of these; do surface the swap-in checklist (§1c) when the build is done.

| # | Input | **PLACEHOLDER to build with (provisional — confirm at cutover)** |
|---|-------|------------------------------------------------------------------|
| 0.1 | Role split | **Peach = pay-in** (card checkout + card refunds), **Ivori = pay-out** (bank disbursements, Nedbank TPPP leg). Keep the seam clean so swapping roles later is a config change, not a rewrite. |
| 0.2 | Peach product + credentials | Hosted **Checkout** (SAQ-A, never touch PAN). Credentials = placeholder env keys (§1b). Build the client against Peach's public sandbox API shape; if any endpoint detail is unknowable without creds, isolate it behind one adapter method with a `// PLACEHOLDER-VERIFY` comment. |
| 0.3 | Ivori API | Assume a REST disbursement API (create payout → poll/webhook status). Build the adapter against that assumed shape behind ONE interface (`PayoutProvider`), every assumption tagged `// PLACEHOLDER-VERIFY`. Also implement the fallback in the same interface: `IvoriFileProvider` that emits a generic bank-batch CSV + mark-paid (mirrors today's FNB flow) — so if Ivori turns out to be dashboard-only, cutover still works by flipping `PAYOUT_PROVIDER=file`. |
| 0.4 | Payment methods | Card ON, PayJustNow BNPL ON behind flag `CHECKOUT_ENABLE_PAYJUSTNOW=true` (Settings-toggleable). |
| 0.5 | Card processing fee | **3.0% `passFeeToBuyer` (PLACEHOLDER)** — wire it as a Settings key `GATEWAY_PROCESSING_FEE_PERCENT` (default 3.0) + `GATEWAY_FEE_PAYER=buyer`, NOT a hardcoded constant, so the operator's real number is a Settings edit. Keep the 1.5% manual constant untouched for historical rows. |
| 0.6 | Checkout reservation window | **60 minutes** — Settings key `GATEWAY_RESERVATION_MINUTES` (default 60). |
| 0.7 | Cutover mode | **Hard cutover + 7-day EFT drain-down** (§5.1). |
| 0.8 | Payout cadence | **Auto-draft daily batch + one-click operator approval to execute** (human stays on the money button). Settings key `PAYOUT_AUTODRAFT_HOUR` (default 8). |

### 1b. Placeholder env keys (add to `.env.example` + prod `.env` with these exact inert values)

```
# ── Peach Payments (pay-in) — PLACEHOLDERS, replace at cutover ──
PEACH_BASE_URL=https://sandbox.peachpayments.example   # PLACEHOLDER
PEACH_ENTITY_ID=PLACEHOLDER_NOT_SET
PEACH_API_KEY=PLACEHOLDER_NOT_SET
PEACH_WEBHOOK_SECRET=PLACEHOLDER_NOT_SET
# ── Ivori (pay-out) — PLACEHOLDERS, replace at cutover ──
IVORI_BASE_URL=https://sandbox.ivori.example           # PLACEHOLDER
IVORI_API_KEY=PLACEHOLDER_NOT_SET
IVORI_WEBHOOK_SECRET=PLACEHOLDER_NOT_SET
PAYOUT_PROVIDER=ivori                                  # ivori | file
```

**Fail-closed rule (mirror FIX-4):** the gateway/payout services MUST detect `PLACEHOLDER_NOT_SET` / `.example` hosts and (a) refuse to make ANY outbound call, (b) log one clear `WARN gateway placeholder mode — inert`, (c) throw a clean 503 "payments temporarily unavailable" if a checkout is somehow attempted on the gateway lane. In `NODE_ENV=production` with `PAYMENT_MODE=peach`, placeholder values must **fail the boot assert** — it must be impossible to cut over on placeholders by accident. The dummy-run harness keeps these keys BLANK (not placeholder) per its existing safety model.

### 1c. Swap-in checklist (run when the operator delivers real values — the ONLY remaining manual step)

1. Replace the §1b placeholder keys with real **sandbox** creds → run the full sandbox test plan (§8.2–8.3) → fix any `PLACEHOLDER-VERIFY` mismatches against the real API docs.
2. Operator confirms/corrects the §1 provisional decisions (role split, fee %, window, cadence) — each is a Settings/env edit by design.
3. Replace sandbox creds with **production** creds (operator supplies; never committed).
4. Execute the cutover runbook (§8.5). Only now does `PAYMENT_MODE=peach` go live on prod.

### 1d. Information-required worksheet — fill in as each value arrives

This is the single list of everything **we still need** before cutover. Until a value
is supplied, the code runs on the §1b placeholder and the gateway stays inert — so the
whole build can proceed now and these get filled in later.

> ⚠️ **SECURITY — this file is committed to git. NEVER paste a real API key, secret, or
> password here.** For secrets, only tick the status box and write where it now lives
> (e.g. "in prod `.env`"). Non-secret config (URLs, entity IDs, account numbers, and the
> decision values) is safe to write in the blanks. Secrets are handed over out-of-band
> (operator pastes them straight into prod `.env` / the Peach/Ivori dashboards).

Status key: ⬜ not yet provided · ✅ provided · 🔒 secret (received, stored in `.env`, NOT written here)

#### A. Peach Payments — pay-in (from the Peach merchant dashboard / onboarding contact)
- Peach contact / account manager name + email: `__________________________`
- Which Peach product confirmed (Hosted Checkout recommended): `__________________________`
- Sandbox base URL: `__________________________`
- Sandbox Entity ID(s) (card / BNPL may differ): `__________________________`
- Sandbox API key: 🔒 ⬜  (→ prod `.env` `PEACH_API_KEY`)
- Sandbox webhook signing secret: 🔒 ⬜  (→ `PEACH_WEBHOOK_SECRET`)
- Production base URL: `__________________________`
- Production Entity ID(s): `__________________________`
- Production API key: 🔒 ⬜
- Production webhook signing secret: 🔒 ⬜
- Webhook callback URL to register in Peach (we host it): `https://gungalore.co.za/api/transactions/webhook/peach`
- Peach webhook signature scheme / header name (from their docs): `__________________________`
- Test cards supplied for sandbox (success / decline / 3DS): `__________________________`

#### B. Ivori — pay-out (from Ivori onboarding, tied to the Nedbank TPPP relationship)
- Ivori contact name + email: `__________________________`
- **Does Ivori expose a disbursement API, or dashboard-only?** (decides `PAYOUT_PROVIDER=ivori` vs `file`): `__________________________`
- Sandbox base URL: `__________________________`
- Auth model (API key header / OAuth / mTLS — from their docs): `__________________________`
- Sandbox API key/secret: 🔒 ⬜  (→ `IVORI_API_KEY`)
- Payout status webhook secret (if any): 🔒 ⬜  (→ `IVORI_WEBHOOK_SECRET`)
- Production base URL: `__________________________`
- Production API key/secret: 🔒 ⬜
- Create-disbursement endpoint path: `__________________________`
- Payout status endpoint / webhook path: `__________________________`
- Per-payout limit / per-batch limit / daily cap: `__________________________`
- Settlement / float account details Ivori pays from: `__________________________`
- Does Ivori do account-name verification (CDV) on the payee? (affects the ADM-5 manual-AVS gate): `__________________________`

#### C. Nedbank merchant (the acquiring side — from the TPPP onboarding, Nadia Geyer)
- Merchant number / MID: `__________________________`
- Settlement bank account (where Peach settles card takings): `__________________________`
- Onboarding status / go-live date confirmed by Nedbank: `__________________________`

#### D. Decisions to confirm (provisional defaults are already built in — see §1 table)
- Role split — Peach pay-in + Ivori pay-out? (default assumed): `☐ confirmed  /  correction: __________`
- Card processing fee % + who pays (default **3.0%, buyer**): `______ %  ·  payer: __________`
- PayJustNow BNPL at checkout — enable? (default ON): `☐ yes  ☐ no`
- Checkout reservation window (default **60 min**): `______ min`
- Payout cadence (default **auto-draft daily + 1-click approval**): `__________________________`
- Cutover mode (default **hard cutover + 7-day EFT drain**): `__________________________`
- Any other Peach payment methods to enable: `__________________________`
- Zoho deposit-account mapping change confirmed with bookkeeper? (§7): `☐ yes  ☐ n/a`

#### E. Cutover logistics
- Chosen cutover date/evening: `__________________________`
- Operator card to run the live R10 test purchase + refund: `☐ ready`
- One real seller row to test the first Ivori payout against: `__________________________`

**When a section is complete**, run the matching part of the §1c swap-in checklist. Secrets marked 🔒 go
directly into prod `.env` (fail-closed asserts at boot per §1b) — they are never written above.

---

## 2. Architecture — the gateway seam (build once, everything hangs off it)

The codebase already has a single gateway seam from the old Stitch integration — **reuse it, don't invent a parallel one**:

- `backend/src/payments/stitch.service.ts` — the only file that talks to a card gateway (create payment, verify, `refundPayment`). **Replace its internals with Peach** (keep the injection points; rename to `peach.service.ts`/`PaymentGatewayService` and update the ~injection sites, or keep the class name as a thin façade — implementer's choice, but ONE seam).
- `Transaction.peachPaymentId` (with `@unique` idempotency guard) already exists across the schema — the field name even matches. Same for `FeaturedSlotBid.peachPaymentId`, raffle `Ticket.peachPaymentId`.
- Webhook: `POST /api/transactions/webhook/stitch` (`transactions.controller.ts:529`) → `handleChargebackEvent` + payment events. Re-point to `webhook/peach` with **Peach's signature scheme, fail-closed, rawBody HMAC** (the FIX-1 hardening pattern is already in place — keep amount+id binding and atomic status transitions).
- `PAYMENT_MODE` is exported from `payments/transactions.service.ts` and branched on in **12 files / 60 sites** (transactions, admin refunds, manual-payments, dispatch-sla, featured, raffles, swaps ×2, subscriptions ×2 + specs). Introduce `PAYMENT_MODE=peach` (or `gateway`) and work through every branch: the `'manual'` lane is deleted (Phase 5), the gateway lane becomes the only lane. **Grep fresh — do not trust this list:** `grep -rn "PAYMENT_MODE" backend/src` and `grep -rn "MANUAL_EFT\|GG_BANK_DETAILS\|orderReference" backend/src frontend/`.
- **Keep everything gateway-neutral behind the seam** (standing rule): no Peach-specific types outside the gateway service + webhook controller.

### Pay-in flow (target state, all lanes)
1. Buyer hits checkout → backend creates the DB row exactly as today (reserve listing → tx/order PENDING) → calls `gateway.createCheckout(amountCents, orderReference, metadata)` → returns redirect/checkout URL.
2. Buyer pays on Peach-hosted page → Peach webhook fires → verify signature → verify amount + reference binding → call the **existing rail-agnostic confirm** for that lane (`confirmManualPayment`'s successor, `confirmManualOrder`'s successor, `confirmSlotPayment`, `confirmSwapFunding`, subscription confirm, raffle `confirmTickets`) — generalise each `confirm*Manual*` into a `paymentConfirmed()` entrypoint that both the old reconciler (during drain-down) and the webhook call. Money state machine (HELD → accept → dispatch → deliver → RELEASED) is untouched.
3. Redirect-back page polls a verify endpoint (never trusts the redirect alone — gate on server-verified `success===true`, the FIX-8 rule).

### The 9 pay-in lanes to wire (each is a checklist item; most share lane 1's plumbing)
| Lane | Today's manual confirm | Notes |
|------|------------------------|-------|
| 1. BUY_NOW / offers / auction-winner tx | `confirmManualPayment` | Core lane — build first, everything else follows its pattern |
| 2. Multi-seller Order | `confirmManualOrder` (fan-out) | One checkout, one webhook → atomic fan-out (race-safe fan-out already exists) |
| 3. Take-a-Shot converted offer | same as 1 via offer checkout | Price binding already enforced |
| 4. Experiences (ON_SITE_SERVICE) | same as 1 | CPA-s17 cancellation then refunds via gateway (Phase 3) |
| 5. Subscriptions MEMBER/PRO | `subscriptions` confirm + sweep | Charge model stays prepaid single charge; renewal = new checkout |
| 6. Featured-slot fees | `confirmSlotPayment` | Bid → checkout → webhook → slot OCCUPIED. Removes the AUDIT-H1 prod block on paygate binding (`featured.service.ts` NODE_ENV guard) — delete that block when live |
| 7. Raffle tickets | `confirmTickets` (built, dormant — "gateway rail only") | This lane finally goes LIVE (pending task #69). CPA s36 free postal route unchanged |
| 8. Swap funding (two legs, both parties) | `confirmSwapFunding` ×2 | Two independent checkouts; refund-if-one-fails becomes a gateway refund |
| 9. Ballistics one-off purchase (if still sold) | check `ballisticsPurchasedAt` flow | Verify whether it has a manual lane; wire if so |

---

## 3. Phase 1+2 — Pay-in (Peach) then refunds (Peach)

**Phase 1 (pay-in):** implement §2 for lanes 1–3 first (core marketplace), then 4–9. Per-lane acceptance: sandbox card payment end-to-end → webhook confirms → money state correct → duplicate webhook is a no-op (idempotency on `peachPaymentId` unique) → wrong-amount webhook is rejected + alerted → checkout abandoned → reservation auto-releases at the §1-0.6 window.

**Phase 2 (refunds):** the admin refund path is already rail-aware (`admin.service.ts:1331-1625`): manual mode mints a synthetic `REFUNDED` child for the FNB batch; card mode calls `gateway.refundPayment`. Target state:
- Every refund flow calls **Peach refund** (full + partial — partial refund plumbing exists) and only marks REFUNDED on gateway success (FIX-3 rule: gateway first, then status flip). Keep the synthetic REFUNDED child as the **ledger record** (analytics/Zoho/held-funds depend on it) but it no longer enters any payout batch.
- **CRITICAL double-refund guard:** the old rule "refunds gated to PAYMENT_MODE=manual" existed because a card gateway reverses the card itself. Invert it cleanly: on the gateway rail, the FNB/Ivori disbursement path must NEVER pay a buyer refund — buyer refunds go to the card only. Assert this in `collectDue` (exclude refund children when mode=gateway) and add a test.
- Flows that gain automatic refunds (they have `peachPaymentId` now): dispatch-SLA auto-refund, sale-reject refund, buyer-cancel refund, swap one-side-failed reimbursement, **raffle refund-all** (per-ticket gateway refunds — kills the ADM-4 raffle hole), **featured force-evict refund** (kills `MANUAL_REFUND_OWED`), experience s17 splits, chargeback handling.
- Buyer bank-details capture at refund time (FLOW-F2) becomes unnecessary for card refunds — remove the capture step from the refund flow (sellers still need bank details for payouts). Handle the edge: refund attempted after card expired/closed → Peach refund fails → alert + fall back to "contact support" queue (this is the residual refunds-owed case ADM-4 still covers).

---

## 4. Phase 3 — Pay-out via Ivori (replaces the FNB CSV batch)

Today: `getPayoutsDue`/`collectDue` (`manual-payments.service.ts:833-1011`) → freeze-on-download FNB CSV → operator pays in FNB → mark-paid. Target:

1. **Keep** `collectDue` and every gate exactly as-is: seller bank details present, `kycStatus=VERIFIED`, `profileCompletedAt`, `payoutHeldAt` hold lever, skipped-rows reporting. Add the ADM-5 `bankVerifiedAt` first-payout manual-AVS gate while you're in here (name-vs-KYC compare screen sets it; `collectDue` requires it for a seller's FIRST payout).
2. **Keep** the `PayoutBatch` model as the grouping + audit record. Replace CSV freeze/download with: create batch (frozen) → per-row **Ivori disbursement API call** → poll/webhook status per row → row-level success stamps `paidOutAt` (existing atomic mark-paid semantics, now per-row) → batch completes when all rows terminal.
3. **Failure handling per row:** invalid account / name mismatch / Ivori reject → row flagged, alert raised (ADM-1 inbox), batch continues. No all-or-nothing batches.
4. **Human on the button (per §1-0.8):** auto-draft the batch daily; execution requires one operator click ("Pay R X to N sellers via Ivori") with typed confirmation. Log every execution to `AdminAuditEvent` (fixes the silent-release audit gap at the same time).
5. Zoho hooks unchanged in shape: payout executed → mark invoice paid + drain Client Funds Payable (existing ZB-5 hook) — re-point the trigger from mark-paid-button to Ivori-success.
6. The 09:00 payout reminder cron becomes "auto-draft + notify operator via ADM-2 channel".

---

## 5. Phase 4 — Remove the EFT rail completely

### 5.1 Drain-down window (7 days, cutover day = D)
- **D+0:** `PAYMENT_MODE=peach` on prod (operator flips) — all NEW checkouts are card-only; the EFT banking screen is no longer reachable for new orders. Keep the inContact scanner + statement upload + reconciler running so any in-flight EFT (buyer already given a reference) still confirms.
- **D+7 (operator confirms zero in-flight):** remove the EFT machinery.

### 5.2 Rip-out list (code + UI; data stays)
- **Crons:** `scanInContactInbox` (incontact-scan), `manualPaymentFreezeSweep` (manual-freeze-sweep — replaced by the short gateway reservation sweep), `payoutDueReminder` (replaced per §4.6). Remove from `tasks.service.ts` AND from the health-monitor definitions you'll have added in Phase 6.
- **Backend:** IMAP scanner service + parser, statement CSV upload endpoint + reconciler write-paths (`matchOrder` etc. — keep read endpoints for historical viewing or archive the page), EFT order-reference *banking-instruction* generation (keep `orderReference` itself — it's the universal order ref used in receipts/Zoho/support).
- **Frontend:** banking-details checkout screen + re-view banking screen, "how to pay by EFT" copy, payment-countdown EFT notifications, `/admin/manual-payments` page reduced to: payout batches (now Ivori), refunds-owed residuals, Zoho failed-sync, held-funds report, + a read-only "EFT history (legacy)" tab.
- **Copy/legal sweep:** every email/SMS/receipt/FAQ/terms/refund-policy mention of EFT payment or "we will EFT your refund" → card-rail language ("refunded to your original payment method"). Grep `frontend/` and `notifications.service.ts` for `EFT|bank transfer|banking details|reference number`.
- **Env:** IMAP_* keys removed from prod .env; `GG_BANK_DETAILS` constant removed from checkout paths (bank account may still appear on invoices if the operator wants — ask).
- **Do NOT remove:** `ManualPayment`/`StatementUpload`/`PayoutBatch` tables or their rows; the synthetic REFUNDED/RELEASED child mechanic; `orderReference`; the fee calculator's history of manual fees on old rows.

---

## 6. Phase 5 — Admin fixes (ADMIN-AUDIT-REPORT.md re-scoped for no-EFT)

Work the ADM batches in their stated order, with these changes:

| Batch | Status on the card rail |
|-------|------------------------|
| **ADM-0** quick fixes | **Unchanged — do first.** All 9 items are rail-agnostic. |
| **ADM-1** AdminAlert inbox | **Unchanged — critical.** Chargebacks now make this MORE urgent: on the card rail `handleChargebackEvent` alerts become live traffic. |
| **ADM-2** notify channel | **Unchanged — critical.** Add gateway events to the urgent tier: webhook signature failure, amount mismatch, refund-API failure, Ivori payout-row failure, chargeback. |
| **ADM-3** EFT exception desk | **DROPPED** (no EFT). Replace with a thin **Gateway exceptions view**: orphan webhooks (payment id matches nothing), amount mismatches, refund failures, checkout-expired-but-webhook-arrived races. Much smaller than ADM-3. |
| **ADM-4** refunds-owed ledger | **SHRUNK.** Raffle/featured/subscription refunds become automatic gateway refunds (Phase 2). Keep a small residual ledger for gateway-refund FAILURES only (expired cards etc.). |
| **ADM-5** compliance + audit | **Unchanged** — manual-AVS/`bankVerifiedAt` is folded into Phase 3 payouts; the rest (central audit for release/refund/dealer-override/swap actions, firearm pipeline queue, licence-expiry view, AML flag) as written. |
| **ADM-6** health completion | **Unchanged** + add: Peach API probe, Ivori API probe, webhook-delivery freshness (minutes since last webhook while checkouts are being created), and REMOVE incontact-scan after §5.2. |
| **ADM-7** stuck-state levers | Mostly unchanged. Drop the EFT-specific paid-after-freeze case. Keep: swap AWAITING_FUNDING wedge, undersold-raffle deadline (refund-all is now automatic, so the deadline sweep can safely offer one-click cancel+refund), order-level unwind, experience levers, dispatchSlaAtRisk split. |
| **ADM-8** automation | Drop 8.4 (statement ingest — obsolete). Keep Zoho auto-retry-all, re-moderate-on-edit, stale-listing nudges, support drafts, TCG tracking poll. 8.3 payout auto-draft is absorbed into Phase 3. |
| **ADM-9** UX/controls | Unchanged (isExperience toggle, category attributes UI, Meilisearch panel, Ask GG cost dashboard, per-seller remittance — remittance now renders from Ivori batch rows). |
| **ADM-10** auth hardening | Unchanged. Do before go-live on the card rail if possible — a hijacked admin session can now trigger real card refunds. |

---

## 7. Phase 6 — Fees, Zoho, analytics

- `fee.calculator.ts`: replace the manual 1.5% processing fee with the operator's §1-0.5 answer. Invariant to preserve everywhere (incl. dummy-run `money.ts` oracle): `buyerTotal = listingPrice + shipping + (passFee ? processingFee) + R15 handling`.
- Zoho: deposit-account mapping likely changes (Peach settlement account vs FNB direct) — confirm with operator/bookkeeper; processing-fee revenue line (P0.7) keeps working with the new %.
- Analytics: while in there, apply the two ADM-9 honesty fixes (refund-rate cohort mismatch; "paid today" vs "released today" on the pulse).
- Chargebacks: adapt `handleChargebackEvent` to Peach's dispute webhook events; it already does the right state work (HELD→DISPUTED, block payout, alert after-payout cases).

## 8. Phase 7 — Testing & cutover

1. **FIRST: update the dummy-run harness** (`backend/scripts/dummy-run*`) or it blocks every deploy: `assertSafeEnv` currently REQUIRES `PAYMENT_MODE=manual` — change to require `peach` with `PEACH_*`/`IVORI_*` keys BLANK; add a no-op gateway stub (checkout returns fake id; refund/payout resolve success) in `installStubs`; keep all 12 module drivers green + money conserved to R0. The harness is the regression gate for this whole migration.
2. Sandbox E2E per lane (§2 table) with Peach test cards: success, declined, abandoned, duplicate webhook, wrong amount, partial refund, full refund, chargeback simulation. Webhook delivery to a public endpoint — test against a staging path on the prod box or a tunnel; remember Cloudflare fronts prod (exclude `/api/transactions/webhook/*` from any caching/bot rules; Nest rawBody is already configured).
3. Ivori sandbox: single payout, batch of 3, one forced failure row, name-mismatch behaviour.
4. Full dummy-run green + tsc clean + adversarial review sign-off per phase.
5. **Cutover runbook (operator-approved, one evening):** DB backup → deploy Phase-1+2 code (inert behind flag) → operator flips Peach prod credentials + `PAYMENT_MODE=peach` → live R10 test purchase + refund by operator → monitor `pm2` + webhook log 24h → Phase-3 payout of one real seller row via Ivori with operator watching → drain-down clock starts → D+7 rip-out deploy.
6. Update `CLAUDE.md` (payment rail section) + push in the same commit as each phase's code. Update the memory files noted in `MEMORY.md` if the session has memory access.

---

## 9. Suggested working order (one phase = one deployable, reviewed unit)

| Order | Work | Depends on |
|-------|------|-----------|
| 1 | Phase 0 placeholders (§1 — already adopted; nothing to collect) | — |
| 2 | Phase 7.1 dummy-run harness gateway stub | — |
| 3 | ADM-0 quick fixes (independent, warms up the admin surface) | — |
| 4 | Phase 1 pay-in, lanes 1–3 | 1,2 |
| 5 | Phase 2 refunds | 4 |
| 6 | Phase 1 remaining lanes 4–9 | 4 |
| 7 | Phase 3 Ivori payouts (+manual-AVS gate) | 5 |
| 8 | ADM-1 + ADM-2 (alert inbox + notify channel, incl. gateway events) | — (parallelisable) |
| 9 | Swap-in checklist (§1c: real creds + confirm provisional decisions) then cutover + drain-down (Phase 7.5) | 4–7 + operator |
| 10 | Phase 4 EFT rip-out | 9 + D+7 |
| 11 | Remaining ADM batches per §6 table | 10 |

**Definition of BUILD-done (achievable entirely on placeholders):** every gateway lane, refund path, Ivori payout path, and admin surface is fully coded and merged; prod still runs `PAYMENT_MODE=manual` with the gateway inert in placeholder mode; the dummy run passes 12/12 on the gateway rail via the stub; tsc clean; every money phase adversarially reviewed; the only outstanding work is the §1c swap-in checklist.

**Definition of LIVE-done (after the operator supplies real values):** a buyer pays by card (or PayJustNow), money is held, sellers are paid by Ivori with one operator click, refunds land back on cards automatically, no EFT screen/cron/copy remains, and every money action is centrally audited and alertable.
