# Backups

Installed on the live box 2026-08-19. **This box had no backup of anything
before that** — no user crontab, no root crontab, no timer, no dumps. Not the
database either. The only artefact on disk was one manual `pg_dump` from
12 August, left world-readable.

## What runs

`backup.sh` → `~/bin/backup.sh` on the box, nightly at **02:10 SAST** via the
`alloutdoor` user's crontab.

02:10 is deliberately **before** the application's own retention purge at 02:40,
so the freshest copy always predates the job that deletes things. If that job is
ever wrong, last night's backup is from before it ran.

## Why it covers two things

As of the motivation writer, **a `pg_dump` is no longer a complete backup.**
Identity documents, licence scans and safe photographs live on disk under
`SECURE_UPLOAD_DIR`, not in Postgres. Restoring the database alone leaves upload
rows whose bytes are gone, and nothing in the application would say so — the
annexure simply would not open.

## Deploying a change to it

```bash
scp infra/backup/backup.sh alloutdoor:/tmp/backup.sh
ssh alloutdoor "tr -d '\r' < /tmp/backup.sh > ~/bin/backup.sh && chmod 700 ~/bin/backup.sh && rm /tmp/backup.sh && bash -n ~/bin/backup.sh && echo OK"
```

`tr -d '\r'` is not optional — this repo is checked out on Windows and bash
fails on a script with CRLF line endings in a way that reads as nonsense.

## Known limits, stated plainly

- **Same disk as the originals.** Protects against a bad migration, a wrong
  `DELETE` or a botched deploy. Does NOT protect against losing the disk or the
  machine. Off-box copies are a separate job and are not set up.
- **The upload archive is worthless without `ID_HASH_SECRET`.** See `RESTORE.md`.
- **Nothing alerts on failure.** The script exits non-zero and writes
  `FINISHED WITH ERRORS` to `/var/backups/alloutdoor/backup.log`, but no one is
  watching that file. Wiring it to the existing `/admin/alerts` inbox would be
  the obvious next step.
