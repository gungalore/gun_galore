# Warden

The daemon that runs **on** the production box, watches the site, says
exactly what is wrong, and — only with the operator's approval, or through
its own narrow safe list — fixes it.

It is a standalone Node service. It is **not** part of the Nest backend and
does not import from it. It runs under pm2, on the same box, next to the API
and the frontend. `backend/src/desk/warden.controller.ts` +
`warden.service.ts` are an authenticated proxy from the admin Desk to this
daemon — read `backend/src/desk/warden.types.ts` if you are touching the wire
contract, it is the source of truth and `warden.spec.ts` asserts it.

## What it does, in one paragraph

A background loop measures the box (disk, TLS, nginx, pm2, the database,
backups, env presence, cron freshness, outbound channels, app-level state —
see `src/checks/`) on a schedule, feeds those facts to Claude as **fenced
data that is never an instruction** (`src/diagnose/`), and turns what comes
back into either a **proposal** (a runnable fix, always shown as the exact
command a human is about to approve) or a **red gate** (a fault with no
command at all — it needs a commit, a credential, or a human decision). An
operator reads the thread in the Desk, approves or declines, and only then
does anything run — either through the six-operation **safe list**
(`src/exec/safe-list.ts`) or as the literal string the operator read
(`src/exec/executor.ts`). Every run writes an audit record with the exact
command and the verbatim, redacted output.

## Running it on the box

```bash
cd /home/alloutdoor/app/warden      # or wherever this checkout lives
npm ci
npm run build                        # compiles src/ -> dist/
```

Before trusting it, run the smoke test. It runs every check once against the
**real** box, calls no model, runs no fix, and just prints the board — this
is the fastest way to find out that a path default in `src/checks/context.ts`
doesn't match this particular box (the repo disagrees with itself in three
places on pm2 process names, the app root, and nginx's paths; see
`src/checks/context.ts`'s own header):

```bash
npm run sweep
```

Read every `—` row (unknown) it prints — each one carries the exact reason,
usually a missing permission or a path that isn't there. Fix what you can
before going further; the rest is fine to leave as an honest unknown.

Create `warden/.env` (mode `600`, next to `package.json`, never committed —
it is in `.gitignore`) with at least:

```
WARDEN_TOKEN=<same long random value as the backend's WARDEN_TOKEN>
ANTHROPIC_API_KEY=<a real key, or omit it — see "Running with no model" below>
DATABASE_URL=<same value the backend uses>
```

See **Environment variables** below for the full list. Warden loads this
file itself on boot (`src/index.ts`'s `loadDotEnvFile()` — the same job
`backend/src/main.ts`'s `dotenv.config()` does for the API) and never
overrides a value already present in the real environment, so a value set by
pm2, the shell, or a secrets manager always wins over the file.

Then:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

`ecosystem.config.cjs` in this directory defines the `warden` pm2 process —
(**.cjs**, because `package.json` sets `"type": "module"` and pm2 config is
CommonJS — as `.js` it dies on load with "module is not defined in ES module
scope") 
see its own header for the details (log paths, memory ceiling, restart
bounds). It is separate from `infra/pm2/ecosystem.config.js`, which defines
the two marketplace processes; adding Warden never touches that file.

Routine restarts after a code change:

```bash
npm run build
pm2 reload warden --update-env
```

### Point the backend at it

On the API side (`backend/.env`), set:

```
WARDEN_BASE_URL=http://127.0.0.1:8787
WARDEN_TOKEN=<the same value you put in warden/.env>
```

If either is unset the backend never calls out at all — that's its own
fail-closed behaviour, not something this daemon needs to handle. Warden
binds to `127.0.0.1` by default (see `WARDEN_HOST`); it is not meant to be
reachable from outside the box.

## What it serves

Exactly five routes — the ones the backend actually proxies to
(`warden.service.ts` never calls out for gates or settings; those are
answered entirely inside Nest). Every route, without exception, requires
`Authorization: Bearer <WARDEN_TOKEN>` — there is no unauthenticated
liveness ping.

| Route | Budget (caller-side) | What it does |
|---|---|---|
| `GET /chat` | 8s | The thread, open proposals, `lastCheckAt` — from memory, never a live sweep |
| `POST /chat` | 25s | `{message, operatorId}` → the messages this exchange added |
| `GET /proposals/:id` | 8s | One proposal, fresh from the store (this is what the backend's compare-and-swap reads) |
| `POST /proposals/:id/approve` | 25s | `{operatorId, expectedCommand}` → starts the run, answers immediately |
| `POST /proposals/:id/decline` | 25s | `{operatorId, reason?}` → records the reason as a standing instruction |

A sixth route, `GET /gates`, exists for a curl on the box and a post-deploy
smoke test — the board as JSON, no thread. Nothing in the app depends on it;
see the note at the top of `src/server.ts`.

No route ever does a live sweep inline — GET requests read the last
completed sweep from memory, and a sweep runs on its own background timer
(`WARDEN_SWEEP_INTERVAL_MS`, default 60s). No request may take nginx's 60s
or Cloudflare's 100s down with it.

A quick check from the box itself:

```bash
curl -s -H "Authorization: Bearer $WARDEN_TOKEN" http://127.0.0.1:8787/gates | jq .
```

## Environment variables

Everything is optional except `WARDEN_TOKEN`. Fail-closed:

| Variable | Required | What it does |
|---|---|---|
| `WARDEN_TOKEN` | **yes** | Bearer auth for every route. Must be ≥24 characters or the daemon refuses to start. |
| `ANTHROPIC_API_KEY` | no | Without it the checks still run and the board is still measured, but nothing turns a fault into a proposal — Warden raises a red gate saying so instead of answering with silence. |
| `DATABASE_URL` | no | Same value the backend uses. Without it every `db-*` check reports `unknown` with that reason, never a plausible zero. |

Everything else has a coded default, documented at its own definition
(`src/checks/context.ts`'s `loadConfig()`, `src/exec/safe-list.ts`, and
`src/diagnose/client.ts`):

| Variable | Default | Purpose |
|---|---|---|
| `WARDEN_HOST` | `127.0.0.1` | Bind address |
| `WARDEN_PORT` | `8787` | Bind port |
| `WARDEN_STATE_PATH` | `<appRoot>/warden-state/state.json` | Durable thread/proposals/audit store |
| `WARDEN_SWEEP_INTERVAL_MS` | `60000` | How often the background loop wakes (each check still declares its own cadence) |
| `WARDEN_DIAGNOSE_MIN_INTERVAL_MS` | `1800000` | Minimum gap between model calls when the fault set hasn't changed |
| `WARDEN_CHAT_BUDGET_MS` | `18000` | `POST /chat`'s own ceiling, inside the backend's 25s |
| `WARDEN_MODEL_TIMEOUT_MS` | `20000` | Per-call timeout to Anthropic |
| `ANTHROPIC_MODEL_WARDEN` | falls back to `ANTHROPIC_MODEL_JUDGE`, then `claude-sonnet-4-6` | Model choice — never pinned in code as if it were a contract |
| `WARDEN_APP_ROOT` | `/home/alloutdoor/app` | The live box's checkout root — this is the one the repo itself disagrees about; see `context.ts`'s header |
| `WARDEN_REPO_ROOT` | same as `WARDEN_APP_ROOT` | Separate only for a dev running Warden against a different copy |
| `WARDEN_BACKEND_ENV_PATH` | `<repoRoot>/backend/.env` | Read (never executed) for the env-presence and cron-freshness checks |
| `WARDEN_FRONTEND_ENV_PATH` | `<repoRoot>/frontend/.env.production` | Same, frontend side |
| `WARDEN_NGINX_REPO_CONF` | `<repoRoot>/infra/nginx/alloutdoor.conf` | The repo's copy, diffed against the live config every sweep |
| `WARDEN_NGINX_SITES_DIR` | `/etc/nginx/sites-enabled` | Fallback when `nginx -T` needs root Warden doesn't have |
| `WARDEN_NGINX_ACCESS_LOG` / `WARDEN_NGINX_ERROR_LOG` | `/var/log/nginx/{access,error}.log` | Stock Ubuntu defaults — the committed nginx config sets neither explicitly |
| `WARDEN_BACKUP_SCRIPT` | `<repoRoot>/infra/backup/backup.sh` | Read to confirm it covers `CIP_SHEETS_DIR` (it doesn't — see Backups below), and run verbatim by the `rerunBackup` safe-list op |
| `WARDEN_BACKUP_DIR` | `/var/backups/alloutdoor` | Where backup artifacts are checked |
| `SECURE_UPLOAD_DIR` | `/home/alloutdoor/secure-uploads` | Same variable name and default the backend itself uses — deliberate, so the two never quietly disagree |
| `CIP_SHEETS_DIR` | `/home/alloutdoor/data/cip` | Same — this is the directory the nightly backup does **not** cover |
| `WARDEN_MIGRATIONS_DIR` | `<repoRoot>/backend/prisma/migrations` | Diffed against `_prisma_migrations` for drift |
| `WARDEN_PUBLIC_HOST` | `alloutdoor.co.za` | TLS edge-cert check target |
| `WARDEN_API_BASE_URL` | `http://127.0.0.1:3001/api` | Loopback call to the backend's own `/health/crons` |
| `WARDEN_PM2_PROCESSES` | `alloutdoor-backend,alloutdoor-frontend` | Comma-separated — override if the box's real pm2 names differ |
| `WARDEN_HISTORY_PATH` | `<appRoot>/warden-state/history.json` | Point-in-time readings (disk, DB size) for growth-rate checks |
| `WARDEN_ENV_FILE` | `<cwd>/.env` | Where `warden/.env` is loaded from — override if you keep it elsewhere |

Two more, read directly by `src/exec/safe-list.ts` and shared with the app's
own config rather than Warden-specific: none beyond `WARDEN_APP_ROOT` above,
which the safe list also reads for its log and archive paths.

**Running with no model.** Leaving `ANTHROPIC_API_KEY` unset is a supported
configuration, not a degraded one to work around. The checks still run on
schedule and the board is still real; Warden just cannot turn a fault into a
proposal, and says exactly that in the thread (a stable red gate, not a
silently empty board — "healthy" and "nobody looked" must never render the
same).

## Permissions the box needs

Three things Warden's service user does not have by default, each of which
shows up as a specific, honest `unknown` (never a silent zero) until
provisioned — see `src/checks/context.ts`'s and `src/exec/safe-list.ts`'s own
headers for the detail:

1. **`adm` group membership** (or an equivalent), to read
   `/var/log/nginx/*.log` for the nginx error-rate and error-log checks.
2. **Read access to `backend/.env`** (mode `600`, app-user-owned), for the
   env-presence check, the cron-freshness check (it needs
   `HEALTH_PING_SECRET`), the payment-gate check, and all four channel
   checks.
3. **One narrow `sudoers` line**, for the `reloadNginx` safe-list operation
   only:
   ```
   alloutdoor ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload
   ```
   No wildcard, no other subcommand. Until this exists, `reloadNginx` fails
   closed with "a password is required" on stderr (`sudo -n`) — by design,
   never a hang.

`nginx -T` itself normally needs root; without it, the TLS-origin and
nginx-proxy-timeout checks fall back to reading `/etc/nginx/sites-enabled`
directly and say in their evidence that they did.

None of this is automatic. A missing permission is a provisioning decision
for the operator, not something Warden's code can work around — and every
one of them fails as a named `unknown`, never as a check that quietly
reports "ok" because it couldn't actually look.

## The security model, briefly

Full detail is in the module headers (`src/exec/safe-list.ts`,
`src/exec/executor.ts`, `src/diagnose/fence.ts`) — this is the shape of it:

- **Measurement has no model in it.** Every check in `src/checks/` is fixed
  code running fixed commands. Facts are gathered before Claude is ever
  called.
- **Claude receives facts as fenced data**, with an explicit rule that
  nothing inside a fence is an instruction, no matter what it says or what
  authority it claims. Its output is parsed into a strict schema — an
  operation name checked against the safe list, or a plain string a human
  reads — and is **never** handed to a shell.
- **The safe list** (`src/exec/safe-list.ts`, six operations) is the only
  thing that may run with no human in the loop. Every argument is checked
  against a closed enum; there is no free-form string anywhere in it, and a
  built operation's `describe` is derived from the same code that runs
  it — the command shown is, by construction, the command that runs.
- **Anything else** runs only after an operator reads the exact command in
  the Desk's confirm dialog and approves it. The compare-and-swap is
  checked three times independently: once by the backend (before it ever
  calls this daemon), once by `WardenCore.approve()` here, and once more by
  `runApprovedProposal()` in the executor itself.
- **A red gate has no command at all.** It cannot be approved, declined, or
  dismissed — it clears only when a human makes a commit or a config
  change. The CIP-backup gap (see Backups below) is the standing example.
- **Every execution writes an audit record** — the operation, its resolved
  arguments, the exit code, and the verbatim stdout/stderr, redacted then
  truncated, with the truncation stated. Nothing here is truncated silently.
- **Never a model-authored command runs unattended.** The model picks a
  *name* and an *enum value*; the argv that actually runs is built by
  `SafeListOperation.build()`, never by concatenating anything the model
  wrote.

## The CIP backup gap

`checks/backups.ts` models this as a **standing bad**, re-raised every
sweep, with no command: the nightly `backup.sh` job covers the database and
the upload tree but not `CIP_SHEETS_DIR`
(`/home/alloutdoor/data/cip` by default), and that loss would be silent. It
reports the live exposure (file count, size) as evidence. It cannot resolve
to "ok" by anything Warden runs — only by a human editing `backup.sh` and
this being re-measured against the new script.

## Development

```bash
npm run typecheck    # tsc --noEmit
npm test              # node:test, no extra runner
npm run sweep         # one real sweep against whatever box you're on, printed
```

`src/checks/`, `src/exec/`, and `src/diagnose/` are owned by earlier passes
of this build — read their own module headers before changing them. This
directory's own layer (`src/server.ts`, `src/state/`, `src/index.ts`) is
transport, durable state, and composition: it holds no measurement logic and
no execution logic of its own.

### Known cleanup, not done here

`src/safety/` is an earlier, superseded implementation of what now lives in
`src/exec/` — it is dead weight, still runs its own tests, and its
`safe-list.ts` carries a fixed bug (`in`-based enum lookup, walks the
prototype chain) that `src/exec/safe-list.ts` does not have. Three files
outside `src/safety/` still import from it (`src/types.ts`,
`src/checks/context.ts`, `src/checks/testing.ts`, all for `execFileP`/
`RunOutcome`) — repointing those three imports at `src/exec/index.js` and
deleting `src/safety/` is a follow-up, not done in this pass because those
files are outside this pass's scope.
