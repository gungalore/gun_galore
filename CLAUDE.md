# Gun Galore — Claude Code Context

## What This Is

Gun Galore is South Africa's verified firearms, hunting and outdoor
marketplace. This is a fresh rebuild — clean codebase, new GitHub
repository, built locally and deployed to the server only once
end-to-end testing begins.

The platform is delivered as five modules, built in order. Each
module must be fully stable before the next begins:

- **M1 — Secondhand Marketplace** (build first)
- **M2 — Auctions**
- **M3 — New Store**
- **M4 — Swap**
- **M5 — Raffle / Competitions**

This document is the single source of truth for Claude Code. It
records decisions and rules — not session history. When a decision
changes, edit the rule in place; do not append a narrative.

---

## COMMAND: "deploy now"

When the user types **"deploy now"**, execute this full sequence in
order. Do not skip steps. Report the result of each step before
moving to the next. If any step fails, STOP immediately, report
exactly what failed, and wait for the user's instruction.

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
`git checkout main`, `git merge [the working branch]`,
`git push origin main`. Confirm the push succeeded.

**STEP 5 — DEPLOY TO HETZNER SERVER**
SSH into the server (host IP, root user, and SSH key path are in
the operator's local notes — never written here). Then on the
server:
```
cd /var/www/gun_galore_project
git pull origin main
npx prisma migrate deploy        # MANDATORY whenever migrations exist
cd backend && npm run build && pm2 reload gg-backend --update-env
sleep 5
curl -f http://localhost:3001/api/health || \
  (echo "BACKEND HEALTH CHECK FAILED after reload" && exit 1)
cd ../frontend && npm run build && pm2 reload gg-frontend --update-env
sleep 5
curl -f http://localhost:3000 || \
  (echo "FRONTEND HEALTH CHECK FAILED after reload" && exit 1)
pm2 list
```
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

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind
- **Backend:** NestJS + TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Search:** Meilisearch
- **Auth:** Clerk (buyers + sellers); custom JWT (admin)
- **Images:** Cloudinary
- **SMS:** SMSPortal
- **Email:** Resend
- **KYC:** VerifyNow
- **Shipping:** Pudo (lockers) + The Courier Guy / TCG (door)
- **Payments:** Peach Payments (only — see Payments)
- **AI:** Anthropic API (listing moderation, skill questions,
  listing-quality scoring)
- **Accounting:** Odoo (self-hosted, Community edition)
- **Hosting:** Hetzner VPS — Nginx + PM2
- **Error monitoring:** Sentry
- **Uptime monitoring:** UptimeRobot

**Ports:** 3000 frontend, 3001 backend, 5432 PostgreSQL,
7700 Meilisearch.

---

## Server Layout (Hetzner)

- App lives at `/var/www/gun_galore_project`
- The marketing landing page at `/var/www/html` is separate —
  **never touch it**
- Production: `gungalore.co.za` / `api.gungalore.co.za`
- Staging: `staging.gungalore.co.za` / `api-staging.gungalore.co.za`
- Short-link domain: `gg.co.za` (for SMS action links)

Build locally during the rebuild. Deploy to the server only when
end-to-end testing starts. Set up proper, separate staging and
production environments before launch.

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
`VERIFYNOW_BASE_URL`, `ANTHROPIC_API_KEY`, `CLOUDINARY_URL`,
`MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`, `SMSPORTAL_CLIENT_ID`,
`SMSPORTAL_API_SECRET`, `RESEND_API_KEY`, `PUDO_API_KEY`,
`TCG_API_KEY`, `TCG_WEBHOOK_SECRET`, `GOOGLE_MAPS_API_KEY`,
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
   ledger. All money moves per-transaction through Peach.
10. **No public seller profile page** and **no dealer directory
    page.** Seller reputation surfaces only as the tier badge and
    rating on the listing itself.

---

## The Five Modules

| Module | Name | Notes |
|--------|------|-------|
| M1 | Secondhand Marketplace | Buy Now + Take a Shot listings. Build first. |
| M2 | Auctions | Full proxy-bid auction system. |
| M3 | New Store | New-goods retail store. |
| M4 | Swap | Item-for-item swap module. |
| M5 | Raffle / Competitions | Skill-based competitions ("Gun Galore Competitions"). |

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
4. **Payments** — Peach embedded checkout, `PaymentStatus` flow,
   commission calculation, seller payouts, penalties.
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
12. **M5 Raffles / Competitions** — skill-gated competitions, draws,
    claims, postal free-entry, re-raffle.
13. **Claude AI Listing Moderation** — every new listing reviewed
    by Claude before going live.
14. **Webhooks** — TCG + Pudo shipping webhooks.
15. **PWA Phase 1** — installability + offline.
16. **SEO**.
17. **Odoo accounting integration**.
18. **M3 New Store**, then **M4 Swap** — after M1/M2/M5 are live and
    stable.

PWA Phase 2 (push notifications) is deferred to its own later phase.

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
and when signed in: My comps, Your bids, Transactions, Messages
icon with unread badge, avatar → dashboard). A module launcher
offers Marketplace / Auctions / Raffle. Primary nav is always
visible, never hidden in a hamburger on desktop.

**Routes from the mockup that are NOT built:** `wallet`, `seller`,
`dealers` — these features are dropped. Every other route maps to a
feature in this document.

---

## Logo Rules — Never Break These

- `logo.svg` uses the Industry typeface — **never modify the SVG.**
- On centred pages: width 100%, max-width 300px, never a fixed
  height (preserve the 5:1 ratio).
- In the nav bar: 44px tall, top-left.
- Module marks (`marketplace-logo.svg`, `auction-logo.svg`,
  `raffle-logo.svg`, `used-marketplace-logo.svg`) are used as-is.

---

## Commission Model (LOCKED)

Marginal tiers, tax-bracket style — implemented in
`backend/src/modules/payments/fee.calculator.ts`:

| Band | Rate |
|------|------|
| First R5,000 | 10% |
| R5,001 – R20,000 | 8% |
| R20,001 – R100,000 | 6% |
| Above R100,000 | 4% |

- No minimum fees.
- **Absorb-only model:** commission is always deducted from the
  seller's payout.
- The seller's only fee choice at listing creation is who pays the
  payment-processing fee — `passFeeToBuyer` (Boolean).
- Top Seller tier gets a 0.5% commission discount.

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
suspended until the fine is paid (via Peach or deducted from the
next payout):

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
- Raffles: ticket buyers and winners need NO KYC anywhere. A
  non-firearm prize claim needs shipping details only; a firearm
  prize claim needs a competency certificate only. Seller
  competition applications DO need KYC (commercial activity).
- Never use the word "KYC" in user-facing text — use "Verified" /
  "Verification".

---

## Payments

**Provider: Peach Payments only.** PayFast, Ozow, Stitch, iKhokha,
Yoco and direct bank APIs are all rejected.

- Peach embedded checkout. 3DS/OTP stays ON for every purchase
  (buyer is present each time — cardholder-initiated).
- **`PaymentStatus` enum:** `HELD`, `PENDING_ADMIN_VERIFICATION`,
  `RELEASED`, `DISPUTED`, `REFUNDED`.
- **Card tokenisation** (saved cards) — DEFERRED to post-live-
  credentials. When built: `allowStoringDetails=true` adds a "save
  card" toggle that must be unticked by default (explicit consent).
  Peach returns a `registrationId`; store the token only (Peach
  holds the card — keeps Gun Galore out of PCI scope). Brand/last4/
  expiry may be stored for display. Pass saved cards back via
  `cardTokens`. Needs the recurring entity ID from the Peach
  dashboard.
- **Bank verification:** Peach BANVR (real-time, single account) /
  BANV (batch). Result returns via webhook. Service window
  03:00–23:00 — queue checks outside it (queuing is already
  designed). Confirm BANVR is enabled on the merchant account and
  check per-verification pricing.
- Everything is wired against Peach; it goes live with an `.env`
  credentials update.

**Prohibited:** never enter or store raw card/bank numbers. If a
user pastes card details into chat or a form, refuse and instruct
them to enter it themselves in the Peach checkout.

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

---

## Take a Shot (Confidential Offers)

- Buyer submits a confidential offer; amount is private.
- Seller has 48 hours to respond; one counter allowed.
- Optional auto-accept threshold set by the seller.
- Accepting an offer triggers the seller-KYC gate (as for a sale).

---

## Raffle / Competition System (M5)

Branding: **"Gun Galore Competitions"** — slogan *"Small shot, BIG
target."*

- **Legal model:** game of skill (a Claude-generated skill question
  gates entry) plus a free-entry route under CPA Section 36.
- **Launch scope:** admin-run competitions only. Seller-application
  intake is built but disabled via
  `raffle_seller_applications_enabled = false`.
- **Ticket price:** derived from admin inputs — target ticket count
  + margin% + commission%.
- **Duration** (tiered by item value): ≤R10k = 5 days,
  R10k–R50k = 10 days, R50k+ = 14 days.
- **Cooling window:** 24 hours after the timer ends before the
  draw.
- **Draw:** `crypto.randomBytes(32)` + SHA-256 + mod. `drawSeed` is
  published after the draw for public verification. 1 winner + 2
  backups. 7-day claim window per tier.
- **Minimum not reached** → status `CANCELLED_MIN_NOT_MET`:
  auto-refund every ticket via Peach (per-ticket, so partial
  failures are isolated; failed refunds logged for admin retry),
  notify all entrants, return the item to the platform — admin may
  re-raffle, convert to auction, or convert to Buy Now.
- **Firearm raffles** require a competency certificate (admin
  verifies). Winners need NO KYC.
- **Free entry:** a pdfkit A4 form with an 8-char reference code,
  posted to a PO Box; admin enters postal entries manually at
  `/admin/postal-entries`. The free-entry button stays DISABLED
  until `raffle_po_box_address` is set to a real address.
- **Re-raffle:** `parentRaffleId` lineage; max 5 relists
  (`raffle_max_relists`).
- `RaffleAuditEvent` logs all state changes; CSV export is
  superadmin-only.
- Admin pages: `/admin/competitions`, `/admin/competitions/create`
  (live revenue calculator + Claude-generated skill questions),
  `/admin/competitions/[raffleId]/audit`,
  `/admin/competitions/applications`, `/admin/postal-entries`.
- Public competition detail: `/competitions/[raffleId]`.
- Winner claim flow: `/dashboard/raffle-wins/[winnerId]` (no KYC).

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

Both handlers: idempotent, use a shared
`findTransactionByTrackingNumber` helper, map provider status to
the internal `shippingStatus`, fire notifications, always return
200, and handle unknown tracking numbers gracefully.

---

## Notifications

- Every notifiable event fires SMS (SMSPortal) **and** email
  (Resend) simultaneously.
- SMS action links use single-use cryptographic tokens, 48-hour
  expiry. Format: `GunGalor: [msg]. [action]: gg.co.za/s/TOKEN`.

---

## PWA

**Phase 1 (build now): installability + offline only.**

- Web App Manifest — theme `#C8102E`, background `#0f0f0f`,
  `standalone`, `en-ZA`.
- App icons in all sizes + maskable variants + apple-touch-icon,
  generated from the brand mark via sharp
  (`/frontend/scripts/generate-pwa-icons.ts` →
  `/frontend/public/icons/`).
- Workbox service worker: StaleWhileRevalidate for static,
  CacheFirst for images, NetworkFirst (3s timeout) for API.
- **Never cache:** `/api/payments`, `/api/auth`, `/checkout`,
  `/verify`, `/admin`, raffle entry, offers, bids.
- Branded `offline.html`; service worker registered in production
  only; new-version update banner.
- Custom install prompt — shown after 3 page visits OR 2 minutes;
  14-day dismissal via `localStorage` (this is a real Next.js app,
  so `localStorage` is fine here). iOS shows manual
  Add-to-Home-Screen instructions.

**Phase 2 (deferred): push notifications.**

---

## Odoo Accounting

Self-hosted Odoo (Community edition, SA localisation, small Hetzner
box). Integration is a later phase. Syncs: completed transactions →
sales invoices (with VAT); commission → income; seller payouts →
vendor bills; refunds → credit notes; Peach fees → expenses; users →
contacts (FICA records); raffle tickets → deferred revenue
(recognised at draw completion); prize costs → COGS; featured fees →
revenue; SMS/email costs → expenses; bank reconciliation; VAT201;
monthly P&L / balance sheet / cash flow. Real-time JSON-RPC for
money movements; nightly batch for contacts. Chart of accounts set
up by the accountant.

---

## Admin Panel

- Roles: **Superadmin** and **Admin**. Admin auth uses a custom JWT
  (`JWT_ADMIN_SECRET`), separate from Clerk.
- Verification working hours: Mon–Thu 08:00–17:00, Fri 08:00–14:00.
- Queues: seller verification, listing moderation (Claude outcomes),
  competition applications, postal entries, penalty approvals,
  disputes.
- Superadmin-only: audit CSV exports.

---

## Feature Flags

All feature flags default to `false` and flip to `true` only when a
module is fully ready. Examples: per-module launch flags,
`raffle_seller_applications_enabled`, `claude_moderation_enabled`.

`VAT_REGISTERED` flag defaults `false`; flip it at R1,000,000
turnover.

Other thresholds: community valuation activates after 500 verified
users; the "Build My Setup" configurator activates after 100
firearm listings.

---

## Backups & Disaster Recovery

- Hetzner daily snapshots.
- Automated daily `pg_dump` cron to object storage, 30-day
  retention, 02:00.
- UptimeRobot monitors the frontend and `/api/health`.
- Sentry for error monitoring.
- Test backups monthly by restoring to a test database.
- Recovery: server dead → restore Hetzner snapshot; DB corrupted →
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
  `/competitions`, `/about`, plus homepage cards and footer nav.
- A temporary welcome page may be served at `/welcome`.

---

## Git Commit Format

Clear, specific messages describing what changed in the session.
Work on a feature branch; `deploy now` merges it into `main`.

---

## Current Status

**Fresh rebuild — Foundation phase.**

- [ ] New GitHub repo created; `.gitignore` (excluding `.env*` and
      credential files) committed first.
- [ ] All previously exposed credentials rotated.
- [ ] Foundation scaffold (Next.js + NestJS + Prisma + Postgres +
      Clerk + Meilisearch + Cloudinary).
- [ ] M1 Listings.
- [ ] Remaining roadmap phases.

Pending external items: Peach Payments live credentials (confirm
BANVR + tokenisation enabled); SA Post Office PO Box for
"Gun Galore Competitions" → set `raffle_po_box_address`; attorney
review of `/competitions/terms`; email forwarding for
competitions@ / sellers@ / support@gungalore.co.za; register the
`gg.co.za` short-link domain.

Update this section at Step 7 of every `deploy now`.
