#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# Nightly backup for alloutdoor: the database AND the encrypted file tree.
#
# BOTH, because as of the motivation writer a pg_dump is NO LONGER A COMPLETE
# BACKUP. Identity documents, licence scans and safe photographs live on this
# disk under SECURE_UPLOAD_DIR, not in Postgres — restoring the database alone
# leaves upload rows whose bytes are gone, and nothing in the application would
# tell you until someone opened an annexure.
#
# ⚠️ A RESTORE NEEDS ID_HASH_SECRET. The files are AES-256-GCM encrypted with a
# key derived from it. Without that value the archive is noise, and no amount of
# it can be recovered. The secret is NOT stored here on purpose — keeping it
# beside the ciphertext would defeat encrypting at rest. Keep it in the password
# manager, and know that rotating it makes every existing file unreadable.
#
# ⚠️ THESE COPIES ARE ON THE SAME DISK AS THE ORIGINALS. That protects against
# a bad migration, a wrong DELETE or a botched deploy. It does NOT protect
# against losing the disk or the machine. Off-box copies are a separate job.
#
# ── HOW A FAILURE IS NOTICED ────────────────────────────────────────
#
# TWO mechanisms, because they fail in different circumstances and neither one
# covers both:
#
#   RAN AND FAILED   -> an AdminAlert row, straight into the same inbox at
#                       /admin/alerts that KYC reviews and payout problems use.
#                       Written with psql rather than through the API, so it
#                       still works when the Node app is the thing that is down.
#
#   NEVER RAN AT ALL -> the cron:lastrun heartbeat, which is only stamped on
#                       SUCCESS. /admin/health already watches those and goes
#                       red when one goes stale, so a cron that was removed, a
#                       box that was off, or a script that died before reaching
#                       the end all show up without any new machinery.
#
# The alert path deliberately does NOT fire when the database is unreachable —
# it cannot, the INSERT needs the database. That case is exactly what the stale
# heartbeat catches, which is why both exist.
#
# The password never appears in argv — pg_dump would otherwise show it in `ps`
# to anyone on the box. It goes via PGPASSWORD and discrete arguments, which is
# also why the URL is parsed rather than handed over whole: it carries
# "?schema=public", which pg_dump does not understand.
# ────────────────────────────────────────────────────────────────────
set -uo pipefail

APP_DIR=/home/alloutdoor/app/backend
DEST=/var/backups/alloutdoor
KEEP_DAYS=14
STAMP=$(date +%Y%m%d-%H%M%S)
LOG=$DEST/backup.log

mkdir -p "$DEST/db" "$DEST/uploads" 2>/dev/null
chmod 700 "$DEST" "$DEST/db" "$DEST/uploads" 2>/dev/null

# IF THE LOG IS UNWRITABLE, FALL BACK — do not just carry on.
#
# Every command here appends its stderr to $LOG, and bash does NOT run a command
# whose redirection fails. So an unwritable log does not merely lose the log: it
# stops the psql calls that raise the alert, and the run fails in total silence.
# Found by forcing a failure and watching no alert arrive.
if ! ( : >> "$LOG" ) 2>/dev/null; then
  LOG=/tmp/alloutdoor-backup.log
  : >> "$LOG" 2>/dev/null || LOG=/dev/null
fi

say() { printf '%s  %s\n' "$(date -Is)" "$*" >> "$LOG"; }
fail=0

# Run one statement as the app's database user. Password via PGPASSWORD only —
# never on the command line, where `ps` would show it to anyone on the box.
psql_do() {
  PGPASSWORD="$PGPASSWORD" psql \
    --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
    --quiet --no-align --tuples-only --set ON_ERROR_STOP=1 \
    --command="$1" 2>>"$LOG"
}

# Raise an alert in /admin/alerts — but only ONE.
#
# A backup that is broken is usually broken every night, and an inbox with
# thirty identical rows in it is an inbox nobody reads. The insert is
# conditional on there being no unresolved BACKUP_FAILED already, so the first
# failure raises it and the rest are silent until somebody resolves it. The log
# still records every run.
alert() {
  local detail
  detail=$(printf '%s' "$1" | sed "s/'/''/g")
  psql_do "INSERT INTO \"AdminAlert\" (id, type, context, urgent, resolved, \"createdAt\")
           SELECT 'bkp' || md5(random()::text || clock_timestamp()::text),
                  'BACKUP_FAILED',
                  '${detail}',
                  true, false, now()
           WHERE NOT EXISTS (
             SELECT 1 FROM \"AdminAlert\"
             WHERE type = 'BACKUP_FAILED' AND resolved = false
           );" > /dev/null && say "alert raised (or already open): BACKUP_FAILED"
}

# Stamp the heartbeat /admin/health reads. ONLY on success — the whole point is
# that it goes stale when backups stop working.
heartbeat() {
  psql_do "INSERT INTO \"Setting\" (key, value, \"updatedAt\")
           VALUES ('cron:lastrun:box-backup', now()::text, now())
           ON CONFLICT (key) DO UPDATE
             SET value = now()::text, \"updatedAt\" = now();" > /dev/null
}

# Clear a previously-raised alert once a run succeeds, so the inbox reflects
# reality rather than history.
clear_alert() {
  psql_do "UPDATE \"AdminAlert\"
           SET resolved = true, \"resolvedAt\" = now()
           WHERE type = 'BACKUP_FAILED' AND resolved = false;" > /dev/null
}

say "=== backup start ==="

# ── the database ───────────────────────────────────────────────────
eval "$(
  python3 - "$APP_DIR/.env" <<'PY'
import sys, urllib.parse as up, shlex
url = ''
for line in open(sys.argv[1]):
    if line.startswith('DATABASE_URL='):
        url = line.split('=', 1)[1].strip().strip('"').strip("'")
        break
u = up.urlparse(url)
def out(k, v):
    print(f'{k}={shlex.quote(str(v or ""))}')
out('PGHOST', u.hostname or '127.0.0.1')
out('PGPORT', u.port or 5432)
out('PGUSER', u.username or '')
out('PGDATABASE', u.path.lstrip('/'))
out('PGPASSWORD', u.password or '')
PY
)"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

DB_FILE="$DEST/db/alloutdoor-$STAMP.dump"
if pg_dump --format=custom --compress=9 --file="$DB_FILE" 2>>"$LOG"; then
  chmod 600 "$DB_FILE"
  # A dump that cannot be listed is not a backup. Cheap, and it catches a
  # truncated or half-written file, which is the failure that looks fine.
  if pg_restore --list "$DB_FILE" > /dev/null 2>>"$LOG"; then
    say "database OK: $(du -h "$DB_FILE" | cut -f1) $DB_FILE"
  else
    say "DATABASE DUMP IS UNREADABLE: $DB_FILE"
    fail=1
  fi
else
  say "DATABASE DUMP FAILED"
  fail=1
fi

# ── the encrypted file tree ────────────────────────────────────────
UPLOAD_DIR=$(grep -E '^SECURE_UPLOAD_DIR=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"')
UPLOAD_DIR=${UPLOAD_DIR:-/home/alloutdoor/secure-uploads}

if [ -d "$UPLOAD_DIR" ]; then
  UP_FILE="$DEST/uploads/secure-uploads-$STAMP.tar.gz"
  # Already AES-encrypted per file, so the tar adds packaging, not protection.
  if tar -czf "$UP_FILE" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")" 2>>"$LOG"; then
    chmod 600 "$UP_FILE"
    n=$(find "$UPLOAD_DIR" -type f -name '*.enc' | wc -l)
    say "uploads OK: $n encrypted file(s), $(du -h "$UP_FILE" | cut -f1) $UP_FILE"
  else
    say "UPLOAD ARCHIVE FAILED"
    fail=1
  fi
else
  # Not an error yet — the writer is flag-off, so nothing has been stored.
  say "uploads: $UPLOAD_DIR does not exist yet (nothing stored)"
fi

# ── retention ──────────────────────────────────────────────────────
find "$DEST/db" -name '*.dump' -mtime +$KEEP_DAYS -delete 2>>"$LOG"
find "$DEST/uploads" -name '*.tar.gz' -mtime +$KEEP_DAYS -delete 2>>"$LOG"

if [ "$fail" -ne 0 ]; then
  say "=== backup FINISHED WITH ERRORS ==="
  # Deliberately AFTER the log line: if raising the alert is itself what breaks,
  # the log still says the backup failed.
  alert "Nightly backup FAILED on $(hostname). See /var/backups/alloutdoor/backup.log. The database and the encrypted upload tree may both be affected — check before relying on last night's copy."
  # No heartbeat. A failed run must leave the health row going stale rather than
  # look like a healthy one.
  unset PGPASSWORD
  exit 1
fi

heartbeat
clear_alert
# Held until here on purpose: the alert, heartbeat and clear steps all need it,
# and an earlier unset silently gave them a password-less psql.
unset PGPASSWORD
say "=== backup ok ==="
