# All Outdoor Replatform — Cutover Runbook

> **Origin IP addresses are deliberately not written down here.** The site sits
> behind Cloudflare with an Origin Certificate, and that whole model depends on
> the origin address staying private — publish it and anyone can bypass the WAF
> and hit the box directly. Git history keeps whatever you commit, forever, even
> if you edit it out later. The real values live in the operator's password
> manager and in `~/.ssh/config` on the machines that need them.

**From:** Vultr <OLD_ORIGIN_IP> (4 core / 7.9 GB / 150 GB), Cloudflare account A, `gungalore.co.za`
**To:** Absolute Hosting <NEW_ORIGIN_IP> (2 core / 4 GB / 50 GB, Ubuntu 24), new Cloudflare account, `alloutdoor.co.za`
**Moving:** the marketplace app only (Next.js frontend + NestJS backend + Postgres + Meilisearch)
**Staying on Vultr:** ballistics app, ballistic-hunter, pvrescue.co.za — see section 5
**Status of the live site:** trading, real users, real KYC records, real listings. Payments are NOT live.

Written for an operator who can work a control panel and paste a command, but should not have to improvise. Every command below is complete and ready to run. Where a step is genuinely dangerous, it says so on its own line.

---

## 0. Read this before anything else

Three blockers exist right now. Nothing in this runbook can start until all three are cleared.

| Blocker | Why it stops everything | Fix |
|---|---|---|
| **Unpaid invoice R53.06 at Absolute Hosting** | The new VPS can be suspended without warning. If it suspends mid-migration you lose the box while the old one is already half torn down. | Pay it today. Then set up a card on file or a debit order so it cannot happen again. Take a screenshot of the paid status. |
| **Ports 22, 80 and 443 are CLOSED from the internet on <NEW_ORIGIN_IP>** | You cannot SSH in, cannot install anything, cannot get a TLS certificate, cannot test. | Open 22 (SSH), 80 (HTTP, needed for cert validation) and 443 (HTTPS) in the Absolute Hosting firewall panel **and** in the box's own `ufw`. Verify from your PC before proceeding — see Phase 1, Step 1. |
| **The ballistics app is not actually independent** | `HuntPdf`, `HuntPdfPage` and `RangeEstimate` are tables inside `gungalore_prod`, and `HuntBallisticsModule` is compiled into the marketplace backend (`backend/src/app.module.ts:48,108`). "Ballistics stays on Vultr" is not true as built. | Make the decision in section 6, Question 1, before you build anything. |

---

## 1. The three things that can go permanently wrong

Everything else in this migration is recoverable by restoring a database dump or putting an old value back in a file. These three are not.

---

### 1.1 Regenerating `ID_HASH_SECRET` destroys every seller's stored SA ID number, forever

**What it is.** One environment variable is the encryption key for every South African ID number the platform holds. `backend/src/common/id-crypto.ts:27-40` derives an AES-256-GCM key from `ID_HASH_SECRET` on every call — the key itself is never stored anywhere. The ciphertext lives in `User.idNumberEncrypted` (`schema.prisma:278`). The same secret also salts `User.kycIdHash` (`schema.prisma:268`), the unique index that enforces one SA ID = one account.

**What is lost.** If a new secret is generated for the new box, the AES-GCM authentication tag stops verifying and every existing `idNumberEncrypted` value becomes mathematically undecryptable. There is no key-recovery path — the plaintext ID is deliberately stored nowhere else (`id-crypto.ts:11-18`). Concretely:

- Every SAP 534 firearm-transfer PDF generated on a firearm sale goes out with a **blank ID line**, silently, with only a warning in the log (`backend/src/payments/transactions.service.ts:4998-5003`). That is a statutory firearms form quietly losing the seller's identity.
- Every seller who tries to finish KYC is hard-blocked with "Could not read your saved ID" (`backend/src/kyc/kyc.service.ts:205-212`).
- One SA ID = one account stops working. New hashes never collide with old ones, so the same person can open unlimited seller accounts.

**And it cannot simply be "re-encrypted later."** Two mechanisms have already produced rows with `kycIdHash` set but `idNumberEncrypted` NULL — the old purge-after-KYC design (`kyc.service.ts:223-229` literally says "we used to purge it here") and POPIA erasure, which nulls the ciphertext but leaves the hash (`backend/src/users/users.service.ts:612`). For those users the raw ID no longer exists anywhere on earth. Their hash can never be recomputed under any new secret.

**The rebrand-specific landmine.** The HKDF info string is the hard-coded literal `'gungalore-id-encrypt'` (`id-crypto.ts:38`) and there is a matching hard-coded default salt `'gungalore-id-salt-v1-rotate-on-compromise'` (`kyc.service.ts:34`). A find-and-replace of the word **gungalore** across the repo — exactly what a rebrand invites — silently changes both. Nothing errors. Encryption just starts producing different bytes.

> **Rule: never search-and-replace the string `gungalore`. Only ever replace the string `gungalore.co.za`.**

**What prevents it.** Copy `ID_HASH_SECRET` byte-for-byte, watch for a trailing space or newline (the value is concatenated raw into a SHA-256 at `id-crypto.ts:89`), and prove a real decrypt on the new box before a single user touches it. Phase 4, Step 6 is that proof and it is not optional.

---

### 1.2 A new Clerk instance orphans every user account — and deleting the old Clerk app in the wrong order hard-deletes users and wipes KYC records

**What it is.** `User.clerkId` (`schema.prisma:202`) is a foreign system's primary key stored as the *only* join between our database and the identity provider. Every authenticated request resolves the caller through it, never through `User.id` (`backend/src/auth/clerk.guard.ts:41-54`).

**What is lost with a fresh instance.** Every user's `clerkId` changes. On first sign-in the guard looks up the new `sub`, finds nothing, and the account presents as brand new: no listings, no orders, no offers, no bids, no KYC status, no bank details, no PRO subscription, no ratings. Their real row sits orphaned next to it. Clerk does not self-serve export password hashes, so unless Clerk support supplies them, **every email+password user is locked out** and must reset.

There is a worse, silent variant. `resolveUsernameConflict` (`users.service.ts:271-307`) runs at line 363, *before* the relink-by-email at line 366. During a migration it calls `clerk.users.getUser(oldClerkId)` against the new instance, gets a 404, concludes the row is stale, and renames the live user to `<username>-archived-<4 chars>`. If the email matches byte-for-byte, the relink immediately undoes it and nobody notices. If the email does **not** match — changed address, differing case, a secondary address promoted on import — the real account is left permanently renamed and orphaned while a fresh empty row takes the username. No error, no alert, nothing in the logs.

**The deletion-order landmine.** If the old Clerk application is deleted while its webhook still points at a reachable host with a valid `CLERK_WEBHOOK_SECRET`, Clerk fires `user.deleted` for every user. `users.service.ts:583-630` then **hard-deletes** every user with no financial rows (cascading away wishlists, saved searches, notifications, push subscriptions, saved addresses, support tickets, complaints), and for users protected by foreign keys it falls back to a **PII scrub** that nulls `email`, `phone`, `idNumberEncrypted`, `dateOfBirth`, `kycIdDocumentUrl`, `kycSelfieUrl`, `kycHaCheckJson` and `kycClaudeFindings`. That destroys the KYC record of real, verified sellers and is recoverable only from a backup.

**What prevents it.** In order of preference:

1. **Ask Clerk support to TRANSFER the existing production application into the new All Outdoor Clerk organisation.** Clerk supports moving an app between organisations. The instance id, every user id and every password hash ride along. `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` do not change. The operator's stated goal — "so it stays uniform" — is satisfied by the app living under the All Outdoor org. It does not require new user ids. **This single support ticket removes the largest risk in the entire migration.** Open it now; it gates the cutover date.
2. If the transfer is refused: do not proceed until Clerk confirms **in writing** whether they will export password digests. That answer decides whether user comms say "sign in again" or "reset your password", and that is a business decision, not a deploy step.
3. Whichever path: **delete the old webhook endpoint EARLY, delete the old Clerk application LATE.** Never the other way round. Keep the old application alive for at least one full KYC/payout cycle after cutover.

---

### 1.3 A new Zoho Books organisation permanently breaks the accounting ledger

**What it is.** Eleven columns in the production database are foreign keys pointing into one specific Zoho Books org: `User.zohoContactId`, `Supplier.zohoVendorId`, `DealPurchaseOrder.zohoPurchaseOrderId`, `Transaction.zohoCommissionInvoiceId` / `zohoCommissionPaymentId` / `zohoCreditNoteId` / `zohoDealReceiptId` / `zohoDealCreditNoteId`, `FeaturedSlotBid.zohoInvoiceId`, `SubscriptionCharge.zohoReceiptId`, `Swap.zohoInitiatorFeeReceiptId` / `zohoOwnerFeeReceiptId`. The org id is appended to the query string of every single API call (`backend/src/zoho/zoho-books.service.ts:187`).

**What is lost.** Point the app at a new org and every stored id resolves to nothing. `createCommissionInvoice` sends the old org's contact id for every existing seller, Books rejects it, the row is marked `FAILED`, and the hourly self-heal cron re-fires the identical failure **every hour forever** (`tasks.service.ts:993-1006`). `markCommissionInvoicePaid` 404s and is in no retry cron at all, so it can only be cleared by an admin retry button that will also fail. Refund credit notes reference dead invoice ids and never post, so refunded sales stay booked as revenue and the turnover figure driving your VAT registration threshold is overstated. The admin Books-failed panel fills up and never drains.

There is a second trap even if the org id is right. The chart of accounts is resolved by exact **account name string**, case-sensitive: `'Commission Revenue'`, `'Client Funds Payable'`, `'Subscription Revenue'`, `'Swap Service Revenue'`, `'Featured-Slot Revenue'`, `'Bank — FNB Business'`, `'Bank — Peach Pending'`. **Two of those contain an em dash (U+2014), not a hyphen.** Retyped by hand into a new org they will look correct to a human and fail the string compare, and every document creation throws.

**What prevents it.** **Do not create a new Zoho Books organisation.** Rename the existing org from Gun Galore to All Outdoor inside Zoho and add the All Outdoor Zoho login as an org admin. It is the same legal entity and the same ledger; the rebrand is a display-name change, not a new set of books. `ZOHO_BOOKS_ORG_ID` must move to the new box unchanged. `ZOHO_BOOKS_CLIENT_ID`, `CLIENT_SECRET` and `REFRESH_TOKEN` can be freely re-minted against the same org.

---

### And two that are nearly as bad

**Cloudinary.** Sixteen URL columns and two `publicId` columns across seven tables hold `res.cloudinary.com/<cloud_name>/...` URLs — listing photos, KYC ID documents, KYC selfies, firearm serial and licence proofs, dealer-stamped SAP 534 packs, complaint evidence, proof of delivery. **Only two of those sixteen columns store a `public_id` alongside the URL**; the other fourteen would have to have it reverse-engineered out of a string, and re-uploading changes the `/v<version>/` segment so a naive `REPLACE(url,'/oldcloud/','/newcloud/')` produces URLs that 404. Cloudinary is completely decoupled from the VPS, the domain and Cloudflare — the cloud name appears nowhere in the code, only in three env vars. **Keep the existing Cloudinary account and rename it.** Moving it is a pure self-inflicted risk on top of your compliance audit trail.

**In-flight courier parcels.** Any Pudo or TCG parcel booked under the old merchant key goes dark the moment the key changes: the waybill PDF 403s (the old API key is embedded in the URL), the tracking poll silently stops (a 404 makes the cron `continue` with no error anywhere), and an admin refund can no longer cancel the live waybill. Drain both queues to zero before cutting. See Phase 5.

---

### "Should every secret be regenerated for uniformity?" — No.

The rebrand instinct is correct for a handful of these and destructive for the rest. Critically: **the legal entity is not changing.** `backend/src/common/brand.ts:17-21` is explicit — `BRAND_NAME = 'All Outdoor'` is the trading name; `LEGAL_ENTITY = 'GunGalore (Pty) Ltd'`, reg `2026/393321/07`, is the company. Pudo, The Courier Guy, SMSPortal, VerifyNow, Cloudinary, Zoho and Clerk are all merchant accounts contracted to that unchanged company. **For most of them, "rename the trading name on the existing account" is a support ticket, not a migration.**

| Regenerate — yes | Rename the existing account | Carry the value byte-for-byte |
|---|---|---|
| `JWT_ADMIN_SECRET` (the dev default is in git history — rotating it is an improvement) | Clerk (transfer the app to the new org) | `ID_HASH_SECRET` |
| `COMING_SOON_BYPASS_SECRET` | Zoho Books (rename the org, re-mint OAuth) | `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (as a matched pair) |
| `VAPID_SUBJECT` (point it at the new mailbox) | Cloudinary (do not create a new cloud) | `ZOHO_BOOKS_ORG_ID` |
| Anthropic API key + a *real* Admin key | Pudo, TCG, SMSPortal, VerifyNow | `CLOUDINARY_CLOUD_NAME` / `API_KEY` / `API_SECRET` |
| Google Maps key (referrer restriction must change anyway) | | `HUNT_BALLISTICS_ADMIN_KEY` |
| Cloudflare Origin Certificate (must be new — see Phase 1) | | Clerk keys, if the transfer is granted |

Genuinely new credentials are required for exactly one thing: **Resend and the sending domain.** The domain really is changing and that work is unavoidable. It also has the longest lead time, which is why it is Phase 2.

---

## 2. Sequenced phases

Timeline assumption: **Phase 2 must start at least 7 days before cutover day.** Everything else can be compressed into about a week of evenings.

---

### Phase 0 — Unblock and decide (day 1, one hour)

**What happens.** Clear the three blockers, open the long-lead support tickets, and drop DNS TTLs so a rollback propagates in a minute instead of a day.

**Why here.** The Clerk transfer ticket and the Resend domain warm-up both have multi-day lead times that no amount of technical work can compress. Start the clock before you touch a server.

**Steps.**

1. Pay the R53.06 invoice at Absolute Hosting. Put a card on file.
2. Open the firewall on the Absolute panel: allow inbound TCP 22, 80, 443.
3. **Open a Clerk support ticket** requesting the production application be transferred into the new All Outdoor Clerk organisation, not recreated. Ask explicitly: *"Can you move our existing production application into a different organisation, keeping the instance id, user ids and password hashes unchanged?"* If they say no, follow up with: *"Will you export password digests so we can import users into a new instance?"*
4. **Open a rename ticket with each of:** Pudo, The Courier Guy, SMSPortal, VerifyNow, Cloudinary, Zoho. Wording: *"We are changing our trading name from Gun Galore to All Outdoor. The registered company GunGalore (Pty) Ltd, reg 2026/393321/07, is unchanged. Please update the trading name on our existing account rather than us opening a new one."*
5. In the **old** Cloudflare account, drop the TTL on the `gungalore.co.za` A/AAAA records to **60 seconds**. Do this now so the value has propagated long before cutover day.
6. Answer Question 1 in section 6 (ballistics). Nothing downstream is safe until you have.

**Verify.** Invoice shows paid. From your PC: `ssh root@<NEW_ORIGIN_IP>` connects (even if only to a password prompt). Clerk ticket has a reference number.

**Rollback.** Nothing has changed on production. Not applicable.

---

### Phase 1 — Build the new box in parallel (day 2–3, half a day)

**What happens.** Stand up the full stack on <NEW_ORIGIN_IP> with the old box still serving every request. Nothing here touches production.

**Why here.** The new box must be provably able to *build* the app before you commit to any data movement. On 2 cores and 4 GB that is not a formality.

#### Step 1 — Confirm the ports are actually open

From your Windows PC:

```powershell
Test-NetConnection -ComputerName <NEW_ORIGIN_IP> -Port 22
Test-NetConnection -ComputerName <NEW_ORIGIN_IP> -Port 80
Test-NetConnection -ComputerName <NEW_ORIGIN_IP> -Port 443
```

All three must say `TcpTestSucceeded : True`. If 22 fails, stop — Absolute's panel firewall is still shut and nothing below will work.

#### Step 2 — Swap FIRST, before you install anything else

> **This is the single most likely way the first deploy fails.** The deploy builds on the server: `next build --webpack` plus `nest build`. Webpack routinely wants 2–4 GB on its own. The new box has 4 GB total, no swap, and will be running Postgres, Meilisearch and the Nest backend alongside it. The Linux OOM killer does not fail politely — it kills the largest process, which is usually Postgres, and you get a half-written build plus a database that went away mid-transaction.

```bash
ssh root@<NEW_ORIGIN_IP>
fallocate -l 8G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.d/99-swap.conf
free -h
```

`free -h` must show 8.0Gi of swap. 8 GB of a 50 GB disk is cheap insurance; `swappiness=10` keeps the kernel from paging out the database under normal load.

#### Step 3 — Install the runtime

```bash
apt update && apt upgrade -y
apt install -y curl gnupg2 ca-certificates lsb-release nginx ufw git rsync

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2

# PostgreSQL 16 — NOT 17. The dump is from 16.14 and version skew is the usual failure.
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
apt update
apt install -y postgresql-16 postgresql-contrib-16
psql --version   # must print 16.x, >= 16.14

# Meilisearch 1.44.0
curl -L https://install.meilisearch.com | sh
mv ./meilisearch /usr/local/bin/
meilisearch --version   # must print 1.44.0

ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

#### Step 4 — Create the database role with the SAME NAME as production

Get the owning role name off the old box first:

```bash
ssh gungalore "sudo -u postgres psql -d gungalore_prod -tAc \"SELECT tableowner FROM pg_tables WHERE schemaname='public' LIMIT 1;\""
```

Then on the new box, substituting that exact name:

```bash
sudo -u postgres psql -c "CREATE ROLE <same_role_name> LOGIN PASSWORD '<new strong password>';"
sudo -u postgres psql -c "CREATE DATABASE alloutdoor_prod OWNER <same_role_name>;"
sudo -u postgres psql -d alloutdoor_prod -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

> A renamed role makes every `ALTER ... OWNER TO` statement in the dump fail. The app still boots, but the boot-time `ALTER TABLE` that creates the three tsvector search columns is then refused and reloading-manual search plus Ask Boet KB search silently degrade with no error.

Creating `pg_trgm` as superuser here means `backend/src/reloading/reloading.service.ts:182-184` does not need to.

#### Step 5 — Get the code onto the box, and prove it builds

```bash
mkdir -p /root/app && cd /root/app
git clone <your repo url> .
cd backend && npm ci
cd ../frontend && npm ci
```

Then the build, with the RAM protections in place. Placeholder env values are fine for this smoke test — you are testing that the box can compile, not that the app works:

```bash
# Stop everything else so the build gets the RAM
systemctl stop postgresql
pkill meilisearch || true

cd /root/app/backend
npx prisma generate
NODE_OPTIONS="--max-old-space-size=3072" npm run build

cd /root/app/frontend
NODE_OPTIONS="--max-old-space-size=3072" npm run build

systemctl start postgresql
```

**Verify.** Both builds exit 0. `ls /root/app/backend/dist/src/main.js` and `ls /root/app/frontend/.next/BUILD_ID` both exist. While the frontend build runs, watch memory in a second SSH session with `watch -n2 free -h` — if swap usage climbs above about 5 GB the build is thrashing and you should move to the fallback below.

**Fallback if the frontend build still dies (`Killed`, exit 137, or takes over 20 minutes).** Build off-box and copy the artifacts. Do this on the *old* Vultr box, which has 4 cores and 7.9 GB:

```bash
ssh gungalore "cd ~/app && git pull && cd frontend && npm ci && npm run build"
ssh gungalore "cd ~/app/frontend && tar czf /tmp/next-build.tgz .next"
scp gungalore:/tmp/next-build.tgz /tmp/
scp /tmp/next-build.tgz root@<NEW_ORIGIN_IP>:/root/app/frontend/
ssh root@<NEW_ORIGIN_IP> "cd /root/app/frontend && tar xzf next-build.tgz"
```

Node versions must match between the two boxes for this to be safe — check `node -v` on both. **Note this fallback down as the permanent deploy procedure if you use it**, because every future deploy will hit the same wall.

**Rollback.** None needed — production is untouched and still serving.

---

### Phase 2 — Long-lead DNS: sending domain and Clerk FAPI (start day 2, finishes day 7+)

**What happens.** Create the new Cloudflare zone, publish email authentication records, and get Clerk's frontend-API hostnames verified.

**Why here.** These are the only items with a hard multi-day floor. Email reputation cannot be warmed up in an afternoon, and Clerk certificate issuance can take hours to days. Doing them last is how a cutover slips by a week.

#### Step 1 — New Cloudflare zone

1. Create the new Cloudflare account under the All Outdoor identity.
2. Add the `alloutdoor.co.za` zone. Change the nameservers at Absolute Hosting to Cloudflare's.
3. **Do not create the A record for the apex yet.** Only the records below.
4. Set the zone SSL/TLS mode to **Full (strict)**.

#### Step 2 — Preserve inbound mail

Absolute Hosting already hosts mail for `alloutdoor.co.za`. When you moved nameservers to Cloudflare you must re-create the **MX records** exactly as Absolute has them, set **DNS only (grey cloud)**. MX and third-party sending do not conflict — they govern opposite directions.

**Verify:** `nslookup -type=MX alloutdoor.co.za 1.1.1.1` returns Absolute's mail hosts. Send yourself a test email to `support@alloutdoor.co.za` and confirm it arrives.

#### Step 3 — Resend sending domain — verify a SUBDOMAIN, not the apex

Verify `send.alloutdoor.co.za` in Resend rather than the bare domain. This gives Resend its own SPF TXT and its own DKIM selector on a subdomain where they cannot possibly collide with Absolute's records on the apex, while DMARC relaxed alignment still treats it as aligned. It also keeps any bulk-sending reputation damage away from your own mailboxes.

Publish, all **DNS only (grey cloud)**:
- Resend's SPF TXT on `send.alloutdoor.co.za`
- Resend's DKIM CNAME/TXT exactly as their dashboard gives it
- Exactly **one** `_dmarc.alloutdoor.co.za` TXT record, starting at `p=none; rua=mailto:dmarc@alloutdoor.co.za`

> If you verify the apex instead, there must be exactly **one** SPF TXT record on `alloutdoor.co.za` containing both Absolute's include and Resend's include. Two separate SPF records is a permanent PermError that breaks both outbound sending and your own inbound mailboxes.

Do **not** launch at `p=reject`. Watch DMARC reports for at least a week, then move to `p=quarantine`.

#### Step 4 — Warm up the sending domain

Starting the day it verifies, send low volume from the new domain — yourself, a couple of test accounts, a handful a day ramping upward. A zero-history domain on a zero-history Resend account is the worst possible sender profile and a cold launch puts order confirmations in spam.

#### Step 5 — Clerk production domain

1. In the new (or transferred) Clerk instance, add `alloutdoor.co.za` as the production domain.
2. Clerk emits a set of CNAMEs — the FAPI host, the accounts/account-portal host, and the `clkmail` sending hosts.
3. Add every one of them in the new Cloudflare zone as **DNS only (grey cloud)**. Proxying Clerk's FAPI through Cloudflare breaks certificate issuance and the handshake.
4. Wait for Clerk to report all records verified and the certificate issued. This is the long pole.

**Verify.** Resend dashboard shows the sending domain green. Clerk dashboard shows all domain records verified and a certificate issued. `dig CNAME clerk.alloutdoor.co.za` resolves.

**Rollback.** Nothing in this phase touches the live site. `gungalore.co.za` and its Clerk FAPI records are untouched throughout. Worst case you delete records from a zone nothing is pointing at yet.

---

### Phase 3 — Secrets and environment files (day 4, two hours)

**What happens.** Write `backend/.env` and `frontend/.env.local` on the new box by hand.

**Why here.** Before any data lands. A single write under a wrong `ID_HASH_SECRET` is unrecoverable; reads under a wrong secret merely fail.

> **Do NOT build the new `.env` files from `.env.example`.** Both templates are stale and the gaps fail silently:
> - `backend/.env.example` documents **Odoo** in the accounting block and contains **zero** `ZOHO_BOOKS_*` keys. Build from it and every accounting method returns early, rows get marked `SKIPPED`, no error is raised, and nobody notices until month-end does not tie.
> - `backend/.env.example` has **no `ID_HASH_SECRET` entry at all** and there is no boot check for it.
> - `backend/.env.example:34` ships `VERIFYNOW_MODE=sandbox`. Copy that and every new seller passes KYC against canned data with no visible symptom.
> - `frontend/.env.example` is missing `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `INTERNAL_API_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_PAYMENT_MODE` and `NEXT_PUBLIC_DISABLE_PWA` entirely.

**Steps.**

1. Back up the live env files first, then pull them down:

```bash
ssh gungalore "cp ~/app/backend/.env ~/app/backend/.env.bak-preAO && cp ~/app/frontend/.env.local ~/app/frontend/.env.local.bak-preAO"
scp gungalore:~/app/backend/.env /c/dev/gun-galore/_migration/backend.env.PROD
scp gungalore:~/app/frontend/.env.local /c/dev/gun-galore/_migration/frontend.env.PROD
```

Store both in the operator's password manager as well, not only on disk. The Vultr box is being kept for other apps and its `.env` will eventually be cleaned up.

2. Copy them to the new box as the starting point, then edit per the table in section 4:

```bash
scp /c/dev/gun-galore/_migration/backend.env.PROD root@<NEW_ORIGIN_IP>:/root/app/backend/.env
scp /c/dev/gun-galore/_migration/frontend.env.PROD root@<NEW_ORIGIN_IP>:/root/app/frontend/.env.local
```

3. **While you are in the prod backend `.env`, read and record two values you cannot see from the repo:**
   - Is `CLERK_AUTHORIZED_PARTIES` set? If it is set to `https://gungalore.co.za`, it **must** gain `https://alloutdoor.co.za` before the domain flips or every token is rejected and the entire site logs out with no obvious cause.
   - Is `ZOHO_BOOKS_ENABLED` currently `true`?

4. Apply the section 4 table. The critical edits:
   - `ID_HASH_SECRET` — unchanged, and check for a trailing space.
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — unchanged, as a matched pair.
   - `JWT_ADMIN_SECRET` — new strong random. Missing or default = the backend crash-loops under pm2 and the site is 502. Generate with `openssl rand -base64 48`.
   - `NODE_ENV=production` — set it in the pm2 ecosystem config too, not just `.env`.
   - `ZOHO_BOOKS_ENABLED=false` for now. Flip it to true only after the box is proven.
   - `PAYMENT_MODE=manual`, `PAYMENTS_LIVE=false`, `PEACH_ENV=sandbox` — land the new box in exactly the state prod is in today. Do not combine a hosting move with a payments go-live.
   - `VERIFYNOW_MODE=production` explicitly.
   - `INTERNAL_API_URL=http://localhost:3001/api` — the loopback hop; it must not go out through Cloudflare.
   - Every domain-bearing var to `alloutdoor.co.za`.
   - Delete `STITCH_CLIENT_ID`, `STITCH_CLIENT_SECRET`, `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`, `GOOGLE_MAPS_API_KEY` — nothing reads any of them. Revoke the IMAP mailbox credentials at Absolute rather than carrying them.

5. **Do NOT yet change `backend/src/common/brand.ts:35` (`EMAIL_FROM`).** That is a code change and it waits until Phase 8, after the sending domain has warmed up.

**Verify.**

```bash
ssh root@<NEW_ORIGIN_IP> "cd /root/app/backend && grep -c '=' .env"
```

Then diff the variable *names* against production so nothing was dropped:

```bash
ssh gungalore "cut -d= -f1 ~/app/backend/.env | sort" > /tmp/old-keys.txt
ssh root@<NEW_ORIGIN_IP> "cut -d= -f1 /root/app/backend/.env | sort" > /tmp/new-keys.txt
diff /tmp/old-keys.txt /tmp/new-keys.txt
```

Every difference must be one you made on purpose.

**Rollback.** Files only. Production is untouched.

---

### Phase 4 — Migrate the data (day 4–5, half a day for the rehearsal)

**What happens.** A full rehearsal of the database restore, the manuals rsync and the search rebuild — **with the old site still live and still taking writes.** The rehearsal dump is throwaway; you will take a second, final one during the cutover window.

**Why here.** You want every surprise in this phase to happen on a day when nothing is at stake.

#### Step 1 — Rehearsal dump from production

The `?schema=public` query string must be stripped from the connection URI or `pg_dump` rejects it as an unknown parameter. This is a known repeat failure on this project.

```bash
ssh gungalore "pg_dump 'postgresql://USER:PASS@localhost:5432/gungalore_prod' -Fc -f /tmp/gg-rehearsal.dump"
ssh gungalore "ls -lh /tmp/gg-rehearsal.dump"
scp gungalore:/tmp/gg-rehearsal.dump /tmp/
scp /tmp/gg-rehearsal.dump root@<NEW_ORIGIN_IP>:/root/
```

151 MB compressed — a couple of minutes over the wire.

#### Step 2 — Restore

```bash
ssh root@<NEW_ORIGIN_IP>
sudo -u postgres pg_restore -d alloutdoor_prod --no-owner --role=<same_role_name> -j 2 /root/gg-rehearsal.dump
```

`-j 2` matches the core count; more will thrash.

#### Step 3 — Confirm the migration ledger is intact

```bash
cd /root/app/backend
npx prisma migrate status
```

Must report all 99 migrations applied, latest `20260811210000_gate_weapon_adjacent_categories`.

> **Never run `npx prisma db push` on this database.** `schema.prisma:3115-3126` documents that `db push` tries to DROP the `textTsv` generated column. Do not run `prisma migrate deploy` blind on a freshly restored database either — the restore already contains the schema.

#### Step 4 — Copy the reloading manuals off the old box

```bash
rsync -avz --progress gungalore:~/app/manuals/ root@<NEW_ORIGIN_IP>:/root/app/manuals/
rsync -avz --progress gungalore:~/app/manual-inbox/ root@<NEW_ORIGIN_IP>:/root/app/manual-inbox/
```

> **This is mandatory, not best-effort.** The PDFs are on disk, not in Cloudinary and not in the database. And you cannot repair it later by re-running "Scan inbox" in the admin UI: dedup matches on a SHA-256 suffix already embedded in the restored `storedPath` values (`reloading.service.ts:301-310`), so a re-scan reports "19 skipped (dedup)" and writes nothing. The library stays permanently broken while the admin panel says it succeeded.

Check disk headroom first — 50 GB total has to hold the OS, node_modules, the database, the build output and these PDFs:

```bash
ssh root@<NEW_ORIGIN_IP> "df -h /"
```

#### Step 5 — Start Meilisearch and boot the backend once

```bash
# Meilisearch as a service
cat > /etc/systemd/system/meilisearch.service <<'EOF'
[Unit]
Description=Meilisearch
After=network.target
[Service]
ExecStart=/usr/local/bin/meilisearch --db-path /var/lib/meilisearch/data --env production --master-key ${MEILI_MASTER_KEY}
Environment=MEILI_MASTER_KEY=<your new master key>
Restart=always
[Install]
WantedBy=multi-user.target
EOF
mkdir -p /var/lib/meilisearch/data
systemctl daemon-reload && systemctl enable --now meilisearch
curl -s http://localhost:7700/health
```

Then boot the backend once, in the foreground, and read the log:

```bash
cd /root/app/backend && node dist/src/main
```

**Verify — four specific log lines must appear:**
- `Meilisearch connected`
- the ReloadingManualPage FTS column + GIN index line
- the AskGgKbEntry FTS line
- the HuntPdf FTS column + GIN index line

If any FTS line reports a failure instead, the database role is wrong — go back to Phase 1 Step 4.

Also confirm the boot warnings you expect are **absent**: no `VERIFYNOW_MODE is not "production"` and no Anthropic-key warning.

#### Step 6 — THE DECRYPT PROOF (do not skip this)

This is the one test that proves `ID_HASH_SECRET` carried over correctly. It must pass before any user traffic reaches the new box.

Write a scratch script (not in the repo) at `/root/verify-idcrypto.ts`:

```ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { decryptSaIdNumber, hashSaIdNumber } from './app/backend/src/common/id-crypto';

(async () => {
  const p = new PrismaClient();
  const rows = await p.user.findMany({
    where: { idNumberEncrypted: { not: null } },
    select: { id: true, idNumberEncrypted: true, kycIdHash: true },
    take: 20,
  });
  let ok = 0;
  for (const r of rows) {
    const plain = decryptSaIdNumber(r.idNumberEncrypted!);
    if (!/^[0-9]{13}$/.test(plain)) { console.error('DECRYPT FAIL', r.id); continue; }
    if (r.kycIdHash && hashSaIdNumber(plain) !== r.kycIdHash) { console.error('HASH MISMATCH', r.id); continue; }
    ok++;
  }
  console.log(`PASS ${ok} / ${rows.length}`);
  await p.$disconnect();
})();
```

Run it. **`PASS 20 / 20` is the only acceptable result.** Anything else halts the cutover. This one assertion proves both the HKDF encryption key and the hash salt carried over.

While you are there, run the blast-radius counts so you know what you are dealing with:

```sql
SELECT count(*) FILTER (WHERE "idNumberEncrypted" IS NOT NULL) AS have_ciphertext,
       count(*) FILTER (WHERE "kycIdHash" IS NOT NULL AND "idNumberEncrypted" IS NULL) AS hash_only
FROM "User";
```

The second number is the cohort whose ID could never be re-hashed under any new secret. It is the reason `ID_HASH_SECRET` is not rotatable.

#### Step 7 — Falsify the payments assumption

Three read-only counts. The whole "Peach is cheap to re-register" conclusion rests on these being zero:

```sql
SELECT count(*) FROM "Transaction"
 WHERE "peachCheckoutId" IS NOT NULL OR "peachPaymentId" IS NOT NULL OR "peachPayoutId" IS NOT NULL;
SELECT count(*) FROM "User" WHERE "bankVerificationId" IS NOT NULL;
SELECT count(*) FROM "User" WHERE "zohoContactId" IS NOT NULL;
SELECT count(*) FROM "Transaction"
 WHERE "zohoCommissionInvoiceId" IS NOT NULL OR "zohoDealReceiptId" IS NOT NULL;
```

If the first is non-zero, real Peach payments exist and the old merchant account holds the only record of them — stop and re-plan. If the second is non-zero, export `id, bankVerificationId, bankVerifiedAt, bankAvsResult` to a retained CSV as the audit record before doing anything else. The last two tell you how much is riding on the Zoho org id.

#### Step 8 — Rebuild the Meilisearch index

> **Meilisearch will look perfectly healthy and be completely empty.** `isConnected` is true as soon as `/health` answers — it does not check that documents exist. Category browse still works because it routes through Prisma. But the instant a user types in the search box they get **zero results for every query**, and the browse filter chips vanish entirely. Green dashboard, dead catalogue. This is the most likely "why is nobody buying anything" moment on day one.

There is **no HTTP reindex route** — it was deleted on 2026-07-18. Two options:

- **Easy:** in `/admin`, open Category Attributes and save any filterable attribute. That fires `refreshListingFilterableAttributes()` then `reindexAllActiveListings()`.
- **Reliable:** write and test a one-off script now that calls `ListingsService.reindexAllActiveListings()` (`backend/src/listings/listings.service.ts:3483-3493`). **Have this written and tested before cutover day, not during it.**

**Verify.** The count returned by the reindex must equal the active, non-deal listing count in Postgres. Then browse the site on the test hostname (Phase 6) and search for a term you know exists.

Two indexes rebuild themselves and need no action: `cartridges` on the first Load Lab burn-chart request, `pudo_lockers` from the Pudo feed within 24h. Hit the powder chart and the locker picker once each to warm them.

**Rollback for the whole phase.** Everything here is on the new box. Production is untouched and still serving. Drop `alloutdoor_prod` and redo it as many times as you like.

---

### Phase 5 — Re-register services and re-point webhooks (day 5–6)

**What happens.** Provision credentials on the new box and change vendor-side configuration.

**Why here.** After the box is proven and before the dry run, so the dry run exercises the real integrations. Note the split: **credentials go on the new box now; webhook URLs get re-pointed during the cutover window**, because a re-pointed webhook takes effect immediately and would start sending events to a box that DNS has not reached yet.

#### 5a — Drain the couriers FIRST

```sql
-- Pudo
SELECT id, "trackingReference", "shippingStatus" FROM "Transaction"
 WHERE "shippingMethod"='PUDO' AND "shipmentBookedAt" IS NOT NULL
   AND "shippingStatus" NOT IN ('DELIVERED','DELIVERY_FAILED','RETURNED');
-- TCG
SELECT id, "trackingReference", "shippingStatus" FROM "Transaction"
 WHERE "shippingMethod"='TCG' AND "shipmentBookedAt" IS NOT NULL
   AND "shippingStatus" NOT IN ('DELIVERED','DELIVERY_FAILED','RETURNED');
```

**Do not cut over while either is non-empty.** Stop accepting new courier sales, let in-flight parcels reach DELIVERED, and download every outstanding waybill PDF to local storage before any key changes — they cannot be re-fetched afterwards.

If the vendors agree to rename the existing accounts (Phase 0 Step 4), this whole subsection collapses to a webhook URL change and the keys stay put.

**One thing to get in writing before cutting:** ask Pudo whether **locker terminal ids are network-global or account-scoped**. `Listing.pickupPudoLockerId` and `Transaction.pudoPickupLockerId` store them raw and replay them into `createShipment` as `delivery_address.terminal_id`. They look network-level (`RVM00111`) and come from a shared lockers feed, so they almost certainly survive an account change — but if Pudo says account-scoped, every seller's saved locker and every unbooked buyer locker choice is a dangling reference and needs re-mapping before the new key goes live.

#### 5b — Provision keys on the new box

Set on the new box now: `PUDO_API_KEY`, `TCG_API_KEY`, `TCG_WEBHOOK_SECRET`, `SMSPORTAL_CLIENT_ID`, `SMSPORTAL_API_SECRET`, `RESEND_API_KEY`, `VERIFYNOW_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_ADMIN_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

**Four of these fail silently and report success if they are wrong. There is no admin alert for any of them:**

| Var | Silent failure |
|---|---|
| `TCG_WEBHOOK_SECRET` missing | Every TCG tracking event is discarded; the endpoint returns `{received:true}`. Door deliveries stick on PENDING forever. |
| `SMSPORTAL_CLIENT_ID`/`SECRET` missing | SMS goes into STUB mode: logs a row, returns `success:true`, sends nothing. OTPs and locker drop-off PINs never arrive. The SMS outage alarm cannot catch it — it only counts SENT/FAILED rows, not STUB. |
| `VERIFYNOW_MODE` not exactly `production` | Silently defaults to sandbox. Every new seller passes KYC against canned data. |
| `RESEND_API_KEY` missing | Every transactional email is dropped on the floor and **nothing is queued to the outbox**, because the outbox is only written from a send-failure catch block. Order confirmations, KYC prompts and SAP 534 forms are gone, unrecoverable. |

Test each one deliberately in Phase 6 rather than trusting the boot log.

#### 5c — Fund the new accounts

Anthropic org (cold org with no balance = every seller fails KYC vision and every listing lands in manual review), VerifyNow (memory says ~29 credits remain — top up), Pudo prepaid wallet (there is **no balance API**; an empty wallet surfaces only as a failed booking), TCG wallet, SMSPortal credits.

**Mint a genuine Anthropic Admin API key.** The current prod `ANTHROPIC_ADMIN_API_KEY` is a regular key, so the spend monitor has never worked. Fix it during the move rather than carrying the bug over.

#### 5d — Google Maps

In the new Google Cloud project enable **three** APIs, not two: Maps JavaScript API, Places API, **and Geocoding API**. Geocoding is the one that gets forgotten — it backs the "use my location" reverse-geocode and its absence broke this exact feature once before.

Set the HTTP-referrer restriction to `https://alloutdoor.co.za/*` **and** `https://www.alloutdoor.co.za/*`. Add the gungalore entries too for the overlap window. Set a billing quota cap before the key is public.

> `NEXT_PUBLIC_*` values are inlined into the JavaScript bundle at **build** time. Editing `.env.local` and restarting pm2 does nothing. You must rebuild.

#### 5e — Cloudflare origin certificate and nginx

**Do not copy `/etc/ssl/cloudflare/gungalore.pem` to the new box.** It is issued by Cloudflare's Origin CA for `gungalore.co.za`, is trusted only by the *old* account's edge, and does not cover the new domain. Copy it and every request returns **Cloudflare error 526** — the entire site down, not degraded.

1. In the NEW Cloudflare account, issue a fresh Origin Certificate covering `alloutdoor.co.za` and `*.alloutdoor.co.za`. Install it at `/etc/ssl/cloudflare/alloutdoor.pem` + `.key`.
2. Configure nginx with Cloudflare real-IP so rate limiting works:

```nginx
# /etc/nginx/conf.d/cloudflare-realip.conf
real_ip_header CF-Connecting-IP;
# paste every range from https://www.cloudflare.com/ips-v4 and /ips-v6
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# ... all of them, IPv4 and IPv6
```

> Without this, Express's `trust proxy 1` derives the proxy's address as the client IP, and the 60-requests-per-minute throttler collapses into one shared bucket. Every visitor behind the same Cloudflare PoP shares a single 60/min budget and ordinary users start getting 429s at peak.

3. **Re-enable HSTS at the new Cloudflare edge.** It is set at the edge today, not at the origin (`frontend/next.config.mjs:60-61`). Forget it and you have a silent security regression nobody notices.
4. Re-create caching rules. **Do not turn on "Cache Everything."** The app relies on the edge honouring `Cache-Control: private` on dynamic HTML; a shared cache holding a snapshot means newly published and newly cancelled listings show stale.
5. Keep the `?v=` cache-buster convention on static brand assets — Cloudflare caches `/public` for 30 days and this has already burned you once (`frontend/lib/asset-version.ts:1-24`).

#### 5f — Fix the hard-coded domain surface

135 occurrences of the literal `gungalore.co.za` across the repo. The dangerous ones are the **env-var fallbacks**, because they produce a site that looks correct:

- `NEXT_PUBLIC_SITE_URL` unset → `sitemap.ts`, `robots.ts` and `layout.tsx` all default to `https://gungalore.co.za`. The new site publishes a sitemap and canonical/OG tags advertising the old domain, and Google indexes the new content under old URLs.
- `frontend/middleware.ts:200-201` falls back to `https://gungalore.co.za/sign-in` for signed-out users hitting a protected route.
- `frontend/app/admin/(protected)/campaigns/page.tsx:27` has a hard-coded `const SITE = 'https://gungalore.co.za'`. **An SMS blast sent from the new box sends every recipient to the old domain.** Fix this before sending any campaign.
- `notifications.service.ts:551-553` hard-codes the absolute email logo URL. Set `EMAIL_LOGO_URL`.
- Three SMS refund templates hard-code `gungalore.co.za/profile/edit` in the message body.
- `frontend/app/manifest.ts:43` declares a `related_applications` URL on the old domain, which stops `getInstalledRelatedApps` matching and makes the PWA re-nag already-installed users.
- `frontend/public/.well-known/security.txt` still points researchers at the old support address.

Also: the help-centre knowledge base rows **in the database** tell users to email `support@gungalore.co.za`. Edit `backend/prisma/seed-data/help-centre.ts` (lines 388, 404, 498, 538) and run `npm run seed:help` after the restore — it upserts on `sourceKey` and leaves conversation-derived entries alone.

> Scope every find-and-replace to `gungalore.co.za`. Never `gungalore`. See risk 1.1.

**Verify.** `grep -rn "gungalore.co.za" frontend/app frontend/lib backend/src | grep -v brand.ts` returns only lines you have consciously decided to leave.

**Rollback.** All code edits should sit on their own branch so a single revert plus rebuild restores the old domain surface. The seeded KB rows are re-seedable in both directions.

---

### Phase 6 — Dry run on a test hostname (day 6, half a day)

**What happens.** Serve the full new stack, against the real restored data, on a hostname nobody else can reach — before DNS points anywhere.

**Why here.** This is the last point at which everything is still reversible for free. Every failure you find here is a Tuesday-afternoon problem instead of a Saturday-night one.

#### Step 1 — Stand up a staging hostname

In the new Cloudflare zone create `staging.alloutdoor.co.za` → `<NEW_ORIGIN_IP>`, **proxied (orange cloud)**. Protect it with a Cloudflare Access rule or an nginx basic-auth so it is not publicly crawlable. Configure nginx to serve the app on both `staging.alloutdoor.co.za` and (later) the apex.

Set `COMING_SOON_GATE=on` and a fresh `COMING_SOON_BYPASS_SECRET` in the **frontend** env (this one is read by Next.js middleware, not the backend). Get through with `https://staging.alloutdoor.co.za/preview?key=<secret>`.

> If `COMING_SOON_GATE=on` but the secret is unset, the preview route returns a hard 500 and there is **no way through the gate at all** — you lock yourself out of your own smoke test. Set both in the same deploy.
>
> Also note `frontend/app/preview/route.ts:45-47` builds its redirect target from the Host header with a hard-coded `gungalore.co.za` fallback. Change that fallback.

#### Step 2 — Also test via a hosts-file override

On your Windows PC, run Notepad as Administrator, open `C:\Windows\System32\drivers\etc\hosts` and add:

```
<NEW_ORIGIN_IP> alloutdoor.co.za
<NEW_ORIGIN_IP> www.alloutdoor.co.za
```

This exercises the real apex hostname — which matters for the Clerk FAPI, the Google Maps referrer restriction and cookie scoping — without any public DNS change. **Remove these lines before the real cutover** or your PC will keep resolving to the box directly and you will not be testing what your users see.

#### Step 3 — The checklist

Work through every item. Each one maps to a specific silent-failure mode above.

- [ ] Homepage renders, images load
- [ ] **Type three characters into the search box — results appear.** (Empty Meilisearch is the top day-one failure.)
- [ ] Browse a category — **filter chips appear** with counts
- [ ] Sign in as a real non-admin canary user. Confirm their listings, orders, offers, KYC status and PRO subscription are all attached. **If this fails, the Clerk situation is wrong — stop.**
- [ ] Sign up a throwaway account. Backend log shows `Clerk webhook: user.created`. No signature-failure alert.
- [ ] Test "Continue with Google" — full round trip, and confirm consent-sync fires afterwards (it is the only POPIA consent record for the OAuth path).
- [ ] Open a listing page — seller avatar renders
- [ ] Type an address at checkout — **autocomplete dropdown appears**; click "use my location" and confirm it reverse-geocodes. If either fails, open the browser console: the message names the missing Google API.
- [ ] Trigger one transactional email to yourself. It arrives, **not in spam**, logo renders.
- [ ] Send one SMS via `backend/scripts/send-prod-sms-test.mjs`. It actually arrives on your phone. **A log line is not proof — STUB mode logs and reports success.**
- [ ] Log in at `/admin/login` with your existing email and password. This proves the AdminUser bcrypt hashes survived the restore.
- [ ] Open `/admin/credits` — every vendor tile returns a number, not "not configured"
- [ ] Open a manual in `/admin/reloading` and download it. It opens.
- [ ] Ask Boet a question that requires a manual citation. It answers rather than erroring.
- [ ] Open a KYC dossier at `/admin/users/[id]` — the ID document and selfie both load
- [ ] `/checkout` returns the 503 "Card payments are launching soon" — payments must stay inert
- [ ] Run the decrypt proof script again against the current data. `PASS 20 / 20`.
- [ ] Book one R0-risk test courier shipment end to end: create → waybill PDF downloads → cancel
- [ ] Fire one test webhook at the TCG endpoint with the new secret; confirm a `TrackingEvent` row lands
- [ ] Load-test lightly (even 20 concurrent page loads) and watch `free -h` in a second session. Confirm the box is not swapping under normal traffic.

**Verify.** Every box ticked. Any unticked box is an abort criterion for the cutover.

**Rollback.** Delete the staging DNS record, remove the hosts-file lines. Production has never been touched.

---

### Phase 7 — Cutover — see section 3

---

### Phase 8 — Post-cutover (the following week and month)

**What happens.** Redirects, cleanup, the email from-address, and a deliberately slow decommission.

**Steps, in order.**

1. **Immediately after cutover:** stop pm2 on the Vultr box for the marketplace processes only. Two boxes both running the 26 schedulers means every cron fires twice.
2. **Within the hour:** run the AdminUser clerkId repair if Clerk changed:
   ```sql
   UPDATE "AdminUser" a SET "clerkId" = u."clerkId"
     FROM "User" u WHERE lower(u.email) = lower(a.email);
   ```
   Without it your own browsing stops being excluded from analytics and quietly inflates every Insights figure.
3. **Within the hour:** set up the 301 redirects. On the old Cloudflare zone, add a Bulk Redirect or a Redirect Rule: `gungalore.co.za/*` → `https://alloutdoor.co.za/$1`, status 301, preserve path and query. **Keep this running for at least 12 months** — for SEO, for the email logo, for `/s/<token>` action links in SMS sent in the 48 hours before the cut, for `?c=KEY` campaign links, and for links already sitting in people's inboxes.
   > Keep the old Cloudflare zone, its origin certificate, its Clerk FAPI records and the Resend verification for `gungalore.co.za` all alive throughout. Do not let the domain lapse.
4. **Day 1–3:** watch `/admin/alerts`, `/admin/credits` and the Books-failed panel at `/admin/manual-payments`. A non-empty Books panel within the first hour means the Zoho org id or the chart-of-accounts names are wrong.
5. **Day 2:** flip `ZOHO_BOOKS_ENABLED=true` and restart. Create one throwaway document and confirm it posts.
6. **Day 3–7:** ramp email volume. Watch DMARC reports.
7. **Week 2, only when the sending domain is clean:** change `backend/src/common/brand.ts:35` `EMAIL_FROM` to the verified All Outdoor address, update the comment above it, and sweep the other hard-coded support addresses (`payments/receipt.service.ts:200`, `kyc.service.ts:842`, `push/push.service.ts:41`, `frontend/lib/support-contact.ts:11`). **Make sure `support@alloutdoor.co.za` is a real, monitored mailbox first** — one email template literally tells sellers to reply to it.
8. **Week 2:** plan the push re-opt-in wave. Push subscriptions belong to an **origin**, not to an account. Every service-worker registration, notification permission grant and installed PWA on `gungalore.co.za` is orphaned regardless of the VAPID keys. Count the dead rows and consider deleting them so the settings screen stops showing "Enabled" to users who have moved over. `pg_dump -t "PushSubscription"` before any such delete.
9. **Week 4+:** only now revoke the old Anthropic key, the old vendor keys and the old Cloudflare origin certificate.
10. **After one full KYC/payout cycle, at the earliest:** consider deleting the old Clerk application. **Delete its webhook endpoint on cutover day; delete the application months later.** See risk 1.2.
11. **Never, for at least 90 days:** delete anything from the old Cloudinary cloud.

**Code fixes worth landing after the dust settles** (all pre-existing, all made more dangerous by this move):
- Add `ID_HASH_SECRET` to `backend/.env.example` and to the hard-throw block in `main.ts:40-48`. The most data-destructive secret in the app currently has neither a template entry nor a boot check.
- Delete the committed default-salt fallback at `kyc.service.ts:32-34` and import the single implementation from `common/id-crypto`, so a missing secret fails loudly instead of writing hashes salted with a public constant.
- Move `resolveUsernameConflict` to run *after* the relink-by-email in `users.service.ts`, and lowercase both sides of the email comparison.
- Prune push subscriptions on HTTP 403, not just 410/404, and compare `applicationServerKey` before reusing an existing subscription.
- Add hard boot assertions for `RESEND_API_KEY`, `SMSPORTAL_CLIENT_ID` and `TCG_WEBHOOK_SECRET`.
- Update `backend/.env.example`'s accounting block from Odoo to Zoho, and delete the dead `GOOGLE_MAPS_API_KEY` entry.

---

## 3. The cutover — the irreversible window

**Pick a low-traffic window.** Check the hourly heatmap on `/admin/analytics/insights`. Sunday 06:00–09:00 SAST is the usual answer.

**Expected downtime: 30–45 minutes of read-only, then 15–30 minutes of DNS propagation at 60s TTL.**

**Everyone is logged out.** There is no way to carry sessions across domains or Clerk instances. Cookies are host-scoped to `gungalore.co.za` and do not travel. Tell users in advance. If Clerk password hashes did **not** come across, that message must be "you will need to reset your password" — a much bigger comms job, and a reason to delay.

### Preconditions — all must be true before you start

- [ ] Phase 6 checklist 100% green
- [ ] Both courier in-flight queries return zero rows
- [ ] Clerk has answered on the app transfer, and you have acted on the answer
- [ ] Decrypt proof passes: `PASS 20 / 20`
- [ ] Resend sending domain verified and warmed for at least 5 days
- [ ] Clerk FAPI records verified and certificate issued
- [ ] New Cloudflare origin certificate installed; nginx real-IP configured
- [ ] `gungalore.co.za` TTL has been at 60s for 48 hours
- [ ] Absolute Hosting invoice paid, no suspension notice
- [ ] Swap active on the new box (`free -h` shows 8 GB)
- [ ] The reindex script is written and tested
- [ ] You have a maintenance-page plan for the old box

### The window, in order

| # | Action | Time | Notes |
|---|---|---|---|
| 1 | Post the maintenance notice on the old site | T+0 | |
| 2 | Put the old site into read-only / maintenance | T+2m | **Payments are not live, but offers, bids and Q&A are.** Any write taken after the dump and before cutover is lost. |
| 3 | Final `pg_dump` from Vultr (`?schema=public` stripped) | T+5m | ~2 min for 151 MB |
| 4 | Copy the dump to the new box, drop and re-restore `alloutdoor_prod` | T+10m | |
| 5 | Final `rsync` of the manuals directory | T+15m | Catches anything ingested since the rehearsal |
| 6 | `npx prisma migrate status` — all 99 applied | T+18m | |
| 7 | **Run the decrypt proof. `PASS 20 / 20`.** | T+20m | **ABORT if this fails.** |
| 8 | Start Meilisearch, boot the backend, confirm the four log lines | T+22m | |
| 9 | **Run the listings reindex. Count matches Postgres.** | T+25m | **ABORT if the count is short.** |
| 10 | `pm2 start` backend and frontend; smoke test on `staging.alloutdoor.co.za` | T+30m | |
| 11 | **THE POINT OF NO RETURN** — create the `alloutdoor.co.za` apex A record → <NEW_ORIGIN_IP>, proxied | T+35m | Everything before this is reversible for free. Everything after it means users may have written data to the new box. |
| 12 | Re-point the Clerk webhook to `https://alloutdoor.co.za/api/webhooks/clerk` and **delete the old webhook endpoint** | T+36m | Deleting the old endpoint is what prevents a future `user.deleted` storm. |
| 13 | Re-point the Pudo webhook, the TCG webhook (with the matching secret), and the four Peach webhook URLs | T+38m | |
| 14 | Lift the coming-soon gate; take the old site out of maintenance and enable the 301 to the new domain | T+45m | |
| 15 | Stop the marketplace pm2 processes on Vultr | T+50m | Prevents double-firing crons |
| 16 | Watch logs and `/admin/alerts` for 60 minutes | T+50m–T+110m | |

### Abort criteria — hard stops

Abort **before step 11** on any of these. Aborting before step 11 costs nothing: take the old site out of maintenance and reschedule.

1. The decrypt proof does not return `PASS 20 / 20`.
2. `prisma migrate status` shows any migration not applied.
3. The reindex count does not match the active listing count in Postgres.
4. Any of the four boot log lines is missing or reports a failure.
5. The canary real-user login does not show that user's listings, orders and KYC status.
6. The new box is swapping heavily (>2 GB) at idle.
7. Absolute Hosting sends a suspension notice at any point.

**After step 11, aborting is expensive.** The rollback is: revert the DNS record, restart pm2 on Vultr, take the old site out of maintenance. It restores *service* in about two minutes at 60s TTL. It does **not** restore any data a user wrote to the new box in the interim, and there is no merge path between the two databases. **Write down a hard "point of no return" timestamp before you start** — a wall-clock time after which you will fix forward rather than roll back, regardless.

Two things that are not rollback-able whatever you do: emails already sent from the new domain, and any spam-folder reputation damage already incurred. That is why the sending domain is warmed up separately, days earlier.

---

## 4. Every environment variable

**Legend:** **CARRY** = copy the value byte-for-byte, changing it loses data · **NEW** = generate/re-register fresh · **DOMAIN** = same purpose, value must change to the new domain · **CHECK** = carry but verify against the live prod `.env` · **DROP** = do not put it on the new box

### Identity — Clerk

| Var | Class | What to do |
|---|---|---|
| `CLERK_SECRET_KEY` | CARRY | Unchanged if Clerk transfers the app. If a new instance is forced, this is the highest-risk item in the whole migration — see 1.2. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | CARRY | Same. Inlined at build time — changing it needs a full frontend rebuild, not a pm2 restart. |
| `CLERK_WEBHOOK_SECRET` | NEW | New signing secret from the new webhook endpoint. **Never reuse the old value on the new box.** |
| `CLERK_AUTHORIZED_PARTIES` | CHECK | Read the live prod `.env`. If set to the old origin it must gain `https://alloutdoor.co.za` or every request 401s and the whole site logs out. |

### Crypto and sessions

| Var | Class | What to do |
|---|---|---|
| `ID_HASH_SECRET` | **CARRY** | **The single most destructive variable in the app.** Byte-for-byte, no trailing whitespace. Prove it with the decrypt script before any traffic. |
| `VAPID_PUBLIC_KEY` | CARRY | Matched pair with the private key — never move one without the other. |
| `VAPID_PRIVATE_KEY` | CARRY | Same. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | CARRY | Must equal `VAPID_PUBLIC_KEY`. Frontend env, inlined at build. |
| `VAPID_SUBJECT` | NEW | `mailto:support@alloutdoor.co.za`. Set it explicitly — the fallback is a gungalore address that will bounce. |
| `JWT_ADMIN_SECRET` | NEW | Generate fresh (`openssl rand -base64 48`). The old dev default is in git history. **Missing = the backend crash-loops and the site is 502.** One forced admin re-login at cutover. |
| `COMING_SOON_BYPASS_SECRET` | NEW | Frontend env, not backend. If `COMING_SOON_GATE=on` and this is unset, `/preview` 500s and you lock yourself out. |
| `COMING_SOON_GATE` | NEW | `on` during the dry run, `off` at go-live. This is also the panic button — setting it `off` short-circuits the gate entirely. |

### Media

| Var | Class | What to do |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | CARRY | **Do not create a new cloud.** Rename the account. 16 URL columns bake this into stored strings, and 14 of them have no companion `public_id`. |
| `CLOUDINARY_API_KEY` | CARRY | Same account. |
| `CLOUDINARY_API_SECRET` | CARRY | Same account. |
| `RELOADING_MANUALS_STORAGE_DIR` | DOMAIN | Set **explicitly** on the new box. The default is relative to `process.cwd()` and a wrong cwd silently creates an empty directory instead of erroring. |
| `RELOADING_MANUALS_INBOX_DIR` | DOMAIN | Same. rsync both directories. |

### Money

| Var | Class | What to do |
|---|---|---|
| `ZOHO_BOOKS_ORG_ID` | **CARRY** | **Must not change.** Rename the org inside Zoho; do not create a new one. See 1.3. |
| `ZOHO_BOOKS_CLIENT_ID` | NEW | Re-mint via Zoho API Console → Self Client, against the **same org**. |
| `ZOHO_BOOKS_CLIENT_SECRET` | NEW | Same. |
| `ZOHO_BOOKS_REFRESH_TOKEN` | NEW | Same. Scope `ZohoBooks.fullaccess.all`. |
| `ZOHO_BOOKS_API_DOMAIN` | CARRY | Keep on the `.com` data centre. The org is DC-pinned. |
| `ZOHO_BOOKS_ACCOUNTS_DOMAIN` | CARRY | Same. |
| `ZOHO_BOOKS_ENABLED` | CHECK | `false` through cutover, flip to `true` on day 2. Not in `.env.example` — copy by hand. |
| `PEACH_CLIENT_ID` | NEW | New merchant. Keep the old sandbox merchant open until the new one completes an end-to-end. |
| `PEACH_CLIENT_SECRET` | NEW | Same. |
| `PEACH_MERCHANT_ID` | NEW | Same. |
| `PEACH_ENTITY_ID` | NEW | Same. |
| `PEACH_SECRET` | NEW | Webhook HMAC key. The raw-vs-hex question is unresolved and is a payments-go-live blocker, not a migration blocker. |
| `PEACH_ENV` | CHECK | `sandbox`. Do not change during the move. |
| `PAYMENT_MODE` | CHECK | `manual`. Do not change during the move. |
| `PAYMENTS_LIVE` | CHECK | `false`. **Do not flip this during a hosting migration.** Two risky transitions in one window means you cannot tell which one broke. |
| `NEXT_PUBLIC_PAYMENT_MODE` | CHECK | Match the backend. Frontend env, inlined at build. |
| `STITCH_CLIENT_ID` | DROP | No runtime code reads it. |
| `STITCH_CLIENT_SECRET` | DROP | Same. |
| `FNB_ACCOUNT_SUFFIX` | DROP | Does not exist anywhere in the repo. Leftover from the stripped manual EFT rail. |

### Logistics and comms

| Var | Class | What to do |
|---|---|---|
| `PUDO_API_KEY` | CARRY-or-NEW | Carry if Pudo renames the account. New only if forced — drain in-flight parcels and download waybills first. |
| `PUDO_API_SECRET` | CARRY-or-NEW | Same. Only needed if the key is not the combined `<id>\|<secret>` form. |
| `PUDO_BASE_URL` | DROP | Leave unset unless Pudo issues a different host. |
| `TCG_API_KEY` | CARRY-or-NEW | Same reasoning as Pudo. Separate business, separate wallet — do the rename ticket twice. |
| `TCG_WEBHOOK_SECRET` | NEW | **Set on the new box AND in the TCG portal before the first booking.** Missing = every tracking event silently discarded; door deliveries stick on PENDING forever. |
| `TCG_BASE_URL` | DROP | Leave unset. |
| `SMSPORTAL_CLIENT_ID` | CARRY-or-NEW | Prefer renaming — it preserves the sender number users already have threaded and the credit balance. **Missing = STUB mode, which reports success and sends nothing.** |
| `SMSPORTAL_API_SECRET` | CARRY-or-NEW | Same. |
| `SMSPORTAL_BASE_URL` | DROP | Leave unset. |
| `SMSPORTAL_API_KEY` | DROP | Legacy alias for the client id. Do not set both. |
| `RESEND_API_KEY` | NEW | **Missing = every transactional email dropped, nothing queued to the outbox, unrecoverable.** |
| `VERIFYNOW_API_KEY` | CARRY-or-NEW | Prefer renaming — it preserves credits and keeps historic transaction ids queryable for FICA audit. |
| `VERIFYNOW_MODE` | **CHECK** | Must be exactly `production`. `.env.example` ships `sandbox`, and an unrecognised value silently defaults to sandbox — every new seller then passes KYC against canned data. |
| `VERIFYNOW_BASE_URL` | DROP | Leave unset unless the new account is on a different host. |
| `VERIFYNOW_BASIC_REPORT_TYPE` | DROP | Leave unset. |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASSWORD` | DROP | Decommissioned with the manual EFT rail. Nothing reads them. Revoke the mailbox rather than moving the credentials. |

### Platform

| Var | Class | What to do |
|---|---|---|
| `DATABASE_URL` | DOMAIN | New host, new database name, **same role name as prod**. Strip `?schema=public` when running `pg_dump`. |
| `MEILISEARCH_HOST` | DOMAIN | `http://localhost:7700`. Keep it on loopback. |
| `MEILISEARCH_API_KEY` | NEW | New master key. Meilisearch is 100% derived — rebuild, do not copy the data directory. |
| `ANTHROPIC_API_KEY` | NEW | New org. Fund it before cutover or every seller fails KYC vision and every listing lands in manual review. |
| `ANTHROPIC_ADMIN_API_KEY` | NEW | **Mint a real Admin key.** The current prod value is a regular key, so the spend monitor has never worked. |
| `ANTHROPIC_MODEL_*` (11 vars) | CARRY | Copy verbatim. Leaving them unset silently changes which model runs KYC and moderation. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | NEW | New project, **three** APIs (Maps JS + Places + **Geocoding**), referrer restricted to the new domain. Inlined at build. |
| `GOOGLE_MAPS_API_KEY` | DROP | Dead — no backend file reads it. |
| `FRONTEND_URL` | DOMAIN | `https://alloutdoor.co.za`. **CORS in production allows only this plus the Capacitor schemes** — a stale value silently blocks every browser API call. |
| `NEXT_PUBLIC_SITE_URL` | DOMAIN | Unset = sitemap, robots and canonical/OG tags all advertise the old domain. Not in `.env.example`. |
| `NEXT_PUBLIC_APP_URL` | DOMAIN | Not in `.env.example`. |
| `NEXT_PUBLIC_API_URL` | DOMAIN | Inlined at build. |
| `INTERNAL_API_URL` | DOMAIN | `http://localhost:3001/api`. Server-only loopback hop — must not go out through Cloudflare. Not in `.env.example`. |
| `BACKEND_URL` | DOMAIN | New domain. |
| `PUBLIC_API_URL` | DOMAIN | **Load-bearing.** It is the signature base for all four Peach webhooks. A mismatch with what is registered in the Peach dashboard makes webhook verification fail closed while still returning 200 — payments would appear to vanish. Inert today, live the moment payments go live. |
| `EMAIL_LOGO_URL` | DOMAIN | Point at the new domain or a Cloudinary copy. Keep the `?v=` cache-buster. |
| `SUPPORT_EMAIL` | DOMAIN | New address. Note `frontend/lib/support-contact.ts` exports this but is imported by **zero** files — 24 files hard-code the literal instead. |
| `PORT` | CARRY | `3001`. |
| `NODE_ENV` | CHECK | `production`, set in the pm2 ecosystem config as well. Anything else silently disables the config gate and makes CORS trust localhost and LAN origins with credentials. |
| `NEXT_PUBLIC_ASKGG_CONTEXT` | CARRY | `true`. |
| `NEXT_PUBLIC_DISABLE_PWA` | CARRY | Leave as prod has it. Not in `.env.example`. |
| `HUNT_BALLISTICS_ADMIN_KEY` | CARRY | Copy verbatim or the operator's ballistics import scripts start 401ing. Must be ≥16 characters or the guard hard-fails 503. |

---

## 5. What is deliberately NOT moving

Staying on the Vultr box <OLD_ORIGIN_IP>:

- **The ballistics app** (`~/ballistics-app/`, `ballistics.gungalore.co.za`)
- **ballistic-hunter**
- **pvrescue.co.za**

### The catch: ballistics is not actually separable as built

`HuntPdf`, `HuntPdfPage` and `RangeEstimate` are tables inside `gungalore_prod`, and `HuntBallisticsModule` is compiled into the **marketplace** backend (`backend/src/app.module.ts:48,108`). Its Info Centre search and page reads are served by *this* backend against *this* database. The URL is deliberately nested under `/hunt-ballistics/` so the existing `ballistics.gungalore.co.za` nginx block catches it.

Move the marketplace and its Postgres to Absolute and the ballistics app on Vultr is left proxying to a backend whose database has been superseded. It either serves stale content (if the old box keeps running against the old DB) or 502s (if you stop pm2 there). Any PDF imported afterwards lands in whichever database that box happens to point at, and the two silently diverge.

**Three options, and you must pick one in Phase 0:**

| Option | What it means | Effort |
|---|---|---|
| **(a)** Point the old box's nginx `/api/hunt-ballistics/*` at the new backend on <NEW_ORIGIN_IP> over TLS | Ballistics keeps working, data stays in one place | Small — an nginx change plus copying `HUNT_BALLISTICS_ADMIN_KEY` |
| **(b)** Move `ballistics.gungalore.co.za` onto the new box too | Simplest to reason about; adds load to a 2-core box | Medium |
| **(c)** Split `HuntPdf`/`HuntPdfPage`/`RangeEstimate` into the ballistics app's own database | The only option that makes the two products genuinely independent | Real work — a project, not a cutover step |

Recommendation: **(a) for the cutover, (c) as a follow-up project.** Whichever you pick, **freeze all ballistics content imports for the duration of the cutover.** Once the two databases diverge there is no clean rollback.

The Capacitor iOS shell is fine either way — its origin is `capacitor://localhost`, which is hard-allowed in CORS. Any *browser*-based ballistics surface on the old domain calling the new backend cross-origin will be CORS-blocked, because production CORS allows only `FRONTEND_URL` plus the app schemes.

### What this means for the Vultr box's lifetime and cost

**You are paying for two servers for at least three months, probably twelve.** Budget for it now rather than being surprised.

| Period | Why the Vultr box must stay | Can you downsize? |
|---|---|---|
| Cutover day → +48h | Rollback target. pm2 stopped but intact, database untouched. | No |
| → +30 days | The 301 redirect origin. The old Cloudflare zone and origin certificate must stay live. Rollback still theoretically possible. | Not yet |
| → +90 days | Old Cloudinary assets, old Clerk application, old vendor accounts all still referenced. Do not delete anything. | Possibly — the marketplace processes are stopped, so it is only serving ballistics + pvrescue |
| → +12 months | The 301 redirect must keep running for SEO and for links in the wild. Ballistics and pvrescue still live there. | Yes — a 4 core / 7.9 GB box for three small apps is oversized once the marketplace is gone |

Note that the 301 can be moved off the box entirely: a Cloudflare Redirect Rule on the old zone works with **no origin at all**, so the redirect obligation does not by itself keep the server alive. Only ballistics, ballistic-hunter and pvrescue do.

**Do not clean up the old box's `backend/.env`.** It is one of only two copies of `ID_HASH_SECRET` and the VAPID pair. Put those values in the operator's password manager and only then consider the file expendable.

---

## 6. Open questions for the operator

These are decisions only you can make. Several of them gate the cutover date.

**1. Ballistics — (a), (b) or (c) from section 5?** Nothing else can be safely sequenced until this is answered. *Blocks: Phase 1.*

**2. Will Clerk transfer the existing production application into the new All Outdoor organisation?** Open the ticket today. If the answer is no, the follow-up question is: **will Clerk export password digests?** That answer decides whether user comms say "sign in again" or "reset your password", and a mandatory password reset for every user is a business decision, not a deploy step. *Blocks: the cutover date itself.*

**3. Will you accept renaming rather than re-registering for Pudo, TCG, SMSPortal, VerifyNow, Cloudinary and Zoho?** The company is unchanged — `GunGalore (Pty) Ltd`, reg `2026/393321/07`. Re-registering each costs a stranded prepaid wallet, a broken audit trail to historical external ids, and for the two couriers a window where in-flight parcels are invisible. "So it stays uniform" is satisfied by a trading-name change on each existing account. *Blocks: Phase 5.*

**4. Confirmed: no new Zoho Books organisation?** A Books org is a legal ledger with eleven foreign keys pointing into it from production. I need an explicit yes on renaming rather than recreating. *Blocks: Phase 3.*

**5. Confirmed: no new Cloudinary cloud?** Sixteen URL columns, fourteen of them without a stored `public_id`, holding KYC ID documents, selfies and dealer-stamped SAP 534 forms that the schema explicitly retains as a compliance audit trail. *Blocks: Phase 3.*

**6. What is the acceptable maintenance window, and on what date?** Check `/admin/analytics/insights` for the hourly heatmap. I have assumed 30–45 minutes read-only plus 15–30 minutes propagation.

**7. Are you prepared to pay for both servers for 3–12 months?** See section 5.

**8. Will you delay payments go-live until well after the move?** Strong recommendation: yes. Land the new box in exactly the state prod is in today. Two risky transitions in one window means you cannot tell which one broke.

**9. Who writes the user comms, and when do they go out?** At minimum: "we are moving to alloutdoor.co.za, you will need to sign in again." At worst, if password hashes do not transfer: "you will need to reset your password." The second version needs several days' notice and a support plan.

**10. What is your hard point-of-no-return time on cutover day?** A wall-clock time after which you fix forward rather than roll back, regardless of what is broken. Decide it before you start, not at 03:00 while looking at an error.

**11. Are you willing to land the small pre-cutover code fixes on the CURRENT box first?** Specifically the `users.service.ts` ordering bug (`resolveUsernameConflict` runs before the relink-by-email and can silently rename and orphan a live account) and the case-sensitive email comparison. These are small, they should be verified on the current box, and only then carried to the new one. They matter only if Clerk refuses the app transfer — but you will not know that in time to write them later.

---

### Things nobody could verify from the repo — check these against the live systems

- Is `CLERK_AUTHORIZED_PARTIES` set in the live backend `.env`, and to what? If it is the old origin, every request 401s after the domain change.
- Is `ZOHO_BOOKS_ENABLED` currently `true` on prod?
- Do `img.clerk.com` avatar URLs survive deletion of their Clerk instance? Assumed no, because the cost of being wrong the other way is every avatar on the site breaking.
- Does the Google social connection use Clerk's shared credentials or a custom Google Cloud OAuth client? Only the custom case needs a redirect-URI change.
- Are Pudo locker terminal ids network-global or account-scoped? Get it in writing.
- Does the current prod nginx already set real-IP from Cloudflare ranges? If not, the throttler has been misbehaving all along and this move is the chance to fix it.
- The exact SAN list on `/etc/ssl/cloudflare/gungalore.pem`, and the current Cloudflare zone's SSL mode, page rules and cache rules. **No nginx config, pm2 ecosystem file or deployment manifest is committed anywhere in this repo** — everything stated about the edge is inferred from code comments. Read the live config before cutover.
