# Restoring All Outdoor

Two things are backed up nightly at 02:10 SAST by `~/bin/backup.sh`, and you
need BOTH. A database restore on its own leaves upload rows whose bytes are
gone, and nothing in the application will tell you — the annexure simply will
not open.

```
/var/backups/alloutdoor/db/       alloutdoor-YYYYMMDD-HHMMSS.dump
/var/backups/alloutdoor/uploads/  secure-uploads-YYYYMMDD-HHMMSS.tar.gz
/var/backups/alloutdoor/backup.log
```

14 days are kept. Every file is 0600 — a dump is the whole database, including
encrypted SA ID numbers and everyone's address.

## ⚠️ The upload archive is USELESS without ID_HASH_SECRET

Every file in it is AES-256-GCM encrypted with a key derived from
`ID_HASH_SECRET` in `backend/.env`. That value is deliberately NOT stored in the
backup — keeping the key beside the ciphertext would defeat encrypting at rest.

- Keep `ID_HASH_SECRET` in the password manager.
- **Rotating it destroys every stored file, in every backup, permanently.**
  Nothing can recover them. The same secret also keys the encrypted SA ID
  numbers on `User`, so rotating it is not a routine action.

## Restore the database

```bash
sudo -u postgres createdb alloutdoor_restore
pg_restore --dbname=alloutdoor_restore --no-owner --clean --if-exists \
  /var/backups/alloutdoor/db/alloutdoor-YYYYMMDD-HHMMSS.dump
```

Restore into a NEW database first and look at it. Pointing `--clean` at the live
one is how a restore turns a bad day into a worse one.

## Restore the uploads

```bash
tar -xzf /var/backups/alloutdoor/uploads/secure-uploads-YYYYMMDD-HHMMSS.tar.gz \
  -C /var/lib/alloutdoor/
chown -R alloutdoor:alloutdoor /var/lib/alloutdoor/secure-uploads
chmod 700 /var/lib/alloutdoor/secure-uploads
```

The path matters. `SECURE_UPLOAD_DIR` in `backend/.env` must point at wherever
they land, or the app looks in the wrong place and `read()` simply ENOENTs —
which is not an error anyone notices until a document will not open.

## Check it ran

```bash
tail -20 /var/backups/alloutdoor/backup.log
ls -lh /var/backups/alloutdoor/db/ | tail -3
```

The script exits non-zero and logs `FINISHED WITH ERRORS` on failure. It also
runs `pg_restore --list` over each dump it takes, because a truncated dump is
the failure that looks exactly like a healthy one.

## ⚠️ These copies are on the same disk as the originals

They protect against a bad migration, a wrong `DELETE`, or a botched deploy.
They do **not** protect against losing the disk or the machine. Off-box copies
— Vultr snapshots, or an `rsync`/`rclone` to somewhere else — are a separate
job and are not set up here.
