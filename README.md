# All Outdoor

A South African online marketplace for outdoor gear — camping and overlanding kit, fishing
tackle, optics, knives, clothing — and, behind a login, the regulated categories: firearms,
gun parts, reloading components, air rifles, self-defence and shooting accessories. Private
sellers and dealers list new and secondhand stock; buyers pay All Outdoor, not the seller,
and the money is **held** until the item is delivered and accepted.

Three things make it unusual, and they shape most of the code:

- **Regulated categories are members-only.** A signed-out visitor sees an outdoor store.
  Nothing weapon-related is reachable, crawlable, or searchable without an account. This is
  an auth wall, not cloaking — a signed-out human and Googlebot get byte-identical pages.
- **Four selling modes**, not one. Every listing is `BUY_NOW`, `AUCTION`, `TAKE_A_SHOT`
  (offers), or `SWOP` (item-for-item trade). Each has its own state machine.
- **Funds are held.** Payment lands with the platform, sits at `HELD`, and is released to
  the seller after delivery. Never call this "escrow" in code, copy or docs — we are not a
  licensed escrow agent. "Funds held" / "payment held".

The site is live. Card payments are gated off until the payment provider goes live
(`PAYMENTS_LIVE`), so checkout currently returns "launching soon" — see
[Things that will surprise you](#things-that-will-surprise-you).

---

## Stack

| Layer | What | Version |
| --- | --- | --- |
| Frontend | Next.js (App Router) + React | `next ^16.2.6`, `react ^19.2.6` |
| Styling | Tailwind CSS | `^3.4.1` (**v3, not v4** — see below) |
| PWA | Serwist service worker | `^9.5.11` |
| Backend | NestJS | `^11.0.1` |
| ORM | Prisma (with the `pg` driver adapter) | `^7.8.0` |
| Database | PostgreSQL | 16 in production |
| Search | Meilisearch (`meilisearch-js` client) | server 1.44, client `^0.58.0` |
| Auth | Clerk (buyers + sellers) | `@clerk/nextjs ^7.3.5`, `@clerk/backend ^3.4.9` |
| Auth (admin) | Custom JWT, entirely separate from Clerk | `@nestjs/jwt ^11.0.2` |
| AI | Anthropic SDK — moderation, KYC vision, the "Ask Boet" assistant | `^0.96.0` |
| Images | Cloudinary | `^2.10.0` |
| Email / SMS / Push | Resend, SMSPortal, `web-push` (VAPID) | `resend ^6.12.3`, `web-push ^3.6.7` |
| Payments | Peach Payments (Checkout V2 pay-in, Payouts pay-out) | hand-rolled adapter |
| Language | TypeScript | `^5.7.3` (backend), `^5` (frontend) |
| Runtime | Node.js | 20.9+ required by Next 16; developed on 24 |

Hosting is a single Ubuntu VPS: nginx → pm2 → (Next on `:3000`, Nest on `:3001`), with
Cloudflare in front. Postgres `:5432` and Meilisearch `:7700` are on the same box.

---

## Get it running locally

### Prerequisites

- **Node 20.9 or newer.** Next 16 will not start below that.
- **PostgreSQL 14+** running locally, and an empty database you own.
- **A Clerk development instance** (free). The frontend *cannot boot* without a Clerk
  publishable key — `clerkMiddleware` runs on nearly every route. Create a dev app at
  clerk.com and take the `pk_test_…` / `sk_test_…` pair.
- **Meilisearch — optional.** Without it, search and per-category attribute filters are
  disabled and browse falls back to a Prisma query (see
  `listings.service.ts → browse()`). Everything else works. Install it if you're touching
  search; skip it otherwise.
- Everything else (Cloudinary, Anthropic, Peach, VerifyNow, Pudo, TCG, Resend, SMSPortal)
  degrades gracefully when unconfigured. You do not need any of those accounts to get a
  running site.

### 1. Clone and install

```bash
git clone git@github.com:gungalore/gun_galore.git
cd gun_galore

cd backend  && npm install && cd ..
cd frontend && npm install && cd ..
```

There is no workspace root — `backend/` and `frontend/` are two independent npm projects
with their own lockfiles. Install in each.

### 2. Environment files

```bash
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill in the minimum set to boot:

**`backend/.env`**

```
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/gun_galore?schema=public
CLERK_SECRET_KEY=sk_test_…
FRONTEND_URL=http://localhost:3000
PORT=3001
NODE_ENV=development
```

`JWT_ADMIN_SECRET` can stay empty in development — `admin-jwt-secret.ts` falls back to a
fixed throwaway so admin login works with zero config, and *throws* if that fallback is
ever reached with `NODE_ENV=production`.

**`frontend/.env.local`**

```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
CLERK_SECRET_KEY=sk_test_…
```

> **`NEXT_PUBLIC_API_URL` must include the `/api` suffix.** The backend sets a global `api`
> prefix in `main.ts`, and every call site in the frontend uses the raw value with no prefix
> of its own — the hard-coded fallback is literally `http://localhost:3001/api`. If you see
> this variable written anywhere without `/api`, that value is wrong and every request will
> 404 with an empty body.

Two more worth knowing before you skip past them:

- `ID_HASH_SECRET` encrypts sellers' SA ID numbers at rest and salts the duplicate-identity
  hash. Set it locally to any long random string. **It can never be rotated** — changing it
  makes every stored ID permanently undecryptable. Read the comment above it in
  `backend/.env.example` before you touch it.
- `INTERNAL_API_URL` is the server-side counterpart, used by Server Components so an SSR
  fetch talks to the backend over loopback instead of going out through nginx and Cloudflare.
  Locally it is the same value as `NEXT_PUBLIC_API_URL`, which is also its fallback.

Full variable reference, including the seventeen backend keys that are load-bearing in
production: **[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)**.

### 3. Database

```bash
cd backend
npx prisma migrate dev      # 98 migrations; creates the schema
npx prisma generate         # regenerate the client after ANY schema change
npx prisma db seed          # see the warning below
```

Prisma 7 reads the connection URL from `prisma.config.ts`, **not** from `schema.prisma`
(the datasource block deliberately has no `url`). `prisma.config.ts` imports
`dotenv/config`, so `backend/.env` is picked up automatically.

> **Do not use `npm run seed`.** That script is
> `ts-node --project tsconfig.json -e "require('dotenv/config')" prisma/seed.ts` — with
> `-e`, ts-node evaluates the string and treats the filename as a plain argument, so the
> seed file never runs and the command exits 0 having done nothing. Use
> `npx prisma db seed` (which resolves the seed command from `prisma.config.ts`) or
> `npx ts-node --project tsconfig.json prisma/seed.ts`.

**What the seed actually does** (`backend/prisma/seed.ts`, ~720 lines):

1. Sets `isActive: false` on *every* existing category, then reactivates the ones in the
   seed. Obsolete categories go inactive rather than being deleted, so old listings keep
   their foreign key but the category disappears from pickers.
2. Upserts the canonical tree — 14 root categories, ~110 sub-categories — with the flags
   that drive the whole domain: `isFirearm`, `requiresLicence`, `availableSecondhand`,
   `collectionOnly`, `isExperience`, and `publicVisible`.
3. Upserts per-category attribute definitions (rod class, draw weight, battery Wh, vehicle
   fitment…). These are kept in deliberate lockstep with the migrations that first created
   them — the seed is the canonical copy.
4. Upserts five **test SAPS dealers** (licence numbers `TEST-GP-001`, `TEST-WC-001`, …) so
   the firearm dealer-transfer flow is exercisable locally.
5. Upserts one superadmin: `admin@gungalore.co.za`, password from `ADMIN_SEED_PASSWORD` or
   the default in the file. Log in at http://localhost:3000/admin/login.

It does **not** create listings, users, or orders. A freshly seeded local site is an empty
shop with a full category tree.

The seed will **refuse to run** — loudly, with an explanation — if it would publish a
category whose name or slug contains a weapon word (`rifle`, `ammo`, `holster`, `shooting`…)
to signed-out visitors. That guard exists because gating happens per *tree*, and a
weapon-named child inside an innocent parent (Optics › Rifle Scopes) slips through the tree
rule. If it fires, rename the category, or mark it `membersOnly: true` on the sub-category in
`backend/prisma/seed.ts` — do not weaken the pattern.

### 4. Meilisearch (optional)

Run a local instance on `:7700`, then add to `backend/.env`:

```
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_API_KEY=
```

`SearchService.onModuleInit` creates the three indexes (`listings`, `pudo_lockers`,
`cartridges`) and configures filterable/sortable attributes on boot. If the host is unset it
logs `MEILISEARCH_HOST not set — search disabled` and carries on; if the host is set but
unreachable it logs the failure and disables itself. Neither case stops the backend.

### 5. Run the two dev servers

Two terminals.

```bash
# terminal 1 — backend
cd backend
npm run start:dev          # nest start --watch  →  http://localhost:3001/api
```

```bash
# terminal 2 — frontend
cd frontend                # ← from frontend/, NOT the repo root
npm run dev                # next dev --webpack  →  http://localhost:3000
```

**Two rules here, both learned the hard way:**

1. **Start the frontend from inside `frontend/`.** `tailwind.config.ts` declares its content
   globs as `./app/**`, `./components/**`, `./pages/**` — relative to the working directory.
   Launch it from the repo root (`npm --prefix frontend run dev`) and Tailwind scans nothing,
   emits no utilities, and you get a fully functional but completely unstyled site. It looks
   like a CSS build failure. It isn't.

2. **Do not remove `--webpack`.** Next 16 defaults to Turbopack, and Turbopack breaks
   Tailwind v3's PostCSS pipeline in this project. Both `dev` and `build` pin webpack for
   this reason. `next.config.mjs` also carries an empty `turbopack: {}` block — that is a
   separate fix, silencing Next 16's "build is using Turbopack with a webpack config" error
   caused by the Serwist plugin, and it should stay too. If you want Turbopack, the real
   prerequisite is migrating to Tailwind v4, which is a project, not a flag.

Check it's alive:

```bash
curl -f http://localhost:3001/api/health   # {"status":"ok", …}
curl -fsI http://localhost:3000
```

| URL | What |
| --- | --- |
| http://localhost:3000 | The store |
| http://localhost:3000/dashboard | Signed-in member dashboard |
| http://localhost:3000/admin/login | Admin (separate JWT auth, seeded superadmin) |
| http://localhost:3001/api | Backend, all routes under the `api` prefix |
| http://localhost:3001/api/health | Health check |

---

## Things that will surprise you

Read this section before you file a bug against your own machine.

- **Checkout returns 503 "Card payments are launching soon".** `PAYMENTS_LIVE` defaults to
  `false` (`backend/src/payments/payment-mode.ts`). The money engine is complete and
  rail-agnostic; only the entry gate is closed. Set `PAYMENTS_LIVE=true` locally to walk the
  flow — with no `PEACH_*` credentials the Peach adapter runs in **mock mode**, returning
  fake checkout ids and never calling out. To see the card UI rather than the manual one,
  set `PAYMENT_MODE=paygate` in the backend and `NEXT_PUBLIC_PAYMENT_MODE=paygate` in the
  frontend; the backend is the authority, the frontend flag only changes what is rendered.
  Do not set any of this on production.
- **New listings sit in `PENDING_REVIEW` and never appear.** Listing moderation runs through
  Claude. With no `ANTHROPIC_API_KEY` the moderator fails *closed* and routes every listing
  to human review. Either add a key or approve listings from the admin UI.
- **The signed-out site looks nearly empty.** That is correct behaviour, not missing seed
  data: `publicVisible` is an opt-in allowlist and most of the catalogue is members-only.
  Sign in to see the rest.
- **There is a coming-soon gate.** If `COMING_SOON_GATE=on`, every route rewrites to
  `/coming-soon` unless you hold the bypass cookie. Leave it unset locally.
- **Rate limiting is on in dev too** — one global bucket, 60 requests/minute/IP
  (`app.module.ts`). Next's SSR fan-out hits the API several times per page render from
  `localhost`, so a hot-reload loop can trip it. A 404 on every listing page is the classic
  symptom. It resets after a minute.
- **`prisma generate` is not automatic.** Change `schema.prisma` and you must run it before
  building, or you'll debug a stale client.
- **Local migration drift is a known, unresolved issue.** The local Prisma ledger has
  historically fallen behind production. If `migrate dev` wants to reset your database,
  stop and ask — do not let it run against anything you care about.
- **21 markdown files at the repo root are historical audit reports**, not current
  documentation. `AUDIT-2026-06-10.md`, `DUMMY-RUN-REPORT.md`, `TAKEALOT-UX-PARITY-REPORT.md`
  and friends describe a moment in time. Treat them as archaeology.
- **`CLAUDE.md` has stale patches.** Its Tech Stack section still names Stitch as the
  payment provider and says not to reintroduce Peach; the code has used Peach since
  2026-07-23. Where CLAUDE.md and the code disagree, the code wins.

---

## Repo map

### `backend/src/` — NestJS, one folder per module

Every module is registered in `app.module.ts`; read that file first, it's the honest index.

**The core transaction path**

| Module | What it owns |
| --- | --- |
| `listings/` | Listing CRUD, browse (Meili with a Prisma fallback), the `PUBLIC_LISTING_SELECT` allowlist that keeps reserve prices, serial numbers and seller addresses out of anonymous responses, and SAP-534 firearm licence capture. **Start here.** |
| `categories/` | The category tree, the public/members-only split, and per-category attribute resolution (a listing inherits its leaf category's attributes plus every ancestor's, nearest wins). |
| `offers/` | "Take a Shot" — buyer offers, seller accept/reject/counter, auto-accept thresholds, and the reject-reason strike policy. |
| `auctions/` | Timed bidding, auto-bids, anti-snipe extension (a bid in the last 2 minutes moves the clock), hidden reserves, bind windows, runner-up offers. |
| `swaps/` | Swop/Trade — proposals, value-based fees, proof-of-possession via Claude vision, two-way shipping. |
| `payments/` | The money engine: Peach adapter, transaction state (`HELD` → `RELEASED`), fee maths, refund arms, dispatch SLAs. `payment-mode.ts` is the seam that gates everything. |
| `orders/` | Multi-item order rollup over individual transactions. |
| `shipping/` | Courier booking (PUDO lockers, The Courier Guy door-to-door), waybills, tracking, dealer hand-off. |
| `my-shipments/` | The member-facing view of the above. |

**Trust, identity and compliance**

| Module | What it owns |
| --- | --- |
| `kyc/` | Seller identity verification — VerifyNow plus a cheaper Claude-vision flow. Triggered at first payment, hard-gates payout. |
| `moderation/` | Claude listing moderation, prompt-injection sanitising, and a deterministic regex pass that strips emails/phones/URLs out of descriptions. |
| `ratings/`, `reports/`, `complaints/`, `support/` | Reviews, user reports, the formal complaints register, help centre. |
| `admin/` | Admin JWT auth, dashboards, health checks, AI-spend monitoring, payouts-due review, analytics. |

**Everything else**

| Module | What it owns |
| --- | --- |
| `tasks/` | The scheduler. ~40 `@Cron` jobs live across the codebase; this is where most of them are wired. Auction close, offer expiry, KYC chasers, payout collection, digests. |
| `actions/` | One-tap action tokens. An SMS link like `/a/<token>` **is** the credential — no Clerk session — scoped to a single action (accept an offer, raise a bid, pay). |
| `notifications/`, `push/`, `sms/` | In-app feed, Web Push (VAPID), SMSPortal. Email templates live in `src/modules/notifications/templates/emails/`. |
| `ask-gg/` | "Ask Boet", the site-wide Claude assistant: knowledge base, page context, account tools, fair-use lanes. |
| `load-lab/`, `reloading/`, `hunt-ballistics/` | Reloading manual library, powder burn charts, cartridge specs, ballistics reference. Domain content, not marketplace mechanics. |
| `deals/`, `suppliers/` | Daily Deals — All Outdoor as a first-party seller. Flag-gated off. |
| `featured/` | Paid featured-listing slots. |
| `subscriptions/`, `raffle/` | GG PRO (R99/month) and the PRO prize draw. |
| `settings/` | Runtime feature flags, read from the DB (`FLAGS` in `settings.service.ts`). Most half-built features ship dark behind one of these. |
| `activity/` | Buffered analytics event capture feeding the insights dashboard. |
| `zoho/` | Zoho Books accounting sync. |
| `search/` | The Meilisearch client, index bootstrap, and facet configuration. |
| `common/` | Reference numbers, ID encryption, prompt sanitising, CSV, the seller reject policy. |
| `prisma/` | `PrismaService` — a `PrismaClient` using the `@prisma/adapter-pg` driver adapter. |

`backend/prisma/schema.prisma` is 3,800 lines and heavily commented. The comments explain
*why* fields exist and what breaks if you change them; they are worth reading before you
touch the schema.

### `frontend/`

| Path | What |
| --- | --- |
| `middleware.ts` | **Read this before adding any page.** Clerk auth, the public-route allowlist, the coming-soon gate, token-authed pages. A new public page that isn't in `isPublicRoute` will 307 signed-out visitors to sign-in — including Googlebot. |
| `app/` | App Router pages. `listings/`, `category/`, `checkout/`, `my/` (bids, offers, orders, sales, listings, earnings, swaps), `account/`, `admin/` (its own `(protected)` group), `(legal)/` (terms, privacy, PAIA, complaints, fees — statutory pages, treat as legal text), `a/[token]/` (SMS one-tap actions). |
| `components/` | ~80 shared components. `listing-card`, `filter-bar`, `bid-stepper`, `locker-picker`, `dealer-picker`, `photo-dropzone`, `bottom-tab-bar`, plus `admin/` and `ask-gg/` subtrees. |
| `lib/` | Client helpers. `api.ts` (the `apiFetch` wrapper), `safe-json.ts` (**use this** — a raw `res.json()` on an empty 200 throws, which caused a whole class of sign-up bugs), `cart-store.ts`, `use-push.ts`, `account-menu-data.tsx`, `support-contact.ts`. |
| `app/sw.ts` | Serwist service worker source, compiled to `public/sw.js` at build time only. Not active in dev. |

---

## Tests, typecheck, build

```bash
# backend — 67 unit spec files, jest + ts-jest, rooted at src/
cd backend
npm test                                   # jest
npm test -- auctions                       # one suite
npm run test:cov                           # coverage
npm run test:e2e                           # jest --config ./test/jest-e2e.json
npx tsc --noEmit -p tsconfig.build.json    # typecheck (there is no `typecheck` script)
npm run build                              # nest build → dist/
npm run lint                               # eslint --fix
```

```bash
# frontend — no test suite
cd frontend
npx tsc --noEmit    # typecheck
npm run build       # next build --webpack
npm run lint
```

The backend tests are unit tests over services with a mocked Prisma — they do not need a
database. The auction and offer engine specs (`auctions.service.spec.ts`,
`offers.service.spec.ts`) cover compare-and-set race guards on concurrent bids and offers;
if you edit those services, keep the CAS guards and keep those tests green.

`next build` catches App Router route collisions that `tsc` alone will not. Run it before
you push a routing change.

---

## Where to go next

| Document | What it is |
| --- | --- |
| [docs/INDEX.md](docs/INDEX.md) | Index of everything in `docs/`, and which root-level markdown files are current versus historical. Start here if a link below moves. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit: request path, the money state machine, the four selling modes end to end, background jobs, third-party integrations. |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable, what it does, what breaks when it's missing, and which are required in production. |
| [CLAUDE.md](CLAUDE.md) | 1,400 lines of **decisions and rules**, written for the AI agent that built this. Not an onboarding path and not always current, but it is the only record of *why* many things are the way they are — the payment-rail history, the legal constraints, the naming rules ("never say escrow", "never expose real names"). Read it second, and cross-check against the code. |
| `backend/prisma/schema.prisma` | The domain model, with comments explaining the constraints. |
| `backend/src/app.module.ts` | The real module index. |
| `frontend/middleware.ts` | The real routing and auth-gating index. |

### South African / domain glossary

| Term | Meaning |
| --- | --- |
| **SAPS** | South African Police Service. Firearms are licensed and their transfers registered through SAPS. |
| **Dealer transfer** | A firearm cannot legally move seller → buyer directly. It goes to a SAPS-licensed dealer, who handles the paperwork and hands it over. `Category.requiresLicence` forces this shipping path. |
| **SAP 534** | The SAPS form for a change of firearm ownership. We capture the serial number and licence details needed to complete it. |
| **KYC** | Know Your Customer — identity verification. Runs at a seller's first payment; a seller cannot be **paid out** until it passes. |
| **PUDO** | A South African parcel-locker network. Buyer and seller each use a locker; nobody exchanges an address. One of the two non-firearm shipping methods. |
| **TCG** | The Courier Guy — door-to-door courier, the other non-firearm option. |
| **Shipping methods** | `PUDO`, `TCG`, `DEALER_TRANSFER` (firearm, via a SAPS dealer), `PRIVATE_ARRANGE` (firearm, the pair go to a dealer themselves — requires seller consent), `COLLECTION` (buyer collects; forced for trailers and dangerous goods), `ON_SITE_SERVICE` (hunting packages — no parcel at all). Each one has different rules about when funds release. |
| **Bakkie** | Pickup truck. Ubiquitous here; a whole product category (canopies, drawer systems, roof racks, bull bars) exists around it under Overlanding. |
| **Take a Shot** | Our name for offers: the buyer names a price, the seller accepts, rejects or counters. |
| **Swop** | Trade. Two items exchange hands, optionally with a cash top-up. Both sides pay a leg fee and we manage both shipments. |
| **GG PRO** | The paid membership tier, R99/month. |
| **ZAR / cents** | Prices are stored as **integer cents** throughout. Peach speaks decimal rand, so the payment adapter converts at the boundary — that conversion is the single place the two representations meet. |
| **TPPP** | Third-Party Payment Provider. Holding buyer funds makes us one, which drives the bank onboarding, AML policy and statutory pages under `app/(legal)/`. |

---

## Rules that are not negotiable

- **Never commit a secret.** `.gitignore` excludes `.env`, `.env.*` and `*.env`, allowing
  only `.env.example`. Example files carry names, a description and a safe placeholder.
- **Never say "escrow."** Say "funds held" or "payment held". We are not a licensed escrow
  agent and the word creates a regulatory claim we cannot support.
- **Never expose a real name on a public surface.** Usernames only, no `@` prefix. The
  listing detail allowlist exists specifically to enforce this.
- **A new public page must be added to `isPublicRoute` in `frontend/middleware.ts`,** or it
  is invisible to signed-out visitors and to search engines.
- **A new category is members-only by default.** `publicVisible` is an opt-in allowlist and
  the seed guard will reject a weapon-named public category. If it fires, it is right.
