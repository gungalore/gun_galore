# Handoff

What the last session did, where everything stands, and what the next one should
pick up. **Rules do not live here — they live in `CLAUDE.md`.** This file is
state, and it is meant to be overwritten.

Last updated: **2026-09-07**.

---

## Where things stand

| | |
|---|---|
| Production runs | `c647f93` on `feat/takealot-ux-parity` |
| Deploy branch (origin) | `8101c5b3` — one docs commit ahead of the box, which nothing on the server reads |
| Feature branch | `feat/the-bench` |
| Migrations | 64, all applied. Nothing pending. |
| Services | `alloutdoor-backend`, `alloutdoor-frontend`, `warden` — all online |
| Last pre-deploy dump | `alloutdoor-20260907-165840.dump` |

**The platform is not trading.** 2 users, 2 listings, **0 transactions**, 1
motivation, 20 credentials. Nothing has ever been sold. Checkout returns 503
because `PAYMENT_MODE` and `PAYMENTS_LIVE` are both unset.

### Worktrees — read this before running git

**One worktree: `C:/dev/gun-galore`.** The `gg-deploy` and `gg-scanner`
worktrees were removed on 2026-09-07 at the operator's instruction, so a session
can pick up where the last one left off. Both were clean; no work was lost, and
every branch survived. Check out whatever branch you need here, including
`feat/takealot-ux-parity` when you deploy.

⚠️ **`feat/scanner-tracking` (df5ce66c) exists only locally and has never been
pushed.** It is the one branch with no copy anywhere else.

---

## What the last session did

**Drove sections 15, 16 (hunter and sport) and 24 of the licence builder end to
end and fixed what four audits found.** Shipped as `e0c153c8`, merged as
`c647f933`, deployed. Highlights:

- Section 15 was scored against dedicated status, on the one licence type defined
  by not having it.
- A dedicated hunter's papers satisfied a dedicated **sport** application; the
  discipline was read off the document and then dropped. It is now read from
  `status_type` and filtered per licence type.
- The wizard told applicants the association **endorsement** is the sworn
  statement s16(2) requires. It is the letter of good standing.
- `discipline_other` was **required and unaskable at the same time** — a multi
  field compared as a whole string, so picking "something else" beside any real
  discipline hid the box asking what it is.
- A renewal was asked where a firearm it already owns is coming from, and offered
  the SAPS 271 (which is for new licences); answering yes opened ~48 questions and
  then failed.
- The renewal seed wrote two retired keys, left model and expiry blank with both
  in hand, showed two different serials for one firearm, let a card's printed
  "NONE" through as a serial, and put every unreadable-number licence on the same
  application reference so the second renewal silently opened the first one's pack.
- The dedicated-status panel could never reach 100%; a step went green while an
  expected-tier document was missing; every empty row printed its status twice.
- The closing paragraph of **every** motivation asked for "a licence under section
  16 … for dedicated sport shooting" — right for one licence type in five.

**Then rewrote `CLAUDE.md`** from 2,734 lines to ~1,090, verified section by
section against the running system by a ten-agent audit. It had drifted in both
directions: documenting Featured Slots (no route since 2026-08-26) and the retired
dark theme, while barely mentioning The Bench, the Desk, Warden, the Licence
Centre or the Motivations builder.

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

9. **Whether Absolute Hosting takes any snapshot of this box is unknown.** The
   old file asserted "Vultr daily snapshots", which was wrong twice over — wrong
   provider, and unverified. This matters: backups are written to the **same
   disk** as the originals and there are no off-box copies, so a provider-side
   snapshot may be the only thing between the operator and total loss. Ask
   Absolute Hosting what the plan actually includes.
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

- **`npx jest` is not how the backend runs tests.** `package.json` supplies
  `node --experimental-vm-modules`; without it a PDF spec fails 16 times in a way
  that reads exactly like a real regression. Use `npm test -- <path>`.
- **A `.spec.ts` under `frontend/components/` is never collected.** The vitest
  include is `components/**/*.spec.tsx` — note the x. A component spec written as
  `.spec.ts` reports "No test files found" and passes CI by not existing.
- **`deploy.sh` runs no tests and no type-check.** The pre-deploy gate is manual.
- **A gate that contradicts itself was "simplified" and had to be put back.**
  `competency_renews_with_licence` is hidden by `formOnly` **and** a `showIf`
  wanting the opposite path. With the 271 opt-in unasked for renewals it looked
  like one gate would do — but `isVisible` takes no licence type and the key is
  still accepted, so an answer can arrive and open it.

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
