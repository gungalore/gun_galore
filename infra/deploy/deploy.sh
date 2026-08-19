#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# Deploy to the live box, in one command, without the footguns.
#
# RUN FROM YOUR MACHINE:  bash infra/deploy/deploy.sh [--backend-only|--frontend-only]
#
# This exists because the same three mistakes kept getting made by hand, and one
# of them took the site down on 2026-08-19:
#
#   1. RELOADING BEFORE THE BUILD FINISHED. The polling loop used
#      `grep -c ... || echo 0`, which emits "0\n0" when there is no match, so it
#      broke on its first iteration and reloaded onto a half-written .next.
#      wait-for-build.sh now checks the process, the marker AND the artefact,
#      and has tests for each.
#
#   2. DEPLOYING TO THE RETIRED BOX. `ssh gungalore` still answers. Deploying
#      there applies a replaced migration baseline over a live database. This
#      script only ever talks to `alloutdoor`, and verifies the branch first.
#
#   3. STALE PRISMA TYPES. `nest build` type-checks against the OLD generated
#      client and pm2 then reloads the old dist. `prisma generate` always runs
#      before the build.
#
# It refuses to reload anything unless that service's build actually succeeded,
# and it curls TWICE afterwards, because one 200 can be the old process still
# serving.
# ────────────────────────────────────────────────────────────────────
set -uo pipefail

HOST=alloutdoor
APP=/home/alloutdoor/app
BRANCH=feat/takealot-ux-parity
MODE=${1:-both}
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

# ── 0. local sanity ─────────────────────────────────────────────────
say "local checks"
[ -d backend ] && [ -d frontend ] || die "run this from the repo root"
git diff --quiet || die "you have uncommitted changes — commit or stash first"
LOCAL=$(git rev-parse HEAD)
echo "local HEAD: ${LOCAL:0:8}"

git push -q origin "$BRANCH" || die "push failed"
echo "pushed $BRANCH"

# ── 1. the right box ────────────────────────────────────────────────
say "verifying the target"
REMOTE_BRANCH=$(ssh "$HOST" "cd $APP && git rev-parse --abbrev-ref HEAD")
[ "$REMOTE_BRANCH" = "$BRANCH" ] || die "box is on '$REMOTE_BRANCH', expected '$BRANCH'"
echo "box branch: $REMOTE_BRANCH"

ssh "$HOST" "cd $APP && git pull --ff-only -q origin $BRANCH" || die "pull failed"
REMOTE=$(ssh "$HOST" "cd $APP && git rev-parse HEAD")
[ "$REMOTE" = "$LOCAL" ] || die "box HEAD ${REMOTE:0:8} != local ${LOCAL:0:8}"
echo "box HEAD matches local: ${REMOTE:0:8}"

# ── 2. back up before touching the database ─────────────────────────
say "pre-deploy backup"
ssh "$HOST" "~/bin/backup.sh" || echo "  WARNING: backup reported a problem — check /var/backups/alloutdoor/backup.log"

# ── 3. backend ──────────────────────────────────────────────────────
if [ "$MODE" != "--frontend-only" ]; then
  say "backend"
  ssh "$HOST" "cd $APP/backend && npm install --no-audit --no-fund >/dev/null 2>&1 && npx prisma migrate deploy 2>&1 | tail -3 && npx prisma generate 2>&1 | grep -c Generated >/dev/null && echo '  prisma ready'" \
    || die "backend prisma step failed"

  LOG="/tmp/deploy-be-$STAMP.log"
  ssh "$HOST" "cd $APP/backend && nohup bash -c 'npm run build > $LOG 2>&1; echo BUILD_EXIT=\$? >> $LOG' >/dev/null 2>&1 & echo started"

  ssh "$HOST" "bash -s -- '$LOG' '$APP/backend/dist/src/main.js' 1800" < infra/deploy/wait-for-build.sh \
    || die "backend build not safe to reload — nothing was restarted, the old version is still serving"

  ssh "$HOST" "pm2 reload alloutdoor-backend --update-env >/dev/null 2>&1 && sleep 10 \
    && curl -sf http://localhost:3001/api/health >/dev/null && echo '  health 1: OK' \
    && sleep 4 && curl -sf http://localhost:3001/api/health >/dev/null && echo '  health 2: OK'" \
    || die "backend did not come back healthy — check pm2 logs alloutdoor-backend"
fi

# ── 4. frontend ─────────────────────────────────────────────────────
if [ "$MODE" != "--backend-only" ]; then
  say "frontend"
  ssh "$HOST" "cd $APP/frontend && npm install --no-audit --no-fund >/dev/null 2>&1 && echo '  deps ready'"

  LOG="/tmp/deploy-fe-$STAMP.log"
  ssh "$HOST" "cd $APP/frontend && nohup bash -c 'npm run build > $LOG 2>&1; echo BUILD_EXIT=\$? >> $LOG' >/dev/null 2>&1 & echo started"

  # .next/BUILD_ID, not .next — the directory exists throughout the build and
  # proves nothing. BUILD_ID is written at the end, and an EMPTY one is the
  # exact state the site was reloaded into.
  ssh "$HOST" "bash -s -- '$LOG' '$APP/frontend/.next/BUILD_ID' 1800" < infra/deploy/wait-for-build.sh \
    || die "frontend build not safe to reload — nothing was restarted, the old version is still serving"

  ssh "$HOST" "pm2 reload alloutdoor-frontend --update-env >/dev/null 2>&1 && sleep 12 \
    && curl -sf http://localhost:3000 >/dev/null && echo '  health 1: OK' \
    && sleep 4 && curl -sf http://localhost:3000 >/dev/null && echo '  health 2: OK'" \
    || die "frontend did not come back healthy — check pm2 logs alloutdoor-frontend"
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
