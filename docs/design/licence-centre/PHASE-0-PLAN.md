# Motivation Centre rebuild — Phase 0: the file-by-file plan

Date: 2026-09-08. Branch: `feat/the-bench`. Author: build session.
Answers `MOTIVATION-REBUILD-BRIEF.md` §7 Phase 0. **No code has been written.**

**Revision 2, 2026-09-08** — updated for the brief's §0 amendments table (commit
`e6e7e592`) and the operator's answers to §9. Every ruling in brief §0 overrides the
section it names, and this plan is rewritten to match. §0 below is now the *record* of
what was found and how it was ruled, not an open list.

Read in full before this file was produced: the brief (both revisions),
`MOTIVATION-INTAKE-PLAN.md`, `MOTIVATION-UX-REVIEW.md`,
`docs/design/licence-centre/SPEC-BUILD.md` (both revisions), `CLAUDE.md`, `HANDOFF.md`,
`docs/INDEX.md`. Then the running code: the registry, the controller, the service, the
271 stack, overlap, prefill, structure, prompts, the LLM adapter, and both frontend
wizards.

**Baseline, measured on this branch, not quoted from HANDOFF:** backend `npm test` —
4020 passed / 4032 total (8 skipped, 4 todo, 0 failed), 237 of 238 suites. Frontend
`npm test` — 1675 passed / 1676 (1 skipped, 0 failed), 112 files. Both green. Every
"keep green" claim below is measured against these numbers.

---

## 0. What Phase 0 found, and how it was ruled

Six findings, all now settled by brief §0. Kept here because the evidence is what makes
each ruling checkable later.

| # | Found | Ruled |
|---|---|---|
| **E** | `/licence-centre` is already the Document Centre. `app/licence-centre/page.tsx` is 56 KB; `app/documents/page.tsx` is a two-line re-export whose header keeps the old path deliberately for reminder emails; `notification-module.ts:50` deep-links **every** `licence_centre_*` notification there, locked by `licence-centre-reminders.spec.ts:97`. | The Document Centre keeps `/licence-centre` and `/documents`. The new list is **`/licence-centre/applications`**. Sheet and pack unchanged. Redirects and shell titles follow. |
| **F** | Three fields are hidden by a *deliberate contradiction* between `formOnly` and `showIf: fill_saps271 = 'My dealer will fill it in'` — `police_station_province`, `press_clippings`, `competency_renews_with_licence`. Drop the `formOnly` branch and only the `showIf` remains; since `fill_saps271` stays accepted for old blobs, a stored `'My dealer will fill it in'` opens all three. | Explicit **`internal: true`**: accepted, never asked, never in the sheet. The frontend `visibleFields()` mirror is retired; the sheet's server-computed `state` is the only visibility. See §1.7 for what "retired" means to `tsc` in Phase 1. |
| **—** | Phase 1 cannot be backend-only. `frontend/lib/__fixtures__/registry-sections.json` and `registry-keys.json` are hand-maintained registry snapshots read by four specs, and nothing regenerates them; `visibleFields()` is a hand-written mirror of `isVisible()`. | Phase 1 carries a **non-visual frontend appendix** — §1.7. In scope, not creep. |
| **G** | No Playwright anywhere: no config, no `e2e/`, no dependency in either `package.json`, no CI to run browsers in. | **RTL interaction-count specs** under the existing `npm test`, three named gates, invented fixture vault. §3.4. |
| **H** | The twelve fixed headings do not map onto the fourteen `SectionId`s: PAJA and Annexures are pack assembly, and `the_quarry` / `the_discipline` / `the_threat` share one slot. | Produce the 14 → 12 mapping as the **first step of Phase 2, with its own sign-off**, before `HEADING_ALTERNATES` collapses. Starting rule given. §2.0. |
| **I** | The four prefill-offer endpoints are what the two live wizards still call; deleting them in Phase 1 404s the old screens for the days Phases 1–2 take. | They die in **Phase 4**. Phase 1 adds the sheet endpoint beside them. |
| **J** | The five Phase 2 sample PDFs come from the operator's own vault — real name, ID number, address, serials — and `docs/history/` is committed and pushed. | They go to **`scan-fixtures/motivation-samples/`**. Verified gitignored: `.gitignore:221` is `scan-fixtures/`, which matches at any depth. |

### The operator's answers to §9

| | |
|---|---|
| **§9.1 `MotivationMessage`** | Counted read-only on production, 2026-09-08, with the CLAUDE.md `?schema=`-stripping psql pattern: **0 rows**. Nothing to export. The migration drops the table outright; no export script is written. |
| **§9.2 card wording** | `motivation-cards.ts` goes to the operator after Phase 1, before Phase 3. It is a single file with nothing else in it for exactly that reason. |
| **§9.3 research** | The structured cached targets **replace** the free-text brief. Free text stays available as an optional fallback, not a second path — see §2.1. |
| **§9.4 518(a)** | Out of scope. Confirmed. An S24 pack ships the motivation alone and says so. |
| **HANDOFF open item 1** | S15 for occasional sports shooters lands in this rebuild — `intended_quarry` stops being required in Phase 1 §1.1, and intake plan §3.7's S15 sport cards ship with the other card sets. |

### One reading I had to make, flagged rather than assumed

Brief §0 F says `visibleFields()` is "retired" in Phase 1. Taken as *delete the
function*, Phase 1 breaks the build: four files that live until Phase 4 call it —
`app/licence-services/[id]/page.tsx:764`, `app/motivations/[id]/page.tsx:1373`,
`components/licence-pack/pack-section.tsx:60`, `components/licence-pack/step-answers.ts:67`
— and `npx tsc --noEmit` is a deploy gate.

So Phase 1 retires its **authority**, not its existence: the 271 gate comes out and
`internal` goes in, so the mirror stops disagreeing with the server; nothing new ever
calls it; and it is deleted together with its four callers in Phase 4 §4.1. If the
operator meant delete-in-Phase-1, say so and the four callers get a local copy of the
predicate instead — but that is a mirror in four places rather than one, which is worse.

---

## 1. PHASE 1 — Backend reshaping

Brief §5.1, §5.2, §5.3, §5.4, the follow-up interview removal, and the §1.7 appendix.
**Gate: both suites green at or above the baseline in the header.**

### 1.1 Registry and the card sets

| File | Action | What changes | Test that covers it |
|---|---|---|---|
| `backend/src/motivations/motivation-fields.ts` | **edit** | `MotivationFieldKind` gains `'cards'`. `MotivationField` gains `options?: CardOption[]`, `scope?: 'profile' \| 'application'`, `internal?: true`. `showIf` gains `hasAny?: true`. `isVisible()` drops the `formOnly` branch, honours `internal`, honours `hasAny`. `factPackFields()` excludes `internal`. `sanitiseAnswers()` handles `'cards'` exactly as `'multi'` (comma list, order-normalised, every part a real option). `allowedValues()` resolves `options`. `FIELD_REGISTRY_VERSION` → `'2026-09-08'` with the dated comment the file's own rule demands. | `motivation-fields.spec.ts` — extended, never replaced (registry-integrity is the contract, brief §2.7) |
| ” | **edit** | `formOnly` removed from: the six `history_*` yes/no, `safe_present`, `safe_mounted`, `marital_status`, `spouse_name`, `postal_address`, `residence_type`, `home_telephone`, `work_telephone`, `cellphone`, `licence_holder_type`. **Kept** on: the station / CAS / charge / outcome boxes, the dialling codes, the postal codes, `spouse_id_type`, `spouse_passport_number`, `spouse_id_number`, and every `firearm_*` / `barrel_*` / `frame_*` / `receiver_*` serial-and-make box. `NEVER_PROMPTED` untouched and still doing the anti-padding work. | `motivation-fields.spec.ts`; `motivation-model.service.spec.ts` (fact-pack contents) |
| ” | **edit** | `fill_saps271` removed from `COMMON_FIELDS`, added to a `LEGACY_BY_KEY`-style retired list so `fieldByKey()` still finds it and `sanitiseAnswers()` still accepts old blobs. `NOT_ASKED_BY_TYPE.S24_RENEWAL` loses the now-pointless entry. | `motivation-fields.spec.ts` — new case: an old blob carrying `fill_saps271` still saves |
| ” | **edit** | **Ruling F.** `police_station_province`, `press_clippings` and `competency_renews_with_licence` swap the `formOnly` × `showIf` contradiction for `internal: true`. | `motivation-fields.spec.ts` — a case asserting each stays invisible for **every** value of every other answer, including a stored `fill_saps271 = 'My dealer will fill it in'` |
| ” | **edit** | New section `'Your premises'` (`scope: 'profile'`) per intake plan §3.6: `premises_enclosure`, `premises_access_control`, `alarm_present`, `alarm_company` (`showIf`), `armed_response`, `burglar_bars`, `security_gates`, plus `safe_present`, `safe_type`, `safe_mounted`, `safe_mounted_to`, `safe_key_holder` moved out of `'Storage and safety'`. `safe_storage_detail` stays, loses `required`, becomes the prefilled optional box. | `motivation-fields.spec.ts`; `saps271-safe.spec.ts` (the 271 still gets its safe answers) |
| ” | **edit** | `existing_firearm_N_primary_use` × 14 (`kind: 'cards'`, `scope: 'profile'`, never `docSourced`), added to `OWNED_FIREARM_FIELDS`. | `motivation-fields.spec.ts`; `saps271-owned-firearms.spec.ts`; `motivation-owned-table.spec.ts` |
| ” | **edit** | Nine card fields per intake plan §3.7 / brief §5.1: `s13_reasons`, `s13_movements`, `s13_carry_style` (S13); `hunt_game_class`, `hunt_terrain`, `hunt_where`, `hunt_reasons` (S15, S16 hunter); `sport_reasons`, `sport_formats` (S16 sport). **The S15 sets carry the sport cards as well as the hunting ones** — HANDOFF open item 1. | `motivation-fields.spec.ts`; `motivation-cards.spec.ts` |
| ” | **edit** | `required` removed from every `long` field: `firearm_fit_reason`, `safe_storage_detail`, `threat_circumstances`, `daily_movements`, `hunting_history`, `intended_quarry`, `competition_record`, `continued_use`, `discipline_requirement`. All survive as optional and prefilled (intake plan §4). **`intended_quarry` losing `required` is what unblocks an S15 occasional sports shooter** — HANDOFF open item 1. | `motivation-fields.spec.ts`; `motivations.service.spec.ts` (`missingRequired`) — a new case walking an S15 sport applicant to generation with no quarry named |
| `backend/src/motivations/motivation-cards.ts` | **new** | One exported constant per card set, each `{ key, sentence, rankBy? }[]`, first person. Nothing else in the file — the operator's review surface (§9.2). | `motivation-cards.spec.ts` **new** — every sentence first person, ends in a full stop, no emoji / exclamation mark / competitor name, every `key` unique within its set |
| `backend/src/motivations/motivation-field-options.ts` | **edit** | Attaches `options` for `kind: 'cards'` on the way out, the way it attaches shooting disciplines today. | `motivation-fields.spec.ts`; existing options coverage |

**Not done here, deliberately:** `rankBy` is *declared* in Phase 1 and *computed* in
Phase 2, where the research layer that ranks by calibre and association exists. Phase 1
ships the sets in registry order.

### 1.2 The profile store

| File | Action | What changes | Test |
|---|---|---|---|
| `backend/prisma/schema.prisma` | **edit** | New model `MemberProfileAnswers` — `userId @unique`, `answersEncrypted String? @db.Text`, `answersSchemaVersion`, `answerProvenance Json?`, timestamps. Same encryption posture as `Motivation.answersEncrypted` and the same clear-text provenance split, for the same reasons. | `member-profile-answers.service.spec.ts` |
| `backend/prisma/migrations/<ts>_member_profile_answers/migration.sql` | **new** | `CREATE TABLE`. Hand-written, applied with `prisma migrate deploy` — never `db push` (CLAUDE.md schema-drift trap: two services add `tsvector GENERATED` columns at boot that `db push` drops). | applied-migration check in the deploy run |
| `backend/src/motivations/member-profile-answers.service.ts` | **new** | `readFor(userId)`, `writeFor(userId, patch, provenance)`, `keysInScope(type)`. Encrypt / decrypt through the same `blob-crypto` helpers `motivation-shared.service.ts` uses. | `member-profile-answers.service.spec.ts` **new** — round-trip; a profile answer surviving into a second application; `MEMBER` provenance never overwritten by `PROFILE` |
| `backend/src/motivations/motivations.service.ts` | **edit** | `saveAnswers()` splits the incoming blob by `scope` and routes profile keys to the new store; the response contract is unchanged (whole blob in, same shape out). `findOne()` merges the profile store back in under `PROFILE` provenance. | `motivations.service.spec.ts` — extended |
| `backend/src/motivations/motivation-prefill.service.ts` | **edit** | `profileFor()` reads `MemberProfileAnswers` first, then falls back to `priorAnswers()` / `carriesForwardAsAnswer()` for a member with no profile yet (intake plan §5.2). | `motivation-profile.spec.ts`; `prior-readings.spec.ts` |

### 1.3 The sheet and preview endpoints

| File | Action | What changes | Test |
|---|---|---|---|
| `backend/src/motivations/motivation-sheet.service.ts` | **new** | `sheetFor(clerkId, id)` composing the existing prefill, documents, coverage and overlap services into `{ application, sections[], items[], documents[], coverage, overlap, preview, missing }`. Each item `{ key, label, kind, state, value, provenance, options?, cards?, scope, required, help, placeholder }`. **`state` is computed here and nowhere else** — ruling F makes that the only visibility. No new logic in the controller (brief §5.2). | `motivation-sheet.service.spec.ts` **new** — one case per `state`; the eight sections in brief §6.1 order; `missing` agreeing with `missingRequired()`; an `internal` field never appearing |
| `backend/src/motivations/motivation-preview.ts` | **new** | Pure: fact pack → `PreviewSection[]`, one templated paragraph per section, **no model call**. | `motivation-preview.spec.ts` **new** — deterministic output for a fixed pack; a tapped card's sentence present; an untapped one absent |
| `backend/src/motivations/motivations.controller.ts` | **edit** | `@Get(':id/sheet')` and `@Get(':id/preview')` added, declared before `@Get(':id')` per the file's own ordering rule. `@Get(':id/messages')` and `@Post(':id/messages/:messageId')` **deleted**. **Ruling I: the four prefill-offer endpoints stay untouched in Phase 1** and are deleted in Phase 4 §4.3 — the sheet endpoint is added *beside* them, so both wizards keep their prefill offer through Phases 1–3. | `motivations.service.spec.ts`; `motivation-sheet.service.spec.ts` |
| `backend/src/motivations/motivations.module.ts` | **edit** | Register `MotivationSheetService` and `MemberProfileAnswersService`. | `motivations.module.spec.ts` — the existing boot spec, which is the pattern CLAUDE.md requires for exactly this |

### 1.4 SAPS 271 F-by-route

| File | Action | What changes | Test |
|---|---|---|---|
| `backend/src/motivations/saps271.service.ts` | **edit** | Opt-in check removed. D, G, H always filled. E from `firearm_*`. F by `firearm_source`: `SOURCE_DEALER` → F blank + cover note; `SOURCE_PRIVATE` → 81–87 from the existing `sellerConsent.sectionF()` (already built and tested — no new extraction); `SOURCE_ESTATE` → Type E from the `EXECUTOR_APPOINTMENT` reading. | `saps271.service.spec.ts`; `saps271-section-f.spec.ts` — a case per route |
| `backend/src/motivations/saps271-coverage.ts` | **edit** | The opt-in gate goes; it already counts questions rather than boxes, so nothing else moves. | `saps271-coverage.spec.ts` |
| `backend/src/motivations/motivation-render.service.ts` | **edit** | The `ConflictException` at `:1081` (*"You chose to let your dealer complete the SAPS 271"*) deleted. **The S24 refusal immediately above it stays** — a renewal is a 518(a) and that guard is correct (§9.4 confirms 518(a) is out of scope, so the refusal is still the truthful answer). | `saps271-render.spec.ts`; `motivation-consent-page.spec.ts` |
| `backend/src/motivations/motivation-seller-consent.service.ts` | **edit** | Render the pre-filled F page into the seller's link beside the consent letter (intake plan §6.1), so the seller signs both. | `motivation-seller-consent.service.spec.ts`; `motivation-consent-pack.spec.ts` |
| `backend/src/motivations/motivation-checklist.ts` | **edit** | The dealer-route cover note ("your dealer completes Part F and their own 350(a)") as a checklist line. | `motivation-checklist.spec.ts` |

### 1.5 Overlap and the primary-use angle

| File | Action | What changes | Test |
|---|---|---|---|
| `backend/src/motivations/motivation-overlap.ts` | **edit** | Type / action / section axes added to the curated tables. New `suggestedAngle: { key, sentence }[] \| null` on `OverlapCheck`, ranked. `HeldFirearm.usedFor` fed from `existing_firearm_N_primary_use`. Exact-match preserved; "unknown → ask" preserved. | `motivation-overlap.spec.ts` — extended; new cases for the ranked angle and for `unknown` still asking |
| `backend/src/motivations/motivation-fields.ts` | **edit** | `overlap_angle` (`kind: 'cards'`, section `'The firearm'`) — the confirmed angle. `overlap_justification` loses nothing but its prominence; it stays as the optional prefilled box. | `motivation-fields.spec.ts`; `motivation-overlap.spec.ts` |

### 1.6 Removing the follow-up interview

| File | Action | What changes | Test |
|---|---|---|---|
| `backend/src/motivations/motivation-gaps.ts` | **delete** | The gap-finding / question-wording module. | — |
| `backend/src/motivations/motivation-gaps.spec.ts` | **delete** | Its suite. **The one deliberate reduction in test count** (8 tests), because the code under test is gone, not because it changed. | — |
| `backend/src/motivations/motivation-generation.service.ts` | **edit** | `queueFollowUps` and every `findGaps` / `gapBrief` call removed. `thinFields` still computed and stored — it lowers the score and is logged, and no longer produces a question (brief §5.6). | `motivations.service.spec.ts`; `motivation-model.service.spec.ts` |
| `backend/src/motivations/motivation-model.service.ts` | **edit** | `MODEL_FOLLOWUP` and the `ANTHROPIC_MODEL_MOTIVATION_FOLLOWUP` env read removed. | `motivation-model.service.spec.ts` |
| `backend/src/motivations/motivation-prompts.ts` | **edit** | The follow-up question prompt (~`:980`–`1030`, *"This prompt exists to WORD a question"*) removed. Length bands and cadence are **Phase 2**, not here. | `motivation-prompt-discipline.spec.ts`; `motivation-prompt-cache.spec.ts` |
| `backend/src/motivations/motivations.service.ts` | **edit** | `listMessages()` and `answerFollowUp()` removed. | `motivations.service.spec.ts` |
| `backend/prisma/schema.prisma` | **edit** | `model MotivationMessage` dropped; the `messages MotivationMessage[]` relation on `Motivation` dropped. | migration applies cleanly |
| `backend/prisma/migrations/<ts>_drop_motivation_messages/migration.sql` | **new** | `DROP TABLE "MotivationMessage"`. **Unblocked: production holds 0 rows** (counted read-only 2026-09-08). No export script. | — |

⚠️ The two wizards call `GET :id/messages` on load. Deleting it 404s that one fetch. Both
pages already treat a failed messages fetch as "no follow-ups" (there is nothing else it
could mean), so the screens degrade to exactly what brief §7 Phase 1 says they should —
no follow-ups. Verified at both call sites before the endpoint is removed, not assumed.

### 1.7 The frontend appendix (ruling: in scope, non-visual)

| File | Action | What changes | Test |
|---|---|---|---|
| `frontend/lib/__fixtures__/registry-sections.json` | **edit** | Re-snapshot: `'The SAPS 271 form'` out, `'Your premises'` in. | `lib/wizard-coverage.spec.ts`, `lib/licence-types-coverage.spec.ts`, `components/licence-pack/wizard-rail.spec.tsx` |
| `frontend/lib/__fixtures__/registry-keys.json` | **edit** | Re-snapshot: the new card keys, the premises keys, `existing_firearm_N_primary_use`, `overlap_angle`; `fill_saps271` out. | `lib/vault-prefix-coverage.spec.ts` |
| `frontend/lib/motivations-api.ts` | **edit** | **Ruling F.** `visibleFields()` loses the 271 gate and honours `internal`, so the mirror stops disagreeing with the server. `FieldKind` gains `'cards'`. The function itself and its four callers are deleted together in Phase 4 §4.1 — see the flagged reading in §0. The `SAPS271_OPT_KEY` / `SAPS271_FILL` exports move to the two wizard pages that still read them, rather than dying mid-air before Phase 4 deletes those pages. | existing `lib/` specs |
| `frontend/lib/motivation-step-plan.ts` | **edit** | Section rename in `STEP_PLAN` so `wizard-coverage` stays satisfied. | `lib/wizard-coverage.spec.ts` |
| `frontend/components/licence-pack/wizard-rail.tsx` | **edit** | Same rename in `WIZARD_STEPS`. | `components/licence-pack/wizard-rail.spec.tsx` |

Four specs re-pointed, no screen changed, nothing rendered differently.

**Phase 1 test ledger.** New suites: `motivation-cards.spec.ts`,
`motivation-sheet.service.spec.ts`, `motivation-preview.spec.ts`,
`member-profile-answers.service.spec.ts`. Deleted: `motivation-gaps.spec.ts` (8 tests,
code deleted). Extended in place: `motivation-fields.spec.ts`,
`motivation-overlap.spec.ts`, the `saps271-*` suites, `motivations.service.spec.ts`,
`motivation-model.service.spec.ts`, `motivations.module.spec.ts`. **No suite is deleted
whose subject survives** — brief §2.7.

---

## 1B. PHASE 1B — Drop AWS Textract, Gemini only

Operator instruction, 2026-09-08, mid-Phase-1: *"we will also be losing AWS textract and
only be using gemini going forward. Gemini can write straight into json and you can make
it work from there."* Scope confirmed as **everything, KYC included**; timing confirmed as
**its own step after Phase 1 sign-off**, before Phase 2.

⚠️ **This reverses `d90fbdcf`** (three sessions ago), which put Textract *first* because a
single Gemini vision pass on a real photograph was inconsistent. The replacement for that
is the operator's own hint: a `responseSchema` call through `common/llm/gemini-schema.ts`
(`toGeminiSchema`) so the model writes structured JSON rather than prose we parse — plus
`attemptReadFirearm()`'s existing two-attempt retry, which stays.

⚠️ **AWS does not leave the codebase.** `aws-kyc.service.ts` couples Textract to
**Rekognition face-match and Face Liveness**, and `infra/aws/kyc-iam-policy.json` covers
all three together. Only the Textract half goes; the AWS client, the region config and
`AWS_KYC_LIVENESS_ROLE_ARN` stay.

| File | Action | Test |
|---|---|---|
| `backend/src/licence-centre/licence-centre-textract.service.ts` | **delete** | — |
| `backend/src/licence-centre/textract-document-extract.ts` (+`.spec.ts`, 24 tests) | **delete** | — |
| `backend/src/licence-centre/licence-centre-extract.service.ts` | **edit** — Textract branch out; `reader?: 'textract' \| 'model'` collapses to model | `licence-centre-extract-*.spec.ts` |
| `backend/src/licence-centre/licence-centre-extract-textract.spec.ts` (11 tests) | **delete or re-point** | — |
| `backend/src/motivations/motivation-extract.service.ts` | **edit** — `firearmFromTextract()` and the Textract-first pass in `readFirearm()` out; Gemini gains a `responseSchema` | `motivation-read-firearm.spec.ts` (17 tests) re-pointed at the schema path |
| `backend/src/motivations/motivations.module.ts` | **edit** — drop the second, independent `LicenceCentreTextractService` registration | `motivations.module.spec.ts` |
| `backend/src/kyc/textract-extract.ts` (+`.spec.ts`, 9 tests) | **delete** | — |
| `backend/src/kyc/aws-kyc.service.ts` | **edit** — Textract client and `analyzeDocument()` out; **Rekognition and Face Liveness stay** | `aws-kyc-findings.spec.ts` |
| `backend/src/kyc/aws-kyc-findings.ts` | **edit** — `parts.textract` replaced by the Gemini JSON reading | `aws-kyc-findings.spec.ts` |
| `infra/aws/kyc-iam-policy.json` | **edit** — drop `textract:*`; keep `rekognition:*` | — |
| `CLAUDE.md` | **edit** — the KYC line and the AWS env list | — |

Open for the operator when this step starts: the six real identity documents in
`src/kyc/__fixtures__/textract/` are the regression corpus for the KYC read. They are
fixtures of Textract's *response shape*, so they do not transfer to a Gemini schema read
and the corpus has to be rebuilt against real documents or the KYC read ships untested.

---

## 2. PHASE 2 — Research layer and writer

Brief §5.5, §5.6, §5.7. **Does not start until Phase 1 is signed off.**

### 2.0 The heading mapping — DELIVERED, awaiting sign-off (ruling H)

No code written. `HEADING_ALTERNATES` does not collapse until this is signed off.

**The finding that shapes the answer: it is not a 14 → 12 mapping.** Reading the twelve
headings in `MOTIVATION-UX-REVIEW.md` §3.3 against the fourteen `SectionId`s and against
UX review §3.2 ("render these from the fact pack, not from the model"), three things fall
out that a straight mapping cannot express:

1. **Five of the twelve are RENDERED, not written.** PAJA and Annexures were already
   known to be pack assembly (ruling H says so). But Personal details, Competency and
   Existing firearms are the *particulars block*, the *one line per certificate* and the
   *battery table* — precisely the three things UX review §3.2 says must stop being
   prose. So the writer is responsible for seven headings, not ten or twelve.
2. **Two of the twelve have no `SectionId` at all** — "Competency" and "Association
   membership and status". Both are rendered blocks, which is why they never needed one.
3. **`compliance_history` is not in the twelve, and that is correct.** It prints only
   when something is disclosed, and every pack in the approved corpus is a clean
   applicant, so it never appeared in one. It is a **conditional thirteenth**, not a
   missing twelfth.

#### The mapping, in printed order

| # | Printed heading | Source | `SectionId` |
|---|---|---|---|
| 1 | **Personal details** | rendered particulars block + one written opening paragraph | `introduction` + `personal_circumstances` |
| 2 | **Firearm experience** | written | `experience` |
| 3 | **Competency** | rendered — one line per certificate | *(none — new rendered block)* |
| 4 | **Security and safe storage** | written, from the new premises cards | `storage_safety` |
| 5 | **Firearm applied for** | written | `the_firearm` |
| 6 | **The calibre** | written | `the_calibre` |
| 7 | **Existing firearms** | rendered battery table + written differentiation when an overlap exists | `comparison` |
| 8 | **Association membership and status** | rendered — S16 only | *(none — new rendered block)* |
| 9 | **Application under section N** | quoted statute, then the applying paragraphs | `statutory_application` + `the_quarry` / `the_discipline` / `the_threat` |
| 10 | **PAJA** | rendered — `motivation-prior-notice.ts` | *(none)* |
| 11 | **Conclusion** | written | `conclusion` |
| 12 | **Annexures** | rendered — `motivation-annexure-layout.ts` | *(none)* |
| 13† | **My record** | written, **only when something is disclosed** | `compliance_history` |

† Conditional. A clean record prints nothing, which is `NEVER_PROMPTED`'s rule made
visible — six "No" answers are not an argument.

**Seven written headings** (1's paragraph, 2, 4, 5, 6, 7's paragraphs, 9, 11, and 13 when
it applies); **five rendered**. No `SectionId` is deleted: the four that lose a heading of
their own (`personal_circumstances`, `the_quarry`, `the_discipline`, `the_threat`) keep
writing their paragraphs, under a heading they now share.

#### Two readings the operator should confirm or correct

- **"`the_firearm` splits into 'Firearm applied for' and 'The calibre'."** Read as: the
  two ids that already exist take those two headings. `the_calibre` has been a separate
  `SectionId` since the corpus work, so nothing needs splitting — this is a rename, not a
  restructure.
- **The purpose triple loses its own heading.** Ruling H puts it under "Application under
  section N" after the quoted statute, which is what quote-then-apply means and what the
  approved packs do. ⚠️ Worth saying plainly, because it cuts against the module's own
  note: `motivation-structure.ts` calls the purpose sections *"the section a paid writer
  spends their effort on, and the one a reviewer reads to decide whether the applicant has
  thought about this at all."* Folding it into the statutory section demotes the
  most-read argument in the document from a heading to a sub-part. It is defensible —
  the purpose IS the statutory element being applied — but it is a real trade and it is
  the operator's to make.

### 2.1 Research

| File | Action | What | Test |
|---|---|---|---|
| `backend/prisma/schema.prisma` | **edit** | `model MotivationResearch` — `cacheKey @unique`, `target`, `payloadEncrypted`, `sourcesJson`, `fetchedAt`, `expiresAt`. | `motivation-research.service.spec.ts` |
| `backend/prisma/migrations/<ts>_motivation_research/migration.sql` | **new** | `CREATE TABLE`. | applied-migration check |
| `backend/src/motivations/motivation-research.service.ts` | **new** | Structured targets from narrative engine §4A: firearm capability (`make\|model\|calibre\|use_class`, 180-day TTL), calibre role, discipline specification (keyed to the `shooting-disciplines` entry), species / range bands by game class and province. Through `common/llm` with `grounding: { web: true }`, paraphrased and source-attributed; a cache hit costs no call. Fails soft exactly as `research()` does today. | `motivation-research.service.spec.ts` **new** — a cache hit makes no LLM call; a miss writes one row; a failure returns null and does not throw; no name / ID / serial reaches a query (the existing `researchBrief` privacy tests are the pattern) |
| `backend/src/motivations/motivation-model.service.ts` | **edit** | **§9.3: replace.** `research()` and `researchBrief()` give way to the structured service — one research path. The free-text brief survives only as an off-by-default fallback for a target the structured set has no shape for; it is never a second call on a normal run, and the spec asserts a normal run makes exactly the structured calls and no others. Precinct stats keep coming from `crime-stats`, unchanged. | `motivation-model.service.spec.ts` |
| `backend/src/motivations/motivation-generation.service.ts` | **edit** | `research{}` into the fact pack so the trace gate treats it as ledger content; tapped cards passed as first-person sentences the writer may use verbatim. | `motivation-model.service.spec.ts`; `motivation-verify.spec.ts` |

### 2.2 Writer

| File | Action | What | Test |
|---|---|---|---|
| `backend/src/motivations/motivation-prompts.ts` | **edit** | Length bands → S13 900–1400, S15/S16 1200–1800, S24 600–900. The writer receives fact pack + cards + `research{}` + overlap angle + statutory text, and writes **only the argument paragraphs**. | `motivation-prompt-discipline.spec.ts`; `motivation-prompt-cache.spec.ts` |
| `backend/src/motivations/motivation-structure.ts` | **edit** | `CADENCES` → fixed `'plain'`; `OPENINGS` → the single approved opening; `HEADING_ALTERNATES` and `TYPE_HEADING_ALTERNATES` → one title per section, **per the §2.0 mapping**. `similarity()` / `SIMILARITY_REGENERATE_THRESHOLD` survive as a **test-time guard only** (brief §5.6). | `motivation-structure.spec.ts` — rewritten around fixed output; the randomisation cases become determinism cases, with the reason stated |
| `backend/src/motivations/motivation-render.service.ts` | **edit** | Rendered from data, not from the model: page-1 particulars block, owned-firearms battery table, S13 existing-measures list, the statutory quote from `motivation-statute.ts` (quote-then-apply), the annexure index, and page 2's take-to-SAPS checklist from `motivation-checklist.ts` by section and source route. | `motivation-owned-table.spec.ts`; `motivation-statute.spec.ts`; `motivation-annexure-layout.spec.ts` |
| `backend/src/motivations/motivation-pdf.service.ts` | **edit** | Table definitions for the three new blocks. | `motivation-pdf.service.spec.ts`; `motivation-pdf-layouts.spec.ts` |
| `backend/src/motivations/vault-adoption.service.ts` | **edit** | On adopting a `CURRENT_LICENCE`, ask `primary_use` once for that firearm with calibre-derived card suggestions; write to the profile store (brief §5.7). Reloading asked once on the first application, also profile-scoped. | `vault-adoption.service.spec.ts`; `vault-adoption-kinds.spec.ts` |
| `backend/src/motivations/motivation-fields.ts` | **edit** | `reloads`, `reload_calibres`, `reload_since` (profile scope, intake plan §6.4). | `motivation-fields.spec.ts` |

**Phase 2 deliverable (ruling J).** One generated motivation per licence type against the
operator's own vault, five PDFs to **`scan-fixtures/motivation-samples/`** — gitignored at
`.gitignore:221` (`scan-fixtures/`, matching at any depth), verified. **Never
`docs/history/`, never committed.** They are sent to the operator through `SendUserFile`
for the read, and the paths are named in the HANDOFF entry so the next session knows they
exist and knows not to add them.

---

## 3. PHASE 3 — The new surface

Brief §6 in full, built to `docs/design/licence-centre/SPEC-BUILD.md`. **Does not start
until Phase 2 is signed off.** Every component under
`frontend/components/licence-centre/`; the page is the only stateful file, as The Bench
does it.

### 3.1 New files

| File | What | Test |
|---|---|---|
| `frontend/components/licence-centre/contract.ts` | The `SheetItem` / `SheetResponse` / `PreviewSection` types the presentational components implement. Changed here first, as The Bench's rule requires. | consumed by every spec below |
| `frontend/components/licence-centre/sheet-row.tsx` | **The one row component**, SPEC-BUILD §5: four states, seven kinds. Replaces `field-grid`, `pack-row`, `pack-group`, `pack-section`, `motivation-field-input`. | `sheet-row.spec.tsx` — one case per state × kind; **never masked**; Change → prefilled control + Done; Confirm writes `MEMBER` |
| `frontend/components/licence-centre/cards-row.tsx` | The tile grid, SPEC-BUILD §5. | `cards-row.spec.tsx` — multi-select; comma-list value; "most likely" on the first ranked card only; own-words textarea prefilled from taps, the member's edit winning |
| `frontend/components/licence-centre/declaration-row.tsx` | Yes/no + detail + the four boxes, wrapping `yes-no-pills.tsx`. | `declaration-row.spec.tsx` — nothing pre-selected, "No" first, Yes opens the detail and the four boxes, negligence only after lost/stolen = Yes |
| `frontend/components/licence-centre/sheet-header.tsx` | The `.strip`. | `sheet-header.spec.tsx` — SPEC-BUILD §6: the pill, the chip dots and the footer all read one `missing` list |
| `frontend/components/licence-centre/document-shelf.tsx` | The shelf, SPEC-BUILD §7. | `document-shelf.spec.tsx` — letters, state dots, the wide empty-vault Add tile |
| `frontend/components/licence-centre/sheet-section.tsx` | Heading + one-sentence blurb + list. | covered by `sheet-page.spec.tsx` |
| `frontend/components/licence-centre/sheet-footer.tsx` | The one red button. | `sheet-footer.spec.tsx` — disabled with the count, enabled with no line at zero |
| `frontend/components/licence-centre/sheet-toast.tsx` | The read toast. | `sheet-toast.spec.tsx` |
| `frontend/components/licence-centre/overlap-card.tsx` | "This one will be my ___". | `overlap-card.spec.tsx` |
| `frontend/components/licence-centre/consent-card.tsx` | Seller consent + the Part F line. | `consent-card.spec.tsx` |
| `frontend/components/licence-centre/competency-lines.tsx` | One line per certificate + the endorsement check. | `competency-lines.spec.tsx` — green when covered, gold when not, no upload door when the vault covers the type |
| `frontend/components/licence-centre/pack-summary.tsx` | 271 meter + take-to-SAPS. | `pack-summary.spec.tsx` — the F row reads "dealer" / "seller", not a percentage |
| `frontend/components/licence-centre/preview-panel.tsx` | Drawer / aside. | `preview-panel.spec.tsx` — a tapped card's sentence appears `<mark>`ed after the debounce |
| `frontend/components/licence-centre/__fixtures__/sheet.fixture.ts` | The fixture `SheetResponse` set the specs and the three gates run against: a populated S16-sport vault, an empty-vault S13, a private-sale variant. **Invented data only** — never a real ID number, never the canvas's Johan Pretorius seeded anywhere but here. | consumed by §3.4 |
| `frontend/lib/licence-centre-sheet-api.ts` | `useViewerFetch` calls for sheet / preview / answers. **`no-store`, never `revalidate`** — these vary by viewer (CLAUDE.md). | `lib/licence-centre-sheet-api.spec.ts` |
| `frontend/app/licence-centre/[id]/page.tsx` | The sheet. The only stateful file. | `sheet-page.spec.tsx` + §3.4 |
| `frontend/app/licence-centre/[id]/pack/page.tsx` | The pack, `Pack.dc.html`. | `pack-page.spec.tsx` |
| `frontend/app/licence-centre/applications/page.tsx` | The list, `List.dc.html`. **Ruling E** — `/licence-centre` itself stays the Document Centre and is not touched. | `list-page.spec.tsx` |

### 3.2 Edited in Phase 3

| File | What | Test |
|---|---|---|
| `frontend/lib/shell-routes.ts` | Add `/licence-centre/applications` → "Applications" and `/licence-centre/:id/pack` → "Your pack". The existing `/licence-centre` → "Licence Centre" row **stays** — it is the Document Centre's title. `/licence-centre/:id` falls through to null so the page's own `document.title` (label or section) shows, matching how `/motivations/:id` already works via `PUSH_TITLE_INDEX_ONLY`. ⚠️ `PUSH_TITLES` is longest-prefix-wins, so `/licence-centre/applications` must out-rank `/licence-centre`, and `/licence-centre` must be added to `PUSH_TITLE_INDEX_ONLY` or it captures the whole subtree. | `lib/shell-routes.spec.ts` (new if absent) — a case per route, including that `/licence-centre/:id` gets no fixed title |

### 3.3 Imported where they stand, moved in Phase 4

Per SPEC-BUILD §4: `components/document-centre/*`; `motivation/upload-panel`, `qr-icon`,
`provenance`, `precinct-card`, `station-picker`, `clippings-picker`,
`suggested-documents`; `licence-pack/{bulk-capture, extraction-review, read-result,
attached-documents, yes-no-pills, saps271-meter, empty-answer, owned-firearm-summary,
delete-application, pack-finish, section-chooser}`; `motivation-seller-consent`,
`motivation-witnesses`, `motivation-cover-photo`, `motivation-cover-cropper`,
`vault-consent`, `document-centre-add`; `lib/{motivations-api, licence-centre-api,
licence-labels, motivation-draft, motivation-item-groups}`; and the scanner / consent /
witness routes untouched. **Nothing is moved in Phase 3** — a move plus a rewrite in one
phase is how a regression hides.

### 3.4 The three gates (ruling G — RTL interaction counts, not Playwright)

New file `frontend/app/licence-centre/[id]/sheet-gates.spec.tsx`, under the existing
`npm test`. It mounts the real page against `sheet.fixture.ts` and counts interactions
through a wrapped `userEvent`.

| Gate | Assertion |
|---|---|
| **(a) Populated vault, S16 sport** | "Write my motivation" is enabled after **≤ 12 taps and zero typing**. The counter fails on any `type()` call, so "zero typing" is enforced, not observed. |
| **(b) Empty vault, S13** | Every `needs_you` row renders an open control, none is hidden behind a disclosure, and filling them all enables the button. |
| **(c) Private sale** | The consent card renders under the source row and the Part F line appears once the consent is signed. |

Brief §7 Phase 3's "under 20 interactions" is superseded by §8's own number: the gate is
**12**, per §0 G.

---

## 4. PHASE 4 — Delete and redirect

**Does not start until Phase 3 is signed off.** Brief §3 as amended by §0.

### 4.1 Frontend deletions

`app/motivations/page.tsx` · `app/motivations/[id]/page.tsx` ·
`app/licence-services/new/page.tsx` · `app/licence-services/[id]/page.tsx` ·
`app/licence-services/[id]/loading.tsx` · `app/licence-services/[id]/vault-prefixes.ts` ·
`components/motivation-step-nav.tsx` · `motivation-step-rail.tsx` ·
`motivation-template-picker.tsx` · `motivation-template-preview.tsx` ·
`motivation-checklist-panel.tsx` · `licence-centre-motivations.tsx` ·
`licence-centre-offer-panel.tsx` · `motivation-field-input.tsx` ·
`components/licence-pack/{field-grid, pack-row, pack-group, pack-section,
follow-up-thread, prefill-banner, proficiency-alert, capture-cards, wizard-rail,
offer-notes, step-answers}` and their specs · `lib/motivation-step-plan.ts` ·
`lib/licence-services-preview.ts` (+spec) · `lib/wizard-coverage.ts` (+spec) ·
`lib/wizard-document-coverage.spec.ts` · `lib/wizard-step-offset.spec.ts` ·
`lib/motivations-grouping.spec.ts` · `lib/follow-up-rules.spec.ts` ·
`lib/vault-prefix-coverage.spec.ts`.

**`visibleFields()` is deleted here**, together with its last four callers — all of which
are in the list above. That completes ruling F; see the flagged reading in §0.

⚠️ `lib/licence-types-coverage.spec.ts` is **re-pointed, not deleted** (brief §7 Phase 4:
"coverage suites re-pointed at the new surface"): it becomes a check that
`LICENCE_TYPES` covers every Prisma enum value and that
`/licence-centre/applications` offers all five. `vault-prefix-coverage` has no successor
— the sheet endpoint offers server-side, so per-step prefixes no longer exist — and goes.

### 4.2 Redirects and the flag (ruling E)

| File | What | Test |
|---|---|---|
| `frontend/next.config.mjs` | 301: `/motivations` → `/licence-centre/applications` · `/licence-services/new` → `/licence-centre/applications` · `/motivations/:id` → `/licence-centre/:id` · `/licence-services/:id` → `/licence-centre/:id`. | `lib/redirects.spec.ts` **new** — every old path maps, **and `/licence-centre` and `/documents` are both untouched and still the Document Centre** |
| everywhere | `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED`, `PACK_SCREEN_SHIPPED` and `canOpenPackScreen()` removed from the remaining call sites (`components/document-centre/credential-card.tsx` × 2, plus the deleted pages). | frontend suite |

### 4.3 Backend deletions

The two message endpoints are already gone in Phase 1. Left for Phase 4:

- **The four prefill-offer endpoints (ruling I):** `@Get(':id/profile-offer')`,
  `@Post(':id/use-profile')`, `@Get(':id/licence-centre-offer')`,
  `@Post(':id/use-licence-centre')`, and the `motivations.service.ts` methods behind
  them. Their work is done automatically-with-provenance inside `sheetFor()` from
  Phase 1. Test: `motivations.service.spec.ts`, `motivation-profile.spec.ts` re-pointed
  at the sheet.
- `motivation-templates.ts` **only if** `templateCatalogue()`'s single non-spec consumer
  (`motivations.controller.ts:47`) dies with the template picker — the PDF layouts do
  **not** import it, checked. `frontend/components/motivation-template-preview.tsx` is its
  only frontend reader and it is in the §4.1 list.

### 4.4 Docs

`HANDOFF.md` (an entry per phase, per the operator's rule), `docs/INDEX.md`, and
`CLAUDE.md`'s licence-stack section — which gains the fact that `/licence-centre` is the
Document Centre while `/licence-centre/applications` and `/licence-centre/[id]` are the
Motivation Centre, because that is exactly the kind of split that costs a session.

---

## 5. Open items

**None blocking.** Every §9 item and every Phase 0 finding is ruled. Two things the
operator may still want to correct, both flagged above rather than decided here:

1. **`visibleFields()` "retired" in Phase 1** — read as retiring its authority, deleting
   the function with its callers in Phase 4, because deleting it in Phase 1 breaks
   `tsc --noEmit`, which is a deploy gate. §0, last subsection.
2. **`the_firearm` "splits into" two headings** — read as the existing `the_firearm` and
   `the_calibre` ids taking those two headings, since `the_calibre` already exists. The
   §2.0 mapping step has its own sign-off, which is where to correct it.

---

## 6. What happens next

Phase 1 starts at §1.1 on the operator's go, and ends with both suites green, a
`HANDOFF.md` entry, and a stop.
