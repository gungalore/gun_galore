# Payments go-live runbook (Ozow pay-in + pay-out)

**Status:** IN PROGRESS — code ready, dashboard configured, deploy pending.
**Last updated:** 2026-10-10.
**Owner:** operator (Gerhard Fourie). Executor: agent, except the banking steps.
**Rail:** Ozow One API (pay-in + refunds) and Ozow Payouts API (seller disbursement).

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

## 1. Code — DONE (local, uncommitted)

Pay-in `notifyUrl` added to the One API `POST /payments` payload
(`backend/src/payments/ozow.service.ts`), derived from `PUBLIC_API_URL` else `FRONTEND_URL + /api`,
and **only sent when the URL is public HTTPS** (Ozow 403-rejects localhost). The full webhook
subscription remains the primary delivery path. Covered by two specs in
`backend/src/payments/ozow.service.spec.ts`.

Gate: `tsc --noEmit` clean; `ozow.service.spec.ts` 23/23 pass. Lint is red repo-wide (pre-existing
prettier drift, untouched files included) and is **not** a deploy gate.

---

## 2. Blocked on Ozow (their support items 3 & 4)

- **Payout verification URL** and whether the **24-char AccessToken** is issued by Ozow or
  self-configured. Site **Payout Settings** is blank for `Payouts Api Key / Notify Url / Webhook`.
  Payout *notifications* are fine — our code sends `notifyUrl` per `requestpayout` request.
- Until answered: put the payout creds on the box **armed** (no disbursement runs without a manual
  admin batch anyway) and keep `PAYMENTS_LIVE` able to hold; checkout can go live before payouts.

---

## 3. Server flip + deploy

1. Box `.env`: handoff-file creds + `OZOW_SITE_CODE=ALL-ALL-035`,
   `OZOW_PAYOUT_SITE_CODE=ALL-ALL-035`, a fresh self-generated `OZOW_PAYOUT_ENCRYPTION_KEY`
   (32+ chars, prod-only), `OZOW_PAYOUT_ACCESS_TOKEN` (once §2 settles), plus the switches:
   `OZOW_ENV=live`, `PAYMENT_MODE=paygate`, `PAYMENTS_LIVE=true`, `OZOW_PAYOUT_IS_RTC=true`,
   `OZOW_PAYOUT_MOCK=false`.
2. Frontend `NEXT_PUBLIC_PAYMENT_MODE=paygate` (build-baked) + production build.
3. Full deploy runbook: type-checks, both test suites, foreground frontend build, deliberate
   staging, PM2 reload — from `feat/takealot-ux-parity` only.
4. **Post-deploy: `npm run seed:help` on the box** — refreshes live Help-Centre/Ask-GG rows still
   showing the retired "Pudo locker-to-locker / The Courier Guy" wording (carry-over from the
   2026-10-09 Pargo deploy `076d7e69`; the seed file is deployed, the DB rows are not).
5. Verify: boot-time `main.ts` payment warnings gone, `/api/health` OK, FAQ renders
   "Bob Go door / Pargo pickup".

---

## 4. Float + live tests (Ozow-approved R1–R20)

Production float is **R 0.00** — no payout succeeds until funded.

1. Float Management → Top Up Float → **No** (static reference) → instant EFT with the exact
   reference. Start this early (clears on landing, not on send).
2. Money-in: R1 pay-in → `transaction.complete` webhook confirms the order → refund lands back on
   the card.
3. Money-out: R1 payout to an operator-controlled ABSA account → float debit + `PayoutCompleted`
   notification. Irreversible — keep it trivial.

---

## 5. Cleanup

- Rotate the production **Private Key + API Key** (exposed in a session transcript 2026-10-10).
- **Delete `OZOW production keys.txt`** from the repo root — untracked and NOT gitignored.
- Update `docs/project-reference.md` §Go-live flip and `docs/ENVIRONMENT.md` (site code, "current
  production state" lines) to the live values/state.

---

## Rollback

Payments are entry-gated: set `PAYMENTS_LIVE=false` (checkout returns 503) and reload the backend.
`PAYMENT_MODE`/`OZOW_ENV` roll back the rail maths/host. No schema change is involved, so no DB
rollback is needed; the float is unaffected by a code rollback.
