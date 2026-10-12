# All Outdoor — Clean-Slate Build Runbook

> **Origin IP addresses are deliberately not written down here.** The site sits behind
> Cloudflare with an Origin Certificate, and that model depends on the origin address
> staying private — publish it and anyone can bypass the WAF and hit the box directly. Git
> history keeps whatever you commit, forever, even if you edit it out later. The real
> values live in the operator's password manager and in `~/.ssh/config` on the machines
> that need them. Throughout this document, `<NEW_ORIGIN_IP>` and `<OLD_ORIGIN_IP>` are
> placeholders you substitute as you go.

> **This document replaces an earlier migration runbook that used to live at this path.**
> That one was written for a rebrand of the *same* legal entity and preserved users and the
> ledger across the move. Some of its instructions no longer apply. If you have a copy or a
> memory of it, treat this document as authoritative.

> **Status — Bob Go is the courier rail.** It is **door-to-door only** (plus a Pargo
> store-pickup buyer option), and the platform always books the **cheapest Bob Go door
> rate**. The `ShippingMethod` enum uses a single **`COURIER`** value. See section 4 and
> `docs/ARCHITECTURE.md`.

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
| Ozow + Nedbank TPPP | Restarts from zero under the new entity. Weeks to months. Gates trading entirely. |
| Bob Go courier integration — **DONE 2026-09-24** | Bob Go is the only courier rail, door-to-door at the cheapest rate, with Pargo store pickup as an alternative buyer option. See section 4. |
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
| Users, password hashes, sessions | 6 accounts. The new entity has no relationship with any of them. They sign up again — and since auth is ours now, there is no export to negotiate with anybody: a fresh `User` row and a fresh `Session` row is the whole of it. |
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

**2. Nedbank TPPP + Ozow merchant onboarding** · lead time: 4–12 weeks

This gates trading. Nothing sells until money can move. The relationship model stays as
planned: **Nedbank as acquirer, Ozow as the gateway.** Neither can be transferred
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

**5. Member auth and Didit** · lead time: minutes for the secret, an hour in the Didit console

*The operator needs:* the Cloudflare zone, and shell access to the box.

⚠️ **There is no identity provider to provision any more, and that deletes a whole class of
go-live risk.** Sessions, passwords and sign-up are ours. What used to be a third-party
application with its own domain, its own certificate issuance and its own CNAMEs is now
one secret:

```bash
openssl rand -hex 32        # JWT_MEMBER_SECRET
```

Put the **same value** in `backend/.env` and `frontend/.env.production`, both named
`JWT_MEMBER_SECRET` and **without a `NEXT_PUBLIC_` prefix** — the frontend verifies the
cookie server-side in middleware, and the prefix would ship the signing key to every
browser. It must be a **different value from `JWT_ADMIN_SECRET`**: the same string on both
and a member token verifies on an admin route. Missing, empty or left at the template
default and the backend refuses to start in production.

**Didit** now does identity verification and the email and phone codes. Create the
application in the Didit console and take `DIDIT_API_KEY` from it.

⚠️ **The KYC workflow must be NON-white-label.** `is_white_label_enabled: true` adds $0.20
a session *and* drops the workflow out of the free tier entirely — $0.56 against $0.00 for
the same verification. Check the flag in the console before pointing `DIDIT_WORKFLOW_ID` at
a workflow.

Then register the webhook destination at `https://alloutdoor.co.za/api/webhooks/didit` and
copy that destination's signing secret into `DIDIT_WEBHOOK_SECRET`. It fails closed: unset
or wrong and every verification outcome is dropped unverified, so a seller who finishes on
Didit's page stays PENDING forever with nothing saying why.

⚠️ **CLOUDFLARE HAS TO BE TOLD ABOUT THAT WEBHOOK.** Didit delivers from the single static
IP **`18.203.201.92`**, `User-Agent: DiditWebhook/2.0`. The origin sits behind Cloudflare
with a WAF in front, so that IP must be allowed for `alloutdoor.co.za` or every delivery is
dropped **at the edge** — nothing reaches the box, and **nothing in any application log
will say so.**

⚠️ `DIDIT_MODE` must be exactly `live`. Anything else **hard-fails the boot** in
production. The provider this replaced only logged an error, which is how a production box
could — and did — run sandbox identity checks and pass every seller against canned data.

### Company-documentation gated — start in week one or two

**6. SMSPortal** · lead time: 2–5 days (RICA / company verification)

*Needs:* company registration documents, and credit purchased up front.

> If `SMSPORTAL_CLIENT_ID` / `SMSPORTAL_API_SECRET` are missing, SMS silently enters STUB
> mode: it logs a row, returns `success: true`, and sends nothing. The SMS outage alarm
> cannot catch this because it counts SENT and FAILED rows, not STUB. Prove it with a real
> phone (`backend/scripts/send-prod-sms-test.mjs`), never with a log line.

**7. Identity verification** · *no lead time — it moved to step 5*

⚠️ **VerifyNow is gone, and so is the AWS Rekognition face-match and liveness that sat
beside it.** Didit does the whole job, needs no company-document review and no prepaid
credit, and is set up in step 5. Do not go looking for a KYC vendor to fund. Delete
`VERIFYNOW_API_KEY`, `_BASE_URL`, `_MODE` and `_BASIC_REPORT_TYPE` from any `.env` you
inherit rather than leaving them there to look load-bearing.

⚠️ **One capability went with VerifyNow and nothing free replaces it.** It returned the
applicant's name and date of birth from Home Affairs, which is what let the verdict
cross-check the typed details against the *state* rather than only against the document.
Didit sells the equivalent as the `zaf_africa_national_id` database check at $1.10 a
lookup. Until the operator turns that on, names come from the document Didit reads and
**no user-facing copy may claim a Home Affairs verification.**

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

> **Scope narrowed — see Phase 8.** This account is for LISTING PHOTOS ONLY. KYC identity
> documents and selfies are stored on the VPS instead, because Cloudinary uploads are public
> by default and the images sit in the United States. Do not point the KYC flow at this
> account "for now"; that is how it becomes permanent.

**11. Anthropic** — same key. Confirm the org has balance; a cold org with no balance means
every seller fails KYC vision and every listing lands in manual review.

**12. Google Cloud (Maps)** — same key, three APIs, referrer restriction updated to the new
domain, billing cap set.

---

## 4. Courier — Bob Go

Bob Go is the **only** courier rail. It is **door-to-door**: every non-firearm parcel is
booked at the **cheapest Bob Go door rate** for the parcel and route. A buyer may instead
choose **store pickup** (a Pargo counter, returned as a pickup-point rate in the same Bob
Go quote). Firearms and barrels never travel by courier — see section 9 of
`docs/ARCHITECTURE.md` and the Regulated Goods rules.

The integration lives in `backend/src/shipping/`:

- `bobgo.service.ts` — the client (quote, book, cancel, tracking, `GET /locations`).
- `bobgo-adapter.ts` — maps a Bob Go response onto the platform's carrier shape.
- `bobgo-webhook.service.ts` — the inbound tracking webhook.
- `shipping.service.ts` — the orchestration: quote → delivery option → book → track.

Two warnings are still true and were expensive to learn:

1. **The rand/cents boundary.** Bob Go rates come back as decimal rand; the database is
   integer ZAR cents everywhere. Convert exactly once, at the adapter, and never let a
   decimal leak inward.
2. **Bob Go answers HTTP 201 before a courier has agreed.** A booking starts unconfirmed.
   Branch on the `submission` field, never on "it did not throw".

Configuration is `BOBGO_API_KEY`, `BOBGO_BASE_URL` (⚠️ defaults to the **sandbox** —
production must set `https://api.bobgo.co.za/v2`) and `BOBGO_WEBHOOK_SECRET` (the webhook
is fail-closed without it). With no key the service is inert: rates and bookings are
skipped and logged. See `docs/ENVIRONMENT.md`.

---

## 5. The build, phased

Phases 1–7 are the box and can be done in about a week. Phase 8 (self-hosted KYC storage)
is a day and must land before the first real seller verifies. Phase 9 (Bob Go) is **done**
(2026-09-24) — door-to-door only. Phases 10–12 are the launch.

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

> **Never run `npx prisma db push`.** Three services — the Ask GG knowledge base,
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

> **EXECUTED 2026-08-12. Everything below is what actually happened, not what was
> planned.** Five defects were hit on this exact path; all are fixed in the repo now,
> so a rebuild from `33fdb84` onwards will not meet them. Recorded because they show
> what kind of thing breaks.
>
> | What broke | Why |
> |---|---|
> | `prisma migrate deploy` died at migration 15 of 98 | 27 of 70 models had no `CREATE TABLE` anywhere. Replaced with a baseline — see the archive README. |
> | `seed-cartridge-specs.ts` — `PrismaClientInitializationError` | Prisma 7 needs a driver adapter; three scripts were missed when the others were migrated. |
> | Same script — `SASL: client password must be a string` | It never loaded `.env`, so `DATABASE_URL` was undefined and pg reported it as a password *type* error. |
> | 8 cartridges differed from production by 1 bar | `maxPressureBar` is a float in the JSON and `Int?` in the column; Prisma rounded in one version and truncated in another. Now rounded explicitly. |
> | Manual restore failed on a foreign key | `ReloadingManual.uploadedByAdminId` is NOT NULL and pointed at the old GunGalore admin. Remap it to this box's admin id. |
>
> **Two things the seed does that you must know about.** It creates a SUPERADMIN — it
> now refuses under `NODE_ENV=production` unless `ADMIN_SEED_PASSWORD` is set, because
> the old fallback password is committed to this repository. And `npm run seed` was
> silently doing nothing at all until 2b7ea24 (`ts-node -e` swallowed the filename and
> exited 0), which is very likely how the schema and taxonomy drifted in the first place.
>
> **Verified results, by comparison against live production rather than by row count:**
> Categories 188 = 188 · CartridgeSpec **0 rows differ** · ManualLoad 50,789 = 50,789 ·
> ReloadingManual 19 + 3,894 pages · 19 PDFs, all 626 MB checksum-identical, every
> database row pointing at a file that exists · all 3,894 `tsvector` values populated by
> the generated columns, and a real full-text query returns 740 hits.
>
> **`npm run seed:help` needs one `User` row to exist.** It attributes authorship to an
> existing member and a fresh database has none. That is no longer a vendor dependency —
> sign-up is ours, so it unblocks the moment somebody registers. Run it in Phase 5 once
> the operator has signed up once, or set `ASK_GG_KB_SEED_AUTHOR_EMAIL`.

Order matters: categories first (other seeds reference them), then everything else.

> **Two things verified against the live database on 2026-08-12, before the box existed.**
>
> **Do NOT import the `Setting` table.** It looks like configuration and is mostly runtime
> state: 46 of its 54 rows are `cron:lastrun:*` timestamps, and importing stale ones either
> suppresses a cron's first run or trips the watchdog. Of the eight that are real, seven are
> feature flags to be set deliberately on the new box — and one is `house_seller_user_id`,
> which points at a User row that will not exist. Carrying it produces confusing behaviour
> that looks like a code bug. Set the flags by hand, and set the house-seller id after the
> house-seller account is created.
>
> **`Category` has a circular foreign key** (`parentId` is self-referencing), so a
> `--data-only` dump will not restore without `--disable-triggers` or parent-ordered inserts.
> This is another reason the seed path below is the right one — `prisma/seed.ts` builds the
> tree in dependency order and carries the `publicVisible` flags and the `membersOnly`
> carve-outs with it. Do not be tempted to dump this table.

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

# The reloading-manual tables — the ONLY database content that is not
# reproducible from the repo. Already exported and verified on the old box:
#   ~/ao-export/reference-data.sql      18 MB
#   ~/ao-export/reference-data.sql.gz   3.5 MB
#   sha256 begins 0e34a3a969160262bcf20a51
# Dumped with no warnings and in dependency order (ReloadingManual before
# ReloadingManualPage). CartridgeSpec is included as a belt-and-braces copy to
# diff against the seeded result — it is NOT the import path.
scp gungalore:~/ao-export/reference-data.sql.gz /tmp/
scp /tmp/reference-data.sql.gz alloutdoor:/tmp/
ssh alloutdoor "gunzip -c /tmp/reference-data.sql.gz | sudo -u postgres psql -d alloutdoor_prod"

# Prove the seeded CartridgeSpec matches the live one — this is the table where
# a 43-agent audit found 12 dangerous chamber/pressure mismatches.
ssh alloutdoor "sudo -u postgres psql -d alloutdoor_prod -t -A -c   'SELECT count(*), md5(string_agg(name || coalesce(\"maxPressureBar\"::text,\"\"), \",\" ORDER BY name)) FROM \"CartridgeSpec\";'"
# Compare against the same query on the old box. A mismatch means the seed and
# the audited data have diverged — stop and find out why before going live.
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
flags — the Claude KYC flow, the motivation writer, the licence centre, moderation
thresholds, and so on. Several
should stay OFF on a site that is not trading. Code defaults exist for every one of them
(`backend/src/settings/settings.service.ts`), so an unset row is safe.

---

### Phase 5 — Environment files

> **Read `.env.example` rather than copying it.** The backend template has caught up — it
> carries the `ZOHO_BOOKS_*` block, `ID_HASH_SECRET`, `JWT_MEMBER_SECRET` and the `DIDIT_*`
> set, and it names the dead `ODOO_*` and `VERIFYNOW_*` variables as dead. What it still
> ships is `DIDIT_MODE=sandbox`, which now **refuses to boot** in production instead of
> quietly approving canned identities — a loud failure, but a failure. The frontend
> template is still missing `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

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
| `PAYMENT_MODE` / `PAYMENTS_LIVE` / `OZOW_ENV` | `paygate` / `false` / `staging` | The site must land inert. Do not combine a first deploy with a payments go-live |
| `DIDIT_MODE` | exactly `live` | Anything else **throws at boot** — the process will not start. The provider this replaced only warned, and a box ran sandbox identity checks in production |
| `DIDIT_WEBHOOK_SECRET` | the destination secret from the Didit console | Fails closed — every verification outcome is dropped unverified and sellers stay PENDING forever |
| `ZOHO_BOOKS_ENABLED` | `false` initially | Flip after the box is proven |
| `MEILISEARCH_HOST` | `http://127.0.0.1:7700` | — |
| `FRONTEND_URL` | `https://alloutdoor.co.za` | Drives the CORS allowlist |
| `JWT_MEMBER_SECRET` | strong random, **the same value in `frontend/.env.production`**, and different from `JWT_ADMIN_SECRET` | Missing or default → backend throws at boot. Different on the two sides → every member token fails to verify and the whole site logs itself out with no obvious cause. Same as the admin secret → a member token verifies on an admin route |
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

**Delete rather than carry:** `IMAP_*` and `GOOGLE_MAPS_API_KEY` (the non-public one) —
nothing reads either.

**Verify.** Boot the backend once in the foreground and read the log:

```bash
cd ~/app/backend && node dist/src/main
```

Lines must appear: `Meilisearch connected`, and the FTS column + GIN index lines for
`ReloadingManualPage` and `AskGgKbEntry`. Any FTS
failure means the database role cannot `ALTER TABLE` — go back to Phase 1 Step 4.

Confirm the warnings you expect are **absent**: no `DIDIT_WEBHOOK_SECRET is not set`, no
model-key warning for whichever `LLM_PROVIDER` is selected. Confirm the warnings you expect
are **present**: Ozow credentials missing is correct at this stage. Note that the two
things that *would* have been warnings — a weak `JWT_MEMBER_SECRET` and a sandbox
`DIDIT_MODE` — are throws now, so if the process is up at all, both are right.

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
5. **Allow `18.203.201.92` through the WAF** for `alloutdoor.co.za` — Didit's single
   webhook source (`User-Agent: DiditWebhook/2.0`). Blocked here, every verification
   outcome dies at the edge and no application log mentions it.
6. Publish Resend's SPF/DKIM on `send.alloutdoor.co.za`, plus exactly one `_dmarc` TXT at
   `p=none`, **DNS-only**.
7. **Do not create the apex A record yet.**

> Do not reach for certbot. While the orange cloud is on, Let's Encrypt's HTTP-01 challenge
> is answered by Cloudflare, not by this box.

**nginx.** `infra/nginx/alloutdoor.conf` has literal `gungalore.co.za` server names (its own
header at line 23-27 explains why and gives the fix):

> ✅ **That header is now out of date in our favour.** It says to do the rename "only
> together with the DNS move and the identity provider's FAPI domain". Nothing outside DNS
> is pinned to the old hostname any more, so the `gungalore.co.za` → `alloutdoor.co.za`
> rename is unblocked and goes with the DNS move alone.

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

The `cartridges` index rebuilds itself on first use. Warm it once after launch.

---

### Phase 8 — Self-hosted KYC storage

**Do this before the first real seller verifies.** Once identity documents exist in a
third-party account, moving them means copying identity documents around, and every copy is
another place that can leak. On a clean slate the cost is a day; later it is a project with a
compliance question attached.

Listing photos are **not** in scope. They stay on Cloudinary — high volume, they genuinely
benefit from a CDN and format negotiation, and they are not sensitive. This phase moves the
KYC images only.

#### Why

Three problems, all in the same place.

**1. Identity documents are on public URLs.** `backend/src/cloudinary/cloudinary.service.ts:31-35`
sets `folder`, `resource_type` and a transformation, and nothing else. There is no
`type: 'authenticated'` and no `access_mode`, and Cloudinary's default is public. So
`User.kycIdDocumentUrl` and `User.kycSelfieUrl` are plain, unauthenticated HTTPS URLs holding
a seller's ID document and face photo. The URL is unguessable, which is obscurity, not access
control — anyone who obtains one from a log line, a screenshot, a support email or a database
export can fetch it.

**2. They cross the border.** The images are stored in the United States and, in the Claude
flow, transmitted to a second US provider. That is a POPIA s72 cross-border transfer of
identity and biometric data, and it is why `/privacy` now has to disclose it and the consent
screen has to name both providers. Storing them on a South African VPS removes the transfer
and the disclosure obligation with it.

**3. Erasure does not erase.** `backend/src/users/users.service.ts:612-621` nulls the URL
columns on account deletion and its own comment concedes the asset itself survives. A local
file can simply be deleted, so self-hosting fixes this defect as a side effect rather than as
another follow-up nobody schedules.

#### What has to change

Only two files read or write these columns — `kyc.service.ts` and `users.service.ts` — but
three Cloudinary-shaped assumptions are baked into them and each needs replacing.

| Coupling | Where | Replace with |
|---|---|---|
| PDF detection by URL shape: `kycIdDocumentUrl.includes('/raw/upload/')` | `kyc.service.ts:663` | An explicit `kycIdDocumentMime` column. Sniffing a vendor's URL structure to decide how to parse a file is fragile even without a migration. |
| The ID document is handed to Anthropic as a URL it fetches itself: `{type:'url', url: this.jpegUrl(...)}` | `claude-kyc.service.ts:152`, helper at `:238-241` | Read the bytes from disk and send base64 inline, exactly as the selfie already is at `:163`. Delete `jpegUrl()` — it rewrites a Cloudinary path to force JPEG and has no meaning off Cloudinary. |
| Column holds a fully-qualified URL | `schema.prisma` | Store a **relative storage key**, not a URL. The serving host changes; the key does not. |

Note the second row is a security improvement on its own: today the document must be publicly
fetchable *because* Anthropic fetches it. Sending bytes inline removes that requirement.

#### Storage design

```
/var/lib/alloutdoor/kyc/          0700, owned by the app user, NOT under the repo
  <uuid>.jpg | .png | .pdf
```

- **Filename is a fresh UUID**, never derived from the user id. A predictable path is an
  enumeration hole, and the whole point is that possession of a URL grants nothing.
- **Outside the deploy directory** so a redeploy, a `git clean` or a fresh clone cannot touch
  it.
- Volume is negligible: two files per seller at roughly 500 KB after the client-side resize.
  A thousand verified sellers is about 1 GB.

Schema:

```prisma
kycIdDocumentKey   String?   // was kycIdDocumentUrl — relative key, not a URL
kycIdDocumentMime  String?   // replaces URL-shape sniffing
kycSelfieKey       String?   // was kycSelfieUrl
```

#### Serving

One authenticated endpoint, admin-only, streaming from disk:

```
GET /admin/kyc/:userId/document
GET /admin/kyc/:userId/selfie
```

Behind `AdminJwtGuard`. Set `Cache-Control: private, no-store` and never emit these paths
into a public template, an email or a log line. The seller does not need to re-read their own
document, so do not build that route — every route that can serve an ID document is a route
that can leak one.

> Reminder from `docs/ARCHITECTURE.md`: a module with an `AdminJwtGuard` controller must
> import `JwtModule.register({})` **and** provide the guard, or Nest crash-loops at boot while
> `tsc` stays perfectly happy.

#### Erasure

Delete the file, then null the columns, in that order — a failed unlink must not leave a
dangling row claiming the file is gone. This closes the defect at `users.service.ts:612-621`.
When it works, remove the "not deleted today" wording from `/privacy` §3.2 — **and not
before**. That sentence is currently true and must stay true until the code catches up.

#### Backups

These are special-category data and must not go in the ordinary nightly dump:

- Encrypt at rest in the backup, off-box.
- Retain to the KYC schedule, not the database schedule.
- Never copy the directory to a developer machine, a shared drive or a support ticket.

If that sounds like more care than a photo directory deserves — that is the point. It is why
listing photos stay on Cloudinary and these do not.

#### Verify

1. Complete a verification end to end and confirm two files land in
   `/var/lib/alloutdoor/kyc/` with UUID names and `0600`.
2. `curl` the raw path with no admin session → **401/403**, never the image.
3. `curl` the admin endpoint with a valid session → the image.
4. Grep the application log for the storage key after a full verification run → **no hits**.
5. Delete a test account → confirm both files are gone from disk, not merely unlinked in the
   database.
6. Confirm the Claude flow still returns a verdict with the document sent inline — that path
   changed and it is the one most likely to silently regress to a URL.

#### Effort

**1 day**, with the caveat that step 6 needs a real Anthropic round-trip against a real
document to prove the base64 path works. Do not mark this done on unit tests alone.

---

### Phase 9 — Bob Go (DONE 2026-09-24)

Bob Go is the only courier rail, door-to-door at the cheapest rate, with Pargo store pickup
as an alternative buyer option. `BOBGO_API_KEY` and `BOBGO_BASE_URL` (production:
`https://api.bobgo.co.za/v2`) must be set, and the webhook registered.

Do not book on the production Bob Go base URL until a full quote → book → waybill → track →
cancel cycle has passed in sandbox. **Creating a shipment on production bills real money.**

---

### Phase 10 — Dry run on a test hostname

**Why.** There is no staging environment — `docs/ARCHITECTURE.md:32-34` is explicit that
work goes from a laptop to production after a local type-check and build. This phase is the
substitute, and it is the last point at which everything is reversible for free.

Create `staging.alloutdoor.co.za` → `<NEW_ORIGIN_IP>`, **proxied (orange cloud)**, protected
by a Cloudflare Access rule or nginx basic-auth so it is not publicly crawlable. Get through
the coming-soon gate at `https://staging.alloutdoor.co.za/preview?key=<secret>`.

> `frontend/app/preview/route.ts:45-47` builds its redirect target from the Host header with
> a hard-coded `gungalore.co.za` fallback. Change it.

Also test via a hosts-file override, which exercises the real apex hostname — needed for
the Google Maps referrer restriction and for session-cookie scoping. Notepad as
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
- [ ] Sign up a fresh account — username, email, password — confirm the emailed code, and
      sign in. A `Session` row exists for it, and a hard refresh keeps you signed in (that
      is the refresh-token rotation working, not the 15-minute access token).
- [ ] Start seller verification and finish it on Didit's hosted page. The webhook lands and
      `kycStatus` flips. **If it stays PENDING, check the Cloudflare WAF before anything
      else** — a blocked `18.203.201.92` looks identical to a broken integration and logs
      nothing.
      *(There is no "Continue with Google" to test. Google sign-in rode the old provider's
      hosted redirect and went with it; replacing it needs an OAuth client of our own.)*
- [ ] Type an address at checkout — **autocomplete appears**; "use my location"
      reverse-geocodes. If either fails, the browser console names the missing Google API.
- [ ] One transactional email arrives, **not in spam**, logo renders
- [ ] One SMS arrives **on a real phone** via `backend/scripts/send-prod-sms-test.mjs`. A log
      line is not proof — STUB mode logs and reports success.
- [ ] `/admin/login` works (create the admin with `backend/scripts/create-admin.mjs`)
- [ ] `/admin/credits` — every tile returns a number, not "not configured"
- [ ] Open a reloading manual in `/admin/reloading` and download it
- [ ] A reloading reference lookup renders (warms the `cartridges` index)
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

### Phase 11 — Go live

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

### Phase 12 — After

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
   assertions for `RESEND_API_KEY` and `SMSPORTAL_CLIENT_ID`; add `OptionalAuthGuard` and a
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
Nedbank as acquirer, Ozow as gateway. Never use the word "escrow" in any document — the
platform holds funds; it does not operate a trust account. ⚠️ **Do not write "PEP screening
via VerifyNow" into this application again** — VerifyNow is gone, and Didit's AML/PEP
screening is a workflow feature nobody has switched on. Either turn it on before the
application is submitted or describe the manual control that actually exists.
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
personal data each receives. The courier rows must name the live delivery aggregator, and
because it is an *aggregator*, buyer address and parcel data pass onward to whichever
provider fulfils the leg. Naming only the aggregator is arguably an incomplete operator
disclosure. The two pages must also match each other exactly.

**6. The published fee schedule.**
`fees/page.tsx:144-147` states the R15 handling fee. Under a new
legal entity that copy is a fresh supplier disclosure under ECT Act s43 and must be correct
on day one, not patched after launch. Also re-check that R15 still makes commercial sense
against the courier's actual rates before republishing it. **Quote a representative basket
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

**(b) The separate ballistics application is not compiled into the marketplace backend.**
The two-product separation is structural; nothing ballistics-related ships in this repo.

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

2. **Carrier price-change reconciliation: build it, or accept the bleed?** Bob Go's
   charged-amount and charged-weight webhooks make post-hoc carrier re-billing visible for
   the first time. Building it is 3–4 developer-days. Not building it means the R15
   handling margin is notional the moment a parcel re-weighs, and the first evidence is the
   monthly invoice. Today the system already bleeds this silently, so declining is not a
   regression — but it is now a choice rather than an oversight.

3. **Does the new box need more RAM?** 2 cores and 4 GB, with the frontend build peaking
   over 2 GB next to Postgres and Meilisearch. Phase 2 answers it empirically. If the answer
   is "it builds, but only with everything else stopped", that is a permanent operational
   tax on every deploy — and the old box that is currently the fallback is scheduled for
   decommission.

4. **How long does `gungalore.co.za` redirect before it lapses?** Six months is the
   suggested floor. And `ballistics.gungalore.co.za` needs a new home before the answer
   matters.

5. **Zoho chart of accounts — does the R15 shipping handling margin get its own revenue
   line?** Free to add while the ledger is empty; a real reconstruction job later.

6. **Which Setting flags start ON?**

---

## Top three risks

**1. The payout gate mis-maps a Bob Go status.** `backend/src/shipping/status-map.ts:92-93`
— exactly two carrier slugs reach Prisma `DELIVERED`, and `DELIVERED` starts the clock that
releases the seller's money. Bob Go aggregates many providers, so its vocabulary is its own
and may vary by provider underneath. If an event meaning "parcel is ready for collection,
buyer hasn't opened it" maps to `DELIVERED`, the platform pays sellers for goods buyers never
received and finds out via chargebacks. Enumerate the full vocabulary from the sandbox
before writing a single map row.

**2. The 100× shipping error.** Bob Go returns rand with decimals (263, 262.5) into a
codebase that is integer cents from the quote boundary onward. Both sides are `number`, so
types will not catch it. One missed conversion and every shipping charge is out by two
orders of magnitude. One module, no bare `* 100`, a sanity throw above R100k, and a manual
reconciliation of the very first live order against the Bob Go invoice before a second one
is allowed through.

**3. Ozow and Nedbank restart from zero and gate everything.** The technical build finishes
weeks before the site can take a rand. Money is the critical path, not code: bank account,
then TPPP, then Ozow — and both the payment rail and the courier rail will be going live
for the first time simultaneously, on a system with no staging environment and no production
baseline to regress against. Start the bank application on day one and plan the launch date
backwards from it, not forwards from the code.
