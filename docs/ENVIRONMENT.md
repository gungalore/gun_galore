# Environment variables

Every environment variable this system reads, what issues it, and what breaks
when it is missing or wrong.

There are two processes and two env files:

| Process  | File                    | Loaded by                                                    |
| -------- | ----------------------- | ------------------------------------------------------------ |
| Backend  | `backend/.env`          | `dotenv.config({ override: true })` at the top of `src/main.ts` |
| Frontend | `frontend/.env.local`   | Next.js, automatically                                        |

`backend/.env.example` and `frontend/.env.example` are the copy-and-fill
templates. They carry names, descriptions and safe placeholders — never a real
value. This document is the reference behind them.

---

## Read this first: five things that will bite you

**1. `ID_HASH_SECRET` is not rotatable.** Change it and every stored South
African ID number becomes permanently undecryptable. Full explanation below.

**2. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are a matched pair.** Change
either and every existing push subscription in the database is dead.

**3. `NEXT_PUBLIC_*` values are inlined at BUILD time.** Next.js substitutes
them into the JavaScript bundle during `next build`. Editing one on the server
and running `pm2 restart` changes nothing — the old value is already compiled
into the served chunks. You must rebuild. Everything without the prefix is read
per-request on the server and does respond to a restart.

Corollary: anything behind `NEXT_PUBLIC_` ships to the browser in plaintext.
Never put a secret there. The web-push public key is deliberately fetched from
`GET /api/push/vapid-public-key` at runtime rather than being given a
`NEXT_PUBLIC_` twin, precisely so the two copies can never drift.

**4. Several variables fail CLOSED.** A missing secret does not degrade the
feature — it refuses. That is the correct behaviour for a signature check, but
it means a blank line in `.env` can look like "the integration is broken" when
it is actually "the integration is protecting you". The fail-closed set:

| Variable              | What refuses                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `JWT_MEMBER_SECRET`   | The whole process, at boot, in production. Hard throw.             |
| `JWT_ADMIN_SECRET`    | The whole process, at boot, in production. Hard throw.             |
| `DIDIT_MODE`          | The whole process, at boot, in production, unless it is `live`. Hard throw. |
| `DIDIT_API_KEY` / `DIDIT_WORKFLOW_ID` | The whole process, at boot, in production. Hard throw. |
| `DIDIT_WEBHOOK_SECRET`| Inbound verification outcomes are dropped unverified → a seller who finished on Didit's page stays `PENDING` forever |
| `TCG_WEBHOOK_SECRET`  | Inbound Courier Guy tracking events rejected in production         |
| `PEACH_SECRET`        | Inbound Peach webhooks rejected → orders never confirm as paid     |
| `HEALTH_PING_SECRET`  | `/api/health/crons` returns 503 rather than 200                    |

`ANTHROPIC_API_KEY` is a special case: it fails *safe* rather than closed.
Without it, listing moderation returns `HUMAN_REVIEW` with confidence 0 instead
of auto-approving. Nothing dangerous gets published; a queue just grows.

**5. `dotenv` runs with `override: true`, on purpose.** Some shells (Git Bash,
PowerShell profiles, agent terminals) export `ANTHROPIC_API_KEY` as an *empty
string*. Without `override`, dotenv sees the name as already defined and
refuses to replace it, leaving an empty value that crashes the Anthropic SDK.
The `.env` file wins over the shell here. If you are debugging "my key is set
but the app disagrees", that is the direction of the override to keep in mind.

---

## Domain glossary for the variable names

Names in here that will not mean anything until you know the domain:

- **SAPS** — the South African Police Service. Firearm ownership is licensed
  per-firearm. A firearm cannot legally change hands directly between two
  private people; it moves through a licensed **dealer**, who books it into
  their stock register and books it back out to the buyer. That is a **dealer
  transfer**, and it is why the shipping module distinguishes a firearm
  hand-off from a normal parcel.
- **SAP 534** — the SAPS form that records that transfer.
- **KYC** — identity verification of sellers. Legally required before money
  moves, and it is why we hold an encrypted SA ID number at all.
- **SA ID number** — a 13-digit national identity number. It encodes date of
  birth, sex and citizenship, so it is high-sensitivity personal information
  under **POPIA** (the SA data-protection act). Hence the encryption.
- **PUDO** — a parcel-locker network. Buyer and seller each use a locker
  instead of a street address. Common here because inter-town home delivery is
  unreliable.
- **The Courier Guy (TCG)** — the door-to-door courier.
- **Peach Payments** — the SA payment gateway. Card pay-in, payouts to seller
  bank accounts, and **BANV** (bank-account name verification — proving the
  seller owns the account before we pay it).
- **Didit** — the identity-verification provider behind seller KYC, and only
  that. It briefly also sent the sign-up e-mail and phone codes; those moved
  back in-house on 2026-09-11 and now go out over Resend and SMSPortal.
- **SMSPortal** — the SA bulk-SMS provider. Load matters here: a lot of users
  transact from an SMS link on a phone with no data.
- **Ask Boet** — the site-wide AI assistant. "Boet" is Afrikaans/SA slang for
  "brother/mate".
- **Zoho Books** — the accounting system invoices and receipts are pushed to.

---

# Backend

## Core runtime

### `NODE_ENV`
**Required.** `development` or `production`.

Not just a logging switch. In `production` it: activates the config gate in
`main.ts`, makes the TCG webhook fail closed instead of allowing unsigned
calls, strips localhost/LAN origins out of the CORS allow-list, and makes
`JWT_MEMBER_SECRET`, `JWT_ADMIN_SECRET` and a **live** `DIDIT_MODE` mandatory —
each of those throws at boot rather than degrading. Local: `development`.

### `PORT`
**Optional**, default `3001`. Nest mounts everything under the global `/api`
prefix, so the real base URL is `http://localhost:3001/api`.

### `FRONTEND_URL`
**Required in production.** Public base URL of the Next.js app, no trailing
slash.

Three consumers: the CORS allow-list in `main.ts`, the absolute links baked
into outbound email and SMS, and the fallback base for Peach's callback URL.
Wrong value → CORS blocks the browser *and* every notification link points at
the wrong host. Defaults vary by call site (`http://localhost:3000` in most,
`https://gungalore.co.za` in the KYC service), which is exactly the kind of
inconsistency you should not rely on — set it.

Local: `http://localhost:3000`.

### `PUBLIC_API_URL`
**Optional.** Public origin of the API itself, used as the Peach
`notificationUrl` and as the base string for webhook signature verification.
Unset → derived as `FRONTEND_URL + '/api'`. Only matters once Peach is live.

> `BACKEND_URL` appears in the live server's `.env` but nothing reads it. It
> was superseded by `PUBLIC_API_URL`.

## Database

### `DATABASE_URL`
**Required.** PostgreSQL 16 connection string, read directly by Prisma.

Gotcha: `pg_dump` and `pg_restore` do not understand Prisma's `?schema=public`
query parameter. Strip it before piping this string into Postgres tooling, or
the dump fails with an unhelpful error.

Local dev needs a real database. See the local-setup notes in the README.

## Auth — members (self-hosted sessions)

There is no identity provider. `backend/src/auth/` owns sign-up, sign-in,
password reset and sessions; `User.id` is the only user identifier. One
variable holds the whole thing up.

### `JWT_MEMBER_SECRET`
**Required in production. HARD-THROWS AT BOOT. Needed by BOTH processes.**

Signs and verifies the member session token — the 15-minute access JWT in the
`ao_at` cookie (`sub` = `User.id`, `sid` = `Session.id`). The rotating refresh
token in `ao_rt` is not a JWT and is not signed with this; only its sha256 is
stored, in `Session.refreshHash`.

`src/auth/member-jwt-secret.ts` is the single source of truth, and `main.ts`
calls it at bootstrap so a misconfigured server fails visibly at startup rather
than 500ing on the first sign-in. In production a missing, empty, or
known-bad-default value throws and the process refuses to start.

⚠️ **It must DIFFER from `JWT_ADMIN_SECRET`.** Set both to the same value and a
member token verifies on an admin route. That is also why there are two
near-identical secret helpers rather than one taking a variable name — one typo
in a shared helper produces exactly that outcome.

⚠️ **The frontend needs the SAME value, and it is deliberately NOT
`NEXT_PUBLIC_`.** `frontend/middleware.ts` and `frontend/lib/auth-server.ts`
verify the session cookie with `jose` before deciding whether to render a page
or bounce to sign-in. Prefixing it would compile the *signing* secret into the
browser bundle, at which point anyone could mint a token for any member.

A mismatch between the two processes fails in the confusing direction: the
backend is perfectly happy, and every protected page 307s the member to sign-in.
Treat a change to this value as one coordinated change across both processes —
and know that it signs everybody out, because no outstanding access token
verifies under the new secret.

Local dev needs nothing: the module substitutes a throwaway dev-only value, and
`middleware.ts` carries the matching fallback, so sign-in works with zero
per-developer config. Generate for production with `openssl rand -hex 32`.

## Auth — Admin (a second, separate JWT)

### `JWT_ADMIN_SECRET`
**Required in production. HARD-THROWS AT BOOT.**

Signs and verifies the `/admin` session token. `src/admin/admin-jwt-secret.ts`
is the single source of truth. In production a missing, empty, or
known-bad-default value throws and the process refuses to start — pm2 will
crash-loop and the reason is in the first lines of the log.

That strictness is deliberate history: the previous code had
`process.env.JWT_ADMIN_SECRET || 'dev-admin-secret-change-in-prod'` duplicated
across four files. If the variable had ever been unset in production, the app
would have signed *and verified* admin sessions with a string committed to this
repository — anyone could forge a SUPERADMIN token.

Local dev needs nothing: the module substitutes a throwaway dev-only value, so
admin login works with zero per-developer config. Generate for production with
`openssl rand -hex 32`.

## SA ID encryption — the one you can never rotate

### `ID_HASH_SECRET`
**Required for KYC. PERMANENTLY DESTRUCTIVE IF CHANGED.**

`src/common/id-crypto.ts` uses this single secret for two jobs:

1. **Encryption key.** HKDF-SHA256 derives a 32-byte AES-256-GCM key from it.
   That key encrypts sellers' 13-digit SA ID numbers at rest in
   `User.idNumberEncrypted` (stored as `[12-byte IV][16-byte tag][ciphertext]`,
   base64).
2. **Hash salt.** `sha256(secret + id)` produces `User.kycIdHash`, which
   carries a database `UNIQUE` constraint — that is how a second account
   claiming the same identity is physically refused at insert time.

Change the secret and **both** break at once. Existing ciphertext will not
decrypt (the auth tag will not verify), and existing hashes will not match
newly computed ones, so duplicate detection silently stops working. There is no
recovery path: the plaintext ID was never stored anywhere else, by design. That
is the POPIA posture — the raw ID is transient, purged entirely once the seller
passes verification, leaving only the hash long-term.

**The rename trap.** The HKDF `info` string is a hard-coded literal in
`id-crypto.ts`:

```ts
crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'gungalore-id-encrypt', 32)
```

A repo-wide search-and-replace of `gungalore` — entirely plausible during the
"All Outdoor" rebrand — changes the derived key with **no compile error, no
runtime error at startup, and no error until the first decrypt of an existing
record fails**. Do not rename that literal. If you must, you need a migration
that decrypts with the old info string and re-encrypts with the new one, run
before the rename ships.

**Local dev:** set it. Any long random string is fine
(`openssl rand -hex 32`), but do not leave it blank, because
`src/kyc/kyc.service.ts` carries its own copy of the hash function with a
fallback salt committed in this repo:

```ts
const salt = process.env.ID_HASH_SECRET || 'gungalore-id-salt-v1-rotate-on-compromise';
```

So with the variable unset, KYC hashing silently succeeds using a public salt,
while `id-crypto.ts` throws. Hashes computed in that state will never match
hashes computed with the real secret. Two implementations of the same hash with
different missing-value behaviour is a wart worth knowing about.

## Identity verification — Didit

One provider, one adapter (`src/didit/`), **one job**: the hosted seller-KYC
session whose verdict comes back by webhook. Base URL
`https://verification.didit.me`.

> ⚠️ **IT USED TO HAVE THREE JOBS.** The sign-up e-mail code and the phone
> code went to Didit in the 2026-09-10 cut-over and came straight back on
> 2026-09-11: $0.03 an e-mail and $0.1048 a ZA SMS on rails already paid for,
> mail arriving under Didit's branding from Didit's domain, and phone
> verification **refused outright until the organisation's first top-up**
> (HTTP 403 - an account state, not a bad number). The e-mail code is now minted
> in `auth.service.ts` and sent by Resend; the phone code is minted in
> `users.service.ts` and sent over SMSPortal. The four adapter methods are
> deleted, not merely unused.

> ⚠️ **VerifyNow is gone**, and so is AWS Rekognition (KYC face-match and Face
> Liveness) with it. `VERIFYNOW_API_KEY`, `_BASE_URL`, `_MODE`,
> `_BASIC_REPORT_TYPE` and `AWS_KYC_LIVENESS_ROLE_ARN` are read by nothing.
> Delete them from a live `.env` rather than leaving them there to look
> load-bearing.
>
> ⚠️ **One capability went with VerifyNow and nothing free replaces it.** It
> returned the applicant's official name and date of birth from **Home
> Affairs**, which let the verdict cross-check the typed details against the
> state rather than only against the uploaded document. Names now come from the
> document Didit reads and the date of birth is checked against the SA ID
> number's own digits. Didit sells the equivalents as `zaf_africa_national_id`
> ($1.10) and `zaf_dha_photo` ($1.10). Until one is turned on, **no user-facing
> copy may claim a Home Affairs verification.**

### `DIDIT_API_KEY`
**Required in production — throws at boot when unset.** The application key
from the Didit console, sent as the `x-api-key` header.

⚠️ **A bad or missing key returns 403, not 401**, on this API. Anyone grepping
logs for 401s to diagnose a credential problem finds nothing.

⚠️ **Local dev does need one, and this is the one integration that is not
optional any more.**

> ⚠️ **NO LONGER TRUE, 2026-09-11.** Sign-up goes through Resend now, and
> with no `RESEND_API_KEY` the code is printed to the server log instead of
> sent - so a fresh clone can register and verify with no third-party account
> at all. That fallback is **disabled in production**: a prod box missing the
> mail credential must fail the sign-up loudly, not log every new member's code
> where anyone with log access can read it. A Didit key is still needed to
> exercise **seller KYC**, which is deliberately NOT stubbed, because a canned
> identity pass is worse than none.

`DIDIT_MODE` defaults to `sandbox` outside production, which is free, but it
still calls the real API with a real key.

### `DIDIT_WORKFLOW_ID`
**Required in production — throws at boot when unset.** The published KYC
workflow that `POST /v3/session/` runs against.

⚠️ **It must be a NON-white-label workflow.** Didit's free tier gives 500/month
each of `id_verification`, `passive_liveness`, `face_match` and `ip_analysis`.
Setting `is_white_label_enabled: true` adds $0.20 a session **and drops the
workflow out of the free tier entirely** — $0.56 instead of $0.00 for the same
verification. Check it in the console before pointing production at a new id.

### `DIDIT_WEBHOOK_SECRET`
**Required in production. FAILS CLOSED.** Per-destination HMAC-SHA256 signing
secret (console → API & Webhooks) for `POST /api/webhooks/didit`, which is how
the verdict actually arrives — not from the request that created the session.

Unset or wrong → outcomes cannot be verified and are dropped, so a seller who
finished on Didit's page stays `PENDING` forever and can never be paid out.
A bad signature returns **200** with the handler skipped, never a 401 — the same
house rule as the Peach webhooks, so there is nothing to grep for.

⚠️ **Not an env var, but it belongs here:** Didit delivers from the single
static IP **`18.203.201.92`** (`User-Agent: DiditWebhook/2.0`). Cloudflare's WAF
must allow it, or every delivery is dropped at the edge with nothing in any
application log.

### `DIDIT_MODE`
**Required in production. HARD-THROWS AT BOOT unless it is `live`.** `sandbox`
(free, canned outcomes) otherwise, which is the default when unset.

That strictness is deliberate history. The provider this replaced defaulted to
sandbox and production boot only *logged* an error, so a production box could —
and did — run with sandbox identity checks, approving canned data with nobody
the wiser. A verification rail that is silently fake is worse than one that is
visibly down. Do not add a softer second copy of this check; that is how the
hard one gets deleted.

### `DIDIT_BASE_URL`
**Optional**, default `https://verification.didit.me`. Override only if Didit
moves the verification API.

⚠️ Note this is **not** `apx.didit.me`, which is the account-management host and
uses a different auth scheme entirely (`Authorization: Bearer`, not
`x-api-key`).

## AI — Anthropic

### `ANTHROPIC_API_KEY`
**Effectively required in production. Degrades, does not crash.**

Powers Ask Boet, listing moderation, the Q&A contact-detail filter,
firearm-licence verification, dealer verification, swap proof-of-possession,
price estimates and reloading load-data extraction. **Not identity documents** —
Didit reads those as part of its own session.

Missing, and every one of those degrades to a manual or blocked path:

- Listing moderation returns `HUMAN_REVIEW` with confidence 0 — nothing
  auto-publishes, an admin queue grows.
- The contact-detail filter falls back to its regex layer only, so buyers and
  sellers can leak phone numbers past it more easily.
- Description enhancement returns the text unchanged.
- Ask Boet goes quiet.

`main.ts` logs a WARN at boot. Local: optional; the app is fully usable without
it, you just see the degraded paths.

### `ANTHROPIC_ADMIN_API_KEY`
**Optional.** A *separate* Anthropic **admin** key (Console → Admin keys,
prefix `sk-ant-admin`), used only by the AI spend monitor on `/admin/credits`.

⚠️ Operator note: production currently has a regular API key in this slot. The
usage endpoint rejects a regular key, so spend alerts are not actually
functioning. Someone with Console owner access needs to mint a real admin key.

### `ANTHROPIC_MODEL_*` and `HB_RANGE_OPUS_THRESHOLD`
All **optional**. Each falls back to a default written into the calling
service. Set them to pin a model version or to cost-tune. A typo produces a
runtime 404 from the Anthropic API, not a build error — so if an AI feature
stops working right after someone "tidied the env", check these first.

| Variable | Default | Used for |
| --- | --- | --- |
| `ANTHROPIC_MODEL_SIMPLE` | `claude-haiku-4-5-20251001` | Cheap first pass: listing moderation, Q&A, contact filter |
| `ANTHROPIC_MODEL_JUDGE` | `claude-sonnet-4-6` | Escalated pass: firearm-licence / dealer / swap-proof vision, OCR backfill |
| `ANTHROPIC_MODEL_PRICE_ESTIMATE` | `claude-haiku-4-5-20251001` | Suggested listing price |
| `ANTHROPIC_MODEL_LOADDATA` | `claude-sonnet-4-6` | Reloading-manual data extraction |
| `ANTHROPIC_MODEL_INSIGHTS_DIGEST` | `claude-sonnet-4-6` | Weekly analytics digest |
| `ANTHROPIC_MODEL_ASK_GG_LANE` | `claude-haiku-4-5-20251001` | Ask Boet intent router |
| `ANTHROPIC_MODEL_ASK_GG_DEFAULT` | `claude-sonnet-4-6` | Ask Boet normal answers |
| `ANTHROPIC_MODEL_ASK_GG_ESCALATED` | `claude-opus-4-8` | Ask Boet hard questions |
| `ANTHROPIC_MODEL_HB_RANGE_DEFAULT` | `claude-sonnet-4-6` | Hunt Ballistics range estimator |
| `ANTHROPIC_MODEL_HB_RANGE_FALLBACK` | `claude-opus-4-8` | Range estimator escalation |
| `HB_RANGE_OPUS_THRESHOLD` | `0.7` | Confidence below which the estimator escalates to Opus. Opus is ~5× the cost, so this is a money dial. |

## Images — Cloudinary

### `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
**All three required together.** From the Cloudinary dashboard → Settings → API
Keys.

Any one missing → `CloudinaryService` logs "image upload disabled" at boot and
every upload throws `Cloudinary not configured`. Since a listing cannot be
created without photos, this is required even for meaningful local work. A free
Cloudinary account is enough for development.

## Search — Meilisearch

### `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY`
**Optional.** Unset host → `SearchService` logs "search disabled" and the app
runs fine without it: browse, filter and category pages work off Postgres, but
the search box returns nothing. Acceptable for most local work; run Meilisearch
1.44 locally if you are touching search. Default in the health check is
`http://localhost:7700`.

## SMS — SMSPortal

### `SMSPORTAL_CLIENT_ID` / `SMSPORTAL_API_SECRET`
**Required in production.** Both, or SMS is disabled and every send becomes a
silent no-op.

That matters more than it sounds: SMS-link checkout, the courier waybill and
collection PIN, and the buyer shipping notification all ride this channel, and
a meaningful share of users transact entirely from an SMS on a phone with no
data. Missing SMS is not a cosmetic degradation.

`SMSPORTAL_API_KEY` is a **legacy alias** still read as a fallback for
`SMSPORTAL_CLIENT_ID`. Prefer the client-ID name for new setups.

`SMSPORTAL_BASE_URL` is **optional**, default `https://rest.smsportal.com/v1`.

Local: leave blank. Sends no-op and log.

## Email — Resend

### `RESEND_API_KEY`
**Required in production.** Unset → "emails disabled"; sends become no-ops.
The in-app notification inbox still fills, so locally nothing looks broken.

### `SUPPORT_EMAIL`
**Optional**, default `support@gungalore.co.za`. Reply-to / support address in
outbound mail.

### `EMAIL_LOGO_URL`
**Optional.** Absolute URL of the logo in email templates. Only needed locally
if you want images to render in a test email — a mail client cannot reach
`localhost:3000`.

## Web push — VAPID

### `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
**Optional, but a MATCHED PAIR.**

Generate once with `npx web-push generate-vapid-keys` and then leave them
alone. Browser push subscriptions are cryptographically bound to the public key
that created them. Change either value and **every row in the push-subscription
table becomes undeliverable** — affected users have to re-grant notification
permission before they receive another push, and there is no way to prompt them
for it except in-app.

Missing → "push notifications disabled" and sends are silent no-ops. The inbox,
email and SMS channels are unaffected, so this is safe to skip locally.

The frontend gets the public key from `GET /api/push/vapid-public-key` at
runtime. There is deliberately no `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — a build-time
copy of a key that must match the server's is a drift bug waiting to happen.

### `VAPID_SUBJECT`
**Optional**, default `mailto:support@gungalore.co.za`. A `mailto:` URL
identifying us to the Apple and Google push gateways.

> Related, and not an env var: `main.ts` forces IPv4-first DNS resolution
> (`dns.setDefaultResultOrder('ipv4first')` plus disabling
> `autoSelectFamily`). The production VPS has no global IPv6 address, and
> Apple's push endpoint advertises AAAA records, so Node's happy-eyeballs was
> racing an IPv6 connection that could only hang. That silently broke iOS push.
> Do not remove those two lines.

## Shipping — PUDO (lockers)

### `PUDO_API_KEY`, `PUDO_API_SECRET`, `PUDO_BASE_URL`
`PUDO_API_KEY` **required for locker shipping**; secret and base URL
**optional** (base URL defaults to `https://api-pudo.co.za`).

⚠️ **PUDO has no sandbox.** Creating a shipment bills real credits against the
operator's live account. There is no test mode to fall back on, so do not
exercise the create path casually and do not point local development at a real
key unless you intend to spend money.

Missing key → shipment creation is skipped and logged, which is the safe local
default.

## Shipping — The Courier Guy (door-to-door)

### `TCG_API_KEY`, `TCG_BASE_URL`
Key **required for door shipping**; base URL **optional**, default
`https://api.portal.thecourierguy.co.za`.

### `TCG_WEBHOOK_SECRET`
**Required in production. FAILS CLOSED.** Shared secret TCG sends back in the
`x-tcg-webhook-secret` header on every tracking event.

In production, unset → the webhook rejects everything, so shipments never
advance state. (This used to short-circuit the check entirely when unset,
meaning anyone could POST shipping events; that is fixed.) In development,
unset is allowed through so local testing works without the secret wired.

The endpoint always returns HTTP 200 even when rejecting — a house rule, so a
carrier's retry queue does not back up against us.

## Payments — Peach

Peach is the only payment provider: Checkout V2 for pay-in, Payouts for seller
disbursement, BANV for bank-account ownership verification. **Leave the
credentials blank and checkout runs in mock mode — the entire app is usable and
no money moves.** That is the current production state.

| Variable | Required | Notes |
| --- | --- | --- |
| `PEACH_ENV` | Optional | Literal `live` selects the production hosts; anything else selects the sandbox hosts. |
| `PEACH_CLIENT_ID` | For live payments | OAuth client-credentials, Dashboard → Checkout → Settings. Shared by checkout, payouts and BANV. |
| `PEACH_CLIENT_SECRET` | For live payments | |
| `PEACH_MERCHANT_ID` | For live payments | Rides in the payouts URL path. |
| `PEACH_ENTITY_ID` | For live payments | The checkout channel/entity id. |
| `PEACH_SECRET` | **FAILS CLOSED** | See below. |

### `PEACH_SECRET`
The "secret token" that signs checkout creates and refunds, and verifies
inbound webhook signatures. Set the same value in the Peach Dashboard under
Webhook security.

Fails closed: unset in production → inbound Peach webhooks are **rejected**, so
a forged webhook can never mark an order paid. The flip side is that a missing
secret also stops *real* payments from ever confirming. If payments are taken
but nothing settles, check this first.

Webhook URLs to register in the Peach Dashboard:

```
/api/payments/webhook/peach          checkout lifecycle
/api/payments/webhook/peach-payout   payout status
/api/payments/webhook/peach-banv     bank verification result
/api/payments/webhook/peach-dispute  chargebacks
```

### `PAYMENT_MODE` and `PAYMENTS_LIVE`
The two rail selectors, both **off by default because the site is not trading
yet**. `src/payments/payment-mode.ts` is the seam.

- `PAYMENT_MODE=paygate` → card-rate fee maths and the card-reversal refund
  arm. Anything else → `manual`, the pre-paygate fee shape. This changes
  *money arithmetic*, not just a label.
- `PAYMENTS_LIVE=true` → opens checkout and enables payout disbursement. While
  false, every checkout entry point returns 503 "card payments launching soon".
  The accounting engine underneath is unchanged and rail-agnostic; only the
  entry gate moves.

Going live is therefore: fill the Peach credentials, `PEACH_ENV=live`,
`PAYMENT_MODE=paygate`, `PAYMENTS_LIVE=true`. All four, or the behaviour is
inconsistent.

Keep the frontend's `NEXT_PUBLIC_PAYMENT_MODE` in step — the backend is the
authority, the frontend flag only decides what the buyer is shown.

## Accounting — Zoho Books

### `ZOHO_BOOKS_ENABLED`
**Optional**, default off. Must be the literal string `true`.

Gotcha worth knowing: if it is `true` but any credential is blank, the service
logs "credentials are missing — disabling" and turns itself off rather than
throwing. A half-filled config is indistinguishable from "off" unless you read
the boot log.

### `ZOHO_BOOKS_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_ORG_ID`
Required when enabled. The refresh token is long-lived; the service exchanges
it for access tokens.

### `ZOHO_BOOKS_API_DOMAIN` / `ZOHO_BOOKS_ACCOUNTS_DOMAIN`
**Optional**, defaults `https://www.zohoapis.com` and
`https://accounts.zoho.com`. Zoho is region-sharded — these change if the
organisation lives on `.eu`, `.in` etc. Ours is on the `.com` data centre.

## Reloading-manual library

### `RELOADING_MANUALS_INBOX_DIR` / `RELOADING_MANUALS_STORAGE_DIR`
**Optional.** Absolute filesystem paths on the server.

The workflow is deliberately manual: the operator SCPs manual PDFs into the
inbox directory, the ingest job OCRs them and moves each one into the storage
directory under a random hex filename.

Defaults are resolved relative to the backend process's working directory:
`../manual-inbox` and `../manuals`. That is why the repo root contains a
`manual-inbox/` directory — it is the default inbox when you run the backend
from `backend/`.

### `OCR_CHUNK_PAGES`
**Optional**, default `6`. Pages per Claude call during OCR backfill. Higher =
fewer calls but larger requests.

## Operational secrets

### `HEALTH_PING_SECRET`
**Optional but strongly recommended. FAILS CLOSED.** Query-string key for
`GET /api/health/crons`, the unauthenticated endpoint an external uptime
monitor polls to check that every monitored cron has run recently.

Unset, or a mismatched `?key=`, returns **503 `{ ok: false, error: 'not
configured' }`** — not 200. That is intentional: a monitor wired up before the
secret exists should alarm loudly rather than report a false healthy. When
configured, it returns 503 with the list of stale cron names if any cron has
gone quiet, 200 otherwise.

### `COMING_SOON_BYPASS_SECRET`
Present in the backend env file **only** so both processes can be deployed from
one file on the server. Nothing in the backend reads it. The frontend owns this
— see below.

---

# Frontend

Remember: everything prefixed `NEXT_PUBLIC_` is compiled into the bundle at
build time and is visible to the browser. Changing one requires a rebuild, not
a restart.

## API endpoints

### `NEXT_PUBLIC_API_URL`
**Required.** Browser-visible base URL of the backend. Note it **includes the
`/api` prefix** — Nest sets that globally, so the value is
`http://localhost:3001/api`, not `http://localhost:3001`. Default when unset is
`http://localhost:3001/api`, which is why a fresh clone mostly works.

### `INTERNAL_API_URL`
**Optional but set it in production.** Base URL used by Server Components and
route handlers, so server-rendered fetches talk to the backend over loopback
instead of going out through the public hostname, nginx and Cloudflare and back
in. Falls back to `NEXT_PUBLIC_API_URL`, then `http://localhost:3001/api`.

Production value: `http://127.0.0.1:3001/api`.

## Member sessions

### `JWT_MEMBER_SECRET`
**Required. Must be the SAME value as the backend's.**

The frontend does not mint sessions — it *verifies* them. `middleware.ts` reads
the `ao_at` cookie and checks it with `jose` to decide whether to render a page
or bounce to `/sign-in`; `lib/auth-server.ts` does the same for server
components. A mismatched pair fails in the confusing direction: the API is
perfectly happy, and every protected page 307s the member back to sign-in.

⚠️ **No `NEXT_PUBLIC_` prefix, ever.** This is the *signing* secret, and the
prefix would compile it into the browser bundle — at which point anyone could
mint a token for any member. It is the one variable in this half of the document
that must never be browser-visible.

Local dev needs nothing: `middleware.ts` falls back to the same throwaway string
`backend/src/auth/member-jwt-secret.ts` uses, so a fresh clone signs in.

There are no other member-auth variables. The sign-in, sign-up, verify-email,
forgot-password and reset-password routes are ordinary pages in this app, and
the cookie names (`ao_at`, `ao_rt`) are constants in the code, shared with the
backend by being written down in both — see the comment in `middleware.ts`.

## Maps

### `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
**Optional.** Browser key for address autocomplete.

The key needs **three** APIs enabled in Google Cloud: Maps JavaScript,
**Places**, and **Geocoding**. Geocoding is the one people forget, and its
absence is not obvious — the map loads, autocomplete works, and only "use my
location" silently fails.

Unset, or the literal string `placeholder`, disables autocomplete and the
component degrades to a plain text address field. That is a supported state, so
local development does not need a real key.

## The coming-soon gate

Enforced in `frontend/middleware.ts`, **before** the session check runs. When active,
any request that is not allowed through is **rewritten** (not redirected) to
`/coming-soon`, with an `X-Robots-Tag: noindex, nofollow` header. Rewrite so
the URL the visitor typed stays in the address bar; `noindex` so Google does
not record "Coming Soon" as the canonical content for every URL on the site,
which only repairs after a post-launch recrawl.

### `COMING_SOON_GATE`
**Optional.** The literal string `on` enables the gate. Anything else = off.

Three ways through when it is on:

1. The path is always-allowed: `/a/*` (SMS action links — the token in the URL
   *is* the credential), `/api/*`, `/admin*`, `/coming-soon`, `/preview`.
2. The path is token-authed: `/checkout/*?t=`, `/kyc/verify?t=`, and
   `/checkout/complete` unconditionally — that last one is where the payment
   gateway returns the buyer, carrying no token and possibly no session.
3. The visitor holds the `gg-preview` cookie matching the bypass secret.

### `COMING_SOON_BYPASS_SECRET`
**Required whenever the gate is on.** Visit `/preview?key=<value>` to be issued
the `gg-preview` cookie; middleware compares the cookie value against this
variable.

Unset while the gate is on → nobody can bypass, including you. Rotate by
changing the value and re-issuing the cookie through `/preview`.

## Feature flags and build-time switches

### `NEXT_PUBLIC_ASKGG_CONTEXT`
**Optional.** Literal `true` sends the current page's context along with an Ask
Boet question so the assistant knows what the user is looking at. `true` in
production.

### `NEXT_PUBLIC_PAYMENT_MODE`
**Optional.** `paygate` makes the checkout UI render the card path; anything
else renders the manual path. Mirror of the backend's `PAYMENT_MODE`. The
backend is the authority — this only decides what the buyer is shown, so a
mismatch produces a UI that offers a path the API will refuse.

### `NEXT_PUBLIC_DISABLE_PWA`
**Optional kill switch.** Literal `true` does two things at once: Serwist skips
generating `/sw.js` at build time, *and* the client helper unregisters any
service worker already installed on a returning visitor. That double action is
the remote kill for a bad service worker — ship a build with this set and
existing clients clean themselves up. Leave unset normally.

The service worker is only built in production anyway; `next dev` uses
Turbopack, which does not run the Webpack-based Serwist plugin.

### `NEXT_PUBLIC_SITE_URL`
**Optional but set it for any non-production deploy.** Canonical public origin
used for `sitemap.xml`, `robots.txt`, OpenGraph tags and JSON-LD. No trailing
slash. Falls back to `https://gungalore.co.za` — so an unset staging build
advertises production URLs to crawlers.

### `NEXT_PUBLIC_APP_URL`
**Required in every environment**, and the fallback is a trap. It is the base
`middleware.ts` builds its sign-in bounce on — pinned to a configured URL
rather than the inbound `Host` header precisely so a spoofed Host cannot turn
that bounce into an open redirect — so it governs **every protected route**,
not just the absolute redirect out of `/admin/logout` this entry used to
describe.

⚠️ **The fallback is `https://gungalore.co.za`, the RETIRED domain**, not
`http://localhost:3000` as previously documented. Unset, every signed-out
visit to a protected route lands on a host that answers 522/410. It **is** set
in `frontend/.env.production` on the box (verified 2026-09-10); it is easy to
leave out of a new environment, and locally its absence is the reason a fresh
`frontend/.env.local` cannot complete a sign-in — the API answers 200 and the
page bounces anyway.

---

# Reconciliation notes, 2026-08-12

> **Addendum, 2026-09-10 — the auth and KYC cut-over.** Clerk, VerifyNow and
> AWS Rekognition were all removed on the same day, so a further **ten** names
> joined the dead list below and must be **deleted from the live `.env`**:
>
> | Dead name | Rotate? |
> |---|---|
> | `CLERK_SECRET_KEY` | 🔑 **yes** |
> | `CLERK_WEBHOOK_SECRET` | 🔑 **yes** |
> | `CLERK_AUTHORIZED_PARTIES` | no — not a secret |
> | `VERIFYNOW_API_KEY` | 🔑 **yes** |
> | `VERIFYNOW_BASE_URL` | no |
> | `VERIFYNOW_MODE` | no |
> | `VERIFYNOW_BASIC_REPORT_TYPE` | no |
> | `AWS_ACCESS_KEY_ID` | 🔑 **yes** — delete the IAM user |
> | `AWS_SECRET_ACCESS_KEY` | 🔑 **yes** — delete the IAM user |
> | `AWS_REGION` | no |
> | `AWS_KYC_LIVENESS_ROLE_ARN` | no — an ARN, not a credential |
>
> ⚠️ **Rotating is not the same as deleting, and only rotating actually does
> anything.** Every 🔑 above is a live credential that has been sitting in a
> file on disk; removing the line from `.env` leaves it working for anybody
> who already has it. Kill each one at its provider.
>
> ⚠️ **`AWS_REGION` and `AWS_ACCESS_KEY_ID` were missing from this list until
> 2026-09-10.** Only `AWS_KYC_LIVENESS_ROLE_ARN` was named, which reads as
> though the AWS *credentials* were still in use — they are not. Nothing under
> `backend/src/` reads any `AWS_*` name; `aws-kyc.service.ts` and `infra/aws/`
> are deleted. `backend/.env.example` carries the same list under its
> `─── RETIRED ───` section; the two are meant to stay in step.
>
> Two names went the other way and **must be set before the next production
> boot, or the process refuses to start**: `JWT_MEMBER_SECRET` (on **both**
> processes, same value, different from `JWT_ADMIN_SECRET`) and the `DIDIT_*`
> set with `DIDIT_MODE=live`.

## Backend: variables on the live server that no code reads

Verified by grep across `backend/`, `frontend/` and `scripts/`. These are
listed, commented out, at the bottom of `backend/.env.example` so the next
person comparing server to repo knows they are dead rather than missing.

| Variable | Why it is dead |
| --- | --- |
| `BACKEND_URL` | Superseded by `PUBLIC_API_URL` |
| `GOOGLE_MAPS_API_KEY` | Maps are frontend-only (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) |
| `STITCH_CLIENT_ID`, `STITCH_CLIENT_SECRET` | Stitch was replaced by Peach. Only `scripts/stitch-redirect-setup.cjs`, a one-off setup script, still references them |
| `FNB_ACCOUNT_SUFFIX` | The FNB payout-batch rail was stripped in July 2026 |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD` | No IMAP client exists in the codebase |
| `PEACH_ACCESS_TOKEN`, `PEACH_BASE_URL` | Not the Peach auth model that was built; the code uses `PEACH_CLIENT_ID`/`PEACH_CLIENT_SECRET` + `PEACH_ENV` to select hosts |
| `ODOO_URL`, `ODOO_DB`, `ODOO_API_KEY` | Odoo was replaced by Zoho Books. These were in the old `.env.example` too and have been removed from it |

**Operator action:** when you delete these from the server, *rotate*
`STITCH_CLIENT_SECRET` and the IMAP password rather than simply removing them.
They were real credentials and have been sitting in a file on disk.

## Backend: variables the code reads that were undocumented

These are now in `backend/.env.example`. Several are also absent from the live
server, meaning the feature is running on its coded default:

`ANTHROPIC_ADMIN_API_KEY`, all ten remaining
`ANTHROPIC_MODEL_*`, `HB_RANGE_OPUS_THRESHOLD`, `PEACH_ENV`,
`PEACH_CLIENT_ID`, `PEACH_CLIENT_SECRET`, `PEACH_MERCHANT_ID`, `PEACH_SECRET`,
`PAYMENTS_LIVE`, `PUBLIC_API_URL`, `PUDO_API_SECRET`, `TCG_BASE_URL`,
`SMSPORTAL_API_KEY`, `SMSPORTAL_BASE_URL`,
`LOW_CREDIT_THRESHOLD`, `SUPPORT_EMAIL`, `EMAIL_LOGO_URL`, `OCR_CHUNK_PAGES`,
`HEALTH_PING_SECRET`.

Worth flagging: the live server has `PEACH_ACCESS_TOKEN` and `PEACH_BASE_URL`
but **not** `PEACH_CLIENT_ID`, `PEACH_CLIENT_SECRET`, `PEACH_MERCHANT_ID` or
`PEACH_SECRET`. That is consistent with Peach being deployed inert — checkout
is in mock mode and no money moves — but it means the variables currently set
for Peach on production are the wrong ones. When the operator wires the real
credentials, they need the five names in this document, not the two on the
server.

## Frontend

`frontend/.env.example` previously documented ten keys. Added, all read by
code: `INTERNAL_API_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`,
`COMING_SOON_GATE`, `COMING_SOON_BYPASS_SECRET`, `NEXT_PUBLIC_PAYMENT_MODE`,
`NEXT_PUBLIC_DISABLE_PWA`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`.

The last four are read by code but are **not set on the live server**, so
production is running on their fallbacks. `NEXT_PUBLIC_SITE_URL` falling back
to `https://gungalore.co.za` happens to be correct today; it will silently stop
being correct the moment there is a staging environment or the
`alloutdoor.co.za` domain move happens.

⚠️ **Correction, 2026-09-10: `NEXT_PUBLIC_APP_URL` IS set on the live server**
— checked directly in `frontend/.env.production`. The claim above is wrong for
that one name, and wrong in the direction that matters: its fallback is the
retired `gungalore.co.za`, and it now backs the member sign-in bounce on every
protected route, so "production is running on the fallback" would have meant a
live site redirecting signed-out visitors to a dead host. See its own entry
above. The other three are unre-checked.

---

# Minimum viable local `.env`

To get the app running locally with no third-party accounts:

**`backend/.env`**

```
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gun_galore?schema=public
ID_HASH_SECRET=<openssl rand -hex 32>
DIDIT_API_KEY=<a sandbox key from the Didit console>
DIDIT_WORKFLOW_ID=<the workflow that key points at>
```

`JWT_MEMBER_SECRET` and `JWT_ADMIN_SECRET` can both stay blank — dev substitutes
a throwaway for each, and the frontend carries the matching member fallback, so
sessions work with no config at all.

⚠️ **`DIDIT_API_KEY` is the one third-party value local dev genuinely needs.**
⚠️ **Not since 2026-09-11** - sign-up no longer touches Didit. With no
`RESEND_API_KEY` the verification code is logged rather than sent, so a fresh
clone can register and verify unaided (the fallback is off in production).
`DIDIT_API_KEY` is still required to exercise **seller KYC**, which has no stub
on purpose. Sandbox mode is free. Everything else logs a "disabled" warning at
boot and no-ops: you
will not have image upload (so you cannot create listings), search, email, SMS,
push, shipping, payments or AI, but the server boots and the app renders.

Add `CLOUDINARY_*` as soon as you need to create a listing. Add
`ANTHROPIC_API_KEY` when you want listings to auto-moderate instead of queueing
for human review.

**`frontend/.env.local`**

```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
INTERNAL_API_URL=http://localhost:3001/api
```

Both may be omitted — they are also the coded fallbacks. If you set
`JWT_MEMBER_SECRET` in `backend/.env`, set the **same value** here too, or the
middleware cannot verify the cookie the backend issued and every protected page
bounces you to sign-in while the API works perfectly.
