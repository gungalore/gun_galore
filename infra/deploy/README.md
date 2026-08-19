# Deploying

```bash
bash infra/deploy/deploy.sh                 # both services
bash infra/deploy/deploy.sh --backend-only
bash infra/deploy/deploy.sh --frontend-only
```

## Why this is a script and not a list of steps

Three mistakes kept getting made by hand. One took the site down on 2026-08-19.

**1. Reloading before the build finished.** The loop was:

```bash
D=$(grep -c 'BUILD_EXIT=' "$LOG" 2>/dev/null || echo 0)
[ "$D" != "0" ] && break
```

`grep -c` **prints `0` and exits `1`** on no match, so `|| echo 0` fires too and
`D` becomes `"0
0"` — not `"0"`. It broke on its **first iteration**, every
time, and reloaded pm2 onto a half-written `.next`.

The first fix replaced it with a properly-tested waiter. That waiter was
correct and still wrong, because **the premise was wrong**: measured on this
box, `ssh host "cmd &"` returns only *after* the backgrounded job finishes — 13
seconds for a 12-second sleep, and no better with `setsid`, because ssh holds
the session until its descendants release the channel. So the poller never had
anything to wait for; every "safe to reload" it printed said `0s`. The deploy
was safe **by accident**.

**ssh already waits.** So the builds now run in the foreground and their exit
codes are read directly — no marker file, no parsing, no polling, nothing to
misread. The whole apparatus existed to work around a tool-call timeout on the
operator's side and bought a failure mode for nothing.

A full run therefore takes as long as the builds do, around four minutes. That
is correct behaviour for a deploy.

**A build can still exit 0 and leave nothing usable** if the disk filled, so the
artefact is checked too — `.next/BUILD_ID` for the frontend, never `.next`,
because the directory exists throughout the build and an *empty* BUILD_ID is
exactly the state the site was reloaded into.

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
