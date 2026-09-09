# MOTIVATION-PIPELINE-SPEC.md

```yaml
doc_id: motivation-pipeline-spec
version: 2026-09-09
audience: machine
purpose: >
  Complete description of how All Outdoor builds a SAPS firearm-licence
  motivation, from documents sitting in a member's vault to a rendered pack.
  Written for an LLM to analyse and criticise. Not optimised for human reading.
repo: C:/dev/gun-galore  (branch feat/takealot-ux-parity)
runtime: NestJS + Prisma 7 + PostgreSQL; Next.js 16 frontend
llm_adapter: backend/src/common/llm/  (LlmService; provider gemini, model from LLM_MODEL)
how_to_read: >
  Rules are IDed R-nnn and are assertions about current behaviour, not
  aspirations. Every rule names the file that implements it. Where a rule is
  known-unimplemented it is marked STATUS: GAP. Line numbers are omitted
  deliberately (they drift); grep the named symbol.
verification: >
  Claims here were read off the code on 2026-09-09. If code and this document
  disagree, the code is authoritative — that is also the repo's own rule
  (CLAUDE.md).
```

---

## 0. ONE-LINE PIPELINE

```
vault credentials + member answers
  -> [4] routing: which document fills which slot on THIS application
  -> [5] extraction: what each document says
  -> [6] pre-generation gates (refuse before spending a model call)
  -> [7] fact pack (the ONLY thing the writer sees)
  -> [8] structure plan (per licence type, seeded)
  -> [9] prompts (system rules + per-section briefs)
  -> [10] generate -> [11] deterministic verify -> [12] model quality gate
  -> [15] render PDF pack (+ [16] SAPS 271)
```

---

## 1. DOMAIN OBJECTS

```yaml
Credential:
  store: prisma model Credential
  meaning: a document in the member's LICENCE CENTRE vault; person-scoped, reusable
  key_fields: [userId, kind (CredentialKind), title, detailsEncrypted, expiresOn, purgedAt]
  details: encrypted JSON blob, keys per WANTED[kind] (see 5.2)

MotivationUpload:
  store: prisma model MotivationUpload
  meaning: a document ATTACHED TO ONE APPLICATION; may be a copy pulled from the vault
  key_fields: [motivationId, kind (MotivationUploadKind), coversKinds[], sourceCredentialId, extractionOk]
  note: coversKinds lets ONE file satisfy several needs (a membership certificate
        that is also a good-standing letter)

Motivation:
  store: prisma model Motivation
  key_fields:
    - licenceType (MotivationLicenceType)
    - status (MotivationStatus)
    - answersEncrypted        # the answers blob for THIS application
    - answerProvenance        # who supplied each answer
    - structurePlan           # the seeded section plan, stored
    - variantSeed
    - gateCycles
    - qualityScore, qualityFindings, qualityPassedAt
    - referenceNumber         # MO000071 style
    - draft text (generated prose)

answers:
  shape: Record<string, string>   # flat, keys are registry field keys
  composition_order: profile answers UNDER application answers
  implementation: MotivationSharedService.answersFor(userId, answersEncrypted)
  R-001: >
    scope:'profile' fields are stored in a separate per-member profile store,
    NOT in answersEncrypted. Any code path that reads answersEncrypted alone
    sees every profile answer as unanswered. This has caused a live bug
    (generation refused with "Some required answers are still missing" naming
    fields the member had answered).

AnswerProvenance:
  sources: [PROFILE, VAULT, READ, SELLER, ASSOCIATION, DERIVED, MEMBER]
  R-002: stamp() refuses to overwrite a MEMBER-sourced answer. A member's own
         typing always wins over any later automated fill.
```

```yaml
MotivationStatus:
  DRAFT:            form open, nothing generated
  INTERVIEW:        targeted follow-ups being asked
  GENERATING:       a generation pass is in flight
  QUALITY_REVIEW:   generated; model gate running
  NEEDS_MORE_INFO:  gate failed; thinFields drive new follow-ups
  COMPLETED:        gate passed; PDF may be produced
  FAILED:           unrecoverable; an admin owns it
  ABANDONED:        member walked away, or admin voided
R-003: renderPdf is gated on COMPLETED. No other status yields a pack.
```

---

## 2. LICENCE TYPES

```yaml
MotivationLicenceType:
  S13_SELF_DEFENCE:       self-defence
  S15_OCCASIONAL_HUNTER:  occasional hunter OR occasional sports shooter
  S16_DEDICATED_HUNTER:   dedicated hunter, accredited hunting association
  S16_DEDICATED_SPORT:    dedicated sports shooter, accredited sport body
  S24_RENEWAL:            renewal of a licence already held

R-010: The licence type is the spine. Every registry section, document tier,
       checklist, structure skeleton, prompt brief and PDF branch keys off it.
R-011: S24_RENEWAL is lodged on SAPS 518(a), NOT the 271. The 271 route refuses
       an S24 by name before any work is done
       (MotivationRenderService.renderSaps271).
R-012: HeldSection (the section a firearm ALREADY HELD is licensed under) has
       three values only: '13' | '15' | '16'. There is no "held under section
       24" — a renewal renews the section it was already under.
       (motivation-overlap.ts)
```

---

## 3. THE FIELD REGISTRY

```yaml
file: backend/src/motivations/motivation-fields.ts
version_constant: FIELD_REGISTRY_VERSION = '2026-09-09'
role: >
  THE CONTRACT between the form, the interview, the fact pack and the quality
  gate. A key is defined exactly once here.

MotivationField:
  key: string
  label: string
  kind: short | long | date | yesno | choice | multi | cards | number
  section: string            # which sheet section it renders under
  required?: boolean
  options?: CardOption[]     # for kind 'cards'
  showIf?: { key, equals? , hasAny? }
  scope?: 'profile'          # stored on the member, not the application
  docSourced?: MotivationUploadKind   # a PROMISE that a reader fills it
  formOnly?: boolean         # collected for the 271, NEVER shown to the writer
  internal?: boolean         # accepted, never asked, never served
  sensitive?: boolean
  maxLength?: number

R-020: fieldsFor(type) = COMMON_FIELDS + TYPE_FIELDS[type], minus
       NOT_ASKED_BY_TYPE[type].
R-021: NOT_ASKED_BY_TYPE filters what is ASKED, never what is ACCEPTED.
       fieldByKey() searches the UNFILTERED list on purpose: the wizard
       autosaves the whole blob, so a key that stopped being asked must still
       validate or the next keystroke deletes an older draft's answer.
       Current entries:
         S24_RENEWAL:      [firearm_source]
         S13_SELF_DEFENCE: [reloads, reload_calibres, reload_since]
R-022: formOnly means "reaches the SAPS 271, never the model". Contact numbers,
       postal address, spouse ID, serials, and the six history/declaration
       questions. Rationale for the history questions: six "No" answers in a
       fact pack invite the writer to pad the document with a clean record.
R-023: docSourced is a promise. The sheet files the field under "from your
       documents" and read-result prints "Not on the document" against an empty
       one. A docSourced field that no reader fills makes the product lie.
R-024: showIf takes ONE key. `hasAny: true` means "the named cards/multi field
       has any tap at all". A condition over several keys cannot be expressed
       and must be handled server-side (see R-046).
R-025: A wizard step is a union of WHOLE registry sections, never part of one,
       so a showIf pair can never be split across steps.

owned_firearm_rows:
  count: OWNED_ROWS = 14
  key_shape: existing_firearm_{N}_{column}
  columns: [make, model, serial, expiry, type, calibre, use, primary_use,
            section_held, licence_no]
  legacy_accepted: [barrel_serial, frame_serial]   # retired keys, still read
  R-026: ownedFirearmSerial(answers, n) reads `_serial` then the two retired
         keys. Any allowlist that hardcodes the old keys silently empties.
  R-027: ownedRowTaken(answers, n) decides a row is in use from a fixed column
         list. Three readers disagreeing about this overwrites a firearm.
  R-028: section_held stores a CARD KEY (section_13|15|16|17|20|unsure), not a
         number. 'unsure' is an ANSWER (resolves to no section), not a gap.
  R-029: primary_use is never docSourced from a licence card — nothing printed
         on a licence says what a firearm is FOR. It IS filled from an
         ASSOCIATION_ENDORSEMENT matched by serial (see R-047).

card_sets:
  file: backend/src/motivations/motivation-cards.ts
  R-030: Every card sentence is FIRST PERSON and goes into the document
         VERBATIM. A card is the member's own statement, so its wording is a
         legal drafting decision, not copy.
  R-031: options are OFFERED per licence type (overlapAnglesFor) but
         allowedValues accepts the WHOLE set — a draft holding a now-unoffered
         choice must keep saving.
```

---

## 4. VAULT -> APPLICATION ROUTING

This is the stage the operator asked about most directly: given documents in
the vault, which one goes where for THIS section and THIS firearm.

### 4.1 What the application needs (tiers)

```yaml
file: backend/src/motivations/motivation-documents.ts
fn: documentStatus(licenceType, uploadedKinds[], answers) -> DocumentStatus

tiers: required | expected | strengthens | extra
R-040: required   = SAPS will not process without it. Does NOT mean we refuse
                    to let the member proceed (a copy may be at a station being
                    certified).
R-041: expected   = no statute behind it, and you will be turned away without
                    it. MUST NOT be described to the member as "optional".
R-042: strengthens= genuinely optional, genuinely helps.
R-043: extra      = anything else attached.
R-044: A kind absent from every tier for a licence type breaks two surfaces:
       documentStatus omits the row, the label falls back to raw SCREAMING_CASE,
       and the picker files it under "something else you would like to attach".

REQUIRED:
  S13_SELF_DEFENCE:      [IDENTITY_DOCUMENT, COMPETENCY_CERTIFICATE, ADDRESS_CONFIRMATION, SAFE_PHOTOGRAPHS]
  S15_OCCASIONAL_HUNTER: same as S13
  S16_DEDICATED_HUNTER:  S13 + [ASSOCIATION_CARD, GOOD_STANDING_LETTER]
  S16_DEDICATED_SPORT:   S13 + [ASSOCIATION_CARD, GOOD_STANDING_LETTER]
  S24_RENEWAL:           [IDENTITY_DOCUMENT, COMPETENCY_CERTIFICATE, CURRENT_LICENCE, ADDRESS_CONFIRMATION, SAFE_PHOTOGRAPHS]

EXPECTED:
  S13/S15:               [PROFICIENCY_CERTIFICATE, FIREARM_SOURCE_PROOF]
  S16_*:                 [PROFICIENCY_CERTIFICATE, ASSOCIATION_ENDORSEMENT, FIREARM_SOURCE_PROOF]
  S24_RENEWAL:           []

STRENGTHENS:
  S13:                   [INCIDENT_REPORT]
  S15/S16_*:             [SHOOTING_ACTIVITY_LOG, CURRENT_LICENCE]

conditional_additions:
  R-045: CURRENT_LICENCE becomes REQUIRED iff any existing_firearm_N_calibre is
         non-empty. A first-time applicant owns nothing and is never asked.
  R-046: firearm_source == private  AND type != S24  ->  SELLER_LICENCE joins
         EXPECTED. Only ever ADDS, never removes: FIREARM_SOURCE_PROOF stays
         EXPECTED on both routes.
  R-047: The estate route is GONE. EXECUTOR_APPOINTMENT is demanded by nothing;
         the enum value and its labels survive so legacy uploads still render.
  R-048: SAFE_PHOTOGRAPHS is satisfied by COUNT (SAFE_PHOTO_MIN files), not by
         distinct kinds. One photo of a closed door would otherwise turn the
         row green.
```

### 4.2 Which vault document is attached automatically

```yaml
file: backend/src/motivations/motivation-autolink.ts

AUTOLINK_KINDS (may be attached unasked):
  [IDENTITY_DOCUMENT, ADDRESS_CONFIRMATION, COMPETENCY_CERTIFICATE,
   PROFICIENCY_CERTIFICATE, ASSOCIATION_CARD, GOOD_STANDING_LETTER,
   EMPLOYMENT_CONFIRMATION, CURRENT_LICENCE]

NEVER_AUTOLINK (with the reason each carries):
  ASSOCIATION_ENDORSEMENT: names one specific firearm; an older one describes the wrong gun
  FIREARM_SOURCE_PROOF:    about this purchase, not about the applicant
  SELLER_LICENCE:          belongs to the seller of this particular firearm
  EXECUTOR_APPOINTMENT:    one estate, one deceased person
  INCIDENT_REPORT:         evidence the applicant CHOSE to raise
  CHARACTER_REFERENCE:     written for one application by somebody who agreed
  SHOOTING_ACTIVITY_LOG:   must be current and specific to this application
  PREVIOUS_MOTIVATION:     a past document, not evidence for this one
  OTHER:                   we cannot know where it goes
  SAFE_PHOTOGRAPHS:        conditional — admitted once placeConfirmed is true

TAKE_ALL_KINDS: [CURRENT_LICENCE]
  R-050: "All of them", not "the right one". Five firearm licences is not an
         ambiguity — SAPS 271 item 2.1 has fourteen rows and asks for all of
         them. The several-candidates rule and the expiry cut are BOTH
         suspended for these kinds; a licence lapsing in 60 days is still a
         firearm the applicant owns and must declare.

decision_order (per kind group):
  1. already attached?            -> skip 'already-attached'  (unless takeAll/halfHeld)
  2. kind in AUTOLINK_KINDS?      -> else skip 'not-a-person-document'
                                     (SAFE_PHOTOGRAPHS skips 'needs-place-confirm')
  3. ENDORSEMENT TEST (before the count):
       COMPETENCY_CERTIFICATE  -> competencyCovers(covers, needed)
       PROFICIENCY_CERTIFICATE -> proficiencyCovers(covers, needed)
       others -> pass
     R-051: This runs BEFORE the ambiguity rule on purpose. A member holding a
            handgun certificate and a rifle certificate has two candidates, but
            only one can lawfully back this application, so there is no
            ambiguity to protect them from.
  4. expiry cut: AUTOLINK_MIN_DAYS = 90; expiresOn null is not staleness
  5. several-candidates rule: more than one surviving candidate for a kind ->
     attach NOTHING, report 'several-candidates', let the member choose
     R-052: This is the "one-or-nothing" rule. It is why two address documents
            are never chosen between — which is also the mechanism that gives
            the applicant the CHOICE of which document proves their address.

latch:
  fields: autolinkedAt, autolinkSkippedIds, rearmAutolinkFor
  R-053: Autolink runs once per application and is re-armed by explicit events
         (a document deleted, an endorsement moved). `origin: 'vault'` CANNOT
         distinguish an autolink from a member's manual addFromLibrary — only
         autolinkedAt can. Diagnosing "did it auto-attach?" from origin is
         wrong and has produced a wrong answer to the operator.
```

### 4.3 Which answer boxes a vault document fills

```yaml
file: backend/src/motivations/motivation-credentials.ts
fn: credentialOffer(...)  -> per-key offers with (title, credentialId) provenance

order:
  1. FIREARM_LICENCE credentials -> owned rows 1..14, one row per licence
     offered keys: make, model, serial, barrel_serial, frame_serial, expiry,
                   type, calibre, licence_no, section_held
     R-060: barrel_serial and frame_serial are read off `details` DIRECTLY, NOT
            through first()/answerValue(), because a card printing "NONE"
            against the barrel and a number against the receiver must not
            collapse to one number. SAPS 271 item 2.1 has TWO serial columns
            and a false statement there is an offence (s.120(9)(f)).
     R-061: section_held is mapped by sectionCardKey("SECTION 16") ->
            'section_16'. An unrecognised/absent section maps to '' — never to
            a default. Mapping unknown -> section_16 "because most are" would
            reinstate the failure the column exists to stop.
     R-062: A row is claimed by matching licence number, then serial, then
            (make AND calibre) as a last-resort guess. Overflow past 14 rows is
            reported ONCE, naming the firearms.
  2. ASSOCIATION_ENDORSEMENT credentials -> existing_firearm_{N}_use
     R-063: matched BY SERIAL ONLY. Two of a battery can share make and
            calibre; the wrong role on a signed document is the failure this
            avoids. Value = status_type/discipline as read; nothing is derived
            from the association's NAME (a body accredited for both hunting and
            sport prints two accreditation numbers).
  3. DEDICATED_DISCIPLINE credentials -> association slots, one per association
     R-064: Deduped on the association's NAME, not the document. Two papers
            from one body is one membership; listing it twice is a false claim.
     R-065: slot 1's date is association_joined (when they joined), NOT
            dedicated_since (when they qualified). These are routinely years
            apart and deriveFacts counts years_dedicated from the latter.
```

### 4.4 Annexure lettering

```yaml
file: backend/src/motivations/motivation-checklist.ts
fn: buildAnnexures(haveKinds[]) -> AnnexureEntry[] { letter, kind, label, count, certification }

R-070: Letters are assigned A, B, C... in iteration order over the kinds
       actually held.
R-071: LETTER_GROUPS collapse several kinds onto ONE letter (all safe
       photograph kinds; the retired variants). The entry's `count` drives
       "(2 of 4)" on the printed page.
R-072: annexureTitle(kind) overrides UPLOAD_KIND_LABELS for the document's own
       index only — the shelf, the checklist and the picker keep the second
       person ("Photographs of your safe"); the annexure index does not
       ("Photographs of the safe"), because the motivation is a first-person
       letter to the Registrar.
R-073: GENERATED_ANNEXURE_LABELS covers annexures we produce rather than
       reprint (press clippings, prior-notice request). They still take a
       letter and appear in the index.
```

---

## 5. DOCUMENT READING

### 5.1 Classification

```yaml
file: backend/src/licence-centre/licence-centre-extract.service.ts
const: CLASSIFY_USER   # the menu shown to the model, one entry per live kind

R-080: A CredentialKind the enum knows and the prompt does not files itself as
       OTHER on every upload, silently. licence-centre-classify.spec.ts exists
       to prevent this.
R-081: RETIRED_KINDS normalises a retired answer forward (four association
       kinds -> DEDICATED_DISCIPLINE; four safe kinds -> SAFE_PHOTOGRAPHS).
       Postgres cannot DROP an enum value, so the model can still return one.
R-082: DEDICATED_DISCIPLINE is deliberately ONE category and the prompt tells
       the model NOT to tell its members apart. One page routinely does several
       jobs. Splitting them forced a guess and filed a sport shooter's status
       as DEDICATED_HUNTER on the strength of "Hunters" in a letterhead.
R-083: ASSOCIATION_ENDORSEMENT has exactly ONE test: does the page name a
       firearm by serial. Everything else on it is identical to a status
       certificate because it is the same association writing about the same
       member.
```

### 5.2 Extraction

```yaml
const: WANTED: Record<CredentialKind, string[]>
R-090: WANTED is BOTH the question AND the filter. A key not listed is never
       asked for AND is discarded if the model volunteers it. Adding a field to
       the registry without adding it to WANTED produces a docSourced promise
       nothing can keep.
R-091: Reads use LlmService with json:{schema} so the provider enforces shape.
R-092: AWS Textract is gone. Every document read is Gemini. AWS Rekognition
       remains for KYC face-match/liveness only.

card_placeholders:
  file: backend/src/common/card-placeholder.ts
  R-093: A licence card prints "NONE" against a component that carries no
         number. That is the card being COMPLETE, not a serial called NONE.
  R-094: answerValue() strips a placeholder at ANSWER BOUNDARIES ONLY. Readers
         and the vault keep the card verbatim, because the printed
         seller-consent declaration reproduces what the card says.

licence_card_ocr:
  file: backend/src/motivations/licence-card-ocr.service.ts
  R-095: COMPONENT_MAKE reassigns a MAKE by what else is in its band on the
         card (the card's layout, not the label, decides).
  R-096: COMPONENT_FIELDS short-read raises a warning: a card that yielded
         fewer component rows than expected is a bad read, not a plain card.
```

---

## 6. PRE-GENERATION GATES

```yaml
file: backend/src/motivations/motivation-generation.service.ts  (generate())
ordered, each throws ConflictException with a distinct `code`:

G1 quota.assertEnabled()
G2 answers = shared.answersFor(userId, answersEncrypted)      # see R-001
G3 missingRequired(licenceType, answers)
     code: motivation-incomplete
G4 applicationBlockers(licenceType, answers, now)
     code: motivation-not-eligible
     checks, in order:
       0. competency currency:
          R-100: competency_expiry parses AND is strictly before today (UTC
                 midnight) -> blocker 'competency-expired'. Valid THROUGH the
                 expiry date. An unparseable or absent date is NOT a refusal.
                 Statutory basis: s.6(2) — no licence may be issued without a
                 valid competency. Clock is injected for reproducibility.
       1. section vs firearm shape:
          R-101: sectionAllows(section, category, selfLoading). A self-loading
                 rifle under s.13 is impossible, not weak.
          R-102: NO DEFAULT CATEGORY. An unknown firearm shape means NO check —
                 screening a firearm nobody described against another's rules
                 is worse than not checking.
       2. competency endorsement coverage:
          R-103: fires only when competency_for is non-empty. An unread or
                 cleared value can only ever produce silence, never a refusal.
                 A wrong "no" here sends somebody to their DFO over nothing.
          R-104: a combination gun is refused only if the competency covers
                 NEITHER barrel. The stricter rule (both) is not in the Act,
                 the Regulations, or the reference, so it is not enforced.
     R-105: applicationBlockers counts HOLDINGS NOWHERE. Holding a section 16
            handgun does not block a section 13 application. (Operator,
            2026-09-09, confirming this is correct.)
G5 documentStatus(licenceType, uploadKinds+coversKinds, answers).missingRequired
     code: motivation-documents-incomplete
     R-106: runs AFTER G3/G4 because the required list is CONDITIONAL on the
            answers (R-045, R-046).
G6 compare-and-swap claim of the row out of REGENERABLE status
     EDITABLE    = [DRAFT, INTERVIEW, NEEDS_MORE_INFO]
     REGENERABLE = EDITABLE + [COMPLETED]
     R-107: two clicks on Generate must not both call the model. Only the
            request that MOVES the status proceeds; the other is a no-op.
     R-108: COMPLETED is regenerable — a member may ask for a rewrite of a
            finished document. GENERATING, QUALITY_REVIEW, FAILED and ABANDONED
            are not.
```

---

## 7. THE FACT PACK

```yaml
type: FactPack   (backend/src/motivations/motivation-prompts.ts)
fields:
  licenceType
  answers            # minus formOnly and internal fields
  arsenal            # ArsenalRow[]  (see 7.2)
  derived            # deriveFacts(answers) — computed scalars
  overlapNote        # only when a same-class holding exists (see 14)
  research           # concatenated supplied-fact blocks (see 7.3)
  annexures          # letters + labels, for citation

R-110: THE FACT PACK IS THE ONLY THING THE WRITER SEES. Anything not in it
       cannot legitimately appear in the document, and rule 1 of the system
       prompt says so.
R-111: answers values are sanitised by sanitizePromptValue (collapses newlines,
       truncates ~200 chars) EXCEPT long free-text fields, which are delimited
       and marked untrusted instead.
R-112: firearm_calibre is replaced with displayCalibre(...) in the pack copy
       ONLY. The stored answer stays the card's own string. packConsistency
       accepts either form.
```

### 7.1 derived facts

```yaml
fn: deriveFacts(answers)
examples: years_dedicated, firearms_held_count, age, distances
R-115: A derived scalar is written as <derived name="...">value</derived>.
R-116: HISTORICAL FAILURE, now fixed: `firearms already held: 5` was supplied
       with NO firearm detail while overlapNote instructed the writer to
       "meet that head on". The model invented five firearms including two
       licence sections. See 7.2.
```

### 7.2 arsenal

```yaml
file: backend/src/motivations/motivation-arsenal.ts
fn: arsenalRows(answers, sections) -> ArsenalRow[]
    arsenalBlock(rows) -> string ('' when empty)

row_render: <firearm make="..." model="..." type="..." calibre="..."
                     serial="..." section="..." licensed_for="..." expires="..."/>
R-120: An ABSENT field is OMITTED, never emitted as "". section="" invites the
       model to fill it; no attribute at all is a thing the rule can forbid.
R-121: section comes from existing_firearm_N_section_held FIRST (the member's
       answer, correctable), then falls back to a vault lookup by serial
       (ownedFirearmSections). 'unsure' resolves to NO section and must NOT
       fall through to the vault.
R-122: ownedFirearmSections matches BY SERIAL ONLY and refuses a
       make-and-calibre match. Two cards disagreeing about one serial -> that
       row is dropped.
R-123: licensed_for is `use` or `primary_use` — stated or absent. Where absent
       the block instructs the writer to say nothing about purpose.
R-124: An EMPTY arsenal block is NOT SENT. "<arsenal></arsenal>" is an
       invitation to explain the absence.
R-125: ONE ARRAY, THREE READERS: this block, the printed battery table and SAPS
       271 item 2.1 must agree serial for serial.
```

### 7.3 research block (supplied facts, not web search)

```yaml
composition (in order, all optional):
  precinctBlock       # SAPS quarterly figures, home station
  + travelled precincts (max 3, from areas the member TICKED)
  pressClippingsBlock # clippingFactLines(pressClips)
  cartridge           # cartridgeFacts(row) — dimension sheet
  research            # LLM-grounded research, last

R-130: The heading "SAPS PRECINCT CRIME FIGURES — supplied fact, not web
       research:" is NAMED IN RULE 1 of the system prompt. Change one and the
       other goes stale.
R-131: Precinct figures may be quoted exactly with their period and source and
       MUST NOT be extrapolated into a trend, a risk level or a conclusion.
R-132: Travelled precincts come only from `travelled_areas` — an answer the
       member gave, not a radius we drew. That is what makes another precinct's
       numbers admissible about THIS applicant. Capped at 3.
R-133: Clippings: cite by paper, date and annexure letter; never paraphrase
       beyond headline + standfirst. clippingFactLines appends an instruction
       to use the SAPS CATEGORY (in brackets on each line) rather than
       translating a headline's own word for a crime.
R-134: cartridgeFacts emits name/type/origin/year/case length/max OAL/bore/
       groove/grooves/pmax and then FORBIDS velocity, energy, stopping power,
       grain weights, and naming the source of the figures. Returns null with
       fewer than 3 lines (a name alone is not a dimension sheet and invites
       the model to fill the rest from memory).
R-135: The cartridge is resolved by findCartridge (see 7.4). No sheet -> no
       block; the rule against recalled ballistics still stands.
R-136: The pack may or may not carry a DRAWING of the cartridge, and the
       writer is told it does not know which and does not control the layout,
       so it must never refer to one.
```

### 7.4 calibre resolution

```yaml
file: backend/src/motivations/motivation-cartridge.ts
fn: calibreKey(s)            # uppercase, strip non-alphanumeric
    calibreCandidates(s)     # expansions + contractions + bracketed alternates
    findCartridge(rows, printed)

ladder (stops at first hit):
  1. exact match on name | slug | alias (reduced key)
  2. UNIQUE prefix match, candidate length >= 4
  3. UNIQUE substring match, candidate length >= 4
R-140: Uniqueness is counted in CARTRIDGES, not in strings — one cartridge
       answers to several stored names.
R-141: A bare "9mm" touches 9 mm Luger, 9 mm Makarov and 9 mm Browning court,
       so it resolves to NOTHING. The pack ships without dimensions rather than
       with another round's dimensions under the applicant's signature.
R-142: Parabellum->Luger and ACP->Auto are STANDARDS SYNONYMS (one round, two
       published names). Nothing in the list narrows an ambiguous name to a
       likely one.
```

---

## 8. THE STRUCTURE PLAN

```yaml
file: backend/src/motivations/motivation-structure.ts
fn: planFor(licenceType, seed, { hasOverlap }) -> StructurePlan
StructurePlan: { seed, sections: [{id, heading, paragraphs}], opening, closing, cadence }

SectionId:
  introduction, personal_circumstances,
  the_quarry | the_discipline | the_threat,     # the purpose triple
  existing_measures, experience, the_firearm, the_calibre,
  comparison, statutory_application, storage_safety, compliance_history,
  conclusion

R-150: THREE PURPOSE IDS, NOT ONE. "The quarry and the ground I hunt" and "The
       discipline and its course of fire" are not alternates of each other, and
       a self-defence applicant must never be handed either.
R-151: the_calibre is separate from the_firearm on hunting/sport types because
       they answer different questions (platform vs cartridge-against-
       requirement). Folded together they go one line deep on both.
R-152: `comparison` is in every skeleton and is DROPPED unless the applicant
       holds a same-class firearm (planFor filters on opts.hasOverlap).
R-153: The plan is STORED on the row and re-read by the renderer
       (sectionMarksFor, comparisonHeadingOf), keyed by the heading AS PRINTED
       (uppercased, colon stripped).

SECTION_SKELETONS (order; [a,b] = permuting pair):
  S13_SELF_DEFENCE:
    [introduction, the_threat, storage_safety, existing_measures,
     the_firearm, comparison, statutory_application, conclusion]
  S15_OCCASIONAL_HUNTER / S16_*:
    introduction -> personal_circumstances -> purpose -> ... ->
    [experience, storage_safety] pair -> compliance_history -> comparison ->
    statutory_application -> conclusion
  S24_RENEWAL: its own skeleton; type test OFF (see R-158)

R-154: S13 was reordered 2026-09-09. personal_circumstances, the_calibre and
       compliance_history LEFT; existing_measures ARRIVED; experience folded
       into statutory_application. Marital status and employer address are 271
       boxes, not prose.
R-155: existing_measures is the half of the s.13 test the document never made:
       what is already done about the risk and where each measure stops. A
       document that never disposes of the alternatives asks for a firearm as a
       first resort.
R-156: S13 now has NO PERMUTING PAIR. Its order is fixed. The anti-template
       load falls entirely on heading alternates (4 deep per section per type),
       opening/closing/cadence draws, and the conditional comparison section.
       MONITOR: the admin sameness report.
R-157: paragraphs: introduction=1, conclusion=1,
       statutory_application=3..4, the_firearm on S13 = 1, everything else 2..4.
       "This is ROOM, not an instruction to fill it" — but see R-176.
R-158: The type-overlap test is OFF for S24. A renewal applicant holds the
       firearm being renewed and it is by definition the same type as itself;
       left on it produced a section arguing why a firearm does not duplicate
       ITSELF, over the applicant's signature.

fingerprint / sameness:
  fn: fingerprint(text), maxSimilarity(fp, previous)
  const: SIMILARITY_REGENERATE_THRESHOLD = 0.55, SIMILARITY_CORPUS = 200
  R-159: ⚠️ THE COMPARISON SET EXCLUDES THE APPLICANT'S OWN DOCUMENTS.
         recentFingerprints() selects: same licenceType, id != this one,
         status == COMPLETED, and **userId != this applicant**, most recent
         SIMILARITY_CORPUS rows.
         Rationale (operator, 2026-08-18): the engine exists so the CFR never
         sees near-identical documents from DIFFERENT people. Two motivations
         by the SAME person describe one life and SHOULD share circumstances —
         forcing them apart manufactures the exact contradiction a DFO looks
         for (the same commute, premises and history told two different ways).
         Proper nouns are stripped before tokenising, so the comparison is on
         structure and phrasing rather than on names.
```

---

## 9. THE PROMPTS

```yaml
file: backend/src/motivations/motivation-prompts.ts
fns: generationSystemPrompt(licenceType), generationUserPrompt(pack, plan),
     gateSystemPrompt(), gateUserPrompt(pack, documentText)

R-160: BLOCK ORDER IN THE USER MESSAGE IS A PROMPT-CACHE DECISION, NOT A STYLE
       ONE. Exact order emitted by generationUserPrompt:
         1. "Draft the motivation for a <type> application."
         2. renderStatute(licenceType)          # <statutory-text>, stable per type
         3. "STRUCTURE — use these headings..." + per-section briefs
         4. OPENING_GUIDE / CLOSING_GUIDE / CADENCE_GUIDE  (seeded)
         5. renderOverlap(overlapNote)
         6. arsenalBlock(arsenal)
         7. renderResearch(research)            # <background-research>
         8. renderAnnexures(annexures)
         9. UNTRUSTED_NOTICE
        10. <applicant-facts> renderFacts(pack) </applicant-facts>
        11. "Write the document now."
       The stable prefix is (1)+(2): the lead line and the whole statute block,
       ~4630-4870 tokens, which is what earns the cache discount. EVERYTHING
       below (2) varies per applicant and the discount stops at the first byte
       that differs — so a name, a date, a reference number or "today is"
       moved above the statute costs every generation the whole prefix.
       ⚠️ NOTE the facts come LAST, after the arsenal, the research and the
       annexure letters. Any analysis that assumes facts-then-instructions has
       the order backwards.
R-161: renderResearch wraps the research block UNTRUNCATED. `derived` values go
       through sanitizePromptValue's 200-char cap; nine lines of crime figures
       must not.
```

### 9.1 System rules (numbered, verbatim intent)

```yaml
1  ONLY THE FACTS SUPPLIED. No invented circumstance, date, place,
   qualification, incident, membership or statistic.
   1a NUMBERS TOO — no measurement, weight, dimension, barrel/overall length,
      velocity, energy, bullet weight, magazine/chamber capacity, rate, date,
      design feature or cartridge history unless it appears in the answers or
      the research block.
   1b HEDGES DO NOT RESCUE A RECALLED FIGURE ("approximately", "about",
      "roughly", "typically", "in the region of").
   1c Where the facts carry no technical argument, ARGUE FROM WHAT THEY CARRY
      AND SAY LESS.
   1d The precinct block and the clippings block are SUPPLIED FACT: quote
      exactly, never extrapolate.
2  FIRST PERSON, as the applicant. Never refer to a service, platform,
   assistant or drafter.
3  NEVER PREDICT THE OUTCOME. Not "should succeed", "likely to be approved",
   "meets the threshold". (Asking for the licence is NOT predicting — rule 14.)
4  QUOTE THE STATUTE ONLY FROM <statutory-text>, AND APPLY EVERY WORD QUOTED.
   No block -> quote nothing; name the section and take its requirements in
   plain language.
5  No mascot, no brand, no marketing, no headings other than those given.
6  South African English. licence(n)/license(v), authorisation, favourable,
   calibre, centre-fire, self-defence. Keep Afrikaans species/equipment terms
   the applicant used.
7  DO NOT PAD. No potted histories, range lists, ethics essays, manufacturer
   copy. Padding is generic by construction, therefore IDENTICAL across
   documents, therefore the shared-origin signal the whole design avoids.
8  BE THOROUGH WITH WHAT YOU HAVE. Rationale is yours to write; HISTORY is not.
   "I train weekly" is a verifiable fact and needs supplying; "I intend to
   train regularly" is rationale and is always available.
   8a WATCH WHAT FRAMING IMPLIES. "back-up", "secondary", "not my match
      firearm" ASSERT that another firearm exists.
   8b NEVER STATE A DATE UNTIL WHICH A COMPETENCY IS VALID. Give the number and
      say it is valid. A SAPS competency prints no expiry, so any such date is
      derived. (Added 2026-09-09 after a live failure.)
9  ADVOCATE, NOT REVIEWER. Do not argue against the applicant.
10 IDENTIFY THE APPLICANT AND THE FIREARM, EXACTLY AND ALWAYS (ID number,
   make, calibre, serial).
11 CITE THE ANNEXURE THAT PROVES THE CLAIM, AND ONLY WHERE ONE EXISTS.
12 PURPOSE BEFORE FIREARM.
13 LENGTH: PROSE_TARGET[licenceType] —
     S13 900-1400 | S15 1200-1800 | S16_* 1200-1800 | S24 600-900
   Prose only; annexures/forms/PAJA notice are assembled by us.
14 (conclusion brief) END BY REQUESTING THE LICENCE, naming the section, make,
   calibre, serial and purpose FROM THE FACTS.
15 BANNED PHRASES — enforced document-wide by code, see 11.2.
```

### 9.2 Section briefs

```yaml
const: SECTION_BRIEFS: Record<SectionId, string>
const: BRIEF_OVERRIDES: Partial<Record<LicenceType, Partial<Record<SectionId,string>>>>
R-170: BRIEF_OVERRIDES currently has ONE entry: S13.the_firearm — one
       paragraph, at most sixty words, four facts (type+make, calibre, why a
       handgun not a rifle, ammunition commonly available), and an explicit
       list of what is forbidden (action, barrel, capacity, trigger, frame
       material, ballistics, model comparisons, manufacturer history).
       Rationale: the generic brief asks for action/barrel/capacity/ballistics,
       which is right for a hunting rifle and produced 150 words of catalogue
       copy on a self-defence application.
```

---

## 10. THE GENERATION LOOP

```yaml
file: backend/src/motivations/motivation-generation.service.ts

10.1 build:
  arsenal   = arsenalFor(userId, answers)          # vault sections by serial
  cartridge = cartridgeFor(answers)                # dimension sheet block
  precinct  = crimeStats.precinct(home) + travelled precincts (max 3)
  clippings = news.byIds(press_clippings) filtered by packableIncidents
  overlap   = checkOverlap(...)                    # see 14
  pack      = FactPack{...}
  plan      = planFor(type, seed, { hasOverlap: !!overlap.writerNote })

10.2 attempt:
  attempt = model.generate(pack, plan)
  structureOk = followsPlan(attempt.text, plan).ok
  sameness    = maxSimilarity(fingerprint(attempt.text), recentFingerprints)
  mechanics   = packConsistency(text, answers, annexures)
              + documentScope(text, { licenceType, arsenal })

10.3 ONE retry, on any of: !structureOk | sameness > 0.55 | mechanics.length
  R-180: exactly one retry, with a FRESH SEED. A second identical result means
         the variation engine is broken, which is an admin problem.

10.4 if mechanics still non-empty:
  status = FAILED; failureReason = first 3 issues; AdminAlert
           'motivation-verify-failed' (urgent); notify member 'failed'
  R-181: A mechanical/scope failure NEVER goes back to the applicant as a
         question. They cannot fix the writer's vocabulary by answering
         something else.

10.5 model quality gate:
  graded = model.verifyDocument({ pack, documentText, annexures })
  GateVerdict { completeness, specificity, consistency, groundedness, overall,
                thinFields[], issues[], passed }
  const QUALITY_FLOOR = 65; GROUNDEDNESS_FLOOR = 70
  passed = overall >= 65 AND groundedness >= 70

10.6 outcomes:
  passed          -> COMPLETED, qualityPassedAt set, PDF unlocked
  !passed and gateCycles+1 < FLAGS.motivationMaxGateCycles
                  -> NEEDS_MORE_INFO, thinFields become follow-up questions
  !passed and cycles exhausted
                  -> FAILED, AdminAlert 'motivation-gate-exhausted'
  R-182: A gate-exhausted document is still STORED with its score and findings.
         "Finished" still means finished — the PDF stays gated on COMPLETED and
         the text is a draft to read.
```

---

## 11. DETERMINISTIC VERIFIERS

These are the cheap half of the verification pair. The model half is 10.5.
Operator rule: TWO verifiers per document, and not more.

### 11.1 packConsistency

```yaml
file: backend/src/motivations/motivation-verify.ts
checks:
  V1 every cited "Annexure X" exists in the pack
  V2 the applied-for SERIAL appears in the document
  V3 the applied-for CALIBRE appears (raw form OR displayCalibre form)
  V4 the applicant's 13-digit ID appears
  V5 any labelled "Serial Number: X" that is neither the applied-for serial nor
     an OWNED serial is reported as invented
     R-190: the owned-serial allowlist is built from ownedFirearmSerial over
            OWNED_ROWS. When it silently emptied (retired keys, hardcoded
            range) this check FAILED LOUD AND WRONG — reporting a member's own
            second rifle as a fabrication.
  V6 every DATE asserted must be possible:
       - not before the applicant's date of birth (read from the ID number)
       - not after now + 1 day (SAST offset)
       - dates the applicant supplied are exempt
       - statute sentences without first person are exempt
  V7 every MAKE discussed appears somewhere in the answers
```

### 11.2 documentScope

```yaml
file: backend/src/motivations/motivation-scope.ts
signature: documentScope(text, { licenceType, arsenal }) -> string[]

S1 SECTION CLAIMS
   for each sentence, bestFirearmMatch(sentence, batteryNames) -> row?
   if row and sentence says "section N":
     row.section empty      -> ISSUE (no card established a section)
     row.section != said    -> ISSUE (names the card's section)
   R-200: sentences naming NO held firearm are ignored — "I apply under section
          13" must pass.

S2 ROLE CLAIMS
   if row and row.licensedFor empty and sentence contains a SPORTING_WORD
     -> ISSUE (nothing stated what it is licensed for)

S3 DOCUMENT-WIDE REGISTER (whole text, first hit per phrase)
   CATALOGUE_PHRASES: terminal ballistic, stopping power, magazine capacit,
     high capacity, short(-)recoil, tilting barrel, polymer frame, safe action,
     striker(-)fired, foot(-)pound, muzzle energy, muzzle velocity, grain
     bullet, expansion, penetration, ergonomic, reliability under, maintenance
     cycle, proven track record, battle-proven, combat-proven, state-of-the-art,
     cutting-edge
   + PRODUCT_PAGE_WORDS (shared with the reason validator): power factor, split
     times, high-volume, platform, tactical, engage targets, dynamic,
     competitively, efficiently
   + AMERICANISMS: caliber, defense, offense, meters, authoriz, utiliz,
     recogniz, organiz, analyz, specializ, maximiz, minimiz, "program "
   + NOT_SOUTH_AFRICAN_DIVISIONS: Carry Optics, Limited 10, Stock Service
     Pistol, Carry Optics Division

S4 COMPETENCY VALIDITY DATE
   sentence mentions competency AND a validity/expiry phrase -> ISSUE

S5 S13 SCOPE (licenceType == S13 only), PER SENTENCE
   aboutHeld = matched a held firearm OR names section 15/16
   if !aboutHeld and sentence contains a SPORTING_WORD -> ISSUE
   R-201: THIS IS WHY IT IS PER SENTENCE. The strongest paragraph an S13 has is
          "licensed under section 16 for hunting, and a section 16 firearm may
          not be carried for self-defence". A blanket word ban deletes the
          argument.
   RELOADING_WORDS (reload, handload, propellant, primer) are refused in ANY
   sentence on an S13.

S6 word budget constants exported but NOT enforced as a failure:
   S13_MIN_WORDS = 900, S13_MAX_WORDS = 1400
   STATUS: reported only; a document 40 words short is not a refusal.
```

---

## 12. THE MODEL QUALITY GATE

```yaml
file: backend/src/motivations/motivation-model.service.ts (verifyDocument)
prompts: gateSystemPrompt(), gateUserPrompt(pack, documentText)
R-210: The gate sees the SAME fact pack the writer saw, including <arsenal>,
       so "is this grounded" is answerable rather than guessable.
R-211: thinFields are field KEYS, and they are turned into follow-up questions
       for the member. Anything the member cannot act on must not reach here —
       that is what 11.1/11.2 are for.
```

---

## 13. THE REASON GENERATOR (SEPARATE PATH)

```yaml
file: backend/src/motivations/motivation-reason.ts, motivation-reason.service.ts
scope: ONE paragraph — the applicant's reason for THIS firearm — generated and
       validated independently of the document.
constants: REASON_MIN_WORDS = 180, REASON_MAX_WORDS = 320
angles: REASON_ANGLES per licence type; anglesFor() withholds
        'exercise_eligibility' unless an association rule is supplied.

validateReason rejections:
  - DEFENCE_WORDS (self-defence, protection, backup, home defence, concealed,
    close protection) in an S15/S16 reason
  - PRODUCT_PAGE_WORDS
  - AMERICANISMS
  - NOT_SOUTH_AFRICAN_DIVISIONS
  - UNPROVABLE_RULE_WORDS (requirement, criteria, criterion, eligib,
    "restricted to", capacity requirement, minimum calibre, entry rule) unless
    an association rule was supplied
  - a DISTANCE the supplied terms do not support
R-220: proseFirearmName() lower-cases only words of 4+ letters; model
       designations are untouched.
R-221: bestFirearmMatch() is an ARGMAX across the whole battery and a TIE IS
       NOT A MATCH. A yes/no test against one entry produced false accusations
       where two firearms shared a make and a calibre.
R-222: These lists are now shared with documentScope (11.2) so one paragraph
       and the whole document are policed by the same vocabulary.
```

---

## 14. OVERLAP ("you already hold one of these")

```yaml
file: backend/src/motivations/motivation-overlap.ts
fn: checkOverlap(appliedForCalibre, held[], opts) -> OverlapCheck
    { verdict, needsJustification, prompt, writerNote, suggestedAngle[] }

two independent tests, both run:
  T1 CALIBRE CLASS  — does the .308 you hold already cover this game
  T2 FIREARM TYPE   — two handguns are two handguns
  typeTestFor(licenceType): 'leads' | 'secondary' | 'off'
    off  = S24 (see R-158)

per-firearm direction: perFirearm(h, myAction, mySection)
  = describeHeld(h) + overlapStrengthClause(...) + stated use, or
    "no stated use. Argue only from what it is chambered for" (rule 8)

overlapStrengthClause, in order:
  C1 SECTION (leads):
     same section  -> "the duplication is real and must be answered on its merits"
     different     -> "SAY THIS FIRST AND STOP THERE... a licence is issued
                       under a section for a purpose, and that one does not
                       cover the purpose of this application"
     R-230: A firearm held under another section is not a competitor for the
            role. Operator, 2026-09-09: a section 16 handgun does not stand in
            the way of a section 13 application. Before 2026-09-09 this clause
            came SECOND and read "worth naming", behind an action clause that
            told the writer to PRESS the duplication.
  C2 ACTION:
     same action + different section -> "what makes the two look alike on a
                                         register... do not build the paragraph
                                         on it"
     same action + same section      -> "CLOSER duplication — press it"
     different action                -> "LIGHTER duplication... do not argue it
                                         as if the two were the same firearm"

suggestedAngle (a REORDERING of the fixed card set, never a new sentence):
  lead 'different_section' when any matched firearm's section differs
  then 'different_purpose' when a held firearm's stated purpose conflicts
  then, by bucket:
    dedicated status + calibre match -> different_division, backup,
                                        match_and_practice
    type match, no calibre match     -> different_quarry, different_range
    otherwise                        -> different_format, different_purpose

R-231: The card 'different_section' says the LICENCE does not cover this
       purpose — NOT that the firearm may not be used. The stronger claim is a
       proposition about the Act and the card's sentence goes verbatim into a
       signed document.
R-232: writerNote ends with a per-firearm roll-call and an explicit "TAKE THESE
       ONE AT A TIME... do not reuse the same closing sentence twice".
R-233: the strength clause NEVER reaches the applicant-facing `prompt`.
```

---

## 15. RENDERING

```yaml
file: backend/src/motivations/motivation-pdf.service.ts  (pdfkit)
      backend/src/motivations/motivation-render.service.ts (assembles the input)
      backend/src/motivations/motivation-pdf-merge.ts     (pdf-lib splices)

15.1 body:
  input.body is split on blank lines; isHeading() decides heading vs paragraph.
  Headings render as numbered, centred, uppercase band + ring node.
  Body is serif, justified, indented under a section rule.
  "(Refer to Annexure X: ...)" renders italic on its own line, never justified.

15.2 blocks placed under the WRITER'S OWN heading (not as separate sections):
  cartridge drawing -> heading matching /\bCARTRIDGE\b/i
  battery table     -> heading === input.batteryHeading (read off the stored
                       plan's `comparison` section, uppercased, colon stripped)
  R-240: matched on the PLAN, never on words, because `comparison` has four
         heading alternates per licence type chosen by seed.
  R-241: each has a FALLBACK: if the writer never opened that section, the
         block prints under a heading of its own rather than being dropped.

15.3 battery table columns:
  Make and model | Type | Calibre | Serial | Section | Purpose | Expires
  R-242: Section prints an em dash where no licence card established one.
  R-243: Purpose is stated or absent, NEVER derived from the section number.
  R-244: An EMPTY table still prints "No firearm is currently licensed to me.
         This is a first application." — a material fact on a first application.

15.4 cartridge drawing:
  files: motivation-cartridge-drawing.ts (geometry) + sharp (rasterise)
  R-245: completeDims() derives the letters a C.I.P. sheet does not print (a
         case with no shoulder prints none; a rimmed revolver case prints no
         extractor groove). 132 of 215 sheets carry all 13 letters. A DERIVED
         letter is drawn and NEVER dimensioned.
  R-246: The SVG carries GEOMETRY ONLY. Callout text travels beside it as
         DrawingText[] and pdfkit sets it in the document's own fonts —
         librsvg has no system-ui and would pick a different face per machine.
  R-247: The silhouette is a PORT of frontend/lib/bench/geometry.ts and the two
         must stay identical: the shape a member sees on The Bench and the
         shape printed in their pack are one shape.
  R-248: It REPLACES the spliced C.I.P. facsimile page (input.cipSheet), which
         is now only the fallback when we hold no figures. The precedence is
         stated in TWO places — reserving the page and MERGING it are separate
         passes, and gating only the body left an unreferenced page appended
         after the signature.

15.5 annexures:
  images embedded; PDFs merged by pdf-lib AFTER pdfkit has drawn the body
  R-250: The contents page and the footers are written BEFORE the merged pages
         exist. Every page number must be the number the page will END UP with,
         so every insertion is registered in `insertions` in advance and
         shiftFor() applies it. Nothing throws when this is wrong; the document
         is just internally inconsistent, which only a person holding paper
         sees.

15.6 press clippings annexure:
  page 1: SAPS quarterly figures table per precinct cited (max 3), with the
          release named on each table
  then:   one clipping per page — masthead (paper + date + "i of n"), headline,
          picture, standfirst, rule, link small
  R-251: ONE LETTER for the whole clippings annexure, "i of n" on each page.
  R-252: Never the article BODY. See 18.1 — this is contested.

15.7 other generated pages:
  prior-notice request (PAJA), character witness statements, seller consent,
  "take these with you" checklist (route-aware)
  R-253: Witness statements and the seller consent are NOT lettered as
         annexures — an annexure is a REPRINT of a document the applicant
         gathered; these are generated from evidence given to us directly.
```

---

## 16. SAPS 271

```yaml
file: backend/src/motivations/saps271.service.ts, saps271-map.ts, saps271-coords.ts
route: GET /api/motivations/:id/saps271   (Clerk-guarded, private no-store)
ui: /licence-centre/[id]/pack  (Show the form / Download the form, on demand)

R-260: FILLED BY DRAWING ON THE FLAT FORM, not by setting AcroForm fields. The
       supplied fillable template has 205 fields over 1136 widgets, 157 shared —
       setting one value paints into every widget of that field.
R-261: Every value is placed by ABSOLUTE COORDINATE (page, x, y) derived from
       the form's own ruling lines. THE PDF IS THEREFORE PART OF THE MAP: the
       blank is sha256-hashed on load and a mismatch REFUSES to fill. A newer
       SAPS revision would still resolve every coordinate and land it wrong,
       silently.
R-262: NEVER TOUCHED: signatures, signing dates, sections A/B/C (police/CFR),
       section F (the current owner's — dealer completes and stamps) and
       section K (DFO's report). None is in the coordinate map.
R-263: WinAnsi cannot encode a checkmark; a tick is the letter X, which is what
       the form asks for. It also cannot encode a newline and throws on
       MEASUREMENT, so whitespace is flattened before anything is measured.
R-264: item 2.1 fills BOTH serial columns (barrel and frame/receiver) verbatim
       including "NONE". Leaving a NONE blank is forbidden by operator
       instruction; a wrong entry is an offence under s.120(9)(f).
R-265: Section F is filled ONLY from a COMPLETED, SIGNED seller consent AND
       only when firearm_source says the route was private. Two independent
       gates.
R-266: A section 24 is refused by name before any work (R-011).
R-267: leftBlank is computed and currently reaches no surface. The licence/
       permit column of item 2.1 is deliberately excluded from leftBlank (it is
       for a storage permit over somebody else's firearm; uncommon, left blank).
```

---

## 17. INVARIANTS (violating any of these is a defect)

```yaml
I-01: The writer may state ONLY what the fact pack contains. Every rule in 9.1
      and every check in 11 exists to enforce this.
I-02: A fault the APPLICANT cannot fix by answering a question must never be
      returned to them as a question. It fails to an admin.
I-03: Uncertainty resolves to SILENCE, never to a default. Unknown section ->
      no section. Unknown cartridge -> no dimensions. Unreadable competency
      date -> no refusal. A guess that happens to be right is still a guess.
I-04: A member's own answer outranks any automated fill (R-002), and an
      automated fill must be visible and correctable.
I-05: One source of truth per fact. The arsenal block, the printed battery
      table and SAPS 271 item 2.1 are the same rows (R-125).
I-06: Card placeholders ("NONE") are stripped at ANSWER boundaries only
      (R-094).
I-07: No Bench/C.I.P. surface names where a figure came from — copyright
      boundary, not style (CLAUDE.md).
I-08: No outcome language anywhere, in prose or in UI copy (rule 3).
I-09: Never describe an 'expected'-tier document as optional (R-041).
I-10: The PDF is produced only from COMPLETED (R-003).
```

---

## 18. KNOWN GAPS AND OPEN DECISIONS

```yaml
18.1 press clipping content — CONTESTED, UNRESOLVED
  operator 2026-09-07 (in news.types.ts): "just the picture and headline and
    subscript... Never the body of the article... reproducing it is the
    publisher's right, not ours."
  operator 2026-09-08 (MOTIVATION-S13-OUTPUT-REVIEW.md §1.7): embed the article
    body OR a screenshot, "with the paraphrase rule relaxed for an annexed
    source".
  STATUS: only the agreed half (the precinct figures table) is built.
  DECISION NEEDED: somebody else's copyright.

18.2 association activity library — NOT BUILT
  brief §5.5a: association-activities.ts keyed on SAPS accreditation number,
  every exercise/league/discipline with its ELIGIBILITY RULE VERBATIM, source
  URL, verifiedAt. The reason generator may only name activities from the
  endorsing association's entry, and the pack annexes the rule.
  STATUS: GAP. UNPROVABLE_RULE_WORDS (13) currently refuses the claims this
  would let the writer prove.
  BLOCKED ON: operator review of scraped data before it ships.

18.3 endorsement reading — PARTIAL
  DONE: CredentialKind.ASSOCIATION_ENDORSEMENT + migration; classifier entry;
        WANTED fields; Document Centre slot; primary_use fill by serial.
  GAP:  no real SAHGCA endorsement fixtures in the repo (the three samples are
        in the operator's Downloads and carry personal data).
  NOTE: deliberately NOT in VAULTABLE — the Document Centre is the route; see
        the FIREARM_LICENCE precedent.

18.4 cipSheetEnabled
  The spliced facsimile page renders only when we hold no figures, and its
  heading no longer names a source. Retire the flag or keep it as a fallback —
  a decision, not a defect.

18.5 moderation-style settings read by nothing
  Not in this pipeline, but adjacent: three admin settings keys survive that
  nothing reads (claude_confidence_threshold, new_seller_firearm_review_count,
  high_value_review_threshold).

18.6 S13 word budget is reported, not enforced (S6 in 11.2).

18.7 leftBlank from the 271 reaches no member-facing surface (R-267).

18.8 sameness monitoring is manual
  S13 lost its permuting pair (R-156). Nothing alerts on a rising sameness
  score; somebody has to read the admin report.
```

---

## 19. FILE INDEX

```yaml
registry_and_contract:
  backend/src/motivations/motivation-fields.ts        # THE contract
  backend/src/motivations/motivation-cards.ts         # card sets, verbatim sentences
  backend/src/common/card-placeholder.ts              # "NONE" handling

vault_and_routing:
  backend/src/motivations/motivation-documents.ts     # tiers, needs, blurbs
  backend/src/motivations/motivation-checklist.ts     # annexures, take-with-you
  backend/src/motivations/motivation-autolink.ts      # what attaches unasked
  backend/src/motivations/motivation-credentials.ts   # vault -> answer offers
  backend/src/motivations/motivation-library.ts       # what may be lent
  backend/src/motivations/vault-adoption.service.ts   # application -> vault
  backend/src/licence-centre/licence-centre-extract.service.ts  # classify + WANTED
  backend/src/motivations/licence-card-ocr.service.ts

gates:
  backend/src/motivations/motivation-eligibility.ts   # applicationBlockers
  backend/src/motivations/motivation-verify.ts        # packConsistency
  backend/src/motivations/motivation-scope.ts         # documentScope

fact_pack_and_writing:
  backend/src/motivations/motivation-prompts.ts       # system rules, briefs, gate
  backend/src/motivations/motivation-structure.ts     # skeletons, headings, seed
  backend/src/motivations/motivation-arsenal.ts
  backend/src/motivations/motivation-cartridge.ts     # dimension facts + matcher
  backend/src/motivations/motivation-overlap.ts
  backend/src/motivations/motivation-reason.ts        # the reason paragraph
  backend/src/motivations/motivation-danger-areas.ts  # areas + clipping picks
  backend/src/motivations/motivation-route.ts         # commute route -> areas
  backend/src/motivations/motivation-incident-filter.ts
  backend/src/motivations/motivation-generation.service.ts   # THE ORCHESTRATOR
  backend/src/motivations/motivation-model.service.ts        # LLM calls + gate

rendering:
  backend/src/motivations/motivation-render.service.ts
  backend/src/motivations/motivation-pdf.service.ts
  backend/src/motivations/motivation-pdf-chrome.ts
  backend/src/motivations/motivation-pdf-layouts.ts
  backend/src/motivations/motivation-pdf-merge.ts
  backend/src/motivations/motivation-cartridge-drawing.ts
  backend/src/motivations/saps271.service.ts / saps271-map.ts / saps271-coords.ts

surfaces:
  frontend/app/licence-centre/[id]/page.tsx           # the review sheet
  frontend/app/licence-centre/[id]/pack/page.tsx      # the pack + the 271
  frontend/app/licence-centre/applications/page.tsx
  frontend/components/licence-centre/*                # sheet rows, shelf, cards
  frontend/components/document-centre/kinds.ts        # vault sections

companion_docs:
  MOTIVATION-REBUILD-BRIEF.md          # the operator's brief; §0 is the ruling set
  MOTIVATION-S13-OUTPUT-REVIEW.md      # the review this pipeline was corrected against
  MOTIVATION-CORPUS-LEARNINGS.md       # what approved packs on file contain
  MOTIVATION-REASON-PROMPT.md          # the reason generator contract
  MOTIVATION-LAYOUT-SPEC.md            # the printed layout
  CLAUDE.md                            # standing rules for the whole platform
```

---

## 20. WHAT TO ANALYSE (suggested prompts for the reviewing model)

```yaml
A. Find any path by which a fact can reach the document without being in the
   fact pack. Rules 9.1/I-01 assume there is none.
B. Find any place where uncertainty resolves to a DEFAULT rather than silence
   (I-03). The section column, the calibre matcher and the competency date are
   the three that have already failed this way.
C. Find any check whose allowlist can silently empty (R-190 is the precedent:
   retired keys + a hardcoded range).
D. Check the S13 restructure (8/R-154) against MOTIVATION-CORPUS-LEARNINGS.md
   and against the approved section 13 on file. Is `existing_measures` in the
   right position? Should `experience` really fold into the statute?
E. Check the banned-phrase lists (11.2 S3) for false positives that would
   refuse a legitimate document — "expansion" and "penetration" are the two
   most likely.
F. Check the S13 per-sentence scope rule (S5) for a sentence that is legitimate
   and would still be refused.
G. Check 14/R-230 against South African firearms law: is "a licence issued
   under section 16 does not cover the purpose of a section 13 application" a
   safe statement to put in a signed document?
H. Check the 271 coordinate-map guard (R-261) for any path that fills against
   an unverified map.
I. Check 15.5/R-250 (page numbers vs merged pages) for an insertion that is
   registered late or not at all.
J. Look for rules that exist in prose (a prompt instruction) with no code
   enforcing them. Rule 15 was one until 2026-09-09; find the rest.
```
