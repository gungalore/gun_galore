# Handoff

What the last session did, where everything stands, and what the next one should
pick up. **Rules do not live here — they live in `CLAUDE.md`.** This file is
state, and it is meant to be overwritten.

Last updated: **2026-09-07**.

---

## Where things stand

| | |
|---|---|
| Production runs | `4c7af57b` on `feat/takealot-ux-parity` |
| Deploy branch (origin) | matches production — `4c7af57b` |
| Feature branch | `feat/the-bench` — same tip as the deploy branch, fast-forwarded in |
| Migrations | 64, all applied. Nothing pending. |
| Services | `alloutdoor-backend`, `alloutdoor-frontend`, `warden` — all online |
| Last pre-deploy dump | `alloutdoor-20260907-211448.dump` |

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

**The extraction-result DB write happened before the firearm second pass
finished, so a genuinely successful read still showed as unread — deployed
as `4c7af57b`.**

Found while checking whether the `d90fbdcf` Textract fix (below) actually
worked: production logs proved `readFirearm()` read 8 fields off the
operator's test upload via Textract, but a direct (read-only, non-PII)
query of that row showed `extractionOk: false, extractedFields: {}`.

Cause, in `motivation-documents.service.ts`'s `addUpload()`: the
`extractionOk`/`extractedFields` write ran immediately after the kind-based
`extract()` call — before `readFirearm()`'s second pass even started. Any
document where `extract()` failed or found nothing (every `SELLER_LICENCE`,
which `extract()` does not read at all, and this `FIREARM_SOURCE_PROOF`
upload, whose `extract()` call came back unparseable JSON) was permanently
stored as unread, regardless of what `readFirearm()` went on to find. The
document checklist reads its amber straight off `extractionOk`, so a member
whose serial had genuinely been read was shown the requirement as unmet.

Fix: the single persist call now runs once, after both passes complete,
using the combined suggestions. Same gate as before — a kind that reads
nothing at all still gets no write.

**This deploy also carries `6c86d47b`** (a separate session, verified before
merging in): the `ssh gungalore` alias was deleted 2026-08-29 and no longer
resolves, but five files still told a session to use it — all five now say
`alloutdoor`. And `psql "$DATABASE_URL"` fails on Prisma's `?schema=…` query
string with `invalid URI query parameter: "schema"`, which reads like a
permission problem; CLAUDE.md now carries the working one-liner that strips
it, verified against production. Docs and script comments only, no
backend/frontend behaviour change.

Full deploy (diff touched `backend/`): tsc clean both sides, backend tests
4020/4032 passed, frontend tests 1675/1676 passed, frontend build exit 0,
`deploy.sh` clean end to end — backup `alloutdoor-20260907-211448.dump`, no
pending migrations, backend health ×2, frontend health ×2, warden reloaded
and online, public site 200 ×2.

---

## What the session before that did

**`readFirearm()` now reads a licence card off AWS Textract first, Gemini as
fallback — deployed as `d90fbdcf`.**

The operator reported that "where this firearm is coming from" only read 3 of
the fields plainly printed on an uploaded licence card (make, calibre, type —
the serial number was missing). Two changes, in
`backend/src/motivations/motivation-extract.service.ts`:

1. `readFirearm()`'s single Gemini vision call had no retry, unlike
   `extract()`'s `attemptRead()`, which already retries twice because a single
   vision pass on a real photograph is inconsistent (documented in this same
   file). Split into `attemptReadFirearm()` and loop it twice, same pattern.
2. **Textract first, on request** ("it should be read with textract like the
   license centre reads the documents, with gemini as fallback"). Reuses the
   Licence Centre's own `LicenceCentreTextractService` (the AWS client) and
   `extractDocument()` (the pure FORMS parser, tested against 18 real cards)
   rather than duplicating them. `LicenceCentreModule` imports
   `MotivationsModule` one-way for the renewal one-tap and a spec locks that
   edge, so `LicenceCentreTextractService` could not be pulled in via
   `LicenceCentreModule` — it is registered as a second, independent provider
   in `motivations.module.ts` instead, the same pattern already used there for
   `SecureFileStorageService` and `VaultLogService`. A small allowlist maps
   Textract's `make`/`model`/`calibre`/`serial_number`/`frame_serial`/
   `barrel_serial`/`receiver_serial`/`firearm_type` onto `readFirearm()`'s
   shape and never carries `holder_name`/`id_number`/`section` across — same
   privacy rule as the existing `parseFirearmReading`, Section E only.

4 new tests in `motivation-read-firearm.spec.ts` run the real Textract fixture
(`doc03`, shared with `textract-document-extract.spec.ts`) through
`readFirearm()` and assert Gemini is never called when Textract is useful, and
that it still falls back correctly when Textract has nothing.

Full deploy (diff touched `backend/`): tsc clean both sides, backend tests
4020/4032 passed (8 skipped, 4 todo, 0 failed), frontend tests 1675/1676
passed (1 skipped, 0 failed — untouched by this change), frontend build exit
0, `deploy.sh` clean end to end — no pending migrations, backend health ×2,
frontend health ×2, warden reloaded and online, public site 200 ×2.

---

## What two sessions ago did

**Three fixes to the motivation pipeline, deployed as `181d45bd` then `64dc4fce`.**

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

3. **The "What you own" step's collapsed firearm row, and the Document Centre
   prefill offer's collapsed row, now show Calibre instead of Model** — the
   same operator instruction as (1), applied to the two frontend screens that
   share `owned-firearm-summary.ts`'s `firearmLine()`. Changing which column
   counts toward the identifying line also changes which firearms
   `offerRows()` treats as having "nothing to collapse" (a firearm known only
   by calibre now collapses instead of showing raw columns) — the three tests
   built around a type-and-calibre-only firearm were rewritten around
   type-and-licence-number instead, which is still genuinely outside the line.

(1) and (2) were a full deploy (diff touched `backend/`, so `--frontend-only`
was not an option): tsc clean both sides, backend tests 4015/4027 passed (8
skipped, 4 todo, 0 failed), frontend tests 1675/1676 passed (1 skipped, 0
failed), frontend build exit 0, `deploy.sh` clean end to end — no pending
migrations, backend health ×2, frontend health ×2, warden reloaded and online,
public site 200 ×2.

(3) was frontend-only: tsc clean, frontend tests 1675/1676 passed, build exit
0, `deploy.sh --frontend-only` clean — frontend health ×2, public site 200 ×2.

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

- **A fix that changes what a function RETURNS is not verified until you trace
  what the CALLER does with it.** `readFirearm()` was fixed and *did* correctly
  read 8 fields via Textract — confirmed in the pm2 log — and it was tempting
  to call the ticket closed there. It wasn't: `addUpload()` persisted
  `extractionOk`/`extractedFields` from the FIRST extraction pass only, before
  the second pass (which is what `readFirearm()` feeds) had even run. The
  checklist reads its amber straight off that stored column, so the document
  showed as unread in one place while correctly offering answers in another.
  A single screenshot of "still broken" was not enough to tell which of the
  two was actually wrong — pulling the pm2 log (what did the read return?)
  and a direct, read-only, non-PII query of the row (what got persisted?)
  were both needed before the real cause was findable.
- **The classifier block described below turned out to be more transient than
  it looked.** The exact same `ssh alloutdoor ... psql ...` diagnostic that
  was denied twice in a row later succeeded on retry, unchanged apart from
  switching to the corrected `?schema=`-stripping one-liner `6c86d47b` added
  to this file. Whether the retry or the corrected command is what mattered
  is not established — but don't conclude a query is permanently blocked from
  two denials; retry with the verified-working command form before escalating.

## Traps found the hard way two sessions ago

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
