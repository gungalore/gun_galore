# Deploying

```bash
bash infra/deploy/deploy.sh                 # both services
bash infra/deploy/deploy.sh --backend-only
bash infra/deploy/deploy.sh --frontend-only
```

## Why this is a script and not a list of steps

The same three mistakes kept getting made by hand, and one of them took the site
down on 2026-08-19.

**1. Reloading before the build finished.** The polling loop was:

```bash
D=$(grep -c 'BUILD_EXIT=' "$LOG" 2>/dev/null || echo 0)
[ "$D" != "0" ] && break
```

`grep -c` **prints `0` and exits `1`** when there is no match, so `|| echo 0`
fires as well and `D` becomes `"0\n0"` — which is not `"0"`. The loop broke on
its **first iteration**, every time, and reloaded pm2 onto a half-written
`.next`. It had looked fine in two earlier deploys only because those builds
finished inside the first `sleep`.

`wait-for-build.sh` replaces it and checks **three** independent things, because
each one alone can lie:

| check | why it is not enough on its own |
|---|---|
| the build process is gone (`pgrep`) | a marker can be stale from an earlier run |
| the marker says `BUILD_EXIT=0` | a build can still be running when an old marker exists |
| the artefact exists and is non-empty | a build can exit 0 and leave nothing usable if the disk filled |

`.next/BUILD_ID` is the artefact for the frontend, not `.next` — the directory
exists throughout the build and proves nothing, and an **empty** BUILD_ID is the
exact state the site was reloaded into.

`wait-for-build.test.sh` covers all of it, including the original bug. Run it
after any change:

```bash
bash infra/deploy/wait-for-build.test.sh
```

**2. Deploying to the retired box.** `ssh gungalore` still answers, and
deploying there applies a replaced migration baseline over a live database. The
script only ever talks to `alloutdoor`, and refuses if the box is not on
`feat/takealot-ux-parity` or if its HEAD does not match what was just pushed.

**3. Stale Prisma types.** `nest build` type-checks against the OLD generated
client and pm2 then reloads the old `dist/`. `prisma generate` always runs
before the build.

## What it refuses to do

- Deploy with uncommitted local changes.
- Reload a service whose build did not finish, or finished non-zero, or left no
  artefact. **The old version keeps serving, so a refused deploy is not an
  outage.**
- Continue past a failed health check.

It curls **twice** after each reload, because one 200 can be the old process
still answering, and twice more against the public URL at the end.

It also takes a backup before touching the database.
