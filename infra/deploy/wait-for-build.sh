#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# Wait for a detached build to ACTUALLY finish, then say whether it worked.
#
# WHY THIS EXISTS. On 2026-08-19 a deploy reloaded pm2 while `next build` was
# still writing `.next`, the process found a half-written build directory, and
# the frontend was down for two minutes. The cause was not a race — the polling
# loop never waited at all:
#
#     D=$(grep -c 'BUILD_EXIT=' "$LOG" 2>/dev/null || echo 0)
#     [ "$D" != "0" ] && break
#
# `grep -c` PRINTS "0" and EXITS 1 when there is no match, so `|| echo 0` fires
# as well and D becomes "0\n0" — which is not equal to "0", so the loop broke on
# its first iteration and went straight to the reload. It had looked correct in
# two earlier deploys purely because those builds finished inside the first
# sleep.
#
# So this checks THREE independent things, because any one of them alone has a
# way of lying:
#
#   1. THE PROCESS IS GONE      — pgrep. A marker can be stale from an earlier
#                                 run; a running build cannot be argued with.
#   2. THE MARKER SAYS 0        — read with a method that cannot emit a stray
#                                 second line, and compared to the exact string.
#   3. THE ARTEFACT IS THERE    — .next/BUILD_ID or dist/src/main.js. A build can
#                                 exit 0 and still leave nothing usable if the
#                                 disk filled.
#
# Usage:
#   wait-for-build.sh <log-file> <artefact-path> [timeout-seconds]
#
# Exit 0 = safe to reload. Anything else = DO NOT RELOAD.
# ────────────────────────────────────────────────────────────────────
set -uo pipefail

LOG=${1:?usage: wait-for-build.sh <log> <artefact> [timeout]}
ARTEFACT=${2:?usage: wait-for-build.sh <log> <artefact> [timeout]}
TIMEOUT=${3:-1800}
POLL=10

started=$(date +%s)

# Read the marker WITHOUT the grep -c trap: `grep -m1` prints the line or
# nothing, and command substitution strips the trailing newline. No fallback
# echo, so there is no way to emit a second line.
marker() { grep -m1 -o 'BUILD_EXIT=[0-9]\+' "$LOG" 2>/dev/null; }

building() {
  pgrep -f 'next build|nest build|tsc -p' > /dev/null 2>&1
}

while :; do
  elapsed=$(( $(date +%s) - started ))
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "TIMEOUT after ${elapsed}s — build did not finish. NOT safe to reload."
    exit 2
  fi

  m=$(marker)
  if [ -n "$m" ] && ! building; then
    break
  fi
  sleep "$POLL"
done

code=${m#BUILD_EXIT=}
if [ "$code" != "0" ]; then
  echo "BUILD FAILED (exit ${code}). NOT safe to reload."
  # The last few lines are usually the actual error.
  tail -20 "$LOG" 2>/dev/null | sed 's/^/  /'
  exit 1
fi

if [ ! -e "$ARTEFACT" ]; then
  echo "Build reported success but ${ARTEFACT} is missing. NOT safe to reload."
  exit 3
fi

# A Next.js build directory with no BUILD_ID is the exact state that took the
# site down: present, non-empty, and unusable.
case "$ARTEFACT" in
  *.next/BUILD_ID)
    if [ ! -s "$ARTEFACT" ]; then
      echo "BUILD_ID is empty — the build directory is incomplete. NOT safe to reload."
      exit 3
    fi
    ;;
esac

echo "build OK in ${elapsed}s, artefact present — safe to reload"
exit 0
