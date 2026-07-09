# Gun Galore — Admin Surface Audit & Improvement Plan

**Date:** 2026-07-09 · **Method:** 6-agent parallel code audit (full inventory, money ops, compliance, catalog/users, ops/health/alerting, reverse stuck-state walk of all 11 money/fulfilment state machines) — every finding carries `file:line` evidence and the 3 highest-impact claims were independently re-verified. **Scope:** read-only; nothing was changed.

**How to use this doc:** each batch (ADM-0 … ADM-10) is an independent, deployable unit of work for an Opus 4.8 implementation session. Do them in order. Money-touching batches (ADM-2, 3, 4, 7) require adversarial review before deploy, per house rules. Never use the word "escrow" in any UI copy — say "funds held".

---

## Executive verdict

The admin is **broad but shallow in exactly the wrong places**. It has 38 pages, ~100 guarded endpoints, an excellent user dossier, a genuinely complete raffle/competition surface, good swap tooling, and Claude-assisted listing moderation that keeps toil low. But three structural patterns undermine it for a **sole, non-coder operator running real money**:

1. **Visibility without levers.** The system is good at *showing* stuck things (queues, sweeps, alerts) and bad at letting the operator *fix* them. The worst cases are money-in-limbo with literally no button: a mis-referenced EFT payment, a cancelled raffle's refunds, a force-evicted featured bidder's refund.
2. **Alerts without a home.** ~20 distinct `AdminAlert` types are written by sweeps (disputes, failed refunds, chargebacks, stuck funds…) but surface only as **one opaque count** on the dashboard — and that count's "view" link points at the **wrong table**, so clicking it shows nothing. There is no alerts inbox, no resolve button, and (apart from low-credits and accept-stalled) **no alert ever reaches the operator by email/SMS/push** — including the "09:00 payout reminder", which is just a silent DB row.
3. **Heartbeats without a dashboard.** All 30 crons dutifully write `cron:lastrun:*` heartbeats, but the health page **displays only 11 of them** — a dead EFT-scanner cron (`incontact-scan`), payout reminder, licence-expiry delister, or any swap sweep would die silently. Two of the 11 shown have wrong cadences (one false-alarms "stale" half of every hour, training the operator to ignore the page).

Also notable: the **Experiences go-live lever does not exist** — `Category.isExperience` gates the entire deployed-but-inert module, and no UI or even DTO field can set it (verified: zero `isExperience` references under `backend/src/admin`). The stated go-live plan ("create the category when ready") is currently impossible without a manual DB write.

---

## ADM-0 · Broken things & quick wins — *CRITICAL, ~1 day, mostly frontend*

Things that look like they work but don't, plus trivial gaps. Highest confidence, lowest risk.

| # | Fix | Evidence |
|---|-----|----------|
| 0.1 | **"Unresolved alerts" card links to the wrong table.** Card counts `adminAlert` (`admin-command-center.service.ts:153`) but links to `/admin/audit?resourceType=Alert` (`admin/(protected)/page.tsx:199`), and `/admin/audit` reads `adminAuditEvent` (`admin-audit.service.ts:64`) → empty list. Interim fix: point it at the ADM-1 inbox (or, until then, remove the dead link). | verified |
| 0.2 | **Refund button on PENDING_ADMIN_VERIFICATION always errors.** UI renders Refund for pending txs (`dossier-actions.tsx:158-171`) but `refundTransaction` only accepts HELD/DISPUTED (`admin.service.ts:1343-1347`). Either extend the endpoint's allowed states (pending manual-EFT txs have no money yet — should likely be "cancel", not "refund") or hide the button and show the right action. | |
| 0.3 | **No UI button for force-releasing a stuck HELD tx.** Backend supports it (`admin.service.ts:1225-1231`) but the dossier only offers Release on pending; HELD shows refund-only (`dossier-actions.tsx:172-186`). Add a guarded "Force release funds to seller" button (reason required) for HELD — this is the lever for "delivered but buyer never confirms". | |
| 0.4 | **Zoho retry button sends no auth header.** `transactions/[id]/zoho-sync-panel.tsx:43` uses plain `fetch` instead of `adminFetch` → 401 on an AdminJwtGuard endpoint. One-line fix. | |
| 0.5 | **`/admin/kyc` page is a nav orphan** (VerifyNow balance + refresh; no link anywhere — `sidebar-nav.tsx:30-88`). Add to System group. Also reconcile its hardcoded low-balance tint (50, `kyc/page.tsx:31`) with the backend alert threshold (100, `kyc.service.ts:41-43`). | |
| 0.6 | **Listing dossier has zero actions** (918-line read-only page), yet the freshness-graveyard footer tells the operator to "click into a listing's dossier to delete it" (`freshness-graveyard/page.tsx:214`). Add Approve/Reject/Delete (reuse `review-actions.tsx`) to `/admin/listings/[id]`. | |
| 0.7 | **`POST /admin/raffles/:id/open` has no UI button.** A created raffle can't be opened for sales from the admin (endpoint exists, `raffles.controller.ts`; create page never calls it). Add "Open for entries" to the competition detail/list. | |
| 0.8 | **Admin logout doesn't log out.** `/admin/logout` deletes only the cookie; the localStorage `gg_admin_token` that `adminFetch` actually uses stays valid up to 8h (`logout/route.ts`, `lib/admin-auth.ts`). Clear localStorage on logout. | |
| 0.9 | **Single-listing reject reason is optional** ("Reason (optional)", `review-actions.tsx:35`; backend stores `?? null`, `admin.service.ts:91`) while bulk-reject requires ≥5 chars. Make single reject reason mandatory — sellers currently get rejection emails with no reason. | |

## ADM-1 · AdminAlert inbox — *CRITICAL, the meta-fix (~2-3 days)*

Nearly every SLA sweep's escape hatch is "raise an AdminAlert" — and alerts are write-only. There is **no endpoint to resolve an alert** (none in `admin.controller.ts`), no list page, and feed items hard-link to `/admin` with a literal `// future: dedicated alerts page` TODO (`admin-command-center.service.ts:520`).

Build `/admin/alerts`:
- **Backend:** `GET /admin/alerts` (filter by type group, urgency, resolved), `POST /admin/alerts/:id/resolve` (reason, audited), auto-dedup display for repeat alerts on the same subject.
- **Deep links:** every alert type maps to its subject page (tx dossier, user, swap, raffle, manual-payments queue…). Alert types observed in code: `BUYER_DISPUTE_RAISED`, `STITCH_CHARGEBACK_*` (4 variants), `DISPATCH_SLA_REFUND_FAILED`, `SALE_REJECT_REFUND_FAILED`, `BUYER_CANCEL_REFUND_FAILED`, `SHIPMENT_BOOKING_FAILED`, `STUCK_HELD_FUNDS_*`, `DEALER_TRANSFER_STALLED`, `DEALER_VERIFICATION_NEEDS_REVIEW`/`_REVIEW_OVERDUE`, `EXPERIENCE_BOOKING_UNCONFIRMED`, `EXPERIENCE_EVENT_UNCONFIRMED`, `KYC_REPEATED_FAILURE`, `LISTING_REPORTED`, `SELLER_REPORTED`, `SUPPORT_TICKET_OPENED`, `PAYOUTS_DUE`, `SALE_ACCEPT_STALLED`, `BIDDER_AUCTION_STRIKES_THRESHOLD`, address-fraud fingerprint.
- **Command center:** replace the single `unresolvedAlerts` number with 3-4 grouped cards (Money at risk / Compliance / Reports & support / Other), each deep-linking into the pre-filtered inbox.
- **Auto-resolve** where the underlying condition clears (e.g. dispute resolved already resolves its alert — `admin.service.ts:1674-1681` is the pattern; extend it).

## ADM-2 · Notify-the-operator channel — *CRITICAL (~2 days, money-adjacent copy)*

Today only **two** conditions reach the operator off-dashboard: low service credits (email+SMS via `fanOutCreditAlert`, `tasks.service.ts:1548-1618`) and sale-accept-stalled (in-app+push). Everything else — buyer disputes, **failed auto-refunds** (money stuck), chargebacks, shipment-booking failures, dealer-verification overdue, stuck held funds, unmatched EFT, even `PAYOUTS_DUE` at 09:00 — is a silent DB row.

- Reuse the existing `fanOutCreditAlert` pattern (email all active SUPERADMINs, SMS on urgent, 6h dedup) as a generic `fanOutAdminAlert(alert, urgency)`.
- **Urgent (immediate email+SMS):** refund-failed (all 3), chargeback-after-payout, dispute raised, shipment booking failed, dealer-verify overdue, experience booking/event unconfirmed escalation.
- **Daily digest (single 08:30 email):** payouts due, unmatched EFT count, Zoho failed count, KYC stalls, reports, support tickets open, stale crons.
- Add **sidebar badges** (counts per nav group) so in-app discovery doesn't require opening each page (`sidebar-nav.tsx` currently has none).

## ADM-3 · EFT exception desk — *CRITICAL money lever (~3 days, adversarial review required)*

The single most likely real-world incident on the manual rail: **money arrives and can't be applied**. `matchOrder` requires exact reference + exact amount (`manual-payments.service.ts:98-228`); anything else lands in a **read-only** queue (`GET /admin/manual-payments/unmatched` — verified the controller has no mutation for it). Wrong reference → `UNMATCHED`; over/under-payment → `AMBIGUOUS`; paid-after-freeze → `EXPIRED`. Meanwhile the order freeze-releases the listing (`tasks.service.ts:242`) while the buyer's cash sits in GG's account. Today the operator's only option is SQL by hand.

Build actions on the investigation queue:
- **Bind to order** — apply an UNMATCHED/AMBIGUOUS payment to a chosen transaction/order, with explicit over/under-payment handling (short → keep pending + notify buyer of balance; over → confirm + create refund-owed row for the surplus). Reason required, audited, idempotent.
- **Refund payer** — mint the standard synthetic `REFUNDED` child (the mechanic at `admin.service.ts:1410-1499`) so it flows into the FNB refund batch; handles EXPIRED payments where the item was re-sold.
- **Write off / mark resolved** (e.g. donation-sized rounding), audited.
- **Fuzzy-match suggestions** (near-miss reference, exact-amount candidates within the window) to pre-populate the bind action — pure quality-of-life, no auto-apply.
- Surface the queue as a command-center card + ADM-2 digest line (currently invisible outside `/admin/manual-payments`).

## ADM-4 · Refunds-owed ledger — *CRITICAL money integrity (~2-3 days, adversarial review required)*

The FNB batch reads **only Transaction rows** (`getPayoutsDue`, `manual-payments.service.ts:833-922`). Three flows owe people money on non-Transaction entities and therefore **never reach any worklist**:

| Debt | Today | Evidence |
|---|---|---|
| **Raffle refund-all** | Tickets stay `CONFIRMED`; "refund pending" exists only inside an audit-event payload. No worklist, no per-entrant lever. Every entrant owed money with nothing to drive the EFTs. | `raffles.service.ts:1559-1612` |
| **Featured `MANUAL_REFUND_OWED`** | Recorded as a slot audit event + transient HTTP response field only. Follow-through relies on operator memory. | `featured.service.ts:1143-1165` |
| **Subscription paid-too-late** | Match → `EXPIRED`; code comment says "admin refunds/re-activates manually" but there is **no admin subscriptions surface at all**. | `manual-payments.service.ts:205`, `subscriptions.service.ts:370` |

Fix: route all three through the proven synthetic-`REFUNDED`-Transaction mechanic (the Experience CPA-s17 path already does this correctly — `transactions.service.ts:3153+`), so they automatically appear in `payouts-due`, the FNB batch, and the held-funds report. Add a consolidated **"Refunds owed"** tab on `/admin/manual-payments` (source, payee, amount, bank-details-present?, batch status). Also fixes the **held-funds report understating the true client-funds liability** (`getHeldFundsReport` counts only tx+swap — `manual-payments.service.ts:666-821`).

Include here: a minimal **admin subscriptions panel** (list charges, re-activate a paid-too-late member, refund) since it shares the same plumbing.

## ADM-5 · Compliance queues & unified audit — *HIGH (~3-4 days)*

For a regulated firearms marketplace the audit trail is fragmented and several regulated decisions are invisible:

- **Silent money/compliance actions** — add central `AdminAuditEvent` writes to: `releaseTransaction` (releasing funds writes NO audit row today — `admin.service.ts:1284-1321`), refunds **without** a note (audit is gated on `if (note…)` — `:1579`), dealer-verification override (firearm approval! only `adminNote` — `dealer-verification.service.ts:418-427`), swap force-complete/unwind/proof-override (zero audit calls in `swap-funding.service.ts`), raffle money actions (mirror key `RaffleAuditEvent`s centrally).
- **Fix the misleading audit filters:** `/admin/audit` pills for Raffle/FeaturedSlot query `AdminAuditEvent` but those domains write to their own tables → pills return empty (`audit/page.tsx:91`). Either mirror or merge the three stores into one viewer with source tags.
- **Firearm work queue:** the transactions list filters only by `paymentStatus` (`admin.service.ts:1069-1088`). Add a `dealerVerificationStatus` filter + a "Firearms pipeline" view: awaiting 534 upload / PENDING_CLAUDE / PENDING_ADMIN_REVIEW / stalled. Today `PENDING_UPLOAD` firearm sales (seller never sends the 534) have **no queue anywhere**.
- **Licence-expiry visibility:** upcoming-expiry list (31-90d window) + recently-auto-delisted view; the `firearm-licence-expiry` cron also joins the health monitor in ADM-6.
- **Manual-AVS surface:** `bankVerifiedAt` is never set by anything (only reset to null — `users.service.ts:343,399`), so the dossier "Bank ✓/✕" is permanently ✕ and the mandated first-payout name-vs-KYC check has no system record. Build a first-payout review step: bank-holder name beside KYC legal name → "Approve bank details" sets `bankVerifiedAt` (audited). Optionally gate first payout on it in `collectDue`.
- **AML/RMCP operational hook** (ties to the Nedbank TPPP onboarding): a "Flag as suspicious" action on user/tx dossiers creating a case note (audited, resolvable in the ADM-1 inbox). Not a full case-management system — just enough that the drafted RMCP policy has a live operational surface.

## ADM-6 · Health monitor completion — *HIGH (~2 days)*

- **Show all 30 cron heartbeats.** 19 crons write `cron:lastrun:*` keys the dashboard never reads (`admin-health.service.ts:266-277` lists 11) — including `incontact-scan` (the EFT payment scanner!), `payout-reminder`, `firearm-licence-expiry`, `featured-tick`, all 7 swap sweeps, `accept-escalation`, `experience-sla`. Generate definitions from one shared source so new crons can't silently skip monitoring.
- **Fix cadence mismatches:** `dispatch-sla` declared 10min but runs hourly → false "stale" ~50% of the time (`admin-health.service.ts:269` vs `tasks.service.ts:1165`); `raffle-draw` declared hourly but runs 5-min → dead cron takes 3h to surface (`:270` vs `:1039`); `offer-expire` declared 5min, runs 10min (`:268` vs `:847`).
- **Add the missing probes:** Postgres (`SELECT 1`), disk space, process memory/uptime (no DB/pm2/disk signal exists today — single-VPS risk); wire the real `ZohoBooksService.healthCheck()` instead of a base-host HEAD (the code comment at `admin-health.service.ts:167-180` admits this).
- **Money-critical queue depths:** unmatched EFT, Zoho-failed, disputes, dealer-verify pending, support open — none are in `queueDepths` today (`:308-336`).
- **Error surface:** unhandled 500s currently go to pm2 logs only (`main.ts:112-113` — the only global filter is 429 handling). Add a global exception filter that persists server errors (ring-buffer table or AdminAlert) with an admin view. (Overlaps pending task FIX-11.)
- **Backup status row:** last-backup timestamp surfaced from the server-side dump (write a marker file/Setting from the backup cron; display + stale alert). Today backups are completely invisible to the admin.

## ADM-7 · Stuck-state levers — *HIGH (~3 days, money-adjacent, adversarial review required)*

From the reverse walk of all 11 state machines, states with weak/no lever:

| Stuck state | Gap | Fix |
|---|---|---|
| **Swap wedged pre-funding** (PoP rejected loop / address never submitted) | `sweepExpiredFunding` only touches rows with `fundingSetUpAt != null` (`swap-funding.service.ts:624`); force-complete/unwind reject `AWAITING_FUNDING` (`:1124-1128`) → both listings stuck `PAYMENT_PENDING` forever | Admin cancel-swap lever for AWAITING_FUNDING + a timeout sweep (no money moved yet, so cancel+restock is safe) |
| **Undersold raffle** | No sales deadline exists; `CANCELLED_MIN_NOT_MET` is a latent enum with no path (`raffles.service.ts:938,1052`); entrants' cash held indefinitely — CPA exposure | Add optional `salesDeadline` on create + sweep: deadline passed & undersold → alert + one-click refund-all (which, post-ADM-4, actually drives refunds) |
| **Draw failure loop** | Per-raffle try/catch logs only; repeated draw failures never alert | Alert after N consecutive failures; manual `run-draw` button already exists (`raffles.controller.ts`) — surface it on the raffle detail page |
| **Order-level unwind** | Orders admin is read-only (`admin.controller.ts:448-470`); refunding a multi-seller order = per-child clicks with ordering rules | "Refund remaining lines" order-level action + `PARTIALLY_FULFILLED > N days` attention card |
| **Experience stalls** | Booking-unconfirmed / event-unconfirmed raise alert-only (invisible pre-ADM-1), no purpose-built lever (`experience-sla.service.ts:82,148,299`) | Buttons on tx dossier: "Cancel & refund (outfitter no-show)" / "Force-complete (event happened)" wrapping existing release/refund with correct copy |
| **Buyer refund blocked on missing bank details** | Visible in `skipped[]` only; nothing chases the buyer (`manual-payments.service.ts:1052-1056`) | Automated re-request cadence (email+SMS w/ token link to the bank-details form) + escalation to digest after N attempts |
| **`dispatchSlaAtRisk` mislabel** | Card counts ALL HELD>24h undispatched regardless of shipping method — DEALER_TRANSFER/COLLECTION/experiences pollute a "dispatch" card (`admin-command-center.service.ts:145-151`) | Split by method so each number means something |

## ADM-8 · Automation — *MEDIUM (~1 week, incremental)*

Ranked by toil saved for the sole operator:

1. **Zoho auto-retry for everything** — hourly auto-retry exists only for swap fee receipts (`tasks.service.ts:920-930`); generalize to failed tx/raffle/featured/subscription syncs, and add per-row retry buttons to the failed-sync table (currently read-only — `manual-payments/page.tsx:552-586`). Removes ~all Zoho toil.
2. **Re-moderate on edit** — sellers can edit a PENDING_REVIEW listing without re-running Claude moderation (`listings.service.ts` `update()` never calls `moderate()`; only `create()`:722 does) → the human queue shows stale reasons for changed content. Re-run moderation on edit of PENDING_REVIEW/ACTIVE listings; auto-approve if clean.
3. **Payout batch auto-draft** — auto-freeze a draft batch at 08:30 and notify via ADM-2 with count+total; operator reviews, downloads, pays, marks paid. (Actual payment stays human — FNB has no API.)
4. **Statement ingest via IMAP** — the inContact scanner pipeline (`tasks.service.ts:68`) can also parse the emailed FNB statement attachment → auto-reconcile with the exceptions desk (ADM-3) as the review surface. Removes the daily manual CSV upload.
5. **Stale-listing nudges** — auto-email sellers from the freshness-graveyard ranking on a weekly schedule ("roadmap" note already in the page).
6. **Support reply drafts** — Claude drafts a reply from ticket thread + KB; operator edits/sends. Add ticket age/SLA chips to `/admin/support` (rows currently show only `updatedAt` — `support/page.tsx:148`).
7. **TCG tracking poll** — tracking poll is Pudo-only (`tasks.service.ts:1145`); add TCG so half the courier flow isn't blind between dispatch and buyer confirmation.

## ADM-9 · Operator-UX & missing controls — *MEDIUM (~1 week, mostly low-risk)*

- **Experiences go-live toggle** — add `isExperience` to the category DTO/service/UI (`admin-categories.service.ts:20-33` create/update never write it; form at `categories-tree.tsx:412-441` has no toggle; verified zero references in `backend/src/admin`). Include the same blast-radius + reason treatment as `isFirearm`. *This is the go-live button for the entire deployed Experiences module — still gated on your operator/attorney decision, but the button must exist.*
- **Category attributes UI** — full CRUD backend exists (`admin.controller.ts:876-914`) with no frontend; the sell-form facets can only be edited by raw API. Add an "Attributes" section in the category editor.
- **Meilisearch panel** — reindex button (`POST /admin/listings/reindex` is backend-only) + drift stat (index doc count vs ACTIVE count, last reindex time).
- **Ask GG cost & quotas** — no aggregate Claude spend/token dashboard exists for a paid live feature; quotas are hardcoded with a code TODO to move them to settings (`ask-gg-quota.service.ts:24-29`). Add a spend page (per-day tokens/cost by feature) + quota keys in `/admin/settings`.
- **Reloading browser upload** — ingest is SCP-to-server only (`reloading/page.tsx:307-313`); add a browser file-upload for a non-coder operator.
- **Per-seller remittance statement** — batch UI shows totals only (`manual-payments/page.tsx:424-452`); render per-recipient lines from `getPayoutBatch(:id)` and optionally email sellers their remittance.
- **Analytics honesty fixes** — refund/dispute-rate cohort mismatch (numerator `updatedAt`-filtered vs denominator `createdAt`-filtered — `admin-analytics.service.ts:580-618`); "GMV today" counts *released* money, not *paid* money (`admin-command-center.service.ts:237-261`) — add a "paid today" line so a big sale day doesn't read as R0.
- **Revenue rollup across streams** — dashboard + CSV are transaction-commission-only; add raffle/featured/subscription/swap-fee lines for a single in-app P&L view (currently only in Zoho).
- **Broadcast history + scheduling** — page shows only the current session's result; add a sent-log and optional scheduled send.
- **Dealer directory bulk-import** — CSV import for the SAPS dealer list (each dealer is currently hand-entered).

## ADM-10 · Admin auth hardening — *MEDIUM (~2-3 days)*

- **Role enforcement:** `MONITORING_ADMIN` exists but can refund, ban, and broadcast — only `/admin/admins` + `/admin/stats` check `SuperadminGuard`. Add a read-only guard for MONITORING_ADMIN on all mutating endpoints.
- **2FA (TOTP)** on admin login; brute-force protection is only a 10/min/IP throttle.
- **Session hygiene:** move the bearer token out of localStorage to the already-issued httpOnly cookie path, or add server-side session revocation ("sign out everywhere"); 8h fixed JWT with no revocation today. (Logout bug itself is ADM-0.8.)

---

## What's already good (don't touch)

- **Raffle/competition admin** — the most complete surface: verifiable draw proof, winner/backup/forfeit chain, firearm-prize gating, postal entries, sponsor settlement, typed-confirmation refund-all.
- **User dossier** — comprehensive (KYC journey, banking, trust, full activity, alerts, audit trail).
- **Swap tooling** — force-complete/unwind/proof-override with idempotency guards; 7 self-healing sweeps.
- **Claude listing moderation** — auto-approves the safe majority; humans see only rejects + Experiences. Right model; extend (ADM-8.2), don't replace.
- **Category `isFirearm` handling** — inheritance, blast-radius count, reason-gated, audited. Use it as the template for `isExperience`.
- **Credit monitoring + fan-out** — the one alert channel that actually reaches the operator; it's the pattern ADM-2 generalizes.
- **Dispatch-SLA auto-refund**, PRIVATE_ARRANGE reconciler, order-expiry sweep — good self-healing automation already in place.

## Suggested implementation order

| Phase | Batches | Why first |
|---|---|---|
| 1 | **ADM-0** | Broken buttons + wrong links; a day of pure wins |
| 2 | **ADM-1 + ADM-2** | The meta-fixes — everything downstream assumes alerts have a home and reach the operator |
| 3 | **ADM-3 + ADM-4** | The two CRITICAL money-in-limbo lever sets (EFT exceptions, refunds owed) |
| 4 | **ADM-5 + ADM-6** | Compliance/audit unification + health completion |
| 5 | **ADM-7** | Remaining stuck-state levers |
| 6 | **ADM-8 → ADM-10** | Automation, UX/controls, auth hardening |

**Paygate note:** all recommendations are rail-agnostic or explicitly manual-rail-scoped. ADM-3 (EFT exception desk) and ADM-8.4 (statement ingest) are the only batches whose value shrinks when Peach/Ivori replaces manual EFT — build them lean, but note that mis-referenced/over-paid EFT is your top live incident risk *today*, and the paygate has no confirmed date. Everything else (alerts inbox, notify channel, refunds-owed ledger, compliance queues, health, levers) carries over to the card rail unchanged.
