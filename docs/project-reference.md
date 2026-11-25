# All Outdoor — Claude Code Context

## How to use this file

**Rules, not history.** Standing decisions, hard constraints, and traps that have
already cost a session or an outage. When a decision changes, edit the rule in
place. Do not append a session trail — that is what `git log` and `HANDOFF.md`
are for.

**Where the code and this file disagree, the code wins** — tell the operator, then
fix the rule here.

**Detail lives elsewhere.** `docs/INDEX.md` is the map of every document in the
repo and says which ones still describe the running system. Read it before
concluding something is undocumented.

Last full audit of this file against the running system: **2026-09-10**.

---

## What this is

**All Outdoor** is South Africa's new-and-secondhand outdoor store, and — behind a
login — a verified firearms, hunting and outdoor marketplace. It also runs a
licence-application service (SAPS motivations, a document vault) and The Bench, a
reloading load finder.

**The registered entity is ALLOUTDOOR (PTY) LTD, Reg. 2026/639713/07.** That is
the name in the ECT § 43 disclosure. GunGalore (Pty) Ltd (Reg. 2026/393321/07) is
a **separate, wound-down company** and must not appear anywhere user-facing. The
live domain is **alloutdoor.co.za**; the rebrand is done, not planned.

Brand strings live in `frontend/lib/brand.ts` and `backend/src/common/brand.ts`.
Never hard-code the name.

**The platform is not trading.** As of 2026-09-07 production holds 2 users, 2
listings, **0 transactions**, 1 motivation. Nothing has ever been sold. Several
rules below are affordable *because* of that; if that changes, they need
revisiting.

---

## Absolute rules — never break these

1. **"Escrow" never appears in user-facing copy.** It is a regulated SA financial
   term All Outdoor is not registered for. Use `paymentStatus`, "funds held",
   "payment protected", "payment released". ⚠️ The guard that *blocks* the word
   (and its tests) is the mechanism, not a violation — do not "clean it up".
2. **A firearm never travels by courier.** Enforced in
   `shipping.service.ts`. Two lawful routes: `DEALER_TRANSFER` (buyer picks the
   receiving SAPS-licensed dealer at checkout) and `PRIVATE_ARRANGE` (both parties
   attend a dealer in person, no pre-picked dealer). Every firearm listing must
   offer DEALER_TRANSFER; PRIVATE_ARRANGE is always available too, behind a hard
   consent screen.
3. **Air rifles are NOT firearms** under SA law. No licence; they ship as a normal
   accessory. Category slug `air-rifles`.
4. **Live ammunition, primers and propellant are banned platform-wide.** Empty and
   once-fired brass and projectiles/bullets are allowed.
5. **KYC is a seller-only gate.** No code path may check `kycStatus` on someone
   buying, bidding or making an offer.
6. **No wallet.** No user balance, stored credit or ledger. Money moves
   per-transaction through the gateway.
7. **Never expose real names to other users.** Public surfaces show `username`
   only — never `firstName`/`lastName`, never initials, never an `@` prefix.
   Fallback: "Anonymous bidder" / "Anonymous seller". Real names exist only inside
   KYC, paid-transaction internals (dealer paperwork, dispatch addresses),
   PRIVATE_ARRANGE post-acceptance contact reveal, admin surfaces, and a user seeing
   their own data.
8. **Never name a competitor** in user-facing copy. Say "scheduled auction sites",
   "retail stores". WhatsApp and Facebook groups may be named.
9. **Secrets live only in `.env`.** Never in this file, a prompt, a commit
   message, or chat. This file names variables, never values. An exposed secret is
   a compromised secret — rotate it.
10. **Never `prisma db push`.** See the schema-drift trap under the deploy command.
11. **Never enter or store raw card numbers.** Cardholder data lives only on the
    gateway's hosted page. Seller *bank* details are stored deliberately
    (`User.bankAccountNumber` and friends) because the payout rail needs them.

There is **no public dealer directory**. There *is* a public seller storefront —
see Public vs Members.

---

## The 18+ gate — read before changing any content read path

The site's front door is a one-tap **18+ declaration**, not a login. Meta
restricted the site twice for regulated goods; every content page now sits
behind the age gate so a crawler only ever receives the neutral gate page.
Signed in or out, the CATALOGUE IS THE SAME.

**This is an age gate, NOT cloaking.** Every visitor without a declaration gets
identical content regardless of user-agent. Never branch on user-agent; never
special-case a crawler. The mechanism is that a crawler does not click; adding
a user-agent branch would turn this into exactly the cloak that gets a site
banned.

**The three classes** (`frontend/lib/route-gate.ts`; middleware + backend
enforce them):

| Class | Needs | Examples |
|---|---|---|
| `gate-exempt` | nothing | `/gate`, `/api/*`, `/admin/*`, sign-in/up, `/robots.txt`, credential links (`/a/*`, `/t/*`, `/witness`, `/consent`, `/dealer-portal`, print/book), `/data-deletion` and `/paia` (statutory/Meta carve-outs) |
| `member-only` | a signed-in session | account/settings/messages/orders/my-*, cart/checkout, seller tools, the Document Library (`/documents`, `/licence-centre` + applications/review/pack), saved trackers, community me/settings |
| `content` (default) | the 18+ declaration OR a session | catalogue, categories, brands, sellers, community, The Bench, Application Tracker root, all legal/info pages |

**The enforcement, not the UX.** `frontend/middleware.ts` redirects an
undeclared visitor to `/gate`; the backend's `ContentAccessGuard` 404s any
content API call from a caller with neither a session nor a valid `ao_cat`
declaration. Both read only the signed cookies — never a header or UA.
`OptionalAuthGuard` stamps `request.catalogueDeclared`; `ContentAccessGuard`
decides access. A service-level 404 based on `publicVisible` is WRONG now: it
would hide half the catalogue from a declared visitor.

**The declaration token.** `ao_cat` is a JWT with audience + purpose
`catalogue-gate`, 30 days, signed with `JWT_MEMBER_SECRET`, no `sub`. It can
never authenticate and a session can never be used as a declaration. Minting
and clearing live in `backend/src/auth/catalogue.controller.ts`.

**Legacy `publicVisible`.** `Category.publicVisible` and
`Listing.publicVisible` remain in the database (and the 2026-08 gating data is
untouched) but no longer decide display. Do not add new read-path filters on
it. `publicVisible` stays in Meilisearch's filterable attributes only because
documents still carry the field.

**Rules when touching this:**

- A content controller needs `@UseGuards(OptionalAuthGuard, ContentAccessGuard)`
  and BOTH guards provided in its own module (Nest resolves `@UseGuards` in the
  controller's module). A content read path with no guard is a gate-bypass API.
- Never `revalidate`/`force-cache` a fetch whose result varies by viewer. Use
  `viewerFetch` (server) / `useViewerFetch` (client) — `viewerFetch` forwards
  the session token AND the `ao_cat` declaration.
- `findById` still returns **404**, never 403 and never "sign in to view".
- Status gates are NOT the content gate: DRAFT / PENDING / EXPIRED listings
  still 404 for everyone but the owner.
- **No weapon word in a crawler-reachable string.** The gate page is the only
  page a crawler sees and its copy is deliberately neutral. The old
  `assertNoWeaponWordInPublic` seed guard stays as defence in depth.
- SEO of content is intentionally off (`robots.txt` disallows `/`; no content
  sitemap). The gate is the protection; a sitemap of gated URLs would only be
  a list of soft-404s.

`backend/src/listings/content-visibility.spec.ts`,
`backend/src/auth/content-access.spec.ts` and
`frontend/lib/route-gate.spec.ts` lock this. If a change makes them fail, the
change is wrong.

**`gungalore.co.za` is retired.** Its hosts no longer answer (Cloudflare returns
522). ⚠️ **The DNS zone must stay up** — the MX records carry the operator's
mailbox. Kill the zone and you kill their email.

---

## COMMAND: "deploy now"

When the operator types **"deploy now"**, run this in order, reporting each step.
If any step fails, STOP, report exactly what failed, and wait.

**There is one production box.** `ssh alloutdoor` — alloutdoor.co.za, app at
`/home/alloutdoor/app`, user `alloutdoor`, branch `feat/takealot-ux-parity`.
The retired `gungalore` alias was **deleted** from `~/.ssh/config` on 2026-08-29
and must not be recreated; deploying there would apply a replaced migration
baseline over a live database. ⚠️ The KEY is still `~/.ssh/gungalore_deploy` and
is **still in use** by the `alloutdoor` block — never delete it while tidying up
"gungalore" references.

**Deploy branch (LOCKED): `feat/takealot-ux-parity`.** NOT `main`.
`git push origin main` succeeds and ships nothing.

**STEP 1 — verify code is clean.**
`cd backend && npx tsc --noEmit`, then `cd ../frontend && npx tsc --noEmit`.
⚠️ Do NOT pipe tsc into `tail`/`head` and read the exit code — that reads the
pipe's status and reports a clean build over a broken one. Use
`npx tsc --noEmit >/dev/null 2>&1 && echo CLEAN`.

**STEP 2 — run the tests.** `npm test` in both.
⚠️ **`deploy.sh` runs no tests and no type-check** — this step is the only gate,
and it is manual.
⚠️ Backend tests need `npm test`, not `npx jest`: `package.json` supplies
`node --experimental-vm-modules`, and without it a PDF spec fails 16 times in a
way that reads exactly like a real regression.
⚠️ **The frontend is VITEST, not jest, and a spec can be invisible.** The
include is `['lib/**/*.spec.ts', 'components/**/*.spec.tsx']` — note the **x**.
A spec written as `.spec.ts` under `components/` is never collected: it reports
nothing, fails nothing, and passes this gate **by not existing**. All 38
component specs are `.spec.tsx`; keep it that way.

**STEP 3 — production build check.** `cd frontend && npm run build`.
⚠️ Run it in the **FOREGROUND** and read its exit code directly. Detaching and
polling a log is the pattern that took the site down on 2026-08-19 and was
deliberately removed. If it risks a tool timeout, raise the timeout — do not
detach. There is no `wait-for-build.sh`; do not go looking for one, and do not
hand-roll a wait loop.

**STEP 4 — commit.** Stage deliberately. Do not `git add .` — the tree carries
scratch from other workstreams.

**STEP 5 — deploy.** `bash infra/deploy/deploy.sh [--backend-only|--frontend-only]`
with the deploy branch checked out. It hardcodes
`HOST=alloutdoor`, refuses a dirty tree, pushes the branch, verifies the box's
branch and HEAD, **takes a pre-deploy database backup** (`~/bin/backup.sh`, and it
prints the dump name — that is your rollback point), then for each app: `npm
install`, `prisma migrate deploy`, `prisma generate`, build, artefact check,
`pm2 reload`, and **two** health checks. Warden is a third, non-fatal stage.

**Full deploy or one side?** If the diff touches any `backend/` or `prisma/` file
it is a full deploy. A frontend-only diff can use `--frontend-only`, and the
backend then keeps serving untouched.

⚠️ **The two artefact checks are what prevent the 2026-08-19 failure.** After any
build that exits 0, verify `test -s backend/dist/src/main.js` and
`test -s frontend/.next/BUILD_ID` before reloading. `.next` existing proves
nothing — it is present throughout the build.

⚠️ **`prisma generate` ALWAYS runs before `npm run build`.** `nest build`
type-checks against the *generated* client, and a stale one lets pm2 reload the
old `dist/` with no visible error.

⚠️ **SCHEMA-DRIFT TRAP.** Two services add `tsvector GENERATED` columns and GIN
indexes at boot via raw DDL — the Ask GG KB (`AskGgKbEntry.searchTsv`) and the
reloading-manual FTS (`ReloadingManualPage.textTsv`, plus a pg_trgm index on
`extractedText`). These columns are **not** in `schema.prisma`.
`prisma db push --accept-data-loss` drops them. For routine deploys run
`prisma generate` only; for a real schema change write a migration and run
`prisma migrate deploy`.

⚠️ **`pm2 reload` is NOT zero-downtime here.** All three processes run
`exec_mode: 'fork', instances: 1`, so reload is a restart. Keep using reload (it
signals node for a graceful shutdown), but know the consequence: a **failed build**
is safe — deploy.sh dies before touching pm2 and the old version keeps serving —
whereas a **failed health check after reload is an outage**, because the old
process is already gone. Do not `pm2 restart` automatically; stop and report.

⚠️ **A RELOAD KILLS AN IN-FLIGHT GENERATION, AND IT USED TO STRAND THE MEMBER
FOREVER.** Because reload is a restart, deploying while somebody is generating
a motivation kills the request mid-run. The row stays `GENERATING`, which is
not in `REGENERABLE`, so every retry after that is answered "This document is
already being prepared. Give it a moment." — on 2026-09-10 that had to be
undone with a hand-written UPDATE against production. A `GENERATING` row
untouched for `STALE_GENERATION_MS` (10 minutes) may now be re-claimed, so the
member waits rather than needing an admin. **Ask before deploying if the
operator might be mid-generation** — a pass is about two minutes.

**STEP 6 — verify health.** `curl localhost:3001/api/health`, `curl localhost:3000`,
and the public site — each twice. `pm2 list` must show **three** services online:
`alloutdoor-backend`, `alloutdoor-frontend`, `warden`.

**STEP 7 — update `HANDOFF.md`**, not this file. Record what shipped and anything
the next session must know.

**STEP 8 — commit and push that.**

**STEP 9 — final report.** What deployed, and the health result.

`pm2 save` / `pm2 startup` are configured, so services auto-start on reboot.

---

## The box

- **Production: `ssh alloutdoor`** — a VPS at **Absolute Hosting**, Nginx + PM2.
  Always use the alias; `ssh user@<IP>` bypasses the operator's key config.
  ⚠️ **NOT Vultr.** Vultr is the OLD box (see below) and the operator has had to
  correct this more than once. The machine reports plain QEMU/KVM with a
  `DataSourceNoCloud` cloud-init seed, which is how you can tell from the box
  itself rather than from a document.
- **Specs:** 4 vCPU, 8 GB RAM, 8 GB swap, 96 GB disk (~26 GB used). That answers
  the replatform doc's open question about whether the frontend build would fit
  beside Postgres and Meilisearch: it does.
- **Three pm2 services:** `alloutdoor-backend`, `alloutdoor-frontend`, `warden`.
- **Ports:** 3000 frontend, 3001 backend, 5432 Postgres, 7700 Meilisearch.
- ⚠️ **`psql "$DATABASE_URL"` FAILS, and it does not look like a syntax error.**
  The URL carries Prisma's `?schema=…` query string, which libpq rejects with
  `invalid URI query parameter: "schema"` — which reads like a permission or
  connection problem and has been reported as "the database is blocking me".
  Strip the query string:

  ```bash
  ssh alloutdoor 'cd /home/alloutdoor/app/backend && DB=$(grep -m1 ^DATABASE_URL .env | sed "s/^DATABASE_URL=//; s/^\"//; s/\"$//; s/?.*$//") && psql "$DB" -c "select count(*) from \"User\";"'
  ```

  Postgres itself is not the constraint: `max_connections` is 100 against ~6 in
  use.
- Node v22, npm 10. 64 Prisma migrations, all applied.
- **Cloudflare sits in front with an Origin Certificate.** The origin IP is
  deliberately not written down anywhere in this repo — publishing it lets anyone
  bypass the WAF. It lives in the password manager and in `~/.ssh/config`.
- Nginx has **one** site plus a catch-all `server_name _;` returning **444**, so
  anything that is not alloutdoor.co.za, bare-IP scans included, gets the
  connection dropped.
- **Encrypted identity documents** live at `/var/lib/alloutdoor/secure-uploads`
  (`SECURE_UPLOAD_DIR`, mode 0700) — **outside** the app dir, so deploys never
  touch them, and **not** in a `pg_dump`.
- The marketing landing page at `/var/www/html` is separate — **never touch it**.
- ⚠️ **The old Vultr box is still running, and three applications live on it** —
  the Ballistic Calculator (`~/ballistics-app/`, `ballistics.gungalore.co.za`, own
  database, own pm2 processes, own nginx site), ballistic-hunter, and
  pvrescue.co.za. None of them is on the production box. Keep the old machine for
  at least three months after go-live: it is the fallback build machine and it
  holds the only original copies of the reloading PDFs until the rsync is
  verified. Its `ssh gungalore` alias was deleted, so it is not reachable by name
  from here.
- ⚠️ `ballistics.gungalore.co.za` is a subdomain of the domain being allowed to
  lapse. It needs its own home before that happens — cheap now, an outage later.
- **No staging.** Work hits production after local type-check, tests and build.

### Backups and recovery

- Nightly **02:10 SAST** via the `alloutdoor` user's crontab
  (`infra/backup/backup.sh`, deployed to `~/bin/backup.sh`). **14-day** retention.
- It backs up **three trees**: `db/`, `uploads/` (the encrypted secure-upload tree)
  and `cip/`. A `pg_dump` alone is not a complete backup — identity documents,
  licence scans and safe photographs live on disk, and restoring the database
  alone leaves rows whose bytes are gone.
- ⚠️ **A restore is impossible without `ID_HASH_SECRET`.** The uploads archive is
  AES-256-GCM encrypted with a key derived from it. That value lives only in the
  password manager, deliberately not beside the ciphertext; rotating it makes
  every existing archive permanently unreadable.
- ⚠️ **Backups are written to the same disk as the originals.** They protect
  against a bad migration or a wrong DELETE, **not** against losing the machine.
  Off-box copies do not exist.
- **How a failure is noticed:** a run that FAILED writes a `BACKUP_FAILED`
  AdminAlert via psql (so it works when Node is what is down); a run that NEVER
  HAPPENED shows as a stale `cron:lastrun` heartbeat on `/admin/health`.
- **There is no Sentry.** Error and job-failure surfacing is in-house — AdminAlert
  rows into `/admin/alerts`, heartbeats on `/admin/health`, and Warden. Nothing
  pages anyone; somebody has to look.
- ⚠️ **ALERTS ARE GROUPED BY CATEGORY SO CRON NOISE CANNOT BURY MONEY WORK**
  (2026-11-24). Every AdminAlert type maps to `MONEY` / `ACCOUNT` /
  `MARKETPLACE` / `SYSTEM` / `OTHER` in
  `backend/src/admin/admin-alert-category.ts`; `MONEY + ACCOUNT` form the
  **Money & accounts** tab of the Operate inbox and are the ONLY alerts the
  Operate tab badge counts. Cron, webhook, channel and unknown types
  (`SYSTEM`/`OTHER`) live in their own **System & crons** tab and on the Warden
  board. The split is returned by `/admin/alerts`, `/admin/alerts/types` and
  `/admin/alerts/count` (`{unresolved, urgent, core, marketplace, system}`).
  ⚠️ A new alert type that is not added to the classifier lands in `OTHER` and
  will not badge the money tab — add the type when you add the alert, and
  extend `admin-alert-category.spec.ts`.

---

## Environment variables and secrets

Values come from `.env` only. This section names variables, never values.

**Frontend**: `JWT_MEMBER_SECRET` (⚠️ NOT `NEXT_PUBLIC_` — it verifies the
session cookie in `middleware.ts` and in server components, and a
`NEXT_PUBLIC_` prefix would inline the signing secret into the browser
bundle), `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_SCANNER_V3`,
`NEXT_PUBLIC_DISABLE_PWA` (absent in production, which is the correct resting
state — do not read its absence as the switch being broken).

**Backend**: `DATABASE_URL`, `JWT_MEMBER_SECRET`, `JWT_ADMIN_SECRET`,
`ID_HASH_SECRET`, `HEALTH_PING_SECRET`, `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`,
`DIDIT_WEBHOOK_SECRET`, `DIDIT_MODE`, `DIDIT_BASE_URL`, `GEMINI_API_KEY`,
`GROK_API_KEY` (rollback only),
`LLM_PROVIDER`,
`LLM_MODEL`, `LLM_IMAGE_MODEL`, `XAI_IMAGE_MODEL`, `ANTHROPIC_API_KEY` (rollback only),
`INTERVIEW_BRIEF` (`off` disables the research brief and its chips; env + reload),
`CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `MEILISEARCH_HOST`,
`MEILISEARCH_API_KEY`, `SMSPORTAL_CLIENT_ID`, `SMSPORTAL_API_SECRET`,
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
`RESEND_API_KEY`, `BOBGO_API_KEY`, `BOBGO_BASE_URL`,
`BOBGO_WEBHOOK_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_VISION_API_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`, `WARDEN_TOKEN`, `WARDEN_BASE_URL`,
`RELOADING_MANUALS_INBOX_DIR`, `RELOADING_MANUALS_STORAGE_DIR`, the
`ZOHO_BOOKS_*` set, **`YOCO_SECRET_KEY`, `YOCO_WEBHOOK_SECRET`** (the
motivation paygate only — `YOCO_API_BASE` optional), `COMING_SOON_GATE`,
`ALLOW_LOCAL_ORIGINS`, and for Ozow:
**`OZOW_CLIENT_ID`, `OZOW_CLIENT_SECRET`, `OZOW_SITE_CODE`,
`OZOW_WEBHOOK_SECRET`, `OZOW_ENV`** (plus the payout set
`OZOW_PAYOUT_API_KEY` / `OZOW_PAYOUT_SITE_CODE` / `OZOW_PAYOUT_ACCESS_TOKEN` /
`OZOW_PAYOUT_ENCRYPTION_KEY`).

⚠️ **The Ozow names matter.** No `OZOW_ACCESS_TOKEN`/`OZOW_BASE_URL` is read by
anything — hosts are hardcoded per environment. An operator setting the wrong
names at go-live gets a silent mock, because missing credentials do not stop the
boot.

⚠️ **`ALLOW_LOCAL_ORIGINS`** lets the production API accept credentialed requests
from localhost and LAN origins, so a developer can run the frontend locally
against real data. It warns on every boot and raises a Desk card. It is currently
**false**. Never turn it on once the platform carries real members.

---

## Tech stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind.
  ⚠️ **Turbopack is opted OUT** — both `dev` and `build` pass `--webpack`.
  Anything reasoning "Turbopack in dev" is wrong here.
- **Backend:** NestJS + TypeScript. **ORM:** Prisma 7. **DB:** PostgreSQL.
- **Search:** Meilisearch. **Images:** Cloudinary.
- **Auth:** self-hosted for members; custom JWT for admin. Two secrets,
  `JWT_MEMBER_SECRET` and `JWT_ADMIN_SECRET`, and ⚠️ **they must differ** — the
  same value on both and a member token verifies on an admin route. Both
  hard-throw at boot in production.
- **SMS:** SMSPortal — notifications, action SMSes **and the phone OTP**.
  **Email:** Resend — every transactional email **and the sign-up code**.
  **Didit does identity only**: the hosted seller-KYC session, nothing else.
  ⚠️ **THE OTPs WENT TO DIDIT AND CAME BACK, 2026-09-11.** Both codes are
  minted, sha256-hashed and checked in this codebase — `auth.service.ts` for
  email, `users.service.ts` for phone. Didit billed $0.03 an email and
  $0.1048 a ZA SMS against rails already paid for, sent the email under its
  own branding from its own domain, and **refuses phone verification entirely
  until the organisation's first top-up** (HTTP 403 — an account state, not a
  bad number, which surfaced as members told to check a number that was fine).
  The four adapter methods are deleted, not unused: do not re-add them without
  moving the callers, because two implementations of one OTP is how a code
  gets checked against the wrong store. What this gives up is Didit's phone
  intelligence — VoIP, disposable number, recent-port (SIM-swap) and trust
  index — which was never being bought and is a separate decision if wanted.
  ⚠️ **AWS IS GONE ENTIRELY.** Textract went in 2026-09-08; Rekognition
  face-match and Face Liveness went with the Didit cut-over, and with them
  `aws-kyc.service.ts`, `AWS_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`/`_REGION`,
  `AWS_KYC_LIVENESS_ROLE_ARN` and `infra/aws/kyc-iam-policy.json`. Nothing in
  this codebase calls AWS any more.
  ⚠️ **Gemini still reads DOCUMENTS, just not IDENTITY ones.** The Licence
  Centre's credential reader and `readFirearm()` are unchanged; only the KYC
  identity read moved, because Didit reads the document as part of its own
  session. Reads still use `json: { schema }` so the provider enforces shape.
- **Shipping:** **Bob Go** — the only courier rail. The buyer picks Cheapest
  Door, Fastest Door, or Pargo Store Pickup from one quote. See Shipping.
- **Payments:** Ozow — **live for money-in** (2026-10-10); money-out gated on the float. See Money.
- **Accounting:** Zoho Books (live). Odoo was the earlier plan and is archived —
  do not build against it.
- **AI:** Gemini 3.5 Flash-Lite through the Google Gen AI API.
  ⚠️ **Every model call goes through ONE adapter** — `LlmService` in
  `backend/src/common/llm/`. No service builds its own client, picks its own model
  or parses a provider response; they speak `LlmRequest`/`LlmResponse`.
  Env: `GEMINI_API_KEY`, `LLM_PROVIDER` (default `gemini`), `LLM_MODEL`.
  **Anthropic is the ROLLBACK LEVER, not a second supported mode:**
  `LLM_PROVIDER=anthropic` plus an explicit `LLM_MODEL` and a reload puts the
  platform back with no deploy. It REQUIRES `LLM_MODEL` — no Anthropic model id is
  guessed, because every one this codebase used is a dated snapshot.
  Spend is metered by us, not the provider: `LlmService` writes an `AiUsage` row
  per call (purpose, tokens, latency, cost) and `/admin/credits` reads that ledger.
- **Pictures:** `LlmService.generateImage()`, same adapter, its own request and
  response shape (nothing an image call needs is what a text call needs).
  Model `gemini-3.1-flash-lite-image` — "Nano Banana Lite" is a nickname, the
  id was read off `GET /v1beta/models` on our own key. `LLM_IMAGE_MODEL`
  overrides it without a deploy. Anthropic has no image model: the adapter
  raises `unsupported` (a distinct code from `not_configured`, because a
  missing key and a provider that cannot draw are different problems).
  ⚠️ **THE MOTIVATION PLATES RUN ON GEMINI'S LITE IMAGE MODEL.** Operator,
  2026-11-17: "move the motivation image generation to gemini 3.5 lite" —
  reversing the 2026-10-15 "wire in the grok" pin. The PURPOSE exhibits
  (`motivation.plate`) and the QUARRY plate (`motivation.quarry`) are pinned to
  the `gemini` provider in `providerFor`.
  ⚠️ **`gemini-3.5-flash-lite` ITSELF CANNOT DRAW, AND IS NOT WHAT DRAWS THEM.**
  Probed on this key 2026-11-17: it answers an image request with prose and no
  `inlineData`, even with `responseModalities: ['TEXT','IMAGE']`. The drawing
  model is the Lite image id above; a real plate on it returned in ~6 s at
  1 120 image tokens, about 3.4 US cents. Pointing a plate at a text id spends
  the call and stores nothing (the `safety`/empty-answer guard then fails the
  plate), so do not "fix" the id to a 3.5 text model.
  ⚠️ **xAI IS THE ROLLBACK LEVER, NOT A SECOND LIVE MODE.** `grok-imagine-image-2.0`
  at a flat $0.08/image (`XAI_IMAGE_MODEL` overrides it; `GROK_API_KEY` is the
  key, with `XAI_API_KEY` accepted). An explicit
  `LLM_PROVIDER_MOTIVATION_PLATE` / `_QUARRY=xai` moves a purpose back with an
  env edit and a reload. xAI has **no "enhance prompt" parameter** — the
  curated course-of-fire and species prompts are sent verbatim on either
  provider.
  ⚠️ **IMAGE OUTPUT IS TWENTY TIMES THE TEXT RATE AND ARRIVES IN THE SAME
  COUNTER.** $30/1M against $1.50/1M, both inside one `candidatesTokenCount`,
  so `mapUsage` carves the image half out via `candidatesTokensDetails` and
  `costUsdMicros` prices it separately. Billed as prose, a 3.4-cent plate reads
  as a tenth of a cent. (xAI bills per image instead — `LlmUsage.images` carries
  the count and `flatPerImageUsd` prices it.)
  ⚠️ **AN EMPTY ANSWER IS A REFUSAL, NOT A SHAPE TO TRUST.** The safety filters
  return a candidate with no picture in it; a caller that assumed otherwise
  would store a zero-byte plate and print a blank box in a lodged document.

**Prisma 7 notes (do not revert):** generator is `prisma-client-js` (not
`prisma-client`, which emits ESM incompatible with Nest's CommonJS output);
`PrismaService` passes `adapter: new PrismaPg(DATABASE_URL)` to `super()` because
Prisma 7's WASM engine requires an explicit driver adapter; CLI config lives in
`backend/prisma.config.ts`.

⚠️ **Every module that mounts a guarded controller must resolve that guard's
dependencies itself.** Nest resolves a controller's `@UseGuards` classes inside
the controller's **own** module; a guard registered globally elsewhere does not
cover it. `AdminJwtGuard` injects `JwtService`, `PrismaService` and `Reflector`, so
any module with an admin controller needs `JwtModule.register({})` in `imports`
and `AdminJwtGuard` in `providers`. Getting this wrong crash-loops the backend at
boot while `tsc` and every unit test stay green — it took the site down for four
minutes on 2026-09-07. **Give every such module a boot spec** that compiles the
module the way the app does; `news.module.spec.ts` and `crime-stats.module.spec.ts`
are the pattern.

---

## What is live, what is inert, what is gone

**Live and trading-shaped:** the storefront (Buy Now + Auction), offers, the cart
and checkout flow (503 today), messaging, ratings and seller tiers, wishlist and
saved searches, notifications (email + SMS + in-app inbox + web push), the Desk,
the Licence Centre / Document Centre, the Motivations builder, The Bench, crime
stats, news clippings, complaints, the reloading corpus, Warden.

**Built but INERT, behind a switch:**
- **Motivation paygate (Yoco)** — code-complete and inert until the `YOCO_*`
  keys exist and `motivation_paid_enabled` is ON. Not a marketplace rail.
- **Peach pay-in** — **LIVE 2026-11-24** (`peach_payin_enabled` ON): buyers can
  choose Card alongside Ozow. The live Hosted Checkout entity + secret token are
  on the box; `npm run peach:smoke` reports READY. Ozow remains the default rail.
- **Peach payouts** — hidden until `peach_payouts_enabled` is ON and the Peach
  Payouts product is configured. A Peach-paid sale is never routed to Ozow.
- **BANV** — requests run once Peach Payouts credentials exist, but the payout
  HOLD on `bankVerifiedAt` only applies while `peach_payouts_enabled` is ON.
  Configured-but-dark must not gate the live Ozow payout queue. It verifies the
  destination bank for both rails (account exists/open + SA-ID ownership).
  Do not claim automated verification in user-facing copy before the product is
  configured and the first checks pass.

**Gone — do not rebuild.** The retired-feature list lives in one place now:
`AGENTS.md` → "Retired Features (do not rebuild)". Do not reintroduce them,
document them as live, or resurrect their routes, models, flags or copy.

⚠️ **An orphaned Prisma model is not evidence a feature is live.** Check for a
route and a controller before believing in a feature.

---

## Money

### Commission

Marginal tiers, tax-bracket style (`backend/src/payments/fee.calculator.ts`):

| Band | Rate |
|------|------|
| First R25,000 | 10% |
| R25,001 – R50,000 | 9% |
| R50,001 – R75,000 | 8% |
| Above R75,000 | 7% |

Minimum platform fee **R10** per sale, never more than the amount it is charged on.
There is **no Top Seller fee discount** (tier is badge-only).

⚠️ **Fee income has TWO directions on the same columns, so read
`Transaction.feeModel` before describing any sale.** `feeModelFor()` snapshots it
at checkout.

- **`BUYNOW_MARKUP`** — a marketplace sale (enum name is historical). The seller's
  ask IS the listed price; the seller receives it in full (`commissionZar = 0`).
  The buyer pays ONE **Platform Fee**, calculated last at checkout on (item +
  delivery) and stored in `processingFee`. `Listing.price` is the ask, not a
  marked-up figure. Multi-buy: the fee is calculated on the whole line after
  quantity. The compare-at "was" price validates against the listed price.
- **`SELLER_DEDUCT`** — auctions. A flat 10% Platform Fee split 5% / 5%: the
  buyer pays 5% of (hammer + delivery) at checkout (`processingFee`) and the
  seller pays 5% of the hammer (`commissionZar`, deducted from `sellerPayout`).
  An offer accepted on a Buy Now listing uses the marketplace model; an offer on
  an auction uses the split.
- **Private arrangement** — delivery and handling are zero; the fee is calculated
  on the item price only.

**Delivery carries no margin** (retired 2026-10-23) — the buyer pays the
courier's live rate. Never render it as "quote + 10%" or a separate handling
row. `shippingHandlingCents` remains on historical rows only. The Platform Fee
is charged on the item plus that rate.

### Payments (Ozow + Peach) — dual rails, locked per transaction

Two pay-in rails: Ozow's One API (instant EFT) and Peach Checkout V2 (card).
Each provider also has its own payout product (Ozow Payouts, Peach Payouts).
⚠️ **The rail is locked at checkout.** `Transaction.paymentProvider` is set
once (`OZOW` or `PEACH`) and never changed. A refund and a seller payout must
use the provider that captured the money. There is **no cross-rail fallback**
— an Ozow-paid sale is never paid out via Peach, and vice versa. The buyer
picks the rail at checkout; Ozow is the default.

- **15-minute Buy Now hold:** opening `/checkout/[listingId]` for a plain
  `BUY_NOW` listing reserves exactly ONE unit (`CheckoutHold`) and starts a
  visible countdown. Pay claims that hold and deletes it in the same DB
  transaction as the `Transaction` row; extra units selected at Pay are
  reserved atomically then. An unpaid hold is released by the every-minute
  `checkout-hold-expiry` sweep, which restores the unit and relists the item.
  Auction wins and offer checkouts keep their existing 24h windows. Every
  gateway attempt stores its absolute deadline in `Transaction.manualPayByAt`
  (reused from the retired manual-EFT column); the Ozow link is minted with the
  REMAINING time to that deadline. `reconcileStaleGatewayCheckouts()` releases
  only after that deadline and only when the provider status is terminal:
  Ozow `Incomplete` after expiry, explicit Peach declines/cancellations, or
  Peach `NOT_FOUND`. A Peach `pending`/unknown result is never deleted —
  its checkout may still settle, and deleting it would orphan the money.

- **Interrupted checkout:** `POST /transactions/:id/resume` requires the same
  buyer and reuses the SAME transaction. If the provider still reports
  `pending`/`Incomplete` it refuses to mint a second link; if the attempt is
  already paid it reports `paid`; after a terminal failure it mints one fresh
  checkout for the same row and amount. My Orders, the order page and the
  listing page's "Resume payment" CTA all point here. Generic `/checkout/...`
  is never used to resume an accepted offer (it would charge the listing
  price instead of the agreed offer).

- **Payment proof:** `paymentStatus: HELD` is the default at row creation, so
  it is NOT proof of payment. Every money-moving action (confirm-delivery,
  dealer-verify release, admin release, Private Arrangement release) must also
  require `paidAt`, and the atomic CAS must carry the same predicate.

- **Pay-in:** the buyer chooses a rail at checkout; `PaymentRailsService`
  routes to `ozow.createPayment()` (One API) or `peach.createCheckout()`
  (Checkout V2). Both return a hosted-page redirect. `/checkout/complete`
  calls `verifyResult()`, which re-fetches authoritative status from the same
  provider and matches the bound transaction + amount before flipping
  `PaymentStatus`. ⚠️ Peach pay-in amounts are DECIMAL ZAR; Ozow pay-in is
  also decimal; PAYOUT amounts are integer cents. Never mix them.
- **Webhooks:** Ozow routes are `/webhook/ozow` (Svix-signed),
  `-payout-verify` and `-payout` (SHA-512 hash-checked). Peach routes are
  `/webhook/peach`, `/webhook/peach-payout`, `/webhook/peach-banv` and
  `/webhook/peach-dispute` (header or field signature; fail-closed in
  production). ⚠️ **A bad signature returns 200 `{received: true}`** with the
  handler skipped and `alertWebhookSignatureFailure()` raised — **not** a 401.
  A handler failure returns 500 so the provider retries.
- **Idempotency:** `gatewayMerchantRef`, `gatewayPayoutId` and
  `gatewayPaymentId` are `@unique` to block replay. ⚠️ `gatewayCheckoutId` is
  **not** unique — the Ozow pay-in webhook matches on `gatewayMerchantRef` (a
  `full` subscription carries it; a `thin` one cannot be matched). Peach
  matches on `gatewayCheckoutId` first, then its minted ref.
- **Pay-out:** ⚠️ **nothing pays a seller automatically unless the admin turns
  on auto payouts.** Dealer-verification APPROVED (firearms) or buyer
  Confirm-Delivery (non-firearms) make a payout DUE (they stamp `releasedAt`);
  one admin run (`ManualPaymentsService.runDuePayouts()`) **partitions the due
  rows by `paymentProvider`**:
  - Ozow rows → `ozow.createPayout()` (one `requestpayout` per transaction,
    AES-256-CBC account encryption with a unique per-attempt key wrapped at
    rest, plus SHA-512 `hashCheck`).
  - Peach rows → `peach.createPayout()` (batch `payouts[]`, client-minted
    UUIDv4 per row, Peach bank enum + universal branch code, integer cents,
    `PeachPayoutAttempt`).
  Gated on `PAYMENTS_LIVE`. An accepted request stamps `payoutRequestedAt`;
  `paidOutAt` is set only on confirmed completion (Ozow status 5 / Peach
  `successful`), and either provider can later report a return. Status
  webhooks + polling reconcile the attempt; final failures put the transaction
  on payout hold for admin review rather than automatically resubmitting it.
  ⚠️ **Peach payouts must stay enabled while any Peach-paid sale is unsettled.**
  Disabling Peach pay-in is safe; disabling Peach payouts before those rows
  settle strands them (they must not be routed to Ozow).
- **Seller failure charges (2026-10-27):** when a PAID sale ends because the
  seller declined it, never dispatched, or never delivered, the platform
  recovers the refund's gateway cost (**4% of the amount refunded**) plus any
  **committed courier rate** (`carrierShipmentId` exists). This is a **cost
  recovery, not a penalty** — the refunded Platform Fee itself is not recovered.
  The failed sale's payout is already zero, so the debt lives in the
  `SellerCharge` ledger and is **set off FIFO against a later payout** via
  `SellerChargeRecovery` (RESERVED on request, SETTLED on PayoutComplete,
  RELEASED on failure/return so it is never double-recovered). `netPayoutCents`
  subtracts the reserved slice; `getHeldFundsReport` nets outstanding charges out
  of `owedToSellers`. Triggers: `rejectTransaction` (only when the reason earns
  a strike), `autoRefundStale` (only when the seller is not blameless), and an
  explicit admin `chargeSeller` flag on `refundTransaction`. The seller's ONLY
  notice is one email after `DELIVERY_OBLIGATION_AFTER_HOURS` (48h) —
  `deliveryObligationNotifiedAt` makes it fire once. The rule is in Terms §11;
  admin waiver is the credit path when a Bob Go charge is reclaimed by hand.
- **Refunds:** `PaymentRailsService.refund(provider, …)` calls the rail that
  captured the payment (`ozow.refundPayment` or `peach.refundPayment`) BEFORE
  flipping the row to `REFUNDED`. Money moves first, ledger second — never the
  other way around. Legacy rows with no provider are treated as Ozow.
- **Refund policy (operator decision 2026-11-23) — non-delivery only.** The
  platform refunds ONLY where the item was never delivered: the seller never
  dispatched/handed over, or the carrier records no delivery. That refund is
  full — item, delivery and Platform Fee — and the courier 5-day no-dispatch
  auto-refund is unchanged. Condition, “not as described”, damage after
  delivery, wrong expectation, change of mind and location/travel are between
  buyer and seller: the buyer messages the seller from the order and may lodge
  a complaint, which does **not** hold the seller's payout and does not trigger
  a platform refund. `POST /transactions/:id/dispute` accepts only
  `NEVER_ARRIVED`; the retired reasons return a guidance 400. The buyer's CPA
  rights against the SELLER are untouched, and the T&Cs must keep saying so.
- **`PaymentStatus`:** `HELD`, `PENDING_ADMIN_VERIFICATION`, `RELEASED`,
  `DISPUTED`, `REFUNDED`.
- **BANV:** every bank-details save requests Peach BANV when the user has an
  SA ID on file. The result webhook stamps `User.bankVerifiedAt` on a pass;
  mismatch/failure clears it, raises an alert and notifies the seller. Seller
  payouts on **both** rails are held on `bankVerifiedAt` only while
  `peach_payouts_enabled` is ON — configuring the Payouts product is not a
  go-live switch, so it must not freeze the live Ozow queue. Buyer refunds are
  not gated. Users without an SA ID (buyer-only banking) are skipped until
  their profile supplies one. `POST /admin/users/:id/verify-bank` re-runs the
  check from the dossier.
  ⚠️ **The webhook is only a WAKE-UP.** `handlePeachBanvWebhook` reads the
  result (and every per-field match flag) back from the Payouts API by
  `bankVerificationId`; it never trusts the body. So a Payouts/BANV delivery
  whose signature does not verify (`PEACH_PAYOUT_WEBHOOK_SECRET` differs from
  the Checkout secret — live on 2026-11-24 one such delivery was dropped and
  bank verification stalled) is **logged, alerted, and still processed as an
  unverified hint**; the result still comes from Peach. A `@Cron` sweep
  (`reconcilePeachBanv`, every 10 min) polls every user with
  `bankAvsResult LIKE 'REQUESTED:%'` and no `bankVerifiedAt`, so a missed or
  dropped webhook resolves anyway. Without that pair a seller stays unverified
  forever and the payout gate silences the payout rather than paying it.
- **Peach wire formats (do not "simplify" these):** Checkout V2 is Bearer +
  JSON with the FLAT DOTTED key `authentication.entityId` (a nested
  `authentication:{entityId}` object is not parsed and surfaces as
  `404 Channel not found`). The refund endpoint is the classic (V1) surface:
  **form-urlencoded flat fields** (`authentication.entityId=…&amount=…&id=…&
  paymentType=RF&signature=…`) signed with `PEACH_SECRET` (HMAC-SHA256 over the
  sorted `key+value` concatenation), and its JSON **responses use flat dotted
  keys** (`"result.code"`), unlike the nested V2 status response. `npm run
  peach:smoke` probes the real gateway (OAuth, channel, refund-signature,
  Payouts/BANV, webhook registration) without moving money.
- **Peach bank vocabulary:** `peach-banks.ts` maps free-text bank names to
  Peach's strict enum and universal branch codes. An unmappable bank skips the
  Peach payout with a "re-pick your bank" reason; it is never guessed and never
  routed to Ozow.
- `OZOW_PAYOUT_ENCRYPTION_KEY` is the stable, 32+-character master secret used
  to wrap each payout's generated account-decryption key at rest. Rotating it
  while payout attempts are outstanding prevents verification from recovering
  their keys; rewrap outstanding attempts before rotation.
- **Test harness (staging).** Ozow's mandatory money-out test cases are driven
  from `OzowPayoutTestService` / `admin/manual-payments/ozow-test` and the CLI
  `scripts/ozow-payout-test.mjs`. ⚠️ **Refused by default:** the service runs
  only when `OZOW_PAYOUT_TEST=true` on a non-live box, and mock scenarios
  additionally need `OZOW_PAYOUT_MOCK=true` and the `…/mock/v1` host.
  Requests persist to the isolated `OzowPayoutTestAttempt` table — deliberately
  **not** anchored to a Transaction — so test payouts never appear in
  payouts-due, held-funds or Zoho. The verify/notification handlers reconcile a
  test attempt without mutating any ledger row.
  ⚠️ **Destination is Ozow's own staging Absa test account `4050338500`.**
  Ozow supplied it for exactly this. The harness resolves the bank from Ozow's
  live `getavailablebanks` list (`OzowService.resolvePayoutBank`), not our
  static seller list. The CDV case uses `1234567890`. The destination holder
  name is never transmitted (no such field in `requestpayout`), so it is
  cosmetic. Mock flags are written back using the exact key casing Ozow returns
  from `getTestConfiguration`.
- **Go-live flip — EXECUTED 2026-10-10** (money-in live; payouts armed but gated
  on the float and Ozow's payout-verification token): `OZOW_ENV=live`, `PAYMENT_MODE=paygate`, `PAYMENTS_LIVE=true`,
  `OZOW_PAYOUT_IS_RTC=true`, live One API + Payouts credentials, and the three
  webhook URLs on the production domain (the pay-in one registered as a `full`
  subscription, or the webhook cannot match a transaction). `OZOW_PAYOUT_MOCK=false`.

### KYC — seller-only

- Buyers, bidders and offer-makers **never** need KYC, in any module.
- The seller gate fires from the shared checkout core
  (`backend/src/payments/transactions.service.ts:612-618`, inside
  `reserveAndCreateLine()`) when a buyer **starts** checkout. It is
  fire-and-forget and idempotent, and both single-item and multi-item checkout go
  through that core.
- **The payout hard gate** is seller `kycStatus === VERIFIED` **and**
  `profileCompletedAt` set. `collectDue` skips anyone failing it and surfaces them
  as blocked money in the admin payouts-due preview rather than silently omitting
  them. `bankVerifiedAt` joins the gate only once BANV is live.
- ⚠️ **`DIDIT_MODE` HARD-THROWS AT BOOT unless it is `live` in production**,
  and that is the fix for a real incident class, not belt-and-braces. Its
  predecessor `VERIFYNOW_MODE` defaulted to sandbox and production boot only
  LOGGED an error, so a production box could — and did — run with sandbox KYC,
  passing every identity on canned data with nobody the wiser. Do not add a
  softer second copy of this check: that is how the hard one gets deleted.
- ⚠️ **OWN BRANDING ON THE HOSTED PAGE COSTS $0.20 A VERIFICATION.** Didit
  gives 500/month each of ID verification, passive liveness, face match and IP
  analysis, so the workflow we run is **$0.00** within the free tier and $0.33
  after it. `is_white_label_enabled: true` adds a flat $0.20/session.
  ⚠️ It does **NOT** cost the free tier, whatever Didit's own MCP tool
  description says — that was measured, not assumed: a white-labelled clone of
  our exact feature set prices at `min_price: 0.20, max_price: 0.53`. Were the
  free tier lost the minimum would be the full $0.53. So branding is
  **$0.20 per verified seller**, not $0.53. Check the flag in the console
  before pointing `DIDIT_WORKFLOW_ID` at a new workflow, and note it cannot be
  switched on later: a published workflow is `is_editable: false`, so turning
  branding on means a NEW workflow and a repointed env var.
- ⚠️ **THE WORKFLOW CARRIES EXACTLY THE FOUR FREE FEATURES — OCR, LIVENESS,
  FACE_MATCH, IP_ANALYSIS — AND EMAIL/PHONE VERIFICATION MUST STAY OUT OF IT.**
  Operator decision, 2026-09-10. Both are already verified at SIGN-UP —
  **by us**, not by Didit: `auth.service.ts` mints the email code and Resend
  delivers it, `users.service.ts` mints the phone code and SMSPortal delivers
  it. Adding either feature to the workflow would make a seller enter a second
  email code and a second SMS code inside the hosted session, and bill us
  $0.03 + $0.1048 for the privilege. There is no way to avoid that: the
  features have **no "skip if already verified" option** — only
  `duplicated_email_action` / `duplicated_phone_number_action`, which are
  verdicts on the repeat, not a bypass. The cost of the decision is that we
  forgo Didit's email-breach, disposable-address, VoIP, **recent-port
  (SIM-swap)** and trust-index signals; revisit that deliberately, not by
  adding a feature to the workflow because it looked missing.
  ⚠️ **THE WORKFLOW TO USE IS `b792ee05-948a-410a-8fa4-ca3d89511259`**
  ("All Outdoor Seller KYC", app `My Application`) — OCR + LIVENESS(PASSIVE) +
  FACE_MATCH + IP_ANALYSIS, white-label off, `is_desktop_allowed: false`,
  `min_price: 0`. It was created because **every workflow the API key reaches
  was wrong**: `401fd309` — the one Didit's own console boilerplate tells you
  to paste — has white-label ON *and* EMAIL_VERIFICATION in its graph, and is
  `is_editable: false` so it cannot be corrected. `f30edb44` is correctly
  shaped but lives in the **sandbox** app, which that key cannot reach.
  ⚠️ **LIVENESS must be `PASSIVE`.** `ACTIVE_3D` and `FLASHING` cost $0.15 with
  **no free tier**; passive liveness is one of the four free 500/month lines.
  A workflow created without naming the method is a silent cost change.
- ⚠️ **NO HOME AFFAIRS CHECK RUNS ANY MORE, AND NO COPY MAY CLAIM ONE.**
  VerifyNow returned the applicant's official name and date of birth, which is
  what let the verdict cross-check the typed details against the state rather
  than only against the document they uploaded. Didit's free tier has no
  equivalent, so names come from the document and the DOB is checked against
  the ID number's own digits. The paid replacements are
  `zaf_africa_national_id` ($1.10) and `zaf_dha_photo` ($1.10); until the
  operator turns them on, the anchored high-value re-check is gone too.
- ⚠️ **THE VERDICT ARRIVES BY WEBHOOK, NOT FROM THE REQUEST.** `POST
  /api/webhooks/didit` is public and HMAC-verified; a bad signature returns
  **200** with the handler skipped, never a 401 — the same convention the Ozow
  webhooks use, so grepping logs for 401s finds nothing. Didit delivers from
  the single static IP **18.203.201.92** (`User-Agent: DiditWebhook/2.0`), so
  **Cloudflare's WAF must allow it** or every delivery is dropped at the edge
  with nothing in any application log.
- Never use the word "KYC" in user-facing text — say "Verified" / "Verification".

---

## Shipping

- **Firearms / barrels:** `DEALER_TRANSFER` or `PRIVATE_ARRANGE` only, enforced
  server-side. Never by courier.
- **Non-firearms:** the buyer chooses one of **three options** from ONE Bob Go
  quote — **Cheapest Door Delivery**, **Fastest Door Delivery**, or **Store
  Pickup** (the nearest Pargo counters; the buyer picks one). **Pargo is the
  only pickup-point network**; Bob Box locker rates arrive in the same Bob Go
  reply and are filtered out (`pargoPickupRates`) so they are never offered or
  bookable. Every option is
  re-quoted **server-side** at Pay (`ShippingService.quoteForSelection`): the
  browser sends only the option kind and, for Store Pickup, the counter id — never
  a price/carrier/service code. The displayed price is the courier's live
  rate (no delivery margin since 2026-10-23). Firearms/barrels never see
  these (dealer/private only).
  `Transaction.deliveryOption` records the pick; `pickupPointLocationId` +
  `pickupPointSnapshot` the counter. `shippingMethod` names the **shape** of the
  delivery, not the company — route post-booking work on
  `Transaction.carrierProvider`.
- **In-person handover (`PRIVATE_ARRANGE`)** is always offered on any listing
  that is not collection-only, firearm or not, whether or not the seller
  enabled it in the Sell form: it books no courier and the checkout
  hard-consent screen spells out the terms. Funds stay HELD until the buyer
  confirms the handover (or auto-release 5 days after payment); both parties
  get the contact details of the other side on WhatsApp/SMS/email/in-app.
  ⚠️ **The buyer's "I received it" does NOT depend on the seller tapping "Item
  delivered".** The seller's tap is optional — the buyer's confirmation stamps
  the delivered time itself, and it is also accepted while the sale is
  `DISPUTED` (confirming receipt is how a buyer withdraws a handover report
  they raised by mistake). The seller's "Item delivered" stays available while
  HELD. Both money-moving taps sit behind a confirmation dialog in
  `frontend/app/transactions/[id]/private-arrange-panel.tsx`.
  ⚠️ **A handover dispute notifies BOTH parties** (short in-app + email + SMS:
  the buyer is told how to confirm if they did get the item, the seller is told
  the payout is frozen) and writes a `PRIVATE_ARRANGE_DISPUTED` tracking event;
  before 2026-11-24 it produced only an admin alert and the seller was never
  told. A **non-delivery** refund is full — item, delivery and Platform Fee
  (2026-11-23 policy). A condition or change-of-mind issue after the handover
  is not a platform refund at all.
  ⚠️ **One accept = one seller message.** `privateArrangeContactReveal` sends
  only the BUYER the seller's details; the seller's single accept-time message
  (email + SMS + WhatsApp + in-app, carrying the buyer's details and the
  one-tap handover link) is `privateArrangeSellerHandover`. Do not re-add a
  second seller email to the reveal — that duplicate shipped on 2026-11-24 and
  is exactly the clutter that buries the action button.
  ⚠️ **Keep sale/handover copy short.** The emails/in-app/SMS for a sale are
  read on a phone next to an action button; one or two short sentences, the
  action verb in bold, and the reference row. No paragraphs before the CTA.
- **Seller pickup scheduling:** on accept the seller picks a collection day
  (soonest business day, or the following business day) and an optional window
  (`08:00-11:00` / `11:00-14:00` / `14:00-17:00`). Stored on
  `Transaction.collectionNotBeforeAt` / `collectionWindow`, passed to Bob Go as
  `collection_min_date` / `collection_after` / `collection_before`. The accept
  picker takes the courier's cut-off (static `service-levels.ts`: Pargo 12:00,
  default 14:00) into account and **rejects** a day/window outside the two
  offered. The WhatsApp/SMS one-tap accept defaults to the soonest day.
- **Delivery ETA:** stated as **up to 10 business days from PAYMENT** (not
  dispatch — the seller moves the pickup date), always with "we always push for
  the quickest possible collection and delivery". `delivery-estimate.ts` (backend
  + frontend mirror; keep in sync).
- **Payout clocks are admin-only (no auto-release):** door orders surface the
  admin payout option at **delivered + 24h**; Store Pickup at **min(collected +
  24h, end of the next business day after ready-for-pickup)**. `READY_FOR_PICKUP`
  is a distinct shipping status (never out-for-delivery). The buyer's own Pargo
  collection window (8 days) is unchanged. `AdminService.releaseTransaction`
  refuses a courier payout until `adminPayoutEnabledAt` is stamped.
- **`COLLECTION`** is a real method: buyer collects in person, forced for
  collection-only categories (trailers, oversized or dangerous goods) and rejected
  for everything else. Funds stay HELD until the buyer confirms collection, and
  contact details are revealed only after payment.
- **`ON_SITE_SERVICE`** — a future-dated on-site service with no parcel.
- ⚠️ **Bob Go answers HTTP 201 before a courier has agreed.** Every booking starts
  unconfirmed (`pending-rates`). Branch on `submission`, never on "it did not
  throw". See `docs/ARCHITECTURE.md`.
- ⚠️ **The payout gate depends on a correct status map.** Exactly two carrier
  slugs reach Prisma `DELIVERED`, and `DELIVERED` starts the clock that releases
  the seller's money. Bob Go aggregates many providers, so its vocabulary is its
  own. Enumerate it from the sandbox before adding a map row — mapping "the parcel
  is on a van, buyer has not received it" to DELIVERED pays sellers for goods buyers
  never received.
- ⚠️ **Bob Go returns rand with decimals into a codebase that is integer cents
  from the quote boundary onward.** Both sides are `number`, so types will not
  catch it. One missed conversion is a 100× error on every shipping charge.

**Webhooks** are public routes, no JWT:
- **Bob Go** → `/api/shipping/webhook/bobgo/<secret>/<group>/<action>` — the topic
  AND the secret travel in the PATH, because subscriptions are registered one
  topic at a time and we choose the URL, so each self-identifies without relying
  on custom headers. Five of seven topics registered. Register with
  `PATCH /webhooks` — **not POST**, which returns 200 and silently creates nothing.

Handlers are idempotent, share `findTransactionByTrackingNumber`, map provider
status to internal `shippingStatus`, write the in-app notification row, always
return 200, and handle unknown tracking numbers gracefully. ⚠️ Absolute URLs
registered with a provider must point at **alloutdoor.co.za**.

---

## Listings, offers, auctions, moderation

- Required firearm fields per the listing schema. One seller may not post
  duplicate listings of the same item. Every listing needs real seller-supplied
  photos — no stock or watermarked images.
- **Ageing:** non-auction listings age on `Listing.lastRenewedAt` (seeded from
  `createdAt`, bumped only by an explicit renew/relist — **never** by
  `updatedAt`, which offer counters and moderation edits touch). A daily 04:00
  cron nudges at **75 days** and flips to `EXPIRED` and de-indexes at **90**, via
  `notifications.listingStale({kind})`. Auctions and deal listings are excluded.
  ⚠️ **`Listing.expiresAt` is a different field** — the 24h pay window on a won
  auction or accepted offer. Never write it at publish.
- **Cancelled-listing retention:** a `CANCELLED` listing with **no Transaction and
  no OrderLineItem** is archived after 90 days by the 04:15 sweep. Its Cloudinary
  photos/video and DB media rows are deleted, it is de-indexed, and it disappears
  from `/my/listings`; the Listing row, offers, bids, notifications and audit
  references are kept. Never hard-delete a sold/offered listing. Manual cleanup:
  `npm run listings:archive-cancelled -- --days=N [--apply]` (dry-run by default).
- **Offers:** at most **30% under** the asking price (refused outright — nothing
  stored, no attempt consumed), and **one offer per buyer per listing**. Sellers
  have an auto-accept threshold and a separate `autoDeclineThreshold` that rejects
  a recorded offer.
- **Auctions:** proxy bidding with a stored max; increments R50/100/250/500/1000;
  a bid in the final 2 minutes extends the end by 2 minutes; Buy Now only while
  there are zero bids; `reserveMet` flips when `currentBid >= reservePrice` and the
  reserve amount is never shown. eBay-style dual-row history: when a bid triggers
  an existing proxy, two `Bid` rows are written in one transaction and `bidCount`
  increments by 2. Ties go to the earlier bidder. `maxAmount` is never public.
- **Seller failure is strikes, not fines.** Three counters on `User` —
  `auctionStrikes` (3 = bidding suspended), `dispatchStrikes`, and
  `sellerRejectStrikes` (**2 = `sellingBannedAt`**: no new listings, buying
  unaffected). A reject strike is also recorded in the **`SellerStrike` ledger**
  (reason, source, reference), which is the system of record; an admin can list a
  seller's strikes and remove a single unfair one (`GET /admin/:id/strikes`,
  `POST /admin/strikes/:id/remove`), and the ban is recomputed live. The **only**
  strike-free sale-decline route is a buyer-concern, which now rides the custom
  `OTHER` reason (strikes + admin review). **There is no fine system** — no
  Penalty model, no admin approval step, no paygate deduction.
- **Seller tiers** (badge only; no listing-volume cap, no deposit, no fee
  discount): New (0 sales), Established (3+ / 50+ score), Trusted (10+ / 70+),
  Top Seller (25+ / 85+). The legacy `DEALER` tier is **retired** (never assigned,
  no longer sticky) — the platform has no dealer *sellers*; dealers survive only
  as the `DEALER_TRANSFER` handover registry. The **private Trust Score** (0–100)
  is visible only on the seller's own dashboard, never publicly.

**Moderation.** Every new listing is reviewed by the platform model before going
live: APPROVE, AUTO_FIX_AND_APPROVE (silently strips contact info; original kept),
REJECT (seller sees `publicReason`), HUMAN_REVIEW. Hard reject: live ammunition /
primers / propellant, hate speech, sexual content, no photos or stock/watermarked
photos, duplicate listing, contact info visible in photos.

⚠️ **Moderation fails OPEN for text-only listings, and that decides what reaches
the public catalogue.** Flag off or no model key → publish ACTIVE. Model call
throws on a text-only listing → publish ACTIVE. Model call throws on a listing
**with photos** → PENDING_REVIEW. `LlmError` code `safety` → PENDING_REVIEW even
with no photos. The old value-based and new-seller safety nets (R20,000 threshold,
first three firearm listings, confidence floor) were **deleted** — a R500,000
rifle does not get a human look. Three settings keys survive in the admin UI
(`claude_confidence_threshold`, `new_seller_firearm_review_count`,
`high_value_review_threshold`) that **are read by nothing**, and the
`claude_moderation_enabled` hint claims the opposite of what the code does.

⚠️ **JEV photo screening has a 32k-token `state` budget, and the base64 image is
tokenised as text** (~1 token per 9.5 chars, measured 2026-11-24). A 1568px photo
plus the six-question listing/feed battery is ~42k and is rejected with
`400 {"detail":{"error_type":"max_tokens_exceeded"}}`; 1280px is ~29.8k. Photo
screening therefore goes through `askPhotoQuestions()`
(`moderation/jev-image-battery.ts`), which **estimates the tokens before each
call** and picks the largest side from **1280 → 1152 → 1024 → 896 → 768 → 640**
that fits the 27k-token target (it only falls back further if the provider still
says over-budget). Documents keep the 1568 default. Do NOT put `toJevImage` back
to the document default for listing/feed photos: doing so silently blocks every
photo upload (the listing is created, the photo fails, and the sell form deletes
the listing). Verified live: a 1568-screened photo returned 400, the same photo
screened at 1280 returns 200 at ~29.8k input tokens.

⚠️ **Operator photo policy (2026-11-24): a picture is denied ONLY when the
moderator says it is denied.** A failed/unavailable screen (provider error, no
key, unreadable photo, exhausted token ladder) is a fail-open APPROVE — the
seller is never blocked by our moderation outage — logged loudly via
`logger.error` and the `AiUsage` failure row. The 60–80 % review band is not a
denial either: the photo approves with `photoFlags` kept for the admin. Only
block-band answers (sexual, live ammunition, or readable contact/QR/address/
advertising details) reject, and a boxed contact detail still gets the
server-side auto-mask first so a clean re-screen turns it into an approval.
`screenImage` is the per-photo seam; `screenedImageBytes` refuses ONLY a
`REJECT`.

⚠️ **A photo upload is bounded twice: bytes in, and time out.** Listing/feed/
inquiry photos are re-encoded server-side before Cloudinary
(`common/image-optimize.ts`): longest edge **1920px**, JPEG q82, alpha PNGs stay
PNG, anything sharp cannot read is passed through unchanged. On 2026-11-24 a
12 MP seller photo made Cloudinary's received/processed asset take **~106 s**,
which is longer than nginx's 95 s `/api` `proxy_read_timeout` (Cloudflare cuts
at ~100 s): the seller's publish request 504'd after 95 s and the sell form
rolled the half-built listing back, while the backend finished the upload 13 s
later and wrote an image row onto the CANCELLED listing. Therefore:
`CloudinaryService.uploadImage`/`uploadRaw` pass `options.timeout` (**25 s**
socket inactivity) and log bytes + duration; a provider timeout rejects with a
retriable **503** ("taking too long — please try again"), never a silent
request held open to the proxy timeout. `listings.service.addImage` /
`replaceImage` re-check the listing status AFTER the await and delete the
just-stored asset when the listing is already CANCELLED/EXPIRED/SOLD, so no
orphan media is written. The sell form retries a 5xx/network photo upload once
before rolling anything back. Do NOT raise `proxy_read_timeout` to hide a slow
provider — the edge limit makes it pointless; make the call fail fast instead.
Video uploads are still one long synchronous request and remain the known
follow-up for the same reason.

---

## Notifications

Four channels, one source of truth in `NotificationsService`:

1. **Email** (Resend) — every non-shipping event, every recipient. Shipping
   email is sent by Bob Go, never by AllOutdoor.
2. **SMS** (SMSPortal) — every event with a phone. Action SMSes embed
   single-use tokens with 48h expiry.
3. **In-app inbox** (`Notification` model) — drives the bell badge and
   `/notifications`.
4. **Web push** — shipped. `backend/src/push/` wraps `web-push`; browser opts in →
   `POST /push/subscribe` → `persist()` writes the inbox row and calls
   `push.sendToUser()` for **action-required events and message events**
   (`forcePush`). Message pushes are tagged by thread, so a second message
   replaces the first instead of stacking. A 410 from the
   gateway deletes the subscription row. iOS Safari 16.4+ only delivers to an
   installed PWA.

**WhatsApp** (Meta Cloud API, `backend/src/whatsapp/`) is a fifth rail, off by
default behind the `whatsapp_enabled` Setting and per-member
`notifyWhatsappEnabled`. Its scope is **sales and document notifications only**
— offers, outbids, auction wins, paid sales, payouts/refunds, private-arrange
handover and Licence Centre motivations. **Shipping is sent by Bob Go
directly**; there are no shipment/delivery templates in the registry, and a
missing or failed WhatsApp send falls back to SMS. Template bodies never carry
a listing title (Meta commerce policy / regulated goods).

**Channels default on; Settings is the only chooser.** Sign-up does **not**
interrupt the member with a communication-preferences sheet. Email, SMS and
WhatsApp start enabled (WhatsApp still behind the global `whatsapp_enabled`
switch), and the member changes any of them in `/settings`. WhatsApp is the
primary channel for sales-driving messages; when it is eligible, every sale,
offer, bid and private-arrange notice is sent there alongside the inbox row and
push. A WhatsApp that Meta has not delivered after **1 hour** gets an SMS and
email fallback; one delivered but still unread after **12 hours** gets the same
reminder. Both respect the member's channel mutes and fire once per message via
`WhatsappMessageLog.undeliveredNudgeAt` / `unreadNudgeAt`.

In an installed PWA the first-launch push card asks for notification permission
(including in the tab that just fired `appinstalled`). Browsers still require a
tap; nothing grants push automatically.

The `/account` hub now opens with an **Action required** card directly under the
identity header. It is fed by active notifications, keeps sale actions visible
even when the inbox row is dismissible, and links each row to its action. The
account menu puts **Notifications** and **Messages** in a first `Inbox` group.
Opening a sale shows the latest Meta WhatsApp status (`Sent`, `Delivered`,
`Read`, or failure) on the order page.

**Shipping comms are Bob Go's end to end.** Bob Go emails the seller the PDF
waybill at booking, then sends both parties the tracking updates (email, plus
WhatsApp with SMS fallback for buyers — the seller's only Bob Go WhatsApp event
is locker/counter drop-off, which the door-only rail never uses). AllOutdoor
writes only the in-app row, plus push for action-required events: no WhatsApp,
email or SMS for any shipment/tracking event, including booking failure and the
dispatch nudge. Firearm dealer handover and private-arrange notices remain
AllOutdoor messages.

⚠️ **Every transactional email is rendered by ONE in-code helper** —
`renderEmail()` in `notifications.service.ts`, from an `EmailContent` object
(headline, body, optional status pill, labelled rows, one CTA, footnote,
preheader) with theme tokens inlined. **There are no per-event template files.**

**Resolved-by-action, not read-on-open.** Opening the inbox or tapping an item
does **not** clear it. A notification stays, and counts toward the badge, until the
user **acts** on the underlying entity or explicitly dismisses an informational
item. `dismissible: false` rows can only be cleared by the server-side resolve
hook. Message rows are the deliberate exception on the action side: opening a
listing/transaction thread resolves that thread's `listing_inquiry_message` /
`new_message` alert, and replying resolves the sender's stale one. Badge query is
`WHERE userId=? AND resolvedAt IS NULL`.

Listing conversations live at `/messages` (buyer and seller in one inbox); the
dashboard keeps an inline copy. Message notifications and email CTAs deep-link
to `/messages?inquiry=<id>#inquiries`, which opens that thread directly.

**Public listing Q&A is distilled from those private conversations (2026-11-23).**
When the seller replies, Gemini 3.1 Flash-Lite turns the buyer's first question
and the seller's reply into one anonymised `ListingFaq` entry (names, contact
details, addresses and order numbers stripped; the Jev contact/conduct battery
and the regex floor must both pass). The entry is published on the listing's
**Questions & answers** section and **the seller cannot hide it** — `hiddenAt` is
platform moderation only. A buyer's first message is checked against up to 10
published entries first: Jev answers one duplicate question and, only on a
`BLOCK`-band hit, Gemini Flash-Lite names the entry the buyer should read. A
match opens **no** thread and sends **no** seller notification; `force: true` is
the buyer's "ask anyway" bypass. The same public endpoint returns the seller's
**“Usually replies within …”** badge, computed from the median time to the
seller's first reply over the last 90 days (minimum 3 samples; otherwise
“reply time not yet known”).

API: `persist(...)`, `persistByEmail(email, ...)`, and
`resolveByEntity(linkedType, linkedId, {userId?, resolvedBy?})`, called from action
handlers across the codebase. Feed endpoints are session-guarded and throttled
120/min/user (the badge polls every 60s across tabs).

---

## UI — the white theme

The canonical token source is **`frontend/app/globals.css`**, which carries the
rationale inline. The old dark theme and the "Claude Design handoff mockup" are
both retired.

- **Surfaces:** `--bg` **#FFFFFF**, deep #FFFFFF, card #FFFFFF, card hover
  #FAF9F5, inset #F4F2EC. The page canvas is white (operator, 2026-08-27: "white
  back ground only on the whole website"). The page ground is `--bg` and has no
  other name.
- **Text:** `--text-primary` #1A1613 (16.4:1), `--text-secondary` #4A443C (9.0:1),
  `--text-tertiary` #7A7267 (4.5:1), `--text-faint` #9C948A (3.0:1 — large text
  and disabled states only, never body copy).
- **Brand red `--red` #E30613** (hover #C7050F) — prices, primary CTAs, active
  states, live badges. ⚠️ **The logo road now carries the SAME value**, #E30613 —
  it was #E01B24 until the brand pack landed on 2026-09-23 (`globals.css`, where
  the two were previously inconsistent). Never recolour a logo path to
  `var(--red)`: the shared value is a coincidence of the pack, not a licence to
  wire the mark to the token.
- Borders 0.5px; radii: xs 6px, sm 10px, md 14px, lg 20px, xl 28px, pill 999px; League Spartan (display) + Montserrat (body), self-hosted; weights 400 and 500
  only; mobile-first ~390px; content max-width 1280px.
- **Tiles opt into depth** via `.gg-tile` (+ `.gg-tile-lift` on hover), using
  `--elev-1`/`--elev-2`, which are warm-tinted from the ink because `rgba(0,0,0,…)`
  goes visibly grey over these neutrals.

### CSS traps that fail SILENTLY — every one has already produced dead code

- ⚠️ **`* { box-shadow: none !important }` sits at the top of `globals.css`.** It
  is unscoped, so **every** `box-shadow` anywhere — inline styles and keyframes
  included — is dead unless the element carries `.gg-tile`. **Do not delete the
  kill switch:** thirty `box-shadow` declarations are already written by people who
  knew none could render, including a `rgba(0,0,0,0.55)` drop sized for the retired
  dark theme and a keyframe that throbs a red glow. Removing the line switches all
  of them on at once, on a white site.
- ⚠️ `.gg-tile` declares its own `transition`, and `globals.css` loads after
  `@tailwind utilities`, so it **beats** a `transition-colors` utility on the same
  element. A card gaining `.gg-tile` must have `transition-colors` removed or its
  hover tint silently stops animating.
- ⚠️ **An undefined `var()` with no fallback kills the WHOLE declaration** at
  computed-value time, so the property takes its INITIAL value: `background` →
  transparent, `border-radius` → 0, `border-color` → currentColor, and one bad
  stop drops an entire gradient. A `var()` **with** a fallback is fine.
- ⚠️ **You cannot alpha-dilute a custom property by concatenation.** `var(--red)`
  + `18` expands to two tokens, not one 8-digit colour, and dies the same way. Use
  `--red-wash` / `--red-line` / `--gold-wash`, or
  `color-mix(in srgb, var(--x) N%, transparent)`.
- ⚠️ **The page ground lives on `<html>`, and `<body>` must stay transparent.**
  `html`'s background propagates to the canvas and is painted before everything
  including negative-z-index layers; `body`'s does not propagate once `html` has
  one, and paints as an ordinary in-flow block *above* them.
- ⚠️ A `body:has(...)` rule scores only (0,1,1) and loses to
  `html:not([data-standalone='true']) body`, which is (0,1,2). Source order does
  not help. Prefix to reach (0,2,2). Symptom: a page that will not scroll its last
  inch, with nothing logged anywhere.

### The theme-sync build gate

⚠️ **One colour is named in three files** — `--bg` in `globals.css`,
`background_color` + `theme_color` in `app/manifest.ts`, and `viewport.themeColor`
in `app/layout.tsx`. They drifted twice. `frontend/scripts/theme-sync.cjs` runs in
`npm run build` and **fails the build** when they disagree. It is not advisory.
The Desk is deliberately exempt.

### Logos

Pack-aligned horizontal/emblem SVGs live at public/brand/: four files. **The app renders the `-dark` variants
everywhere**, because on a white page the ink must be dark: `logo-nav-dark.svg`
(the wordmark lockup, #111111 ink plus the #E30613 road) and `logo-mark-dark.svg`
(the AO monogram — an A whose counter is a snow-capped peak, an O, and a red road
running out of it). The white-ink `logo.svg` / `logo-nav.svg` / `logo-mark.svg`
are for dark grounds only.

- On centred pages: Horizontal logo for headers; emblem below 380px viewport.
- ⚠️ A transparent favicon is invisible on a tab strip the colour of its own ink.
  `app/icon.svg` is theme-aware and preferred.
- Regenerate the PNG icon set together or the install prompt and the tab icon
  disagree.
- `app/manifest.ts` has **no screenshots**; the three that were there were live
  captures of a retired hero. Recapture SIGNED OUT before re-adding.
- Keep any replacement free of weapon imagery — the logo is the one asset that
  appears everywhere, including where the auth wall does not reach.

---

## PWA and the mobile shell

**Serwist** (not Workbox/next-pwa). `app/sw.ts` compiles to `public/sw.js` at build
time. SW is disabled in dev.

- **Caching is no longer conservative, and order is load-bearing** —
  `[...networkOnlyRoutes, ...imageCaching, ...defaultCache]`, first match wins.
  Network-only comes first so admin, API and auth can never be intercepted; then
  images, stale-while-revalidate because their URLs are immutable; then
  `defaultCache`. **`/api/*` is network-only permanently** — that is a decision,
  not a gap.
- ⚠️ **`skipWaiting: false, clientsClaim: false` ON PURPOSE — do not flip them
  back.** A new SW waits; the old one keeps serving the open session from intact
  caches; `sw-update-banner.tsx` detects the waiting worker and posts
  `SKIP_WAITING` only when the user taps Reload. Setting them true seizes a live
  session mid-flow.
- Offline fallback at `/offline`, precached.
- **Remote kill switch:** `NEXT_PUBLIC_DISABLE_PWA=true` in
  `frontend/.env.production` on the box, **then a rebuild** (the generation half is
  build-time), then `pm2 reload alloutdoor-frontend --update-env`.
  `<SwKillSwitch />` unregisters existing workers and deletes caches on the user's
  next visit.
- **The mobile shell** is `components/shell/app-shell.tsx`, mounted in
  `app/layout.tsx`: `ShellHeader` (two archetypes — ROOT with wordmark, wishlist,
  cart and avatar; PUSH with a back chevron and title) plus `BottomTabBar`.
  Tabs: **Shop / Saved / Sell / Alerts / Account**, Sell the raised centre FAB.
  ⚠️ **It is a route ALLOWLIST, not a display-mode check** — `isTabRoute()` in
  `lib/shell-routes.ts`.
- Standalone detection: `lib/use-standalone.ts` plus a pre-paint script that sets
  `<html data-standalone="true">` before the first frame, so server HTML matches
  for both audiences with no flash. The same script locks pinch-zoom in standalone
  only; browser users keep zoom for accessibility.
- iOS splash images are wired via `apple-touch-startup-image`.
- **Push onboarding:** `PushFirstLaunchPrompt` asks on the first installed-PWA
  visit, and now also when `appinstalled` fires in the tab that installed it.
  The prompt still requires a user tap; browsers do not grant notification
  permission automatically. See `lib/use-push.ts` and `/settings`.
- **Passive geolocation must never prompt.** `ListingDistance` mounts on every
  listing page, so it uses `lib/geolocation.ts` `getGrantedPosition()`: read
  `navigator.permissions.query({ name: 'geolocation' })` and call
  `getCurrentPosition` only when the state is already `granted`. A still-
  `prompt` or `denied` permission falls through to the saved address (or no
  distance line). Explicit "Use my current location" buttons may prompt,
  because they are user gestures. The browser owns the remember-this-choice
  behavior; the site cannot make permission permanent itself.
- `middleware.ts` keeps `/offline` and `/sw.js` public so the auth gate does not
  rewrite them; `tsconfig.json` includes the `webworker` lib.

---

## The Desk (`/admin`)

**The Desk is the admin.** It replaced a 32-page legacy panel with five surfaces —
Desk (the pile), Ledger, People, Pulse, Site — as tabs on desktop and bottom tabs
on a phone. `/admin` is a **redirect** to `/admin/desk`.

⚠️ **THE CUTOVER WAS FRONTEND-ONLY. `backend/src/admin/` is NOT legacy — it is the
Desk's own API.** Deleting it, or "finishing the cutover" by removing it, breaks
every Desk surface. What was deleted is the admin *frontend*:
`frontend/app/admin/(protected)`, `frontend/components/admin`,
`frontend/lib/admin-auth.ts`.

**Three admin roles**, not two: `SUPERADMIN` ("Full admin" — the only tier that
may write), `MONITORING_ADMIN` (read-only), and `ADMIN` (the legacy column default,
treated as read-only).

⚠️ **`AdminJwtGuard` is authentication AND authorization in one guard, on
purpose** — it is the only way a route authenticates as an admin, so coverage is
structural: a controller added later inherits the check by the act of
authenticating. `GET`/`HEAD`/`OPTIONS` are open to any active admin; **every other
method is SUPERADMIN-only**. `SuperadminGuard` is applied to exactly three routes
(create admin, change role, deactivate admin).

⚠️ **The CSV exports are open to any active admin, read-only ones included.** If
that is wrong, gate the route — do not leave a claim of a control that is not
there.

⚠️ **`/admin(.*)` is a PUBLIC route in `middleware.ts` on purpose** — the admin
runs its own JWT, separate from the member one — so nothing upstream turns a
signed-out visitor away.
The session gate lives in the layout, not the pages. It shipped once with
`requireDeskToken()` exported and called by nobody: a stranger got the operator's
chrome, the board names and a screenful of 401s.

**The Desk has its own theme**, deliberately unlike the white shop so the operator
can never mistake one for the other. It is gated by `html:has([data-desk])`;
nothing in `components/desk/tokens.css` may leak to `:root`. It overrides
`themeColor` and has its own PWA icons and **its own manifest** — the shop
manifest declares `id`/`start_url`/`scope` all `/`, so "Add to Home Screen" from
the Desk used to install the *shop*. **The Desk's palette rule: colour is only ever
state.**

**Build gates that fail the build** (there is no CI, so `next build` is the only
real gate and these stand in front of it):
`npm run build` = `desk-guard && desk-cutover && theme-sync && next build`.
- `frontend/scripts/desk-guard.cjs` — the deleted legacy admin paths must stay
  deleted, plus its other rules.
- `frontend/scripts/desk-cutover.cjs` — reads `frontend/lib/desk-cutover.ts`, the
  cutover map of 29 legacy routes each marked replaced / retired / partial / none.

**Warden** is a standalone Node daemon at `warden/`, running under pm2 as the
**third service**, deployed by `deploy.sh` (which skips it gracefully on a box
without it). It is **not** part of the Nest backend and imports nothing from it. It
measures the box on a 60s loop — disk, TLS, nginx, pm2, database, backups, env
presence, cron freshness — and surfaces proposals the operator approves or
declines. `backend/src/desk/warden.*` is only a **proxy**; the daemon is the thing.
Env: `WARDEN_TOKEN`, `WARDEN_BASE_URL`. It fails closed on a missing or short
token by exiting at boot, so "still online a few seconds after reload" is a real
check.

---

## The licence stack

Three surfaces that share a vault: the **Document Centre** (member-facing at
`/documents`), the **review sheet** (`/licence-centre/[id]`), and the
**scanner**.

⚠️ **THE TWO OLD MOTIVATION WIZARDS ARE GONE** — `/motivations` and
`/licence-services` were deleted on 2026-09-08 (Motivation Centre rebuild,
Phase 4), along with `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED` and
`canOpenPackScreen()`. Both paths **301 to the new surface** (see
`frontend/next.config.mjs`) because members carry them in bookmarks and in
links we sent. The surface is now:

| Route | What it is |
|---|---|
| `/licence-centre` and `/documents` | the **Document Centre** — two doors, one page, unchanged |
| `/licence-centre/applications` | the applications list |
| `/licence-centre/[id]` | the review sheet |
| `/licence-centre/[id]/pack` | the pack |

⚠️ **`/licence-centre` IS THE DOCUMENT CENTRE, NOT THE APPLICATIONS LIST**, and
that is why the list took a child path. `notification-module.ts` deep-links
every `licence_centre_*` reminder to the index; taking it would have sent every
licence-expiry reminder to a list of applications.

⚠️ **The member-facing route is `/documents`, but the backend prefix is still
`licence-centre`** (`@Controller('licence-centre')`). The rename left that split
behind; both names are live and mean the same thing.

### The six licence types

`MotivationLicenceType` is the spine — every registry section, document tier,
checklist and PDF branch keys off it:

| Value | What it is |
|---|---|
| `S13_SELF_DEFENCE` | self-defence: a handgun, or a shotgun that is neither fully nor semi-automatic |
| `S14_RESTRICTED_SELF_DEFENCE` | self-defence with a RESTRICTED firearm — a semi-automatic rifle or shotgun. Added 2026-09-09; before it the product had a dead end, because `sectionAllows` refuses a semi-auto under s13 and names s14 as the way forward. One at a time, two-year licence, and the only section whose own words say "motivate". |
| `S15_OCCASIONAL_HUNTER` | occasional hunter **or occasional sports shooter** |
| `S16_DEDICATED_HUNTER` | dedicated hunter, accredited hunting association |
| `S16_DEDICATED_SPORT` | dedicated sports shooter, accredited sport-shooting body |
| `S24_RENEWAL` | renewal of a licence already held |

⚠️ **A section 24 renewal is lodged on the SAPS 518(a), not a SAPS 271.** This
product does not fill in the 518(a); an S24 pack ships the motivation alone and
says so.

### Two products, and the generated form is gone

The **generated SAPS 271 was retired on 2026-11-05.** What the product sells is
the motivation, in two shapes:

| Mode | What the member gets | Documents |
|---|---|---|
| `MOTIVATION_ONLY` (**default**) | the motivation document | none — never asked for any |
| `PRINT_READY` | the motivation, every annexure lettered in DFO order, and the document checks | required; the pack is gated until they are attached |

`FULL_PACK` is the retired name for `PRINT_READY`; `normaliseOutputMode` still
maps it so old rows keep their annexures. A new application defaults to
motivation-only and is offered print-ready as an upgrade.

### The paygate — R295, paid before the document is written

Operator, 2026-11-20: "On the motivations. I want to paygate it." The member
builds the application for free and pays when they press **Write my
motivation**; nothing is generated before Yoco confirms the capture.

Operator, 2026-11-22: "We are removing it completely from zoho and moving over
to yoco api … no more peach and ozow, just yoco for motivation payments." The
rail is Yoco Checkout, the Zoho Books invoice is gone, and `PaymentProvider.YOCO`
exists for this one product only — the shop still runs Ozow + Peach.

- **Price** — `motivation_price_cents`, default `29500` (R295), flat for every
  member and both output modes. The August R199/R99/AO-Pro table was never
  wired, had no voucher system behind it, and is deleted —
  `motivation-pricing.ts` now holds one number.
- **The switch** — `motivation_paid_enabled`, OFF by default. OFF runs the free
  beta exactly as before; ON requires a payment and stops a beta seat being
  claimed for a paid document. Turning it off is the emergency brake for new
  applications; documents already paid for keep their record.
- **The gate** — `MotivationPaymentsService.assertPaidForGeneration`, called by
  `startGeneration` **before** `prepareGeneration` (which tops up answers from
  the vault and claims the row `GENERATING`). An unpaid attempt answers
  `409 { code: 'motivation-payment-required' }` and costs no model call.
- **The money record** — `MotivationPayment`, one row per checkout attempt,
  plus `Motivation.billedCents` / `paidAt` as the gate's fast answer. Both
  foreign keys are nullable with `ON DELETE SET NULL`: the nightly retention
  purge and a POPIA erasure delete the motivation, and the sale has to outlive
  it. One payment per application — `billedCents` is only ever written from 0,
  so a regeneration can neither re-price nor re-charge.
- **Confirmation** — two paths, one authority. The signed Yoco webhook
  (`/api/payments/webhook/yoco`) is the fast path; the return-to-site
  `POST /motivations/:id/payment/verify` and `reconcilePendingPayments`
  (every 10 minutes) both ask Yoco for the checkout status. ⚠️ The webhook body
  is never trusted: it only locates the attempt, and the amount/reference are
  bound from the API answer. A mismatch applies nothing and raises an urgent
  `AdminAlert`; a test-mode capture in production is refused with
  `MOTIVATION_PAYMENT_TEST_MODE`. A second capture raises
  `MOTIVATION_DOUBLE_PAYMENT`.
- **Money out** — refunds are manual in the Yoco dashboard (keyed on the
  checkout id), then the row.
  `MOTIVATION_PAID_GENERATION_FAILED` tells the desk when a paid document did
  not write; the member's retry is free.
- **Print and Deliver** — the member's second choice after the product:
  Print / Download (PDF, no extra) or Print and Deliver (+R75 + live Bob Go
  courier). Both are inside the **same Yoco transaction** as the R295; the
  payment row carries the split, and `billedCents` stays the base price. The PDF
  is emailed to the print desk when generation completes, and the Desk's
  "Print & delivery" card — or the one-click **Book Bob Go collection** link in
  that email — books the collection from 36 Sterappel Crescent after a human has
  printed it. The digital document remains downloadable regardless of print
  status. `MOTIVATION_PRINT_PHONE` is required for booking.
- **Books — RETIRED (2026-11-22)** — no motivation invoice is raised. The
  `MotivationPayment` row is the turnover record, and the `zoho*` columns stay
  NULL on every new row (kept, not dropped, so historical ids survive). Nothing
  in the app reads the motivation Zoho fields any more.
- **Tax** — not VAT registered (`TURNOVER_TAX`), so the invoice carries no tax
  line and no VAT number. The payment row is the turnover record, and it
  survives erasure precisely so the year can be filed.
- **The screen** — `/licence-centre/[id]/pack`. The footer's red button reads
  "Pay R 295 and write my motivation" until the sheet says it is paid, then
  "Write my motivation". The declaration is stored before the redirect, and
  `?payment=return` verifies (three checks, five seconds apart) before
  auto-writing the document once.

### The beta notice and the support timeline

Operator, 2026-11-21: a beta popup at the start, a log of every move, the
member's handle on every bug report, and an automatic ticket when a document
fails.

- **Beta notice** — `components/licence-centre/beta-notice.tsx`, rendered on the
  intake and review-sheet pages. Once per application (localStorage keyed by the
  motivation id), one "Got it" button, and it points at the Report a bug button
  in the bottom-right (bottom bar on mobile) and says the report carries their
  username and steps.
- **`MotivationActivity`** — one row per meaningful move: `created`,
  `answer_saved` (field KEYS only), `declaration_accepted`, `document_added`,
  `generation_requested/started/completed/held/failed`, `payment_started/
  required/confirmed`, `pdf_downloaded`-class client events, `bug_reported`,
  `abandoned`, `erased`. Both foreign keys are `SetNull`, so the trail outlives
  the application and the account (the MO reference is snapshotted).
- **No answer values, ever.** `MotivationActivityService.sanitiseActivityDetail`
  accepts only short strings, finite numbers, booleans and arrays of strings,
  caps keys/strings/arrays, and DROPS objects — the table is read by admins and
  has no encryption.
- **Client events** — `POST /motivations/:id/activity`, ownership-checked and
  allowlisted (`CLIENT_ACTIVITY_ACTIONS`), path must start `/licence-centre`.
  The browser reports page views, the Pay press, the bank return, download and
  view. Fire-and-forget: a failed beacon is never an error on the page.
- **Bug reports carry the handle** — `BugsService` adds `@username`, sign-in
  email, the motivation reference (parsed from the reported URL), and the last
  ~60 activity lines to the operator email, plus a link to
  `/admin/operate/motivations?ref=…`. The form shows "Reporting as @name" and
  defaults the category to Motivations on a licence-centre page.
- **Automatic failure ticket** — a generation crash, a mechanical rejection or
  gate exhaustion writes an `AdminAlert` and emails SUPPORT with the error, the
  handle and the activity tail
  (`NotificationsService.motivationFailureTicket`). ⚠️ **THE MEMBER IS TOLD
  NOTHING** — see "Silent rebuild" below. `motivationFinished` has no `failed`
  outcome at all, so no caller can send failure wording.
- **Silent rebuild** — a failed run is requeued, not reported:
  `Motivation.generationFailures` counts the attempts and
  `generationRetryAt` schedules the next one at +5, +15, +45, +120 and +360
  minutes. `retryDueGenerations` (every 5 minutes) claims by clearing the date
  and runs at most five detached rebuilds per tick. When the delays are spent
  the field is null and the open ticket is the queue;
  `POST /admin/motivations/:id/retry` (the "Re-queue" button on the timeline
  page) sets it back to now, and the cron picks it up within five minutes. The
  row stays in `NEEDS_MORE_INFO` throughout, the pack screen renders it as
  "being written", and only a passing rebuild sends the ready notification.
- **Support lookup** — `GET /admin/motivations/activity?username=|ref=|motivationId=`
  and `/admin/operate/motivations`, which takes an `@handle`, an MO reference or
  an id. A deleted application still answers from `forReference`.

⚠️ **Nothing asks the form-only questions any more.** The thirty-eight
`formOnly` registry fields and the six `history_*` declarations are never put to
the applicant — declarations surface only when an uploaded document raises one,
so heading 10 appears when a paper produces it, not because somebody was asked
six yes/no boxes. `requiredKeys`/`missingRequired` follow the same rule: a
question the screen cannot show can never block a pack.

### The interview is research-first, one card at a time

`planGroup()` in `intake-planner.ts` returns the first topic in `TOPIC_ORDER`
that still has pending questions, at most six per card. The page renders **all
of them on one card** and posts them as one batch, so six facts cost one round
trip instead of six. `POST /motivations/:id/intake/answers` validates the whole
card before writing anything, writes once, settles any skips, and rebuilds the
state once.

⚠️ **THE RESEARCH BRIEF DECIDES THE QUESTIONS.** `MotivationIntakeBriefService`
builds a per-application brief once per fact-hash (licence type, firearm,
purpose, association, discipline, province) and stores it encrypted in
`Motivation.intakeBrief*`. It joins the shared research (cartridge, quarry,
discipline rules) and the gate's own gaps into an ordered question list with a
reason for each and tappable answers. It is **advisory**: the planner always
appends every required or detail-gated field the brief did not mention, so a
failed brief costs polish, never a complete application. `INTERVIEW_BRIEF=off`
(env + reload) restores label-only questions and catalogue chips.

⚠️ **ONE MODEL CALL PER APPLICATION, ZERO PER CARD.** The brief words every
askable field once, in one call, in the background — the first card is served
immediately and enriched on the next turn. `phrasedCard()` only calls the model
for an open question the brief did not cover; a card of closed choices makes no
call at all. Wording is cached in process for ten minutes, so a refresh is free.

⚠️ **THE BRIEF NEVER CARRIES A SENSITIVE VALUE.** `briefFacts()` projects only
firearm type/action/make/model/calibre, purpose, association, discipline,
quarry, residence type and province — never a name, ID number, address, serial,
spouse or declaration answer. The validator drops any question, chip or fact
that echoes a sensitive value, and chips that argue or predict ("therefore",
"will be granted") are refused. A chip is a proposal the member taps; nothing
is written without them.

⚠️ **CHIPS ARE RANKED, NOT GENERIC.** `interview-chips.ts` finally reads the
cards' `rankBy`: the precinct card leads when we hold a station, the cash/stock
card leads for the trades that carry it, the calibre's supported uses lead for
the cartridge, and the association's own exercises lead for the discipline. The
brief's researched chips come first, the catalogue second, the old static
suggestions last. `rankCardOptions` only reorders; it never hides a viable
answer.

⚠️ **CASE QUESTIONS ARE OFFERED ONCE, AND CAN BE SKIPPED.** `CASE_KEYS` in
`intake-strategies.ts` (the premises block, the routine and carry method, the
hunting ground, the sport formats, a renewal's continued use) are optional in
the registry but asked once because the document is thin without them. Skip
records `SKIPPED` provenance (`common/answer-provenance.ts`), which is not a
value: the planner stops asking and the sheet still lets them fill it later.
A skip travels with the card in the same batch, so it is one request.

⚠️ **ACKNOWLEDGEMENTS ARE DETERMINISTIC.** `composeAcknowledgement()` echoes the
member's own closed answer ("Got it — Walled.") and says "Noted." for a long,
card or sensitive one. The model no longer writes one: a live member was once
thanked for a hunting tradition they had never mentioned.

⚠️ **THE GATE ASKS ONLY WHAT A CARD CAN SHOW.** `firearm_use_kind` is demanded
only on the sporting sections (the registry retired it as a question for the
others); `safe_type`/`safe_mounted`/`safe_key_holder` only when
`safe_present = Yes`; `safe_mounted_to` only when `safe_mounted = Yes`. The
detail gate names the security paragraph (`premises_enclosure`) on S13/S14 and
`continued_use` on S24. Every gap has a question in the walk — asserted by a
property test in `intake-planner.spec.ts`.

Everything the motivation still argues with stays: identity, the firearm,
competency, association, safe storage, the premises block and the purpose
sections.

### The motivation itself — a FIXED skeleton, not a varied one

`docs/MOTIVATION-GUIDE-BOOK.md` is the legal manual the whole pipeline is built
against (operator, 2026-09-09: apply all of it "apart from the estate"). Where
it disagrees with an earlier decision, it wins.

⚠️ **`motivation-structure.ts` DOES THE OPPOSITE OF WHAT ITS NAME SUGGESTS IT
MIGHT.** It used to randomise headings, openings and cadence from a stored seed
so a reviewer would not recognise our documents. Book failure mode 9 records the
result: a document that read as stitched together. A DFO does not compare
applicants' letters for plagiarism — they compare the facts to the annexures,
and one consistent spine makes that faster.

**Sixteen numbered headings, the same ones every time.** The generated SAPS 271
was retired on 2026-11-05, so the numbers no longer mirror that form; they are
our own spine now, and the four sections the professional motivations we
analysed carry were added to it:

1. Introduction · 2. My circumstances · 3. My history with firearms ·
4. The purpose (self-defence / hunting / sport / continued use) · 5. What I
already do and where it stops · 6. The firearm applied for · 7. Why this firearm
and not the alternatives · 8. Firearms already licensed to me · 9. My competency
and training · 10. Association membership and dedicated status · 11. The
association's rules for this exercise · 12. Safe storage and transport ·
13. My record · 14. Section N applied · 15. Administrative justice ·
16. Declaration and request.

- ⚠️ **The numbers do NOT re-sequence when a section is omitted.** A section 15
  with nothing held, nothing to declare and no rulebook runs 1, 3, 4, 6, 7, 9,
  12, 14, 15, 16. The absent numbers say which headings this application never
  needed.
- Headings **2 and 5** are self-defence only. **8, 10, 11 and 13** turn on the
  applicant's own answers, read by pure helpers in `motivation-fields.ts`.
- ⚠️ **Heading 11 is appended, never written.** The writer produces one lead-in
  sentence; `appendRulebook()` in `motivation-rulebook.ts` puts the association's
  published exercise rules underneath it, verbatim, with the source line. The
  library is `association-rules.ts` + `associations/association-rules.json`
  (NHSA 61 exercises, FOSA 11), and the raw captures live in the gitignored
  `backend/data/association-rules/` the way the C.I.P. sheets do.
- ⚠️ **THE DISTANCES IN THE DOCUMENT ARE THE RULEBOOK'S.** `discipline-ranges.ts`
  parses the chosen exercise's published text (NHSA's "SHOOTING DISTANCE: …
  10 metres", FOSA's "Distance: 10m", Bisley bands and yards) into a spec. That
  spec does three things: it filters the generated sport uses before the prompt
  (`filterSportUsesForDiscipline` — a 20 m handgun applicant is never offered
  "F-Class prone at 600 m"), it renders a `<discipline-ranges>` block the writer
  may not exceed, and `packConsistency()` flags any course-of-fire distance
  outside it. A numbered dimension ("300m (w) × 300mm") is stripped before
  parsing, because that typo is a target size, not a range. No spec (no
  association, an unlisted exercise, or "Distance: Various") means the writer is
  told to describe the discipline **without** a distance rather than reach for
  the cartridge's effective range.
- Heading **15** is the same paragraph in every document: a request for a lawful,
  fair decision with reasons under the Promotion of Administrative Justice Act.

- **No trailing colon.** The PDF tells a heading from a paragraph by its NUMBER;
  the colon test is kept only for documents written before the change.
- The plan is a pure function of (type, options). **`StructurePlan.seed` is an
  identifier, not an input** — so a regeneration is a second attempt at the same
  plan, and sameness stopped being a reason to regenerate. It is measured and
  raises `motivation-sameness-high`, because a high score now means the PROSE is
  repeating rather than the shape.

⚠️ **A DATE REACHES THE WRITER AS WORDS, NEVER AS ISO.** `renderFacts` runs
every `kind: 'date'` answer through `spelledDate` — "2027-06-30" goes in as
"30 June 2027". **A wrong digit inside an ISO date is still a well-formed
date**, which is what makes it a wrong FACT in a signed document rather than a
typo somebody spots: MO000075 was refused three times for `2030-06-30` against
a supplied `2027-06-30` and `2004-06-07` against `2024-06-07`. Neither the
three attempts nor the repair pass can help — the repair pass refuses a CLAIM
on purpose, because mending one means choosing which fact was meant. Nothing
downstream loses the digits: `packConsistency` reads document and answers
through one `datesIn` that parses both, and the document checks read the
answers rather than the scanned page.

⚠️ **A RESEARCH ASK REACHES A MOTIVATION THAT ALREADY HAS RESEARCH.**
`RESEARCH_ASK_VERSION` lives in the SHARED cache key, so rewording an ask used
to reach everybody who had not been researched yet and nobody who had —
`Motivation.researchAskVersion` closes that, and a row behind the current
version re-gathers on the next generation. Bump the version whenever an ask
changes in a way that should change the answer.

⚠️ **EVERY LICENSED FIREARM IN THE VAULT FILLS THE FORM AUTOMATICALLY**, before
`missingRequired`, so one supplied only by the vault counts towards a complete
application. It can never overwrite an answer: `credentialOffer` is given the
current answers and skips every key they carry. Owned-firearm rows only — the
same offer can fill competency and association boxes, and those have their own
timing rules. This is a statutory matter, not a convenience: section 15(3) caps
an occasional sports shooter at four firearms and section 13 caps a
self-defence applicant at one.

⚠️ **PAGE BREAKS OBEY TWO OPERATOR RULES THAT PULL AGAINST EACH OTHER.** "The
paragraph overflowed into the next page, I don't like that" and "keep the pages
full, minimum of 70%". `breakBeforeParagraph` holds both: a paragraph that does
not fit moves whole only once the page is at least `MIN_PAGE_FILL` used, and
never at all if it is taller than a whole page. Either rule alone makes the
document worse — change one and read the other.

⚠️ **THE DECLARATION IS PLACED BY MEASURE, NOT BY A BLANKET BREAK**
(operator, 2026-10-15: "address the almost completely empty pages"). It opens
its own page only when the whole close — heading, its paragraphs, the signature
block and the disclaimer — will not fit what is left of the current sheet; when
it fits, it fills the sheet. MO000096 had left page 9 holding a single orphan
paragraph because the old rule broke unconditionally. `DECLARATION_TAIL_H`
reserves the signature and disclaimer guards; `declarationParagraphsHeight`
measures the section's remaining blocks.

⚠️ **THE PRIOR-NOTICE LETTER FITS ONE SHEET BY SPACING, NEVER BY CUTTING
WORDS.** Its blocks are measured at four decreasing leading/gap settings and the
first that fits the sheet is taken; the copy is a fixed legal document and a
layout pass does not get to trim it. The first candidate is today's spacing, so
a letter that already fits keeps it. MO000096's spilled its last paragraph and
the signature onto a near-empty second sheet.

⚠️ **NO SERVICE NAME ANYWHERE IN A LODGED PACK** — book Part 1 rule 2. No
"prepared by", no footer brand, no "we"; the applicant signs it as their own
letter. This reverses the operator's 2026-08-24 instruction to put the logo and
"Prepared by All Outdoor" in every footer, and the reversal is theirs to undo if
they want it back. The footer carries the applicant's full names, ID number, the
motivation line, "Page n of N" and an `INITIAL: ____` rule. **Our MO reference is
off the cover and the footer too** (Part 7.2 ends "Nothing else") and prints once
on the take-with-you sheet, which is torn off before the counter.

⚠️ **An annexure is a copy of a document the applicant HOLDS, and nothing else.**
Operator, 2026-09-09: "only paperwork required by the dfo are attached as
annexures." The cartridge drawing, the precinct figures and the press cuttings
are part of the body's own flow, under the argument they are evidence for.

⚠️ **TWO EXCEPTIONS THE OPERATOR MARKED ON A RENDERED PACK, 2026-09-10.**
- **The previous owner's consent IS an annexure** ("Annexure" written across
  it). It is a third party's signed statement about a firearm. It is lettered
  through `GeneratedAnnexureId` and printed LAST, which is a placement decision
  rather than an ordering one: every other annexure is an uploaded image laid
  out by `planAnnexurePages`, and this is a page we render.
  Last in both is the only arrangement where the index and the pages cannot
  disagree.

  ⚠️ **THE PLANNER PACKS AT FULL WIDTH, EXCEPT LICENCE CARDS AT THREE A
  SHEET.** Ordinary copies take the content width and as many fit a page
  (an A4 scan takes a page to itself; two licence-height cards share one).
  A run that is entirely licence-card copies — and has at least three — asks
  the planner for `perPage: 3` and the cards shrink uniformly to fit (operator,
  2026-10-15: "we can fit 3 licenses per page"). Five cards then pack 3 + 2
  across two sheets instead of 2 + 2 + 1 across three, so the annexure loses
  its near-empty tail. Keyed off the upload kind (`CURRENT_LICENCE`), never the
  label; safe photographs (2x2) and evidence `solo` copies are unchanged.
- **`SELLER_LICENCE` is NOT an annexure** ("Remove", twice). The consent page
  already prints the front and the back of that same card above the signature.
  The upload is not deleted, only unlettered.

### The cartridge feature page

⚠️ **THE PAGE IS ALWAYS A PAGE OF ITS OWN** (operator, 2026-10-15: "On the
cartridge, I want it to have it's own page … It must be a full page"). It used
to claim a sheet only when the research had produced an article; a pack whose
research failed dropped the drawing into the tail of the firearm section and
left a bare third of a sheet. The feature now breaks to its own page whether or
not the research arrived, and the close of the firearms section never shares it.

⚠️ **IT IS A BULLET ARTICLE AROUND A TOP-RIGHT FIGURE** (operator, 2026-10-16,
with a sketch: "fill the cartridge page ... all the advantages in bullete style
... in a articale style as the illustration"). The figure sits at the top of the
right column; the bullet list fills the LEFT column top to bottom, then
continues at the top of the right column, under the figure, down to the foot of
the sheet. Each bullet is its own block, so the list breaks between columns.

| slot | size |
|---|---|
| picture (C.I.P. sheet, else our drawing) | right column width; 88 × 119 mm as the sheet, ~88 × 49 mm as the drawing |
| STANDARD DIMENSIONS block | right column, under the picture; the held figures only |
| bullets | left column full height, then the right column below the picture/figures |

⚠️ **THE DIMENSIONS BLOCK WAS REMOVED, THEN PUT BACK (2026-10-16).** It was
taken out when the page became a bullet article, and the page then came out two
thirds blank on a pack that had no research article — the operator's "not happy
with that". It is back under the picture: the held figures are the one thing we
always have, research or no research, and they come off the same `completeDims`
set the drawing cuts, through `cartridgeDimRows`, so the block and the callouts
cannot disagree. A derived letter is omitted from both.

⚠️ **THE BULLETS ARE JUSTIFIED** like the rest of the document, with a `•`
marker in a hanging indent so a wrapped bullet aligns under its own text. A
`**Heading**` line is still a subheading; a `- `, `•` or `*` line is a bullet
(`isBulletLine`).

⚠️ **THE RESEARCH ASK IS SIZED TO THE SLOT.** 0.899 mm per word, plus a
per-bullet gap; the two columns hold roughly 400 words, and the calibre ask asks
for **350–400 words across 12–16 bullets** (operator, 2026-10-16: "more words
more facts"), one reason per bullet why THIS round suits THIS application.
**Measured:** 400 words / 16 bullets render on one sheet, 450 spill to a second,
so 350–400 is the safe band. Change the slot and the ask has to move with it.
When there is no article the list carries ten stand-in bullets derived from the
held figures (standardisation, interchangeability, availability), never invented
performance copy. The ask demands `- ` at the start of each bullet.

⚠️ **LEGACY NON-BULLET ARTICLES STILL RENDER.** Research cached before the
bullet ask may return headings two ways — `**Origin**` on its own line, and
`Origin: …` run in. The run-in form is split into a heading and its sentence, so
it does not become one atomic group that fills a single column.

⚠️ **THE C.I.P. SHEET IS REPRODUCED BY OPERATOR DECISION.** The sheet carries
"Reproduction forbidden as well as in the form of extracts without approval of
C.I.P." That was put to them and they answered: "i want the CIP sheet in there,
not negotiable … we are not selling the sheet itself, we are using it in our
document as proof." Their call on their own company's exposure. `cipSheetFor`
had spliced the whole page as a fallback since it shipped anyway, behind
`FLAGS.cipSheetEnabled`, which the inset respects.
⚠️ Rasterise the **raw** file, never the A4 re-embed: `sheetFor` wraps the page
as a Form XObject and pdf.js threw out of `paintFormXObjectBegin` on every
render for an afternoon. **Still unproven** — never reproduced outside the
running service.

### Motivation purpose exhibits (the live AI images)

One to two pages of photographs under heading 3: four plates at two to a page
(`MAX_PLATES`), drawn once during **generation** by `MotivationPlatesService`
and stored in `MotivationPlate` with the prompt that drew them. Hunting packs
picture the quarry, sport packs the course of fire, self-defence packs the
place, and a firearm that lawfully does both shows two of each. The composite
quarry plate below is retired; this is the live image path.

- ⚠️ **THE PROMPTS FOLLOW xAI'S IMAGINE GUIDE, AND STILL DO ON GEMINI.** Subject
  first (what it is, its form, what holds it, the setting), then
  details/count/where the eye enters, art direction, light with a readable
  exposure, colour, lens/framing, the snapshot treatment, and the exclusions
  last. The plates draw on Gemini's Lite image model since 2026-11-17; the
  order is provider-neutral and is kept. `imageBrief()` in
  `motivation-image-brief.ts` assembles that order for the species and scene
  prompts; the course prompts use the same order through the shared tail
  constants in `motivation-courses.ts`. Do not append a new "No ..." clause to
  the subject paragraph.
- ⚠️ **AUTHENTIC, NOT DEGRADED.** The 2026-10-25 brief wants unedited phone
  snapshots, so the treatment keeps imperfect framing, ordinary light and
  clutter. It deliberately does **not** ask for motion blur, soft focus,
  crushed shadows or a dirty lens: the subject has to read in a document that
  is signed and lodged.
- ⚠️ **CROP-SAFE BY PROMPT.** Plates are requested at `21:9`
  (`PLATE_REQUEST_RATIO`, the supported ratio closest to the 2:1 print slot)
  and centre-cropped to 1800×900 at store time. Every prompt keeps the subject
  inside the middle two-thirds, so the crop cannot cut its head or feet.
- ⚠️ **VERSIONED.** `PLATES_PROMPT_VERSION` must be bumped whenever any wording
  changes; a stored plate keeps the prompt and version that drew it. The
  2026-10-27 brief is `2026-10-27a`. New/regenerated motivations use it;
  existing packs keep their stored bytes until regenerated.
- **Cost and preview.** One plate is about **3.4 US cents** on
  `gemini-3.1-flash-lite-image` (1 120 image tokens; measured 2026-11-17), so a
  four-plate pack is ~13.6 cents and a regeneration pays again. A rollback to
  `grok-imagine-image-2.0` costs a flat $0.08 a plate. Before shipping a wording
  change, run `npm run motivation:plates:preview -- --draw` from `backend/`: it
  builds the real prompts for the hunting, sport and self-defence cases and
  writes raw + 2:1-cropped JPEGs to `backend/tmp/plate-preview/`. Add
  `--limit 4` for a full pack, or `--case hunt,sport,defence,both` for the mixed
  case. The script routes through `LlmService` but uses a no-op ledger, so it
  does not touch member spend.

### Quarry plates

⚠️ **RETIRED 2026-10-15.** Nothing draws this any more; each quarry species now
has its own exhibit under heading 3 (see “Motivation purpose exhibits” above).
The text below records the old design and the `QuarryPlate` rows that still
exist for packs generated before the change.

A photorealistic line-up of the game a cartridge suits, across the foot of the
feature page. One per motivation (~3.4 US cents), drawn during **generation**
beside the research and the cover photograph — never at render, because the
pack renders on every download and the model takes 10–20 s against a 60 s nginx
ceiling. Stored in `QuarryPlate`, bytes in the row so `pg_dump` covers them.

- ⚠️ **GATED ON `firearm_use_kind`, NEVER ON THE SECTION.** Operator: "if its
  hunting or hunting/sport shooting, yes. both on section 15 and 16." Section
  16 splits hunter from sports person and section 15 covers either, so the
  licence type answers this for neither. A sport-only pack gets no game:
  pictures of quarry in a document that never mentions hunting argue a purpose
  nobody applied for.
- ⚠️ **A REAL ANIMAL, WITH NOTHING DRAWN ON IT.** Operator: "the animal should
  be a real animal and not show the vital zone." The first attempt marked the
  heart and lungs, which is an anatomical claim this platform cannot make in a
  document somebody signs.
- ⚠️ **NO PROTECTED SPECIES** — rhino is absent from the registry on purpose.
- ⚠️ **THE CAPTION CLAIMS NOTHING ABOUT THE APPLICANT.** It names the animals.
  A sentence saying they hunt these, or intend to, is a fact they are signing
  for under section 120(9)(f).
- Species are chosen deterministically from the research the page itself
  prints — no second model call — matched as **whole words** ("eland" is inside
  "Zeeland", "lion" inside "medallion") and only from the **well-matched** half
  of the brief, because the sentence after it lists what the round must not be
  used on.

### Document tiers — four, not three

`DocumentTier = 'required' | 'expected' | 'strengthens' | 'extra'`.

- **required** — SAPS will not process without it. It does **not** mean we refuse
  to proceed; we never block someone drafting because a copy is at the police
  station being certified.
- **expected** — the tier exists because two could not tell the truth. No statute
  behind it, and you are not getting in without it. Calling it "optional but it
  helps" sends someone to a counter to be turned away.
- **strengthens** — genuinely optional, genuinely helps.
- **extra** — anything else the member attaches.

⚠️ A document kind must appear in a tier for its licence type, or the checklist and
the picker disagree: `documentStatus()` omits the row, the label falls back to raw
SCREAMING_CASE, and the picker files it under "something else you would like to
attach".

### Where things live

- `backend/src/motivations/motivation-fields.ts` is **the contract** between the
  form, the interview, the fact pack and the quality gate. A key appears in four
  places, so it is defined exactly once there.
- `NOT_ASKED_BY_TYPE` removes a common question from one licence type.
  ⚠️ **It filters what is ASKED, never what is ACCEPTED** — `fieldByKey` searches
  the unfiltered list on purpose, or the wizard's next autosave (which resends the
  whole blob) deletes an older draft's answer and shows the member an error.
- A wizard step is a **union of whole registry sections**, never part of one, so a
  `showIf` pair can never be split across steps.
- `backend/src/common/card-placeholder.ts` — a licence card prints "NONE" against a
  component that carries no number. That is the card being complete, not a serial
  called NONE. Apply `answerValue()` at **answer boundaries only**; readers and the
  vault keep the card verbatim, because the printed seller-consent declaration
  reproduces what the card says.
- **ActionToken purposes:** `SCAN_HANDOFF` (desktop → phone camera, 15-minute TTL;
  ⚠️ it is a write credential to the member's vault and is **not** consumed until
  the phone says it is finished, so the short TTL is the only thing bounding it),
  `WITNESS_STATEMENT` (a character witness completes and signs, one hour) and
  `SELLER_CONSENT` (the current licence holder consents in writing to a named
  applicant applying over a named firearm). ⚠️ Unlike SCAN_HANDOFF, the last two
  are opened by **someone who is not the member**.

### The scanner

⚠️ **There are TWO scanners behind `NEXT_PUBLIC_SCANNER_V3=1` (build-time,
inlined — any other value, unset included, keeps V2), reached through one
door** (`components/scan/scan-button.tsx` and `/scan/handoff`).
Off → `lib/scan` + `components/scan` (DocCornerNet, assets under `/scan/v2/`,
the member picks a shape). On → `lib/scan-v3` + `components/scan-v3`
(DocAligner LCNet-100, `/scan/v3/`).

⚠️ **`lib/scan-v3` and `components/scan-v3` are a VENDORED COPY of an out-of-repo
project. Never edit them here — the next sync silently reverts it.** Change the
upstream project and re-run its sync script.

Rules that survive from the V2 work:

- **Detection passing ≠ detection correct.** On a real licence card the detector
  can pick the mat or a ruler and score it confidently. This is not a scoring bug
  to re-weight; see the skipped regression in `detect.spec.ts`, which records what
  was tried and why it was reverted.
- **So the aim box constrains the crop** rather than fixing detection, and the
  corner editor is the safety net. A wrong crop the member can see and fix beats a
  clever one they cannot.
- **The aim box is sized to what a phone can do** — across real photographs a
  document covered 20–58% of frame area and never more, because near focus stops
  you getting closer. A box drawn bigger is one nobody can fill.
- **Assets live under a versioned path — bump the path, never overwrite a file in
  place.** The service worker caches by URL. Applies to `/scan/v2/` and `/scan/v3/`.
- ⚠️ **The ONNX runtime is NOT bundled into the worker.** The worker
  `importScripts` the runtime's own classic build. Bundled by webpack, its dynamic
  `import()` becomes a chunk loader that can never resolve a `/scan/` URL and the
  runtime reports "no available backend" on every phone. The runtime files must
  come from the same version as `package.json`.
- **`/scan/selftest`** (public, no camera) loads the detector, runs it on a drawn
  document and prints the runtime's own error text. Open it on the phone before
  chasing anything else.
- **Desktop opens no camera** — a laptop webcam cannot resolve a licence serial.
  The handheld test is `pointer:coarse && maxTouchPoints > 0`; on a desktop the
  primary action is the QR hand-off.
- **Glare / too bright / too dark hold on screen until resolved** — they are the
  only failures no processing recovers, and one module answers both the held alert
  and the viewfinder hint so the two can never disagree.
- ⚠️ **The test photographs carry a name, an ID number and serials.** They live in
  `scan-fixtures/`, which is gitignored, and must never be committed. Regressions
  get rebuilt as synthetic scenes.

**Backend `scan/`** is the server-side fallback: **one route**, `POST /scan/detect`,
guarded by `ScanHandoffGuard` **only** — deliberately a separate controller from
the licence-centre one, because that controller's `AuthGuard` would 401 the phone.

---

## The Bench

One screen at `/bench`, members only, reached from Account. It is the **reverse
load finder**: "what can I load from what is on my shelf". A member keeps a bench —
powders, bullets, cartridges they own — and the screen answers with consolidated
loads.

⚠️ **Members-only, no-store, including the reads.** Every `/api/bench` route takes
`AuthGuard` and every method carries `@NoStore()`. `@Header` is method-only in
Nest, so this cannot be declared once on the controller: a route added without it
is a viewer-varying response the browser will hand to the next person on that
machine. A guest bench is deferred and gets its own decision.

⚠️ **No provenance, anywhere.** Operator ruling 2026-09-02: nothing on any Bench
surface may name where a figure comes from — no "manual", no "CIP", no "SAAMI", no
"published", no source counts. This is a **copyright boundary**, not tidiness. Say
"start charge" and "max charge". Makers stay.

⚠️ **A bullet is a WEIGHT IN A CALIBRE, never a brand.** The bullet axis matches on
weight within a tolerance and on the calibre the cartridge implies, and on nothing
else. Operator: "a 150gr bullet of any manufacturer would yield almost the exact
same pressures and speeds. this is the whole point of the Bench."

⚠️ **Consolidation is the one place where being wrong is a safety problem.**
Several manuals publish the same combination with different ranges. The Bench shows
**one** row per combination: start = the **lowest** start any source gives, max =
the **highest** max — the widest safe-published window. Never an average (that
invents a number nobody tested) and never a single source's range.

- **Safety flags are computed server-side, always.** COAL flags and
  above-max/below-start log flags never come from the client, because a stale
  bundle must not be able to get that comparison wrong.
- **`benchFor()` is the one door** from a member's stored shelf into loads,
  powders and cartridge, and it rebuilds each bullet field by field — a field left
  out there is silently absent everywhere downstream with nothing failing.
- **An empty answer must explain itself.** Results are an AND across three axes, so
  one starving axis empties the page while the other two are full; a correct empty
  screen and a broken one look identical. `LoadsResponse.why` carries the three
  counts.
- **Caps say so:** `LOADS_MAX = 600`, fetched as `take: MAX + 1` so "exactly 600"
  can be told from "thousands", and the response sets `truncated` so the client
  says the list was cut.
- **Data model:** eleven additive models under a `// ─── The Bench ───` banner —
  `BenchCartridge` (+ `BenchCartridgeAlias`), `BenchPowder` (+ alias),
  `BenchBulletMaker`, `BenchSourceLoad` (**internal**, one row per CSV row, never
  exposed), `BenchLoad` (**public**, the consolidated row), `BenchCipDimension`,
  `BenchLogEntry`.
- **A load row resolves its cartridge in three steps:** by European name, then
  through the reference file's own alias column, then through a C.I.P. sheet; a
  cartridge the reference file lacks is created from its sheet.
- ⚠️ **The import and C.I.P. parse are standalone scripts, not wired into boot.**
  The operator runs them on the box after a backend deploy, in that order. Both are
  idempotent. **Any import fix is inert until the next run.**
- ⚠️ **The three Bench source files live only on the operator's machine and on the
  box — never in the repo** — and the hand-appended SAAMI-derived rows exist
  nowhere else.
- **Frontend:** `app/bench/page.tsx` is the only stateful thing; everything under
  `components/bench/` is presentational and implements `contract.ts` — change a
  shape there first. Overlays are a **stack**, not an enum.

Spec: `docs/design/the-bench/SPEC-BUILD.md`.

---

## Other modules

- **`crime-stats/`** — SAPS station-level figures for section 13 packs. A figure
  reaches a motivation **only** because a named release contains it; the writer is
  otherwise forbidden from recalling any statistic.
- **`news/`** — a nightly 02:50 poll of ~74 South African newspaper feeds; crime
  reports near the applicant's precinct, past twelve months, printed as cuttings
  cited by paper, date and annexure letter.
- **`complaints/`** — the formal complaints register. Every complaint gets a
  `CO`-prefixed case number. ⚠️ **Only a `NOT_ARRIVED` buyer complaint holds the
  seller's money** (the HELD→DISPUTED CAS). Condition/“not as described”/damaged
  complaints do **not** hold payout: they are recorded, the seller is emailed a
  neutral notice, and the parties resolve it between themselves. Photos are
  optional (caps unchanged). This is the money-path rule from the 2026-11-23
  non-delivery-only refund policy.
- **`listings/listing-faq.*`** — the public listing Q&A described above
  (`GET /listings/:id/faq`), plus `seller-reply-time.ts` (pure reply-time
  buckets). `hiddenAt` is platform moderation only; no seller route sets it.
- **`reloading/`** — admin-only manual corpus. The operator SCPs PDFs into
  `RELOADING_MANUALS_INBOX_DIR`, hits `POST /admin/reloading/scan`, and the service
  SHA-256-dedupes and stores under random hex filenames.
- **`ask-gg/`** — `POST /ask-gg/identify-listing` (the create-listing photo
  helper) and the admin KB and guide editors.

**Feature flags** live in `FLAGS` in `backend/src/settings/settings.service.ts`
(34 keys — booleans, numbers and strings, mixed defaults), edited through the admin
settings surface. Env-var switches (`PAYMENT_MODE`, `PAYMENTS_LIVE`,
`ZOHO_BOOKS_ENABLED`, `LLM_PROVIDER`, …) are separate and are **not** in that
registry. `VAT_REGISTERED` flips at the **R2.3m** VAT registration threshold
(the R1m micro-business turnover-tax limit is a separate test).

---

## Automate it — do not ask

> Operator, 2026-08-25: "if the certificate date is determined by the math insert
> it, don't wait for the user to go and confirm it. Same for the licenses, they all
> have an expiry date, insert it. No further user interaction required. Thats why
> we are designing this system, for automation and ease of use!"

A cautious blank is not safer than a good answer. For a product whose job is
warning somebody before a licence expires, silence is the worst outcome available.

- **Fill it in, arm it, let them change it.** Editable beats unasked.
- **Gate on OUR confidence, not on their attention.** Do not write a reading we are
  unsure of, and never invent one that is simply absent — **absent stays absent**,
  which is a different thing from wrong.
- **Record provenance** whenever a value is written for them, so a later
  recomputation can tell its own arithmetic from something they typed, and never
  overwrites theirs.
- **Say it was filled in**, on the row, in passing — never as a task.
- Any confirm step guarding a value we already hold is work we invented for the
  member.

---

## Operational ops

### Category seeding

The taxonomy lives in **`backend/prisma/category-tree.ts`** and nowhere else. Both
`prisma/seed.ts` and `backend/scripts/seed-categories.ts` import it, and
`backend/scripts/generate-category-migration.ts` emits the SQL that ships it to
production through `prisma migrate deploy`.

To change the tree: edit `category-tree.ts`, run the generator, review the
generated migration, then deploy. Production is changed by migrations, not by the
seed.

`prisma/seed.ts` re-introduces test dealers and a seed admin, so it is **not** safe
against production. `seed-categories.ts` touches categories only and is the repair
tool for a database whose rows have drifted from the tree; it deactivates every
category and reactivates only what the tree declares.

### Profile-completion verify-success fallback

iOS Safari can drop the response to `POST /users/me/profile-complete` in a PWA even
when the server succeeded. Two layers: `keepalive: true` on the fetch, and on any
thrown network error re-fetch `/users/me` and treat `profileCompletedAt` being set
as success. The member sees an error only if the server genuinely refused, or if
both the POST and the verification GET fail.

---

## Git

Clear, specific messages describing what changed. Work on a feature branch and
merge it into the deploy branch **`feat/takealot-ux-parity`** — never into `main`;
production does not track main and a push there ships nothing.

**One worktree: `C:/dev/gun-galore`.** Operator instruction, 2026-09-07 — the
`gg-deploy` and `gg-scanner` worktrees were removed so a session can pick up
where the last one left off. Do not create another; check the branch you need out
here instead, including `feat/takealot-ux-parity` when you deploy.

**Feature branches are deleted once merged.** As of 2026-09-14 the only local
branches are the deploy branch, `foundation` and the stale `main`; everything
else was merged into the deploy branch and removed. A branch still sitting
here weeks after its work shipped is dead weight, not a safety net — the
commits stay reachable from the deploy branch either way.

---

## Where the rest of the documentation is

**`docs/INDEX.md`** maps every document in the repo and says which still describe
the running system. Start there. Particularly:

- `README.md` — getting it running locally, and the domain glossary.
- `ALLOUTDOOR-REPLATFORM.md` — the clean-slate build under the new company, its
  open operator decisions and its top three risks. Live work.
- `docs/ARCHITECTURE.md`, `docs/ENVIRONMENT.md` — integration table and per-service
  failure modes.
- `DOCUMENT-CENTRE.md`, `LICENCE-APPLICATION-REBUILD.md`,
  `LICENCE-SERVICES-AND-FEED.md`, `MOTIVATION-*.md`, `SAPS271-PREFILL.md` — the
  licence stack in depth.
- `docs/design/the-bench/SPEC-BUILD.md` — The Bench.
- `HANDOFF.md` — what the last session did and what the next one should know.

Everything under `docs/history/` was true on the date printed at the top and has
not been maintained. Read it for the argument, not the status.
