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

Last full audit of this file against the running system: **2026-09-07**.

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
2. **A firearm never travels by courier or locker.** Enforced in
   `shipping.service.ts`. Two lawful routes: `DEALER_TRANSFER` (buyer picks the
   receiving SAPS-licensed dealer at checkout) and `PRIVATE_ARRANGE` (both parties
   attend a dealer in person, no pre-picked dealer). Every firearm listing must
   offer DEALER_TRANSFER; PRIVATE_ARRANGE is opt-in by the seller and sits behind
   a hard consent screen.
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
   PRIVATE_ARRANGE post-consent contact reveal, admin surfaces, and a user seeing
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

## Public vs Members — read before changing any public read path

Meta restricted the site twice for regulated goods. Regulated stock now sits
behind the login. Signed in, nothing changed.

**This is an auth wall, NOT cloaking.** Every signed-out visitor gets identical
content regardless of user-agent. Never branch on user-agent; never special-case a
crawler. Serving a crawler something different from a logged-out human is what
turns a block into a ban.

**The mechanism.** `Category.publicVisible` (source of truth) and
`Listing.publicVisible` (snapshot, set at create, re-snapshotted on category
change). Both `@default(false)` — an **allowlist**. A category added later is
invisible until someone publishes it, so the failure mode is "we forgot to show
the tents", never "we leaked the rifles".

**Public roots:** camping-outdoor, overlanding, fishing, optics, knives, hunting,
archery-bowhunting, paintball, cleaning-equipment, outdoor-clothing-footwear.
**Members-only roots:** firearms, gun-smithing-parts, reloading-components,
reloading-equipment, air-rifles, self-defence, shooting-accessories, ammo.
**Carve-outs** (`membersOnly: true` under a public parent):
archery--crossbows, optics--{rifle,handgun,rimfire-rifle,rangefinding-rifle,
air-rifle}-scopes, hunting--shooting-sticks-and-bipods.

**Rules when touching this:**

- Anonymity comes from `OptionalClerkGuard` (never rejects, stamps
  `request.clerkUserId`). A public read path with **no guard at all** is a leak.
- Every public read path goes through the same gate. Grep `publicOnly(` in
  `listings.service.ts`. ⚠️ Remember the non-obvious ones: seller reviews (they
  embed listing titles), and **the public seller storefront** —
  `GET /api/sellers/:clerkId` + `/sellers/[clerkId]` is anonymous-reachable and
  renders that seller's listings, so its browse call must stay behind
  `publicOnly()`.
- `findById` returns **404**, never 403 and never "sign in to view" — that would
  confirm the item exists.
- **Never `revalidate`/`force-cache` a fetch whose result varies by viewer.**
  Next's data cache is SHARED and the browser cache keys on URL, not on the auth
  header. Use `viewerFetch` / `useViewerFetch` (both force `no-store`).
- `sitemap.ts` stays **anonymous and uncached** (`force-dynamic`). A token there
  republishes the firearm taxonomy; `revalidate` there also survives a rebuild in
  `.next/cache` and prerenders from a pre-deploy snapshot.
- **No weapon word in a public category name or slug.** A gate that hides Firearms
  but publishes `optics--handgun-scopes` has not done its job — the scanner reads
  the URL. `assertNoWeaponWordInPublic` in `prisma/seed.ts` fails the seed. To
  publish something it matches, rename the category; never weaken the pattern.
- `publicVisible` must stay in `STATIC_LISTING_FILTERABLE_ATTRIBUTES` or Meili
  rejects the anonymous query outright.

`backend/src/listings/public-visibility.spec.ts` locks all of this. If a change
makes those tests fail, the change is wrong.

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
- **The hunt-ballistics code is still compiled into the marketplace backend**
  (`HuntBallisticsModule` in `app.module.ts`, plus `HuntPdf`, `HuntPdfPage` and
  `RangeEstimate` in `schema.prisma`). "Ballistics stays behind" is not automatic.
  Deleting it is a pure subtraction with no relations into the rest of the graph;
  that decision is still open.
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

---

## Environment variables and secrets

Values come from `.env` only. This section names variables, never values.

**Frontend**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`,
`NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_SCANNER_V3`,
`NEXT_PUBLIC_DISABLE_PWA` (absent in production, which is the correct resting
state — do not read its absence as the switch being broken).

**Backend**: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`,
`JWT_ADMIN_SECRET`, `ID_HASH_SECRET`, `HEALTH_PING_SECRET`, `VERIFYNOW_API_KEY`,
`VERIFYNOW_BASE_URL`, `VERIFYNOW_MODE`, `GEMINI_API_KEY`, `LLM_PROVIDER`,
`LLM_MODEL`, `ANTHROPIC_API_KEY` (rollback only), `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `MEILISEARCH_HOST`,
`MEILISEARCH_API_KEY`, `SMSPORTAL_CLIENT_ID`, `SMSPORTAL_API_SECRET`,
`RESEND_API_KEY`, `PUDO_API_KEY`, `BOBGO_API_KEY`, `BOBGO_BASE_URL`,
`BOBGO_WEBHOOK_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_VISION_API_KEY`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
`AWS_KYC_LIVENESS_ROLE_ARN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`, `WARDEN_TOKEN`, `WARDEN_BASE_URL`,
`RELOADING_MANUALS_INBOX_DIR`, `RELOADING_MANUALS_STORAGE_DIR`, the
`ZOHO_BOOKS_*` set, `COMING_SOON_GATE`, `ALLOW_LOCAL_ORIGINS`, and for Peach:
**`PEACH_CLIENT_ID`, `PEACH_CLIENT_SECRET`, `PEACH_MERCHANT_ID`,
`PEACH_ENTITY_ID`, `PEACH_SECRET`, `PEACH_ENV`**.

⚠️ **The Peach names matter.** `PEACH_ACCESS_TOKEN` and `PEACH_BASE_URL` are read
by nothing — hosts are hardcoded per environment. An operator setting the wrong
names at go-live gets a silent mock, because missing credentials do not stop the
boot. None of the six are set on production today, which is a second, independent
reason the rail is inert.

⚠️ **`ALLOW_LOCAL_ORIGINS`** lets the production API accept credentialed requests
from localhost and LAN origins, so a developer can run the frontend locally
against real data. It warns on every boot and raises a Desk card. It is currently
**false**. Never turn it on once the platform carries real members.

`STITCH_CLIENT_ID` / `STITCH_CLIENT_SECRET` are dead vars from a rejected
evaluation. `ODOO_*` and `TCG_*` are gone.

---

## Tech stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind.
  ⚠️ **Turbopack is opted OUT** — both `dev` and `build` pass `--webpack`.
  Anything reasoning "Turbopack in dev" is wrong here.
- **Backend:** NestJS + TypeScript. **ORM:** Prisma 7. **DB:** PostgreSQL.
- **Search:** Meilisearch. **Images:** Cloudinary.
- **Auth:** Clerk (buyers + sellers); custom JWT (admin).
- **SMS:** SMSPortal. **Email:** Resend. **KYC:** VerifyNow (+ AWS for liveness).
- **Shipping:** Pudo (lockers) + **Bob Go** (door). See Shipping.
- **Payments:** Peach — built, **inert**. See Money.
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
- **Payments (Peach).** `PAYMENT_MODE` and `PAYMENTS_LIVE` are both unset, so
  every checkout returns **503**. Going live = credentials + both flags.
- **Bob Go door delivery.** `bobgo_enabled` defaults **false**, and with it off
  there is no door rail at all — a door quote is refused outright. Its live value
  is a DB row and cannot be read from the repo; check the box before touching
  delivery.
- **Peach BANV** (bank verification). `isBanvEnabled()` gates it; until it is on,
  an admin reviews the bank-holder name against the KYC identity by hand before
  the first payout. **Do not claim automated AVS in user-facing copy.**

**Gone — do not rebuild against it, do not go looking for it:**
- **Featured Slots** (paid ad placement) — removed 2026-08-26. Six `FeaturedSlot*`
  Prisma models and `Listing.isFeatured` survive orphaned on purpose.
- **Swop / M4 Swap** — removed from code and routes; `SwapProposal` / `Swap`
  models survive. **M3 New Store** was never built.
- **Take a Shot as a listing mode** — since 2026-08-27 it is the "also accept
  offers" toggle on a Buy Now or Auction listing, not a third mode. The
  `TAKE_A_SHOT` enum value survives.
- **Hunting Packages / Experiences, AO PRO, Ask Boet chat, Daily Deals,
  the prize draw, Load Lab** (replaced by The Bench).
- **The Courier Guy (TCG)** — retired 2026-09-04. The `TCG` enum value survives
  and now names the **door shape**, served by Bob Go.
- **Manual EFT pay-in**, **Stitch**, **Odoo**, **Sentry**, the legacy `/admin`
  dashboard, the 63-file email template pack.

⚠️ **An orphaned Prisma model is not evidence a feature is live.** Several removed
features deliberately kept their tables, and live sweeps still read those columns
to stay correctly scoped. Check for a route and a controller before believing in a
feature. Equally, do not drop those models without a migration review.

---

## Money

### Commission

Marginal tiers, tax-bracket style (`backend/src/payments/fee.calculator.ts`):

| Band | Rate |
|------|------|
| First R5,000 | 9% |
| R5,001 – R20,000 | 7% |
| R20,001 – R100,000 | 5% |
| Above R100,000 | 3% |

Minimum platform fee **R10** per sale, never more than the listing price itself.
Top Seller tier gets a 0.5% discount.

⚠️ **Commission runs in TWO directions on the same columns, so read
`Transaction.feeModel` before describing any sale.** `feeModelFor()` snapshots it
at checkout.

- **`BUYNOW_MARKUP`** — the seller lists for free and receives their full asking
  price; commission and the gateway fee are added ON TOP to make the buyer-facing
  price. `Listing.price` is what the buyer sees and pays. `Listing.sellerAskCents`
  is the seller's take-home and is **owner-gated — never add it to
  `PUBLIC_LISTING_SELECT`**, it is our margin per item. Checkout recomputes
  FORWARD from the ask (the markup is banded, floored and discounted, so it is not
  reliably invertible). Multi-buy is priced per unit and multiplied. **Nothing is
  added at checkout but delivery** — no processing-fee row, it is already inside
  the price. The compare-at "was" price validates against the marked-up price, or
  a "was" could sit below the live price, which is a misleading discount claim
  under CPA s41.
- **`SELLER_DEDUCT`** — auctions and offers. A bid discovers the price, so there
  is nothing to mark up: commission comes out of the seller and the **buyer** pays
  the gateway fee, surfaced as a **"Transaction fee"** row (never "processing fee"
  or "service fee"). Buy Now *on an auction* follows the auction rules.

**Delivery carries a 10% margin, quoted INCLUSIVE** — the buyer sees one figure
and pays exactly that. Never render it as "quote + 10%" or a separate handling
row. The split is server-side only (`Transaction.shippingCost` = carrier
remittance, `shippingHandlingCents` = ours) because they are different obligations
at payout. The gateway fee is charged on the item plus the **carrier** rate, never
on our own delivery margin.

### Payments (Peach) — deployed, inert

Checkout V2 (pay-in) + Payouts + BANV. Stitch, PayFast, Ozow, iKhokha, Yoco and
KoraPay were all evaluated and rejected. **There is no Stitch code in this repo.**

- **Pay-in:** `createCheckout()` → hosted page → `/checkout/complete?id=…` →
  `getPaymentStatus()` verifies AND matches the bound transaction and amount →
  flip `PaymentStatus`. DECIMAL ZAR on pay-in, integer cents on payouts — do not
  mix them. 3DS/OTP happens on Peach's page; the buyer is always present.
- **Webhooks:** four routes on `transactions.controller.ts`
  (`/webhook/peach`, `-dispute`, `-banv`, `-payout`), HMAC verified.
  ⚠️ **A bad signature returns 200 `{received: true}`** with the handler skipped
  and `alertWebhookSignatureFailure()` raised — **not** a 401. No DB writes occur.
  Anyone grepping logs for 401s to diagnose a signature mismatch will find nothing.
- **Idempotency:** `peachMerchantRef`, `peachPayoutId` and `peachPaymentId` are
  `@unique` to block replay. ⚠️ `peachCheckoutId` is **not** unique — it is the
  primary webhook match, with `peachMerchantRef` as the fallback.
- **Pay-out:** ⚠️ **nothing pays a seller automatically.** Dealer-verification
  APPROVED (firearms) or buyer Confirm-Delivery (non-firearms) make a payout DUE
  (they stamp `releasedAt`); an admin then runs the batch —
  `ManualPaymentsService.runDuePayouts()` → `peach.createPayout()`, gated on
  `PAYMENTS_LIVE`, stamping `paidOutAt` only on rows Peach accepts and re-queueing
  on a Failed webhook.
- **Refunds:** `peach.refundPayment(...)` is called BEFORE flipping the row to
  `REFUNDED`. Money moves first, ledger second — never the other way around.
- **`PaymentStatus`:** `HELD`, `PENDING_ADMIN_VERIFICATION`, `RELEASED`,
  `DISPUTED`, `REFUNDED`.

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
- ⚠️ **`VERIFYNOW_MODE` defaults to sandbox and production boot only LOGS an
  error** — the hard throw was deferred. A production box can and does boot with
  sandbox KYC, which means identity checks pass on canned data. This is a real open
  item, not a solved one.
- Never use the word "KYC" in user-facing text — say "Verified" / "Verification".

---

## Shipping

- **Firearms / barrels:** `DEALER_TRANSFER` or `PRIVATE_ARRANGE` only, enforced
  server-side. Never a courier, never a locker.
- **Non-firearms:** Pudo locker-to-locker, or door delivery through the `TCG` enum
  slot now served by Bob Go. `shippingMethod` names the **shape** of the delivery,
  not the company — route post-booking work on `Transaction.carrierProvider`.
- **`COLLECTION`** is a real method: buyer collects in person, forced for
  collection-only categories (trailers, oversized or dangerous goods) and rejected
  for everything else. Funds stay HELD until the buyer confirms collection, and
  contact details are revealed only after payment.
- **`ON_SITE_SERVICE`** — a future-dated on-site service with no parcel.
- ⚠️ **Bob Go answers HTTP 201 before a courier has agreed.** Every booking starts
  unconfirmed (`pending-rates`). Branch on `submission`, never on "it did not
  throw". See `BOBGO-MIGRATION.md`.
- ⚠️ **The payout gate depends on a correct status map.** Exactly two carrier
  slugs reach Prisma `DELIVERED`, and `DELIVERED` starts the clock that releases
  the seller's money. Bob Go aggregates many providers, so its vocabulary is its
  own. Enumerate it from the sandbox before adding a map row — mapping "in the
  locker, buyer has not opened it" to DELIVERED pays sellers for goods buyers never
  received.
- ⚠️ **Bob Go returns rand with decimals into a codebase that is integer cents
  from the quote boundary onward.** Both sides are `number`, so types will not
  catch it. One missed conversion is a 100× error on every shipping charge.

**Webhooks** are public routes, no JWT:
- **Pudo** → `/api/shipping/webhook/pudo` (tracking status; no auth key).
- **Bob Go** → `/api/shipping/webhook/bobgo/<secret>/<group>/<action>` — the topic
  AND the secret travel in the PATH, because subscriptions are registered one
  topic at a time and we choose the URL, so each self-identifies without relying
  on custom headers. Five of seven topics registered. Register with
  `PATCH /webhooks` — **not POST**, which returns 200 and silently creates nothing.

Handlers are idempotent, share `findTransactionByTrackingNumber`, map provider
status to internal `shippingStatus`, fire notifications, always return 200, and
handle unknown tracking numbers gracefully. ⚠️ Absolute URLs registered with a
provider must point at **alloutdoor.co.za**.

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
  `sellerRejectStrikes` (3 = `sellingBannedAt`: no new listings, buying
  unaffected, lifted only by an admin). **There is no fine system** — no Penalty
  model, no admin approval step, no paygate deduction.
- **Seller tiers** (badge only; no listing-volume cap, no deposit): New (0 sales),
  Established (3+ / 50+ score), Trusted (10+ / 70+), Top Seller (25+ / 85+, 0.5%
  commission discount), Dealer (admin-set, sticky). The **private Trust Score**
  (0–100) is visible only on the seller's own dashboard, never publicly.

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

---

## Notifications

Three channels, one source of truth in `NotificationsService`:

1. **Email** (Resend) — every event, every recipient.
2. **SMS** (SMSPortal) — every event with a verified phone. Action SMSes embed
   single-use tokens with 48h expiry.
3. **In-app inbox** (`Notification` model) — drives the bell badge and
   `/notifications`.
4. **Web push** — shipped. `backend/src/push/` wraps `web-push`; browser opts in →
   `POST /push/subscribe` → `persist()` writes the inbox row and, **for
   action-required events only**, calls `push.sendToUser()`. A 410 from the
   gateway deletes the subscription row. iOS Safari 16.4+ only delivers to an
   installed PWA.

⚠️ **Every transactional email is rendered by ONE in-code helper** —
`renderEmail()` in `notifications.service.ts`, from an `EmailContent` object
(headline, body, optional status pill, labelled rows, one CTA, footnote,
preheader) with theme tokens inlined. **There are no per-event template files.**

**Resolved-by-action, not read-on-open.** Opening the inbox or tapping an item
does **not** clear it. A notification stays, and counts toward the badge, until the
user **acts** on the underlying entity or explicitly dismisses an informational
item. `dismissible: false` rows can only be cleared by the server-side resolve
hook. Badge query is `WHERE userId=? AND resolvedAt IS NULL`.

API: `persist(...)`, `persistByEmail(email, ...)`, and
`resolveByEntity(linkedType, linkedId, {userId?, resolvedBy?})`, called from action
handlers across the codebase. Feed endpoints are Clerk-guarded and throttled
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
- **Brand red `--red` #C8102E** (hover #A00D24) — prices, primary CTAs, active
  states, live badges. ⚠️ **The logo's red is a different value, #E01B24**, and
  stays that on every ground. Do not "fix" either to match the other, and never
  recolour a logo path to `var(--red)`.
- Borders 0.5px; border-radius max 8px; system font stack; weights 400 and 500
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

Six files in three light/dark pairs. **The app renders the `-dark` variants
everywhere**, because on a white page the ink must be dark: `logo-nav-dark.svg`
(the wordmark lockup, #111111 ink plus the #E01B24 road) and `logo-mark-dark.svg`
(the AO monogram — an A whose counter is a snow-capped peak, an O, and a red road
running out of it). The white-ink `logo.svg` / `logo-nav.svg` / `logo-mark.svg`
are for dark grounds only.

- On centred pages: width 100%, max-width 300px, never a fixed height.
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
- `middleware.ts` keeps `/offline` and `/sw.js` public so Clerk does not rewrite
  them; `tsconfig.json` includes the `webworker` lib.

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
runs its own JWT, not Clerk — so nothing upstream turns a signed-out visitor away.
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
`/documents`), the **Motivations builder** (`/motivations/[id]` and
`/licence-services/[id]`), and the **scanner**.

⚠️ **The member-facing route is `/documents`, but the backend prefix is still
`licence-centre`** (`@Controller('licence-centre')`). The rename left that split
behind; both names are live and mean the same thing.

### The five licence types

`MotivationLicenceType` is the spine — every registry section, document tier,
checklist and PDF branch keys off it:

| Value | What it is |
|---|---|
| `S13_SELF_DEFENCE` | self-defence |
| `S15_OCCASIONAL_HUNTER` | occasional hunter **or occasional sports shooter** |
| `S16_DEDICATED_HUNTER` | dedicated hunter, accredited hunting association |
| `S16_DEDICATED_SPORT` | dedicated sports shooter, accredited sport-shooting body |
| `S24_RENEWAL` | renewal of a licence already held |

⚠️ **A section 24 renewal is lodged on the SAPS 518(a), not the SAPS 271.** The 271
is an application for a NEW licence under sections 13–20. This product does not
fill in the 518(a); an S24 pack ships the motivation alone and says so. The 271
itself is an **opt-in extra**, not the product — one early question decides it, and
answering yes un-hides roughly forty-eight form-only questions.

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
the licence-centre one, because that controller's ClerkGuard would 401 the phone.

---

## The Bench

One screen at `/bench`, members only, reached from Account. It is the **reverse
load finder**: "what can I load from what is on my shelf". A member keeps a bench —
powders, bullets, cartridges they own — and the screen answers with consolidated
loads. It replaced Load Lab.

⚠️ **Members-only, no-store, including the reads.** Every `/api/bench` route takes
`ClerkGuard` and every method carries `@NoStore()`. `@Header` is method-only in
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
  `CO`-prefixed case number. ⚠️ **A buyer lodging one of the three payout-affecting
  categories holds the seller's money**, so this module is on the money path.
- **`reloading/`** — admin-only manual corpus. The operator SCPs PDFs into
  `RELOADING_MANUALS_INBOX_DIR`, hits `POST /admin/reloading/scan`, and the service
  SHA-256-dedupes and stores under random hex filenames.
- **`ballistics/`** — see the separate app on the box.
- **`ask-gg/`** — the chat backend was retired 2026-09-07. Only
  `POST /ask-gg/identify-listing` and the admin KB and guide editors remain.

**Feature flags** live in `FLAGS` in `backend/src/settings/settings.service.ts`
(34 keys — booleans, numbers and strings, mixed defaults), edited through the admin
settings surface. Env-var switches (`PAYMENT_MODE`, `PAYMENTS_LIVE`,
`ZOHO_BOOKS_ENABLED`, `LLM_PROVIDER`, …) are separate and are **not** in that
registry. `VAT_REGISTERED` flips at R1,000,000 turnover.

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

⚠️ **DO NOT RUN `backend/scripts/seed-categories.mjs` until it is reconciled with
`prisma/seed.ts`.** The script deactivates **every** category and re-activates only
its own list, and its list is four parents short — Overlanding, Hunting, Outdoor
Clothing & Footwear and Archery & Bowhunting would be left `isActive=false` along
with everything under them. Its usage comment also still says `ssh gungalore`,
which is the alias that was deleted precisely because it could resolve to the
retired box. Production currently holds 189 Category rows.

`prisma/seed.ts` re-introduces test dealers and a seed admin, so it is **not** safe
against production either.

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

⚠️ `feat/scanner-tracking` exists **only locally** and has never been pushed.

---

## Where the rest of the documentation is

**`docs/INDEX.md`** maps every document in the repo and says which still describe
the running system. Start there. Particularly:

- `README.md` — getting it running locally, and the domain glossary.
- `ALLOUTDOOR-REPLATFORM.md` — the clean-slate build under the new company, its
  open operator decisions and its top three risks. Live work.
- `docs/ARCHITECTURE.md`, `docs/ENVIRONMENT.md` — integration table and per-service
  failure modes.
- `BOBGO-MIGRATION.md` — the courier cutover.
- `DOCUMENT-CENTRE.md`, `LICENCE-APPLICATION-REBUILD.md`,
  `LICENCE-SERVICES-AND-FEED.md`, `MOTIVATION-*.md`, `SAPS271-PREFILL.md` — the
  licence stack in depth.
- `docs/design/the-bench/SPEC-BUILD.md` — The Bench.
- `HANDOFF.md` — what the last session did and what the next one should know.

Everything under `docs/history/` was true on the date printed at the top and has
not been maintained. Read it for the argument, not the status.
