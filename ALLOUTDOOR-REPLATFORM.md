# All Outdoor — Clean-Slate Build Runbook

> **Origin IP addresses are deliberately not written down here.** The site sits behind
> Cloudflare with an Origin Certificate, and that model depends on the origin address
> staying private — publish it and anyone can bypass the WAF and hit the box directly. Git
> history keeps whatever you commit, forever, even if you edit it out later. The real
> values live in the operator's password manager and in `~/.ssh/config` on the machines
> that need them. Throughout this document, `<NEW_ORIGIN_IP>` and `<OLD_ORIGIN_IP>` are
> placeholders you substitute as you go.

> **This document replaces the migration runbook that used to live at this path.** That
> one was written for a rebrand of the *same* legal entity — it preserved users,
> transferred the Clerk application, kept the Zoho ledger, protected Cloudinary URLs, and
> told you to open rename tickets with Pudo and The Courier Guy. Every one of those
> instructions is now wrong. If you have a copy or a memory of it, discard it.

---

## 1. What this is

A **clean-slate build of an existing codebase under a new company**.

The operator has registered **ALLOUTDOOR (PTY) LTD, reg 2026/639713/07** at CIPC. The old
company, **GunGalore (Pty) Ltd, reg 2026/393321/07**, is being wound down. A new legal
entity cannot trade on the old company's merchant accounts, bank account or accounting
ledger, so every commercial relationship restarts from zero. That is not a preference; it
is what a separate juristic person means.

This is not a server migration and it is not a rebrand. It is the same code, deployed
fresh, on a new box, against a new empty database, under a new company.

**The one sentence that makes it safe: production holds 6 users, 5 listings, zero orders,
zero transactions and zero ratings.** Nothing has ever been sold. Losing all user data is
accepted and expected. Almost every hard problem in a normal migration — session
continuity, ledger foreign keys, in-flight parcels, encrypted ID numbers, historical
invoices — simply does not exist here. Read that sentence again whenever a step in this
document looks suspiciously easy. It is easy because there is nothing to preserve.

What is genuinely hard is everything the clean slate does *not* help with:

| The hard part | Why |
|---|---|
| Peach + Nedbank TPPP | Restarts from zero under the new entity. Weeks to months. Gates trading entirely. |
| Bob Go courier integration | Pudo and The Courier Guy are both dropped. This is a real build, not a config change. 38–52 developer-days. See section 4. |
| Legal documents | New AML/RMCP policies, new TPPP application, new Information Officer. Human work, attorney turnaround. |
| Email sending reputation | A zero-history domain on a zero-history account. Multi-day warm-up floor, cannot be compressed. |

Alongside all of that, the box itself — provisioning, database, deploy — is roughly a day
and a half of work. Do not let its simplicity set the schedule.

### Two blockers that exist right now

| Blocker | Why it stops everything | Fix |
|---|---|---|
| **Ports 22, 80, 443 are CLOSED on the new VPS** | No SSH, no install, no TLS certificate, no test. Nothing in section 5 can begin. | Open all three in the Absolute Hosting firewall panel **and** in the box's own `ufw`. Verified in Phase 1, Step 1. |
| **Unpaid R53.06 invoice at Absolute Hosting** | The VPS can be suspended without warning, potentially mid-build. | Pay it today and put a card on file or a debit order behind it. Screenshot the paid status. |

Neither is technically interesting. Both will stop you dead.

---

## 2. What carries over, and what must not

### Code: yes, all of it

The repository moves across unchanged. `frontend/lib/brand.ts` and
`backend/src/common/brand.ts` already carry `LEGAL_ENTITY = 'ALLOUTDOOR (PTY) LTD'` and
`LEGAL_REG_NO = '2026/639713/07'`, and 40 references across 12 legal pages plus the footer
already use them.

One stale comment to fix: `backend/src/common/brand.ts:5-7` still says *"The registered
company is still GunGalore (Pty) Ltd"*. That was true a week ago and is now false. The
frontend mirror at `frontend/lib/brand.ts:1-23` has the correct version — copy its framing
across.

> **Never search-and-replace the bare string `gungalore`.** Only ever replace
> `gungalore.co.za`. Two crypto constants are hard-coded literals containing that word —
> the HKDF info string `'gungalore-id-encrypt'` at `backend/src/common/id-crypto.ts:38`
> and the default salt at `backend/src/kyc/kyc.service.ts:34`. A blind rename changes the
> bytes both produce, silently, with no error. On an empty database that is harmless today
> and permanently destructive the day after the first seller completes KYC.

### Reference data: six tables, and most of them are already in the repo

This is better news than the brief assumed. Four of the six regenerate from files that are
already committed and version-controlled:

| Table | Prod rows | Source | Action |
|---|---|---|---|
| `ManualLoad` | 50,789 (42 MB) | `backend/prisma/seed-data/manual-loads.jsonl` — 51,551 rows committed | **Import from repo.** `scripts/import-loads.ts` validates and drops malformed rows, which is why 51,551 in becomes ~50,789 out. |
| `ReloadingManualPage` | 3,894 (41 MB) | Extracted from the PDFs by `pdf-parse`, locally, free | **Export from prod** (see below). Re-ingest is possible but re-derives the manual metadata too. |
| `ReloadingManual` | 19 | The PDFs on disk at `~/app/manuals/` | **Export from prod + rsync the PDFs.** Both, not either. |
| `CartridgeSpec` | 256 | `backend/prisma/seed-data/cartridge-specs.json` — exactly 256 rows | **Seed from the committed JSON.** See the warning below. |
| `Category` (+ `CategoryAttribute`, `CategoryRelation`) | 188 | `backend/prisma/seed.ts` — the canonical tree is code | **Run the seed.** |
| `Setting` | 54 | Admin-written overrides; code defaults live in `backend/src/settings/settings.service.ts` | **Export as CSV and re-apply deliberately**, row by row. These are your feature flags. |

> **CartridgeSpec — read this before touching it.** A 43-agent audit found 12 dangerous
> chamber/pressure mismatches (`.308 Win` matched to `.308 Marlin Express`, `8×57` matched
> to `.338 Mauser`, and ten more). They were fixed by an `OVERRIDES` map at
> `backend/scripts/build-cartridge-specs.ts:51-65`, and the corrected output was committed
> as `prisma/seed-data/cartridge-specs.json`.
>
> **Never run `scripts/build-cartridge-specs.ts`.** It re-derives the table from the raw
> GRT CSV and depends on a live database for the cartridge-key list. Run only
> `scripts/seed-cartridge-specs.ts`, which loads the verified JSON. Then export the table
> from production as well and diff the two — 256 rows each way, and any difference is a
> question, not a rounding error. This is reloading data. A wrong maximum pressure figure
> is a physical safety issue, not a data-quality issue.

**Exporting the two tables that genuinely need it**, from the old box:

```bash
# On the old box. Note: strip ?schema=public from the URL or pg_dump rejects it.
ssh gungalore "pg_dump 'postgresql://USER:PASS@localhost:5432/gungalore_prod' \
  -Fc -t '\"ReloadingManual\"' -t '\"ReloadingManualPage\"' \
  -f /tmp/reference-manuals.dump && ls -lh /tmp/reference-manuals.dump"

ssh gungalore "psql 'postgresql://USER:PASS@localhost:5432/gungalore_prod' \
  -c \"\\copy (SELECT key, value FROM \\\"Setting\\\" ORDER BY key) TO '/tmp/settings.csv' CSV HEADER\""

# Optional belt-and-braces: the authoritative CartridgeSpec, to diff against the JSON
ssh gungalore "pg_dump 'postgresql://USER:PASS@localhost:5432/gungalore_prod' \
  -Fc -t '\"CartridgeSpec\"' -f /tmp/cartridge-spec.dump"

scp gungalore:/tmp/reference-manuals.dump gungalore:/tmp/settings.csv gungalore:/tmp/cartridge-spec.dump /c/dev/gun-galore/_migration/
```

Do this **now**, before anything else, and put the files somewhere that is not the old box.
Everything else in this document is repeatable; a decommissioned box with the only copy of
the manual page text on it is not.

### Deliberately not carried over

| | Why |
|---|---|
| Users, `clerkId` links, sessions | 6 accounts. The new entity has no relationship with any of them. They sign up again. |
| Listings | 5 of them, and the public shop is empty anyway. Re-list. |
| KYC records, encrypted SA ID numbers | See section 6 — the new company has no lawful basis to hold personal data collected by the old one. |
| Cloudinary assets and URLs | New cloud under the new company. Nothing references the old URLs because there are no listings worth keeping. |
| Zoho Books links | Eleven columns hold foreign keys into the old org. All will be NULL in a fresh database. A new entity gets a new ledger — that is a legal requirement, not a technical choice. |
| Push subscriptions | Bound to the `gungalore.co.za` origin. Dead regardless. |
| The 5-listing / 6-user database itself | Nothing is exported from it except the six reference tables above. |

### Secrets: all new, except two

**Reused as-is:** `ANTHROPIC_API_KEY` and the Google Cloud (Maps) key. Neither is a
merchant relationship, both are metered per-use, and both are the operator's own.

Two notes on those:
- Mint a genuine **Anthropic Admin API key** for `ANTHROPIC_ADMIN_API_KEY`. The production
  value today is a regular key, so the AI spend monitor on `/admin/credits` has never
  worked. Fix it now rather than carrying the bug over.
- The Google Cloud project needs **three** APIs enabled: Maps JavaScript, Places **and
  Geocoding**. Geocoding is the one that gets forgotten; its absence broke "use my
  location" once already, and under Bob Go it becomes load-bearing for the pickup-point
  search (section 4). Restrict the key to `https://alloutdoor.co.za/*` and
  `https://www.alloutdoor.co.za/*`, and set a billing cap before it goes public.

**Everything else is generated fresh:** `JWT_ADMIN_SECRET`, `MEILISEARCH_API_KEY`, the
VAPID pair, `HEALTH_PING_SECRET`, `COMING_SOON_BYPASS_SECRET`, the database password, and
every vendor credential.

### ID_HASH_SECRET is a FRESH secret this time

**This contradicts advice given earlier in this project, deliberately.** Previous guidance
said `ID_HASH_SECRET` must never be regenerated, and that guidance was correct at the time:
it is the AES-256-GCM key for every stored SA ID number (`User.idNumberEncrypted`) and the
salt for the uniqueness hash (`User.kycIdHash`). Regenerating it made existing ciphertext
mathematically undecryptable, with no recovery path.

**None of that applies to an empty database.** There is nothing encrypted under the old
secret in the new system, because there is no data in the new system. Generate a new one:

```bash
openssl rand -base64 48
```

Someone will remember the old rule and object. The rule was about *existing ciphertext*.
There is none. From the moment the first seller completes KYC on the new box, the old rule
applies again and the value must be backed up in the password manager and never touched.

The same logic applies to the VAPID keypair (push subscriptions are origin-bound and all
dead) and to `MEILISEARCH_API_KEY` (the index rebuilds from Postgres).

---

## 3. Services to register

Ordered by **lead time**, not by importance. Start the slow ones on day one even though
you cannot use them for weeks.

### Critical path — start immediately

**1. Business bank account in the name of ALLOUTDOOR (PTY) LTD** · lead time: 1–3 weeks

Everything financial hangs off this. Nothing else in the money chain can even be applied
for without it.

*The operator needs:* CIPC registration certificate (CoR14.3), company income-tax number,
directors' IDs and proof of address, proof of business address, and a resolution
authorising the account.

> **The CoR14.3 currently sitting in `~/Downloads` belongs to Puntepoeierprimer, not to
> Gun Galore and not to All Outdoor.** This has caused a wasted application once already.
> Get the correct document from CIPC for reg 2026/639713/07 before submitting anything.

**2. Nedbank TPPP + Peach Payments merchant onboarding** · lead time: 4–12 weeks

This gates trading. Nothing sells until money can move. The relationship model stays as
planned: **Nedbank as acquirer, Peach Payments as the gateway.** Neither can be transferred
from the old company.

*The operator needs:* the bank account above; the AML and RMCP policy documents rewritten
for the new entity (section 6); the Information Officer registration; a completed TPPP
application; a description of the business model that does not use the word "escrow" and
does not describe a pool or lottery.

> Darryl Worship at Nedbank previously asked for Teams calls plus the RMCP/AML policies.
> The v1.0 finals in `~/Downloads` were dated "Effective 14 July 2026" and were sent
> **without attorney review**, under the old entity's name. They cannot be reused as-is:
> wrong company, wrong registration number, retroactive date. Treat this as a fresh
> drafting exercise and get it reviewed this time.

**3. Cloudflare account + `alloutdoor.co.za` zone** · lead time: hours, then DNS propagation

Everything with a DNS dependency queues behind this, so do it in week one even though it
takes an afternoon.

*The operator needs:* the domain (already registered), and the nameserver change at
Absolute Hosting.

> **Re-create the MX records for `alloutdoor.co.za` exactly as Absolute Hosting has them,
> set DNS-only (grey cloud), before or immediately after the nameserver change.** Mail is
> already hosted there. Move the nameservers without the MX records and inbound email
> stops, silently, and you find out when a customer says nobody replied.

**4. Resend — sending domain and warm-up** · lead time: 1 day to verify, 5–10 days to warm

*The operator needs:* Cloudflare zone control.

Verify a **subdomain**, `send.alloutdoor.co.za`, not the apex. That keeps Resend's SPF and
DKIM records on a name where they cannot collide with Absolute's mail records on the apex,
while DMARC relaxed alignment still treats them as aligned. Publish exactly **one**
`_dmarc.alloutdoor.co.za` TXT record starting at `p=none`.

> If you verify the apex instead, there must be exactly **one** SPF TXT record on
> `alloutdoor.co.za` containing both Absolute's include and Resend's. Two SPF records is a
> permanent PermError that breaks outbound sending *and* your own inbound mail.

Start sending a handful of low-volume test emails the day it verifies. A zero-history
domain on a zero-history account is the worst possible sender profile, and a cold launch
puts order confirmations in spam. This floor cannot be compressed, which is why it is this
high in the list.

**5. Clerk — new application** · lead time: hours to 2 days for certificate issuance

*The operator needs:* the Cloudflare zone.

Create a new application under the All Outdoor Clerk organisation. There is **no transfer
to negotiate and no password-hash export to worry about** — six users sign up again. This
was the single largest risk in the old plan and the clean slate deletes it entirely.

Add `alloutdoor.co.za` as the production domain, publish every CNAME Clerk emits (the FAPI
host, the accounts host, the `clkmail` hosts) as **DNS-only, grey cloud**. Proxying Clerk's
FAPI through Cloudflare breaks certificate issuance.

### Company-documentation gated — start in week one or two

**6. SMSPortal** · lead time: 2–5 days (RICA / company verification)

*Needs:* company registration documents, and credit purchased up front.

> If `SMSPORTAL_CLIENT_ID` / `SMSPORTAL_API_SECRET` are missing, SMS silently enters STUB
> mode: it logs a row, returns `success: true`, and sends nothing. The SMS outage alarm
> cannot catch this because it counts SENT and FAILED rows, not STUB. Prove it with a real
> phone (`backend/scripts/send-prod-sms-test.mjs`), never with a log line.

**7. VerifyNow (KYC)** · lead time: 2–5 days

*Needs:* company documents, and credit. The old account was down to roughly 29 credits.

The cheap Claude-vision flow (`kyc_claude_flow_enabled`, ~R3/seller vs R59.80) stays on,
but VerifyNow is still the fallback and must be funded.

> `VERIFYNOW_MODE` must be exactly `production`. Anything else silently defaults to
> sandbox and every new seller passes KYC against canned data. `backend/.env.example:34`
> ships `sandbox` — do not build the new `.env` from the template without checking this.

**8. Bob Go** · lead time: sandbox token same-day; production account 3–10 days

*Needs:* company documents, and a commercial conversation about rates and billing terms
(prepaid wallet vs monthly invoice — see the open questions in section 8).

**Get the sandbox token on day one regardless.** Seven contract questions in section 4 are
blocking the integration estimate and every one of them is answered by a sandbox
round-trip. Nothing else on this list unblocks as much work for as little effort.

**9. Zoho Books — new organisation** · lead time: hours, plus a chart-of-accounts session

*Needs:* the bank account, the VAT position, and a decision on the chart of accounts.

A brand-new org for a brand-new company. Two things learned the hard way on the old org
that are free to get right on day one:
- The "Client Funds Payable" account must be typed **CASH**, or mark-paid is rejected.
- The **R15 per-waybill shipping handling margin is currently never booked to the ledger
  at all** (`backend/src/zoho/zoho-books.service.ts:596-620` posts only "Platform Fee" and
  a seller-absorbed processing fee). It is off-ledger revenue. Add the line item and the
  account now, while the ledger is empty. Retrofitting it later means the first months of
  trading have no data.

Keep `ZOHO_BOOKS_ENABLED=false` until the box is proven, then flip it and post one
throwaway document.

**10. Cloudinary** · lead time: minutes

*Needs:* nothing but an account. New cloud, new credentials, no asset migration — there is
nothing worth moving.

### Reused

**11. Anthropic** — same key. Confirm the org has balance; a cold org with no balance means
every seller fails KYC vision and every listing lands in manual review.

**12. Google Cloud (Maps)** — same key, three APIs, referrer restriction updated to the new
domain, billing cap set.

---

## 4. The Bob Go work

**Pudo and The Courier Guy are both dropped. Bob Go replaces both.** Bob Go is an
aggregator covering door-to-door *and* pickup points (lockers and counters) through one
API, so it subsumes Pudo's locker network and TCG's door service.

This is the single largest piece of engineering in the whole programme. It is bigger than
the box, the database, the DNS and the legal work combined.

### 4.1 What is verified, and what is not

Verified live against the sandbox — observed facts, not documentation:

```
Base URL   https://api.sandbox.bobgo.co.za/v2      Bearer token auth
Endpoints  POST /rates-at-checkout · POST/GET /rates · POST/GET/PATCH /orders
           GET /order-fulfillments · POST/GET/DELETE /packages
           POST/GET /shipments · GET /shipments/waybill · GET /shipments/sticker-waybill
           POST /shipments/cancel · GET /shipments/pod
           GET /tracking?tracking_reference= · POST/GET/DELETE /webhooks
           GET /locations?lat=&lng=&stacked_height=&stacked_width=&stacked_length=&total_weight=
```

A real `POST /rates-at-checkout` response:

```json
{ "rates": [{ "id": 334, "service_name": "Standard shipping",
              "service_code": "bobgo_334_34_0", "total_price": 263, "currency": "ZAR",
              "min_delivery_date": "2026-08-18", "max_delivery_date": "2026-08-19",
              "base_rate": 262.5,
              "liability_cover": { "declared_value": 5400, "price": 0,
                                   "provider_liability_cover": false },
              "surcharges": [], "type": "door", "service_level_priority": 2,
              "provider_slug": "sandbox", "service_level_code": "ECO" }],
  "count": 1 }
```

Six webhook event types exist: tracking updated · fulfillment created · shipment submission
status updated · shipment charged amount changed · shipment charged weight changed ·
shipment health status updated.

**Seven things are NOT verified, and they swing the estimate by more than a week.** Answer
all of them from the sandbox before anyone writes a line of integration code:

1. **Can a shipment be booked in one call, or is it `POST /orders` then `POST /shipments`?**
   And if two calls: what happens if the first succeeds and the second fails? This is the
   most expensive unknown in the port — see 4.4.
2. **Is `service_code` (`bobgo_334_34_0`, next to `id: 334`) a stable service tier, or a
   per-quote rate id that expires?** The whole book-at-seller-accept design assumes it can
   be echoed back days later without re-quoting
   (`backend/src/shipping/shipping.service.ts:572-576`). If it expires, every order falls
   into the fail-safe manual-dispatch branch. Test by quoting, waiting a day, then booking.
3. **How is a pickup-point rate distinguished from `type: "door"`, and what extra fields
   does a pickup-point shipment need?**
4. **Does `total_price` include `surcharges[]` and `liability_cover.price`?** If not, every
   quote under-collects.
5. **What is the complete tracking-status vocabulary?** The six webhook types are topics,
   not statuses, and are not a substitute. This one is money — see the risk at 4.7.
6. **Does a pickup-point drop-off issue a PIN (or a QR, or a reference)?** The seller
   hand-off flow, one database column and three notification channels depend on the answer.
7. **Is there a balance/wallet endpoint, and is billing prepaid or invoiced monthly?**

Also: **does Bob Go publish a public consumer tracking page?** Two hard-coded links to
`pudo.co.za` and `thecourierguy.co.za` (`frontend/app/transactions/[id]/page.tsx:49-50`,
`frontend/app/admin/(protected)/transactions/[id]/page.tsx:856-857`) either get a
replacement or get deleted. If deleted, our own timeline becomes the buyer's only tracking
surface, which raises the stakes on question 5.

### 4.2 The headline architectural finding

**There is no carrier abstraction to plug into.** `backend/src/shipping/carrier.types.ts`
defines two shared DTOs and nothing else — no interface, no adapter, no `implements`
anywhere in the repo. Its own header claims it is "kept carrier-neutral", and line 18
hard-codes `carrier: 'PUDO' | 'TCG'`.

**But the blast radius is smaller than that implies.** Every courier HTTP call lives in
exactly two files (`pudo.service.ts`, `tcg.service.ts`) and `ShippingService` is their only
consumer. The rest of the application talks to six carrier-neutral methods on
`ShippingService` (`shipping.service.ts:178, 323, 454, 831, 918, 992`).

So the shape of the work is: **one new service, one de-branched orchestrator, and an enum
rename that ripples widely** — not a rewrite of the call sites' logic.

Write a real `CarrierAdapter` interface (quote / book / waybill / track / cancel / pod /
points) that `BobGoService` implements, so the next carrier swap is a provider registration
rather than this exercise again.

### 4.3 The real coupling is the enum, and the compiler will not catch it

The `ShippingMethod` enum values `PUDO` and `TCG` (`backend/prisma/schema.prisma:102-109`)
appear in roughly 20 non-test backend files and 10 frontend files as branch conditions,
Prisma `where` filters, DTO validators, raw SQL and customer-facing copy.

**Rename them to carrier-neutral values.** Recommendation: **`COURIER_DOOR`** and
**`COURIER_PICKUP_POINT`**, leaving `DEALER_TRANSFER`, `PRIVATE_ARRANGE`, `COLLECTION` and
`ON_SITE_SERVICE` untouched. Keep **two** members rather than collapsing to one: the
seller's "I will drop at a pickup point" versus "collect from my address" choice is a real
distinction that `Listing.shippingMethods` exists to record, and pickup points have parcel
size limits that door delivery does not.

Add one exported helper, `isCourierBacked(method)`, so the next change is a one-line edit.

> **Decide this before any code is written.** Changing your mind halfway means touching
> every call site twice.

The tempting shortcut — keep the names `PUDO`/`TCG` and point them at Bob Go — saves about
two days and bakes a dead carrier's name into the schema, the admin UI and the analytics
SQL forever. On a database with zero rows the rename is free. It will never be this cheap
again.

**Four call sites `tsc` will not catch:**

| Where | What |
|---|---|
| `backend/src/admin/admin-analytics.service.ts:405` | Raw SQL string: `AND "shippingMethod" IN ('PUDO', 'TCG', 'DEALER_TRANSFER')`. Compiles fine, returns zero rows forever. |
| `create-transaction.dto.ts:79,85` and `create-order.dto.ts:36,41` | `@ValidateIf((o) => o.shippingMethod === 'PUDO')` — a string compared against an untyped DTO field. |
| `backend/src/payments/dispatch-sla.service.ts:62,132,333,410,469` | Five `shippingMethod: { in: ['PUDO','TCG'] }` filters driving the dispatch nudge, the 5-day auto-refund, the 72h stuck-funds alert, the 48h confirm nudge and the 7-day transit-stall alert. Every one is money-critical. Miss these and the sweeps match nothing, forever, with no error. |
| `backend/src/ai/ask-gg-claude.service.ts:551,722` | The Ask Boet system prompt tells buyers about "PUDO locker-to-locker and The Courier Guy door-to-door". Customer-facing and wrong. |

Grep for the string literals, not just the enum. After cutover, create one test order per
method and confirm each sweep sees it.

### 4.4 What gets written

| Component | Notes |
|---|---|
| `BobGoService` | 700–900 lines. Absorbs both existing clients (32 KB + 13 KB today). Rates, orders+shipments, waybill + sticker-waybill, tracking, cancel, POD, locations, webhook register/verify. |
| `CarrierAdapter` interface | Replaces the fake neutrality in `carrier.types.ts`. |
| `shipping/money.ts` | The single rand↔cents boundary. See 4.6. |
| Webhook handler with a `switch` on event type | Today's handler assumes there is no event type at all — `shipping.service.ts:1191-1194` says so in a comment. Six typed events need routing. |
| `BOBGO_STATUS_MAP` | Alongside the existing map. `COLLAPSED_TO_PRISMA` and the 7-value `PrismaShippingStatus` stay untouched. |
| Carrier price-change reconciliation | New capability. See 4.7. |
| POD fetch | New capability. `Transaction.podProofUrl` (`schema.prisma:1409`) exists and has never been written by anything. |

**The booking two-step is the single most expensive item.** `bookForTransaction`
(`shipping.service.ts:454-825`) is 370 lines of money-critical code. It contains an atomic
claim on `shipmentBookingStartedAt` set *before* the wallet-billed call (`:472-485`), a
`paymentStatus !== 'HELD'` backstop (`:511`), never-throws-into-caller semantics
(`:811-824`), and a consolidated-sibling parcel roll-up (`:700-717`). **All of it must
survive verbatim.**

Its idempotency is one atomic claim around one billed call. If Bob Go needs `POST /orders`
then `POST /shipments`, a failure between them releases the claim and a retry creates a
*second* order — real money, silently. Either confirm a single-call path exists, or persist
the Bob Go order id in its own column immediately after step one and make step two
resumable.

### 4.5 What gets deleted

The largest single subtraction, and it is satisfying:

| Deleted | Where | Size |
|---|---|---|
| The 24h in-memory locker cache and feed normaliser | `pudo.service.ts:572-721` | ~150 lines of defensive field-mapping over ~2,700 rows filtered to ~1,800 |
| The hand-curated `PHANTOM_LOCKER_CODES` blocklist | `pudo.service.ts:24-32` | — |
| Three-tier exact-postal / Delaunay-neighbour / haversine ranking | `pudo.service.ts:77-179`, `:723-733` | — |
| The `pudo_lockers` Meilisearch index and its reindex cycle | `search/search.service.ts:8,104-106`, `pudo.service.ts:699-711` | one index; README's "three indexes" becomes two |
| `PostalCodesService` + `scripts/build-postal-neighbours.mjs` + `backend/data/postal-neighbours.json` | `postal-codes.service.ts` | Its only consumer is the Pudo picker. Confirmed by grep. |
| `waybillUrl()` — interpolates `PUDO_API_KEY` into a URL | `pudo.service.ts:394` | The only thing stopping that leaking is a comment. |
| The box-fit apparatus (`fitsBox`, the five-size sort, `boxName`) | `pudo.service.ts:780`, `:466-481`, `:62` | Bob Go's `GET /locations` filters by parcel dimensions server-side |
| The unauthenticated `/shipping/webhook/pudo` route | `shipping.controller.ts:135` | Has no authentication of any kind. Delete rather than port. |
| `TRANSIT_BUSINESS_DAYS = { PUDO: 5, TCG: 4 }` and `methodHasEstimate` | `backend/src/shipping/delivery-estimate.ts:14-17` | Bob Go returns real min/max dates. Keep `addBusinessDays`. |
| Legacy collapsed statuses `AWAITING_TCG_COLLECTION`, `TCG_IN_TRANSIT` | `status-map.ts:127-131` | Kept only for old `TrackingEvent` rows. There are none. |
| Legacy columns `pudoTrackingCode`, `tcgWaybill` | `schema.prisma:1414,1418` | Superseded by `trackingReference` and never removed. |
| `HuntPdf`, `HuntPdfPage`, `RangeEstimate` models + two enums | `schema.prisma:3229-3322` | ~95 lines, zero relations into the rest of the graph. See section 7 — this is a decision, not automatic. |
| `Swap.cashDetectedAt` / `cashVerifiedAt`, `Listing.passFeeToBuyer` | `schema.prisma:3663-3670`, `:911-914` | Documented as "kept to avoid a destructive migration". On an empty database that category does not exist. |

> **Verify before deleting the locker stack.** If `GET /locations` returns thinner data
> than Pudo's feed — no opening hours, no postal code, straight-line ranking only — the
> buyer's picker regresses and part of the deletion has to be undone. Check the response
> shape first.

### 4.6 The rand/cents boundary — where the 100× bug will be

**Bob Go returns rand with decimals (`263`, `262.5`). This codebase is integer cents from
the quote boundary onward.** Both sides are TypeScript `number`, so nothing will catch a
mistake. Get it wrong and every shipping charge is out by two orders of magnitude.

The conversion already exists and works — twice, once per carrier, which is exactly how two
copies drift:
- `backend/src/shipping/pudo.service.ts:791` — `Math.round(Number(raw) * 100)` on a string
- `backend/src/shipping/tcg.service.ts:186` — `Math.round(rate * 100)` on a number

And it runs in **both directions**: `tcg.service.ts:135,236` send
`declared_value: Math.round(declaredValueCents / 100)` because the carrier wants rand. Bob
Go's observed `declared_value: 5400` confirms the same convention.

**The rules, decided once, in `backend/src/shipping/money.ts`:**

1. **One module.** `randToCents()` and `centsToRand()`, exported, used at every boundary. A
   bare `* 100` anywhere in the carrier client is a review failure.
2. **`Math.ceil` on the carrier cost we must recover.** The brief's two rules — "in the
   platform's favour" and "never against the buyer" — collide at the half-cent. Ceiling the
   carrier cost means we never under-recover; the flat R15 handling margin
   (`fee.calculator.ts:45`) absorbs the ≤1c difference, so the buyer is never charged more
   than the true cost either. Both rules satisfied. **Write that reasoning in a comment**
   or someone will "fix" it later.
3. **Round the quoted rand UP to a whole rand before converting.** `formatPrice`
   (`frontend/lib/utils.ts:1-6`) renders with zero decimals, so an un-rounded 262.5
   displays as "R263" while the buyer is charged R262.50. `Math.ceil(rand) * 100` makes
   displayed price equal charged price. Do **not** fix this by giving `formatPrice`
   decimals — it renders every price on the site.
4. **Round declared value UP.** Integer-rand rounding understates liability cover on odd
   amounts. Over-insure by less than R1 so a claim is never short.
5. **Never sum `base_rate + surcharges[]` in rand and then convert.** Use `total_price`, or
   convert each component to cents and sum in cents.
6. **Throw above R100,000.** A shipping charge that high is impossible and means someone
   passed cents where rand was expected. A loud 500 at checkout beats a R2.63 charge nobody
   notices for a month.
7. **Guard non-finite values,** and note that `105.7 * 100` is `10569.999…` in IEEE 754 —
   `Math.round(Number(x.toFixed(2)) * 100)`.
8. **Store the raw decimal alongside** for reconciliation against the invoice.

Unit-test with `262.5`, `263`, `0`, `1234.56`, a string input, and a property test.

**Good news for the frontend:** no frontend file performs a `/100` or `* 100` on a shipping
rate. The only contract is `ShippingQuote.priceCents` (`frontend/lib/types.ts:610-618`).
Keep it that way and the 100× bug cannot reach the UI.

### 4.7 The two webhooks that have no home — and the payout gate

**These are the two most consequential findings in the whole courier scope.**

**Silent margin leak.** Two of Bob Go's six webhooks — *shipment charged amount changed* and
*shipment charged weight changed* — exist specifically to tell you the carrier is billing
something other than what it quoted. Re-weighing at the hub is routine in South African
courier. Today `Transaction.shippingCost` (`schema.prisma:1306`) is what the *buyer* paid
and must never be mutated after payment, and there is **nowhere to record what the carrier
actually charged.** Grep for `reconcil`, `actualCost`, `carrierCost`, `chargedAmount` across
`backend/src` and you get zero courier hits.

The seller is insulated (`sellerPayout = listingPrice − commission`), so 100% of any
overrun lands on the platform's R15-per-waybill margin, invisibly. The old carriers did this
too; the difference is that Bob Go *tells you*. Leaving the webhook unhandled is a decision
to keep bleeding, not a neutral omission.

Add `carrierChargedCents`, `carrierChargedWeightGrams`, `carrierChargeChangedAt`; raise an
`AdminAlert` above a rand threshold into the existing `/admin/alerts` inbox; add a line to
the admin transaction detail; produce a weekly variance report. Do **not** try to re-charge
the buyer after capture.

**The payout gate.** `backend/src/shipping/status-map.ts:92-93` is the only thing standing
between a tracking event and releasing the seller's money. Exactly **two** slugs reach
Prisma `DELIVERED`, and `DELIVERED` sets `deliveredAt`, which starts the buyer-confirm /
auto-release clock.

If Bob Go emits something like *"delivered to pickup point"* for a parcel sitting in a
locker the buyer has not opened, and that maps to `DELIVERED`, **the platform pays sellers
for goods the buyer never received** and finds out via chargebacks. It must map to
`AT_LOCKER` → `OUT_FOR_DELIVERY` (`status-map.ts:86-89`).

Mitigation: enumerate the full vocabulary from the sandbox before writing a single map row;
keep the existing default-deny behaviour (unmapped → null, `status-map.ts:151`); write an
explicit regression test named for this exact failure.

Also rename the Pudo-branded collapsed keys and buyer-facing labels while the
`TrackingEvent` table is empty: `PUDO_PIN_ISSUED` → `PICKUP_PIN_ISSUED`, "Dropped off at a
Pudo locker" → point-neutral wording (`status-map.ts:54,166-204`). These strings are stored
verbatim in the database (`schema.prisma:1769`). Free now, expensive in six months.

### 4.8 The schema, after

**Renamed:** `ShippingMethod.PUDO` → `COURIER_PICKUP_POINT`, `TCG` → `COURIER_DOOR` ·
`Listing.pickupPudoLockerId` → `defaultDropoffPointCode` · `Transaction.pudoPickupLockerId`
→ `pickupPointCode` · `pudoDropoffLockerId` → `dropoffPointCode`

**Deleted:** `Transaction.pudoTrackingCode` · `Transaction.tcgWaybill` ·
`Transaction.estimatedDeliveryAt` (replaced by a min/max pair)

**Added:**

| Column | Why |
|---|---|
| `carrierOrderId String?` | Bob Go's order and shipment are different objects with different ids. `carrierShipmentId` can only hold one. |
| `carrierRateId Int?` | The numeric rate id (`334`), distinct from `service_code`. |
| `pickupPointSnapshot Json?` | `GET /locations` is a live directory; a point can close between checkout and booking. |
| `estimatedDeliveryMinAt` / `MaxAt DateTime?` | Bob Go returns a window, not a date. |
| `rateSnapshot Json?` | The raw rate object. The only way to explain an invoice variance. Json, not columns, so a new surcharge type never needs a migration. |
| `carrierChargedCents` / `carrierChargedWeightGrams` / `carrierChargeChangedAt` | See 4.7. |
| `carrierPodUrl String?` | Separate from `podProofUrl`, which is user-uploaded. Conflating operator-fetched carrier evidence with user-supplied evidence weakens both in a dispute. |
| `collectionAddress Json?` | The delivery side is snapshotted; the collection side is read live off `Listing.pickup*` at booking time. A seller who edits their pickup address between sale and dispatch silently redirects the courier, with no record. Pre-existing defect; free to fix now. |
| `@@index([trackingReference])` | The tracking poll and the webhook handler both look up by it and there is no index today. |
| `pickupProvince` on `Listing` (consider) | There is no pickup province; the collection province is taken from `Listing.province`, which assumes the pickup address is in the same province as the listing. |

`Transaction.trackingReference` (`schema.prisma:1393`) is kept and is, conveniently,
exactly Bob Go's identifier name — `GET /tracking?tracking_reference=` takes it verbatim.

`TrackingEvent.source` is a free String precisely so a new carrier needs no migration; the
values become `'INTERNAL' | 'BOBGO'`. Keep the `@@unique([transactionId, status,
occurredAt])` at `:1795` — with a tracking webhook running alongside the poll, that guard
matters more, not less.

### 4.9 The pickup-point picker — most of the frontend effort

Three compounding problems, and they are why the frontend number is what it is.

**(a) The locker directory is not in Postgres.** There is no locker table, no foreign key —
just three unconstrained string columns. The ~2,700 Pudo lockers live in a 24h in-memory
cache plus a Meilisearch index. So there is nothing to migrate and nothing to export: the
directory is simply gone, replaced by a server-side nearest-query.

**(b) The picker's free-text search mode has no Bob Go equivalent.** Today a user types
"Sandton City" or "8000" and gets typo-tolerant matches
(`frontend/components/locker-picker.tsx:104-128`). `GET /locations` is lat/lng-only. The
fix is geocode-then-locate: type an area → Google Geocoder → `/locations` with the parcel
dimensions → render points. Google's Geocoder is already loaded client-side for the address
field (`frontend/components/address-autocomplete.tsx:409`) and the Maps key is one of the
two being carried over, so the mechanism exists. But **the UX genuinely changes** — you
search an *area*, not a locker *name* — and the labels and placeholder copy change with it.
Watch the geocode quota; this fires on keystroke-pause against a key shared with the
address autocomplete.

**(c) The cart's picker is called with no props at all.**
`frontend/app/cart/page.tsx:600` is `<LockerPicker selectedId={...} onSelect={...} />` —
no lat, no lng, no postal code. Under Bob Go, which needs coordinates *and* parcel
dimensions, this call site cannot be ported. And the cart is multi-item: courier items ship
as one combined parcel on one waybill, so something must compute stacked height/width/length
and total weight across N listings before `/locations` can be called at all. That combining
step does not exist in the frontend today.

**Decide early whether the backend exposes a combined-parcel endpoint or the frontend does
the arithmetic.** Do not discover this mid-build.

One piece of good news: the backend already computes exactly the box Bob Go asks for.
`quoteCombined` (`shipping.service.ts:337-366`) builds max(length), max(width), Σ(height ×
qty), Σ(weight × qty) — "a conservative STACKED bounding box so we never UNDER-quote" — and
`GET /locations` takes precisely those four values. The shapes line up with no adaptation.

Related: the sell form's oversize guard hard-codes Pudo's largest box, `PUDO_MAX_BOX_CM =
[69,60,41]` / `PUDO_MAX_WEIGHT_KG = 20` (`frontend/app/listings/new/page.tsx:1308-1342`),
and silently strips the locker option from the seller's selection inside a `useEffect`. The
same "60 × 41 × 69 cm at 20 kg" appears in six more copy blocks in that file. Bob Go's
`/locations` filters by parcel dimensions server-side, so the guard can probably be deleted
— but that moves the seller's feedback from "greyed out as you type" to "no pickup points
at checkout", which is worse for the seller. Confirm what `/locations` returns for an
oversize parcel before choosing.

### 4.10 Everything else that changes

**Tests — rewrite, do not delete.** Six spec files, 897 lines:
`book-deal-collection.spec.ts` (233), `tcg-webhook.spec.ts` (199),
`book-for-transaction.spec.ts` (161), `carrier-shipment.spec.ts` (153),
`status-map.spec.ts` (107), `delivery-estimate.spec.ts` (44). They encode the hard-won
invariants — the idempotency claim, the HELD backstop, the deal-supplier collection origin,
the webhook ref-matching fallbacks, the payout-gate mapping. **Port the assertions and swap
the fixtures.** Add three new tests the suite lacks: rand→cents property tests, the
order→shipment partial-failure path, and a "pickup point does not mean delivered"
regression test.

**Modules that break on the rename:** `dispatch-sla.service.ts` (five filters) ·
`transactions.service.ts` (~12 sites) · `my-shipments.service.ts:63` ·
`swap-funding.service.ts:118,319,329,378` (swap legs hard-coded to `ShippingMethod.TCG`) ·
`deals.service.ts:120,186,321` (deals forced to `[TCG]`, and `transactions.service.ts:399`
throws "Daily Deals ship by courier only" on anything but TCG) ·
`notifications.service.ts:4974-4993` · `admin.service.ts:1050` · `main.ts:87-91` (the boot
warning for `TCG_WEBHOOK_SECRET`).

> Swap legs are already broken independently of the courier: `confirmSwapFunding` has had
> **no caller** since manual EFT was stripped (`docs/ARCHITECTURE.md:483-485`). Scope Bob
> Go work there as part of the swap-funding rewire, not as courier work.

**Public copy naming the carriers** — nine surfaces, and two of them are statutory:
`(legal)/terms/page.tsx:256-258,457-459` (delivery options *and* the POPIA third-party
processor list) · `(legal)/privacy/page.tsx:226-229` (the cross-border operator table, one
row per carrier) · `(legal)/fees/page.tsx:144-147` · `(legal)/refund-policy/page.tsx:127-129`
· `(legal)/about/page.tsx:59-62` · `faq/page.tsx:63-64` ·
`members/regulated-items/page.tsx:150,422,430-431` · `listings/[id]/page.tsx:844-846` ·
`components/profile-completion-ring.tsx:41` · plus the seeded help-centre rows in the
database (`prisma/seed-data/help-centre.ts:204,213,228,236`).

Two of those need more than a find-and-replace:
- **The privacy operator table.** Bob Go is an *aggregator* — buyer address and parcel data
  flow onward to whichever provider fulfils the leg. A POPIA disclosure naming only Bob Go
  is arguably incomplete. "Bob Go and its contracted delivery providers" is probably the
  honest phrasing. Get it checked.
- **`regulated-items/page.tsx:422`** — "may not be sent by locker-to-locker service" is a
  compliance restriction derived from Pudo's prohibited-goods list. Bob Go aggregates
  multiple providers with potentially different rules. **Do not copy it across on faith.**

**The dispatch SMS has a cost trap.** `notifications.service.ts:1646` builds
`All Outdoor: <title truncated to 26> sold! <handover> Waybill <ref>. Print label…<url>`
and it is already close to the 160-character segment boundary. The handover string is
currently `Drop at any Pudo locker, PIN 1234.` — longer wording pushes every dispatch SMS
into a second segment, doubling the cost forever, and these are flagged delivery-essential
so they cannot be suppressed. **Count characters against the worst case before choosing the
wording.**

**Environment variables:** six retire (`PUDO_API_KEY`, `PUDO_API_SECRET`, `PUDO_BASE_URL`,
`TCG_API_KEY`, `TCG_BASE_URL`, `TCG_WEBHOOK_SECRET`) and are replaced by roughly two plus a
webhook secret. Documented in three places: `backend/.env.example:235-250` and
`docs/ENVIRONMENT.md:47,413-431,714` — that last one is a summary block, easy to miss when
you only edit the two detailed sections.

**Webhook registration becomes self-service.** The 10-minute tracking poll exists because,
per the comment at `tasks.service.ts:1196`, "Pudo webhooks need a support ticket". Bob Go
has `POST/GET/DELETE /webhooks`, so registration becomes a scripted deploy step. **Keep the
poll anyway** as a backstop — it costs one HTTP call per live parcel and it is the only
thing that catches a silently-dropped webhook. Rename `pollPudoShipments` → `pollShipments`
and drop the `shippingMethod: 'PUDO'` filter at `tracking.service.ts:115` (there was never a
TCG poll; door orders have been webhook-only this whole time).

**Two admin surfaces collapse to one each:** the credit-balance probes
(`admin-credits.service.ts`, both of which already guess at field names and degrade to null
— copy that defensiveness) and the health-check rows (`admin-health.service.ts:112-125`).
`CreditSnapshot.service` is a free String, so no migration. **If Bob Go exposes no balance
API, drop the probe rather than ship a permanently-erroring tile.**

**Carry one warning across verbatim.** `docs/ARCHITECTURE.md:712` says "This is production
mode — creating a shipment bills real credits." A sandbox-versus-production base-URL
mistake spends real money. Keep that sentence, with Bob Go's name in it.

### 4.11 Effort — honestly

Four independent scoping passes produced 51–66 developer-days between them. They
double-count: the enum rename appears in three, the test rewrite in three, the money module
in two. **De-duplicated, the honest figure is 38–52 developer-days.**

| Workstream | Days |
|---|---|
| Sandbox verification of the seven unknowns | 2–3 |
| `BobGoService` client, all endpoints, real error handling | 4–5 |
| De-branch `ShippingService`, preserving the CAS claim / HELD backstop / never-throw / consolidated roll-up | 2 |
| `money.ts` + property tests + auditing every existing boundary | 1 |
| `BOBGO_STATUS_MAP` + payout-gate preservation | 1.5 |
| Pickup-point backend (delete ~350 lines, retune on `/locations`) | 2 |
| Enum rename + ~30 call sites + DTOs + raw SQL + admin + copy + Ask Boet prompt | 3–5 |
| Schema authoring (new columns, deletions) | 0.5–1 |
| Carrier price/weight-change reconciliation — **new capability** | 3–4 |
| Refund-before-cancel ordering + cancel confirmation | 1–2 |
| Service-code expiry / re-quote-at-book — **depends entirely on question 2** | 1–2 |
| POD fetch — **new capability** | 1 |
| Credit/balance poller | 0.5 |
| Frontend: picker rewrite + geocode search + parcel plumbing | 2.5–3 |
| Frontend: cart integration (no coords, multi-item combine) | 1 |
| Frontend: checkout form (2,466 lines, 68 carrier refs) + offer checkout | 2 |
| Frontend: sell form (5,085 lines, 60 refs, oversize guard) | 1.5 |
| Frontend: transaction page + dispatch button (449 lines, 35 refs) + timeline | 1.5 |
| Frontend: `/shipping` module, admin, Daily Deals | 2 |
| Legal + informational copy | 1 |
| Notification templates + SMS character count | 0.5 |
| Ops: env, webhook registration, Meilisearch index removal, docs | 1 |
| Test rewrite (6 files, 897 lines) + new coverage | 2–3 |
| Regression pass, desktop and mobile, no staging safety net | 1.5 |
| **Total** | **38–52** |

Optional, deferrable to a phase 2 at a known cost: the price-change reconciliation (3–4 d)
and the Zoho handling-fee line (1 d). Deferring them ships a system that bleeds carrier
overruns silently — which is exactly what it does today, so it is not a regression, but it
is a knowingly accepted loss.

**Calendar: 10–14 weeks** for one experienced backend developer, not 8. The gap between
38–52 days and 10–14 weeks is real: several items are gated on Bob Go sandbox round-trips
and on the account being provisioned under the new entity, and those answers arrive in the
middle of the port rather than at the start.

**If an AI agent does this rather than a developer, add roughly 50%.** The CAS guards, the
claim/rollback ordering in `autoRefundStale`, and the deliberate exclusion of the handling
margin from the processing-fee base all look like tidy-up targets and are not.

---

## 5. The build, phased

Phases 1–7 are the box and can be done in about a week. Phase 8 (Bob Go) runs in parallel
and is the long pole. Phases 9–11 are the launch.

---

### Phase 0 — Unblock

**What.** Pay the R53.06 invoice. Open ports 22, 80 and 443 in the Absolute Hosting panel.

**Verify,** from the Windows PC:

```powershell
Test-NetConnection -ComputerName <NEW_ORIGIN_IP> -Port 22
Test-NetConnection -ComputerName <NEW_ORIGIN_IP> -Port 80
Test-NetConnection -ComputerName <NEW_ORIGIN_IP> -Port 443
```

All three must print `TcpTestSucceeded : True`.

**If it fails.** Port 22 closed means the panel firewall is still shut — there is no
workaround and nothing below will work. Raise it with Absolute Hosting support and wait.

Also start, on this same day, the four things with the longest lead times: the bank account
application, the Bob Go sandbox token request, the Cloudflare zone, and the Resend domain.

---

### Phase 1 — Provision the box

Follow `infra/setup/README.md`, which is written for exactly this and is current. The
substantive differences for the new box are below.

#### Step 1 — Swap FIRST, before installing anything

> **This is the single most likely way the first deploy fails.** The deploy builds on the
> server: `next build --webpack` peaks well over 2 GB on its own, and it runs next to
> PostgreSQL, Meilisearch and the Nest backend. The new box has 4 GB and no swap. The
> Linux OOM killer does not fail politely — it kills the largest process, usually
> PostgreSQL, and you get a half-written build plus a database that vanished mid-transaction.

```bash
ssh root@<NEW_ORIGIN_IP>
fallocate -l 8G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
free -h
```

**Verify.** `free -h` shows `8.0Gi` of swap. **If it fails** — `fallocate` unsupported on
the filesystem — use `dd if=/dev/zero of=/swapfile bs=1M count=8192`.

#### Step 2 — Base system, user, firewall

```bash
apt update && apt -y upgrade
apt -y install git curl build-essential ufw nginx rsync fail2ban

adduser --disabled-password --gecos "" alloutdoor
usermod -aG sudo alloutdoor
mkdir -p /home/alloutdoor/.ssh
# paste the deploy public key into /home/alloutdoor/.ssh/authorized_keys
chown -R alloutdoor:alloutdoor /home/alloutdoor/.ssh
chmod 700 /home/alloutdoor/.ssh && chmod 600 /home/alloutdoor/.ssh/authorized_keys

# Disable password SSH BEFORE anything else. This box gets scanned within minutes.
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
systemctl enable --now fail2ban
```

On **your** machine, add to `~/.ssh/config`:

```
Host alloutdoor
    HostName <NEW_ORIGIN_IP>
    User alloutdoor
    IdentityFile ~/.ssh/your_deploy_key
```

From here on, always `ssh alloutdoor`. Never `ssh alloutdoor@<NEW_ORIGIN_IP>` — that form
skips the alias, does not find the key, and prompts for a password nobody has.

**Verify.** `ssh alloutdoor "whoami"` prints `alloutdoor`. `sudo fail2ban-client status`
lists the `sshd` jail.

**If it fails.** Do not disable the firewall to debug. Keep the root session open in a
second window until key-based login as `alloutdoor` is proven — locking yourself out of a
box whose console you may not have is a bad afternoon.

#### Step 3 — Node 22, PostgreSQL 16, Meilisearch 1.44

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
npm install -g pm2
node -v            # v22.x
which npm          # must be /usr/bin/npm — matches infra/pm2/ecosystem.config.js

apt -y install postgresql postgresql-contrib
psql --version     # must print 16.x

curl -L https://install.meilisearch.com | sh
mv ./meilisearch /usr/local/bin/
meilisearch --version   # meilisearch 1.44.0
```

> **PostgreSQL must be 16, not 17.** Ubuntu 24.04 ships 16 by default — do not add the PGDG
> repo and take whatever is newest. Meilisearch must be 1.44: the backend writes a
> filterable-attributes list at boot and older versions reject attributes they do not know.

> If you install Node via nvm instead, `which npm` lands under `~/.nvm/` and you must update
> the `script` path in `infra/pm2/ecosystem.config.js:122`. pm2 does not resolve it from the
> shell's PATH at restart.

#### Step 4 — Database and Meilisearch service

```bash
sudo -u postgres psql -c "CREATE ROLE alloutdoor WITH LOGIN PASSWORD '<generate a strong one>';"
sudo -u postgres psql -c "CREATE DATABASE alloutdoor_prod OWNER alloutdoor;"
sudo -u postgres psql -d alloutdoor_prod -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

Creating `pg_trgm` as superuser here means `backend/src/reloading/reloading.service.ts:182`
does not have to.

> There is **no dump to restore**, so the old constraint about matching the production role
> name does not apply. Name the role whatever you like. That is one of several places the
> clean slate saves you.

```bash
mkdir -p /var/lib/meilisearch/data
cat > /etc/systemd/system/meilisearch.service <<'EOF'
[Unit]
Description=Meilisearch
After=network.target
[Service]
Environment=MEILI_MASTER_KEY=<generate a strong one>
ExecStart=/usr/local/bin/meilisearch --db-path /var/lib/meilisearch/data --env production --master-key ${MEILI_MASTER_KEY}
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now meilisearch
curl -s http://localhost:7700/health
```

**Verify.** `{"status":"available"}`. Meilisearch is bound to localhost and must stay
that way — it will happily serve the entire catalogue to anyone who can reach the port.

---

### Phase 2 — Code on the box, and prove it builds

**Why here.** The new box must be provably able to *build* the app before you commit to
anything else. On 2 cores and 4 GB that is not a formality.

```bash
sudo -iu alloutdoor
git clone <repo url> ~/app
cd ~/app
git checkout <deployment branch>     # ask; production tracked feat/takealot-ux-parity
mkdir -p ~/app/logs
cd backend && npm ci
cd ../frontend && npm ci
```

Then the build, with the RAM protections. Placeholder env values are fine — you are testing
that the box can compile:

```bash
sudo systemctl stop postgresql
sudo pkill meilisearch || true

cd ~/app/backend
npx prisma generate
NODE_OPTIONS="--max-old-space-size=3072" npm run build

cd ~/app/frontend
NODE_OPTIONS="--max-old-space-size=3072" npm run build

sudo systemctl start postgresql
sudo systemctl start meilisearch
```

**Verify.** Both exit 0. `ls ~/app/backend/dist/src/main.js` and
`ls ~/app/frontend/.next/BUILD_ID` both exist. Watch memory in a second session with
`watch -n2 free -h`; if swap use climbs past about 5 GB the build is thrashing.

**If it fails** (`Killed`, exit 137, or over 20 minutes): build off-box on the old Vultr
machine, which has 4 cores and 7.9 GB, and copy the artefacts:

```bash
ssh gungalore "cd ~/app && git pull && cd frontend && npm ci && npm run build && tar czf /tmp/next-build.tgz .next"
scp gungalore:/tmp/next-build.tgz /tmp/
scp /tmp/next-build.tgz alloutdoor:~/app/frontend/
ssh alloutdoor "cd ~/app/frontend && tar xzf next-build.tgz"
```

Node versions must match between the two boxes (`node -v`). **If you use this fallback,
write it down as the permanent deploy procedure** — every future deploy hits the same wall,
and the old box is scheduled for decommission (section 7). That makes it a real decision:
either the new box can build the app, or the budget needs another 2 GB of RAM.

---

### Phase 3 — Schema and migrations

```bash
cd ~/app/backend
npx prisma migrate deploy
npx prisma migrate status
```

**Verify.** All migrations applied, no drift.

> **Never run `npx prisma db push`.** Three services — the Ask Boet knowledge base,
> reloading-manual full-text search, and listings full-text search — create `tsvector
> GENERATED` columns and GIN indexes at boot with raw DDL. Those columns are not in
> `schema.prisma`, so `db push --accept-data-loss` drops them and the next boot does not
> rebuild them cleanly.

**On squashing the 99 migration files.** Tempting, and genuinely worth doing eventually —
it kills the known local-dev drift (23 migrations and 14 tables missing locally). But do it
**after** the Bob Go schema is final, not now, and prove equivalence rather than assuming
it:

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://alloutdoor:PASS@localhost:5432/alloutdoor_shadow"
```

An empty diff means the squash is safe. Running the existing 99 migrations against an empty
database is the proven path and costs nothing; squashing before the schema settles means
doing it twice.

---

### Phase 4 — Reference data

Order matters: categories first (other seeds reference them), then everything else.

```bash
cd ~/app/backend

# 1. Categories — 188 rows, canonical tree lives in prisma/seed.ts
npm run seed

# 2. Cartridge specs — 256 rows from the VERIFIED committed JSON.
#    NEVER run scripts/build-cartridge-specs.ts. See section 2.
npx ts-node --transpile-only --project tsconfig.json scripts/seed-cartridge-specs.ts

# 3. Manual loads — ~50,789 rows from 51,551 committed JSONL rows
npx ts-node --project tsconfig.json scripts/import-loads.ts prisma/seed-data/manual-loads.jsonl

# 4. Help centre
npm run seed:help
```

Then the two things that genuinely came off the old box:

```bash
# Reloading manual PDFs — on disk, not in Cloudinary, not in the database
rsync -avz --progress gungalore:~/app/manuals/       alloutdoor:~/app/manuals/
rsync -avz --progress gungalore:~/app/manual-inbox/  alloutdoor:~/app/manual-inbox/

# The two exported tables
scp /c/dev/gun-galore/_migration/reference-manuals.dump alloutdoor:/tmp/
ssh alloutdoor "sudo -u postgres pg_restore -d alloutdoor_prod --no-owner --role=alloutdoor /tmp/reference-manuals.dump"
```

**Verify:**

```bash
ssh alloutdoor "sudo -u postgres psql -d alloutdoor_prod -c \"
  SELECT 'Category' t, count(*) FROM \\\"Category\\\"
  UNION ALL SELECT 'CartridgeSpec', count(*) FROM \\\"CartridgeSpec\\\"
  UNION ALL SELECT 'ManualLoad', count(*) FROM \\\"ManualLoad\\\"
  UNION ALL SELECT 'ReloadingManual', count(*) FROM \\\"ReloadingManual\\\"
  UNION ALL SELECT 'ReloadingManualPage', count(*) FROM \\\"ReloadingManualPage\\\";\""
```

Expect approximately 188 / 256 / 50,789 / 19 / 3,894. **CartridgeSpec must be exactly 256**
— anything else means the seed did not fully reconcile, and this is the reloading-safety
table. Diff it against the production export before moving on.

**Check disk headroom first** — 50 GB has to hold the OS, `node_modules`, the database, the
build output and ~80 MB of PDFs: `ssh alloutdoor "df -h /"`.

**Settings.** Do not bulk-import `settings.csv`. Open it, read all 54 rows, and apply them
deliberately through the admin UI or one SQL statement at a time. These are the feature
flags: Daily Deals, the prize draw, the Claude KYC flow, moderation thresholds. Several
should stay OFF on a site that is not trading. Code defaults exist for every one of them
(`backend/src/settings/settings.service.ts`), so an unset row is safe.

---

### Phase 5 — Environment files

> **Do NOT build these from `.env.example`.** Both templates are stale in ways that fail
> silently: the backend template documents **Odoo** in the accounting block and has zero
> `ZOHO_BOOKS_*` keys; it has **no `ID_HASH_SECRET` entry at all**; and line 34 ships
> `VERIFYNOW_MODE=sandbox`. The frontend template is missing `NEXT_PUBLIC_SITE_URL`,
> `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `INTERNAL_API_URL`,
> `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_PAYMENT_MODE` and `NEXT_PUBLIC_DISABLE_PWA`.

Write `~/app/backend/.env` and `~/app/frontend/.env.production` by hand. `chmod 600` both.

Generate the fresh secrets:

```bash
openssl rand -base64 48    # JWT_ADMIN_SECRET  — backend REFUSES TO BOOT without a strong one
openssl rand -base64 48    # ID_HASH_SECRET    — fresh this time, see section 2
openssl rand -base64 32    # HEALTH_PING_SECRET
openssl rand -base64 32    # COMING_SOON_BYPASS_SECRET
npx web-push generate-vapid-keys   # VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY, as a matched pair
```

**Backend values that must be right:**

| Variable | Value | Consequence of getting it wrong |
|---|---|---|
| `NODE_ENV` | `production` — set in **both** `.env` and the pm2 config | `assertProductionConfig()` in `main.ts` keys off it |
| `JWT_ADMIN_SECRET` | strong random | Missing or default → backend throws at boot, pm2 crash-loops, site is 502 |
| `ID_HASH_SECRET` | fresh random | Back it up in the password manager the moment it exists |
| `DATABASE_URL` | `postgresql://alloutdoor:PASS@localhost:5432/alloutdoor_prod?schema=public` | Strip `?schema=public` when passing to `pg_dump`, never in the app |
| `PAYMENT_MODE` / `PAYMENTS_LIVE` / `PEACH_ENV` | `paygate` / `false` / `sandbox` | The site must land inert. Do not combine a first deploy with a payments go-live |
| `VERIFYNOW_MODE` | exactly `production` | Anything else = every seller passes KYC against canned data |
| `ZOHO_BOOKS_ENABLED` | `false` initially | Flip after the box is proven |
| `MEILISEARCH_HOST` | `http://127.0.0.1:7700` | — |
| `FRONTEND_URL` | `https://alloutdoor.co.za` | Drives the CORS allowlist |
| `CLERK_AUTHORIZED_PARTIES` | must include `https://alloutdoor.co.za` | Wrong and every token is rejected — the whole site logs out with no obvious cause |
| `EMAIL_LOGO_URL` | new domain | `notifications.service.ts:551-553` otherwise hard-codes an absolute URL |

**Frontend values:**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.alloutdoor.co.za/api` — **must include the `/api` suffix.** Callers pass bare paths. Without it, 404 on every request. |
| `INTERNAL_API_URL` | `http://localhost:3001/api` — the loopback hop, must not go out through Cloudflare |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL` | `https://alloutdoor.co.za` |
| `COMING_SOON_GATE` / `COMING_SOON_BYPASS_SECRET` | `on` + the secret, for the dry run |

> `COMING_SOON_GATE=on` with the secret unset makes `/preview` return a hard 500 and there
> is **no way through the gate at all**. Set both in the same deploy.

> `NEXT_PUBLIC_*` values are inlined into the JavaScript bundle at **build** time. Editing
> `.env.production` and restarting pm2 does nothing. You must rebuild.

**Delete rather than carry:** `STITCH_CLIENT_ID`, `STITCH_CLIENT_SECRET`, `IMAP_*`,
`GOOGLE_MAPS_API_KEY` (the non-public one) — nothing reads any of them. And after the Bob
Go work lands, `PUDO_*` and `TCG_*` go too.

**Verify.** Boot the backend once in the foreground and read the log:

```bash
cd ~/app/backend && node dist/src/main
```

Four lines must appear: `Meilisearch connected`, and the FTS column + GIN index lines for
`ReloadingManualPage`, `AskGgKbEntry` and (if the models are kept) `HuntPdf`. Any FTS
failure means the database role cannot `ALTER TABLE` — go back to Phase 1 Step 4.

Confirm the warnings you expect are **absent**: no `VERIFYNOW_MODE is not "production"`, no
Anthropic key warning. Confirm the warnings you expect are **present**: Peach credentials
missing is correct at this stage.

---

### Phase 6 — DNS, Cloudflare and the certificate

1. Add the `alloutdoor.co.za` zone in the new Cloudflare account; change nameservers at
   Absolute Hosting.
2. **Re-create Absolute's MX records, DNS-only (grey cloud), immediately.** Verify with
   `nslookup -type=MX alloutdoor.co.za 1.1.1.1` and by sending yourself a real email.
3. Set SSL/TLS to **Full (strict)**.
4. Issue a **Cloudflare Origin Certificate** covering `alloutdoor.co.za` and
   `*.alloutdoor.co.za`. Install at `/etc/ssl/cloudflare/alloutdoor.pem` + `.key`,
   `chmod 600` the key.
5. Publish Clerk's CNAMEs, **DNS-only**.
6. Publish Resend's SPF/DKIM on `send.alloutdoor.co.za`, plus exactly one `_dmarc` TXT at
   `p=none`, **DNS-only**.
7. **Do not create the apex A record yet.**

> Do not reach for certbot. While the orange cloud is on, Let's Encrypt's HTTP-01 challenge
> is answered by Cloudflare, not by this box.

**nginx.** `infra/nginx/alloutdoor.conf` has literal `gungalore.co.za` server names (its own
header at line 23-27 explains why and gives the fix):

```bash
sudo cp ~/app/infra/nginx/alloutdoor.conf /etc/nginx/sites-available/alloutdoor
sudo sed -i 's/gungalore\.co\.za/alloutdoor.co.za/g' /etc/nginx/sites-available/alloutdoor
sudo sed -i 's#/etc/ssl/cloudflare/gungalore#/etc/ssl/cloudflare/alloutdoor#g' /etc/nginx/sites-available/alloutdoor
sudo ln -sf /etc/nginx/sites-available/alloutdoor /etc/nginx/sites-enabled/alloutdoor
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` before every reload, always. A syntax error on *reload* leaves the old config
running; on *restart* it leaves nginx down.

**Keep the apex `/api/*` proxy rule.** `docs/ARCHITECTURE.md:78` flags it as load-bearing.
It is easy to drop on the assumption that all API traffic goes via the `api.` host, and
that assumption is wrong.

**Cloudflare real-IP is mandatory, and silent when broken:**

```nginx
# /etc/nginx/conf.d/cloudflare-realip.conf
real_ip_header CF-Connecting-IP;
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# … every range from https://www.cloudflare.com/ips-v4 and /ips-v6
```

Without it, Express's `trust proxy 1` treats the Cloudflare edge as the client, and the
60-requests-per-minute throttler collapses into one shared bucket for the whole country.
**Verify** with `sudo tail -n 5 /var/log/nginx/access.log` — the leading address must be a
plausible visitor IP, not a Cloudflare edge address.

**Also at the edge:** re-enable HSTS (it is set at the edge today, not at the origin —
`frontend/next.config.mjs:60-61`); re-create caching rules; and **do not turn on "Cache
Everything"** — the app relies on the edge honouring `Cache-Control: private` on dynamic
HTML, and a shared cache holding a snapshot means newly published and newly cancelled
listings show stale.

---

### Phase 7 — Start the application

`infra/pm2/ecosystem.config.js` hard-codes `APP_ROOT = '/home/gungalore/app'` (line 50) and
names the processes `gungalore-backend` / `gungalore-frontend` (lines 56, 112). Update all
three in the repo, on a branch, and commit — do not edit it only on the server.

```bash
cd ~/app
pm2 start infra/pm2/ecosystem.config.js
pm2 save
pm2 startup systemd      # prints a sudo command — run it
```

**Verify:**

```bash
curl -f  http://localhost:3001/api/health
curl -fs http://localhost:3000 > /dev/null && echo FRONTEND OK
pm2 list                                    # both online, restart count 0
systemctl is-enabled pm2-alloutdoor         # enabled
```

**If it fails.** A climbing restart count means crash-looping — `pm2 logs alloutdoor-backend
--lines 100 --nostream`. The usual cause is a missing or default `JWT_ADMIN_SECRET`, which
makes `main.ts` throw on purpose. `MODULE_NOT_FOUND` means the script path is wrong: it is
`dist/src/main.js`, not `dist/main.js` (the extra `src` comes from `nest-cli.json`).

**Then rebuild the Meilisearch index.**

> **Meilisearch will look perfectly healthy and be completely empty.** `isConnected` is true
> as soon as `/health` answers; it does not check that documents exist. Category browse
> still works because it routes through Prisma. But search returns zero results for every
> query and the browse filter chips vanish entirely. Green dashboard, dead catalogue. This
> is the most likely "why is nobody buying anything" moment on day one.

There is no HTTP reindex route — it was deleted on 2026-07-18. Either save any filterable
attribute in `/admin` → Category Attributes (which fires
`refreshListingFilterableAttributes()` then `reindexAllActiveListings()`), or write a
one-off script calling `ListingsService.reindexAllActiveListings()`
(`backend/src/listings/listings.service.ts:3483-3493`). With zero listings there is nothing
to index yet, so the real test comes after the first listings are created — but write and
test the script now, not on launch day.

The `cartridges` index rebuilds itself on the first Load Lab burn-chart request. Hit the
powder chart once to warm it. The `pudo_lockers` index is being deleted (section 4.5).

---

### Phase 8 — Bob Go

Section 4 is the scope. Runs in parallel with everything above. The sequencing that matters:

1. **Sandbox token on day one.** Answer the seven questions in 4.1 before estimating or
   building. Two of them (the booking two-step, and whether `service_code` expires) swing
   the estimate by several days each.
2. **Decide the enum names before any code.** `COURIER_DOOR` / `COURIER_PICKUP_POINT`.
   Changing your mind halfway means touching every call site twice.
3. **Write `money.ts` first**, with its tests, before any endpoint work. Everything else
   consumes it.
4. **Enumerate the tracking vocabulary before writing the status map.** This is the payout
   gate.
5. **Register the production webhook via `POST /webhooks` as a scripted deploy step**, not a
   support ticket.

Do not go live on the production Bob Go base URL until a full quote → book → waybill →
track → cancel cycle has passed in sandbox. **Creating a shipment on production bills real
money.**

---

### Phase 9 — Dry run on a test hostname

**Why.** There is no staging environment — `docs/ARCHITECTURE.md:32-34` is explicit that
work goes from a laptop to production after a local type-check and build. This phase is the
substitute, and it is the last point at which everything is reversible for free.

Create `staging.alloutdoor.co.za` → `<NEW_ORIGIN_IP>`, **proxied (orange cloud)**, protected
by a Cloudflare Access rule or nginx basic-auth so it is not publicly crawlable. Get through
the coming-soon gate at `https://staging.alloutdoor.co.za/preview?key=<secret>`.

> `frontend/app/preview/route.ts:45-47` builds its redirect target from the Host header with
> a hard-coded `gungalore.co.za` fallback. Change it.

Also test via a hosts-file override, which exercises the real apex hostname — needed for
the Clerk FAPI, the Google Maps referrer restriction and cookie scoping. Notepad as
Administrator, `C:\Windows\System32\drivers\etc\hosts`:

```
<NEW_ORIGIN_IP> alloutdoor.co.za
<NEW_ORIGIN_IP> www.alloutdoor.co.za
```

**Remove those lines before going live** or your PC keeps resolving straight to the box and
you are not testing what visitors see.

**The checklist. Every unticked box is an abort criterion.**

- [ ] Homepage renders, images load
- [ ] Create three test listings, then type three characters in the search box — **results
      appear.** (Empty Meilisearch is the top day-one failure.)
- [ ] Browse a category — **filter chips appear** with counts
- [ ] Sign up a fresh account. Backend log shows `Clerk webhook: user.created`. No
      signature-failure alert.
- [ ] "Continue with Google" — full round trip, and consent-sync fires afterwards (it is the
      only POPIA consent record on the OAuth path)
- [ ] Type an address at checkout — **autocomplete appears**; "use my location"
      reverse-geocodes. If either fails, the browser console names the missing Google API.
- [ ] One transactional email arrives, **not in spam**, logo renders
- [ ] One SMS arrives **on a real phone** via `backend/scripts/send-prod-sms-test.mjs`. A log
      line is not proof — STUB mode logs and reports success.
- [ ] `/admin/login` works (create the admin with `backend/scripts/create-admin.mjs`)
- [ ] `/admin/credits` — every tile returns a number, not "not configured"
- [ ] Open a reloading manual in `/admin/reloading` and download it
- [ ] Ask Boet a question requiring a manual citation — it answers rather than erroring
- [ ] The Load Lab powder chart renders (warms the `cartridges` index)
- [ ] Cartridge spec panel shows correct chamber/pressure for `.308 Win`, `8×57 IS` and
      `.45-70 Govt.` — the three that were wrong before the OVERRIDES fix
- [ ] `/checkout` is inert — payments must not be live
- [ ] Bob Go: one sandbox shipment end to end — quote → book → waybill PDF downloads →
      track → cancel
- [ ] Bob Go: fire one test webhook of each of the six types; confirm a `TrackingEvent` row
      lands and that a pickup-point arrival does **not** set `DELIVERED`
- [ ] Light load test (20 concurrent page loads) while watching `free -h` — the box is not
      swapping under normal traffic

---

### Phase 10 — Go live

With no users, no orders and no in-flight parcels, this is not the fraught window the old
plan described. It is: point DNS at the box and turn off the gate.

1. Create the apex A record and `www`, **proxied (orange cloud)**, pointing at
   `<NEW_ORIGIN_IP>`. Add `api.alloutdoor.co.za` the same way.
2. Set `COMING_SOON_GATE=off`, rebuild the frontend (`NEXT_PUBLIC_*` is inlined at build
   time), `pm2 reload alloutdoor-frontend --update-env`.
3. Register the Bob Go production webhook at the new URL.
4. `curl -sI https://alloutdoor.co.za | head -1` from your own machine, twice, three
   seconds apart. The first request after a reload can be served by the process on its way
   out; the second tells you what visitors get.

**If a health check fails after a reload: do not reflexively `pm2 restart`.** Stop and
report. A failed reload leaves the old version serving; restarting is what converts a
non-event into an outage.

**Deploys from here on** follow `docs/DEPLOYMENT.md` — detached builds into a
commit-unique log, wait on the build *process* not a marker file, backend reloaded before
frontend. Update that document's host table and SSH alias in the same commit that changes
the pm2 config.

---

### Phase 11 — After

1. **Old box:** stop the marketplace pm2 processes only. Two boxes both running the ~26
   schedulers means every cron fires twice.
2. **301 the old domain.** In the old Cloudflare zone, a Redirect Rule:
   `gungalore.co.za/*` → `https://alloutdoor.co.za/$1`, status 301, preserve path and query.
   Keep the old zone and its origin certificate alive while the redirect runs.
3. **Watch** `/admin/alerts` and `/admin/credits` daily for the first week.
4. **Day 2:** flip `ZOHO_BOOKS_ENABLED=true`, restart, post one throwaway document, confirm
   it lands.
5. **Week 2, once the sending domain is clean:** change `EMAIL_FROM` in
   `backend/src/common/brand.ts:35` to the verified All Outdoor address and sweep the other
   hard-coded support addresses (`payments/receipt.service.ts:200`, `kyc.service.ts:842`,
   `push/push.service.ts:41`, `frontend/lib/support-contact.ts:11`). **Make sure
   `support@alloutdoor.co.za` is a real, monitored mailbox first** — one email template
   tells sellers to reply to it.
6. **Swap the support phone placeholder.** `frontend/lib/support-contact.ts` shows
   `+27 87 550 0000`; the real operator cell is on a different provider. Update when the
   dedicated line arrives.
7. **Code fixes worth landing once the dust settles.** All pre-existing:
   add `ID_HASH_SECRET` to `.env.example` and to the hard-throw block in `main.ts:40-48`;
   delete the committed default-salt fallback at `kyc.service.ts:32-34`; add hard boot
   assertions for `RESEND_API_KEY` and `SMSPORTAL_CLIENT_ID`; add `OptionalClerkGuard` and a
   tighter `@Throttle` to `POST /shipping/quote` (`shipping.controller.ts:86-90`), which
   today has **no guard at all** and calls a metered carrier API on every anonymous request;
   update `.env.example`'s accounting block from Odoo to Zoho.

**On letting `gungalore.co.za` lapse.** The redirect should run for at least six months —
long enough for search engines to move the index and for any printed or shared link to die
off. There are no transactional links to protect: no orders, no `/s/<token>` SMS deep links
in flight, no campaign traffic.

> **Before the domain lapses, change every account that uses an `@gungalore.co.za` address
> for login or password recovery.** Whoever registers the domain next can receive those
> reset emails. Go through the password manager account by account. This is the one part of
> letting a domain go that actually bites.

And see section 7 — `ballistics.gungalore.co.za` is a subdomain of the domain you are
letting lapse.

---

## 6. Legal identity

### Already done, in code

`frontend/lib/brand.ts` and `backend/src/common/brand.ts` carry the new entity, and 40
references across 12 legal pages plus the site footer resolve through them: about,
aml-policy, complaints, contact, fees, legal, paia, privacy, regulated-categories, terms,
regulated-items, and `site-footer.tsx`.

One stale comment remains, at `backend/src/common/brand.ts:5-7`. Fix it.

### Not done — the human work

**1. AML and RMCP policy documents, rewritten for the new entity.**
The v1.0 finals in `~/Downloads` carry the old company's name and registration number and
an "Effective 14 July 2026" date that is now retroactive and belongs to a company that is
being wound down. They were sent to Nedbank without attorney review once. Do not reuse
them. Rewrite for ALLOUTDOOR (PTY) LTD, date them from the new company's actual start, and
**get them reviewed before they are submitted this time.**

**2. The TPPP application.**
Nedbank as acquirer, Peach as gateway. Never use the word "escrow" in any document — the
platform holds funds; it does not operate a trust account. PEP screening via VerifyNow.
This is the critical path to trading (section 3).

**3. Information Officer registration with the Information Regulator.**
Required for the new entity, in the new entity's name, before it processes personal data at
any scale. The old company's registration does not transfer. The PAIA manual at
`frontend/app/(legal)/paia/page.tsx` names the Information Officer — make sure the page and
the registration agree.

**4. The old company's remaining POPIA obligation.**
GunGalore (Pty) Ltd is the responsible party for the personal data it collected, including
**one encrypted SA ID number** still held in the old database. That obligation does not
transfer with the code, and it does not evaporate when the box is decommissioned.

Two things follow, and the first is the one people get wrong:

> **Do not copy that ID number into the new database.** ALLOUTDOOR (PTY) LTD is a different
> juristic person and has no lawful basis to hold personal data collected by another
> company under a different privacy notice. That seller re-does KYC under the new entity,
> from scratch, with fresh consent.

And the old company must decide, with the attorney, between two paths: destroy the record
now and log the destruction (date, method, who authorised it), or retain it for whatever
statutory period applies to the relationship that was established. Whichever is chosen, the
old company keeps its Information Officer registered until the record is gone, and the
decision needs to be written down rather than implied by switching off a server.

**5. Two statutory pages need more than a name change.**
`terms/page.tsx:457-459` and `privacy/page.tsx:226-229` list third-party processors and what
personal data each receives. Both currently name Pudo and The Courier Guy. Under Bob Go the
two rows become one — but Bob Go is an *aggregator*, so buyer address and parcel data pass
onward to whichever provider fulfils the leg. Naming only Bob Go is arguably an incomplete
operator disclosure. The two pages must also match each other exactly. See section 4.10.

**6. The published fee schedule.**
`fees/page.tsx:144-147` states the R15 handling fee and names both carriers. Under a new
legal entity that copy is a fresh supplier disclosure under ECT Act s43 and must be correct
on day one, not patched after launch. Also re-check that R15 still makes commercial sense
against Bob Go's actual rates before republishing it — the old architecture existed partly
to arbitrage Pudo wholesale (~R200) against TCG retail (R123) for the same parcel
(`tcg.service.ts:5-10`), and an aggregator gives one price. **Quote a representative basket
in the sandbox and re-check the margin before go-live.**

---

## 7. What stays on the old box

Three things are not part of this build and remain on the Vultr machine:

| | Where | Notes |
|---|---|---|
| Ballistic Calculator | `~/ballistics-app/`, `ballistics.gungalore.co.za`, own database, own pm2 processes, own nginx site | A separate application |
| ballistic-hunter | old box | — |
| pvrescue.co.za | old box | Unrelated |

**Two problems with "they just stay there".**

**(a) `ballistics.gungalore.co.za` is a subdomain of the domain you are letting lapse.** The
redirect rule and the eventual lapse both kill it. Before either happens, the ballistics app
needs its own domain, or a subdomain of `alloutdoor.co.za` pointed at the old box. Decide
this early — it is cheap now and an outage later.

**(b) The hunt-ballistics code is compiled into the marketplace backend.**
`HuntBallisticsModule` is imported and registered in `backend/src/app.module.ts:48,108`, and
`HuntPdf`, `HuntPdfPage` and `RangeEstimate` are models in the marketplace
`schema.prisma:3229-3322`. "Ballistics stays behind" is not automatic.

The clean slate makes it nearly automatic: those three tables simply never get imported, so
they exist but stay empty. But the module still boots, `migrate deploy` still creates the
tables, and the FTS boot DDL still runs against `HuntPdf`.

**A decision, and it should be made deliberately:**

- **Delete them** — remove the two lines from `app.module.ts`, delete
  `backend/src/hunt-ballistics/`, delete the five declarations from `schema.prisma`
  (~95 lines), drop `HUNT_BALLISTICS_ADMIN_KEY`. Verified: zero relations into the rest of
  the graph, so it is a pure subtraction with no cascade. The two-product separation becomes
  structural rather than a convention.
- **Leave them inert** — costs three empty tables and one boot-time DDL statement, and the
  code is there if the products ever recombine.

Recommendation: delete. This is the one moment when it costs nothing, and "the ballistics
app is not actually independent" has already been a source of confusion once.

**How long the old box lives.** Keep it running for at least three months after go-live —
it is the fallback build machine if the 4 GB box cannot compile the frontend (Phase 2), it
holds the only original copies of the reloading PDFs until the rsync is verified, and it
hosts three live applications. Revoke the old vendor keys and the old Cloudflare origin
certificate no earlier than a month after go-live.

---

## 8. Open questions

These need an operator decision. Nothing else in this document is blocked on anything but
work.

1. **Bob Go billing model — prepaid wallet or monthly invoice?** This decides whether the
   credit-monitoring cron and the `/admin/credits` tile exist at all, and it changes the
   failure mode: a prepaid wallet running dry now stops *all* shipping, because one
   aggregator account funds every parcel rather than two separate ones.

2. **Enum naming: `COURIER_DOOR` / `COURIER_PICKUP_POINT`, or keep `PUDO` / `TCG` pointed at
   Bob Go?** The shortcut saves about two days now and bakes a dead carrier's name into the
   schema, the admin UI and the analytics SQL permanently. Recommendation: rename. But it is
   a real two days if cash is tight at cutover, and it must be decided before any code.

3. **Carrier price-change reconciliation: build it, or accept the bleed?** Bob Go's
   charged-amount and charged-weight webhooks make post-hoc carrier re-billing visible for
   the first time. Building it is 3–4 developer-days. Not building it means the R15
   handling margin is notional the moment a parcel re-weighs, and the first evidence is the
   monthly invoice. Today the system already bleeds this silently, so declining is not a
   regression — but it is now a choice rather than an oversight.

4. **Does the new box need more RAM?** 2 cores and 4 GB, with the frontend build peaking
   over 2 GB next to Postgres and Meilisearch. Phase 2 answers it empirically. If the answer
   is "it builds, but only with everything else stopped", that is a permanent operational
   tax on every deploy — and the old box that is currently the fallback is scheduled for
   decommission.

5. **Delete the hunt-ballistics module and models, or leave them inert?** See section 7.

6. **How long does `gungalore.co.za` redirect before it lapses?** Six months is the
   suggested floor. And `ballistics.gungalore.co.za` needs a new home before the answer
   matters.

7. **Zoho chart of accounts — does the R15 shipping handling margin get its own revenue
   line?** Free to add while the ledger is empty; a real reconstruction job later.

8. **Which Setting flags start ON?** 54 rows came off the old box. Daily Deals, the prize
   draw and several others should almost certainly start OFF on a site that is not trading.

---

## Top three risks

**1. The payout gate mis-maps a Bob Go status.** `backend/src/shipping/status-map.ts:92-93`
— exactly two carrier slugs reach Prisma `DELIVERED`, and `DELIVERED` starts the clock that
releases the seller's money. Bob Go aggregates many providers, so its vocabulary is its own
and may vary by provider underneath. If an event meaning "parcel is in the locker, buyer
hasn't opened it" maps to `DELIVERED`, the platform pays sellers for goods buyers never
received and finds out via chargebacks. Enumerate the full vocabulary from the sandbox
before writing a single map row.

**2. The 100× shipping error.** Bob Go returns rand with decimals (263, 262.5) into a
codebase that is integer cents from the quote boundary onward. Both sides are `number`, so
types will not catch it. One missed conversion and every shipping charge is out by two
orders of magnitude. One module, no bare `* 100`, a sanity throw above R100k, and a manual
reconciliation of the very first live order against the Bob Go invoice before a second one
is allowed through.

**3. Peach and Nedbank restart from zero and gate everything.** The technical build finishes
weeks before the site can take a rand. Money is the critical path, not code: bank account,
then TPPP, then Peach — and both the payment rail and the courier rail will be going live
for the first time simultaneously, on a system with no staging environment and no production
baseline to regress against. Start the bank application on day one and plan the launch date
backwards from it, not forwards from the code.
