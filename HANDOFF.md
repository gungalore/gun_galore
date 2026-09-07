# Handoff

What the last session did, where everything stands, and what the next one should
pick up. **Rules do not live here — they live in `CLAUDE.md`.** This file is
state, and it is meant to be overwritten.

Last updated: **2026-09-07**.

---

## Where things stand

| | |
|---|---|
| Production runs | `181d45bd` on `feat/takealot-ux-parity` |
| Deploy branch (origin) | matches production — `181d45bd` |
| Feature branch | `feat/the-bench` — same tip as the deploy branch, fast-forwarded in |
| Migrations | 64, all applied. Nothing pending. |
| Services | `alloutdoor-backend`, `alloutdoor-frontend`, `warden` — all online |
| Last pre-deploy dump | `alloutdoor-20260907-190417.dump` |

**The platform is not trading.** 2 users, 2 listings, **0 transactions**, 1
motivation, 20 credentials. Nothing has ever been sold. Checkout returns 503
because `PAYMENT_MODE` and `PAYMENTS_LIVE` are both unset.

### Worktrees — read this before running git

**One worktree: `C:/dev/gun-galore`.** Check out whatever branch you need here,
including `feat/takealot-ux-parity` when you deploy.

⚠️ **`feat/scanner-tracking` (df5ce66c) exists only locally and has never been
pushed.** It is the one branch with no copy anywhere else.

---

## What the last session did

**Two fixes to the motivation pipeline, deployed as `181d45bd`.**

1. **The "firearms already licensed to me" table now prints Make, Calibre,
   Serial number, Date of expiry** — operator instruction, replacing the old
   Type and licence-number "Held under" columns. `existingFirearms()` in
   `motivation-render.service.ts` now reads the serial through
   `ownedFirearmSerial()` (the one canonical reader, per its own header
   comment) instead of a raw answer key, and `motivation-pdf.service.ts`'s
   table definition changed from `make/calibre/type/section` to
   `make/calibre/serial/expiry`.

2. **Fixed a resume-to-the-wrong-UI bug.** `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED`
   is `true` in production, so `PACK_SCREEN_SHIPPED` is `true` — but three links
   that decide where a "continue this application" click lands checked
   `PACK_SCREEN_SHIPPED` directly instead of `canOpenPackScreen()`:
   `app/motivations/page.tsx`'s Centre list, `licence-centre-motivations.tsx`'s
   Document Centre panel, and `credential-card.tsx`'s section-24 renewal button
   and its "Used in" link. All three now call `canOpenPackScreen()`, matching
   `/licence-services/new`. (The redirect-on-mismatch guard already inside
   `/licence-services/[id]/page.tsx` was correct all along — it wasn't
   involved in what the operator hit; the raw-flag checks were.)

Full deploy (diff touched `backend/`, so `--frontend-only` was not an option).
tsc clean both sides, backend tests 4015/4027 passed (8 skipped, 4 todo, 0
failed), frontend tests 1675/1676 passed (1 skipped, 0 failed), frontend build
exit 0. `deploy.sh` ran clean end to end: no pending migrations, backend health
×2, frontend health ×2, warden reloaded and online, public site 200 ×2.

---

## Open items

### Needs an operator decision

1. **Section 15 does not serve occasional sports shooters.** s15(2) covers "an
   occasional hunter **or occasional sports person**", and the chooser sells it as
   "hunts or shoots". Every question it asks is about hunting, and
   `intended_quarry` ("what you intend to hunt with it") is **required** — so a
   member who shoots occasionally and holds no dedicated status cannot get past
   it. Fixing it changes what somebody signs, so it is not a developer's call.
2. **Section 24 does not branch on the section the original licence was issued
   under**, though s24(3) turns on continued compliance with *that* section's
   requirements — a section 16 renewal should be asked for current dedicated
   status. The fact needed is already read off the card.

### Should be fixed, no decision needed

3. ⚠️ **`backend/scripts/seed-categories.mjs` is dangerous.** It deactivates every
   category then re-activates only its own list, and its list is four parents
   short. Running it against production hides Overlanding, Hunting, Outdoor
   Clothing & Footwear and Archery & Bowhunting and everything under them.
   Reconcile it with `prisma/seed.ts` or delete it.
4. **`/how-selling-works` advertises four selling modes**, two of which do not
   exist (Take a Shot stopped being a mode on 2026-08-27; Swop has no backend
   code). Public copy promising a service that is not there.
5. **Three moderation settings are editable in the admin and read by nothing** —
   `claude_confidence_threshold`, `new_seller_firearm_review_count`,
   `high_value_review_threshold`. Worse, the `claude_moderation_enabled` hint says
   turning it off sends everything to review; the code publishes ACTIVE instead.
   An operator raising the high-value threshold today changes nothing.
6. **`VERIFYNOW_MODE` may be sandbox on production.** The boot check only logs an
   error — the hard throw was deferred — so identity checks can be passing on
   canned data. Confirm before the first real sign-up.
7. **`infra/nginx/alloutdoor.conf` claims to be the committed copy of the live
   config** and still carries `gungalore.co.za` blocks that 301. The box actually
   drops those hosts. Re-capture it from the box or stop claiming parity.
8. **Category count is 189**, against a seeding note that says 129. Either the
   tree grew or inactive rows accumulated; nobody knows which.

### Unverified — someone has to look outside the repo

9. **Whether Absolute Hosting takes any snapshot of this box is unknown.** This
   matters: backups are written to the **same disk** as the originals and there
   are no off-box copies, so a provider-side snapshot may be the only thing
   between the operator and total loss. Ask Absolute Hosting what the plan
   actually includes.
10. **UptimeRobot monitors** are asserted but unconfirmed.
11. **The monthly backup restore test** is asserted and has no log. An untested
    backup regime that a document claims is tested is worse than one that admits
    it is not.

### Known and accepted

- **`bobgo_enabled` defaults false**, and with it off there is no door rail at
  all. Its production value is a DB row — check the box before touching delivery.
- Peach credentials are not set on production, so even flipping the payment flags
  would run the mock.

---

## Traps found the hard way this session

- **A build-time flag being `true` does not mean every entry point checks it the
  same way.** `PACK_SCREEN_SHIPPED` is `true` in production, but
  `canOpenPackScreen()` is `PACK_SCREEN_SHIPPED || readPreviewOptIn(search)` —
  checking the raw flag alone still passes here, so this specific bug was never
  about the flag's value. It was that three separate `href`/`router.push` call
  sites had each hand-rolled the same `PACK_SCREEN_SHIPPED ? a : b` ternary
  instead of importing `canOpenPackScreen()`, and one of them will drift the
  next time this decision needs a second input. If a fourth entry point to a
  motivation gets added, grep for `PACK_SCREEN_SHIPPED` used bare before wiring
  its link.
- **`npx jest` / `npx tsc` from the wrong cwd fails silently-ish.** Running a
  git or npm command from `frontend/` when you meant the repo root doesn't
  error clearly — `git add <path>` just says "did not match any files". Check
  `pwd` when a path-based command behaves unexpectedly after `cd`-ing for an
  unrelated build/test step earlier in the session.
- **`npx jest` is not how the backend runs tests.** `package.json` supplies
  `node --experimental-vm-modules`; without it a PDF spec fails 16 times in a way
  that reads exactly like a real regression. Use `npm test -- <path>`.
- **The frontend does not use Jest at all — it's vitest**, invoked through
  `npm test`, not `npx jest`. `npx jest` against this repo pulls a generic
  babel config from the npx cache and fails to parse `type` imports; it looks
  like a real syntax error in the test file until you notice the runner.
- **A `.spec.ts` under `frontend/components/` is never collected.** The vitest
  include is `components/**/*.spec.tsx` — note the x. A component spec written as
  `.spec.ts` reports "No test files found" and passes CI by not existing.
- **`deploy.sh` runs no tests and no type-check.** The pre-deploy gate is manual.

---

## Notes for whoever picks this up

- The working tree carries untracked scratch that is **not** part of this work and
  should stay untracked: `backend/measure.js`, `measure_with_overlays.js`,
  `final_report.js`, `report.json` and `overlays/` (DocQuadNet benchmark scratch
  from the scanner workstream), and `docs/design/desk-pwa/` (the Desk's phone
  artboards, which live only in this worktree). Never `git add .`.
- One Section 16 application failed once with a conflict and burned reference
  `MO000057`. It worked on retry and could not be reproduced. If it recurs, the
  create path allocates a reference before the insert, so a failure leaves a gap.
- `MOTIVATION-AUDIT-2026-08.md` and the other `MOTIVATION-*.md` files predate this
  session's work on sections 15, 16 and 24.
