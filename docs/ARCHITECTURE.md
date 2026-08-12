# Architecture

How this system actually fits together. Written for an engineer who knows
TypeScript and has never seen a South African firearms marketplace.

Everything here is derived from the code in this repo, not from how a NestJS
app is usually wired. Where a claim matters, the file that proves it is named.
If you find a contradiction between this document and the code, the code wins —
and please fix the document in place rather than appending a correction.

> **A note on the other markdown files.** The 20-odd `*.md` files at the repo
> root are point-in-time audit reports and plans. They were true on the day
> they were written and many no longer are. `CLAUDE.md` is the closest thing to
> a rulebook and is mostly current, but it has known drift — see
> [Documentation drift](#documentation-drift) at the end. This file, the
> Prisma schema, and the code comments are the reliable sources.

---

## 1. The shape of it

Two Node processes on one Ubuntu VPS, both behind nginx, behind Cloudflare.

- **`frontend/`** — Next.js 16, App Router, TypeScript, Tailwind v3. Port 3000.
  Server Components do most of the data fetching; client components handle
  interaction. Also a PWA (Serwist service worker).
- **`backend/`** — NestJS, TypeScript, Prisma. Port 3001. Every route is under
  a global `/api` prefix (`app.setGlobalPrefix('api')` in
  `backend/src/main.ts`).
- **PostgreSQL 16** on 5432, **Meilisearch 1.44** on 7700, both local to the box.

There is no staging environment. Work goes from a developer's machine to
production after a local type-check and production build. That is a real
constraint on how you should work, not an oversight to fix casually.

### Request path

```
                    ┌──────────────────────────────────────────┐
  browser / PWA ───►│ Cloudflare (DNS, TLS, HSTS, WAF)         │
                    └────────────────────┬─────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────┐
                    │ nginx (same VPS)                          │
                    │   gungalore.co.za      /api/*  ──► :3001  │
                    │                        everything ► :3000 │
                    │   api.gungalore.co.za  all     ──► :3001  │
                    └───────┬──────────────────────────┬────────┘
                            │                          │
              ┌─────────────▼───────────┐  ┌───────────▼─────────────┐
              │ Next.js  :3000          │  │ NestJS  :3001           │
              │  RSC render + SSR fetch ├──► global prefix /api      │
              │  client components ─────┼──►                         │
              └─────────────────────────┘  └──┬──────────────┬───────┘
                                              │              │
                                    ┌─────────▼──┐   ┌───────▼────────┐
                                    │ PostgreSQL │   │  Meilisearch   │
                                    │   :5432    │   │     :7700      │
                                    └────────────┘   └────────────────┘
```

Two things about that diagram are easy to get wrong:

1. **The browser talks to the backend directly.** `frontend/lib/api.ts` reads
   `NEXT_PUBLIC_API_URL` and fetches that origin. In production that is the
   `api.gungalore.co.za` vhost. There are **no Next.js route handlers** —
   `frontend/app/api/` does not exist. Next is a rendering layer, never a BFF.

   > `NEXT_PUBLIC_API_URL` **must include the `/api` suffix.** Every fallback
   > in the codebase is `http://localhost:3001/api`, and callers pass bare
   > paths (`viewerFetch('/listings/brand-index')`). Setting it to
   > `http://localhost:3001` gives you a 404 on every request.
   > `frontend/.env.example` currently shows it without the suffix — that is
   > the example file being wrong, not the code.
2. **`gungalore.co.za/api/*` is nonetheless a live path**, proxied by nginx to
   3001, because third parties post webhooks there. `CLAUDE.md` records the
   registered courier webhook URLs as `https://gungalore.co.za/api/shipping/
   webhook/tcg` and `.../pudo`. Do not break that path assuming everything API
   goes through the `api.` host.

Because the browser and the backend are different origins, CORS matters.
`main.ts` allowlists `FRONTEND_URL` plus the Capacitor app schemes
(`capacitor://localhost`, `ionic://localhost`) in production, and additionally
any localhost / 127.0.0.1 / 192.168.x origin in development only.

`app.set('trust proxy', 1)` is load-bearing: exactly one proxy hop (nginx), so
Express derives `req.ip` from the first `X-Forwarded-For` entry. Without it,
`@nestjs/throttler` keys every request to nginx's loopback address and all
per-route rate limits collapse into a single global bucket. The fixed hop count
(`1`, not `true`) is what stops a client spoofing the header to dodge limits.

### Rate limiting

One global throttler bucket: 60 requests/minute (`ThrottlerModule.forRoot` in
`app.module.ts`), applied to every route via an `APP_GUARD`. Routes opt into
something stricter with `@Throttle({ default: { limit, ttl } })` or out entirely
with `@SkipThrottle()`.

Read the comment above that config before you add a second named bucket. The
original setup had three, and because `@nestjs/throttler` evaluates *all* named
buckets on every request, the effective global limit silently became the
strictest one (5/min). That broke SSR — every page render fans out several API
calls from one localhost IP — and surfaced as "404 on every listing", because
`apiFetch` throws on a non-OK response and the page called `notFound()`.

### Backend module map

`backend/src/app.module.ts` is the map of the system: 44 feature modules. Read
it first. A few are infrastructure that everything else assumes:

| Module | Why it matters |
|---|---|
| `PrismaModule` | `@Global`. `PrismaService` is injectable anywhere with no import. |
| `AuthModule` | `@Global`. Exports the three Clerk guards (see below). |
| `ActionTokensModule` | `@Global`. Mints the single-use tokens behind every SMS deep link. |
| `SettingsModule` | Typed accessors over a key/value `Setting` table — the feature-flag system. |
| `TasksModule` | `ScheduleModule.forRoot()` plus every recurring job. |
| `SearchModule` | Meilisearch client, index configuration, reindex helpers. |

The rest are domain modules and map onto the URL space fairly directly
(`ListingsModule`, `OffersModule`, `AuctionsModule`, `SwapsModule`,
`PaymentsModule`, `OrdersModule`, `KycModule`, `ShippingModule`,
`ComplaintsModule`, …).

---

## 2. Authentication

There are **two entirely separate auth systems**, and one auxiliary one.

### 2.1 Clerk — buyers and sellers

Clerk is the identity provider for every ordinary user. The frontend wraps the
app in `<ClerkProvider>` (`frontend/app/layout.tsx`) and `clerkMiddleware`
(`frontend/middleware.ts`) decides page-level access. The client obtains a
session JWT and sends it to the backend as `Authorization: Bearer <token>`.

The backend verifies that token itself (`backend/src/auth/clerk-verify.ts`) —
it does not call Clerk on every request.

**Our own `User` row is joined on `User.clerkId`.** Clerk owns the credential;
we own everything else about the person (username, tier, KYC state, bank
details, addresses). Two mechanisms keep the row in existence:

- A Clerk webhook (`user.created` / `updated` / `deleted`) verified with
  `CLERK_WEBHOOK_SECRET`. It **fails closed** — an unverified webhook is dropped,
  which means an unset secret silently breaks new-signup sync. `main.ts` warns
  loudly at boot if the secret is missing.
- A lazy backstop in `ClerkGuard`: if no `User` row exists for the verified
  `clerkId`, it calls `UsersService.lazyProvisionFromClerk()` to fetch from
  Clerk's Backend API and upsert. Concurrent first requests are deduplicated
  through an in-flight promise map, because a freshly signed-up user fires
  several authenticated requests at once and each would otherwise run its own
  fetch-and-upsert.

  There is history behind this. Dead rows from a previous dev instance squatted
  usernames and email addresses, so a new signup could end up with no `User`
  row at all and every action would fail with "User not found". The provisioner
  refuses to create a row for an email-less Clerk user rather than mapping the
  email to `''` — one such row poisons the unique constraint for everyone.

### 2.2 Two Clerk guards, and why both exist

| Guard | Behaviour on no/invalid token | Use |
|---|---|---|
| `ClerkGuard` | **401** | Anything that requires a logged-in user. Also lazily provisions the `User` row. |
| `OptionalClerkGuard` | proceeds anonymously | Public reads whose *content* depends on who is asking. |

`OptionalClerkGuard` never rejects. If a valid bearer is present it stamps
`request.clerkUserId` (which is what the `@CurrentUser()` decorator reads);
otherwise the request continues with that field undefined. An expired token is
treated as anonymous, never as an error — a stale session cookie must not turn
a public page into a 401.

This is not a convenience. It is the mechanism that implements the public/
members split in section 3: the service layer branches on "did I get a
`clerkUserId`?" to decide which catalogue to return. `OptionalClerkGuard`
deliberately does *not* provision the `User` row — a read does not need one,
and pushing writes onto read paths is how you get surprise contention.

**A public read endpoint with no guard at all is a bug, not a simplification.**
`categories.controller.ts` was exactly that once: with no guard, `clerkUserId`
is always undefined, which happens to fail safe there — but the same omission
on an endpoint that defaults to "show everything" is a data leak. Always attach
one of the two.

Two dual-mode guards exist for flows that arrive from an SMS link, where the
recipient has no browser session at all:

- `ClerkOrTokenGuard` — accepts a Clerk bearer **or** a `CHECKOUT`-scoped action
  token as `?t=<token>`. Used by `POST /transactions`, `GET/PATCH /users/me`.
  It also stamps `request.viaActionToken` and `request.actionTokenTargetId` so
  the handler can verify the token was minted for *this* listing (otherwise the
  holder could pay for a different item than the SMS pointed at).
- `KycOrTokenGuard` — same idea, scoped to `KYC_VERIFY`.

They are kept separate on purpose: one guard per token purpose means a
wrong-purpose token is rejected *and counted* toward the brute-force lock. Do
not merge them into one permissive guard.

### 2.3 Admin — a separate JWT

Admins are not Clerk users. `AdminUser` is its own table with its own login
(`AdminAuthService`), and sessions are HS256 JWTs signed with
`JWT_ADMIN_SECRET`. `AdminJwtGuard` (`backend/src/admin/guards/admin-jwt.guard.ts`)
verifies them and stamps `request.adminUser`.

`backend/src/admin/admin-jwt-secret.ts` is the single source of the secret and
**throws in production** if it is missing, empty, or the old committed default.
`main.ts` calls it at bootstrap so a misconfigured server fails fast and
visibly rather than accepting forged SUPERADMIN tokens.

On the frontend, admin pages are client components that read the JWT from
`localStorage` via `frontend/lib/admin-auth.ts` and bounce themselves to
`/admin/login`. That is why `/admin(.*)` is listed as a "public route" in the
Clerk middleware — it is not public, it just uses a different lock. Cookie-based
gating was tried and abandoned: some browser configurations silently dropped
the cookie regardless of attributes.

#### The boot crash-loop gotcha

> **Any module that registers a controller guarded by `AdminJwtGuard` MUST
> import `JwtModule.register({})` and list `AdminJwtGuard` in its own
> `providers`.**

`AdminJwtGuard` injects `JwtService`. Nest resolves providers per-module, so if
the module hosting the controller does not provide both, Nest cannot construct
the guard and the application **crashes at boot** and pm2 restarts it in a loop.

`tsc --noEmit` passes cleanly. The type system knows nothing about DI graphs.
You will not find out until the process is dead in production.

Thirteen modules currently do this correctly (`admin`, `ask-gg`, `complaints`,
`deals`, `featured`, `manual-payments`, `marketing`, `orders`, `raffle`,
`ratings`, `reloading`, `suppliers`, `support`). `complaints.module.ts` is the
clearest example, with the reason written in a comment. Copy that pattern.

```ts
@Module({
  imports: [JwtModule.register({})],
  controllers: [ComplaintsController, ComplaintsAdminController],
  providers: [ComplaintsService, ReferenceNumberService, AdminJwtGuard],
})
export class ComplaintsModule {}
```

### 2.4 Action tokens

`ActionTokensModule` mints short, single-purpose, user-bound, expiring tokens
that go out in SMS messages. The URL is `/a/<token>`; the page resolves it
server-side and renders a UI scoped to exactly one action (accept this offer,
verify your identity, pay for this item).

The token *is* the credential. `/a/(.*)` is a public route in the middleware
for that reason. Tokens are counted on invalid/wrong-purpose use and lock out
after repeated failures.

Why this exists: South African users overwhelmingly arrive from an SMS on a
phone, the link opens in the default browser (not the installed PWA), and there
is no session there. Forcing a sign-in at that moment loses the action.

---

## 3. The public/members split — the most important invariant

Read this before you touch anything a signed-out visitor can reach.

### Why it exists

Meta's crawlers and moderators were blocking the site, which killed the
operator's WhatsApp Business communications. The fix was to put regulated stock
(firearms, ammunition components, air rifles, self-defence, gunsmithing) behind
the login and present a plain outdoor store to the world. Signed in, nothing
changed.

**This is an auth wall, not cloaking.** Every signed-out visitor gets identical
content regardless of user-agent. **Never branch on user-agent. Never
special-case a crawler.** Serving a crawler something different from a
logged-out human is what turns a temporary block into a permanent ban.

### The mechanism

Two Prisma columns, both `@default(false)`:

- **`Category.publicVisible`** — the source of truth.
- **`Listing.publicVisible`** — a snapshot, set when the listing is created and
  re-snapshotted if the listing's category changes
  (`listings.service.ts`, `nextPublicVisible`).

Defaulting to `false` makes this an **allowlist**. A category added later is
invisible to the public until someone deliberately publishes it. The failure
mode is "we forgot to show the tents", never "we leaked the rifles". Keep it
that way — a `@default(true)` here would invert the safety property of the
entire feature.

Carve-outs — a members-only child under a public parent (rifle scopes under
Optics, crossbows under Archery) — are expressed as `membersOnly: true` on the
sub-category in `backend/prisma/seed.ts`.

**`membersOnly` is NOT a database column.** Grepping the schema for it finds
nothing. It is a seed-file-only TypeScript flag (`SubCat`, seed.ts:145) that the
seed resolves at build time into `publicVisible: false` on that child:

```ts
// backend/prisma/seed.ts:594
const publicVisible = child.membersOnly ? false : parent.publicVisible;
```

Visibility inherits DOWN. `membersOnly` can only pull a child OUT of a public
tree; it can never push one into a members-only tree. At runtime there is only
`publicVisible`.

Every public read path funnels through the same helper:

```ts
// listings.service.ts (and the identical twin in categories.service.ts)
private publicOnly(clerkId?: string): { publicVisible?: true } {
  return clerkId ? {} : { publicVisible: true };
}
```

Grep `publicOnly(` before adding a read path. The non-obvious sites are the
ones that bite: the **featured rail** (renders on every page), **seller reviews**
(they embed listing titles), the **sitemap**, **brand rollups**, and the
**Ask Boet guide** resolver.

`findById` returns **404**, not 403 and not a "sign in to view" interstitial.
403 confirms the item exists, which is exactly the disclosure the wall prevents.

`backend/src/listings/public-visibility.spec.ts` locks all of this down. If a
change makes those tests fail, the change is wrong.

### The two cache traps

Both of these will serve one audience's catalogue to the other. Both have
happened.

**Trap 1 — Next.js's data cache is shared across all users.** Marking a fetch
`next: { revalidate: n }` or `cache: 'force-cache'` puts the response in a
process-wide cache with no notion of a viewer. One member's fetch is then
replayed to anonymous visitors (leaking members-only stock), or an anonymous
fetch is replayed to members (hiding their own catalogue).

**Trap 2 — the browser HTTP cache keys on URL, not on the `Authorization`
header.** A member's response cached under `/api/categories` is replayed to the
*same browser* after sign-out.

The fix for both is to use the two helpers and nothing else:

| Context | Helper | What it does |
|---|---|---|
| Server Component | `viewerFetch()` — `frontend/lib/api-viewer.ts` | Reads the Clerk token via `auth()`, forwards it, forces `cache: 'no-store'` and **ignores any caller-supplied cache option**. |
| Client Component | `useViewerFetch()` — `frontend/lib/use-viewer-fetch.ts` | Same, from `useAuth()`. Any module-level memo cache must be keyed on signed-in state. |

Both fail *soft*: if the token cannot be read, they proceed anonymously, which
shows **less**, never more.

`frontend/next.config.mjs` backs this up at the HTTP layer — every non-static
route is served `Cache-Control: private, no-cache, must-revalidate`. `private`
forbids any shared cache (Cloudflare) from holding a snapshot, so the leak
cannot be reintroduced by a "Cache Everything" CDN rule. Fingerprinted assets
under `/_next/static/*` are matched last and keep their immutable caching.

`app/sitemap.ts` must stay **anonymous and `force-dynamic`**. Adding a token
there republishes the entire firearm taxonomy. `revalidate` is wrong there for
a second reason too: Next's fetch cache lives in `.next/cache` and survives a
rebuild, so a deploy would prerender the sitemap from a pre-deploy snapshot.

### Two more rules in the same family

- **`publicVisible` must stay in `STATIC_LISTING_FILTERABLE_ATTRIBUTES`**
  (`search/search.service.ts`) or Meilisearch rejects the anonymous query
  outright — see section 6.
- **No weapon word may appear in a public category name or slug.** A gate that
  hides the Firearms tree but publishes `optics--handgun-scopes` has not done
  its job; the scanner reads the URL, not the intent.
  `assertNoWeaponWordInPublic` in `prisma/seed.ts` fails the seed if you try.
  To publish something the pattern matches, rename the category to what it
  actually is. Do not weaken the pattern.

### The frontend half

`frontend/middleware.ts` holds `isPublicRoute` — the allowlist of paths a
signed-out visitor may load at all. Everything else redirects to `/sign-in`.

**Any new public page must be added there**, or it 307s to sign-in. Note the
inverse case too: several entries exist purely so *removed* features serve a
clean 404 instead of a redirect to sign-in (`/wanted`, `/competitions`).

Two implementation details in that file are load-bearing and commented as such:

- The redirect uses `NextResponse.redirect`, **not** the Web-API
  `Response.redirect`. The latter returns immutable headers; `clerkMiddleware`
  then tries to attach its `x-clerk-auth-*` headers and throws
  `TypeError: immutable`, which surfaces as a 500 on every protected route.
- The redirect base is pinned to `NEXT_PUBLIC_APP_URL`, never the inbound
  `Host` header, so a spoofed Host cannot turn the sign-in bounce into an open
  redirect.

There is also a `COMING_SOON_GATE` env switch that rewrites everything to
`/coming-soon` (with `X-Robots-Tag: noindex`) except API, admin, and
token-authed pages.

---

## 4. The four selling modes

A `Listing` carries a `ListingType`: `BUY_NOW`, `AUCTION`, `TAKE_A_SHOT`,
`SWOP`. They share one listing record, one moderation pipeline, one shipping
system and one money flow — they differ only in how a price is agreed.

### Buy Now

Fixed price, buy it immediately. Optionally inventory-tracked
(`trackInventory` / `quantityAvailable` / `quantityReserved`) so a seller can
list ten of something. Checkout reserves stock, creates a `Transaction`, and
flips the listing to `PAYMENT_PENDING` until payment resolves.

Logic: `backend/src/payments/transactions.service.ts` (`create`), with
multi-item cart checkout in `backend/src/orders/`.

### Auction

Proxy bidding. The bidder submits a **maximum**; the system bids the minimum
increment on their behalf and auto-counters up to that maximum. `maxAmount` is
never exposed publicly. Increments are tiered by current bid level —
R50 / R100 / R250 / R500 / R1,000, defined as `INCREMENT_TIERS` in
`auctions.service.ts`. There is an optional **hidden reserve**: only the derived
boolean `reserveMet` is ever public, never `reservePrice`.

**Snipe protection:** a bid inside the final two minutes pushes `endTime` out by
two minutes, repeatedly. Auctions are ended by a per-minute cron, not by a
timer. Optional Buy Now is available only while the auction has zero bids.

Logic: `backend/src/auctions/auctions.service.ts`. Bid placement and auction
finalisation are both CAS-guarded (conditional `updateMany` with the expected
prior state in the `WHERE`, checking `count`) against concurrent bids. Those
guards are the correctness of the module — preserve them on any edit.

### Take a Shot — confidential offers

The South African "make me an offer" flow, but the offer amount is private
between the two parties. A buyer submits an offer; the seller accepts, rejects
with a reason, or counters.

- Offers live 48 hours; a counter gives the buyer 24 hours to respond.
- A buyer gets at most 5 attempts per listing over the row's lifetime.
- Auto-accept exists (`autoAcceptThreshold` on the listing, never public) but
  is **never instant** — the seller still confirms.
- Rejecting requires a reason from a fixed ticklist, and every reason except
  `BUYER_SUSPICIOUS` is a **strike**. Three strikes bans the account from
  *selling* (`User.sellingBannedAt`); buying is unaffected. Countering and
  auto-decline are penalty-free.

Logic: `backend/src/offers/offers.service.ts`; the reason list and penalty
mapping live in `backend/src/common/seller-reject-policy.ts`. The frontend
reason list must mirror `OFFER_REJECT_REASONS` — they are two lists that have
drifted before.

### Swop / Trade

Item-for-item. A member proposes trading their listing for someone else's,
optionally with cash on one side. Both sides ship (or hand over), and the
platform charges a **swap fee** based on `declaredValueCents` — 1.5%, minimum
R50 for a courier leg or R100 for a firearm leg, capped at R750, less 25% for
PRO members. Constants are the `SWAP_*` exports in
`backend/src/payments/fee.calculator.ts`.

Notable mechanics:

- `declaredValueCents` is deliberately **public**, unlike reserve and
  auto-accept thresholds. It is the negotiation anchor and the dispute ceiling,
  so the counterparty has to see it.
- Non-PRO members may have one open proposal at a time.
- **Proof of possession**: each leg gets a 6-character code (`GG-XXXXXX`,
  alphabet excludes `0/O/1/I/L`) that the member must photograph next to the
  item. Claude vision reads it back. `crypto.randomInt`, not `Math.random`,
  because the code is the anti-replay anchor.

Logic: `backend/src/swaps/` — `swap-proposals.service.ts` (negotiation),
`swap-proof.service.ts` (possession), `swap-funding.service.ts` (fee).

> Watch out: `swap-funding.service.ts`'s `confirmSwapFunding` currently has no
> caller — it was orphaned when the manual-EFT rail was stripped. It is dead
> code today and will need rewiring when payments go live.

A swap leg is **not** settled through the ordinary confirm-delivery path.
`confirmDelivery()` explicitly rejects any transaction with a `swapId`, because
releasing per-leg would set `RELEASED` out of band, double-count `totalSales`,
and fire a phantom payout notice. Swaps settle through the `Swap` parent's
rollup.

---

## 5. Money flow

**Payments are not live.** `PAYMENTS_LIVE` is `false`, so every checkout entry
point returns *"Card payments are launching soon"*. The whole money state
machine below is built, tested and deployed — it just has no rail attached yet.

### Two gates, in `backend/src/payments/payment-mode.ts`

| Constant | Env | Meaning |
|---|---|---|
| `PAYMENTS_LIVE` | `PAYMENTS_LIVE=true` | Master switch. `assertPaymentsLive()` throws 503 at every checkout entry point while false. |
| `PAYMENT_MODE` | `PAYMENT_MODE=paygate` | Selects fee maths and the refund arm: `'paygate'` = card rate + reverse-on-card; `'manual'` (the default) = flat fee, and the platform owes the money out of its own account. |

That file is deliberately dependency-free so lightweight consumers (e.g. the
featured-slot service) can read the rail without dragging in the whole
transactions → shipping → search module graph.

### The pipeline

```
listing ACTIVE
   │  buyer checks out
   ▼
Transaction created ─── listing → PAYMENT_PENDING, stock reserved
   │                     KYC prompt fires at THIS point if the seller
   │                     is not yet VERIFIED (fire-and-forget)
   │  gateway confirms (webhook or verify-on-return)
   ▼
paymentStatus = HELD ─── listing → SOLD, sibling offers rejected,
   │                     fraud-risk score computed (log-only)
   │  seller has 48h to ACCEPT, then 5 days to DISPATCH
   ▼
dispatched ─── waybill booked with Pudo/TCG, tracking SMS to buyer
   │
   │  buyer confirms delivery  (or, firearms: SAPS 534 verification APPROVED)
   ▼
paymentStatus = RELEASED, releasedAt stamped, seller.totalSales++
   │
   │  daily settlement sweep
   ▼
paidOutAt stamped ─── money has actually left
```

`PaymentStatus` is `HELD | PENDING_ADMIN_VERIFICATION | RELEASED | DISPUTED |
REFUNDED`.

Note the distinction between `RELEASED` and `paidOutAt`. `RELEASED` means the
platform *owes* the seller. `paidOutAt` means it has *paid*. A row is "due"
while `paidOutAt` is null — see `getPayoutsDue()` in
`backend/src/manual-payments/manual-payments.service.ts`, which stayed
rail-agnostic when the FNB batch rail was removed.

### Branches that skip the normal release

- **`PRIVATE_ARRANGE`** (buyer and seller take a firearm to a dealer
  themselves): funds are released **immediately at payment capture**, because
  there is no delivery event the platform can observe. The buyer has explicitly
  waived payment protection, and this requires the seller's prior consent
  (`Listing.privateArrangeConsentAt`). See `maybeImmediatePayout()`.
- **`DEALER_TRANSFER`** (the normal firearm path): confirm-delivery is *not*
  enough. `dealerVerificationStatus` must be `APPROVED` — the SAPS 534 form,
  stock register page and firearm photos must have passed, either via Claude
  vision or an admin override.
- **`ON_SITE_SERVICE`** (hunting packages, range days): a future-dated service,
  not a parcel. It has its own post-event completion step gated on the event
  date, and `confirmDelivery()` refuses it explicitly so funds can never be
  released before the event happens.

### Admin levers

`payoutHeldAt` / `payoutHoldReason` excludes an otherwise-due row from the
payout sweep. It is the only control point between `PRIVATE_ARRANGE`'s
immediate release and the settlement run, so a fraud allegation raised after
release can still stop the cash leaving.

### Fees

`backend/src/payments/fee.calculator.ts`. Marginal bands, tax-bracket style:
9% on the first R5,000, 7% to R20,000, 5% to R100,000, 3% above; R30 minimum,
never exceeding the listing price. Commission always comes out of the seller's
payout. The **buyer** pays the payment-processing fee, and the platform keeps
it — it is never shown to the seller anywhere. Top Seller tier gets 0.5% off.

All money is stored as **integer ZAR cents**. (Peach's pay-in API takes decimal
ZAR while its payout API takes integer cents; the adapter handles the
conversion. Do not let decimals leak into the database.)

### Never write "escrow"

Not in code, not in comments, not in UI copy, not in emails, not in docs. Use
**"funds held"**, "payment held", "held until delivery confirmed", "payment
released".

This is a compliance choice, not a style preference. "Escrow" is a regulated
financial term in South Africa and the operating company is not registered to
provide it. Using the word in user-facing copy is a misrepresentation with
regulatory consequences; using it in code guarantees it eventually leaks into
copy. `paymentStatus` is the column name for the same reason.

---

## 6. Search

Meilisearch, one client, configured in `backend/src/search/search.service.ts`
(`onModuleInit` → `ensureIndexes`). Three indexes:

| Index | Primary key | Contents |
|---|---|---|
| `listings` | `id` | Every active listing. |
| `pudo_lockers` | `lockerId` | ~2,700 PUDO locker locations, refreshed on a 24h cache. |
| `cartridges` | `id` | Distinct cartridges from `ManualLoad`, for the Load Lab typeahead. |

If `MEILISEARCH_HOST` is unset, search is disabled with a warning and the app
still boots. Same if the health check fails at startup — the client is set to
`null` and callers degrade.

**Searchable:** `title`, `description`, `make`, `model`, `calibre`,
`categoryName`.
**Sortable:** `price`, `createdAt`, `endTimeTs`.

### The filterable-attributes trap

Meilisearch does not ignore a filter on a non-filterable attribute — it
**rejects the entire query**. So any field you filter on must be declared in
`STATIC_LISTING_FILTERABLE_ATTRIBUTES` before the first query that uses it.

Three consequences you will hit:

1. **`publicVisible` is in that list for a security reason.** An anonymous
   search appends `publicVisible = true` (`listings.service.ts` ~line 2300).
   Remove the attribute from the list and that filter throws — and depending on
   how the caller handles the error, `?q=glock` either 500s or returns firearms
   to the world.
2. The filterable set is **static list + one `attr_<key>` per filterable, active
   `CategoryAttribute`**, derived from the database at boot. Add a filterable
   category attribute and the facet does not work until the app restarts or the
   index settings are refreshed.
3. **Adding a sortable attribute only affects documents indexed afterwards.**
   `endTimeTs` was added for the auctions "ending soonest" sort; pre-existing
   documents simply sort last on that key until someone runs the admin "reindex
   all active listings" action. Budget for a reindex whenever you change index
   settings.

---

## 7. Background work

**All recurring work runs inside the NestJS process** via `@nestjs/schedule`
`@Cron` decorators. There is no system crontab, no worker process, no queue.

`ScheduleModule.forRoot()` is registered in `backend/src/tasks/tasks.module.ts`.
Almost every job lives in one file — `backend/src/tasks/tasks.service.ts`, 38
jobs — with one more (`insights-digest.service.ts`, the Monday 06:00 Claude
digest) elsewhere. TasksService injects ~25 domain services and delegates; the
jobs are thin schedulers, and the real logic stays in the owning module.

Two consequences of "in-process":

- **A single instance is assumed.** Run two backend processes and every job
  fires twice. Most transitions are CAS-guarded and idempotent, but "most" is
  not "all". This is why the deploy uses `pm2 reload` (zero-downtime rolling
  restart) rather than scaling out.
- **Long jobs can overlap themselves.** `@Cron(EVERY_MINUTE)` fires on the tick
  regardless of whether the previous run finished. Jobs that can run long carry
  an explicit boolean re-entrancy guard (`dealDropRunning`, `dealPoRetryRunning`,
  `dealCollectionSweepRunning`, `statsRollupRunning`). Add one if you write a
  slow job.

The ones that move money or state, roughly grouped:

| Job | Cadence | What it does |
|---|---|---|
| `endAuctions` | 1 min | Closes auctions past `endTime`, resolves winner, mints checkout token. |
| `featuredTick` | 1 min | Advances the featured-slot auction/bind/occupy state machine. |
| `dailyDealDrops` | 1 min | Flips scheduled Daily Deals live. |
| `expireOffers` | 10 min | Expires 48h offers and 24h counters. |
| `expireSwapProposals` | 10 min | Same for swap proposals. |
| `checkFirearmLicenceExpiry` | daily 06:00 | Delists firearm listings whose licence expires within 30 days; warns at 31–90 days. |
| `staleListingSweep` | daily 04:00 | Expires listings past the 60-day life (Buy Now / Take a Shot only; auctions are exempt). |
| `dispatchSlaSweep` | hourly | 48h-no-accept escalation and 5-day-no-dispatch auto-refund + strike. |
| `stuckHeldFundsSweep` | hourly | Finds money stuck in `HELD` that should have moved. |
| `dealerVerificationAgeingSweep` | hourly | Chases outstanding SAPS 534 paperwork. |
| `reclaimOrphanReservations` | 5 min | Returns inventory reserved by an abandoned checkout. |
| `orderStatusRollupSweep` | 30 min | Recomputes multi-line `Order.status` from its child transactions. |
| `pollTrackingEvents` | 10 min | Polls Pudo/TCG for parcels the webhooks missed. |
| `retryOutboxEmails` / `retryFailedSms` | 10 min | Redelivery for the notification outboxes. |
| `retryRevenueDocs`, `retrySwapFeeReceipts`, `retryDealPurchaseOrders` | hourly | Self-healing Zoho Books document creation. |
| `refreshTrustScores` | daily 03:00 | Recomputes the private 0–100 seller trust score. |
| `savedSearchMatchSweep` | 10 min | Fires saved-search alerts. |
| `pollCreditBalances` | 15 min | Polls SMS / KYC / AI credit balances, alerts the operator below threshold (6h dedup so it does not spam). |
| `refreshVerifyNowBalance` | 5 min | Same, for the KYC vendor specifically. |
| `cronWatchdog` | 10 min | Watches the other jobs' heartbeats and raises an admin alert on a stale one. Skips a startup grace window so a fresh restart cannot false-alarm. |
| `rollupInsights` / `pruneRawEvents` | daily 02:00 / weekly | Analytics rollup and raw-event pruning. |

`cronWatchdog` is worth knowing about specifically: it is the only thing that
tells you a job has silently stopped.

---

## 8. External services

Everything the app talks to. All credentials come from `.env` — see
`backend/.env.example`. The boot gate in `main.ts` is the authoritative list of
which of these are *load-bearing*: it hard-throws on a bad admin secret and logs
a loud error for each missing integration secret.

| Service | Used for | Key env | Behaviour when missing |
|---|---|---|---|
| **Clerk** | Buyer/seller identity, session JWTs, user-sync webhooks | `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `CLERK_AUTHORIZED_PARTIES` | Webhooks fail closed and are dropped → new signups do not sync (lazy provisioning backstops it). |
| **Peach Payments** | The payment gateway: Checkout V2 pay-in, Payouts, bank-account verification (BANV) | `PEACH_CLIENT_ID`, `PEACH_CLIENT_SECRET`, `PEACH_MERCHANT_ID`, `PEACH_ENTITY_ID`, `PEACH_SECRET`, `PEACH_ENV` | Runs in **mock mode**. Webhooks are rejected (fail-closed) without `PEACH_SECRET`. |
| **Cloudinary** | All user-uploaded images (listing photos, KYC documents, complaint photos) | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Uploads fail. |
| **Meilisearch** | Listing / locker / cartridge search | `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` | Search disabled, app still boots. |
| **Anthropic (Claude)** | Listing moderation, Q&A moderation, KYC vision, firearm-licence and dealer-document verification, swap proof-of-possession, Ask Boet, listing-quality scoring, weekly insights digest | `ANTHROPIC_API_KEY`, plus per-task `ANTHROPIC_MODEL_*` overrides | **Everything AI degrades to manual-review or blocked.** |
| Anthropic Admin API | AI spend monitoring on `/admin/credits` | `ANTHROPIC_ADMIN_API_KEY` | No spend alerts. (Note: a regular key is not an admin key.) |
| **SMSPortal** | Every outbound SMS — notifications, action links, waybill PINs | `SMSPORTAL_CLIENT_ID`, `SMSPORTAL_API_KEY`, `SMSPORTAL_API_SECRET`, `SMSPORTAL_BASE_URL` | SMS silently queues/fails; retry cron picks it up. |
| **Resend** | Every outbound email | `RESEND_API_KEY`, `EMAIL_LOGO_URL` | Fails open — email is fire-and-forget and never blocks a flow. |
| **VerifyNow** | Seller KYC: SA ID lookup against Home Affairs + selfie face-match | `VERIFYNOW_API_KEY`, `VERIFYNOW_BASE_URL`, `VERIFYNOW_MODE`, `VERIFYNOW_BASIC_REPORT_TYPE` | `VERIFYNOW_MODE` must be `production` in prod — sandbox means identity checks pass on canned data. Boot warns. Prepaid: watch the credit balance. |
| **PUDO** | Locker-to-locker parcel delivery + the locker directory | `PUDO_API_KEY`, `PUDO_API_SECRET`, `PUDO_BASE_URL` | **This is production mode — creating a shipment bills real credits.** |
| **The Courier Guy (TCG)** | Door-to-door delivery | `TCG_API_KEY`, `TCG_BASE_URL`, `TCG_WEBHOOK_SECRET` | Webhooks rejected in production without the secret (fail-closed). |
| **Zoho Books** | Accounting — commission invoices, deal receipts, subscription documents | `ZOHO_BOOKS_*` (client id/secret, refresh token, org id, domains, `ZOHO_BOOKS_ENABLED`) | Documents are not raised; hourly retry crons self-heal once restored. |
| **Google Maps** | Address autocomplete and "use my location" — **frontend only** | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (frontend `.env.local`) | Autocomplete degrades to a plain text field. The key needs **Maps JavaScript + Places + Geocoding** all enabled; missing Geocoding is what broke "use my location" before. |
| **Web Push (VAPID)** | PWA push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | No push. Note the IPv4-first workaround in `main.ts` — this VPS has no global IPv6 and Apple's push endpoint advertises AAAA, which hung silently. |
| **Cloudflare** | DNS, TLS, HSTS (set at the edge, deliberately not in `next.config.mjs`) | — | — |
| **Sentry / UptimeRobot** | Error and uptime monitoring (`/api/health`, which is `@SkipThrottle`d) | — | — |

---

## 9. South African and domain vocabulary

Terms you cannot infer from the code alone.

**SAPS** — South African Police Service. Firearms are licensed and their
movement is recorded by SAPS.

**Dealer transfer** — the only legal way to move a firearm between two private
people who are not standing in front of a dealer. The seller books the firearm
*into* a licensed dealer's stock register; the buyer collects it from a dealer
against their own licence. In this codebase it is `ShippingMethod.DEALER_TRANSFER`
and it is **forced by the backend** for anything `isFirearm` — no courier, no
locker, no meet-up, regardless of what the UI sends.

**SAP 534** — the SAPS form recording a firearm entering or leaving a dealer's
stock register. The platform requires a photo of the completed 534 plus the
stock-register page plus the firearm, verified by Claude vision or an admin,
before it will release the seller's money. See
`backend/src/payments/saps534.service.ts` and `dealer-verification.service.ts`.

**`PRIVATE_ARRANGE`** — buyer and seller go to a dealer together and handle the
paperwork themselves. Legal, but the platform cannot observe it, so payment
protection is waived and funds release at capture. Requires the seller's
recorded consent before it can even be offered.

**Air rifles are not firearms** under South African law. No licence, ships as an
ordinary accessory. Category slug `air-rifles`. Do not fold them into firearm
logic.

**Live ammunition, primers and propellant are banned platform-wide** — never
listed, sold or traded, and the site says so publicly. Empty or once-fired brass
and projectiles/bullets **are** allowed. The moderation service buckets primers
and propellant as `prohibited-content`, deliberately *not* as `live-ammo`, since
they are not ammunition — see `categorizeReason()`.

**PUDO** — a South African parcel-locker network (~2,700 lockers). Sender drops
a parcel in a locker, recipient collects from another with a PIN. Cheap, popular,
and the default for small non-firearm items. The PIN is sent to the seller only.

**The Courier Guy (TCG)** — a national door-to-door courier. The other
non-firearm option.

**Bakkie** — a pickup truck. Ubiquitous here; it appears in brand copy and in
the logo mark. Relevant to freight framing (an oversized item is a "bakkie job",
not a parcel) — `Category.collectionOnly` forces
`ShippingMethod.COLLECTION` for trailers and oversized goods, with funds staying
`HELD` until the buyer confirms collection.

**Province** — SA has nine, and they are a Prisma enum, not free text. Distance
and courier rates depend on them.

**POPIA** — the Protection of Personal Information Act. Why the privacy pages
name the specific legislation regulated-category records are kept under.
**PAIA** — the Promotion of Access to Information Act, which requires a public
access-to-information manual free to *any* requester. That is why
`/regulated-categories` and `/paia` must be reachable signed-out even though
everything else regulated is behind the wall (they carry `noindex` instead).
**ECT Act § 43** — mandates specific supplier disclosures in the footer; that is
why `GunGalore (Pty) Ltd` appears verbatim there while the trading name is
"All Outdoor".

**TPPP** — Third Party Payment Provider. The regulatory status required to hold
and disburse other people's money in South Africa. The reason payments are not
live yet.

**AO PRO** — the single paid membership tier, R99/month. Free accounts get a
demo of every PRO feature.

---

## 10. Invariants you must not break

Things that look like tidying and are not.

1. **`Category.publicVisible` and `Listing.publicVisible` default to `false`.**
   Allowlist, not blocklist. Never flip the default. Never add a public read
   path that skips `publicOnly()`.
2. **Never `revalidate` or `force-cache` a fetch whose result varies by
   viewer.** Use `viewerFetch` / `useViewerFetch`. `sitemap.ts` stays anonymous
   and `force-dynamic`.
3. **Never branch on user-agent.** An auth wall is legitimate; showing a crawler
   something different from a logged-out human is cloaking.
4. **A module with an `AdminJwtGuard` controller imports
   `JwtModule.register({})` and provides the guard.** Otherwise the app
   crash-loops at boot while `tsc` stays happy.
5. **The word "escrow" appears nowhere.** Regulatory, not stylistic.
6. **Firearms and barrels are dealer transfer only.** Enforced in the backend
   regardless of UI input.
7. **KYC is a seller-only gate.** No code path may check `kycStatus` on someone
   who is buying, bidding, or making an offer. It is triggered at first payment
   and *enforced* at payout.
8. **Never expose real names.** Public surfaces show `username` only — never
   `firstName`/`lastName`, never initials, never with an `@` prefix. Fallback is
   "Anonymous bidder" / "Anonymous seller", never a first name. Real names exist
   only inside KYC, paid-transaction internals (dealer paperwork, dispatch
   addresses), post-consent `PRIVATE_ARRANGE` reveal, admin panels, and a user
   seeing their own data. This exists so users cannot find each other off-platform
   and cut the marketplace out of the deal.
9. **`PUBLIC_LISTING_SELECT` is an allowlist.** Never add a column to it without
   deciding, deliberately, that anonymous callers may have it. The header comment
   in `listings.service.ts` lists what must never go in: `reservePrice`,
   `autoAcceptThreshold`, `currentBidderId`, serial/licence fields (including
   `licenceHolderName`, which is the seller's real name), pickup address and
   geolocation, admin moderation notes, and the Claude moderation internals.
   A new column is private by construction until someone adds it here.
10. **Preserve the CAS guards.** Bid placement, auction finalisation, offer
    transitions, `confirmDelivery`, and the order rollup all use conditional
    `updateMany` + `count === 0` checks instead of read-then-write. They are the
    only thing preventing double-release and double-sale under concurrency. A
    refactor to "cleaner" `update()` calls silently removes them.
11. **`publicVisible` stays in `STATIC_LISTING_FILTERABLE_ATTRIBUTES`.** Remove
    it and anonymous search either errors or leaks.
12. **No weapon word in a public category name or slug.**
    `assertNoWeaponWordInPublic` in `prisma/seed.ts` enforces this; rename the
    category rather than weakening the pattern.
13. **New public pages must be added to `isPublicRoute` in
    `frontend/middleware.ts`,** or they redirect to sign-in.
14. **`app.set('trust proxy', 1)`** — a fixed hop count. Do not change to `true`.
15. **One throttler bucket.** Named buckets all evaluate on every request.
16. **Money is integer ZAR cents in the database.**
17. **New modals must be `z-index >= 60`** — the mobile bottom tab bar sits at
    `zIndex: 55`/`56` (`frontend/components/bottom-tab-bar.tsx`) and will
    occlude anything below it.
18. **Feature flags stay `false` until the feature is genuinely ready.** Several
    complete modules (Daily Deals, prize draw, Experiences, Featured Buy Now)
    are deployed and **inert** behind flags in the `Setting` table. Do not flip
    one to see what happens.
19. **Never gate a pm2 restart on a shared `/tmp` marker file.** A stale marker
    triggers a restart mid-build and serves 500s. Wait on the build process
    (`pgrep`) plus a unique per-deploy log, then `curl` twice.
20. **Run `npx prisma generate` before building on any schema-change deploy,**
    and never mask the build's exit code by piping it through `tail`.

---

## 11. Where to start reading

In this order:

1. `backend/src/app.module.ts` — the module list is the map.
2. `frontend/middleware.ts` — what is public, and the reasoning for each entry.
3. `backend/src/listings/listings.service.ts` — the header comment on
   `PUBLIC_LISTING_SELECT`, then `publicOnly()`, then `findById`. This one file
   teaches you the house style: explain *why*, and say what breaks.
4. `backend/prisma/schema.prisma` — heavily commented; the comments carry
   decisions you will not find anywhere else.
5. `backend/src/payments/transactions.service.ts` — long, but it is where the
   money actually moves.
6. `CLAUDE.md` — the rulebook. Read it as decisions and constraints, not as a
   description of the current system.

---

## Documentation drift

Known places where existing documentation contradicts the code. Trust the code.

- **`CLAUDE.md` says the payment provider is "Stitch Express only … do NOT
  reintroduce Peach".** That is out of date. The code integrates **Peach** —
  `PeachModule` in `app.module.ts`, `peach.service.ts`, `peach-signature.ts`,
  `Transaction.peachCheckoutId` / `peachPaymentId` / `peachPayoutId` /
  `peachMerchantRef`, `PEACH_*` env vars, and the Peach warnings in `main.ts`.
  A few stale comments still name Stitch (`transactions.service.ts` line ~65
  says "the gateway is now Stitch"). Peach is the current rail, still inert.
- **`CLAUDE.md`'s environment-variable list is incomplete** and includes
  variables that no longer exist (`ODOO_*`, `STITCH_*`). The reliable list is
  what the code reads: grep `process.env.` under `backend/src/`, cross-checked
  against `backend/.env.example`.
- **`CLAUDE.md` says "no automated AVS"** because Peach's bank-verification
  product was dropped with Peach. Peach BANV has since been rebuilt and
  deployed inert (`handlePeachBanvWebhook`, `bankVerifiedAt`). Manual admin
  review is still the live gate, so the *user-facing* claim in the legal pages
  remains correct — do not upgrade that copy until BANV is actually live.
- **`CLAUDE.md` lists `MessagesModule`-era buyer/seller chat.** Removed. The
  only sanctioned pre-sale dialogue is Claude-moderated Q&A on the listing
  (`ListingQuestionsService`). The Prisma `Message` model is retained dormant
  to preserve historical rows.
- **The root-level `*.md` audit reports are historical.** `AUDIT-2026-06-10.md`,
  `DUMMY-RUN-REPORT.md`, `TAKEALOT-UX-PARITY-REPORT.md`, `LAUNCH_AUDIT.md`,
  `KORAPAY-INTEGRATION.md` and the rest describe states of the world on the day
  they were written. Several describe features that were subsequently removed
  (Wanted, Competitions, manual EFT, the FNB payout batch). Do not treat any of
  them as a specification.
