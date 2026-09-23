# Session log

What each session did, found, and changed — so the next one does not re-derive it.

**Keep it streamlined. Hard rules:**

- New entry at the top. Never rewrite old entries.
- **One screen per entry, max.** Terse lines, no prose paragraphs, no transcripts.
- State the root cause, not the debugging journey. Link by file path.
- Never paste secrets. Name variables only.
- **Retention: keep the last 3 entries.** Once an entry's durable content is in a
  rule (`AGENTS.md` / `docs/project-reference.md`) or `HANDOFF.md`, delete it.
- Durable rules do not belong here.

---

## 2026-09-23 — WARDEN DAEMON PROXY REBUILT; PANEL DAEMON SURFACE

**Goal:** wire the standalone `warden/` daemon into the new `/admin` panel (the last "NOT WIRED" card). Local only; nothing deployed.

**Changed (uncommitted)**

- `backend/src/admin/warden.{types,service,controller,dto,spec}.ts` restored from `HEAD:backend/src/desk/` (deleted with the Desk) and adapted. `warden.boot.spec.ts` added. Registered in `admin.module.ts` (`WardenService` + `WardenController`).
- Dropped, not rebuilt: `gates()` (its `DeskSiteService` source is gone) and `settings()`/`maskSaPhone()` (settings board removed by operator decree). `WardenService`'s constructor is now just `AdminAuditService`.
- Added `GET /admin/warden/board` → `WardenBoardView { present, absence, board }`. `absence: 'not_deployed' | 'unreachable'` so a null board is never rendered as "all clear".
- `warden.spec.ts`: removed the gates/settings/maskSaPhone describes + the deleted `DeskSiteService.board()` test; added board-endpoint tests; the hand-mirror now reads **both** `warden/src/types.ts` and `frontend/components/admin/warden-thread.tsx`.
- Frontend: `lib/admin-api.ts` warden block; new `components/admin/warden-thread.tsx` (+ spec); new `app/admin/(protected)/warden/daemon/page.tsx`; `WardenDaemonCard` rewired from a one-shot 404 probe to a real card.

**Findings**

- ⚠️ A red gate has no command — the card renders **no** approve/decline buttons. `operationName === null` = free-hand (not safe-list-bounded); `reversible` requires an explicit `true`.
- `warden/` deploys as a separate, non-fatal pm2 stage → daemon/backend version skew is real; the `dropped` counters on board + audit are load-bearing, not decoration.
- The mirror was previously three-way but the third leg (`components/desk/chat.tsx`) was deleted with the Desk — the new thread component is now that leg, and the spec fails if it drifts.

**Verified**

- Backend: `tsc` 0, `nest build` 0, jest **4900 pass** (1 pre-existing `motivations/motivation-consent-pack.spec.ts:100` failure). Frontend: `tsc` 0, **1449 pass**, build 0 with `/admin/warden/daemon` emitted.
- Against a **real** daemon (`warden/.env` local, untracked, `127.0.0.1:8787`, no model key): compiled `WardenService` read a real 30-row board + 10-message thread + 1 red gate, and exercised `send`/`sweep`/`pause`/`resume`. Daemon then stopped; `backend/.env` left without `WARDEN_BASE_URL`/`WARDEN_TOKEN` (panel honestly shows NOT DEPLOYED locally).
- **Verified in Chrome** end-to-end (backend restarted on the rebuilt `dist/` with a local `WARDEN_BASE_URL`/`WARDEN_TOKEN`): Warden tab card reads CONNECTED + "2 faults" + "Review 1 proposal"; `/admin/warden/daemon` renders the red gate (no buttons), the full thread, the 30-row measured board and the empty execution audit. Clicking **Measure now** produced a real `POST /sweep 200` in the daemon log and a `WARDEN_SWEEP` row in `AdminAuditEvent` (22:59:19) — the write path is audited.
- ⚠️ **Bug found and fixed while checking in Chrome:** `WardenDaemonCard` rendered a **failed read as CONNECTED / "nothing is red"** — a 404 (backend running pre-rebuild `dist/`) left `data` null and fell through to the healthy arm. The card now checks `chat.error`/`board.error` first and shows `READ FAILED`. This is the project's signature failure mode; any new card that branches on `data` must branch on `error` too.

---

## 2026-09-22 — FOUR PILLARS ONLY: DESK, WARDEN, BALLISTICS, ASK-GG KB REMOVED

**Goal:** leave only Marketplace, Auctions, The Armory and Community in the code. Local box only; nothing deployed.

**Changed (uncommitted)**

- Backend: `src/desk/` (incl. `warden.*`, `desk-payouts`, `desk-whatsapp`) deleted + `app.module.ts` entries. `src/ballistics/` deleted (orphaned). `ask-gg` trimmed to `POST /ask-gg/identify-listing`; KB + page-guide editors deleted.
- Frontend: `app/admin/**`, `components/desk/**`, `lib/desk-*.ts` (+ specs), `scripts/desk-guard.cjs`, `desk-cutover.cjs`, `make-desk-icons.py`, `scripts/artboard-spec.cjs`, `public/icon-desk-*.png`, and the `desk:guard`/`desk:cutover` package scripts removed; `build` no longer runs them.
- `app/sw.ts` now imports the new `lib/sw-offline.ts` (shop fallback only); `lib/desk-offline*.ts` deleted. `/admin` NetworkOnly + fallback carve-out kept for the rebuild.
- 168 files changed, ~53.5k deletions.

**Findings**

- The earlier audit's "dead route" list was wrong: `/coming-soon`, `/preview`, `/condition-guide`, `/witness/[token]`, `/t/[code]` are all live/linked. Footer and legal surfaces left intact by operator call.
- `manual-payments` is mis-named — it is the Ozow pay-out engine, not manual EFT; kept as a connector.
- ⚠️ Seller payouts paused by design: the Desk was the only trigger for `getPayoutsDue → Ozow.createPayout`; the old FNB cron was already gone. Operator will rebuild the Desk.
- Prisma orphans kept (no migration): `Deal`, `DealPurchaseOrder`, `Message`, `Competition`, ask-gg tables.

**Admin panel (same session, built after the strip)**

- New `/admin` PWA: `app/admin/{layout.tsx,admin.css}`, `(protected)/{layout,page}.tsx` + `warden|money|people|operate|insights/page.tsx`, `login/page.tsx`, `manifest.webmanifest/route.ts`.
- Components: `components/admin/{admin-ui,admin-chrome,admin-drawer,admin-confirm,admin-session}.tsx`; libs `lib/admin-api.ts`, `lib/use-admin-poll.ts`.
- Design mockup + spec: `docs/design/admin-pwa/` (live copy `frontend/public/admin-mockup.html`).
- Dark neon theme scoped to `.admin-os`; own PWA manifest (scope `/admin/`); Bearer-token store with single-flight refresh; polling only; role-gated writes with reason dialogs.
- ⚠️ `WardenDaemonCard` probes `/admin/warden/board` once and shows "NOT WIRED" — the `warden/` daemon's backend proxy is still to be rebuilt.
- ⚠️ The Insights flag board was **removed the same session, on the operator's call** — those flags are decided rules, not operator controls. Insights is analytics only (KPIs, velocity, by-category, top makes/models); `PATCH /admin/settings/:key` stays for deploy-time changes but has no UI. Do not re-add it.
- Two real defects found by driving it in Chrome and fixed: closed drawers exposed `role="dialog" aria-modal="true"` (now `aria-hidden`+`inert`), and the flag board read `value` where the API returns `currentValue`, so it rendered defaults instead of live values.
- People-board drive-through found two more, both fixed: **off-screen windows** (Money/Operate kept drawers mounted below the viewport; now they render nothing when closed and the base state is on-screen, animation is a `backwards` keyframe) and **silent button failures** (`Reveal ID` swallowed a 404 — `adminFetchBlob` now surfaces the backend message and the buttons have busy/error states). The 5px drag handle became the whole header, and People/Money drawers moved onto the shared `AdminDrawer` for drag + Escape + focus trap.
- ⚠️ **Drawers were painting UNDER the tab bar.** `.admin-os > *` gave `.adm-col` `z-index: 1`, trapping every drawer/dialog (z 500) inside its stacking context while the sibling tab bar (z 200) sat above it — "Clear strikes" and "Erase data" were visible but untappable. Fixed by moving the ambient grid to `.admin-os`'s own `background-image` and deleting the wrapper z-index. Verified with `elementFromPoint`: the drawer button now wins the overlap.

**KYC images from Didit + full member profile (same session)**

- Privacy policy corrected: we store **no copy** of the ID image, selfie or liveness video — Didit holds them (`(legal)/privacy` §3.2/§8/§9). Also `Israel` → `European Union` (Didit's docs say EU-by-default AWS processing) and **stale Clerk disclosures removed** (provider table, §8, §3.1 "verified via Clerk", §3.6 "handled by Clerk").
- `DiditService.fetchSessionImage()` re-requests the decision for **fresh 4h presigned links** and streams bytes; `readKycFile` falls back to it. Selfie = `liveness_checks[].reference_image`, ID = `full_front_image` → `front_image`. Nothing stored. 8 unit tests.
- `GET /admin/users/:id/id-number` decrypts + **audits every reveal**; the ciphertext is stripped from the dossier (only `hasIdNumber` ships). 5 unit tests.
- New `/admin/people/[id]` full profile (checklist first); drawer + page share `components/admin/user-actions.tsx`.
- ⚠️ Local backend runs compiled `dist/` — **`npm run build` + restart is required** for backend changes to take effect; the sandbox key cannot read the live session (surfaces a named 403 message by design).

**Verified:** backend `tsc --noEmit` 0; frontend typecheck 0 (after clearing stale `.next/types`); frontend 110 files / 1445 pass; frontend build 0 with `warden|money|people|operate|insights|login` emitted; backend jest 4831 pass, one pre-existing failure at `motivations/motivation-consent-pack.spec.ts:100`. Admin login exercised against the live backend (returned its credential error) — gated boards not yet eyeballed, local admin password ≠ seed default.

---

## 2026-09-15 (cont.) — The vault consent had no home; the shelf hid its buttons

**Goal:** the member could not grant "may we keep your documents", and the document shelf hid the documents and the Scan/Upload tiles.

**Changed (uncommitted, frontend)**

- `components/vault-consent.tsx` was **imported by nothing** — the notice the motivation's `needsConsent` toast points at did not exist on any screen.
- `app/licence-centre/page.tsx` (Document Centre) — fetches `licenceCentreApi.consent` and renders `VaultConsentBody` inline while the state is not `given`; answers via `answerConsent`.
- `app/licence-centre/[id]/page.tsx` (motivation) — `onKeep` now renders the same notice in place of the dead-end toast and, on agreement, retries the save it was raised for.
- `components/licence-centre/document-shelf.tsx` — the Scan/Upload tiles are pinned OUTSIDE the horizontal scroll; the documents scroll behind them. They were the last items in the scroll, so they sat off-screen with a hidden scrollbar.
- `npm run typecheck` clean; full frontend suite 139 files / 1917 tests pass.

