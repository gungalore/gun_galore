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

mkdir -p "$DEST/db" "$DEST/uploads"
chmod 700 "$DEST" "$DEST/db" "$DEST/uploads"

say() { printf '%s  %s\n' "$(date -Is)" "$*" >> "$LOG"; }
fail=0

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
unset PGPASSWORD

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
  exit 1
fi
say "=== backup ok ==="
