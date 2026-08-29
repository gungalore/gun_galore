# Deploying

> **Origin IP addresses are deliberately not written down here.** The site sits
> behind Cloudflare with an Origin Certificate, and that whole model depends on
> the origin address staying private — publish it and anyone can bypass the WAF
> and hit the box directly. Git history keeps whatever you commit, forever, even
> if you edit it out later. The real values live in the operator's password
> manager and in `~/.ssh/config` on the machines that need them.

There is one environment. Deploying means SSHing to the production VPS,
pulling the branch, **building on that same box**, and reloading two pm2
processes while the site is serving real traffic.

That is not the architecture anyone would choose, and it is the architecture
you have. Every guard in this document exists because skipping it broke
production at least once. The dates are in the text so you can tell which
warnings are folklore and which are scar tissue. They are all scar tissue.

Setting up a box from scratch is a different document:
[`infra/setup/README.md`](../infra/setup/README.md).

---

## Deploy with the script. Do not hand-roll it.

```bash
bash infra/deploy/deploy.sh                 # both
bash infra/deploy/deploy.sh --backend-only
bash infra/deploy/deploy.sh --frontend-only
```

[`infra/deploy/deploy.sh`](../infra/deploy/deploy.sh) is the only sanctioned
path. It does every step this document used to spell out by hand, in the right
order, with the guards attached — and it refuses rather than half-deploying.
Read its header before changing it; it records why each piece is shaped the way
it is.

**A run takes as long as the builds do, around four minutes.** That is correct
behaviour for a deploy, not a problem to engineer around. Let it finish.

**A refused deploy is not an outage.** Nothing is reloaded unless its build
genuinely succeeded and left a usable artefact, so the old version keeps
serving. Read the error, fix it, run it again.

The rest of this document is the *why*: the traps the script is built around,
and the things it cannot do for you.

---

## Before you start

| | |
|---|---|
| Host | `ssh alloutdoor` — Vultr VPS, user `alloutdoor` |
| Checkout | `/home/alloutdoor/app` |
| Processes | `alloutdoor-backend` (:3001), `alloutdoor-frontend` (:3000) |
| Health | `http://localhost:3001/api/health`, `http://localhost:3000` |
| Branch | `feat/takealot-ux-parity` — see below |

**Always `ssh alloutdoor`. Never `ssh alloutdoor@<IP>`** — the `user@host` form
skips the local `~/.ssh/config` alias, does not find the key, and prompts for a
password that does not exist.

### ⚠️ There are two boxes, and one of them is a trap

`ssh gungalore` **no longer exists.** That alias pointed at the retired
pre-replatform box and was deleted from `~/.ssh/config` on 2026-08-29, at the
operator's instruction. The host had stopped answering, and the alias was
worse than useless while it worked: **deploying there applies a replaced
migration baseline over a live database.** The command now fails to resolve,
which is the intent — it fails loudly instead of quietly succeeding against the
wrong machine.

Do not recreate it. `deploy.sh` hardcodes `HOST=alloutdoor` and will not talk
to anything else.

⚠️ **The KEY is still called `~/.ssh/gungalore_deploy`, and it is still in
use** — the `alloutdoor` block authenticates with it. The filename is
historical. Never delete it while tidying up "gungalore" references.

### Production does not track `main`

It tracks a feature branch, and which one has changed over time — as of
2026-08-29 it is `feat/takealot-ux-parity`. `main` is intentionally stale
pending a re-baseline, and `git push origin main` succeeds while shipping
nothing at all. Do not assume; ask the server:

```bash
ssh alloutdoor "cd /home/alloutdoor/app && git branch --show-current && git log --oneline -1"
```

If you are about to change which branch production tracks, that is a
conversation with the operator, not a deploy step.

⚠️ **`deploy.sh` pushes the deploy branch before it gates anything.** Whatever
is sitting unpushed on that branch locally goes with your change — including,
on at least one occasion, a live database migration nobody meant to ship.
Check first:

```bash
git log --oneline origin/feat/takealot-ux-parity..feat/takealot-ux-parity
```

Empty means you are shipping only what you think you are shipping.

---

## Prove it compiles locally

```powershell
cd backend  ; npx tsc --noEmit
cd ..\frontend ; npx tsc --noEmit
npm run build
```

All three clean before you touch the server. There is no CI: your machine is
the only thing standing between a type error and production. `next build` in
particular catches things `tsc` alone does not — App Router route collisions,
for one, which is how a duplicate route slipped past a clean type-check once.

If you merged to get onto the deploy branch, **re-run these on the merged
tree.** A merge with zero textual conflicts can still be semantically broken,
and the tree you tested is not the tree you are shipping.

Commit and push to the deployment branch.

---

## The database, and the `prisma generate` trap

The script runs `prisma migrate deploy` and then `prisma generate`, in that
order, before either build. Both matter.

**`prisma generate` must come before the build.** `nest build` is `tsc`. After
pulling a new schema, the generated `@prisma/client` on the server is still the
old one, so any code referencing a new model or column fails to type-check.
`tsc` emits nothing on error — and `pm2 reload` then cheerfully restarts the
*previous* `dist/`. The migration applied, the code did not, and the new
endpoints 404 against a running old build that looks perfectly healthy. That is
what happened on the address-book deploy: 17 type errors, all masked, nobody
noticed until the feature did not work.

**Never run `npx prisma db push`.** Three services — the Ask Boet knowledge
base, reloading-manual full-text search, and listings full-text search — create
`tsvector GENERATED` columns and GIN indexes at boot with raw DDL. Those
columns are not in `schema.prisma`, so `db push --accept-data-loss` drops them
and the next boot does not rebuild the indexes cleanly. Schema changes get a
real migration file and `migrate deploy`, always.

**Never pipe a build through `tail`.** `npm run build | tail -20` gives the
pipeline `tail`'s exit code, which is always 0, so a failed build sails on to
the reload.

**Read your own migrations before shipping them.** `ADD COLUMN`, `CREATE
TABLE`, and a guarded `CREATE TYPE` are additive and safe against a live
database. A `DROP`, a `TRUNCATE`, or an `ALTER COLUMN ... TYPE` is not, and
wants the operator's eyes and a fresh `pg_dump` first.

---

## ⚠️ Why there is no "build detached and poll for a marker" step

This document used to carry one, in detail, with its own incident report. It is
gone, and the reasoning is worth keeping because the procedure looked correct
for weeks.

**It caused the outage it was written to prevent.** On 2026-08-19 the waiter
loop used `grep -c ... || echo 0`, which emits `0\n0` when there is no match.
It broke on its first iteration and reloaded pm2 onto a half-written `.next/`.

**Then the rewrite was tested, correct, and still pointless**, because the
premise was wrong. Measured on this box, `ssh host "cmd &"` returns only after
the backgrounded job finishes — 13 seconds for a 12-second sleep, and no better
with `setsid`, because ssh holds the session until its descendants release the
channel. The poller never had anything to wait for. Every "safe to reload" it
ever printed said `0s`. The deploy was safe **by accident**: ssh blocked, so
the build was always done before the check ran.

So the script builds in the foreground and reads the exit code directly. No
marker file, no parsing, no polling, and no chance of misreading any of them.
The whole apparatus existed to work around a tool-call timeout on the
operator's side, and it bought a failure mode for nothing.

⚠️ **Never gate a `pm2` reload on a marker in a shared path.** A path like
`/tmp/fe-build.log` is shared *across deploys*, and matching a marker in it
proves nothing about *this* build. On 2026-07-20 a waiter loop matched the
**previous** deploy's `BUILD_EXIT=0` — the launcher had not truncated the file
yet — fired `pm2 restart` while `next build` was still writing `.next/`, and
the frontend came up against a half-built directory: `ENOENT
required-server-files.json`, homepage 500s for about ten minutes. A
crash-looping Node process also steals CPU from the build that is still
running, so it gets slower while it is down.

If you ever must check by hand, check the **process** (`pgrep`) and a
**per-deploy** log, never a shared marker alone.

---

## Reloading, and what to do when it goes wrong

The script uses `pm2 reload`, not `pm2 restart`. Reload is a rolling restart:
the old process keeps answering until the new one is ready, so a normal deploy
has no downtime. `restart` kills first and asks questions later — reserve it
for a process that is genuinely frozen or a reload that has hung past 60
seconds. `--update-env` makes pm2 re-read the environment, which matters when a
`.env` value changed.

**Backend first, then frontend.** The frontend's server components call the API
during render, so bringing the API up first means the new pages never see an
old backend.

**If a health check fails after a reload: do not reflexively `pm2 restart`.**
Stop and report. A failed reload leaves the old version serving — restarting is
what converts a non-event into an outage.

A build that vanished without finishing is almost always memory. See the swap
section of [`infra/setup/README.md`](../infra/setup/README.md) — this box
builds next to PostgreSQL and Meilisearch, and `next build --webpack` peaks
over 2 GB by itself.

---

## Verify, twice

Twice is not superstition. The first request after a reload can be served by
the process that is on its way out; the second tells you what visitors get.
The script does this itself; these are for when you are checking by hand.

```bash
ssh alloutdoor "curl -fs http://localhost:3000 > /dev/null && echo FE OK; sleep 3; \
                curl -fs http://localhost:3000 > /dev/null && echo FE OK AGAIN"
ssh alloutdoor "pm2 list"
curl -sI https://alloutdoor.co.za | head -1     # through Cloudflare, from your machine
```

`pm2 list` should show both processes `online` with a restart count that did
not jump, and an uptime that climbs when you look again. A climbing restart
count means crash-looping; `pm2 jlist` gives you `unstable_restarts`, which is
the number that matters.

**Verify the thing you actually shipped, not just that the site is up.** A
schema change is only really deployed when the column exists:

```bash
ssh alloutdoor 'cd /home/alloutdoor/app/backend \
  && URL=$(grep -m1 "^DATABASE_URL=" .env | cut -d= -f2- | tr -d "\"" | sed "s/?schema=public//") \
  && psql "$URL" -c "select count(*) from _prisma_migrations where finished_at is null"'
```

⚠️ **`node -e "new PrismaClient()"` does not work on the box.** Prisma 7
requires explicit options or a driver adapter, so one-off Node scripts against
production fail on construction. Use `psql` with the URL from `.env`, and strip
`?schema=public` — `psql` does not understand it.

Treat a 500 as an emergency. First thing to check is whether the build actually
finished:

```bash
ssh alloutdoor "ls -la /home/alloutdoor/app/frontend/.next/required-server-files.json"
```

Missing means you reloaded into a half-built directory. The fix is to wait for
the build to genuinely finish and reload again — not to restart harder.

---

## The static-asset cache trap

**Read this whenever a deploy replaces a file in `frontend/public/` without
renaming it.**

Cloudflare caches `/public` assets for thirty days
(`Cache-Control: public, max-age=2592000`, set by the extension-matching block
in [`infra/nginx/alloutdoor.conf`](../infra/nginx/alloutdoor.conf)). Entries
already at the edge are **not** revalidated when they expire on the origin —
they simply serve until their own TTL runs out.

On 2026-08-12 the brand assets were replaced. The origin served the new files
the moment the deploy finished. The edge kept serving the old ones for another
twelve hours: `cf-cache-status: HIT`, `Age: 45392`. Ten files, and they were
the worst ten to be wrong — `og-default.jpg` (the image Meta fetches for every
WhatsApp share, still showing the old rifle photograph), `logo.svg` on every
page, `favicon.ico` in every browser tab and in the Google search result, and
all six PWA icons.

The fix is in the code, not the CDN. `frontend/lib/asset-version.ts`:

```ts
export const ASSET_VERSION = '20260812';
export function av(path: string): string { … }   // av('/logo.svg') → /logo.svg?v=20260812
```

**If you changed the bytes behind a filename that already exists, bump
`ASSET_VERSION` in the same commit.** The version rides in the query string, so
the URL changes, so every cache between the origin and the user treats it as a
new object. Purging Cloudflare from the dashboard also works and is instant,
but it needs dashboard access — the version constant is the fix that survives
not having it.

You do not need it for:
- anything under `/_next/` — Next content-hashes those paths itself;
- Cloudinary URLs — already versioned;
- a genuinely new filename — a new URL is a new URL.

---

## Rolling back

There is no automation for this. Two cases:

**Bad code.** Check out the previous commit on the deploy branch and run
`deploy.sh` again against it. Everything above applies unchanged.

**Bad migration.** Harder, and the reason `migrate deploy` gets its own
attention above. Stop the backend, restore the most recent `pg_dump`, then
deploy the previous commit.

⚠️ **Know what the backups actually cover before you need them.** Nightly at
02:10 SAST, covering the database and the upload tree — but **not**
`/home/alloutdoor/data/cip`, whose loss is silent. They are same-disk, and
nothing alerts on failure. Confirm with the operator rather than assuming.

---

## Quick reference

```bash
ssh alloutdoor "cd /home/alloutdoor/app && git branch --show-current && git log --oneline -1"
ssh alloutdoor "pm2 list"
ssh alloutdoor "pm2 jlist"                       # unstable_restarts lives here
ssh alloutdoor "pm2 logs alloutdoor-backend --lines 100 --nostream"
ssh alloutdoor "pm2 logs alloutdoor-frontend --lines 100 --nostream"
ssh alloutdoor "curl -s http://localhost:3001/api/health"
ssh alloutdoor "sudo nginx -t && sudo systemctl reload nginx"
ssh alloutdoor "sudo tail -n 50 /var/log/nginx/error.log"
ssh alloutdoor "free -h && swapon --show"
```

`pm2 save` and `pm2 startup` are already configured, so both services come back
after a reboot. If you ever change a process *definition* — script path, memory
ceiling, instance count — that lives in
[`infra/pm2/ecosystem.config.js`](../infra/pm2/ecosystem.config.js), and the
file's own header explains how to adopt it on a box whose processes were
created by hand.

⚠️ **No request may take longer than 60 seconds.** nginx caps at 60s and
Cloudflare at 100s, so a long AI job must return `202` and be polled, never
held open. The repo's nginx config and the live one have drifted on this
(120s vs 60s); the live value is what bites.
