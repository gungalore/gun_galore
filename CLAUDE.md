# All Outdoor — Claude Code Context

## What This Is

**All Outdoor** (formerly Gun Galore) is South Africa's new-and-secondhand
outdoor store. Signed in, it is the full verified firearms, hunting and
outdoor marketplace it has always been.

The two audiences are the point — see **Public vs Members** below before
touching anything a signed-out visitor can reach.

Brand strings live in `frontend/lib/brand.ts` and `backend/src/common/brand.ts`.
Never hard-code the name. `GunGalore (Pty) Ltd` is the REGISTERED entity and
stays verbatim in the ECT § 43 footer; `gungalore.co.za` is still the live
domain (alloutdoor.co.za migration is planned, not done).

The platform is delivered as four modules, built in order. Each
module must be fully stable before the next begins:

- **M1 — Secondhand Marketplace** (build first)
- **M2 — Auctions**
- **M3 — New Store**
- **M4 — Swap**

This document is the single source of truth for Claude Code. It
records decisions and rules — not session history. When a decision
changes, edit the rule in place; do not append a narrative.

---

## Public vs Members — read before changing any public read path

Meta's crawlers and moderators were blocking the site, killing WhatsApp
Business comms. Regulated stock is now behind the login. Signed in, nothing
changed.

**This is an auth wall, NOT cloaking.** Every signed-out visitor gets identical
content regardless of user-agent. Never branch on user-agent, never special-case
a crawler. Serving a crawler something different from a logged-out human is what
turns a block into a permanent ban.

**The mechanism.** `Category.publicVisible` (source of truth) and
`Listing.publicVisible` (snapshot, set at create and re-snapshotted on category
change). Both `@default(false)` — an ALLOWLIST. A category added later is
invisible until someone publishes it, so the failure mode is "we forgot to show
the tents", never "we leaked the rifles". Keep it that way.

**Public roots:** camping-outdoor, overlanding, fishing, optics, knives,
hunting, archery-bowhunting, paintball, cleaning-equipment,
outdoor-clothing-footwear.
**Members-only roots:** firearms, gun-smithing-parts, reloading-components,
reloading-equipment, air-rifles, self-defence, shooting-accessories, ammo.
**Carve-outs** (`membersOnly: true` on a child of a public parent):
archery--crossbows, optics--{rifle,handgun,rimfire-rifle,rangefinding-rifle,
air-rifle}-scopes, hunting--shooting-sticks-and-bipods.

**Rules when touching this:**

- Anonymity comes from `OptionalClerkGuard` (never rejects, stamps
  `request.clerkUserId`). A public read path with NO guard at all is a leak —
  `categories.controller.ts` was exactly that.
- Adding a new public read path? It must go through the same gate. Grep
  `publicOnly(` in `listings.service.ts` for every existing site. Remember the
  non-obvious ones: the featured rail (renders on EVERY page), seller reviews
  (they embed listing titles), and the Ask Boet guide.
- `findById` returns **404**, not 403 and not a "sign in to view" page — that
  would confirm the item exists.
- **Never `revalidate`/`force-cache` a fetch whose result varies by viewer.**
  Next's data cache is SHARED and the browser HTTP cache keys on URL, not on the
  auth header — either one will serve one audience's catalogue to the other. Use
  `viewerFetch` / `useViewerFetch` (both force `no-store` and forward the token).
- `sitemap.ts` must stay **anonymous and uncached** (`force-dynamic`). Adding a
  token there republishes the whole firearm taxonomy. `revalidate` there is also
  wrong for a second reason: Next's fetch cache lives in `.next/cache` and
  survives a rebuild, so a deploy prerenders the file from a pre-deploy snapshot.
- **No weapon word may appear in a public category name or slug.** A gate that
  hides the Firearms tree but publishes `optics--handgun-scopes` has not done its
  job — the scanner reads the URL, not the intent. `assertNoWeaponWordInPublic`
  in `prisma/seed.ts` fails the seed if you try. To publish something it matches,
  rename the category to what it actually is; do not weaken the pattern.
- `publicVisible` must be in `STATIC_LISTING_FILTERABLE_ATTRIBUTES` or Meili
  rejects the anonymous query outright.

**Ammunition is banned outright** — never listed, sold or traded, and the site
says so publicly. Reloading components remain listable but members-only.

`backend/src/listings/public-visibility.spec.ts` locks all of this. If a change
makes those tests fail, the change is wrong.

---

## COMMAND: "deploy now"

When the user types **"deploy now"**, execute this full sequence in
order. Do not skip steps. Report the result of each step before
moving to the next. If any step fails, STOP immediately, report
exactly what failed, and wait for the user's instruction.

**Deploy branch (LOCKED).** Production tracks
`feat/hunt-ballistics-range-estimator`, **NOT `main`**. Do NOT
`git checkout main`, do NOT merge into main, do NOT push to main.
Push the current feature branch and `git pull --ff-only` it on
prod. (`main` is intentionally stale until a future re-baseline.)

**NOTE ON pm2 COMMANDS**
Always use `pm2 reload [service] --update-env` for deployments.
This is a zero-downtime rolling restart — the old process keeps
serving traffic until the new one is ready. Only use `pm2 restart`
if a process is completely frozen, a reload has hung past 60
seconds, or you are explicitly told to do a hard restart to clear
corrupted state. Never use `pm2 restart` in an automated deploy.

**STEP 1 — VERIFY CODE IS CLEAN**
`cd backend && npx tsc --noEmit`
`cd ../frontend && npx tsc --noEmit`
Both must report zero errors. If errors exist, stop, fix them,
restart from Step 1.

**STEP 2 — PRODUCTION BUILD CHECK**
`cd frontend && npm run build`
Must complete with all pages building. If it fails, stop, fix it,
restart from Step 1.

**STEP 3 — COMMIT TO GIT**
`cd` to project root, `git add .`, `git status` (show what is being
committed), `git commit -m "[clear, specific message describing the
session's changes]"`.

**STEP 4 — PUSH TO GITHUB**
`git push origin feat/hunt-ballistics-range-estimator`.
Confirm the push succeeded. Do NOT touch main.

**STEP 5 — DEPLOY TO SERVER**
SSH alias: `ssh gungalore` (server IP `<ORIGIN_IP — see password manager>`, user
`gungalore`, Vultr VPS). Project lives at `/home/gungalore/app`,
pm2 services are named `gungalore-backend` and `gungalore-frontend`.

If prod has uncommitted local changes (legacy from the earlier
SCP-staged workflow), stash them first so `git pull` doesn't
abort. They're already in the deployed branch from the dev
commits — safe to discard via stash.

**SCHEMA-DRIFT TRAP (DO NOT FORGET).** Three services (Ask GG KB,
reloading-manual FTS, listings FTS) add `tsvector GENERATED` columns
+ GIN indexes at boot via raw DDL. These columns are NOT in
`schema.prisma`. Running `npx prisma db push --accept-data-loss`
will drop them and the next boot won't recreate the indexes
cleanly. **For routine deploys, do NOT run db push.** Only run
`npx prisma generate` (regenerates the client from the existing
schema, no DB writes). When schema.prisma genuinely changes, write
a real migration and use `npx prisma migrate deploy`. See
`[BC-SCHEMA-DRIFT]` in LAUNCH-CHECKLIST.md.

```
cd /home/gungalore/app
git stash --include-untracked            # parks any legacy local edits
git pull --ff-only origin feat/hunt-ballistics-range-estimator
cd backend
npm install                              # in case package.json shifted
npx prisma generate                      # regenerate client only — NEVER db push (tsvector trap)
npm run build
pm2 reload gungalore-backend --update-env
sleep 5
curl -f http://localhost:3001/api/health && echo "BACKEND OK"
cd ../frontend
npm install
npm run build
pm2 reload gungalore-frontend --update-env
sleep 5
curl -fs http://localhost:3000 > /dev/null && echo "FRONTEND OK"
pm2 list
```

**Critical gotcha** (cost us a half-deploy on 2026-05-26): `nest
build` will report TypeScript errors against stale Prisma types
and `pm2 reload` will silently reload the OLD compiled dist/. So
ALWAYS run `npx prisma generate` BEFORE `npm run build` whenever
the schema has changed, and watch the build output for TS errors
— if you see any, the backend did NOT actually update.

If a health check fails after a reload: do NOT attempt `pm2 restart`
automatically; stop the deploy immediately and report. The old
version keeps serving on a failed reload, so there is no emergency.

**STEP 6 — VERIFY HEALTH**
Confirm `curl localhost:3001/api/health` and `localhost:3000` both
respond, and `pm2 list` shows both services online.

**STEP 7 — UPDATE BUILD STATUS**
Update the "Current Status" section at the bottom of this file.

**STEP 8 — COMMIT THE STATUS UPDATE**
Commit and push the CLAUDE.md change.

**STEP 9 — FINAL REPORT**
Summarise what was deployed and the health-check result.

`pm2 save` and `pm2 startup` are configured so services auto-start
on reboot.

---

## Working Method — Opus Review + Claude Code Loop

This project is built with a two-role pattern. Keep to it:

- **Planning / review (Opus):** specs each phase, writes the build
  prompt, and reviews completed work before it is committed.
- **Execution (Claude Code):** implements one phase at a time from
  the written prompt.

Build one phase at a time. A phase is not "done" until it is
reviewed, type-checks clean, and builds. Do not start the next
phase until the current one is stable. Feature flags keep
unfinished modules dark in production (see Feature Flags).

---

## Tech Stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind
- **Backend:** NestJS + TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Search:** Meilisearch
- **Auth:** Clerk (buyers + sellers); custom JWT (admin)
- **Images:** Cloudinary
- **SMS:** SMSPortal
- **Email:** Resend
- **KYC:** VerifyNow
- **Shipping:** Pudo (lockers) + The Courier Guy / TCG (door).
  **Bob Go** is replacing BOTH — built and deployed but INERT behind the
  `bobgo_enabled` flag (default OFF). It sits behind the EXISTING enum
  slots: `PUDO` = pickup-point, `TCG` = door. So `shippingMethod` now
  names the SHAPE of the delivery, not the company; route post-booking
  work on `Transaction.carrierProvider`. ⚠️ Bob Go answers **HTTP 201
  before a courier has agreed** — every booking starts unconfirmed
  (`pending-rates`). Branch on `submission`, never on "it didn't throw".
  See `BOBGO-MIGRATION.md`.
- **Payments:** **Peach Payments** — Checkout V2 + Payouts + BANV.
  Deployed but INERT until `PEACH_*` creds are set and
  `PAYMENT_MODE=paygate` + `PAYMENTS_LIVE=true`. See
  `payments/peach.service.ts`, `PeachModule`, and the four `peach*`
  columns on `Transaction`.

  > ⚠️ This line used to read "Stitch Express (only) … do NOT
  > reintroduce Peach", which has been backwards since 2026-07-23.
  > Stitch was evaluated and dropped; Peach is the rail. A developer
  > trusting the old text would rip out the live payment integration.
  > `STITCH_CLIENT_ID` / `STITCH_CLIENT_SECRET` still sit in the env
  > as dead vars, and a stale comment at
  > `payments/transactions.service.ts:65` still says "the gateway is
  > now Stitch" — both are leftovers, not instructions.
- **AI:** Anthropic API (listing moderation, Ask GG, ballistic
  bullet lookup, listing-quality scoring)
- **Accounting:** Zoho Books (live); Odoo planning is archived
- **Hosting:** Vultr VPS — Nginx + PM2 (NOT
  Hetzner — operator has corrected this multiple times)
- **Error monitoring:** Sentry
- **Uptime monitoring:** UptimeRobot

**Ports:** 3000 frontend, 3001 backend, 5432 PostgreSQL,
7700 Meilisearch.

---

## Server Layout (Vultr)

- App lives at `/home/gungalore/app` on the Vultr VPS
  (`<ORIGIN_IP — see password manager>`). SSH via the `gungalore` alias only —
  `ssh gungalore` works, `ssh gungalore@<ORIGIN_IP — see password manager>` bypasses
  the operator's local key config and prompts for a password they
  don't have.
- The marketing landing page at `/var/www/html` is separate —
  **never touch it**.
- Production: `gungalore.co.za` / `api.gungalore.co.za`.
- Ballistic Calculator is its own app on the same VPS — code lives
  at `~/ballistics-app/` (own Postgres DB, own pm2 services, own
  Nginx block at `ballistics.gungalore.co.za`). The marketplace
  stays the marketplace; ballistics is independent.
- Short-link domain: `gg.co.za` (for SMS action links).
- Staging not currently provisioned — work hits prod after local
  build + type-check passes. Re-evaluate before public launch.

---

## Environment Variables & Secrets — Absolute Rule

**Secrets live only in `.env` files. Never anywhere else.**

- `.gitignore` excluding `.env`, `.env.local`, and any credential
  files MUST be the first commit of the new repository, before any
  secret exists near the project.
- Never paste a secret value into this file, into a prompt, into a
  commit message, or into chat. This file references variable
  **names** only.
- If a secret is ever exposed, treat it as compromised and rotate
  it immediately.

**Variable names used by the project (values come from `.env`):**

Frontend (`.env.local`): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
`NEXT_PUBLIC_CLERK_SIGN_UP_URL`,
`NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`,
`NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`, `NEXT_PUBLIC_API_URL`.

Backend (`.env`): `DATABASE_URL`, `CLERK_SECRET_KEY`,
`CLERK_WEBHOOK_SECRET`, `JWT_ADMIN_SECRET`, `VERIFYNOW_API_KEY`,
`VERIFYNOW_BASE_URL`, `ANTHROPIC_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
`MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`, `SMSPORTAL_CLIENT_ID`,
`SMSPORTAL_API_SECRET`, `RESEND_API_KEY`, `PUDO_API_KEY`,
`TCG_API_KEY`, `TCG_WEBHOOK_SECRET`, `BOBGO_API_KEY`,
`BOBGO_BASE_URL`, `BOBGO_WEBHOOK_SECRET`, `GOOGLE_MAPS_API_KEY`,
`ODOO_API_KEY`, `ODOO_URL`, `ODOO_DB`, `PEACH_ENTITY_ID`,
`PEACH_ACCESS_TOKEN`, `PEACH_BASE_URL`.

The `deploy now` webhook prompts may auto-read `TCG_WEBHOOK_SECRET`
from the server `.env` — that is fine; it is read on the server,
never printed.

---

## Absolute Rules — Never Break These

1. **The word "escrow" never appears anywhere** — not in code, UI,
   comments, or docs. Use: `paymentStatus`, "funds held", "payment
   protected", "payment released".
2. **Firearms and barrels are dealer transfer ONLY.** No courier,
   no Pudo locker, no meet-up — ever. This is hardcoded; the backend
   forces it regardless of any UI input.
3. **Air rifles are NOT firearms** under SA law. No licence needed;
   they ship as a normal accessory. Category slug: `air-rifles`.
4. **Every notification fires on both channels** — SMS (SMSPortal)
   and email (Resend) — simultaneously, for every notifiable event.
5. **KYC is a seller-only gate** (see KYC Policy). No code path may
   check `kycStatus` on a user who is buying, bidding, or making an
   offer.
6. **Live ammunition, primers and propellant are banned
   platform-wide.** Empty/once-fired brass and projectiles/bullets
   are allowed.
7. **Never name a competitor** in any user-facing copy (see
   Marketing).
8. Feature flags stay `false` until a module is fully ready.
9. **No wallet.** There is no user balance, stored credit, or
   ledger. All money moves per-transaction through the paygate.
10. **No public seller profile page** and **no dealer directory
    page.** Seller reputation surfaces only as the tier badge and
    rating on the listing itself.
11. **Never expose real names to other users.** All public-facing
    surfaces (bid history, listing seller card, offers, reviews,
    Q&A, featured-slot occupants, "high bidder" displays, /my/sales
    buyer attribution) show the user's `username` only — never
    `firstName` / `lastName` / initials, never with an `@` prefix.
    Real names exist only inside KYC flows, paid-transaction
    internals (dealer transfer paperwork, dispatch addresses),
    PRIVATE_ARRANGE post-consent contact-reveal, admin panels, and
    the signed-in user seeing their own data. Fallback for users
    without a username: "Anonymous bidder" / "Anonymous seller" —
    never a first name. Usernames exist specifically to stop
    platform users finding each other on social media and bypassing
    Gun Galore.

---

## The Four Modules

| Module | Name | Notes |
|--------|------|-------|
| M1 | Secondhand Marketplace | Buy Now + Take a Shot listings. Build first. |
| M2 | Auctions | Full proxy-bid auction system. |
| M3 | New Store | New-goods retail store. |
| M4 | Swap | Item-for-item swap module. |

Listing types across the platform: `BUY_NOW`, `AUCTION`,
`TAKE_A_SHOT`.

---

## Build Roadmap (Phased)

Build in this order. Each phase is specced, built, reviewed, and
stabilised before the next.

1. **Foundation** — repo, `.gitignore`, Next.js + NestJS scaffold,
   Prisma schema, Postgres, Clerk auth, Meilisearch, Cloudinary.
2. **M1 Listings** — create/edit/browse/search listings, listing
   detail, categories, photos, listing-quality scoring.
3. **Shipping** — Pudo locker API (L2L, ~2,700 lockers, 24h cache),
   TCG door API, dealer-transfer routing for firearms, buyer
   delivery-address collection, address standardisation.
4. **Payments** — Peach Checkout V2 hosted checkout,
   `PaymentStatus` flow, commission calculation, seller payouts,
   penalties.
5. **Messaging** — buyer↔seller threaded chat scoped per
   transaction, with Claude moderation.
6. **Ratings & Trust** — ratings, private Trust Score, seller
   tiers.
7. **Admin Panel** — Superadmin/Admin roles, verification queue,
   moderation queue, overrides.
8. **KYC** — VerifyNow seller verification, bank verification.
9. **Notifications** — SMSPortal + Resend on every event;
   single-use SMS action tokens.
10. **M2 Auctions** — proxy bidding, increments, snipe protection,
    Buy Now, reserve, strikes.
11. **Take a Shot** — confidential offers flow.
12. **Claude AI Listing Moderation** — every new listing reviewed
    by Claude before going live.
13. **Webhooks** — TCG + Pudo shipping webhooks.
14. **PWA Phases A–C** — installability + icons + conservative SW
    with offline fallback (done; see PWA section for state).
15. **SEO**.
16. **Odoo accounting integration**.
17. **M3 New Store**, then **M4 Swap** — after M1/M2 are live and
    stable.

PWA Phase D (web push notifications) and Phase E (install-prompt
UX polish, image + API caching strategies layered onto the
conservative SW) are deferred to their own later phases.

---

## UI Design — Apply to Every Screen

The visual reference is the **Claude Design handoff mockup** (dark
theme, in the `gun-galore-website` bundle). Recreate it
pixel-perfectly in React/Next.js. Match the visual output; do not
copy the prototype's internal structure.

**Design tokens** (canonical file: `colors_and_type.css` from the
handoff; mirror into `/docs/design/`):

- **Surfaces:** bg `#0f0f0f`, deep bg `#0a0a0a`, card `#1a1a1a`,
  card hover `#202020`, inset `#131313`.
- **Borders:** `#2a2a2a` (0.5px card borders), hover `#3a3a3a`,
  dividers `#1e1e1e`. All borders are 0.5px solid (1px + `scale(.5)`
  fallback if 0.5px is not honoured).
- **Brand red `#C8102E`** (hover `#a00d24`) — the only chromatic
  colour. Used ONLY for: prices, primary CTAs, active states, the
  logo dot, and live badges. Nowhere else.
- **Text:** `#f5f5f5` primary, `#a0a0a0` secondary, `#6b6b6b`
  tertiary.
- **Status:** success `#2f9e6b`, warning `#d49a3a`.
- **Type:** system font stack. Weights **400 and 500 ONLY** — never
  600/700. Letter-spacing −0.01em body.
- **No gradients. No drop shadows. No glow.**
- **Border-radius max 8px** (cards/buttons/inputs 6px; photo badges
  4px; tiny tags / verified pill 3px; sell CTA banner 8px).
- **Mobile-first**, ~390px base; content max-width 1280px.

**Listing card:** 4:3 photo, category badge top-left, condition
badge top-right, price in red, seller tier badge + rating.

**Navigation:** sticky top bar — logo + primary nav (Home, Sell,
and when signed in: Your bids, Transactions, Messages
icon with unread badge, avatar → dashboard). A module launcher
offers Marketplace / Auctions. Primary nav is always
visible, never hidden in a hamburger on desktop.

**Routes from the mockup that are NOT built:** `wallet`, `seller`,
`dealers` — these features are dropped. Every other route maps to a
feature in this document.

### Page background + reveal animation (HOUSE STANDARD)

Every signed-in page (Sell, Profile, Edit Profile, surface views like
Marketplace/Auctions/Take a Shot, Dashboard, all
sub-pages we add later) wraps its `<main>` with these two components:

```tsx
<main className="relative ..." style={{ zIndex: 1 }}>
  <PageBackground imageSrc="/<scene>.jpg" opacity={0.18} />
  <PageReveal>
    {/* sections, each with `data-reveal` */}
  </PageReveal>
</main>
```

- `<PageBackground>` is a faint full-viewport photo with a dark tint
  and radial vignette. Use whichever scene fits the route (`/setting.jpg`
  for settings, `/marketplace.jpg` for the marketplace surface, etc.).
  Opacity `0.18` is the house value — don't bump without a reason.
- `<PageReveal>` defaults to `delay=0.5`, `duration=2.5`, `variant="random"`.
  Don't pass these unless a specific page needs to override. The random
  variant means the user sees a fresh keyframe (`slide-up`,
  `scale-in`, `slide-right`, or `blur-in`) per page-load.
- Mark every direct-child block that should animate with the
  `data-reveal` attribute. The scoped CSS matches by `:nth-of-type` and
  ramps each element's `animation-delay` by `stagger` (default 0.18s).

---

## Logo Rules — Never Break These

- The **All Outdoor** wordmark is operator-supplied artwork (2026-08-12), traced
  to vector: Table Mountain, a kudu, a bakkie and an acacia over the ALL Outdoor
  lockup. Four files, all the SAME 56 paths:
  - `logo.svg` — **PRIMARY**, warm off-white `#f0ede4`. The UI is DARK-ONLY
    (`--bg #0f0f0f`), so the operator's dark green would be invisible on it.
    Use it where the mark is drawn **≥120px tall**: the hero, share cards, print.
  - `logo-nav.svg` — the **wordmark only**, 2.66:1. Use it everywhere the mark
    is drawn SMALL: nav bar (36px mobile / 44px desktop), nav drawer, checkout
    header, sign-in, sign-up, error, not-found, offline, KYC, profile edit.
    Windowed out of the same artwork by **two** nested `<svg>` viewports —
    "ALL" and "Outdoor" separately, because the scene sits in the gap between
    them and no single rectangle isolates the type.
  - `logo-dark.svg` — the original green `#3c4227`, for LIGHT surfaces only
    (print, documents). Not used anywhere in the app today.
  - `logo-mark.svg` — the square icon tile. Table Mountain + kudu + bakkie,
    cut out by **viewBox only** so it can never drift from the wordmark.
- ⚠️ **Never render `logo.svg` small.** It is 1.5:1, so at a 36px height it
  draws 54px wide and the wordmark lands at ~7px — an illegible smudge. This
  shipped on every page for a while before anyone measured it. Small = `logo-nav.svg`.
- The only text-free window in the artwork is **x 634–1134, y 240–700**: "ALL"
  ends at x=624 and "Outdoor" occupies everything below y=700 out to x=1134.
  Any new crop must stay inside it. Measure a new crop by rasterising the band
  and scanning pixel rows — the bounds in `logo-nav.svg`'s header were once off
  by a unit and opened a window inside the artwork.
- A nested `<svg>` clips to its **viewport, not its viewBox**. Size the viewport
  to the viewBox aspect or letterboxing reveals the artwork sitting alongside —
  the first cut of the mark rendered a stray "L".
- `favicon.ico`'s 16/32/48 frames are a **simplified Table Mountain silhouette**,
  not the full mark: traced line art dissolves below ~64px. 64/128/256 carry the
  real mark.
- ⚠️ The artwork contains a recognisable **Toyota Hilux with the Toyota badge and
  HILUX wordmark** — a third party's trademark inside our logo. A legal question
  for the operator, not a code one. Flagged, not changed.
- The old Gun Galore mark set the wordmark inside a
  **bullet/cartridge outline** — a firearm motif on every page, in the app icon
  and in every share unfurl. Never reinstate it, and keep any replacement free of
  weapon imagery: the logo is the one asset that appears everywhere, including in
  contexts the auth wall does not cover.
- The eight PNG icons in `frontend/public/` are generated from these. Regenerate
  all of them together or the install prompt and the tab icon disagree.
- `app/manifest.ts` has NO screenshots. The three that were there were live prod
  captures showing the old logo and hero, displayed full size in Android's
  install dialog. Recapture SIGNED OUT before re-adding.
- On centred pages: width 100%, max-width 300px, never a fixed
  height (preserve the 5:1 ratio).
- In the nav bar: 44px tall, top-left.
- Module marks (`marketplace-logo.svg`, `auction-logo.svg`,
  `used-marketplace-logo.svg`) are used as-is.

---

## Commission Model

Marginal tiers, tax-bracket style — implemented in
`backend/src/payments/fee.calculator.ts`. Reduced 2026-05-20 by 1pp
across the board and a R30 minimum platform fee was added.

| Band | Rate |
|------|------|
| First R5,000 | 9% |
| R5,001 – R20,000 | 7% |
| R20,001 – R100,000 | 5% |
| Above R100,000 | 3% |

- **Minimum platform fee:** R10 per sale (lowered from R30 on
  2026-08-15 — R30 existed to cover VerifyNow KYC at ~R28/seller, a
  cost that no longer exists). Floor never exceeds the listing price
  itself. Under the markup model the floor is VISIBLE on the price
  tag: a R50 ask lists at R64.14 (was R84.94 at the old floor).

### BUY NOW — the fee is built INTO the price (operator 2026-08-15)

**The seller lists for free and receives their full asking price.** Our
commission and the Peach fee are added ON TOP to produce the price the
buyer sees. Same percentages, opposite direction from the old model.

```
ask                                    R450.00   Listing.sellerAskCents
+ commission (bands above, min R30)    R 40.50
= subtotal                             R490.50
+ Peach on the subtotal                R 21.47   (4.025% + R1.73 incl VAT)
= Listing.price                        R511.97   what the buyer sees & pays
```

- `Listing.price` keeps its meaning: **the buyer-facing price**. Every
  card, search result, PDP and cart reads it unchanged.
- `Listing.sellerAskCents` is the seller's take-home. **OWNER-GATED —
  never add it to `PUBLIC_LISTING_SELECT`**, it is our margin per item.
- `POST /listings` still takes `price`; for BUY_NOW that field MEANS the
  ask and the server marks it up. Never send a marked-up number.
- Checkout uses `FeeCalculator.breakdownBuyNow()` and recomputes FORWARD
  from the ask — the markup is banded, floored and Top-Seller-discounted,
  so it is not reliably invertible.
- Multi-buy is priced PER UNIT and multiplied. Re-banding the line would
  make two cost less than twice the card price.
- **Nothing is added at checkout but delivery.** No processing-fee row
  on a Buy Now order summary — it is already inside the price and a row
  would double-count it to the reader.
- **Delivery carries a 10% margin** (was a flat R15/waybill; changed
  2026-08-15). It is QUOTED INCLUSIVE — the buyer sees ONE delivery
  figure in the picker and pays exactly that. Never render it as
  "quote + 10%" or as a separate Handling row. The split is kept
  server-side only (`Transaction.shippingCost` = carrier remittance,
  `shippingHandlingCents` = ours) because they are different
  obligations at payout. The gateway fee is charged on the item plus
  the CARRIER rate — never on our own delivery margin, which is why
  `/shipping/delivery-options` also returns `carrierRateCents`.
- The compare-at ("was") price validates against the MARKED-UP price, not
  the ask. Otherwise a "was" could sit below the live price — a
  misleading discount claim under CPA s41.
- Known residual: Peach bills on the final amount, not the subtotal we
  mark up, so ~R0.86 per R450 sale is unrecovered (0.17%). Pinned by test.

### AUCTIONS & OFFERS — unchanged direction

A bid discovers the price, so there is nothing to mark up.

- Commission is **deducted from the seller** exactly as before.
- The **BUYER pays the gateway fee**, surfaced as a **"Transaction fee"**
  row. Never label it "processing fee" or "service fee".
- Top Seller tier gets a 0.5% commission discount. Under the Buy Now
  markup that discount now surfaces as a CHEAPER listing rather than a
  bigger payout, since the seller already receives 100%.
- **Buy Now ON AN AUCTION follows the AUCTION rules** (operator
  2026-08-15) — not marked up, commission out of the seller, buyer pays
  the Transaction fee. `Listing.buyNowPrice` is stored and validated
  but nothing purchases it yet; the rule is recorded on the schema
  field and at the fee branch for whoever builds it.

---

## Seller Tiers, Trust Score & Penalties (LOCKED)

**Tiers** (auto-upgrade; reputation badge only; do NOT cap listing
volume; no upfront deposit):

- **New** — 0 sales
- **Established** — 3+ sales, 50+ score
- **Trusted** — 10+ sales, 70+ score
- **Top Seller** — 25+ sales, 85+ score (0.5% commission discount)
- **Dealer** — admin-set, sticky

**Private Trust Score (0–100)** — visible only on the seller's own
dashboard. Never shown publicly. Components: completed sales 25,
rating average 25, delivery success 20, confirmation speed 15,
listing quality 10 (Claude assessment), account age 5.

**Cancellation penalty escalation** — applied only AFTER a failure,
each requiring admin approval. All of the seller's listings are
suspended until the fine is paid (via the paygate or deducted from
the next payout):

- 1st failure within 6 months — R150
- 2nd — R300 + tier reset to New
- 3rd — permanent ban

---

## KYC Policy (LOCKED)

KYC is a **seller-only gate**.

- Buyers, bidders and offer-makers **never** need KYC to transact —
  anywhere, in any module.
- Seller KYC is triggered ONLY at `sellerConfirmSale()` in
  `payments.service.ts`, after Peach confirms payment. The
  equivalent gate for Take a Shot is in `offers.service.ts` →
  `acceptOffer()`. **Not** at listing submission.
- Bank-account verification happens at first payout.
- Never use the word "KYC" in user-facing text — use "Verified" /
  "Verification".

---

## Payments

**Provider: Peach Payments.** Checkout V2 (pay-in) + Payouts + BANV.

> ⚠️ **This section said the opposite until 2026-08-12** — "Stitch
> Express only … Peach is the rejected legacy provider". That was
> backwards from 2026-07-23 onward and a developer trusting it would
> have deleted the live integration. It nearly happened. **There is no
> Stitch code in this repo**: no service, no module, no webhook route.
> `src/payments/` contains `peach.service.ts`, `peach.module.ts`,
> `peach-signature.ts`, `peach-banks.ts`. If you find "Stitch" anywhere
> outside a historical note, it is a leftover, not an instruction.

Stitch was evaluated and dropped. PayFast, Ozow, iKhokha, Yoco, KoraPay
and direct bank APIs are also rejected. `STITCH_CLIENT_ID` /
`STITCH_CLIENT_SECRET` still sit in the env as dead vars.

**Deployed but INERT.** The site is not trading. Manual EFT was stripped
2026-07-16 and checkout returns 503. Two gates in
`src/payments/payment-mode.ts`: `PAYMENT_MODE=paygate` and
`PAYMENTS_LIVE=true` (`assertPaymentsLive()` guards every entry point).
Without `PEACH_*` creds the service runs as a mock. Go-live = creds +
both flags.

**NEVER use the word "escrow"** in user-facing copy, internal copy,
or notifications. It is a regulated SA financial term All Outdoor is
not registered for. Use "funds held" / "payment held" / "held until
delivery confirmed" instead. This applies everywhere — Terms,
listing detail, transaction page, emails, SMS, admin panel.

**Peach integration shape** (`peach.service.ts`):

- **Pay-in:** `createCheckout()` → Peach Checkout V2 → buyer pays →
  `/checkout/complete?id=…` → `getPaymentStatus(checkoutId)` verifies
  AND matches the bound transaction + amount → flip `PaymentStatus`.
  DECIMAL ZAR on pay-in, integer cents on payouts — don't mix them.
- **Webhooks:** four routes on `transactions.controller.ts`, all
  fail-closed (bad signature = 401, no DB writes):
  `/api/payments/webhook/peach` (payment),
  `/webhook/peach-dispute`, `/webhook/peach-banv`, `/webhook/peach-payout`.
  HMAC verified by `peach-signature.ts` (golden-vector tested; the
  raw-vs-hex key question is unresolved until the first sandbox txn).
- **Idempotency columns on `Transaction`:** `peachPaymentId`,
  `peachCheckoutId`, `peachMerchantRef`, `peachPayoutId` — each
  `@unique` to block replay — plus `peachResultCode`.
- **Pay-out:** `createPayout()` to the seller's verified bank account.
  Triggered on dealer-verification APPROVED (firearms) or buyer
  Confirm-Delivery (non-firearms). See dealer-verification flow.
- **Refunds:** `peach.refundPayment(...)` is called BEFORE flipping the
  row to `REFUNDED`. Money moves first, ledger flips second — never the
  other way around.
- **`PaymentStatus` enum:** `HELD`, `PENDING_ADMIN_VERIFICATION`,
  `RELEASED`, `DISPUTED`, `REFUNDED`.
- **3DS/OTP:** Peach handles cardholder authentication on its hosted
  page. Buyer is always present (cardholder-initiated, no
  recurring/tokenisation in scope for v1).
- **Bank verification: MANUAL today.** Peach BANV (`verifyBankAccount`,
  `getBankVerificationResult`, `parseBanvWebhook`) is built and deployed
  but **inert** — `isBanvEnabled()` gates it, and once live
  `bankVerifiedAt` gates payouts. Until then `completeProfile` captures
  bank details as entered (`bankVerifiedAt: null`, `bankAvsResult: null`)
  and an **admin reviews the bank-holder name against the KYC-verified
  identity by hand before the first payout**. VerifyNow does ID lookup +
  face-match (KYC) only, never bank AVS. **Do not claim automated AVS in
  any user-facing copy** until BANV is switched on — the legal pages say
  "manual review before first payout" (memory: `project_avs_kyc_ordering`).
- **`VERIFYNOW_MODE=production`** at boot — asserted by config
  guard; sandbox is rejected outside dev. Operator memory:
  `feedback_env_mode_changes` — never flip sandbox↔production
  without explicit confirmation.
- `scripts/stitch-redirect-setup.cjs` is **dead** — a leftover from the
  evaluation. Peach redirect URLs are configured in the Peach dashboard.

**Prohibited:** never enter or store raw card/bank numbers. If a
user pastes card details into chat or a form, refuse and instruct
them to enter it themselves on the Peach hosted page.

---

## Shipping Rules

- **Firearms / barrels:** dealer transfer ONLY. Buyer selects their
  receiving SAPS-licensed dealer during checkout. No courier, no
  locker, no meet-up. Backend enforces this.
- **Non-firearms:** Pudo locker-to-locker or TCG door delivery.
- Local meet-up is retired — the backend forces
  `offersLocalMeetup: false`.
- Pudo: live locker API, locker-to-locker model, ~2,700 lockers,
  24-hour cache. TCG: live door API.
- Buyer delivery address is collected in the buy flow; addresses
  are standardised.

---

## Listing Rules

- Required firearm fields: as defined in the listing schema
  (make, model, calibre, condition, type, etc.).
- One seller may not post duplicate listings of the same item.
- Every listing needs real, seller-supplied photos — no stock or
  watermarked images.
- New listings are reviewed by Claude before going live (see Claude
  AI Listing Moderation).

**Listing expiry (LOCKED — Buy Now / Take a Shot only):**

- A listing expires **60 days** after it goes live. Set an
  `expiresAt` timestamp at publish.
- A daily cron flips expired listings to state `EXPIRED`.
- The `listing-expiring` email fires at **day 53** (7-day warning);
  `listing-expired` fires at expiry. Both SMS + email per the
  notification rule.
- The seller can relist from an expired listing.
- Auctions are NOT subject to this — they have
  their own fixed end times. The 60-day rule applies only to
  `BUY_NOW` and `TAKE_A_SHOT` listings.

---

## Auction System (M2)

- **Creation:** starting bid, optional hidden reserve, duration
  3/5/7/14 days, optional Buy Now price, optional Featured (R150).
- **Proxy bidding:** buyer sets a MAX bid; the system bids the
  minimum increment on their behalf and auto-counters up to that
  max. `maxAmount` is never exposed publicly.
- **Increments** (tiered by current bid level): R50 / R100 / R250 /
  R500 / R1,000.
- **Snipe protection:** a bid in the final 2 minutes extends
  `endTime` by 2 minutes; repeats as needed.
- **Buy Now** is available only while the auction has zero bids.
- **`reserveMet`** flips true when `currentBid >= reservePrice`; the
  reserve amount is never shown.
- **Auction end** (cron, every minute): reserve met → highest
  bidder wins, 24h to pay; reserve not met → seller may accept /
  counter / relist; no bids → seller relists.
- **Non-payment** → strike; the offer passes to the next bidder
  above reserve only. Three strikes → suspension.
- Watchlist + alerts supported.

### Proxy resolution rules (LOCKED)

- **eBay-style dual-row history.** When a bid triggers an existing
  proxy to counter, the system writes TWO `Bid` rows in the same
  transaction: the new bidder's actual attempt + a separate row for
  the proxy holder's auto-counter (attributed to them, not the
  loser). Symmetrically, when a new bidder beats an existing proxy,
  the system writes the loser's "last stand" row at their max
  BEFORE the winner's row. `bidCount` increments by 2 on dual-row
  events so the count matches visible rows. Legacy pre-fix rows
  (where `amount > maxAmount`) are detectable via the
  `wasCountered` flag exposed in the auction state API.
- **One-shot ("Place Bid") respects existing proxies.** Posting
  R150 cannot defeat a stored max of R500 — the proxy auto-counters
  and the one-shot bidder is outbid at the visible amount the
  proxy can reach. Place Bid only wins if its amount strictly
  exceeds `prevHighMax`.
- **Ties (equal max) go to the earlier bidder.** Falls through to
  the proxy-counter branch; both rows recorded at the tied amount.
- **OUTBID banner** on listing detail when the signed-in user
  previously bid but is no longer the high bidder. Copy
  distinguishes "matched your max — ties go to whoever bid first"
  vs "went above your max", so the user knows which raise will help.
- **Cancel proxy:** `POST /api/auctions/:listingId/cancel-proxy`
  writes a new Bid row with `amount = maxAmount = current visible`,
  leaving the user as high bidder but with zero proxy headroom.
  Reversible — they re-raise via Auto Bid.
- **Per-user proxy state:** `GET /api/auctions/:listingId/me`
  returns `{ hasBid, maxAmount, isHighBidder, proxyActive }`.
  Drives the green "Auto Bid · ACTIVE · R{maxAmount} (Raise)"
  button label on the listing detail page.
- **Current high bidder name** is included in `getAuctionState`
  response as `currentBidderName` (username only — never real name).
  Drives the "High bidder: You ✓ / @username" line under the
  current bid amount.

---

## Featured Slots (Ad Surface)

A paid placement system, separate from the M2 auction module —
sellers bid for one of 10 rotating advertising slots that surface
on every browse page (rail) and the homepage. Built across
`backend/src/featured/` + `frontend/app/featured/` +
`frontend/components/featured-rail.tsx`.

### Slot lifecycle

`VACANT → AUCTION_RUNNING → BIND_WINDOW → OCCUPIED → VACANT` —
managed by the per-minute `featuredTick` cron in
`tasks.service.ts`.

- **Auction opens** the moment a slot becomes vacant (no scheduled
  pre-auction). `closesAt` starts as null — the 24h countdown only
  begins on the first bid (`bidWindowSec`, default 86400).
- **Subsequent bids do NOT reset the timer.** Highest bid wins at
  the timer's expiry.
- **Bind window** opens for 15 min (`bindWindowSec`, default 900)
  after the auction closes. The winner picks one of their ACTIVE
  listings — any `listingType` (BUY_NOW / AUCTION / TAKE_A_SHOT) is
  valid. If they don't bind, the slot cascades to the runner-up.
- **Featured duration** is tiered by bid amount: R100 = 1d,
  R200 = 2d, R300 = 5d, R400 = 7d, R500 = 14d. Bid amount snaps
  DOWN to the nearest tier. Stored as `t1AmountCents/t1DurationSec`
  … `t5AmountCents/t5DurationSec` in `FeaturedSlotConfig`.
- **Sold listing frees the slot early** — cron detects SOLD
  listings bound to a slot and flips the slot to VACANT before
  `featuredUntil`.

### Frontend surfaces

- **Featured rail** (`<FeaturedRail>`) — vertical scrolling
  sidebar on browse pages, mobile becomes horizontal scroller.
  Continuous CSS keyframe scroll, hover-paused.
- **Homepage grid** — replaces the live-listings grid on the bare
  landing page (`showHero` branch). Horizontal scroll, all 10
  slots rendered always (empty slots show "Featured spot
  available — Place a bid →" placeholder).
- **Seller bid page** (`/featured/bid`) — slot grid, tier table,
  bid modal with stepper, bind modal with 50px-tall row picker
  styled like the rail card.
- **Admin panel** (`/admin/featured`) — slot overview, per-slot
  detail with force-evict / manual-award / shift-until /
  close-auction-early, revenue dashboard, settings, banned bidders,
  audit log.

### Admin: manual award accepts EITHER form

`POST /api/admin/featured/slots/:id/manual-award` accepts the
listing's CUID or its human-readable `referenceNumber`
(`UM000123` / `AU000045` / `TS000007`). Backend resolves either —
admin can paste the visible chip from the listing detail page.

---

---

## Take a Shot (Confidential Offers)

- Buyer submits a confidential offer; amount is private.
- Seller has 48 hours to respond; one counter allowed.
- Optional auto-accept threshold set by the seller.
- Accepting an offer triggers the seller-KYC gate (as for a sale).

---

## Claude AI Listing Moderation

Every new listing is reviewed by Claude via the Anthropic API
(vision-enabled model) before going live. Four outcomes:

- **APPROVE** — live immediately.
- **AUTO_FIX_AND_APPROVE** — silently strips contact info (phone,
  email, social handles, URLs, redirects) from the description; no
  seller notification; original kept in `claudeOriginalDescription`.
- **REJECT** — seller sees `publicReason`.
- **HUMAN_REVIEW** — sent to the admin queue.

**Hard reject:** live ammunition / primers / propellant (empty
brass, once-fired brass, projectiles/bullets are allowed);
hate speech / extremist content; sexual content; no photos /
stock / watermarked photos; duplicate listing by the same seller;
contact info visible in photos.

**Human review:** listings ≥ R20,000; the first 3 firearm listings
from a new seller; ambiguous ammunition; confidence < 0.85
(low-confidence APPROVE is bumped to HUMAN_REVIEW as a safety net).

Admin can override any decision. If the Anthropic API fails, the
listing falls back to HUMAN_REVIEW.

`Listing` fields: `claudeDecision`, `claudeConfidence`,
`claudeReasons`, `claudeReviewedAt`, `claudeOriginalDescription`,
`claudeAutoFixApplied`, plus admin-override fields.

Settings: `claude_moderation_enabled` (default true),
`claude_confidence_threshold` (0.85),
`new_seller_firearm_review_count` (3),
`high_value_review_threshold` (20000).

---

## Shipping Webhooks

Both providers are configured on the provider side; the backend
handlers must exist as **public routes — no JWT**.

- **TCG** → `https://gungalore.co.za/api/shipping/webhook/tcg`
  Events: shipment note, shipment tracking event, invoice
  generated, parcel tracking event, shipment file upload.
  Auth: `TCG_WEBHOOK_SECRET` header.
- **Pudo** → `https://gungalore.co.za/api/shipping/webhook/pudo`
  Tracking status changes. No auth key.
- **Bob Go** → `/api/shipping/webhook/bobgo/<secret>/<group>/<action>`
  Seven topics exist; five are registered: `shipment_submission_status/
  updated`, `tracking/updated`, `shipment_charged_amount/updated`,
  `shipment_charged_weight/updated`, `shipment_health_status/updated`.
  The topic AND the secret travel in the PATH — subscriptions are
  registered one topic at a time and we choose the URL, so each one
  self-identifies and authenticates without relying on custom headers
  (unverified on Bob Go). Auth: `BOBGO_WEBHOOK_SECRET`.
  Register with `PATCH /webhooks` (NOT POST — POST returns 200 and
  silently creates nothing).

Both handlers: idempotent, use a shared
`findTransactionByTrackingNumber` helper, map provider status to
the internal `shippingStatus`, fire notifications, always return
200, and handle unknown tracking numbers gracefully.

---

## Notifications

Three channels, one source of truth in `NotificationsService` —
every transactional event fires whichever of these apply:

1. **Email** (Resend) — every event, every recipient.
2. **SMS** (SMSPortal) — every event with a verified phone on file.
   Action SMSes embed single-use cryptographic tokens with 48-hour
   expiry; format: `Gun Galore: [msg]. [action]: gg.co.za/s/TOKEN`.
3. **In-app inbox** (`Notification` Prisma model, see "Notifications
   inbox" section below) — persisted row per recipient. Drives the
   bell badge on the bottom tab bar and the `/notifications` page.

All three fan out from the same `NotificationsService` method (e.g.
`offerReceived`, `bidOutbid`, `newSaleSeller`). The in-app `persist()`
call is additive — failures there never block the email/SMS dispatch.

---

## Notifications inbox (in-app feed)

User-facing inbox of every transactional event, reachable from the
bell icon in the bottom tab bar (`Alerts` tab) or directly at
`/notifications`. Backs the Phase D push delivery layer when we ship
it — push will fire a notification AND persist the same row.

### Resolved-by-action semantics (not "read on open")

Per explicit operator spec: opening the inbox or tapping an item does
**NOT** clear it. A notification stays in the inbox — and counts
toward the bell badge — until the user **acts** on the underlying
entity (accepts the offer, dispatches the sale, places a higher
bid…) OR explicitly dismisses an informational item that has no
action.

Schema (`Notification` model in `backend/prisma/schema.prisma`):

- `category: NotificationCategory` — `BUYER | SELLER | ACCOUNT`. Drives
  the tab the row appears in.
- `linkedType` + `linkedId` — pointer to the underlying entity
  (`offer | transaction | bid | listing`).
- `dismissible: Boolean` — `true` for informational rows (× button
  shows in the inbox), `false` for action-required rows (can ONLY
  clear via the server-side resolve hook).
- `resolvedAt` + `resolvedBy` — `'user_action' | 'dismissed' |
  'auto_expired'`. Bell-badge query is
  `WHERE userId=? AND resolvedAt IS NULL`.

### Service API (`backend/src/notifications/notifications.service.ts`)

- `persist({ userId, category, type, title, body, url?, iconKey?,
  linkedType?, linkedId?, dismissible? })` — writes a row. Fail-open
  (logs errors, never throws).
- `persistByEmail(email, opts)` — same but does a `User.findUnique`
  by email first. Most existing event methods take emails (their
  original purpose was email/SMS) so this is the common call site.
- `resolveByEntity(linkedType, linkedId, { userId?, resolvedBy? })` —
  stamps `resolvedAt` on every matching unresolved row. Called from
  action handlers across the codebase whenever the user takes the
  action a notification was waiting on. Pass `userId` to scope to a
  single recipient.

### Feed endpoints (`notifications-feed.controller.ts`)

All Clerk-guarded. Throttle: 120/min/user (bell badge polls every
60s across multiple tabs/devices).

- `GET /notifications/me/active-count` →
  `{ buyer, seller, account, total }`. Polled by the bell badge.
- `GET /notifications/me?category=&status=active|resolved|all&limit=&before=`
  → paginated descending-by-createdAt feed. `status` defaults to
  `active` (resolvedAt IS NULL). `before` is a cursor for "Load more".
- `POST /notifications/me/dismiss` body `{ ids: string[] }` →
  resolves the rows ONLY where `dismissible=true`. Action-required
  rows are silently filtered.

### Currently wired events

| Event method | Category | Linked entity | Dismissible | Resolves on |
|---|---|---|---|---|
| `bidOutbid` | BUYER | listing | no | New bid by this user on the same listing |
| `auctionWon` | BUYER | listing | no | Buyer pays |
| `offerAccepted` | BUYER | offer | yes | Manual dismiss (no offerId on Transaction model) |
| `offerCountered` | BUYER | offer | no | Buyer accepts/rejects/counters back |
| `offerRejected` | BUYER | offer | yes | Manual dismiss |
| `itemDispatched` | BUYER | transaction | no | Buyer confirms delivery |
| `offerReceived` | SELLER | offer | no | Seller accepts/rejects/counters |
| `newSaleSeller` | SELLER | transaction | no | Seller marks dispatched |
| `paymentReleasedSeller` | SELLER | transaction | yes | Manual dismiss |
| `listingApproved` | SELLER | listing | yes | Manual dismiss |
| `listingRejected` | SELLER | listing | yes | Manual dismiss |
| Admin broadcast | ACCOUNT | — | yes | Manual dismiss |

`resolveByEntity` call sites: `OffersService.{accept,reject,counter,
acceptCounter,rejectCounter}`, `AuctionsService.placeBid`,
`TransactionsService.{confirmDispatch,confirmDelivery,markPaid}`,
`AdminService.refundTransaction`.

### Frontend surfaces

- `frontend/components/bottom-tab-bar.tsx` — Alerts tab (bell icon)
  with active-count red badge top-right when total > 0 (or `9+`).
  Badge polls `/notifications/me/active-count` every 60s. Gated to
  standalone mode (no polling in browser tabs). Critically: opening
  the inbox does NOT drop the badge — only acting on entities or
  dismissing informational rows does.
- `frontend/app/notifications/page.tsx` — three tabs (Buyer / Seller
  / Account) with their own per-tab active-count pill. `?tab=…`
  URL-driven. "Show resolved" toggle flips to history.
- `frontend/components/notifications-list.tsx` — fetches the feed,
  optimistic dismiss with rollback, "Load more" cursor paging.
- `frontend/components/notification-item.tsx` — icon + title + body
  + relative time. Dismissible rows show a `×` button; action-
  required rows show a faint "Act" pill (no dismiss button).
- `frontend/lib/notifications.ts` — typed fetch helpers. All
  resilient — return `[]` / `{0,0,0,0}` on network/HTTP errors so
  the UI degrades gracefully if the backend is briefly unreachable.

### Long-tail events not yet wired

Email + SMS fire as before, but no inbox row yet for:
`bidPlaced`, `counterAccepted`, `counterRejected`,
`auctionEndedForSeller`, `shippingDispatched`/`Out`/`Delivered`,
`orderConfirmedBuyer`, `refundIssuedBuyer`,
`dealerVerificationApproved`/`Rejected`, `shippingFailed`,
`firearmStockedAtDealerBuyer`, `dispatchNudgeSeller`,
`listingRemovedByAdmin`. Each is a one-line `persistByEmail` away
when prioritised.

---

## Email Templates

The Claude Design handoff ships **63 finished HTML email
templates**, one per platform event, in 11 groups (Account,
Verification, Listings, Auctions, Offers, Payments, Fulfillment,
Disputes, Engagement, Penalties, Platform).

**Rules:**

- They live at
  `backend/src/modules/notifications/templates/emails/`.
- They are **final, production assets** — table-based, MSO/Outlook
  fallbacks, inline-SVG logo, dark theme. Use them **as-is**. Do
  NOT restyle, redesign, or regenerate them.
- Each template uses bracketed placeholders — `[First Name]`,
  `[Email]`, `[Date]`, `[link]`, etc. The notification service
  loads the file and substitutes real values at send time.
- All 63 are kept in the repo so they are available. A template is
  only *wired* when a built feature needs it; unused templates sit
  dormant — that is expected and fine.

**Do NOT wire (no backing feature — leave dormant):**

- `subscription-statement.html` ("Monthly statement") — Gun Galore
  has **no subscription, billing, or statement model**. Commission
  is per-transaction, absorb-only. This file exists for
  completeness only. **Do not build any billing/statement feature
  to feed it.**
- `otp-2fa.html`, `new-device-login.html` — two-factor and
  new-device alerts are handled by Clerk's built-in flows. These
  branded versions stay dormant unless a custom flow is later
  chosen.
- `saved-search-results.html` — saved-search is not yet a scoped
  feature; this template plugs in if/when it is built.

---

## PWA

Built in phases. Library choice: **Serwist** (not Workbox/next-pwa,
neither plays nicely with Next 16 + App Router). Theme color `#0f0f0f`
(not brand red — the dark background reads better as the
Android status bar / Chrome tab tint).

### Phase A — Installable (done)

- `app/manifest.ts` → `/manifest.webmanifest`. `name`,
  `short_name`, `description`, `start_url: '/'`, `display:
  'standalone'`, `orientation: 'portrait'`, `theme_color:
  '#0f0f0f'`, `background_color: '#0f0f0f'`, `lang: 'en-ZA'`,
  `categories: ['shopping', 'sports', 'lifestyle']`.
- `app/layout.tsx` exports `metadata` + `viewport` with
  `appleWebApp` (iOS Add-to-Home-Screen), `applicationName`,
  `formatDetection.telephone = false`, `viewport.themeColor` for
  both colour schemes, and the `icons` block (favicon + apple-
  touch-icon emission).

### Phase B — Real icons (done)

Five PNG variants generated from a single source image by
`frontend/scripts/generate-pwa-icons.ts` (uses `sharp`, already a
transitive dep via Next):

- `public/icon-192.png`, `public/icon-512.png` (standard, alpha
  preserved).
- `public/icon-maskable-192.png`, `public/icon-maskable-512.png`
  (inner-80% safe zone, brand `#0f0f0f` fills the outer 20% so
  Android adaptive masks crop cleanly).
- `public/apple-icon-180.png` (inner-90%, brand bg padded — iOS
  rounds corners itself).

Source dropped at `frontend/public/icon-source.png` (or `.svg`,
`.jpg`, `.jpeg`, or `frontend/icon-source.*`). Script overwrites
outputs in place — re-run any time the brand mark changes.

### Phase C — Service worker (CONSERVATIVE, done)

- Packages: `@serwist/next`, `serwist`.
- `app/sw.ts` is the source worker, compiled to `public/sw.js` at
  build time via the Serwist Webpack plugin.
- **Conservative caching only** — Serwist's `defaultCache`
  (Google Fonts + fingerprinted JS/CSS bundles). NO HTML caching,
  NO API caching, NO image caching at this stage. Minimal risk
  surface — avoids the "buyer saw stale auction price" failure
  mode.
- Offline fallback at `/offline` (precached, served for any
  navigation that fails when offline). Brand-styled, no API calls.
- `skipWaiting + clientsClaim + navigationPreload` enabled — new
  SW versions activate on next nav, not after every tab closes.
- `next.config.mjs` wraps with `withSerwist`. Empty
  `turbopack: {}` config silences the Next-16 "build is using
  Turbopack with a webpack config" conflict. SW is **disabled in
  dev** (`NODE_ENV !== 'production'`) — Turbopack doesn't run the
  Webpack plugin AND caching in dev would break HMR.
- **Remote kill switch:** set `NEXT_PUBLIC_DISABLE_PWA=true` in
  `frontend/.env.production` and `pm2 restart gungalore-frontend`.
  The flag does two things in one flip:
    1. `next.config.mjs` skips SW generation entirely (the next
       build emits no `/sw.js`).
    2. `<SwKillSwitch />` (mounted in `app/layout.tsx`) detects the
       flag on every page load and runs
       `navigator.serviceWorker.getRegistrations()` → `unregister()`
       for each, then `caches.delete()` for each cache key. So
       previously-installed SWs are evicted on the user's next visit
       without them having to manually clear site data.
  Recovery procedure: set the env back to `false` (or remove the
  line entirely) and `pm2 restart gungalore-frontend`. The next
  build re-registers the worker; users' next visit picks it up.

### Phase C polish — feels like an app (done)

After Phase C the site is installable + offline-capable. Phase C
polish layers on the visual + interaction cues that distinguish "PWA
opened fullscreen" from "native iOS app":

- **Standalone-mode detection** — `frontend/lib/use-standalone.ts`
  hook (SSR-safe via `useSyncExternalStore`) + inline pre-paint
  script in `app/layout.tsx` that sets
  `<html data-standalone="true">` before first frame. CSS gates the
  rest off that attribute, so server HTML matches for browser users
  and installed-PWA users with no flash. The same script rewrites
  the viewport meta to lock pinch-zoom + double-tap-zoom in
  standalone mode (`maximum-scale=1, user-scalable=no`) — installed
  users get a fixed native-window feel; browser users keep zoom for
  accessibility.
- **Bottom tab bar** — `frontend/components/bottom-tab-bar.tsx`,
  5-tab nav (**Shop / Alerts / Sell / Wishlist / More**) anchored to
  the bottom with `env(safe-area-inset-bottom)` padding for the home
  indicator. Sell is the raised circular FAB in the centre.
  - **Shop** opens a bottom-sheet picker with four rows: All listings,
    Marketplace, Auctions, Take a Shot. Active row
    highlighted in brand red.
  - **Alerts** routes to `/notifications` with a red active-count
    badge (see "Notifications inbox" section above).
  - **Wishlist** routes to `/wishlist`. Heart icon, red count badge
    when items are saved (caps at "50+"). Replaces the old "My" tab —
    "My" destinations now live in the More sheet.
  - **More** sheet is headed by a Profile card (avatar + username +
    "View profile" chevron pulled from Clerk's `useUser()`), then
    sections: **My account** (Dashboard, Profile, My listings/orders/
    sales/offers/bids, Received offers, Sign out),
    **Shop** (Take a Shot), **Legal** (Terms, Privacy,
    Refund, legal index). Sections are separated by thin dividers and
    every row has a trailing chevron so it reads as iOS-Settings-style
    navigation.
  - Visible only in standalone mode. Browser-mobile users keep the
    existing hamburger drawer in `nav.tsx`.
  - **Hides on scroll-down** (`lib/use-scroll-direction.ts`) — slides
    off-screen when the user scrolls down (more reading room), back
    in when they scroll up. Sheet-open state overrides the hide.
- **Sticky featured strip** — `frontend/components/sticky-featured-
  strip.tsx`, mounted in the layout and visible only in standalone
  on the shopping surface (`/`). Sits
  above the bottom tab bar; hides on scroll-down in sync with it.
  140×64pt cards by default; latest spec is 30% larger (182×83pt).
- **Sticky search bar** — `frontend/components/mobile-search-bar.tsx`
  shown at the top of every applicable page in standalone mode.
  Hidden on focus-flow routes via a denylist (`/admin`, `/checkout`,
  `/sign-in`, `/sign-up`, `/listings/new`, `/kyc/verify`, `/offline`,
  `/notifications`, `*/dealer-verification`).
- **Top nav hidden in standalone** — `public-chrome.tsx` wraps the
  Nav in a `data-public-nav` div + Footer in `data-public-footer`,
  both hidden via `globals.css` when standalone. The bottom tab bar
  + sticky search bar replace them.
- **All-listings entry** — `Shop → All listings` routes to
  `/?sort=newest`. `showHero` on the homepage excludes when a `sort`
  param is set, so the user lands on the actual listings grid
  (sorted server-side per `BrowseListingsDto.sort` =
  `newest|price_asc|price_desc`) instead of the curated landing.
  The homepage's big Featured marquee section also hides in
  standalone (CSS gates on `data-featured-home-section`) — the
  sticky featured strip already covers featured in standalone, so
  the inline marquee would be redundant.
- **iOS splash images** — generated by `pwa-asset-generator` into
  `frontend/public/splash/apple-splash-*.jpeg`, wired via
  `<link rel="apple-touch-startup-image">` in `layout.tsx`. Kills
  the white-flash on PWA launch on every supported iPhone + iPad.
  Plus an animated install walkthrough modal
  (`components/install-animation.tsx`) shows the "tap Share → Add to
  Home Screen" gesture flow when iOS Safari users tap "How" on the
  install-prompt CTA — pixel-art Windows pointing-hand cursor flies
  in, halo + step badge, 4-scene loop. Built from a Claude Design
  prototype handoff.
- **CSS polish** in `globals.css`: `-webkit-tap-highlight-color`
  transparent (no grey flash), `overscroll-behavior-y: none`
  (no page rubber-band), `font-size: 16px` on mobile inputs (no
  iOS zoom-on-focus), `env(safe-area-inset-*)` paddings,
  `touch-action: pan-x pan-y` in standalone mode (belt-and-braces
  zoom block). `--text-tertiary-on-card: #8a8a8a` token gives WCAG-AA
  contrast for tertiary text on `--bg-card` (used in the footer; the
  raw `--text-tertiary` fails AA at 3.7:1).
- **Online/offline + SW-update banners** —
  `components/connection-status-banner.tsx` watches `navigator.onLine`
  via `useSyncExternalStore`, debounces the first drop by 500ms,
  shows a red "You're offline" sticky bar + a green "Back online"
  toast on recovery. `components/sw-update-banner.tsx` listens for
  `updatefound` + `controllerchange` on the service-worker
  registration; when a fresh SW activates with a previous controller
  in place (i.e. an update, not a first install) it pops a bottom-
  anchored "An update is available — Reload" banner. Tapping Reload
  hard-refreshes so the new bundles load (Serwist's
  `skipWaiting: true` already activates the new SW; the page just
  needs a refresh to pick up the new JS).
- **Web Share + clipboard fallback** —
  `components/share-listing-button.tsx` wraps `navigator.share()` with
  a `navigator.clipboard.writeText()` fallback + 2s toast. Mounted on
  `/listings/[id]` next to the Wishlist button.
- **View transitions** — `::view-transition-old/new(root)` keyframes
  in `globals.css`, gated on standalone. Will fire once we enable
  Next 16's `experimental: { viewTransition: true }` flag and wrap
  the layout in `<ViewTransition>`. Currently a no-op; rules are
  harmless in the meantime.
- **Manifest** — `app/manifest.ts` includes `id: '/'`, `scope: '/'`,
  and a `shortcuts` array (Browse / Sell / Auctions) for Android's
  long-press app-icon menu.
- `middleware.ts` adds `/offline` and `/sw.js` to the public
  routes list so Clerk doesn't `protect-rewrite` them.
- `tsconfig.json` includes `webworker` lib so the SW source
  type-checks.

### Out of scope (later phases)

- **Image + API caching strategies** — to be added incrementally
  after the conservative SW is shipped + tested. Plan:
  stale-while-revalidate for Cloudinary images, network-first
  short cache for `/api/*` GETs, network-only for writes, never
  touch anything containing `clerk`.
- **Web push delivery** — the persistent `Notification` model + the
  in-app inbox are SHIPPED (see "Notifications inbox" section
  above). Push delivery itself (VAPID + `PushSubscription` table +
  opt-in UX + service-worker push handler) is the next layer; once
  built, it will fire write-row AND push using the same payload.
- **Install-prompt UX with deferral logic** — currently shows
  immediately when beforeinstallprompt fires (Android/desktop) or
  when the user is in iOS Safari + has dismissed nothing. 14-day
  dismissal via localStorage already in place; deferred-trigger
  logic (e.g. "after 3 visits") not built.
- **Custom notification sounds** — operator chose default OS sound
  when push lands. No custom mp3 plumbing.

---

## Odoo Accounting

**Live accounting: Zoho Books** (not Odoo). The Zoho Books
integration shipped in Phase ZB-1 through ZB-11 — commission
invoices on dealer-verification APPROVED, paid-marker on payout
fired, credit notes on refund, invoices on featured-slot bids won,
admin retry button per row, and queue-depth health monitoring. See
`backend/src/zoho-books/`. Odoo
was the earlier plan and is archived — do not build new code
against it.

Peach payment fees → expenses; users → contacts (FICA records);
featured fees → revenue; SMS / email costs → expenses. VAT201,
monthly P&L, balance sheet, cash flow all run
out of Books once VAT registration crosses R1M turnover (see
Feature Flags `VAT_REGISTERED`).

---

## Admin Panel

- Roles: **Superadmin** and **Admin**. Admin auth uses a custom JWT
  (`JWT_ADMIN_SECRET`), separate from Clerk.
- Verification working hours: Mon–Thu 08:00–17:00, Fri 08:00–14:00.
- Queues: seller verification, listing moderation (Claude outcomes),
  penalty approvals, disputes.
- Superadmin-only: audit CSV exports.

---

## Feature Flags

All feature flags default to `false` and flip to `true` only when a
module is fully ready. Examples: per-module launch flags,
`claude_moderation_enabled`.

`VAT_REGISTERED` flag defaults `false`; flip it at R1,000,000
turnover.

Other thresholds: community valuation activates after 500 verified
users; the "Build My Setup" configurator activates after 100
firearm listings.

---

## Backups & Disaster Recovery

- Vultr daily snapshots (built-in product on the VPS plan).
- Automated daily `pg_dump` cron to object storage, 30-day
  retention, 02:00.
- UptimeRobot monitors the frontend and `/api/health`.
- Sentry for error monitoring.
- Test backups monthly by restoring to a test database.
- Recovery: server dead → restore Vultr snapshot; DB corrupted →
  stop backend, restore `pg_dump`; bad deploy → roll back to the
  git tag.
- Full HA (hot standby / managed DB) is deferred until meaningful
  GMV.

---

## Marketing Copy Rules

- **Never name a competitor.** Refer to "scheduled auction sites",
  "retail stores", "other SA auction sites". WhatsApp and Facebook
  groups MAY be named directly.
- Marketing pages planned: `/buy-and-sell`, `/auctions`,
  `/about`, plus homepage cards and footer nav.
- A temporary welcome page may be served at `/welcome`.

---

## Git Commit Format

Clear, specific messages describing what changed in the session.
Work on a feature branch; `deploy now` merges it into `main`.

---

## Operational ops

### Category seeding (`backend/scripts/seed-categories.mjs`)

`prisma/seed.ts` re-introduces 5 TEST dealers + the seed admin user,
so it's NOT safe to run against production. Use this script instead
when production needs the canonical category tree (14 parents +
~110 sub-categories) refreshed:

```
ssh gungalore "cd ~/app/backend && node scripts/seed-categories.mjs"
```

- Idempotent — upserts by slug. Safe to re-run when the tree changes.
- Deactivates ALL existing categories first, then re-activates the
  canonical set. Anything admin-added via `/admin/categories` that
  isn't in the canonical list will be left `isActive=false` (still
  FK-valid for old listings, just hidden from pickers — manually
  re-enable in the admin panel if needed).
- Only touches `Category` table. No dealers, admins, users, listings,
  or transactions affected.

Production was seeded fresh on 2026-05-24 (0 → 129 categories).
The dev seed script (`prisma/seed.ts`) is for local dev only.

### Profile-completion verify-success fallback

`ProfileCompletionModal` (`frontend/components/profile-completion-
modal.tsx`) is the hard-wall modal after first listing publish. iOS
Safari has an aggressive request-cancellation pattern in PWAs —
the POST to `/users/me/profile-complete` can drop the response
even when the server actually succeeded (we've seen "Load failed"
twice in a row while backend logged two `Profile completed` events).

Two-layer hardening:

1. `keepalive: true` on the fetch — tells iOS Safari to hold the
   request open across short backgrounding events.
2. On any thrown network error, re-fetch `/users/me` and check
   `profileCompletedAt`. If set, treat as success (close modal,
   clear localStorage draft, fire `onComplete`) instead of showing
   a confusing error to a user whose data is already saved.

The user only sees an error now if the server genuinely didn't
accept the data (a 4xx response with a `message` body, shown
verbatim) OR if both the POST AND the verification GET fail.

---

## Deferred / Optional — only build if a user actually asks

Items consciously dropped from the active plan because the cost-to-
build doesn't match the demonstrated demand. Documented here so we
don't accidentally re-derive them, and so the next pass knows they
were considered + rejected (not forgotten).

- **Ask GG — Business / VAT receipts** (was E4). Adding `businessName`
  + `vatNumber` to Subscription so Zoho receipts carry SARS-compliant
  fields. Pro perk in the original plan. Operator call 2026-05-26:
  too niche to ship pre-launch; the same outcome is achievable by
  the dealer manually telling the operator their VAT number once and
  the operator updating the Zoho contact directly. Revisit if 3+
  Pro subscribers ask in writing.

- **Ask GG — Priority routing** (was E5). Pro requests jumping a
  queue read first by the Claude-call worker. Needs real queue
  infra (BullMQ or similar) that we don't have today. Operator call
  2026-05-26: deferred — nobody's complained about Ask GG latency,
  Sonnet is already fast, and the Opus escalate-button covers the
  "I need a better answer" pressure point. Revisit if median Ask GG
  latency exceeds 6s OR if Pro users complain.

- **Ask GG — Bulk photo identification 5→20** (was E3 original).
  Bumped from 5 to 20 photos per Pro request for "estate clearance"
  use case. Operator call 2026-05-26: 20-photo Claude vision calls
  cost ~$0.20 and the realistic use cases are thin. Settled at Pro
  cap = **10/request** (Member stays at 5). Revisit only if a dealer
  asks specifically for bulk intake processing.

- **Ask GG — Prime Ad reserve discount.** Was in early plan as
  Pro 25% off `FeaturedAuction.reserveCents`. Operator call
  2026-05-26: there IS no second ad system + no `reserveCents`
  field — it was vapor. The featured-slot bid discount (E2 shipped)
  is the only featured-pricing perk. Do not reintroduce without a
  concrete second product to discount.

---

## Recent build context

This section replaces the long per-session trail that used to live
here. For the full history, run `git log` — for the current state of
the launch, read these two files (both tracked in this repo):

- **`AUDIT-2026-06-10.md`** — 40-agent end-to-end code audit of the
  current `feat/hunt-ballistics-range-estimator` branch. Findings
  are batched A–G (critical money path, raffle integrity, headers,
  PWA, checkout UX, featured/attestations, reliability + POPIA).
  This is the canonical "what's wrong" snapshot.
- **`LAUNCH-CHECKLIST.md`** — open Tier 0/1/2 items that must be
  done before flipping the public switch. Includes operator-only
  destructive actions, schema-drift cleanup, firearm attestation
  persistence, and the remaining `[FIX-*]` tasks. This is the
  canonical "what's left" list.

### Headline state (2026-06-12)

- ~~**Payments: Stitch Express, fully live.** Peach has been removed
  from the code-path (search the codebase for `peach` — only
  comments noting the migration should remain).~~
  **❌ SUPERSEDED — do not act on the struck-through line.** It was
  true for about six weeks in 2026-06. Stitch was dropped on
  2026-07-23 and **Peach is the rail**; following that instruction
  today deletes the live payment integration. See the Payments
  section above, which is the current truth.
- **KYC SMS link tokenization** (`ActionToken` purpose
  `KYC_VERIFY`): KYC verification can be triggered from a single-
  tap SMS link via the dual-auth `KycOrTokenGuard`. Mirrors the
  offer / counter / dispatch / auction-bid token pattern.
- **40-agent audit + 21 batch fixes shipped** to prod (payments +
  CSP/COOP headers + raffle race + offer checkout UX + featured
  slots + firearm attestation gate). Items left over are tracked
  in LAUNCH-CHECKLIST.md, NOT here.
- **Firearm 18+/competency attestation:** server-side gate in
  `backend/src/payments/transactions.service.ts` enforces
  `firearmAttestation18Plus === true` on checkout DTOs that touch
  firearm listings. Persistence column was reverted from the last
  deploy — see LAUNCH-CHECKLIST.md `[FIX-7]` for the migration
  follow-up.
- **Security headers** are configured in `frontend/next.config.mjs`
  `headers()`: `X-Frame-Options: DENY`, `Content-Security-Policy:
  frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-
  Policy`. Don't relax these without operator sign-off.
- **Schema-drift trap (READ THIS):** three services (Ask GG KB,
  reloading-manual FTS, listings FTS) add `tsvector GENERATED`
  columns + GIN indexes at boot via raw DDL in their
  `onModuleInit`. These columns are NOT declared in `schema.prisma`.
  Running `npx prisma db push --accept-data-loss` would drop them.
  The deploy block above has been updated to use `prisma generate`
  only; for real schema changes use `prisma migrate deploy` with a
  written migration. See `[BC-SCHEMA-DRIFT]` and `[FIX-9]` in
  LAUNCH-CHECKLIST.md for the proper declaration follow-up.

### Operator memory shortcuts

These are also in the auto-memory store but worth pinning here so
they survive any future memory wipe:

- **Never use the word "escrow"** — regulated SA financial term.
  Use "funds held" / "payment held" everywhere.
- **Never expose real names to other users** — username only on
  public surfaces, no `@` prefix.
- **Production server is Vultr, NOT Hetzner** (<ORIGIN_IP — see password manager>).
- **SSH via the `gungalore` alias** only — never
  `gungalore@<ORIGIN_IP — see password manager>` (bypasses the alias config).
- **Ballistic Calculator is its own app** at
  `ballistics.gungalore.co.za` (own DB, pm2 services, nginx block,
  lives at `~/ballistics-app/`).
- **Pudo is on production mode** as of 2026-05-20.
- **Always provide full ready-to-run PowerShell commands** to the
  operator (they don't write code).
- **Don't flip sandbox↔production env mode** without confirmation.

**Prisma 7 notes (do not revert):**
- Generator: `prisma-client-js` (NOT `prisma-client` — that generates ESM
  which is incompatible with NestJS CommonJS output).
- Runtime connection: `PrismaService` passes `adapter: new PrismaPg(DATABASE_URL)`
  to `super()`. Prisma 7's WebAssembly engine requires an explicit driver
  adapter; `new PrismaClient()` with no args throws.
- CLI config: `backend/prisma.config.ts` (Prisma 7 requirement — `url` is
  not allowed in `schema.prisma` datasource block).

**Production status — LIVE since 2026-06-24.** Site is public
(`COMING_SOON_GATE=off`), payments run in **manual EFT mode**
(`PAYMENT_MODE=manual`; IMAP scan + FNB statement reconciliation),
legal docs finalised (draft notices removed). Deployed at commit
`9725daa` + the `20260624120000_add_manual_payments` migration.

Pending external items (operator track — none of these are coding
work, but the platform can't fully launch without them; see
LAUNCH-CHECKLIST.md for the authoritative list):

- **VERIFYNOW_MODE=production (CRITICAL — site is public).** KYC
  identity checks are currently running against SANDBOX data, so
  sellers are NOT genuinely ID-verified. Set `VERIFYNOW_MODE=production`
  + the production VerifyNow API key in `backend/.env` and reload the
  backend. Accepted as a known gap at the 2026-06-24 go-live.
- **Peach** live merchant + payout-bank account fully configured
  (sandbox→production cutover; redirect URLs are set in the Peach
  dashboard — `scripts/stitch-redirect-setup.cjs` is dead code).
  Under the NEW entity, ALLOUTDOOR (PTY) LTD.
- Attorney review of `/terms`, `/privacy`, `/aml-policy`,
  `/refund-policy`, `/firearms-compliance`.
- Email forwarding for `sellers@` / `support@`
  at gungalore.co.za.
- Register the `gg.co.za` short-link domain (used in SMS action
  links).
- DNS + nginx + certbot for `ballistics.gungalore.co.za`
  (`[BC-OPS]` in LAUNCH-CHECKLIST.md).

Do not append new session trails here — keep this file as rules,
not history. When work concludes, update LAUNCH-CHECKLIST.md (open
items) or AUDIT-2026-06-10.md (findings) instead.
