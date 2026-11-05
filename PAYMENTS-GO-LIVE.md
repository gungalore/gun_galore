# Payments go-live runbook (Ozow default; Peach dual-rail)

**Status:** LIVE for money-in as of 2026-10-10 (checkout open). Money-out
**verified end-to-end on 2026-10-28**: a real R10 Investec payout completed and
the funds landed.
**Last updated:** 2026-10-28.

## Progress log

- **2026-10-28 - first live pay-in settled; two status defects fixed.** A buyer
  paid **R20** on Scope covers through ABSA API (Ozow transaction
  `df7df1b0-45a5-447a-a4cd-964166295d4b`), but the return page said
  "Payment not confirmed". Root causes: `getPaymentStatus` called
  `/payments/{id}/transactions` **without `fromDate`/`toDate`**, and Ozow
  answers an empty result list when the window is omitted (so a real success
  looked `Incomplete`); and the box's `OZOW_WEBHOOK_SECRET` was stale, so the
  `transaction.complete` delivery was rejected for an invalid Svix signature.
  **Fixed in `d1b5f989`** (backend-only deploy, rollback
  `alloutdoor-20261028-213000.dump`): the lookup now sends a 30-day window and
  a spec pins the query. The correct subscription secret (`a7edf05f-...`) was
  fetched from `GET /webhooks/{id}/secret`, verified with a signed no-op
  delivery, and the stale `WEBHOOK_SIGNATURE_INVALID` alert resolved. The
  payment was then settled through verify-result: `paidAt` set,
  `gatewayPaymentId` recorded, Scope covers **SOLD**, private-arrange contacts
  revealed. Backend 391 suites / 5,981 tests.
- **2026-10-28 - live payout verified.** R10 to Investec `****0758` (account
  `10012650758`) using Ozow's universal branch `580105` (the operator supplied
  `580108`, which is branch-specific; Ozow resolves Investec to `580105`).
  Payout `20261028-cb9b-4554-8786-02d42589b8f6`, merchant ref
  `AOTESTMVSER3D6`, RTC. Status **Payout Completed**; `VerificationSuccessful`
  and `PayoutCompleted` webhooks delivered; the member confirmed the R10 in the
  account. Recorded in the isolated `OzowPayoutTestAttempt` table
  (`cmvser3ep00002wvnkyhtezr7`) so no Transaction/Zoho row was fabricated. It is
  a real float debit. Evidence:
  `backend/.ozow-test-evidence/2026-10-28T17-48-14-573Z/live-r10-investec.json`.

- **2026-10-10 — deployed `7209ec02`.** Gates green (backend 314 suites / 5290 tests,
  frontend 135 files / 1691 tests, prod build OK). `deploy.sh` run: rollback dump
  `alloutdoor-20261010-093439.dump` (29.9 MB), no pending migrations, backend+frontend
  health OK ×2, warden online, public 200 ×2.
- Prod `backend/.env` flipped to live (backup `backend/.env.bak-golive-20261010093412`):
  `OZOW_ENV=live`, `PAYMENT_MODE=paygate`, `PAYMENTS_LIVE=true`, `OZOW_PAYOUT_IS_RTC=true`,
  `OZOW_PAYOUT_TEST=false`, `OZOW_PAYOUT_MOCK=false`, prod client id/secret, `OZOW_SITE_CODE=ALL-ALL-035`,
  live `whsec`, prod payout key. Frontend `.env.production` `NEXT_PUBLIC_PAYMENT_MODE=paygate`.
- Boot verified: no `Ozow One API not configured` / `OZOW_WEBHOOK_SECRET is not set` warnings.
- `npm run seed:help` run on the box (54 rows refreshed).
**Owner:** operator (Gerhard Fourie). Executor: agent, except the banking steps.
**Rails:** Ozow One API (pay-in + refunds) and Ozow Payouts API; optional Peach
Checkout V2 (card pay-in), Peach Payouts and BANV. The rail is locked per
transaction — see the Peach dual-rail section below.

This is the operator runbook for taking the marketplace from "payments inert" to "accepting
real money and paying sellers out". It supersedes the flip paragraph in
`docs/project-reference.md` §Go-live flip — update that line once this completes.

---

## 0. Done — Ozow production dashboard (2026-10-10)

`dash.ozow.com`, merchant **ALLOUTDOOR (PTY)LTD**.

- **One API client** `AllOutdoor Web` created (scopes: `payments payouts refunds settlements
  subscriptions webhooks`), bound to the production site. Client ID `5r9l0dvmsb0hsa6l3a8io54uor`;
  the secret is shown once — it lives in the handoff file below, never in the repo.
- **Pay-in webhook subscription:** FULL / `transaction.complete` →
  `https://alloutdoor.co.za/api/payments/webhook/ozow` (subscription id
  `a7edf05f-cdce-4967-9676-6107b5ff8033`).
- **Signing secret** (`whsec_…`, 38 chars) fetched via `GET /webhooks/{id}/secret` with an OAuth
  `webhooks`-scoped token.
- **Production site code:** `ALL-ALL-035` (Active; default bank ABSA …1853).
- **Payout API key + `ALL-ALL-035` pair verified live** against
  `payoutsapi.ozow.com/v1/getavailablebanks` → HTTP 200, 24 banks.

### Credentials handoff (NOT in the repo)
`C:\Users\gerha\AppData\Local\Temp\opencode\ozow-prod-oneapi.txt` holds the values mapped to env
names (client id/secret, site code, `whsec_`). Fold them into the box `.env` and delete the file.
`OZOW_PAYOUT_API_KEY` is the production Payout API key from `OZOW production keys.txt` (that file
must be removed from the repo root — see Phase 5).

---

## 1. Code — DONE (committed `7209ec02`, deployed 2026-10-10)

Pay-in `notifyUrl` added to the One API `POST /payments` payload
(`backend/src/payments/ozow.service.ts`), derived from `PUBLIC_API_URL` else `FRONTEND_URL + /api`,
and **only sent when the URL is public HTTPS** (Ozow 403-rejects localhost). The full webhook
subscription remains the primary delivery path. Covered by two specs in
`backend/src/payments/ozow.service.spec.ts`.

Gate: `tsc --noEmit` clean; `ozow.service.spec.ts` 23/23 pass. Lint is red repo-wide (pre-existing
prettier drift, untouched files included) and is **not** a deploy gate.

---

## 2. Payout verification - RESOLVED 2026-10-28

**Resolved:** the live R10 payout on 2026-10-28 completed and Ozow's
`VerificationSuccessful` webhook was delivered, so the payout-verification
blocker is closed. The historical 2026-10-10 questions are kept below for
context.

- **Payout verification URL** and whether the **24-char AccessToken** is issued by Ozow or
  self-configured. Site **Payout Settings** (verified 2026-10-10) reads: Payout Merchant Name +
  Payout Site Name populated, but `Payouts Api Key / Notify Url / Webhook` all **blank** (no
  edit control on the page). The merchant-level **Payouts API Key** *is* present and working
  (`Merchant → Edit Details`; `getavailablebanks` → HTTP 200).
  Payout *notifications* are fine — our code sends `notifyUrl` per `requestpayout` request.
- **Resolved 2026-10-28:** the payout creds were armed and a live R10 payout
  completed; no further Ozow action is needed for payouts.

---

## 3. Server flip + deploy — DONE 2026-10-10 (see progress log)

1. Box `.env`: handoff-file creds + `OZOW_SITE_CODE=ALL-ALL-035`,
   `OZOW_PAYOUT_SITE_CODE=ALL-ALL-035`, a fresh self-generated `OZOW_PAYOUT_ENCRYPTION_KEY`
   (32+ chars, prod-only), `OZOW_PAYOUT_ACCESS_TOKEN` (once §2 settles), plus the switches:
   `OZOW_ENV=live`, `PAYMENT_MODE=paygate`, `PAYMENTS_LIVE=true`, `OZOW_PAYOUT_IS_RTC=true`,
   `OZOW_PAYOUT_MOCK=false`.
2. Frontend `NEXT_PUBLIC_PAYMENT_MODE=paygate` (build-baked) + production build.
3. Full deploy runbook: type-checks, both test suites, foreground frontend build, deliberate
   staging, PM2 reload — from `feat/takealot-ux-parity` only.
4. **Post-deploy: `npm run seed:help` on the box** — refreshes live Help-Centre rows still
   showing stale carrier wording (carry-over from the 2026-10-09 Pargo deploy `076d7e69`; the
   seed file is deployed, the DB rows are not).
5. Verify: boot-time `main.ts` payment warnings gone, `/api/health` OK, FAQ renders
   "Bob Go door / Pargo pickup".

---

## 4. Float + live tests (Ozow-approved R1–R20)

Production float is **funded** (R100 loaded by the operator; the R10 live test
on 2026-10-28 debited it).

1. Float Management → Top Up Float → **No** (static reference) → instant EFT with the exact
   reference. Start this early (clears on landing, not on send).
2. Money-in: R1 pay-in → `transaction.complete` webhook confirms the order → refund lands back on
   the card.
3. **DONE 2026-10-28:** live R10 payout to an operator-controlled Investec account → float debit + `VerificationSuccessful` and `PayoutCompleted` notifications; funds landed. Irreversible - keep future tests trivial.

---

## 5. Cleanup

- **DONE 2026-10-10:** deleted `OZOW production keys.txt` from the repo root; `.gitignore` now
  covers `backend/.ozow-test-evidence/` (harness scratch) and Ozow key-handoff files
  (`commit c75a4519`).
- **DONE 2026-10-10:** `docs/project-reference.md`, `docs/ENVIRONMENT.md`, `docs/ARCHITECTURE.md`
  and `docs/INDEX.md` updated to the live state.
- **Key rotation — NOT self-service (verified in the dashboard 2026-10-10).** No rotate control
  exists for any of the three credentials:
  - **One API client** `AllOutdoor Web` (`One API → Clients`): actions are only **Disable** and
    **Manage Webhooks**. No regenerate. Replacement = *Add Client* (all 6 scopes) + re-register
    the webhook subscription under it (new `whsec`), then update `OZOW_CLIENT_ID` /
    `OZOW_CLIENT_SECRET` / `OZOW_WEBHOOK_SECRET` on the box and reload.
  - **Merchant Private Key / API Key / Payouts API Key** (`Merchants → Edit Details`): read-only
    fields, no rotate action.
  → **Open an Ozow support ticket** to rotate the credentials exposed on 2026-10-10, or approve
    the client-replacement path. Note the keys are visible read-only in the portal, so treat them
    as account-level identifiers rather than typeable secrets.

---

## Peach dual-rail go-live (staged, 2026-11)

Peach is a second rail, **not a replacement**. The buyer chooses Ozow or Peach;
`Transaction.paymentProvider` is locked at checkout and the refund + seller
payout use that same provider. There is no cross-rail fallback.

Peach checkout creation validates the storefront `Origin` / `Referer` against
its allowlisted domains. The backend forwards the origin of the shopper result
URL, so the frontend hostname must be allowlisted in Peach. Production uses
`alloutdoor.co.za`. For local card testing, allowlist the local host you use
(for example `localhost` or `lvh.me`) or the create call returns
`Merchant domain is not allowlisted`; without the origin header it returns
`Missing referer or origin header`.

### Before enabling

1. Peach Dashboard → Payouts → Settings: confirm the Payouts product is
   enabled and copy its API client id/secret/merchant id (these may differ from
   Checkout's pair).
2. Request the Payouts webhook signing secret from Peach support and register
   the production URLs:
   - `/api/payments/webhook/peach`
   - `/api/payments/webhook/peach-payout`
   - `/api/payments/webhook/peach-banv`
   - `/api/payments/webhook/peach-dispute`
3. Fund the Peach payout float separately from Ozow. Do not commingle floats.
4. Set `PEACH_ENV=live` plus the checkout and payout credentials / secrets on
   the box, and reload.
5. Verify boot has no Peach "incomplete credentials" or "secret not set"
   warnings.

### Sandbox acceptance (must pass before live)

- Peach pay-in: success, decline, cancel, status query, webhook, refund.
- BANV: pass, mismatch, failure; confirm the webhook stamps/clears
  `User.bankVerifiedAt`.
- Peach Payouts: pending, processing, successful, failed, reversed; confirm
  `paidOutAt` is set only on success and failures hold the row.
- Routing: one Ozow-paid and one Peach-paid transaction, released together.
  One payout run must call each provider only for its own rows; assert no
  cross-rail call in the logs.
- Pin the Peach webhook signature base in sandbox. The verifier accepts the
  legacy `${timestamp}.${id}.${url}.${body}` and Svix `${id}.${timestamp}.${body}`
  forms; keep the confirmed one documented.

### Enable order

1. Deploy schema + backend + frontend with `peach_payin_enabled=false` and
   `peach_payouts_enabled=false`. Confirm Ozow checkout/refund/payout is
   unchanged.
2. Turn on `peach_payin_enabled`. Run one small live Peach payment + refund.
   Confirm the transaction row says `PEACH` and the payout-due preview shows it
   under the Peach bucket.
3. Turn on `peach_payouts_enabled`. Run a small payout batch and confirm the
   Peach webhook settles it.
4. Leave auto payouts OFF until both rails have completed a full settlement
   cycle.

### Rollback

- Disabling `peach_payin_enabled` is safe: new buyers see Ozow only.
- **Do not disable `peach_payouts_enabled` while any Peach-paid transaction is
  unsettled.** Those rows must be paid via Peach; they must never be routed to
  Ozow. If Peach is hard-down, keep the rows held and handle manually.
- `PAYMENTS_LIVE=false` still closes checkout entirely.

---

## Rollback

Payments are entry-gated: set `PAYMENTS_LIVE=false` (checkout returns 503) and reload the backend.
`PAYMENT_MODE`/`OZOW_ENV` roll back the rail maths/host. No schema change is involved, so no DB
rollback is needed; the float is unaffected by a code rollback.
