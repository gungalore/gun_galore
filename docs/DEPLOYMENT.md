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

## Before you start

| | |
|---|---|
| Host | `ssh gungalore` — Vultr VPS, `<OLD_ORIGIN_IP>`, user `gungalore` |
| Checkout | `/home/gungalore/app` |
| Processes | `gungalore-backend` (:3001), `gungalore-frontend` (:3000) |
| Health | `http://localhost:3001/api/health`, `http://localhost:3000` |

**Always `ssh gungalore`. Never `ssh gungalore@<OLD_ORIGIN_IP>`** — the
`user@host` form skips the local `~/.ssh/config` alias, does not find the key,
and prompts for a password that does not exist.

**Production does not track `main`.** It tracks a feature branch, and which one
has changed over time — as of 2026-08-12 it is `feat/takealot-ux-parity`.
`main` is intentionally stale pending a re-baseline. Do not assume; ask the
server:

```bash
ssh gungalore "cd /home/gungalore/app && git branch --show-current && git log --oneline -1"
```

Deploy to whatever that prints. If you are about to change which branch
production tracks, that is a conversation with the operator, not a deploy step.

---

## Step 0 — prove it compiles locally

```powershell
cd backend  ; npx tsc --noEmit
cd ..\frontend ; npx tsc --noEmit
npm run build
```

All three clean before you touch the server. There is no CI: your machine is
the only thing standing between a type error and production. `next build` in
particular catches things `tsc` alone does not — App Router route collisions,
for one, which is how a duplicate route slipped past a clean type-check once.

Commit and push to the deployment branch.

---

## Step 1 — pull

```bash
ssh gungalore "cd /home/gungalore/app \
  && git stash --include-untracked \
  && git pull --ff-only origin <branch> \
  && git rev-parse --short HEAD"
```

The `git stash` is housekeeping from an older SCP-based workflow that
occasionally left edits on the server. Those edits are already in the branch
from the dev-side commits, so stashing them is safe and stops `git pull`
aborting. If `git stash` ever produces something you did not expect, stop and
look at it before continuing.

`--ff-only` so a divergence fails loudly instead of opening a merge.

Write down the short SHA. The rest of the deploy uses it.

---

## Step 2 — database, and the `prisma generate` trap

```bash
cd /home/gungalore/app/backend
npm install                    # cheap no-op if package.json did not move
```

**If `prisma/schema.prisma` changed in this diff** — and only then:

```bash
npx prisma generate            # BEFORE the build. Not after. See below.
npx prisma migrate deploy      # applies committed migrations; no-op if none pending
```

Why the order matters. `nest build` is `tsc`. After pulling a new schema, the
generated `@prisma/client` on the server is still the old one, so any code
referencing a new model or column fails to type-check. `tsc` emits nothing on
error — and `pm2 reload` then cheerfully restarts the *previous* `dist/`. The
migration applied, the code did not, and the new endpoints 404 against a
running old build that looks perfectly healthy. That is what happened on the
address-book deploy: 17 type errors, all masked, nobody noticed until the
feature did not work.

**Never run `npx prisma db push`.** Three services — the Ask Boet knowledge
base, reloading-manual full-text search, and listings full-text search — create
`tsvector GENERATED` columns and GIN indexes at boot with raw DDL. Those
columns are not in `schema.prisma`, so `db push --accept-data-loss` drops them
and the next boot does not rebuild the indexes cleanly. Schema changes get a
real migration file and `migrate deploy`, always.

**Never pipe a build through `tail`.** `npm run build | tail -20` gives the
pipeline `tail`'s exit code, which is always 0, so a failed build sails on to
the reload. If you want less output, redirect to a file and read it (which is
what the next step does anyway).

---

## Step 3 — build detached, into a commit-unique log

Both builds. The backend's is quick; the frontend's is the one that matters.

```bash
SHA=$(cd /home/gungalore/app && git rev-parse --short HEAD)

# Backend
setsid bash -c "cd /home/gungalore/app/backend && npm run build \
  > /tmp/be-build-$SHA.log 2>&1; echo BUILD_EXIT=\$? >> /tmp/be-build-$SHA.log" \
  < /dev/null > /dev/null 2>&1 &

# Frontend
setsid bash -c "cd /home/gungalore/app/frontend && npm run build \
  > /tmp/fe-build-$SHA.log 2>&1; echo BUILD_EXIT=\$? >> /tmp/fe-build-$SHA.log" \
  < /dev/null > /dev/null 2>&1 &
```

Three things in that command are load-bearing.

**`setsid` / detached.** `next build --webpack` on this codebase runs for
several minutes. Run it in the foreground over SSH and any hiccup on the link
— a laptop sleeping, a Wi-Fi handover — sends SIGHUP and kills the build
midway, leaving a half-written `.next/`. Detaching means the build outlives the
session.

**`$SHA` in the log filename.** A shared path like `/tmp/fe-build.log` is
shared *across deploys*, and matching a marker in it proves nothing about
*this* build. On 2026-07-20 a waiter loop matched the **previous** deploy's
`BUILD_EXIT=0` — the launcher had not truncated the file yet — fired
`pm2 restart` while `next build` was still writing `.next/`, and the frontend
came up against a half-built directory: `ENOENT required-server-files.json`,
homepage 500s for about ten minutes. A crash-looping Node process also steals
CPU from the build that is still running, so it gets slower while it is down.

**`echo BUILD_EXIT=$?`.** The exit code is the only reliable signal. Build
output contains the word "error" in benign contexts and `next build` prints
plenty that looks alarming and is not.

---

## Step 4 — wait for the build PROCESS, then read the marker

Not the marker alone. The process.

```bash
# Frontend
until ! ssh gungalore 'pgrep -f "next build" >/dev/null'; do sleep 15; done
ssh gungalore "grep BUILD_EXIT /tmp/fe-build-$SHA.log"

# Backend
until ! ssh gungalore 'pgrep -f "nest build" >/dev/null'; do sleep 10; done
ssh gungalore "grep BUILD_EXIT /tmp/be-build-$SHA.log"
```

Expect exactly `BUILD_EXIT=0`. Anything else — a non-zero code, or no marker at
all because the process was OOM-killed — means **stop**. The old build is still
running and still serving traffic, so there is no emergency and nothing to roll
back. Read the log, fix it, start again.

A build that vanished without writing a marker is almost always memory. See the
swap section of [`infra/setup/README.md`](../infra/setup/README.md) — this box
builds next to PostgreSQL and Meilisearch, and `next build --webpack` peaks over
2 GB by itself.

---

## Step 5 — reload, guarded

Use `pm2 reload`, not `pm2 restart`. Reload is a rolling restart: the old
process keeps answering until the new one is ready, so a normal deploy has no
downtime. `restart` kills first and asks questions later — reserve it for a
process that is genuinely frozen or a reload that has hung past 60 seconds.

`--update-env` makes pm2 re-read the environment, which matters when a `.env`
value changed.

Guard the command itself. Do not reload unconditionally after a wait loop —
that is the same mistake as trusting a stale marker, one layer up:

```bash
ssh gungalore "if pgrep -f 'nest build' >/dev/null; then echo 'STILL BUILDING — ABORT';
  elif grep -q 'BUILD_EXIT=0' /tmp/be-build-$SHA.log; then
    pm2 reload gungalore-backend --update-env; else echo 'BUILD FAILED — ABORT'; fi"

sleep 5
ssh gungalore "curl -f http://localhost:3001/api/health && echo BACKEND OK"

ssh gungalore "if pgrep -f 'next build' >/dev/null; then echo 'STILL BUILDING — ABORT';
  elif grep -q 'BUILD_EXIT=0' /tmp/fe-build-$SHA.log; then
    pm2 reload gungalore-frontend --update-env; else echo 'BUILD FAILED — ABORT'; fi"
```

Backend first, then frontend. The frontend's server components call the API
during render, so bringing the API up first means the new pages never see an
old backend.

If a health check fails after a reload: **do not** reflexively `pm2 restart`.
Stop and report. A failed reload leaves the old version serving — restarting is
what converts a non-event into an outage.

---

## Step 6 — verify, twice

Twice is not superstition. The first request after a reload can be served by
the process that is on its way out; the second tells you what visitors get.

```bash
ssh gungalore "curl -fs http://localhost:3000 > /dev/null && echo FE OK; sleep 3; \
               curl -fs http://localhost:3000 > /dev/null && echo FE OK AGAIN"
ssh gungalore "pm2 list"
curl -sI https://gungalore.co.za | head -1     # through Cloudflare, from your machine
```

`pm2 list` should show both processes `online` with a restart count that did
not jump. A climbing restart count means crash-looping.

Treat a 500 as an emergency. First thing to check is whether the build actually
finished:

```bash
ssh gungalore "ls -la /home/gungalore/app/frontend/.next/required-server-files.json"
```

Missing means you reloaded into a half-built directory. The fix is to wait for
the build to genuinely finish and reload again — not to restart harder.

---

## Step 7 — the static-asset cache trap

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

**Bad code.** Check out the previous commit on the server and repeat steps 2–6
against it. Everything above applies unchanged — same detached build, same
guards.

**Bad migration.** Harder, and the reason `migrate deploy` gets its own
attention above. Stop the backend, restore the most recent `pg_dump`, then
deploy the previous commit. Confirm with the operator what backups actually
exist before you need them.

---

## Quick reference

```bash
ssh gungalore "cd /home/gungalore/app && git branch --show-current && git log --oneline -1"
ssh gungalore "pm2 list"
ssh gungalore "pm2 logs gungalore-backend --lines 100 --nostream"
ssh gungalore "pm2 logs gungalore-frontend --lines 100 --nostream"
ssh gungalore "curl -s http://localhost:3001/api/health"
ssh gungalore "sudo nginx -t && sudo systemctl reload nginx"
ssh gungalore "sudo tail -n 50 /var/log/nginx/error.log"
ssh gungalore "free -h && swapon --show"
```

`pm2 save` and `pm2 startup` are already configured, so both services come back
after a reboot. If you ever change a process *definition* — script path, memory
ceiling, instance count — that lives in
[`infra/pm2/ecosystem.config.js`](../infra/pm2/ecosystem.config.js), and the
file's own header explains how to adopt it on a box whose processes were
created by hand.
