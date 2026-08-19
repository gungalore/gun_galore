#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# Deploy to the live box.
#
#   bash infra/deploy/deploy.sh [--backend-only|--frontend-only]
#
# ── WHY THE BUILDS ARE SYNCHRONOUS ─────────────────────────────────
#
# An earlier version detached each build, wrote BUILD_EXIT to a log, and polled
# for it. That polling loop was the bug that took the site down on 2026-08-19 —
# `grep -c ... || echo 0` emits "0\n0" when there is no match, so it broke on
# its first iteration and reloaded pm2 onto a half-written .next.
#
# The rewrite that replaced the loop was tested and correct, and STILL wrong,
# because the premise was wrong: measured on this box, `ssh host "cmd &"`
# returns only after the backgrounded job finishes — 13 seconds for a 12-second
# sleep, and no better with setsid, because ssh holds the session until its
# descendants release the channel. So the poller never had anything to wait for.
# Every "safe to reload" it ever printed said "0s". The deploy was safe by
# ACCIDENT: ssh blocked, so the build was always done before the check ran.
#
# ssh already waits. So the build runs in the foreground and its exit code is
# read DIRECTLY — no marker file, no parsing, no polling, and no chance of
# misreading any of them. The whole apparatus existed to work around a tool-call
# timeout on the operator's side, and it bought a failure mode for nothing.
#
# This means a full run takes as long as the builds do (~4 minutes). That is
# correct behaviour for a deploy, not a problem to engineer around.
#
# ── THE OTHER TWO RECURRING MISTAKES ───────────────────────────────
#
#   DEPLOYING TO THE RETIRED BOX. `ssh gungalore` still answers, and deploying
#   there applies a replaced migration baseline over a live database. This only
#   ever talks to `alloutdoor`, and refuses if the branch or HEAD is not what
#   was just pushed.
#
#   STALE PRISMA TYPES. `nest build` type-checks against the OLD generated
#   client and pm2 then reloads the old dist. `prisma generate` always runs
#   first.
#
# Nothing is reloaded unless its build genuinely succeeded AND left a usable
# artefact. A refused deploy is not an outage — the old version keeps serving.
# ────────────────────────────────────────────────────────────────────
set -uo pipefail

HOST=alloutdoor
APP=/home/alloutdoor/app
BRANCH=feat/takealot-ux-parity
MODE=${1:-both}

say() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

# ── 0. local ────────────────────────────────────────────────────────
say "local checks"
[ -d backend ] && [ -d frontend ] || die "run this from the repo root"
git diff --quiet || die "uncommitted changes — commit or stash first"
LOCAL=$(git rev-parse HEAD)
echo "local HEAD: ${LOCAL:0:8}"
git push -q origin "$BRANCH" || die "push failed"
echo "pushed $BRANCH"

# ── 1. the right box, and a pull that will not be blocked ───────────
say "verifying the target"
REMOTE_BRANCH=$(ssh "$HOST" "cd $APP && git rev-parse --abbrev-ref HEAD")
[ "$REMOTE_BRANCH" = "$BRANCH" ] || die "box is on '$REMOTE_BRANCH', expected '$BRANCH'"
echo "box branch: $REMOTE_BRANCH"

# npm install rewrites package-lock.json on the box, which eventually blocks a
# fast-forward pull. Those edits are never wanted — the lockfile in the repo is
# the intended one — so they are discarded rather than left to fail a deploy at
# the worst moment.
ssh "$HOST" "cd $APP && git checkout -- package-lock.json backend/package-lock.json frontend/package-lock.json 2>/dev/null; true"
ssh "$HOST" "cd $APP && git pull --ff-only -q origin $BRANCH" || die "pull failed — check for local edits on the box"
REMOTE=$(ssh "$HOST" "cd $APP && git rev-parse HEAD")
[ "$REMOTE" = "$LOCAL" ] || die "box HEAD ${REMOTE:0:8} != local ${LOCAL:0:8}"
echo "box HEAD matches local: ${REMOTE:0:8}"

# ── 2. back up before touching the database ─────────────────────────
say "pre-deploy backup"
ssh "$HOST" "~/bin/backup.sh" \
  || echo "  WARNING: backup reported a problem — see /var/backups/alloutdoor/backup.log"
ssh "$HOST" "ls -t /var/backups/alloutdoor/db/*.dump | head -1 | xargs -n1 basename | sed 's/^/  latest dump: /'"

# ── 3. backend ──────────────────────────────────────────────────────
if [ "$MODE" != "--frontend-only" ]; then
  say "backend"
  ssh "$HOST" "cd $APP/backend && npm install --no-audit --no-fund >/dev/null 2>&1" \
    || die "npm install failed"
  ssh "$HOST" "cd $APP/backend && npx prisma migrate deploy 2>&1 | tail -3" \
    || die "prisma migrate deploy failed"
  # ALWAYS before the build: nest build type-checks against the generated
  # client, and a stale one lets pm2 reload the old dist with no visible error.
  ssh "$HOST" "cd $APP/backend && npx prisma generate >/dev/null 2>&1" \
    || die "prisma generate failed"

  echo "  building (this takes a minute)…"
  ssh "$HOST" "cd $APP/backend && npm run build" || die "backend build FAILED — nothing was reloaded, the old version is still serving"

  # A build can exit 0 and still leave nothing usable if the disk filled.
  ssh "$HOST" "test -s $APP/backend/dist/src/main.js" \
    || die "backend build exited 0 but dist/src/main.js is missing or empty"

  ssh "$HOST" "pm2 reload alloutdoor-backend --update-env >/dev/null 2>&1" || die "pm2 reload failed"
  sleep 10
  # TWICE: one 200 can be the old process still answering during a rolling reload.
  ssh "$HOST" "curl -sf http://localhost:3001/api/health >/dev/null" || die "backend unhealthy after reload"
  echo "  health 1: OK"
  sleep 4
  ssh "$HOST" "curl -sf http://localhost:3001/api/health >/dev/null" || die "backend unhealthy on second check"
  echo "  health 2: OK"
fi

# ── 4. frontend ─────────────────────────────────────────────────────
if [ "$MODE" != "--backend-only" ]; then
  say "frontend"
  ssh "$HOST" "cd $APP/frontend && npm install --no-audit --no-fund >/dev/null 2>&1" \
    || die "npm install failed"

  echo "  building (this takes a few minutes)…"
  ssh "$HOST" "cd $APP/frontend && npm run build" || die "frontend build FAILED — nothing was reloaded, the old version is still serving"

  # BUILD_ID, not .next — the directory exists throughout the build and proves
  # nothing. An empty BUILD_ID is exactly the state the site was reloaded into
  # on 2026-08-19.
  ssh "$HOST" "test -s $APP/frontend/.next/BUILD_ID" \
    || die "frontend build exited 0 but .next/BUILD_ID is missing or empty"

  ssh "$HOST" "pm2 reload alloutdoor-frontend --update-env >/dev/null 2>&1" || die "pm2 reload failed"
  sleep 12
  ssh "$HOST" "curl -sf http://localhost:3000 >/dev/null" || die "frontend unhealthy after reload"
  echo "  health 1: OK"
  sleep 4
  ssh "$HOST" "curl -sf http://localhost:3000 >/dev/null" || die "frontend unhealthy on second check"
  echo "  health 2: OK"
fi

# ── 5. from outside ─────────────────────────────────────────────────
say "public"
for i in 1 2; do
  code=$(curl -s -o /dev/null -w '%{http_code}' https://alloutdoor.co.za/)
  echo "  site: $code"
  [ "$code" = "200" ] || die "public site returned $code"
  sleep 3
done

say "deployed ${LOCAL:0:8}"
ssh "$HOST" "pm2 list --no-color | grep -E 'alloutdoor-(backend|frontend)'"
