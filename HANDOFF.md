# Handoff

What the last session did, where everything stands, and what the next one should
pick up. **Rules do not live here — they live in `CLAUDE.md`.** This file is
state, and it is meant to be overwritten.

Last updated: **2026-09-08**.

## Next up: finish Phase 2 — the rest is DEPLOYED

The operator's brief is `MOTIVATION-REBUILD-BRIEF.md` (repo root), whose **§0
amendments table is the ruling set** — it overrides the sections it names. The
companions are `MOTIVATION-INTAKE-PLAN.md` (the question model) and
`MOTIVATION-UX-REVIEW.md` (what is wrong with the live screens). The
file-by-file plan for all four phases is
`docs/design/licence-centre/PHASE-0-PLAN.md`; the Phase 3 frontend spec is
`docs/design/licence-centre/SPEC-BUILD.md`.


⚠️ **Phase 2 is HALF DONE AND STOPPED ON PURPOSE.** Brief §0 ruling H makes the
14 → 12 heading mapping the first step of Phase 2, with its own sign-off,
before `HEADING_ALTERNATES` may collapse. That mapping is delivered — see
`docs/design/licence-centre/PHASE-0-PLAN.md` §2.0 — and everything that does
NOT depend on it has been built. What remains is listed under "What Phase 2
still owes" below.

**Phases 1, 1B, 3 and 4 are DEPLOYED and committed** — `7f2b2628`, then the
shelf follow-up `fe78bd12`, both 2026-09-08. **Phase 2 is half done** and
stopped on the §2.0 heading-mapping sign-off; that mapping,
in `docs/design/licence-centre/PHASE-0-PLAN.md` §2.0, is the next thing that
needs the operator rather than a developer.

### What Phase 1 did

1. **The registry (`motivation-fields.ts`), `FIELD_REGISTRY_VERSION` → `2026-09-08`.**
   New `kind: 'cards'`; new field properties `options`, `scope` and `internal`;
   `showIf.hasAny`. New `'Your premises'` section (profile-scoped) with seven
   new questions, absorbing the four safe fields out of 'Storage and safety'.
   `existing_firearm_N_primary_use` on all fourteen owned rows. `overlap_angle`.
   Nine reason-card sets. Every `long` field lost `required` and became the
   optional prefilled "anything else" box under the cards that replaced it.
2. **`fill_saps271` is retired as a QUESTION**, not deleted — `RETIRED_FIELDS`
   keeps `fieldByKey` finding it so an old draft still saves. `formOnly` no
   longer decides what is ASKED, only what reaches the writer. Roughly
   forty-eight questions that hung off the opt-in are asked of everybody now,
   **including the six history questions**, which on the dealer path were never
   asked at all — so a conviction never reached the writer.
3. **`internal: true`** replaced the deliberate `formOnly` × `showIf`
   contradiction on `police_station_province`, `press_clippings` and
   `competency_renews_with_licence`. Safe now because the frontend's mirror of
   `isVisible()` is retired: `motivation-sheet.service.ts` computes item state
   server-side and is the only visibility decision in the system.
4. **The profile store.** New `MemberProfileAnswers` model + migration +
   `member-profile-answers.service.ts`. `saveAnswers()` splits the incoming blob
   by scope; `findOne()` and the sheet layer the application over the profile.
5. **`GET :id/sheet` and `GET :id/preview`** — `motivation-sheet.service.ts`
   composes prefill, documents, coverage, overlap and preview into one read;
   `motivation-preview.ts` is a pure, deterministic, **no-model-call** preview.
6. **SAPS 271 F-by-route** — the opt-in gate is gone from
   `motivation-render.service.ts`; the checklist note now names the route.
   `saps271-map.ts` gained `'Both'` for `safe_mounted_to` (item 69 has two
   boxes and no third, so the new choice had to become two ticks).
7. **Overlap** gained action and section axes and a ranked `suggestedAngle`
   drawn from the fixed `OVERLAP_ANGLES` vocabulary.
8. **The follow-up interview is gone** — `motivation-gaps.ts` (+spec) deleted,
   `queueFollowUps`, `askFollowUpBatch`, `askFollowUp`, the four follow-up
   prompts, `listMessages`, `answerFollowUp`, both `messages` endpoints, the
   `MotivationMessage` table and its two frontend client calls.
9. **Frontend appendix (non-visual).** Both registry fixtures regenerated from
   the live registry (they were hand-maintained and had gone stale, so
   `wizard-coverage` was checking the wizard against a registry that no longer
   existed); `visibleFields()` lost the 271 gate; `STEP_PLAN` and `WIZARD_STEPS`
   re-pointed at `'Your premises'`; the follow-up UI removed from both wizards.

### What Phase 2 did

1. **The research layer** — `MotivationResearch` table + migration +
   `motivation-research.service.ts`. Four narrower questions (firearm model,
   cartridge, discipline, class of game) each keyed on a fact about the WORLD,
   so a row is shared by everyone who asks the same one and the second
   applicant for a Beretta 1301 costs no call. 180-day TTL, checked on read
   rather than swept.
2. **It is a privacy improvement, not only a cost one.** The free-text brief it
   replaces carried the applicant's suburb into a web search. Precinct figures
   already come from our own SAPS workbook, so **no applicant datum reaches a
   search query at all now** — locked by a spec that asserts no name, ID,
   address, suburb, station, employer or serial appears in any target.
3. **The old free-text path is removed** — `research()`, `researchBrief()` and
   `ResearchArgs`. ⚠️ `redactToArea()` was deliberately KEPT with its tests: it
   is a tested privacy primitive and the next person who needs to put a place
   into a prompt should find it rather than write it again, worse.
4. **Length bands halved** — S13 900–1400, S15/S16 1200–1800, S24 600–900,
   because ~60% of the approved corpus's page count is manufacturer copy and
   quoted regulation that rule 7 already forbids.
5. **Cadence fixed to `plain`, one opening instead of four.** The similarity
   detector survives as a test-time guard.
6. **Reloading asked once**, profile-scoped (`reloads`, `reload_calibres`,
   `reload_since`).
7. **⚠️ A REAL BUG CAUGHT ON THE WAY: tapped cards were reaching the writer as
   SLUGS.** `s13_reasons` stores `night_travel, rented`, and the fact-pack
   renderer would have handed those two tokens to the model as the whole
   self-defence case. This is the identical failure the file already documents
   for `discipline`. Card answers now render as their first-person sentences,
   through the `long` shape so the 200-character scalar cap cannot silently
   drop somebody's fifth reason. Three new tests.

### What Phase 2 still owes (all blocked on the §2.0 sign-off)

- `HEADING_ALTERNATES` and `TYPE_HEADING_ALTERNATES` collapsing to one title
  per section.
- The rendered-from-data blocks: page-1 particulars, the owned-firearms battery
  table, the S13 existing-measures list, the statutory quote-then-apply, the
  annexure index, and page 2's take-to-SAPS checklist. Their PLACEMENT is what
  the mapping decides, which is why they waited.
- `motivation-pdf.service.ts` table definitions for those blocks.
- The Document Centre asking `primary_use` at vault-adoption time (brief §5.7).
  ⚠️ Deliberately NOT stubbed in the backend: the field exists, is
  profile-scoped and is already served by the sheet; the asking is a Document
  Centre screen change and belongs with Phase 3 rather than as a backend hook
  nothing calls.
- The five sample PDFs to `scan-fixtures/motivation-samples/` (ruling J).

### What Phase 1B did — AWS Textract is gone

Operator, 2026-09-08: "we will also be losing AWS textract and only be using
gemini going forward. Gemini can write straight into json." Scope: everything,
KYC included. Removed from all three places it lived.

1. **The Licence Centre reader.** `licence-centre-textract.service.ts` and
   `textract-document-extract.ts` deleted; `licence-centre-extract.service.ts`
   is Gemini-only with a per-call `json: { schema }` whose `key` is enumerated
   to that call's own `wantedFor()` list. `document_side` (front/back of a
   proficiency pair) used to need a SECOND Textract call to decide, even when
   the model had done the read — it is now just another key in the prompt.
2. **`readFirearm()`.** The Textract-first pass, `firearmFromTextract` and the
   key map are gone; the call takes `FIREARM_READING_SCHEMA`.
3. **KYC.** `textract-extract.ts` deleted; `readIdentityDocument()` is one
   Gemini schema call, and **SA ID numbers are validated with `readSaId` in
   code** — a Luhn failure nulls the number rather than flagging it.
   `textract:*` out of `infra/aws/kyc-iam-policy.json`.
4. **`@aws-sdk/client-textract` uninstalled.** Nothing imported it any more and
   leaving it would tell the next session Textract was still live.

⚠️ **AWS DID NOT LEAVE.** `aws-kyc.service.ts` still uses Rekognition for face
match and Face Liveness. The client, the region, `AWS_KYC_LIVENESS_ROLE_ARN`
and every `rekognition:*` IAM statement stay.

### ⚠️ What Phase 1B cost, stated plainly

- **`legibilityScore()` is no longer a legibility measure.** It was Textract's
  mean per-line OCR confidence × field completeness, and it gates whether a
  seller is asked to retake their ID. A vision model reports no such
  confidence and must not be asked to invent one, so it is **completeness
  alone** now. The "no ID number caps at 40" rule is kept verbatim.
  **A smudged document the model reads confidently but WRONGLY now scores high,
  where Textract's low confidence would have forced a retake.**
- **The Licence Centre lost its marker fast-path.** `readMarkers` ran off
  Textract's OCR text, so `classify()` could read a form number for free and
  without hallucinating. It now always costs a model call. **This is fixable** —
  `GoogleVisionOcrService` already exists and motivations' own classifier uses
  it for exactly this — but it is a third provider, and the instruction was
  "only gemini", so it needs an operator call. `UPLOAD_TO_CREDENTIAL` has no
  production caller left as a result.
- **The public privacy page was made accurate.** It told members their identity
  document goes to AWS Ireland for "automated text extraction", which is now
  Google. Corrected in `frontend/app/(legal)/privacy/page.tsx` — both the
  paragraph and the cross-border operator table. ⚠️ **This is POPIA §72
  cross-border disclosure copy and should have an attorney's eye on it.**
- ⚠️ **Two sets of Textract fixtures are ORPHANED AND TRACKED IN GIT** —
  `backend/src/kyc/__fixtures__/textract/` (6 real identity documents) and
  `backend/src/licence-centre/__fixtures__/textract/`. Nothing reads them.
  They carry real names and identity numbers. Not deleted: that is the
  operator's call, and git history keeps them regardless, which is the deeper
  problem worth a decision.

### What Phase 3 did — the surface is built

Fourteen files under `frontend/components/licence-centre/` plus three routes.
**73 new tests**, `npm run build` exit 0, all four routes registering:
`/licence-centre` (static — the Document Centre, untouched),
`/licence-centre/applications`, `/licence-centre/[id]`,
`/licence-centre/[id]/pack`.

Components: `contract.ts`, `sheet-row`, `cards-row`, `declaration-row`,
`sheet-header`, `sheet-footer`, `sheet-section`, `document-shelf`,
`sheet-toast`, `overlap-card`, `consent-card`, `competency-lines`,
`pack-summary`, `preview-panel`, `__fixtures__/sheet.fixture.ts`.
Routes: the sheet (the only stateful file), the applications list, the pack.

### The acceptance gates (ruling G — RTL, not Playwright)

`components/licence-centre/sheet-gates.spec.tsx`. The counter **throws on any
keystroke**, so "zero typing" is enforced rather than observed.

- **(a)** populated vault, S16 sport → enabled button in **1 tap**, zero
  typing, against a ceiling of 12.
- **(b)** empty vault → every unanswered item renders an OPEN input; the button
  opens once they are answered.
- **(c)** private sale → the consent card's Part F line changes once the seller
  signs, and never blames the applicant for a signature they cannot hurry
  (`pack-cards.spec.tsx`).

### Decisions in Phase 3 worth knowing

⚠️ **The two client calls live in `lib/motivations-api.ts`, NOT a client of
their own** — a departure from the Phase 0 plan.
`backend/src/common/api-route-contract.spec.ts` parses THAT FILE and asserts
every call has a matching route; a separate module falls outside the check,
which is how the two `messages` calls outlived their endpoints. Verified
passing with both new routes.

⚠️ **`/licence-centre` had to join `PUSH_TITLE_INDEX_ONLY`** in
`lib/shell-routes.ts`, or that prefix swallows the subtree and heads every
application "Licence Centre" instead of its own name.

⚠️ **The page holds a `pending` map of unsaved edits separately from the
sheet**, cleared only AFTER the refetch lands. Clearing on the save's response
blanks the member's text for one frame, which reads as the form eating what
they typed.

⚠️ **`cards-row` stops prefilling the own-words box once the member types.**
Re-joining over their sentence would delete what they wrote, and that box is
the one place their own voice reaches a signed document.

⚠️ **The shelf's Add tile mounts the EXISTING `bulk-capture.tsx`**, which
already owns the picker, the phone hand-off and the re-file dropdown and is
tested where it lives. Phase 4 moves the file; Phase 3 did not rewrite it.

### What Phase 3 did NOT do

- **`witnesses` and the cover-photo chooser are not on the pack page.** Both
  components exist (`motivation-witnesses.tsx`, `motivation-cover-photo.tsx`)
  and both are in the §4 move list. The pack page renders the motivation, the
  271 summary and the take-to-SAPS list; the two chooser panels are a small
  follow-on rather than something to fake.
- **Nothing was moved out of `components/licence-pack/` or
  `components/motivation/`.** They are imported where they stand, exactly as
  SPEC-BUILD §4 says — a move plus a rewrite in one phase is how a regression
  hides. Phase 4 moves them.
- **The old screens are untouched and still work.** No redirects, no deletions;
  that is Phase 4 and a separate sign-off.

### The deploy — 2026-09-08, `7f2b2628`

Full deploy (the diff touches `backend/` and `prisma/`, so `--frontend-only`
was not an option). tsc clean both sides; backend **4041/4053**, frontend
**1561/1562**, 0 failed; frontend build exit 0 in the foreground with
`.next/BUILD_ID` present. `deploy.sh` clean end to end — backup
`alloutdoor-20260908-085731.dump`, backend health ×2, frontend health ×2,
warden reloaded and online, public site 200 ×2, three pm2 services online.

**Three migrations applied**, schema up to date: `MemberProfileAnswers` and
`MotivationResearch` created, `MotivationMessage` **dropped**. Verified on the
box: both new tables present, `MotivationMessage` gone, the one existing
motivation intact.

**All four redirects verified in production**, plus the one that must NOT fire:

| Path | Result |
|---|---|
| `/motivations` | 308 → `/licence-centre/applications` |
| `/licence-services/new` | 308 → `/licence-centre/applications` |
| `/motivations/:id` | 308 → `/licence-centre/:id` |
| `/licence-services/:id` | 308 → `/licence-centre/:id` |
| `/licence-centre` | 307 (Clerk auth wall) — **still the Document Centre** |

### Typing, pills, and the consent capture I broke — 2026-09-08, `15f6e2c3` + `245db6e2`

⚠️ **NO FIELD ON THE SHEET COULD BE TYPED INTO BY HAND.** The page merges
pending edits back over the server's values, so a keystroke changes
`item.value` — and `SheetRow`'s reset effect, written to close an editor when a
document READ moved the value underneath it, could not tell that apart from the
member's own typing. Tap Change, press one key, the box shuts. A `needs_you` row
had the same cause with a different symptom: it is open because of its STATE, so
when the debounced save flipped it to `filled` the control collapsed mid-word.
A `touched` ref now holds the row open until the member leaves it.

**Section pills** are drawn inside `SheetSection` and the page passes a NUMBER.
It was `meta?: React.ReactNode` with every caller building its own span, which
is how two sections end up with two ideas of what "done" looks like.
⚠️ **`color-mix` for the amber, never `var(--warning)` + an alpha** — that is two
tokens, not a colour, and there is no `--warning-wash`. A test asserts the class
carries `color-mix` so nobody "tidies" it into the broken form.

⚠️ **THE V3 SWAP BROKE THE CONSENT CAPTURE, AND THE WRAPPER HAD NO SPEC.**
`licence-card-capture.tsx` was built around V2's contract: finish() called
`onClose()` and THEN `onDone()`, synchronously, **one file at a time**. **V3
collects PAGES, hands them over in a single `onDone(files)`, and never calls
`onClose()` at all.** One mismatch, three reported symptoms:

| Symptom | Cause |
|---|---|
| "the camera does not automaticly return to the form" | nothing closed it; V2's finish() used to |
| the back silently dropped | the wrapper took `files[0]` and nothing else |
| "it won't submit" | `photographed` is `!!front && !!back`, so the button stayed disabled forever |

`handleDone` understands both contracts now, closes explicitly, and **takes two
pages and no more** — a third page is not a third side. Both passes say "two
pictures" in the scanner's own header.

⚠️ **WHEN SWAPPING A SCANNER, READ ITS finish(). The two do not agree**, and
nothing in the type system says so: both satisfy `DocumentScannerProps`.

### Still owed from the operator's 2026-09-08 list

**Consent form:** the bottom bar sits over the camera; the address wants Google
autofill plus a sectioned manual fallback rather than one box; and ⚠️ **the
scanner's "select all" ticks the signature/declaration boxes too** — operator:
"make this universal for every scanner".

**The firearm section:** the own-words box under the reason cards does not say
what it is for; and there are **two headings reading "What this one will be"**
— the overlap card and the owned-firearm purpose set — which need distinct
wording, far more realistic options, and a scrollable select styled to the
theme.

**Earlier and still open:** select / select-all to save member-added documents
to the Licence Centre with consent (the autolink's `skipped` list is the natural
home for the other half); the take-with-you list saying "we have put a copy in
your pack, bring the original"; and consent delete + preview.

### Sheet fixes round 3 — 2026-09-08, `6e1eef04` + `53c11e0f`

⚠️ **SIX PREMISES QUESTIONS WERE FREE-TEXT BOXES.** "Is there an alarm?", "Do
you have armed response?", "Are there burglar bars?", "Are there security
gates?", "Do you have the prescribed safe?" and "Is it mounted?" are all
`yesno` in the registry and `Control` had **no branch for that kind**, so every
one rendered as an empty text field. Declarations never hit it — the page
routes that whole section to `DeclarationRow` — which is why it went unseen.

⚠️ **THE ADDRESS PICKER NEVER RENDERED, AND THE REASON IS A RULE WORTH KEEPING:
A KEY TEST BELOW A KIND TEST ONLY CATCHES THE KINDS NOTHING ELSE CLAIMED.**
`residential_address` is kind `long`, so `ADDRESS_KEYS.has(item.key)` sat below
the textarea branch and was unreachable. The member got a plain multi-line box
and Google Maps was never loaded. Caught on production: the built bundle had
the Maps loader **and a real key**, and no `<script>` tag ever appeared —
because the component that injects it was not on the page at all. The branch is
first now; two specs pin it.

Also: **"Are you the main licence holder"** → **"Will you be"** (they are
applying, not holding); the declarations pills line up right (they needed
**both** `w-full` and `ml-auto` — without the first the block sizes to its
content, without the second they fall left the moment they wrap on a phone);
section headers carry a `--red-wash` band with a `--red-line` keyline, bled into
the gutters. **The wash is on the HEADER, not the section** — tinting the
section would put colour behind every input in it.

**Verified on production against MO000067:** header background
`rgba(200,16,46,0.09)`, **10 yes/no buttons and 0 text inputs** in Premises, the
future tense, and the address row opening a real `<input>` prefilled with the
member's address with `.pac-container` live.

⚠️ **THE SERVICE WORKER SERVES THE OLD BUNDLE UNTIL "Reload" IS TAPPED.**
`skipWaiting: false` is deliberate, and it means a fresh `navigate` in a
verification pass gets the PREVIOUS build. Three rounds of "the fix is not
there" were that. Click the update banner's Reload first, then check.

### Still owed from the operator's 2026-09-08 list

1. ⚠️ **Delete the seller consent, and preview the consent form.** No applicant
   -facing delete endpoint exists — `motivation-seller-consent.service.ts`
   already tells members to "Delete that consent first if you need a new one",
   naming a control that is not built. Preview needs a render of the signed
   page before it reaches the pack.
2. ⚠️ **Proficiencies, and documents filing both ways.** The correct
   proficiencies must be addable from the Licence Centre, scanned, or uploaded;
   **anything attached to an application must also be filed in the Licence
   Centre**; and every document wants its own add control plus an "add all".
   Today the sheet's shelf writes `MotivationUpload` rows only — the vault
   (`Credential`) is not written, so a document added on the sheet is invisible
   to the next application.

### The seller's scanner, and NONE on the form — 2026-09-08, `4170533f` + `e82c1efe`

**"why cant we use the same scanner that the license centre uses"**

⚠️ **`components/consent/licence-card-capture.tsx` IMPORTED THE V2 SCANNER BY
PATH**, so the seller got the old one however `NEXT_PUBLIC_SCANNER_V3` was set
— and it is `1` in production. The flag was only ever read by
`scan/scan-button.tsx` and `/scan/handoff`; that is how one surface sits on the
rebuilt detector while another quietly does not. It now uses the same switch.

⚠️ **THE SWITCH IS COPIED, NOT SHARED, AND THAT IS FORCED.** `dynamic()` needs a
literal `import()` per branch or the bundler cannot split the two scanners. Keep
the expression identical to `scan-button.tsx`'s. `components/scan-v3` stays
vendored — import it, never edit it here.

**"instruct gemini to read a NONE as NONE and not leave it out"**

⚠️ **THE READ SIDE WAS ALREADY RIGHT.** `licence-card-ocr.service.ts` carries the
operator's own words — *"if it says NONE, you put NONE"* — and never INVENTS
one, so a field it could not make out still arrives `undefined` rather than
NONE. The two stayed distinguishable throughout. **The loss was one step later.**

⚠️ **THE STRIP MOVED FROM THE ANSWER BOUNDARY TO THE PROSE BOUNDARY.** It was not
deleted. Three places dropped a card placeholder on the way into `answers`:

| Path | Was | Now |
|---|---|---|
| `motivation-extract.service.ts` — a fresh scan | dropped the row | keeps NONE |
| `motivation-credentials.ts` `credentialOffer()` — the vault carry, **the live one** | dropped the row | keeps NONE |
| `common/document-fields.ts` `toMotivationAnswers()` — not wired today | dropped the row | keeps NONE |

and one place now strips it instead:

| `motivation-prompts.ts` `renderFacts()` | passed answers through | runs `answerValue()` |

**"Model NONE" handed to a language model is an invitation to write a sentence
about a firearm called None** — that is the only thing this protects against,
and the prose boundary is where it belongs.

⚠️ **TWO PLACES STILL SKIP PLACEHOLDERS AND MUST.** `first()` in
`motivation-credentials.ts` and `ownedFirearmSerial()` in `motivation-fields.ts`
are **fallback chains** — frame, then barrel, then receiver. A NONE that returns
instead of falling through is how a row with a real number in the next column
comes back empty. **Picking a serial and transcribing a row are different
questions; only the second wants the word NONE.**

⚠️ **THIS REVERSES A RULE INTRODUCED 2026-09-07, AND THE LEGAL POINT WAS RAISED
AND OVERRULED RATHER THAN OVERLOOKED.** The tests being flipped argued that a
NONE crossing into `answers` is a false statement on a SAPS 271 and therefore an
offence under **section 120(9)(f)**. The operator, who takes these packs to a
DFO, ruled that transcribing what the card itself prints reproduces the document
rather than asserting anything new, and that an empty box says something
different. **Both positions are recorded in the tests; if it is revisited it is a
question for the operator and the DFO, not for whoever is next in the file.**

`card-placeholder-boundary.spec.ts` asserts both ends at once — the 271 prints
NONE, the fact pack does not. Move the strip back and one of the two goes red.

⚠️ **NOT VERIFIED AT RUNTIME: which scanner the consent page loads.** The change
is the same one-line expression the Licence Centre uses and the build is clean,
but the consent link is single-use and the only one issued has been consumed. A
fresh invite would confirm it.

### The seller signed and the sheet did not notice — 2026-09-08, `f0558200`

The consent completed at **12:02 SAST** — front, back, signature, Part F,
firearm snapshot, all stored — and the applicant's page went on saying "When
they sign, Part F … fills in from what they give us", directly beneath a panel
already reading "The owner has signed". **Two bugs, one on each side.**

1. ⚠️ **`saps271Coverage` ONLY PUSHES SECTION F WHEN IT IS TOLD ABOUT THE
   SELLER, and `motivation-sheet.service.ts` passed no context at all.** So the
   sheet had no F row: no "Current owner" line on the pack meter, and nothing
   for the page to read. `motivations.service.ts` has always passed it — the
   sheet is the newer surface and simply did not.

   ⚠️ **`sellerState()` WAS A PRIVATE METHOD ON `MotivationsService`**, which is
   why the second surface could not call it. It now lives on
   `MotivationSharedService`, which both inject; `MotivationsService` delegates.
   Same rule its sibling `waitingOn()` already carries.

2. ⚠️ **THE PAGE READ PROPERTY NAMES THAT DO NOT EXIST.** `sellerSigned` tested
   `c.key === 'F' && (c.done ?? 0) > 0`. The server emits `id`, `label`,
   `percent`, `status`, `note`, `missingRequired`, `applicable`, `answered` —
   there is no `key` and no `done` anywhere, so it read two undefined properties
   and could only ever be false. And `answered`, the field `done` was meant to
   be, is **pinned at 0 for F on purpose** ("STATUS, NEVER A PERCENTAGE"), so
   even spelled correctly it would never have flipped. The correct read is
   `id === 'F' && status === 'complete'`.

   ⚠️ **AN `as` CAST IS WHAT HID IT.** Asserting a shape the server does not
   send turns a compile error into a silent false.

⚠️ **THE LICENCE-CENTRE COVERAGE FIXTURE CARRIED THE SAME INVENTED NAMES** —
`key` / `total` / `done` — so `PackSummary`'s tests passed against a shape
nothing produces. Corrected to what `saps271-coverage.ts` emits. Three new
sheet tests cover the F row: signed, waiting, and absent when nobody was asked.

**Verified on production against MO000067:** the Part F line now reads "Signed.
Part F of your SAPS 271 is filled in from what the seller gave us"; the shelf
carries both sides of the owner's licence; the panel offers **"Use these details
in my application"** with Make CZ / Handgun / 6.35MM BROWNING / 81815 read off
the card, the photograph beneath it to check against. 21 → 18 things left.

### The scanner auto-trigger — diagnosed, NOT changed

Operator, 2026-09-08: *"The scanner did a auto trigger and quality was
unreadible, redid it and then the autotrigger didnt want to fire again."*

- ⚠️ **THE SELLER'S CONSENT PAGE USES THE V2 SCANNER REGARDLESS OF THE FLAG.**
  `components/consent/licence-card-capture.tsx` imports
  `components/scan/document-scanner` by path. `NEXT_PUBLIC_SCANNER_V3=1` is set
  on the box, but the flag is only read through `scan-button.tsx` and
  `/scan/handoff`. So the seller scanned on V2.
- The gate is `ARM_MS` (1200ms from viewfinder open) → `HOLD_MS` (300ms still)
  → guidance exactly `'ready'`. All three are deliberate and carry operator
  history; 700 was "super sensitive", 1100 "way too long", and the motion
  reading was broken during both verdicts.
- ⚠️ **`startedAt` IS SET INSIDE THE DETECT-LOOP EFFECT** (deps `[phase,
  shape]`), so returning to `live` after a retake restarts the arming clock and
  the member pays the full 1200ms again. `ARM_MS`'s own docstring says the
  opposite: "This costs nothing after the first shot of a session … from then
  on the hold alone governs."
- ⚠️ **DO NOT "FIX" THAT TO MATCH THE SENTENCE WITHOUT EVIDENCE.** Per-session
  arming makes a retake instant — which is what this report asks for, and is
  also exactly the "way too fast to take a picture, cant even aim then it snaps"
  that ARM_MS was introduced to stop, since somebody who has just tapped "Take
  it again" is still holding the card in frame. Both readings are defensible.
- A stale comment was corrected: `INK_AT` justified its deliberately weak floor
  by "the real protection is the 1100ms hold", when `HOLD_MS` has been 300 since
  the motion reading was fixed.

**What settles it:** open the scanner with **`?diag=1`**. The panel reports the
live blocker reason, motion and ready% — one capture of that during a failing
retake replaces the guessing this surface's history is made of.

### The invite was broken in THREE layers — 2026-09-08, `9e6e04a3`

⚠️ **THE CONTROLLER NEVER READ THE EMAIL EITHER.**
`motivations-consent.controller.ts` declared a body type with no `email` field
and never passed one to `invite()`, so even after `e75ac24b` added the input
and the API client's field, the service still received `''` and refused with
the same sentence.

⚠️ **THE IDENTICAL REFUSAL IS WHAT HID IT.** "Enter a valid email address for
them." is byte-for-byte the same whether nought, one or two of the three layers
have been fixed — so a round of fixing changes nothing on screen and reads as
having not worked at all. When a message cannot distinguish "you did not type
one" from "we did not send yours", check every layer before believing any of
them.

The chain is whole now: **input → API client body type → controller body type
and pass-through → service → `invitedEmail` stored → the link emailed beside
the SMS.** `motivations-consent.controller.spec.ts` asserts the forwarding
directly.

**Proved on production without sending anything.** The service validates in
order — name, phone, email, then the firearm label — so an invite carrying a
valid address and an empty `firearm: {}` fails at the LAST check and sends no
SMS, no email and writes no row:

| Probe | Response |
|---|---|
| `email: 'not-an-address'` | 400 "Enter a valid email address for them." |
| `email: 'probe@example.co.za'` | 400 "Say which firearm this is about…" |

The error moving past the email check is the proof. `MotivationSellerConsent`
is still at 0 rows.

### One scanner, one picker — 2026-09-08, `0c3eaa75`

⚠️ **THE SHELF AND THE PANEL BOTH OFFERED THE WHOLE CHOICE.** The empty shelf
showed "Add your ID, licences and certificates" and "Upload from this device";
tapping either opened AddPanel, which mounted a `ScanButton` with its own pair
underneath — "Use my phone camera" and "Choose files instead". Operator,
2026-09-08: *"this is double. two scan with phone options."*

**Why it happened:** `ScanButton.autoStart` hides that component's own controls
while it probes and opens. The Scan tile set it; the Upload tile did not — so
the Upload route opened a panel that rendered the entire choice a second time.

- **The empty shelf is two dashed boxes, same style, side by side** — scan,
  and upload beside it. Each says only what it does; the scan box no longer
  reads "or choose files", because it no longer does.
- **The upload control is a `<label>` around a hidden file input**, on both the
  empty shelf and the 72px tile row, so it opens the OS picker directly.
  "Upload from this device" that opens a screen offering to scan with your
  phone is not an upload button.
- **AddPanel renders nothing a member can see.** It mounts only when the SCAN
  box was tapped, always with `autoStart`, purely to host the scanner or the
  hand-off. Its fallback picker survives for the one case where nothing opened
  at all — no camera and no hand-off.
- The spec pins the count: **exactly one scanner and exactly one file input**,
  empty shelf and populated.

⚠️ **`licence-pack/bulk-capture.tsx` IS ORPHANED AGAIN.** It was the only door
to the "we filed this as X — change it" correction, and removing the panel's
visible half took its mounting point with it. The correction wants a home on
the shelf tile itself; until it has one, a mis-classified document cannot be
re-filed from this surface. `onRefile` is still on the page, unused.

**Verified on production against MO000067:** one scan control, one file input,
no "Choose files instead", no "or choose files", no "ADD A DOCUMENT" panel.

### The invite bug and the shelf — 2026-09-08, `e75ac24b`

⚠️ **THE SELLER-CONSENT INVITE HAD NEVER WORKED.** Reported from the live
sheet: "Send them the link" returns *"Enter a valid email address for them."*
over a form with **no email field**. The server is right to want one —
`motivation-seller-consent.service.ts` argues it deliberately ("BOTH, NOT
EITHER … the email carries the link … the number is the nudge") — and the panel
simply never asked: no input, no state, and **no `email` field in the API
client's own body type**, so the request could not have carried one.

⚠️ **THIS IS THE SECOND TIME THE SAME FUNCTION HAS DONE THIS.** The comment
directly beneath that check describes the first: the invite used to demand a
serial number that was `formOnly` and therefore off-screen on the default
path — *"The refusal named a box that was not on screen anywhere."* There is
now `components/motivation-seller-consent.spec.tsx` pinning the shape of the
request against what the server requires, and the button's own gate mirrors the
server's checks rather than enabling into a refusal.

Also in this deploy:

- **The shelf's second tile is "Upload"**, with a tray-and-arrow icon, not
  "+ Add". Operator, 2026-08-24 and again 2026-09-08: *"replace the Add button
  with two buttons, Upload and Scan with phone (Use Icons)."* The empty
  shelf's "Choose files instead" line became a bordered button beside the
  scanner for the same reason.
- **The SAPS 271 meter says "N boxes still empty"**, not "N still needed". It
  counts boxes on the form; the strip, the chip dots and the footer count
  required registry keys. Two honest measures, both saying "still needed" and
  totalling differently, read as the page contradicting itself.
- **The 271's own boxes on "You" fold to the bottom** — postal address, a
  postal code per address, dialling codes split from their numbers. ⚠️ **Folded,
  never deleted:** each is a real box on a statutory form. On the live sheet
  "Postal address, if different" sat open, marked Optional, prefilled with the
  SAME address as residential.

**Verified on production against MO000067:** the shelf shows the wide scan tile
plus **Upload from this device**; the consent card carries **Their email
address**; "You" carries one fold, *"Post and dialling codes · 5 rows"*; the
meter reads *"6 boxes still empty"* and the old wording is gone.

### ⚠️ MO000066 was deleted by the operator, and that is the feature working

The one motivation is now **MO000067** (DRAFT, empty vault). MO000066 and its
four uploads were erased at ~11:02 SAST on 2026-09-08, between the
`104039` and `111735` dumps, using the Delete button shipped in `3f6a8fac`.
The cascade behaved as documented and **the Document Centre was untouched** —
20 `Credential` rows survive (5 firearm licences, 5 competency, 8 proficiency,
1 ID, 1 address), exactly as the confirmation dialog promises.

⚠️ **`Motivation.createdAt` is stored UTC while `psql now()` renders SAST.**
That two-hour offset made the delete look like it happened before it did, and
cost a real detour. Read the backups, not the column, when you need a sequence.

### The sheet fixes — 2026-09-08, `9c339ac8` → `95365781`

A live walkthrough of MO000066 (S16 dedicated hunter, five owned firearms,
four documents) found the review sheet **26,351px tall — 27.7 screens — with
351 form controls**, and Chrome's renderer timed out screenshotting it. Four
deploys, in this order, each with the full gate and its own health check.

**`9c339ac8` — copy and layout.**
- ⚠️ **`sourceLine()` was misspelling every make read off a licence.** It
  lower-cased character 0 of the provenance string, so five owned-firearm rows
  read "from mAUSER .30-06 SPRINGFIELD", "from hOWA 6.5MM CREEDMOOR", "from cZ
  6.35MM BROWNING". It now leaves alone any string carrying a capital of its
  own. Extracted to `source-line.ts` because `competency-lines.tsx` held a
  second copy of the same arithmetic.
- A text row printed `item.help` as the input's placeholder **and** again
  beneath it. Selects and dates keep the line; they have no placeholder.
- The competency help was five sentences inside a 44px box.
- "Six questions everybody is asked" above five. The registry's six is right —
  `history_negligence` is conditional — so the wrong word was "everybody".
- ⚠️ **`main` carried `lg:mx-0` for a grid parent that was never built.** At a
  2133px viewport the sheet sat at x=0 with 1,373px of white beside it;
  `.gg-shell-pane` measures 0 wide. SPEC-BUILD §3's two-column grid now exists
  while the preview is open, and `main` centres itself otherwise.

**`3f6a8fac` — a member can delete an application again.**
⚠️ **Phase 4 deleted both wizards and took the only delete control with them.**
`delete-application.tsx` had been imported by nothing but its own spec ever
since. It is now an outlined 44px button with a trash glyph — mounted on the
sheet past the sticky footer, and on every row of the applications list as a
**sibling** of the `Link` (a `<button>` inside an `<a>` is invalid HTML and the
browsers that tolerate it still follow the link). The confirmation dialog was
already load-bearing and is unchanged: `DELETE :id` is self-serve POPIA
erasure, and it says what survives as well as what goes.

**`0da85116` — the firearm route, and the seller's scanner.**
⚠️ **The seller-consent scanner was built, deployed and unreachable.**
`/consent/[token]` step 1 is "Photograph your licence — both sides of the card
for this firearm". The card that links to it renders only on a private sale,
and `firearm_source` was **Optional and fifth of seventeen rows**, so it was
never answered: the applicant hand-typed make, model, calibre and seven serial
rows for a firearm whose card they have never held, while the pack meter
pleaded "Tell us where the firearm is coming from".
- `firearm_source` is now the **first** row of its section and **required**.
  Three registry comments and its own spec already asserted it was required.
  Safe because `NOT_ASKED_BY_TYPE` excludes S24 — a renewal has no dealer and
  no seller — and there is now a spec pinning that.
- The consent and overlap cards are emitted under the source row, per
  SPEC-BUILD §8.3/§8.4. They used to render after every row in the section.
- New `sheet-disclosure.tsx`. First use: the six barrel/frame/receiver rows
  fold behind one line naming whoever actually fills them in.

**`95365781` — the folds.**
- `sheet-section.tsx` collapses. The heading stays an `<h2>` with a button
  inside it so the page keeps its outline; children are **unmounted**, not
  hidden. Controlled, so a chip can open what it scrolls to.
- Every closed section carries its own "N still needed" from the **same**
  `missing` list the pill, the chip dots and the footer read.
- The opening fold is the first section that still owes something, computed
  **once** — recomputing on each post-save refetch would close a section
  somebody had just opened.
- ⚠️ **One fold per owned firearm, and nothing at all for the rows nobody
  owns.** Which rows exist is `sheet.ownedRows`, new on the sheet response and
  built with the backend's own `ownedRowTaken`. Deciding it in the browser
  would make the page a fourth reader of "is this row in use", and that
  function's note records what happened last time its readers disagreed.

**Verified in Chrome on production, signed in, against MO000066:**

| | Before | After |
|---|---|---|
| Document height | 26,351px | **3,060px** |
| Form controls mounted | 351 | **10** |
| `main` at a 2133px viewport | x=0, 760px | **x=678, centred** |
| "Firearms you own" | 15,840px, 14 rows flat | **546px, 5 folds** |
| "from mAUSER …" | 5 rows | **0** |

Selecting "From a private owner" renders the consent card with **Send them the
link**, and the component fold's note becomes "The seller fills these in when
they photograph their licence". That answer was set only to prove the path and
was **put back to blank**; the application is otherwise as it was found.

⚠️ **Not verified: the phone.** `resize_window` reported success but the
Chrome window would not leave 2133px, so every measurement above is desktop.
The narrow layout is the default and nothing in these four commits is
`lg:`-only except the grid — but the new fold headers (title + "N still
needed" on one 44px row) have not been seen at 390px.

Last pre-deploy dump: **`alloutdoor-20260908-104039.dump`**.

### The follow-up deploy — 2026-09-08, `fe78bd12`

Two things the operator found on the live sheet within minutes of `7f2b2628`
going up. Both were in the shelf, and both were shipped by me.

1. **⚠️ THE DOCUMENT SHELF HAD NO SCANNER.** The empty-state tile read "Scan
   with your phone or choose files" and the door behind it held a file picker
   and nothing else. On a laptop, with a licence card in hand, there was no way
   to photograph it — the copy promised a capability that was never wired.
   `add-panel.tsx` now mounts `ScanButton` (`handoff={{ dest: 'motivation',
   motivationId }}`, `shape="a4"`), and `document-shelf.tsx` takes `onScan`
   alongside `onAdd` and renders a **Scan tile before the Add tile**, so the
   camera is reachable in one tap rather than two.
   ⚠️ **`ScanButton` decides the surface and nothing outside it may.** It offers
   the phone hand-off on a desktop and the on-device camera on a handheld,
   because a laptop webcam cannot resolve a licence serial. The Scan tile sets
   `autoScan`, which goes through its own `autoStart` — an earlier attempt
   elsewhere forced its `open` state from outside and opened a webcam behind a
   button reading "Scan with phone".
2. **The tiles printed raw enum names.** `motivation-sheet.service.ts` shipped
   `label: u.kind`, so the shelf rendered `ADDRESS_CONFIRMATION` and
   `PROFICIENCY_CERTIFICATE`, clipped to `ADDRESS_CO` in a 72px tile. It now
   reads `UPLOAD_KIND_LABELS[u.kind] ?? u.kind` — the member's words, with the
   raw kind only as a last resort so a new kind degrades rather than vanishes.

Full deploy (the diff touches `backend/`). tsc clean both sides; backend
**4041/4053**, frontend **1562/1563**, 0 failed; frontend build exit 0 in the
foreground with `.next/BUILD_ID` present. `deploy.sh` clean end to end — backup
**`alloutdoor-20260908-093317.dump`** (the rollback point), backend health ×2,
frontend health ×2, warden reloaded and online, public site 200 ×2, three pm2
services online, box HEAD `fe78bd12`, `prisma migrate status` up to date with
nothing pending.

### What Phase 4 did — the old surfaces are gone

**Deleted:** `app/motivations/**` and `app/licence-services/**` (both wizards);
eight top-level components (`motivation-step-nav`, `motivation-step-rail`,
`motivation-template-picker`, `motivation-template-preview`,
`motivation-checklist-panel`, `licence-centre-motivations`,
`licence-centre-offer-panel`, `motivation-field-input`); sixteen files under
`components/licence-pack/` (`field-grid`, `pack-row`, `pack-group`,
`pack-section`, `step-answers`, `follow-up-thread`, `prefill-banner`,
`proficiency-alert`, `offer-notes`, `capture-cards`, `wizard-rail`, + specs);
ten files under `lib/` (`motivation-step-plan`, `licence-services-preview`,
`wizard-coverage`, `wizard-document-coverage.spec`, `wizard-step-offset.spec`,
`motivations-grouping.spec`, `follow-up-rules.spec`,
`vault-prefix-coverage.spec`); the four prefill-offer endpoints and their
facade delegators; and the four client calls behind them.

**Redirects (301, permanent):** `/motivations` and `/licence-services/new` →
`/licence-centre/applications`; `/motivations/:id` and `/licence-services/:id`
→ `/licence-centre/:id`. Pinned by `lib/redirects.spec.ts`, whose most
important case asserts an ABSENCE: **`/licence-centre` must NOT redirect**, or
every licence-expiry reminder lands on a list of applications.

**The flag is gone** — `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED`,
`PACK_SCREEN_SHIPPED` and `canOpenPackScreen()` have no references left.

**Links repointed, not left to the redirect:** `notifications.service.ts` was
still BUILDING `/licence-services/[id]` into every "your document is ready" SMS
and inbox row. Also the account menu, the account page's promoted tile, and
`delete-application`'s post-delete push. The old paths still 301 for links
already in inboxes; a link sent today should not need one.

⚠️ **`read-result.tsx` was deleted even though §4 lists it as reuse.** It
imported `motivation-field-input` and `step-answers`, both of which §3 names
explicitly as NOT reused, and it is step-shaped (`stepKey`) on a surface with
no steps. Its job is done by `sheet-toast.tsx` plus rows changing state in
place. Recorded in `components/licence-pack/README-phase4.md`.

⚠️ **Specs were re-pointed rather than deleted wherever the RULE survived.**
`licence-types-coverage.spec.ts` needed no assertion changes at all — it
compares `LICENCE_TYPES` to the SERVER'S registry, never to a screen, so it
survived the surface being replaced underneath it. The four provenance cases
that went through `useLicenceCentre`/`useProfile` now call
`MotivationPrefillService` directly: the delegators died, the rule they
protect (a vault value is stamped VAULT with the credential's id, a profile
value PROFILE with none) did not.

### ⚠️ One capability lost in Phase 4, and it is not a bug to fix blind

`create()` applies the profile and the vault automatically, in the documented
order, so a NEW application still opens prefilled. But a member who adds a
licence to their vault **after** starting an application no longer has any way
to pull it in — that was what `POST :id/use-licence-centre` did behind a
button. `MotivationPrefillService.licenceCentreOffer/useLicenceCentre` still
exist and still work; **nothing calls them.**

The right answer is for the sheet to re-run the vault offer on load, with
provenance, and never over a MEMBER value — but that is design work with a
real risk of overwriting somebody's answer, not a Phase 4 deletion. Left as
the operator's call rather than guessed at.

### What is left in `components/licence-pack/`

Eleven files, per brief §4's reuse list, and only three are reached today
(`saps271-meter`, `yes-no-pills`, `bulk-capture`). The rest are pack-page
furniture waiting on the follow-on panels. `README-phase4.md` in that
directory says which is which — an orphaned component is not evidence of a
live feature.

⚠️ **Nothing was MOVED into `components/licence-centre/`.** SPEC-BUILD §4 asks
for that in Phase 4; it is cosmetic, it would touch every import, and the
directory now carries a README explaining itself. Deferred deliberately rather
than forgotten.

### Verification

Backend `npx tsc --noEmit` CLEAN, `npm test` **4041 passed / 4053** (235 suites;
8 skipped, 4 todo, 0 failed) against a measured pre-Phase-1 baseline of
4020/4032. Frontend `npx tsc --noEmit` CLEAN, `npm test` **1561 passed / 1562**, and
`npm run build` **exit 0** with `.next/BUILD_ID` present (so desk-guard,
desk-cutover and theme-sync all passed). The build lists exactly four routes:
`/licence-centre`, `/licence-centre/applications`, `/licence-centre/[id]`,
`/licence-centre/[id]/pack`.

⚠️ The frontend count fell from 1736 because Phase 4 deleted the two wizards
and the ~175 tests that existed only to guard them — the wizard rail, the
field grid, the step plan, the follow-up thread and the four wizard-coverage
suites. Every deletion was checked against whether the RULE survived; where it
did, the spec was re-pointed instead.

⚠️ **A STALE `.next/dev/types/validator.ts` FAILED THE BUILD** after the routes
were deleted, referencing pages that no longer exist. It is a `next dev`
artefact, not a source problem, and a fresh checkout has none — but it is the
same class of trap CLAUDE.md warns about with `.next/cache` surviving a
rebuild. If a build fails on a missing `app/...page.js` right after a route is
deleted, that is what it is. **Not deployed, not committed.**

⚠️ The backend count DROPPED from Phase 2's 4113 because Phase 1B deleted 44
Textract tests whose subject is gone — `textract-document-extract.spec.ts` (24),
`licence-centre-extract-textract.spec.ts` (11) and `kyc/textract-extract.spec.ts`
(9) — plus three licence-centre specs whose subject was Textract's OCR quirks.
Each deletion was checked against whether the RULE survived: where it did, it is
covered elsewhere and the replacement is named in the tombstone comment.

Net test movement. Deleted with their subjects: `motivation-gaps.spec.ts` (8),
and the two free-text research blocks in `motivation-model.service.spec.ts`
(14) — whose privacy, grounding and fail-soft rules are all re-covered, more
strictly, in `motivation-research.service.spec.ts`. Added:
`motivation-cards.spec.ts` (15), `motivation-preview.spec.ts` (12),
`member-profile-answers.service.spec.ts` (11),
`motivation-sheet.service.spec.ts` (21), `motivation-research.service.spec.ts`
(29), plus extensions to the registry, overlap, 271, checklist and model
suites. **Every existing test that changed is annotated in place with why**,
per brief §2.7.

⚠️ `motivation-prompt-cache.spec.ts` was re-baselined TWICE — once in Phase 1
(S13 label renames) and once in Phase 2 (the halved word bands, all five
types). Both were content changes, which is what those hashes exist to catch,
so the baseline moved rather than the assertion being weakened. **All five line
counts held at 106/106/102/102/94 through both**, which is the check that each
was a rewording and not a loss.

### ⚠️ Three things the operator has to decide before Phase 2

1. **The brief and the code disagree about estate firearms.** Brief §5.3 and
   intake plan §1 say `SOURCE_ESTATE` fills Part F **Type E** from the
   `EXECUTOR_APPOINTMENT` letter and the executor signs items 79–87.
   `saps271-map.ts` says the opposite, and says it as a dated operator ruling:
   *"Only Type A and B from the 271 are what we will process"* (2026-08-29), so
   Type E is never ticked and 79–87 are written on **no route at all**
   (2026-08-28). The code was left alone and the checklist copy was written to
   match the code, not the brief. **This needs a ruling.**
2. **`existing_firearm_N_action` and `existing_firearm_N_section` do not
   exist.** The overlap engine's new action and section axes read them
   defensively and are therefore **inert** until those fields are added. The
   ranking works today off calibre class, firearm type and the tapped
   `primary_use`; the two new axes are wired and waiting.
3. **Phase 1B — drop AWS Textract, Gemini only.** Operator instruction
   2026-09-08, scoped to **everything including KYC**, timed for **after Phase 1
   sign-off**. Full file list in `PHASE-0-PLAN.md` §1B. Two things to know
   going in: it reverses `d90fbdcf` (Textract was put FIRST because a single
   Gemini vision pass on a real photograph was inconsistent — the replacement is
   a `responseSchema` call plus the existing two-attempt retry), and **AWS does
   not leave the codebase** because `aws-kyc.service.ts` couples Textract to
   Rekognition face-match and Face Liveness under one IAM policy.

`MotivationMessage` was counted read-only on production before the drop
migration was written: **0 rows**. Nothing was exported because there was
nothing to export.

---

## Where things stand

| | |
|---|---|
| Production runs | `245db6e2` on `feat/takealot-ux-parity` |
| Deploy branch (origin) | matches production — `245db6e2` |
| Feature branch | `feat/the-bench` — same tip; fast-forwarded into the deploy branch |
| Migrations | 67, all applied. Nothing pending. |
| Services | `alloutdoor-backend`, `alloutdoor-frontend`, `warden` — all online |
| Last pre-deploy dump | `alloutdoor-20260908-111735.dump` — the rollback point for `e75ac24b` |

**The platform is not trading.** 2 users, 2 listings, **0 transactions**, 1
motivation (MO000067), 20 credentials. Nothing has ever been sold. Checkout returns 503
because `PAYMENT_MODE` and `PAYMENTS_LIVE` are both unset.

### Worktrees — read this before running git

**One worktree: `C:/dev/gun-galore`.** Check out whatever branch you need here,
including `feat/takealot-ux-parity` when you deploy.

⚠️ **`feat/scanner-tracking` (df5ce66c) exists only locally and has never been
pushed.** It is the one branch with no copy anywhere else.

---

## What the last session did

**Two more fixes to the same thread, deployed as `67d53ba4` then `404dd6f9`.**

1. **A field read off the very first document an applicant uploads was
   silently discarded if it arrived before an unrelated later question was
   answered — deployed as `67d53ba4`.** The common order is upload the
   firearm's own licence first, then decide "who fills the SAPS 271" much
   later — but `firearm_serial`/`barrel_serial`/`frame_serial`/
   `receiver_serial` only exist on screen once that question is answered
   "Fill it in for me" (they are `formOnly`). `readFirearm()`'s output was
   filtered by that visibility BEFORE anything was offered or stored, so a
   serial read off the first upload was gone for good by the time the
   question was answered — nothing re-reads a document once it is attached.
   Operator: "why can't it just cache the information until I make a
   selection because the fucking selection is the last mother fucking thing
   on the god damn list."

   Fix, `motivation-documents.service.ts`: every readable field is now kept
   (`readable`) regardless of current visibility; only the immediate
   upload-response `suggestions` stay visibility-gated, so the confirmation
   panel still never lists a box the applicant cannot find. And on the
   frontend, `licence-services/[id]/page.tsx` now checks every attached
   document's stored reading (`GET :id/uploads/:uploadId/reading` — no
   vision call, the same endpoint the phone hand-off already used) the
   moment "Fill it in for me" is answered, and offers anything still
   unanswered through the same review panel.

2. **Removed `barrel_length` from the motivation form — deployed as
   `404dd6f9`.** Operator: not necessary. Was already optional (no
   required-field cascade). Registry field + the frontend's frozen
   `registry-keys.json` fixture only; everything else matching "barrel
   length" in a repo-wide search turned out to be an unrelated concept —
   the comprehensive-pack PDF spec-sheet feature (`firearmSpec`),
   shooting-discipline rule text, and marketplace listing-question prompts
   each use the same words for a different thing.

Full deploy both times (diff touched `backend/`): tsc clean both sides,
backend tests 4020/4032 passed, frontend tests 1675/1676 passed, frontend
build exit 0, `deploy.sh` clean end to end each time — backups
`alloutdoor-20260907-211448.dump` then `alloutdoor-20260907-215338.dump`, no
pending migrations, backend health ×2, frontend health ×2, warden reloaded
and online, public site 200 ×2.

---

## What the session before that did

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

## What two sessions ago did

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

## What three sessions ago did

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

- **One variable serving two jobs — "what to offer right now" and "what to
  persist" — means a filter added for the first reason silently breaks the
  second.** `readFirearm()`'s consumer in `addUpload()` pushed every field
  into one `suggestions` array, gated by `visible` so the confirmation panel
  never listed a box the applicant could not find on screen. That gate had
  nothing to do with persistence, but because the SAME array was what got
  encrypted and stored, a field that was true and correctly read was thrown
  away before it ever reached the database — not shown late, gone. This is
  the second bug this exact function produced from one array doing two
  jobs (see the "session before that" entry below for the first). Once
  found once, it is worth checking every other place a "what did we read"
  value and a "what do we show" value share one variable.

## Traps found the hard way the session before that

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

## Traps found the hard way three sessions ago

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
