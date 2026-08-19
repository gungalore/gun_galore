#!/usr/bin/env bash
# Tests for wait-for-build.sh.
#
# The whole point of the script is that it refuses to say "safe to reload" when
# it is not, so every case here is a way the old loop said yes and should not
# have. Case 1 is the exact bug that took the site down on 2026-08-19.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
WAIT="$HERE/wait-for-build.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
check() { # name expected-exit actual-exit
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
    pass=$((pass + 1))
  else
    echo "  FAIL $1 (expected exit $2, got $3)"
    fail=$((fail + 1))
  fi
}

# ── 1. NO MARKER YET — the one that took the site down ──────────────
# The old loop broke immediately here and reloaded onto a half-written build.
: > "$TMP/empty.log"
touch "$TMP/artefact"
timeout 25 "$WAIT" "$TMP/empty.log" "$TMP/artefact" 12 > "$TMP/out1" 2>&1
check "waits when the build has not finished (does not say safe)" 2 $?
grep -q TIMEOUT "$TMP/out1" && echo "       (timed out rather than proceeding)"

# ── 2. finished, exit 0, artefact present ───────────────────────────
printf 'building...\nBUILD_EXIT=0\n' > "$TMP/ok.log"
"$WAIT" "$TMP/ok.log" "$TMP/artefact" 30 > /dev/null 2>&1
check "says safe when the build genuinely succeeded" 0 $?

# ── 3. finished, NON-ZERO exit ──────────────────────────────────────
printf 'error TS1005\nBUILD_EXIT=1\n' > "$TMP/bad.log"
"$WAIT" "$TMP/bad.log" "$TMP/artefact" 30 > /dev/null 2>&1
check "refuses when the build failed" 1 $?

# ── 4. exit 0 but the artefact never appeared ───────────────────────
printf 'BUILD_EXIT=0\n' > "$TMP/noart.log"
"$WAIT" "$TMP/noart.log" "$TMP/does-not-exist" 30 > /dev/null 2>&1
check "refuses when the artefact is missing despite exit 0" 3 $?

# ── 5. Next.js with an EMPTY BUILD_ID ───────────────────────────────
# Present, non-empty directory, unusable build — exactly the state the frontend
# was reloaded into.
mkdir -p "$TMP/.next"
: > "$TMP/.next/BUILD_ID"
printf 'BUILD_EXIT=0\n' > "$TMP/next.log"
"$WAIT" "$TMP/next.log" "$TMP/.next/BUILD_ID" 30 > /dev/null 2>&1
check "refuses an empty BUILD_ID" 3 $?

echo "ZZBUILDIDZZ" > "$TMP/.next/BUILD_ID"
"$WAIT" "$TMP/next.log" "$TMP/.next/BUILD_ID" 30 > /dev/null 2>&1
check "accepts a populated BUILD_ID" 0 $?

# ── 6. the marker arrives while we are waiting ──────────────────────
: > "$TMP/late.log"
( sleep 3; printf 'BUILD_EXIT=0\n' >> "$TMP/late.log" ) &
"$WAIT" "$TMP/late.log" "$TMP/artefact" 40 > /dev/null 2>&1
check "picks the marker up when it arrives mid-wait" 0 $?
wait

echo
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
