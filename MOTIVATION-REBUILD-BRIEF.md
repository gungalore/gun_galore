# Motivation Centre rebuild: brief for Claude Code

Date: 2026-09-07. Operator: Gerhard. This is the single entry point. Read it fully, then
`MOTIVATION-INTAKE-PLAN.md` (question model) and `MOTIVATION-UX-REVIEW.md` (what is wrong
with the live screens). Where the three disagree, this file wins.

Work in the pattern this repo already uses: spec, then phased execution with a sign-off
gate between phases. Do not start Phase 2 until the operator has approved Phase 1 output.
Follow the `codelean` skill: state task, size and model before each phase; no subagents or
Opus without a yes; minimal diffs inside reused code.

---

## 1. What we are building

One new frontend surface, `/licence-centre`, that replaces BOTH existing motivation
front-ends. It is a **pre-filled review sheet**, not a wizard and not a questionnaire: one
scrolling page per application, sections anchored, every item shown in the state it is in
(filled from a document, suggested, needs you), reasons chosen by tapping cards, documents
on one shelf at the top, and a live preview of what the motivation will say.

The backend is kept. It is 100+ files of working extraction, prefill, vault, consent,
witness, PDF, SAPS 271 and generation code with a large test suite. It is reshaped, not
rewritten: fields change in the registry, the follow-up interview goes, the writer gets a
research layer, and a handful of endpoints are added or reshaped for the new screen.

## 2. Non-negotiables

1. **The applicant is never asked what the internet, a document or their profile can
   answer.** Firearm capability, calibre role, discipline rules, species and ranges,
   precinct crime figures, association exercises: research. Name, ID, address, employer,
   competency, owned firearms, association, dedicated since: documents and vault. Marital
   status, premises security, what each owned firearm is for, reloading: profile, asked
   once ever.
2. **"Why do you need this firearm" is never a question.** The writer composes the need
   from the licence type, the firearm, the overlap analysis against owned firearms, the
   research layer and the reason cards the applicant tapped. Generic is fine; every
   approved pack on file is generic here. The applicant's own words are optional and
   prefilled.
3. **The follow-up interview ("Boet") is removed.** No model ever asks the applicant a
   question. If a required fact is missing, the sheet shows the empty input; that is the
   whole mechanism.
4. **Selected means true.** Reason cards are first-person sentences; only tapped cards
   reach the writer. Tier 3 facts (names, dates, incidents, records) come only from
   documents or the applicant's explicit input. FCA s120(9)(f) is why.
5. **The SAPS 271 is always produced.** No opt-in. Part F is filled by source route
   (dealer: blank; private: from the seller consent; estate: from the executor letter).
   S24 gets no 271 (518(a) later).
6. **Nothing the writer must not see reaches it.** `NEVER_PROMPTED` and the fact-pack
   builder keep doing that job. `formOnly` stops deciding what is asked.
7. **All existing backend tests stay green or are updated with a stated reason.** The
   registry-integrity, wizard-coverage, saps271 and prompt-discipline suites are the
   contract; extend them, do not delete them.

## 3. Delete

Delete outright, in Phase 4 once the new surface is at parity. Do not wire the new surface
into either of them at any point.

Frontend:
- `frontend/app/motivations/page.tsx`, `frontend/app/motivations/[id]/page.tsx`
- `frontend/app/licence-services/new/page.tsx`, `frontend/app/licence-services/[id]/**`
- `frontend/components/licence-pack/**` (see §4 for the few files that move first)
- `frontend/components/motivation-step-nav.tsx`, `motivation-step-rail.tsx`,
  `motivation-template-picker.tsx`, `motivation-template-preview.tsx`,
  `motivation-checklist-panel.tsx`, `licence-centre-motivations.tsx`,
  `licence-centre-offer-panel.tsx`
- `frontend/lib/motivation-step-plan.ts`, `licence-services-preview.ts` (+spec),
  `motivations-grouping.spec.ts`, `licence-types-coverage.spec.ts`
- the `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED` flag and `canOpenPackScreen()`
- redirects: `/motivations` and `/licence-services/*` 301 to `/licence-centre` and
  `/licence-centre/[id]`

Backend:
- the follow-up interview: `motivation-gaps.ts` (+spec), `gapBrief`, `fallbackQuestion`,
  `FOLLOW_UP_BATCH`, `queueFollowUps`, `listMessages`, `answerFollowUp`, the
  `@Get(':id/messages')` and `@Post(':id/messages/:messageId')` endpoints,
  `MODEL_FOLLOWUP` / `ANTHROPIC_MODEL_MOTIVATION_FOLLOWUP`, the `MotivationMessage`
  table (migration: drop after export; there is no production data worth keeping, confirm
  with operator)
- `fill_saps271` (`SAPS271_OPT_KEY`) as an asked field; keep it accepted in
  `sanitiseAnswers` for old blobs
- the `formOnly` branch in `isVisible()`
- `motivation-templates.ts` template picker semantics if the only consumer was the
  deleted picker (check; the PDF layouts may still use it)
- `@Get(':id/profile-offer')`, `@Post(':id/use-profile')`,
  `@Get(':id/licence-centre-offer')`, `@Post(':id/use-licence-centre')` collapse into the
  single sheet endpoint in §5.2 (prefill becomes automatic with provenance, per the
  operator's 2026-08-25 rule: fill it in, arm it, let them change it)

## 4. Reuse as-is (move, do not rewrite)

Backend, untouched unless §5 names it:
`motivation-fields.ts` (registry, edited per §5.1), `motivation-field-options.ts`,
`shooting-disciplines.ts`, `motivation-eligibility.ts`, `motivation-credentials.ts`,
`motivation-prefill.service.ts`, `motivation-profile.ts`, `prior-readings.ts`,
`vault-adoption.service.ts`, `motivation-documents.service.ts` + `motivation-documents.ts`,
`motivation-extract.service.ts`, `licence-card-ocr.service.ts`, `motivation-autolink.ts`,
`motivation-library.ts`, `motivation-upload-row.ts`, `motivation-overlap.ts` (extended
§5.4), `motivation-seller-consent.service.ts`, `motivations-consent.controller.ts`,
`motivation-witness*.ts`, `motivations-witness.controller.ts`,
`motivations-scan.controller.ts` and the phone scanner under `frontend/app/scan`,
`motivation-cover-photo.ts`, `motivation-firearm-image.ts`, `motivation-checklist.ts`,
`motivation-statute.ts`, `motivation-structure.ts` (edited §5.6), `motivation-prompts.ts`
(edited §5.6), `motivation-model.service.ts`, `motivation-generation.service.ts`,
`motivation-render.service.ts`, `motivation-pdf*.ts`, `motivation-annexure-layout.ts`,
`motivation-prior-notice.ts`, `motivation-character-statement.ts`,
`motivation-consent-statement.ts`, `saps271-*.ts` (F-by-route added §5.3),
`sa-id.ts`, `saps-vocabulary.ts`, `motivation-quota.service.ts`,
`motivation-retention.service.ts`, `motivation-pricing.ts`, `motivation-verify.ts`,
`common/answer-provenance.ts`, `common/llm/*` (Gemini and Anthropic providers),
`crime-stats`, `news` (press clippings).

Frontend components that move into the new surface (rename paths, keep logic):
- `components/document-centre/*` (credential-card, doc-thumb, document-row, kinds,
  review-screen, confirm-panel, section) — this is the shelf
- `components/motivation/upload-panel.tsx`, `qr-icon.tsx`, `provenance.tsx`,
  `precinct-card.tsx`, `station-picker.tsx`, `clippings-picker.tsx`,
  `suggested-documents.tsx`
- `components/licence-pack/extraction-review.tsx`, `read-result.tsx`,
  `attached-documents.tsx`, `bulk-capture.tsx`, `saps271-meter.tsx`,
  `owned-firearm-summary.ts`, `empty-answer.ts`, `yes-no-pills.tsx`,
  `delete-application.tsx`, `pack-finish.tsx`, `section-chooser.tsx`
- `components/motivation-seller-consent.tsx`, `motivation-witnesses.tsx`,
  `motivation-cover-photo.tsx`, `motivation-cover-cropper.tsx`, `vault-consent.tsx`,
  `document-centre-add.tsx`
- `lib/motivations-api.ts`, `licence-centre-api.ts`, `licence-labels.ts`,
  `motivation-draft.ts`, `motivation-item-groups.ts`
- the scanner (`frontend/app/scan/**`) and the seller consent / witness pages
  (`frontend/app/consent/**`, `frontend/app/witness/**`, `frontend/app/documents/**`)

Not reused: `field-grid.tsx`, `pack-row.tsx`, `pack-group.tsx`, `pack-section.tsx`,
`step-answers.ts`, `follow-up-thread.tsx`, `prefill-banner.tsx`, `proficiency-alert.tsx`,
`offer-notes.ts`, `capture-cards.tsx`, `wizard-rail.tsx`, `motivation-field-input.tsx`
(the collapsed-row input; the new row component replaces it).

## 5. Change

### 5.1 Registry (`motivation-fields.ts`)
Implement `MOTIVATION-INTAKE-PLAN.md` §5 exactly, plus:
- `kind: 'cards'` with `options: { key; sentence; rankBy?: 'calibre'|'association'|
  'precinct'|'occupation' }[]`, stored as a comma list like `multi`.
- `scope: 'profile' | 'application'` (default application). Profile-scoped keys:
  `marital_status`, `spouse_*`, `residence_type`, `postal_address`, `*_telephone`,
  `cellphone`, the new `'Your premises'` section, `reloads` (+ `reload_calibres`,
  `reload_since`), `existing_firearm_N_primary_use`.
- New `'Your premises'` section (plan §3.6). `safe_*` move into it.
- Long fields listed in plan §4 become optional. None is required any more except
  nothing: `required` on `long` fields is removed everywhere. The writer must produce a
  complete document from cards + documents alone.
- Reason-card sets per licence type from plan §3.7, as `kind: 'cards'` fields:
  `s13_reasons`, `s13_movements`, `s13_carry_style`, `hunt_game_class`, `hunt_terrain`,
  `hunt_where`, `hunt_reasons`, `sport_reasons`, `sport_formats`. Card sentences live in a
  new `motivation-cards.ts` beside `shooting-disciplines.ts`, one exported constant per
  set, so the operator can review wording in one file.
- `showIf` gains `hasAny` for card values (a `cards` field with at least one tap).
- `FIELD_REGISTRY_VERSION` bump with the dated comment the file's rule requires.

### 5.2 API for the sheet
Add one read endpoint that returns everything the page needs in one call:
`GET /motivations/:id/sheet` → `{ application, sections[], items[], documents[], coverage,
overlap, preview, missing }` where each item is `{ key, label, kind, state:
'filled'|'suggested'|'needs_you'|'na', value, provenance, options?, cards? }`. Build it in a
new `motivation-sheet.service.ts` that composes the existing prefill, documents, coverage
and overlap services; no new logic in the controller. Profile-scoped answers read and write
through a new `MemberProfileAnswers` (encrypted like `answersEncrypted`, provenance
`'PROFILE'`); `PATCH :id/answers` keeps its contract and routes profile-scoped keys to the
profile store.

Keep `POST :id/generate`, `GET :id/draft`, `GET :id/pdf`, `GET :id/saps271`,
`GET :id/pack`, `GET :id/checklist`, the uploads, library, autolink, cover-photo,
precinct, incidents, declaration and abandon/delete endpoints unchanged.

Add `GET /motivations/:id/preview`: templated prose (no model call) from the current fact
pack, one paragraph per section, for the live "what your motivation will say" drawer.
Pure function in `motivation-preview.ts`, tested.

### 5.3 SAPS 271
`saps271.service.ts`: remove the opt-in check; fill D, G, H always; fill E from
`firearm_*`; fill F by `firearm_source`: `SOURCE_DEALER` leaves F blank and sets a cover
note; `SOURCE_PRIVATE` fills F 81-87 from the seller consent record; `SOURCE_ESTATE` fills
Type E from `EXECUTOR_APPOINTMENT` reading. Render the F page into the seller consent
link so the seller signs it with the consent. `saps271-coverage.ts` needs only the
removal of the gate.

### 5.4 Overlap and primary use
Extend `motivation-overlap.ts` with the type / action / section axes and a
`suggestedAngle` output (narrative engine §4.2-4.5). Keep exact-match tables, keep
"unknown → ask". Feed `existing_firearm_N_primary_use`. Surface the angle as a card in
the Firearm section: "This one will be my ___" with ranked options; the confirmed angle is
what the writer leads the comparison section with.

### 5.5 Research layer (Gemini)
New `motivation-research.service.ts` using `common/llm` with the Gemini provider and
search grounding. Targets and cache keys from narrative engine §4A: firearm model
capability (`make|model|calibre|use_class`, TTL 180 days), calibre role, discipline
specification (keyed to `shooting-disciplines` entry), species and range bands per game
class and province, precinct stats (existing `crime-stats`). Output is paraphrased,
source-attributed, stored in the fact pack under `research{}` so the trace gate treats it
as ledger content. The Anthropic writer never searches. Cache is a `MotivationResearch`
table keyed as above; a hit costs no call.

### 5.6 Writer
`motivation-prompts.ts` and `motivation-structure.ts`, per `MOTIVATION-UX-REVIEW.md` §3:
- length bands: S13 900-1400, S15/S16 1200-1800, S24 600-900
- cadence fixed to `plain`; drop `CADENCES` randomisation and the `OPENINGS` pair; keep
  the similarity detector as a test-time guard only
- headings fixed to the twelve the approved packs use; `HEADING_ALTERNATES` becomes a
  single title per section
- the writer receives: fact pack, tapped cards (as first-person sentences it may use
  verbatim), `research{}`, overlap angle, and the statutory text; it writes only the
  argument paragraphs
- rendered from data, not from the model: page-1 particulars block, owned-firearms
  table, S13 existing-measures list, statutory quote (from `motivation-statute.ts`,
  quote-then-apply), annexure index, and the page-2 "take this to SAPS" checklist from
  `motivation-checklist.ts` by section and source route
- gate rubric unchanged; `thinFields` no longer triggers questions, it only lowers the
  score and is logged

### 5.7 Profile capture at vault time
When a `CURRENT_LICENCE` is adopted into the vault (`vault-adoption.service.ts`), the
Document Centre asks `primary_use` for that firearm once (card row with calibre-derived
suggestions). Reloading is asked once on the first application and stored on the profile.

## 6. The new surface: `/licence-centre`

Routes: `/licence-centre` (list + start), `/licence-centre/[id]` (the sheet),
`/licence-centre/[id]/pack` (deliverables and print). Mobile first, single column; desktop
is the same column at 760px with the preview drawer docked right.

### 6.1 Page anatomy (`/licence-centre/[id]`)
1. **Sticky header**: reference (MO000066), licence type, one progress figure ("9 things
   left" or "Ready to write"), section jump chips, "Preview" toggle.
2. **Document shelf**: horizontal thumbnails with annexure letters, one "Add" tile that
   opens the phone-scanner QR / file picker (`upload-panel.tsx`, `bulk-capture.tsx`).
   Anything dropped here is classified and read; results appear as a toast and as item
   state changes below. No per-section upload doors.
3. **Sections**, in this order, each a heading and a list of item rows:
   Firearm · You · Competency · Firearms you own · Premises and storage · Your case ·
   Declarations · Your pack.
4. **Item row** (`sheet-row.tsx`, the one component that replaces field-grid and
   motivation-field-input):
   - `filled`: value in full (never masked on the applicant's own screen), source chip
     ("licence card", "ID document", "your profile", "last application"), "Change".
   - `suggested`: amber, value, "Confirm" / "Change".
   - `needs_you`: the input rendered open (select, text, date, yes/no pills, cards). Real
     placeholders in the shape of the answer. Never "You may know it".
   - `na`: not rendered.
   - `cards` kind: tile grid, multi-select, one sentence per tile, ranked; an optional
     "in your own words" textarea below the tiles, prefilled from the tapped tiles.
5. **Preview drawer**: `GET :id/preview` rendered as the document's sections; updates on
   every saved answer (debounced). This is how the applicant sees that a tap changed a
   sentence.
6. **Footer bar**: "Write my motivation" (disabled with the count of missing required
   items until zero), and nothing else.

### 6.2 Behaviour
- Autosave on change (existing `PATCH :id/answers` contract; whole blob, as today).
- Profile-scoped rows show "saved to your profile" on their chip and are pre-filled on
  the next application.
- Overlap card appears in Firearm as soon as make/calibre are known.
- Private sale: the seller consent card sits in Firearm under the source row with its
  status (`motivation-seller-consent.tsx`), including the pre-filled F page.
- Declarations: six yes/no pill rows, "No" not first; a Yes opens its detail textarea and
  the four form boxes inline.
- After generation: `/licence-centre/[id]/pack` shows the motivation (readable in-page,
  not only PDF), the 271 preview, the checklist, the annexures, cover photo choice
  (`motivation-cover-photo.tsx`), witnesses (`motivation-witnesses.tsx`), print.
- Empty vault first-timer: the page is the same; more rows are `needs_you`, the shelf is
  empty with the Add tile large. No separate onboarding wizard.

### 6.3 Copy rules
Plain South African English, second person, no legalese in labels, no exclamation marks,
no emoji. Section blurbs one sentence. The only red button is "Write my motivation".

## 7. Phases and gates

**Phase 0 — Read and confirm (no code).** Read this file, the two companion docs,
`Motivation.md`, `CLAUDE.md`, `HANDOFF.md`. Produce a file-by-file plan for Phases 1-4
listing every file created, edited, moved, deleted, with the test that covers it. Stop
for sign-off.

**Phase 1 — Backend reshaping.** §5.1, §5.2, §5.3, §5.4 and removal of the follow-up
interview (§3 backend). All backend suites green. Nothing on the frontend changes yet;
the old screens keep working against the reshaped API where they still can (they will
lose the 271 question and follow-ups, which is acceptable for the days this takes).
Stop for sign-off.

**Phase 2 — Research layer and writer.** §5.5, §5.6, §5.7. Generate one motivation per
licence type against the operator's own vault and put the five PDFs in `docs/history/`
for review. Stop for sign-off; the operator reads them.

**Phase 3 — New surface.** §6 in full at `/licence-centre`, behind nothing (it is a new
route). Moved components per §4. Playwright: start each licence type, reach "Write my
motivation" with a populated vault in under 20 interactions, and with an empty vault
complete the sheet end to end. Stop for sign-off.

**Phase 4 — Delete and redirect.** §3 frontend deletions, redirects, flag removal,
`MotivationMessage` drop, dead endpoints. `docs/` and `HANDOFF.md` updated. Coverage
suites re-pointed at the new surface.

Each phase ends with a `HANDOFF.md` entry and a `/clear`.

## 8. Acceptance

- A member with a populated Document Centre completes an S16 sport application with no
  more than 12 taps and zero typing, and the generated motivation passes the gate first
  time.
- An empty-vault first-timer sees every unanswered item as an open input on one page,
  never a hidden row.
- No screen, prompt or endpoint asks the applicant why they need the firearm, what the
  firearm is capable of, or anything printed on a document they have uploaded.
- The pack always contains a 271 with D, G, H complete; F per route.
- The six history questions are asked of every applicant; a "No" never reaches the
  writer; a "Yes" always does.
- Old routes redirect; no code path references `fill_saps271` as a question, `Boet`, or
  `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED`.
- Word count of a generated S16 is between 1200 and 1800; headings match the fixed
  twelve; particulars, battery, annexure index and checklist render as tables from data.

## 9. Open items for the operator, answer before Phase 1
1. Confirm `MotivationMessage` can be dropped without export.
2. Card wording review: after Phase 1, `motivation-cards.ts` goes to you before Phase 3.
3. Research provider: Gemini with search grounding through `common/llm` as specified, or
   the existing Anthropic search path in `motivation-model.service.ts`? Brief assumes
   Gemini for cost.
4. 518(a) for S24: out of scope for this rebuild unless you say otherwise.
