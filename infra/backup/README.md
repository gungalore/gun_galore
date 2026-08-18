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
- Failures now reach `/admin/alerts` (see below), but **nothing pages anyone**.
  Somebody still has to look at the inbox.

## How a failure is noticed

Two mechanisms, because they fail in different circumstances and neither covers
both:

| What went wrong | What you see |
|---|---|
| Ran and failed | A `BACKUP_FAILED` row in **/admin/alerts**, urgent |
| Never ran at all | The **box-backup** row on `/admin/health` goes stale |

The alert is written with `psql` rather than through the API, so it still works
when the Node app is the thing that is down. It cannot fire when POSTGRES is
down — the insert needs the database — and that is exactly the case the stale
heartbeat catches. That is why both exist.

The heartbeat is stamped **only on success**, so a failed run leaves the health
row ageing rather than looking healthy.

**One alert, not thirty.** A broken backup is usually broken every night, and an
inbox with thirty identical rows is an inbox nobody reads. The insert is
conditional on there being no unresolved `BACKUP_FAILED` already; the first
failure raises it, the rest are silent, and the next successful run resolves it.
The log still records every run.

### Verified on the box, 2026-08-19

Not reasoned about — actually exercised:

- forced failure → alert raised, `urgent=true`
- forced failure again → still **one** unresolved row, not two
- successful run → alert resolved, heartbeat advanced
- failed run → heartbeat **not** advanced

That testing found a real bug. Every command appends stderr to the log, and
**bash does not run a command whose redirection fails** — so an unwritable log
did not merely lose the log, it stopped the `psql` calls that raise the alert,
and the run failed in total silence. The log path now falls back to `/tmp`, and
to `/dev/null` if even that is unwritable.
