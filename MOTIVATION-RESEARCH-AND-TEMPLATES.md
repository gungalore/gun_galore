<!-- Generated 2026-08-18 by a multi-agent design pass over the operator's three
     asks: extensive research, existing-licence grounding, and a template library.
     Verified against the real code and against the real SAPS/ballistics sources.
     NO applicant PII appears here. Treat as the implementation contract for the
     next phase of the motivation writer. -->

# IMPLEMENTATION BRIEF — Motivation Writer: research, existing licences, template library

**For:** the developer building this immediately.
**Scope:** the operator's three asks, resolved against the existing code and the adversarial review.
**Read first:** `C:/dev/gun-galore/LICENCE-SERVICES-AND-FEED.md`, `C:/dev/gun-galore/MOTIVATION-DOCUMENT-STRUCTURE.md`.

---

## 0. Decisions taken, and the prerequisites that block everything

### 0.1 The contested calls, resolved

| Question | Decision | Why |
|---|---|---|
| Does the backend call the web at generation time? | **No. Never. Not for any fact that lands in the document.** | Four independent reasons, each sufficient: (a) `GENERATE_TIMEOUT_MS = 85_000` (`motivation-claude.service.ts:36`) is already sized under nginx 90s / Cloudflare ~100s, and `generate()` can make two writer calls plus a grade (`motivations.service.ts:496`, `:510`, `:517`); (b) the gate grades the document against the same `FactPack` the writer got (`motivation-prompts.ts:249-263`), so anything we inject is **grounded by construction** and `GROUNDEDNESS_FLOOR = 70` (`motivation-claude.service.ts:79`) stops firing; (c) the module was deliberately built reproducible (`motivations.service.ts:173-176`, `motivation-structure.ts:31-40`) and live fetch destroys that; (d) retrieved page text is a new untrusted-input channel pointed at a signed statutory declaration. |
| Automated quarterly SAPS ingest cron? | **No.** Hand-verified seed file, built by an offline script. | At ~100 beta documents an ingest pipeline plus a staleness cron is more machinery that can break quietly than it removes. SAPS's own six-week release rule is aspirational (Q1 2025/26 slipped from August to October and then indefinitely), so a cron alerting on "overdue" alerts on SAPS politics, not on our ingest breaking — and gets trained out. A seed file that was never updated is visible in `git log`. Revisit only above a few hundred documents/month. |
| Do we ship legal calibre minima / species tables? | **Not in Phase 1.** | Provincial minima are nine instruments plus subordinate regulations, several pre-1994, with a live interpretive question (whether "a barrel of a calibre of six comma five millimetres" in the Cape ordinance reads on land or groove diameter — which decides whether a 6.5 Creedmoor is caught). A wrong hard veto is worse than no veto: it silently deletes a lawful argument from a document the applicant signs. Attorney first. |
| Does THE CALIBRE argue quarry suitability? | **No, not in Phase 1.** | The suitability claim is the applicant's, in their own words, via `firearm_fit_reason` (`motivation-fields.ts:112-120`) and the new `calibre_justification`. We supply only cited chamber specs, published velocity bands and figures computed from them. This removes the entire "we argued an unlawful combination" exposure without needing the attorney to unblock the section. |

### 0.2 Prerequisites — these block the three features and are cheap

1. **`retentionPurgeAt` is written and nothing reads it.** `motivations.service.ts:553-556` sets it; a repo-wide grep of `backend/src` finds only that write and `motivations.service.spec.ts:496`. Every motivation is currently retained forever, and stored research + licence extractions would inherit that. Write the purge cron in `src/tasks/tasks.service.ts` (daily, alongside the `@Cron('0 3 * * *')` and `@Cron('0 4 * * *')` neighbours) — delete files first, then the row, mirroring `erase()` at `motivations.service.ts:348-378`.
2. **A generation failure burns a free beta seat.** The catch at `motivations.service.ts:611-621` releases the CAS but never the seat; the seat is claimed at `:467-482`, before any Claude call. Release it, or record the seat as re-usable.
3. **`costUsd` (`schema.prisma:4098`) is never written.** Grep of `src/motivations/` for `costUsd` returns zero hits; `:532-533` writes token counts only. Compute and store it — everything below adds calls, and spend has to be measurable rather than estimated.
4. **`max_tokens: 4000` (`motivation-claude.service.ts:182`)** is roughly 6–8 pages, against a 15–30 page compiled submission (`MOTIVATION-DOCUMENT-STRUCTURE.md:106-113`) and three new sections. **Uncertainty, stated plainly:** raising it also raises wall-clock against the 85s budget, and I have not measured Opus 5 output rate on this box. Recommended path: raise to **8000** as step 0, log wall-clock per generation during beta, and treat "async generation with polling" as its own project. Do not raise to 16000 on a synchronous route without measurement.

---

## 1. RESEARCH PIPELINE

### 1.1 Shape, in one line

Curated, versioned, hand-verified reference data in our own database → facts selected and **sentences rendered in TypeScript** → the applicant confirms each rendered sentence verbatim → the model may use the sentence **verbatim or omit it**, nothing else → a deterministic code check verifies that → a Sonnet gate scores attribution independently → footnote marker in the body, sources annexure at the end.

**No web call at generation time. No web call at render time. The only network call in the whole feature is Anthropic vision at upload time (§2), which is not in the generate path.**

### 1.2 Sources — named, and their status

**Self-defence (s13):**

- **PRIMARY, and the only thing we cite:** SAPS quarterly *Police Recorded Crime Statistics*, station-level. Landing page `https://www.saps.gov.za/services/crimestats.php`. The **published PDF is TOP-30 stations per crime type only** — useless for ~1,130 of 1,163 stations. The companion `.xlsx` (e.g. `.../downloads/2025/2025-2026_-_4th_Quarter_WEB.xlsx`, ~10.8 MB) contains a **hidden sheet named `RAW Data`** carrying all stations, 44 crime categories, per-month counts, five years of same-quarter totals, and SAPS's own `Count direction` label (Increased / Decreased / Stabilized). That sheet is the source.
- **ALIASES ONLY, never cited:** `github.com/afrith/crime-stats` (Open Data Commons PDDL, public domain) for the station-rename table — Grahamstown→Makhanda, Cradock→Nxuba, Fort Beaufort→KwaMaqoma, JHB Central→Johannesburg Central, and the Middelburg EC/MP pair.
- **Excluded entirely:** news articles, Stats SA VOCS, ISS Crime Hub, SafeSuburb, StreetSignal, policedata.online. Reasons in §5.

**Hunting / sport calibre:** entirely in-repo, no external source at all —
`backend/src/load-lab/internal-ballistics/grt-data/grt_reloading_data.json` (projectiles + G1 BC), `backend/prisma/seed-data/manual-loads.jsonl` → `ManualLoad` (`schema.prisma:3306-3345`, published velocities with `manualLabel` + `pageNumber`), `backend/prisma/seed-data/cartridge-specs.json` → `CartridgeSpec` (`schema.prisma:2438-2453`, with `officialPdfUrl` pointing at the CIP TDCC / SAAMI datasheet), and `BallisticsService.calculate()` (`src/ballistics/ballistics.service.ts:183`, energy at `:385`).

**Uncertainty flagged:** the external findings above (hidden sheet name and range, release cadence, rename list, the SAPS TLS chain being incomplete, Stats SA sitting behind an Incapsula bot wall) came from the research agents. I did not re-fetch them in this session. Treat the *first* run of the build script as verification: if the sheet name or column layout does not match, stop, do not "fix" the parser to fit.

### 1.3 Ingest — an offline script, guarded, producing a committed seed

`backend/scripts/build-crime-reference.ts`, modelled on `scripts/build-cartridge-specs.ts` including its refuse-to-run guard (`build-cartridge-specs.ts:137-153` — `I_HAVE_RE_VERIFIED_THE_OVERRIDES !== 'yes'` prints a refusal and exits 1). Use the same shape with a new env var.

Steps:
1. Operator downloads the `.xlsx` by hand (the URL scheme is not stable — 2023 files sit at `downloads/…`, 2025 files at `downloads/2025/…`, filenames contain typos like `3nd_Quarter`, and `www.saps.gov.za` serves an **incomplete TLS chain**: `openssl s_client` returns one certificate and "unable to verify the first certificate"). Never set `rejectUnauthorized:false` anywhere in this feature.
2. Script unzips, resolves the sheet **by name via `workbook.xml` / `.rels`, never by index**, resolves `t="s"` cells against `sharedStrings.xml`.
3. Asserts the row-3 header matches an expected column map. **Any mismatch aborts the whole run** — no partial output.
4. Filters `Comp level == "Station"` (the sheet mixes in RSA/provincial aggregate rows).
5. Normalises station names through the alias table; resolves each row to a `(station, province)` pair — **station names are not unique** (Balfour exists in Mpumalanga, Gauteng and Eastern Cape).
6. Emits `backend/prisma/seed-data/crime-reference.json` with a SHA-256 of the source workbook, the release key, the period, and the source URL.
7. **A human spot-checks ~20 rows against the rendered workbook** and records who and when in the file. Then it is committed and loaded by `scripts/seed-crime-reference.ts`.

No `xlsx` dependency is currently in `package.json` — you will need one (or unzip + parse the sheet XML directly, which is ~120 lines and avoids the dependency). Either is fine; the parse is offline and never runs in production.

### 1.4 Data model

Nothing here is PII — it stays in plain queryable columns, same reasoning as `motivation-fields.ts:16-19`.

```prisma
model CrimeRelease {
  releaseKey   String   @id            // "2025-2026-Q4"
  periodStart  DateTime                // 2026-01-01
  periodEnd    DateTime                // 2026-03-31
  periodLabel  String                  // "January 2026 to March 2026"
  publishedAt  DateTime
  sourceUrl    String
  sourceSha256 String                  // the exact bytes we parsed
  verifiedBy   String                  // who spot-checked it
  verifiedAt   DateTime
  ingestedAt   DateTime @default(now())
}

model CrimePrecinct {
  id       String @id @default(cuid())
  slug     String @unique              // "bellville-wc"
  station  String
  district String
  province Province                    // the existing enum — labels at common/province-labels.ts:13-23
  @@unique([station, province])         // Balfour exists three times
  @@index([province])
}

model CrimePrecinctAlias {
  alias      String @id                // "grahamstown"
  precinctId String
}

model CrimeStat {
  precinctId String
  releaseKey String
  category   String
  count      Int
  prevCount  Int?                      // same quarter, prior year — REQUIRED for the symmetry rule
  direction  String                    // SAPS's own label: Increased | Decreased | Stabilized
  @@unique([precinctId, releaseKey, category])
  @@index([precinctId, releaseKey])
}
```

### 1.5 Precinct binding — ask, never geocode

Add **`nearest_police_station`** (required) and **`province`** (required) to the registry (§4). Render as an autocomplete over the canonical station list, resolving to a stored `precinctId`.

Rules, in code:
- Exact match on `(normalised station name OR alias, province)`. **No fuzzy match, no nearest-neighbour, no suburb→precinct inference.** This is the direct lesson of `scripts/build-cartridge-specs.ts:137-153`, where a fuzzy matcher attached the wrong chamber dimensions and the wrong maximum pressure to twelve cartridges and only a 43-agent audit caught it.
- If nothing resolves confidently → **zero facts**. Never widen to district, province or national.
- The applicant physically lodges the SAPS 271 at the DFO for the area where they ordinarily reside. **The first human to read this document works at the station whose figures we are quoting.** That is the worst possible place to be approximately right.

### 1.6 Fact assembly — in TypeScript, and the symmetry rule

New pure module `backend/src/motivations/motivation-research.ts` — no Prisma, no Nest, no Anthropic, same posture as `motivation-structure.ts:26-28`. A thin `MotivationResearchService` does the Prisma reads and calls into it.

```ts
export interface ResearchFact {
  marker: string;          // "[[1]]"
  category: string;
  precinctId: string;
  station: string;
  province: string;
  count: number;
  prevCount: number;
  direction: 'increased' | 'decreased' | 'unchanged';
  percent: number;         // computed in TS, never by Claude
  periodLabel: string;     // "January 2026 to March 2026"
  releaseKey: string;
  sourceUrl: string;
  sentence: string;        // rendered HERE — this is the only string the model may emit
  sentenceHash: string;    // sha256, persisted with the applicant's confirmation
}
```

**Rule 1 — category selection is driven by the applicant's own answers, not a fixed list.** `threat_circumstances` / `daily_movements` mentioning home → residential robbery + burglary; commuting or night travel → carjacking + theft from vehicle; business or cash handling → non-residential robbery. **Cap at 3 facts.**

**Rule 2 — the symmetry rule. This is the control that beats cherry-picking, and it is nearly free.** A count and its direction render in the **same sentence** or neither renders. The template cannot separate them. Q4 2025/26 showed house robbery down 20.4% nationally — house robbery is *the* s13 statistic and it is the sharpest fall on the board. A model told to "research crime for a self-defence motivation" is under implicit pressure to find the rising series instead: pick the province over the station, five years over one, the one category that rose. Every figure true, the composite misleading. Symmetry makes that mechanically impossible, and "still high, though falling" is a stronger sentence than a concealed decline the DFO can look up in thirty seconds.

**Rule 3 — the period is inside the claim, never only in the footnote.** Every sentence says "in the quarter January 2026 to March 2026". The words `currently`, `recently`, `at present`, `today`, `this year` are banned from templates and asserted absent by a unit test.

**Rule 4 — suppression floor.** Below **10** for the quarter for that category, emit nothing. A rural precinct reporting 2 residential robberies produces a number that *actively damages* the motivation.

**Rule 5 — one `releaseKey` per document.** Never mix releases.

**Rule 6 — subordination.** A research fact may never be the load-bearing claim of a paragraph, and never the opening or closing section. It attaches to something the applicant actually described, or it is dropped. This keeps the feature from quietly reversing `motivation-fields.ts:157` ("General crime statistics carry no weight on their own") and `motivation-prompts.ts:52` ("Specific, personal circumstances beat general crime statistics every time") — which is also §1.11's reason the whole feature can fail safely.

**Rule 7 — vary the OPENING words of the templates.** `structuralTokens()` strips non-initial proper nouns (`motivation-structure.ts:286`) and every digit (`:288`), then keeps **only the first three words of each sentence** (`:293`). Varying the tail of a fact sentence is invisible to the detector. Five or six templates per fact type, chosen by the existing `variantSeed` (`schema.prisma:4077`) via `mulberry32`/`pick` (`motivation-structure.ts:32-44`), each opening differently:

```
"Robbery at residential premises at the Bellville police station…"  → S:robbery at residential
"The Bellville police station recorded 148 …"                        → S:the police station
"In the quarter January 2026 to March 2026, 148 …"                   → S:in the quarter
"SAPS recorded 148 robberies … in the Bellville precinct"            → S:saps recorded robberies
```

### 1.7 The applicant confirms the exact sentence — the control that matters most

Before generation, show the rendered sentences **verbatim**, plus the matched station and why we matched it. Three choices per sentence: **Correct / Wrong station / Leave it out.** Default to "Leave it out" wherever confidence is not high.

Persist `sentenceHash + precinctId + releaseKey + timestamp` on the motivation.

This one screen does more than every regex in the pipeline. It fixes the **selection** error no deterministic check can catch (we matched the wrong precinct, or picked a category that misrepresents their situation), using the only party who knows their own station. And it converts our representation into their confirmed statement — which is the honest position, and the correct one: FCA s120(9)(f) turns on supplying particulars "knowing them to be false, incorrect or misleading **or not believing them to be correct**". An applicant who never saw the figure is inside the second limb; an applicant who read the exact sentence and ticked it is not.

New status `EVIDENCE_REVIEW` in `MotivationStatus` (`schema.prisma:4008-4017`), between `NEEDS_MORE_INFO` and `GENERATING`. Add it to `EDITABLE` (`motivations.service.ts:70-74`) so the CAS at `:454-462` still admits it.

### 1.8 Getting facts into the prompt — a THIRD FactPack slot

**Do not route research through `derived`.** `renderFacts()` pushes every derived value through `sanitizePromptValue(v, 200)` (`motivation-prompts.ts:117-119`), which collapses newlines and truncates at 200 characters — a citation-bearing sentence gets cut mid-number.

```ts
// motivation-prompts.ts:83-89
export interface FactPack {
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;
  derived: Record<string, string>;
  sourced?: ResearchFact[];   // NEW — its own renderer, its own block
}
```

New `renderSourced()` emitting a block **adjacent to but distinct from** `<applicant-facts>` (these are our verified data, not applicant input, so they must not sit inside the untrusted-input delimiter at `motivation-prompts.ts:124-130`):

```
VERIFIED RESEARCH — published statistics we retrieved, checked, and the
applicant has confirmed. Each sentence below may be used VERBATIM or omitted
entirely. You may not alter a number, a period, a station name or a source.
You may not add any statistic that does not appear here. Keep each marker
exactly as written. At most one of these may appear per paragraph, and never
as the paragraph's main claim.
<research-facts>
<fact marker="[[1]]">Robbery at residential premises at the Bellville police
station was recorded 148 times in the quarter January 2026 to March 2026,
against 131 in the same quarter a year earlier — an increase of 13.0%.</fact>
</research-facts>
```

Rendered into **both** `generationUserPrompt` (`:190-206`) and `gateUserPrompt` (`:250-263`).

**Also reconcile `WHAT_MATTERS.S13_SELF_DEFENCE` (`motivation-prompts.ts:51-53`).** As written it tells the writer statistics lose "every time", so the writer will drop the facts — and if a section was planned for them, `followsPlan()` fails and burns a full Opus regeneration at `motivations.service.ts:504-515`. Amend to: precinct-level statistics **corroborate** the applicant's own account and never substitute for it.

**And amend ABSOLUTE RULE 1** (`motivation-prompts.ts:151-155`), which currently bans inventing a "statistic" outright. It must now read: never invent a statistic; a statistic may appear **only** as one of the verbatim sentences in `<research-facts>`. This is a deliberate amendment to the module's core invariant — make it a conscious, commented change, not a silent one.

### 1.9 Anti-hallucination — three layers, and this is the part that must be airtight

**Layer A — the model never composes a number.** Verbatim-or-omit strings, rendered in TypeScript. Same reasoning as `deriveFacts()` (`motivations.service.ts:676-711`), whose own comment at `:677-678` says keeping it in code "stops the model doing arithmetic on someone's licence application".

**Layer B — `verifyResearch(text, facts)` in `motivation-research.ts`, pure and I/O-free.** Runs after generation, before grading. Four checks:

1. Every `[[n]]` marker in the document maps to an approved, applicant-confirmed fact.
2. The sentence carrying each marker is **character-identical** to `facts[n].sentence`.
3. **The generic digit check — this is the strongest one, and it catches invention and rounding without knowing anything about crime data.** No digit sequence may appear anywhere in the document that is not present in the applicant's answers, in `derived`, or in an approved fact sentence. (Whitelist: section numbers already in `LEGAL_FRAME`, and any digits the applicant themselves typed.)
4. The approved station name appears in the **same sentence** as its marker. (Do *not* use "no other `CrimePrecinct` station name appears anywhere" — three rows match "Balfour", and the applicant's own town may legitimately appear.)

**Layer C — a fifth gate score, `attribution`.** Add to `gateSystemPrompt()` (`motivation-prompts.ts:218-246`):

> `attribution` Does every sentence containing a number either (a) rest only on facts the applicant supplied, or (b) match a `<research-facts>` sentence exactly, name its period, and introduce no number absent from that list? Any number that fails this must drag this score below 50.

Then in `motivation-claude.service.ts`: add `ATTRIBUTION_FLOOR = 70` beside `GROUNDEDNESS_FLOOR` (`:79`), coerce with the existing `toScore` (`:306-309`), change the `overall` divisor from 4 to 5 (`:315-317`), extend the JSON contract at `motivation-prompts.ts:243-245`, and extend the pass expression at `:331` — keeping it phrased **"below the floor fails"**, never "above the floor passes", per the comment at `:329-330`.

The gate runs Sonnet 5 at temperature 0, deliberately a different model from the Opus writer (`motivation-claude.service.ts:52-57`), so this is a genuinely independent check.

**What happens on a violation: FAIL TO OMIT, not to error.** Strip the marker-bearing sentence, continue, log, raise an `AdminAlert`, and **count it**. The document stays valid because the statistic was never load-bearing (Rule 6). Hard-fail the motivation only if violations breach a threshold, or if structure/sameness also fail. This preserves the soft-fail seat economics the module was built around (`motivation-claude.service.ts:203-211`, `:23-30`) — hard-failing a whole motivation into an admin queue over one decorative sentence is disproportionate.

### 1.10 Citation format in the document

- **Body:** stable token `[[1]]` immediately after the sentence. The renderer converts it to a superscript.
- **End of document:** a `SOURCES AND REFERENCES` block, emitted **structurally by the PDF renderer**, not smuggled through body text — `isHeading()` (`motivation-pdf.service.ts:85-89`) only recognises a short line ending in a colon, and the sources block must not depend on that.

```
¹ South African Police Service, Police Recorded Crime Statistics, Republic of
  South Africa — Fourth Quarter of the 2025-2026 Financial Year (January 2026
  to March 2026), Crime Registrar Head Office.
  https://www.saps.gov.za/services/crimestats.php
```

- **Persist the fact list.** The PDF is re-rendered from encrypted text on every download (`motivations.service.ts:626-673`; nothing is stored, `motivation-pdf.service.ts:40-43`) and byte-determinism is a tested property (`motivation-pdf.service.spec.ts:141-148`). Add **`researchFactsEncrypted String? @db.Text`** and **`researchReleaseKey String? @db.VarChar(24)`** to `Motivation`, written in the same `update` as `documentTextEncrypted` (`motivations.service.ts:542-557`). Encrypted, because precinct + circumstances is identifying.
- **Never** a table, a chart, a news article or a SAPS table image as an annexure. Facts are not copyrightable; a publisher's article is, and SA has closed-category fair *dealing* (Copyright Act 98 of 1978 s12(1)), not fair use. Do not plan around the Copyright Amendment Bill — s12D(1)-(5) was struck down on 26 June 2026 ([2026] ZACC 26) and it cannot be enacted as it stands.

### 1.11 The "no data for this area" path

Resolve facts **before** `planFor()` is called at `motivations.service.ts:495`, and pass `includeResearch: facts.length > 0`. If a research section were planned with nothing to say, the model would either invent content or drop the heading and fail `followsPlan()` at `:501`, burning a full Opus regeneration at `:504-515` that cannot fix the cause.

When there is nothing:
1. **No research section is planned at all.** Unit-test that `planFor` omits it on an empty fact set and that `followsPlan` passes on the resulting document.
2. **Never widen geography silently.** Substituting district, provincial or national figures is precisely the "national crime statistics alone" weakness the Registrar discounts (`MOTIVATION-DOCUMENT-STRUCTURE.md:86-88`).
3. **Route the gap to more interview, not more statistics.** The strong rural argument is distance to the station, response times, absence of armed-response coverage, isolated smallholding — all applicant facts. Reuse `queueFollowUps` (`motivations.service.ts:736-777`) → `askFollowUp` (`motivation-claude.service.ts:369-405`) targeting `threat_circumstances`, `daily_movements`, `alternatives_considered`.
4. **The document must be complete and strong with no research section.** That is the acceptance test for the whole feature.

### 1.12 The hunting/sport calibre research step

Same posture, different data — all in-repo, no external source.

New service `backend/src/motivations/motivation-calibre.service.ts` producing typed `EvidenceItem[]` into the same `sourced` slot. **Claude never computes a number; it only phrases items we hand it.**

- **Cartridge resolution is exact-match or refuse.** `cartridgeKey()` (`src/load-lab/recommended-loads.service.ts:33-39`) over `firearm_description`; must hit an existing `CartridgeSpec.cartridgeKey` or a distinct `ManualLoad.cartridgeKey` verbatim. No fuzzy, no alias fallback. On no match, bounce to the existing picker (`GET /load-lab/cartridge-search`) and store the confirmed key in a new registry field `cartridge_key`. Ambiguity yields **no ballistic argument**, never a guessed one.
- **Chamber facts** from `CartridgeSpec` (`schema.prisma:2438-2453`) with `officialPdfUrl` (`:2451`) as the citation — the citation resolves to CIP/SAAMI, not to us.
- **Velocity from `ManualLoad`, as a BAND, not a point.** Published max velocities for one cartridge/weight span ~300 fps across manuals, which is ~26% on energy. Quote the range with two manual+page citations. A band is also more persuasive than a suspiciously precise point figure, and it is what the applicant could defend.
- **Mandatory caveat on every velocity item.** `ManualLoad.barrelLenIn` (`schema.prisma:3328`) is null across the entire seed, so every figure we hold is a published test-barrel number. The document must say so and must never assert what the applicant's own rifle produces.
- **Energy computed by `BallisticsService`** (`src/ballistics/ballistics.service.ts:385`), never quoted from anywhere.
- **A physics invariant as a hard, model-free gate.** `E(ft-lbf) = m(gr)·v(fps)² / 450437`. Reject — never silently correct — any (weight, velocity, energy) triple failing by more than 2%. One line, deterministic, unit-testable. It catches transcription errors *and* many wrong-cartridge cases, because a mismatched row usually carries a bullet weight inconsistent with the quoted velocity.
- **MPBR: compute or omit.** ~40 lines on top of `findLaunchAngle()` (`ballistics.service.ts:249-278`) — an outer search over zero range keeping the trajectory inside ±(vitalZone/2). It needs a vital-zone diameter, which we hold nowhere, so **the applicant supplies it** and the sentence states the assumption ("assuming a 100 mm vital zone"). Never repeat a reviewer's or manufacturer's MPBR figure — it silently embeds assumptions the applicant cannot defend.
- **BC:** there is no BC column in `schema.prisma` or the seed data. The GRT projectile JSON has 5,524 rows with a non-zero G1 BC but is currently dead at runtime (only accessor: `powder-coefficients.ts:133-137`, described in its header as offline-benchmark-only). Two rows for the same bullet can disagree (~3%), and the `caliber` field is inconsistently normalised. **Rule: take the lower BC; if the spread exceeds 5%, drop the trajectory items entirely.** Do not build a curated BC table for beta.
- **Cap: 2–3 computed figures**, each bound to something the applicant stated (this quarry, this distance, this discipline's target distances). A recited ballistic table is padding, and padding is itself the sameness signal (`MOTIVATION-DOCUMENT-STRUCTURE.md:123-129`).
- **Degrade, do not block.** No verified row → THE CALIBRE is written from `firearm_fit_reason` and `calibre_justification` alone. Add a fixture test asserting that in that case the section matches no `/ft-?lbf|fps|joule|MPBR|bar/` pattern.

---

## 2. EXISTING FIREARMS

### 2.1 Extraction — a new service, not a reuse

**Do not call `FirearmLicenceService`.** It is a listing gate, not an extractor. It reads none of the five fields the comparison needs (its findings carry only `extracted_serial`, `holder_name`, `expiry_date`, `is_firearm_licence` and match scores — `src/listings/firearm-licence.service.ts:39-56`), it hands Claude a **public Cloudinary URL** (`:408-413`), and three of its hard BLOCKs are actively wrong here: it blocks when a licence expires within 30 days (`:284-291`) and when `holder_matches_seller < 80` (`:252-258`). For a motivation, an expiring licence is a legitimate central fact and a maiden-name card is a normal case.

New `backend/src/motivations/motivation-licence-extraction.service.ts`. Reuse its *posture*, not its code:

| | listing verifier | motivation extractor |
|---|---|---|
| transport | Cloudinary URL (`firearm-licence.service.ts:408-413`) | **base64 image / `type:'document'` PDF**, the pattern at `src/kyc/claude-kyc.service.ts:307-316`, `:334-336`, `:356-359` |
| cardinality | one licence | **array** — one photo can hold several cards |
| expiry | BLOCK < 30 days | **never blocks** |
| name mismatch | BLOCK | **flags for confirmation** |
| fail direction | fail CLOSED | **fail SOFT into "type it yourself"** |
| temperature | default | **0**, same reasoning as `claude-kyc.service.ts:369-377` — a card that reads 6.5 Creedmoor on one run and .260 Rem on the next is a false-declaration generator |

Keep the good habits: `toScore()` fail-closed coercion (`firearm-licence.service.ts:175-179`), shape guard before touching nested fields (`:155-171`), server-side cross-checks over model self-report (`:196-215`), damped `raiseOutageAlert` (one per 6h — `motivation-claude.service.ts:108-112`, `:130-150`).

**Extraction target, per firearm found:**

```ts
interface ExtractedFirearm {
  actSection: string|null;    // '13'|'14'|'15'|'16'|'16A'|'17'|'20' — THE load-bearing field
  firearmType: string|null;   // pistol|revolver|rifle|self-loading rifle|shotgun|combination
  make: string|null; model: string|null;
  calibre: string|null;
  serialNumber: string|null;
  licenceNumber: string|null;
  holderName: string|null; holderIdNumber: string|null;
  issuedDate: string|null; expiryDate: string|null;   // ISO
  legible: number; isFirearmLicence: number;          // 0-100, per firearm
}
```

Plus a document discriminator: `WHITE_CARD | GREEN_LICENCE | PAPER_CERTIFICATE | SAPS523_RECEIPT | COMPETENCY_CERT | NOT_A_LICENCE` — people will upload a competency certificate believing it is a licence, and the extractor must name that back to them rather than yielding zero firearms.

**What the card does NOT print, and must never be inferred: action type (bolt/semi/lever), barrel length, twist, optics, magazine capacity.** A .308 bolt gun and a .308 semi-auto are indistinguishable on an SA licence card. This drives §2.4 case 7.

**Extraction runs at UPLOAD time, never at generation.** `generate()` already runs a writer call, a possible second writer call and a grade inside 85s (`motivations.service.ts:496-519`, `motivation-claude.service.ts:33-37`). N vision calls inside that would blow it. Upload-time extraction also gives the applicant the confirm card immediately.

**The upload endpoint does not exist.** `MotivationUpload` is modelled (`schema.prisma:4171-4202`) but nothing writes it, and `motivations.controller.ts` has no `@Post(':id/uploads')`. Build:
- `@Post(':id/uploads')` — `FileInterceptor` + `memoryStorage()`, explicit `limits.fileSize` of 10 MB. Accept **JPEG/PNG/PDF only**; HEIC was reverted platform-wide after 413s, so hint "Settings → Camera → Formats → Most Compatible" on rejection.
- `@Post(':id/uploads/:uploadId/extract')`.
- Bytes via `SecureFileStorageService.write('motivations', buf, new Date())` (`src/common/secure-file-storage.service.ts:83-108`), which returns `{storageKey, sha256, byteSize}`. The existing `sha256` index (`schema.prisma:4183-4185`, `:4201`) dedupes a re-upload for free — do not re-extract on a hash hit.
- Wire the new service into `motivations.module.ts:32-39` providers. **No `JwtModule` needed until an admin controller lands** — see the warning at `motivations.module.ts:16-21`.
- Applicant's typed name/ID into the prompt via `sanitizePromptValue` with the untrusted notice, as at `firearm-licence.service.ts:392-400` and `motivation-prompts.ts:124-130`.

### 2.2 Schema additions

```prisma
enum ExistingFirearmSource { EXTRACTED TYPED }
enum ExistingFirearmState  { UNCONFIRMED CONFIRMED CORRECTED REJECTED }

model MotivationExistingFirearm {
  id             String @id @default(cuid())
  motivationId   String
  motivation     Motivation @relation(fields:[motivationId], references:[id], onDelete: Cascade)

  // NULL when typed with no upload. SetNull, NOT Cascade: deleting a blurry
  // photo must not silently delete a fact the applicant confirmed and the
  // document already argues from.
  sourceUploadId String?
  sourceUpload   MotivationUpload? @relation(fields:[sourceUploadId], references:[id], onDelete: SetNull)
  source         ExistingFirearmSource
  state          ExistingFirearmState @default(UNCONFIRMED)

  // Everything the applicant would recognise as THEIR data: ONE encrypted blob.
  // Serial + licence number + holder identify a person and a firearm; columns
  // would put SAPS licence numbers in the clear in every backup and admin view.
  // Same posture as Motivation.answersEncrypted (schema.prisma:4050-4055).
  detailEncrypted String @db.Text
  // {actSection,type,make,model,calibre,serial,licenceNumber,issuedDate,expiryDate,holderName}

  // DERIVED classification only. Names nobody, so it stays queryable — this is
  // what the comparison logic branches on.
  actSection String?  @db.VarChar(8)
  calibreKey String?  @db.VarChar(48)   // cartridgeKey() normalised
  platform   String?  @db.VarChar(24)   // HANDGUN | RIFLE | RIMFIRE | SHOTGUN | UNKNOWN
  expiryQuarter String? @db.VarChar(8)  // "2029-Q3" — coarse, for renewal nudges.
                                        // The exact date stays inside detailEncrypted.

  confirmedAt DateTime?
  createdAt   DateTime @default(now())
  @@index([motivationId])
}
```

Plus on `Motivation`: `existingFirearmsConfirmedAt DateTime?`.

**Note on `expiryQuarter`:** an exact `expiresAt` in the clear on a row joined to `userId` says "this user holds a licence expiring on date X" without decryption. A quarter bucket is enough for a Phase 2 renewal nudge and is the more consistent choice given `schema.prisma:4050-4054`. The s27 arithmetic check runs at extraction time when the plaintext is in hand anyway, so nothing is lost.

### 2.3 The confirm-before-use contract

**The failure that ends the product:** extraction reads ".308 Win" as ".30-06", the document argues "my existing .30-06 is unsuited to X", the applicant signs, and they have made a false statement about their own holdings to a Registrar who can check the central firearms register in seconds.

1. **Nothing extracted is a fact until confirmed.** Rows land `UNCONFIRMED` and are excluded from the FactPack by a **`where` clause in code** at pack-build time (`motivations.service.ts:484-488`), never by a prompt instruction. This is the whole safety property.
2. **Generation refuses to run** with unconfirmed rows — same shape as the completeness check at `motivations.service.ts:441-449`: `ConflictException` with `code: 'motivation-firearms-unconfirmed'` and the row ids.
3. **Field-level confirmation with the source image on screen.** Each field pre-filled and editable, the photo alongside. This makes it "does this match the card in your hand", not "do you agree with our OCR". `MotivationUpload.extractedFields` (`schema.prisma:4191-4193`) already exists to drive the "we found 6 fields, confirm them" card without decrypting anything.
4. **Serials and licence numbers must be RE-KEYED, not ticked.** People confirm what they are shown. Cross-check the re-keyed value against the extraction; a mismatch shows both and asks which is right.
5. **Code-side cross-checks run BEFORE we ask** — the `firearm-licence.service.ts:196-215` posture:
   - **holder ID number** vs `id_number` (`motivation-fields.ts:67-75`). Different digits = somebody else's licence. Refuse the row pending an explicit override; raise an `adminAlert`.
   - **holder name** vs `full_name` (`:58-66`). Mismatch → "is this licence in a previous name?" Never an auto-block.
   - **s27 arithmetic.** `expiryDate − issuedDate` against the validity period for the read section (s13 = 5 years, s14 = 2, s15 = 10, s16 = 10). "s13, issued 2019, expires 2029" is internally impossible — the section or a date was misread, so force a re-read. Same class of code-side derivation `deriveFacts()` already does for age (`motivations.service.ts:680-711`). Keep the period table as a curated constant reviewed with the templates; a mismatch WARNs, it never silently corrects.
   - duplicate serial across rows → merge prompt.
6. **Strengthen the declaration.** `DISCLAIMER_TEXT` (`motivations.service.ts:60-64`) currently says only "the facts stated are true". Add a separately recorded acknowledgement — *"I confirm that the firearms listed are the firearms licensed to me and that the details match my licences"* — stored as `existingFirearmsConfirmedAt` alongside `acceptDeclaration` (`:384-400`). **Bump `DISCLAIMER_VERSION`** (`:58`) and send the wording to the attorney with the rest of the templates (`LICENCE-SERVICES-AND-FEED.md:113-114`).
7. **Editing a row after generation** returns it to `UNCONFIRMED` and marks the document stale.

**Mandatory? The DECLARATION is; the UPLOAD is not.** `firearms_owned_status` is required (`NONE | UPLOADED | TYPED_NO_UPLOAD`) — being required means `missingRequired` (`motivation-fields.ts:408-413`) enforces it at generate for free. Typed rows are first-class: still confirmed, still used, but section-based distinctions downgrade from strong to moderate (an applicant's recollection of which section their licence was issued under is genuinely unreliable, and that is the one claim we would most have wanted to see the card for), and the document cannot cross-reference an annexure for them. Say that to the applicant in **structure language, never odds language**: *"Without the licences attached there is nothing for the comparison to point at. Reviewers weigh assertion plus proof differently from assertion."*

Not hard-mandatory because: we are not SAPS and cards are legitimately with a dealer or lost pending reissue; POPIA data minimisation cuts against compelling collection; forcing it just produces blurry photos of something; and a 100-seat beta is the wrong place to turn people away.

### 2.4 COMPARISON — rules in code, not a prompt instruction

New pure module `backend/src/motivations/motivation-comparison.ts` — no Prisma, no Nest, no Anthropic, heavily unit-tested. **Code emits claims; Claude phrases them** — the identical split as `motivation-structure.ts:12-18` and the follow-up interview (`motivations.service.ts:731-735`).

A free-text `other_licensed_firearms` (`motivation-fields.ts:131-138`) **cannot** carry this, because the logic has to branch on section, calibre, platform and count. Branching on prose means asking a model to parse it, which puts the model back in charge of fact-determination — the exact thing the registry exists to prevent (`motivation-fields.ts:11-14`). Keep the free-text field as colour; build the comparison from rows.

```ts
export type DistinctionKind =
  | 'FIRST_FIREARM' | 'DIFFERENT_ACT_SECTION' | 'DIFFERENT_PLATFORM'
  | 'DIFFERENT_CALIBRE_CLASS' | 'DIFFERENT_QUARRY_CLASS' | 'DIFFERENT_RANGE_BAND'
  | 'DISCIPLINE_CONFIGURATION' | 'SAME_CALIBRE_DIFFERENT_ROLE' | 'NO_DISTINCTION_FOUND';

export interface Distinction {
  kind: DistinctionKind;
  strength: 'strong' | 'moderate' | 'weak';
  basis: string[];                 // literal facts, each traceable to a CONFIRMED row or a registry answer
  againstIds: string[];
  needsApplicantInput?: { fieldKey: string };
}
export function buildComparison(applied, rows, answers): Distinction[];
export function comparisonBrief(ds: Distinction[]): string;
```

Ordered decision logic:

1. **No rows + `firearms_owned_status = NONE`** → `FIRST_FIREARM`. The plan **swaps the comparison section out** for a `first_firearm` section. A "Comparison" heading over "I own no firearms" is padding.
2. **Section test.** `appliedSection` vs each `row.actSection`. Different → `DIFFERENT_ACT_SECTION`, **strong**. The strongest available move: the state itself recorded that the existing firearm was licensed for a different statutory purpose. Downgrade to **moderate** when `source: TYPED`.
3. **Platform test.** HANDGUN / RIFLE / RIMFIRE / SHOTGUN from the card's *type* field. Different → **strong**.
4. **Calibre-class test.** Both sides through `cartridgeKey()` (`src/load-lab/recommended-loads.service.ts:33-39`), then a **curated band table we own**: `RIMFIRE`, `PISTOL`, `VARMINT`, `MEDIUM_PLAINS`, `LARGE_PLAINS`, `DANGEROUS_GAME`, `SHOTGUN_GAUGE`. Different band → strong; adjacent → moderate. **Do NOT derive the band from `CartridgeSpec.caseCapacityGrH2O` / `maxPressureBar`** (`schema.prisma:2450`, `:2448`): coverage is partial by design and inferring "adequate for kudu" from case capacity is exactly the derived claim the applicant would be signing. Unknown band → no distinction, never a guess.
5. **Quarry / range test.** Needs `intended_quarry` (`motivation-fields.ts:191-198`). No answer held → emit `needsApplicantInput: {fieldKey:'intended_quarry'}` rather than guessing.
6. **Discipline test** (s16 sport only). Emit `DISCIPLINE_CONFIGURATION` **only** where the applicant supplied `discipline_requirement` (`motivation-fields.ts:294-301`), so the claim always rests on their own statement of the rules. We cannot verify a rulebook in code and must not pretend to.
7. **The hard case — same calibre, same platform.** Owns a .308 bolt rifle, applies for another .308. The card does not print action type, so this **cannot be computed**. Emit `SAME_CALIBRE_DIFFERENT_ROLE`, `strength:'weak'`, `needsApplicantInput:{fieldKey:'comparison_reasoning'}`, which triggers a Boet follow-up **before** generation via `queueFollowUps` (`motivations.service.ts:736-777`). If still empty at generate, the writer is told the distinction is **absent**, and the section says so plainly rather than manufacturing one. That is the honest failure and it is the one that keeps us safe.
8. **`NO_DISTINCTION_FOUND`** does not block generation. It goes to the gate as a named weakness and surfaces in the UI as "this is the section a reviewer looks at hardest — tell us in your own words".

**Prompt wiring:**
- Extend `FactPack` with `existingFirearms` and `comparisonBrief`, rendered inside `renderFacts` (`motivation-prompts.ts:99-122`) — **not** through `derived` (200-char truncation at `:118`). Because `renderFacts` feeds both `generationUserPrompt` (`:190-206`) and `gateUserPrompt` (`:250-263`), the grader gets the same brief for free.
- **ABSOLUTE RULE 8** (after `motivation-prompts.ts:150-168`): *"You may state a distinction between the applied-for firearm and an existing one ONLY if it appears in the comparison brief. Do not infer action type, barrel length, optics or magazine capacity — those are not printed on a South African firearm licence and we do not know them."*
- **Gate rule:** any distinction asserted that is not in the brief is ungrounded (`motivation-prompts.ts:229-233`, floor 70 at `motivation-claude.service.ts:79`, enforced at `:331`).

**Anti-sameness for this section — it is where it can go wrong.** A fixed, code-generated comparison block bolted onto every document would be the most template-shaped thing in the bundle, at exactly the section a reviewer reads hardest. So: add `existing_firearms` and `comparison` as real `SectionId`s (`motivation-structure.ts:56-63`) with four heading alternates each in `HEADING_ALTERNATES` (`:88-131`), and put them in `SECTION_SETS.movable` (`:145-174`) so their position varies by seed. Only the **claims** are computed; ordering, headings, strength-ordering and phrasing stay seeded. Render the firearm **schedule as a table** (a licence schedule looks alike in every genuine motivation — it is data, not a style signature) and the **comparison as varied prose**.

Cap rows at **12**; the comparison argues against the **three most similar**, the rest appear in the schedule only. Arguing against fourteen firearms is padding (`MOTIVATION-DOCUMENT-STRUCTURE.md:123-129`).

---

## 3. TEMPLATE LIBRARY

### 3.1 Fix the system signature first — this is a gate, not a step

`motivation-pdf.service.ts:258-264` stamps `<ref> · page N of M · prepared with All Outdoor (tpl-2026-08-a)` in the **centre footer of every page of every document**, and `motivations.service.ts:60-64` puts a byte-identical disclaimer on every document. A reviewer does not need to pattern-match section order — the document announces itself, in the same words, on all thirty pages. **Twelve layouts behind that footer is theatre.**

Operator + attorney decision, before recipe work starts. Recommended landing:
1. **Remove the "prepared with All Outdoor (tpl-…)" clause from the visible footer.** Traceability survives in `Motivation.templateVersion` (`schema.prisma:4068`) and the PDF `/Info` dictionary (`motivation-pdf.service.ts:116-119`) — discoverable in document properties, which is honest, rather than a badge on every page.
2. **Print the MO reference once** (cover or last page), not in a running footer — the same reference in the same slot is itself a format signature.
3. **Ask the attorney to approve three equivalent disclaimer wordings.** If only one is approved, vary *placement* only and record the disclaimer as a known, accepted residual fingerprint rather than pretending otherwise.

### 3.2 One engine, many recipes — never many renderers

New `backend/src/motivations/motivation-layout.ts`: pure and I/O-free like its neighbour, exporting a frozen `LayoutRecipe` type and a curated `RECIPES` array. `MotivationPdfService.render()` becomes `render(input, recipe, plan)` and branches on recipe fields.

This is what makes nine templates affordable: widow control, TOC accuracy, annexure resolution and the two-pass render are written **once** and every recipe inherits them. Nine hand-written renderers would each get one-ninth of the attention and one-ninth of the testing.

Header comment, with the same weight as the anti-outcome comments at `motivation-pdf.service.ts:27-43`:

> Variation exists so each document is genuinely the applicant's own and is read on its merits — **NOT** to conceal that a service helped prepare it. Never inject deliberate imperfection: no typos, no fake handwriting, no randomised Afrikaans, no scrubbed metadata. Keep honest `/Info`. If SAPS ever requires disclosure of a preparer, disclose. Every recipe must be one a competent professional would plausibly have chosen for that document — if you cannot name the kind of office that would produce it, cut it.

### 3.3 The 12 layout axes the PDF service must gain

| # | Axis | Values |
|---|---|---|
| 1 | Front matter | `none` · `letterhead-block` · `cover-page` (name, ID, contact, then firearm block: type/make/calibre/serial/model) |
| 2 | Addressee | absent · `The Commanding Officer, SAPS Central Firearms Register, Pretoria` · `The Designated Firearms Officer, SAPS <station>` |
| 3 | Table of contents | `none` · `plain` · `dotted-leaders + page numbers` |
| 4 | Section numbering | `none` · `1.` · `1.` + `1.1` |
| 5 | Heading case | `ALL CAPS bold` · `Title Case bold` · `Title Case bold italic` · `run-in` |
| 6 | Typeface | `Times` · `Helvetica` · `Helvetica headings + Times body` |
| 7 | Body size / leading | 10.5/4 · 11/5 · 11.5/5 · 12/6 |
| 8 | Margins | 22 · 25 · 28 mm; optional asymmetric (+5 mm binding edge) |
| 9 | Alignment | `justify` · `left-ragged` |
| 10 | Paragraph separation | blank line · first-line indent |
| 11 | Running header / footer | `none` · full (`Page N of M — Motivation for <name> for a <make> <type> Serial <serial> for <purpose>`) · short · name+ID band · rule only; footer: page N of M centred · page number right · none |
| 12 | Annexure reference style + index | `(Refer to Annexure A: <description>)` · `[Annexure A]` · `— see Annexure "A"` · `(attached as Annexure A)`; index: none · numbered list · two-column table |

Plus signature-block placement and disclaimer placement as recipe fields.

**Fonts:** `Helvetica{,-Bold,-Oblique}` and `Times-{Roman,Bold,Italic,BoldItalic}` are available with no assets and no new dependency. **Two families is the ceiling.** A third means shipping a TTF and inheriting the `dist/`-assets resolution problem documented at `motivation-pdf.service.ts:8-25` — works locally, 404s in production. Don't.

**Readability floor (a violation is a bug, not a variation):** body ≥ 10.5 pt, margins ≥ 20 mm, measure ≤ ~90 characters.

### 3.4 Nine recipes at beta

**Family A — compiled submission** (eligible when ≥4 annexures or ≥8 estimated pages): A1 bound submission · A2 sans compiled · A3 serif no-TOC · A4 report (letterhead + `1.`/`1.1`) · A5 formal serif with deed-style signature.

**Family B — direct letter** (eligible ≤12 pages): B1 to the Commanding Officer · B2 letter sans (**only when ≤3 annexures**) · B3 letter indented · B4 DFO-addressed.

**Family C — numbered statement:** after the attorney sitting, not at beta. Neither operator sample attests it.

**Metric jitter, seeded from `variantSeed`:** margin `{−3, 0, +3}` mm × body size `{−0.5, 0, +0.5}` pt → each recipe fans to 9 renderings. **9 × 9 ≈ 81 visually distinct documents from 9 designs.**

Why nine and not forty: with the deck scheme below, T recipes guarantee zero repeats within any window of T consecutive documents in the same province × licence-type bucket. At ~100 beta documents across 5 licence types and 9 provinces, most buckets never see nine. Doubling T doubles the design, test and attorney surface and buys nothing a human could perceive.

### 3.5 The renderer must own heading and annexure presentation

`isHeading()` (`motivation-pdf.service.ts:85-89`) is "short line ending in a colon". That cannot survive axes 4–5. And `followsPlan()` matches heading text **exactly** (`motivation-structure.ts:251-257`), so if the model emits styled headings, plan verification breaks.

**Contract:** the model keeps emitting the plan's canonical heading text on its own line, exactly as today. `MotivationPdfInput` (`motivation-pdf.service.ts:62-83`) gains `plan`; the renderer matches each block against `expectedHeadings(plan)` (`motivation-structure.ts:227-229`) and **re-renders** the heading in the recipe's numbering, case and font. Keep the colon heuristic as a fallback. `followsPlan()` is untouched.

**Annexures the same way.** The model emits `[[ANNEX:identity_document]]`; the renderer expands it per axis 12, assigns letters in first-mention order, and builds the index from what it actually expanded. Three payoffs: annexure style becomes a pure layout axis; letter assignment is always consistent with the index; and **a token that does not resolve to a real `MotivationUpload` row is dropped and logged, not printed** — the document can never cite an annexure that is not in the bundle. That last one is a groundedness safeguard and is the strongest argument for the token design.

**Layout must reach the prompt.** Put `layout` on `StructurePlan` (already persisted whole as `structurePlan Json?`, `schema.prisma:4078` — no new column) and add a `LAYOUT_GUIDE[family]` fragment to `generationUserPrompt` beside the existing `OPENING_GUIDE` / `CLOSING_GUIDE` / `CADENCE_GUIDE` (`motivation-prompts.ts:64-81`, `:196-198`). Without this, a numbered-statement recipe is flowing prose in a numbered skin, which reads worse than no variation.

### 3.6 Selection — deal from a shuffled deck, never roll a die

```
bucketKey = `LAY:${province}:${licenceType}`
n         = atomic increment of ReferenceCounter[bucketKey]
deck      = seededShuffle(RECIPES, hash32(bucketKey))
recipe    = first entry from deck[(n-1) % deck.length] onward that is ELIGIBLE
jitter    = derived from motivation.variantSeed
```

- `ReferenceCounter.prefix` is `String @id` (`schema.prisma:2392`) so arbitrary keys work, and this module **already** uses a non-listing key `MOBETA` by direct prisma upsert (`motivation-quota.service.ts:14`, `:99-103`), bypassing the `ReferencePrefix` union at `src/common/reference-number.service.ts:23-34`. Follow that precedent exactly. **No new table, no advisory lock** — the increment *is* the claim, the same reasoning that makes `claimBetaSeat` race-proof (`motivation-quota.service.ts:84-97`).
- Per-bucket shuffle means Gauteng and Limpopo do not march through the deck in lockstep.
- Eligibility is resolved by **advancing** through the deck, never by shrinking it — shrinking shifts the modulus and breaks the no-repeat guarantee.
- **Persist `layoutRecipeId` and `layoutJitter` in the same `update` that writes `documentTextEncrypted`** (`motivations.service.ts:542-557`). The PDF is re-rendered from scratch on every download (`:626-673`) and byte-determinism is a tested property (`motivation-pdf.service.spec.ts:141-148`) — a recipe recomputed at render time from a row count or the clock would silently change a document the applicant already submitted.

### 3.7 How we measure that it works

Add a derived, non-PII, **unhashed** column (no applicant content, so it stays queryable):

```
layoutFingerprint = `${recipeId}|${frontMatter}|${toc}|${numbering}|${headingCase}|${face}|${anxStyle}|${sigStyle}|m${marginMm}|b${bodyPt}`
```

1. **Bucket concentration.** `GROUP BY layoutFingerprint` over a rolling 90 days per province × licence type; alarm when any fingerprint exceeds `1/T + 10%`. This directly answers the operator's requirement.
2. **Twin report** on the admin page. For each completed document, its worst-matching sibling by `similarity()` (`motivation-structure.ts:325-333`), with `sameRecipe` flagged. Prose sameness **plus** shared layout is the alarm; either alone is not.
3. **Two-tier regeneration**, extending `motivations.service.ts:504-515`:
   - `proseJaccard > 0.55` → regenerate text (unchanged, `SIMILARITY_REGENERATE_THRESHOLD` at `motivation-structure.ts:359` stays as-is)
   - `proseJaccard > 0.40 AND same recipe as the twin` → **re-deal the recipe** (advance one place in the deck) and re-measure. **Zero cost, no Claude call.** Today a layout collision would buy a full flagship regeneration; this makes the cheap fix the first response. The layout tier gets its own constant.
4. **Per-recipe quality.** `AVG(qualityScore), AVG(groundedness), AVG(gateCycles) GROUP BY layoutRecipeId` — how a bad recipe gets retired with evidence rather than opinion, and the empirical answer to "is templating making documents worse".
5. **A blind panel before beta opens.** Render ~20 documents from synthetic fact packs, print them, shuffle in the operator's 8 real samples, and have someone who reads these professionally (a firearms attorney, ideally a retired DFO) sort them into "same author / same system" piles. If ours cluster, the library has failed regardless of the Jaccard number. **No automated metric can substitute:** the fingerprint measures what we thought to encode; a reviewer notices what we didn't. Budget it as a launch gate.

### 3.8 Invariants across every recipe

- Disclaimer wording verbatim (attorney). Placement varies; words do not.
- A signature block always exists (`motivation-pdf.service.ts:212-230`).
- The applicant's real name and the MO reference each appear at least once (`motivation-pdf.service.ts:27-31`).
- **No outcome language, no mascot.** `motivation-pdf.service.spec.ts:157-172` currently tests this against **one** layout. Convert it to `describe.each(RECIPES)` **as part of the renderer refactor, before the second recipe exists** — not after the ninth, or eight of nine ship unguarded against the hardest CPA rule in the plan (`LICENCE-SERVICES-AND-FEED.md:103-105`).
- Page count is an **output** of honest content, never a recipe target. No recipe may specify a minimum length; the "do not pad" rule (`motivation-prompts.ts:167-168`) stays in the system prompt for every family.

### 3.9 The honest counter-argument, for the operator

The strongest anti-sameness force is not the template library. It is that the documents contain genuinely different facts, argued in a different order because the applicants' circumstances genuinely differ. **Templating is the floor.** If the prose is boilerplate, nine layouts produce nine flavours of obviously-boilerplate — and a reviewer reads prose, not margins. The research work and the existing-firearms/comparison work buy more anti-sameness than this entire library does. Build it, but do not let it be mistaken for the answer.

---

## 4. FIELD REGISTRY + SCHEMA CHANGES

### 4.1 `motivation-fields.ts` — bump `FIELD_REGISTRY_VERSION` (`:26`) once, for all of it

**COMMON_FIELDS additions:**

| key | kind | required | note |
|---|---|---|---|
| `province` | `choice` (9, matching `Province` / `PROVINCE_LONG` at `src/common/province-labels.ts:13-23`) | **yes** | Needed by three consumers: the layout bucket, s13 precinct binding, and Phase 2 crowd stats (`LICENCE-SERVICES-AND-FEED.md:132`). Shared cost. |
| `firearms_owned_status` | `choice`: `NONE`/`UPLOADED`/`TYPED_NO_UPLOAD` | **yes** | Required so `missingRequired` (`:408-413`) enforces it at generate for free. |
| `comparison_reasoning` | `long` | no | The applicant's own answer to "why is this not a duplicate". The half we must never compute. Chased by follow-up when `SAME_CALIBRE_DIFFERENT_ROLE` fires. |
| `cartridge_key` | `short` | no | System-set from the picker. **Must be registered** or `sanitiseAnswers` silently drops it (`:381-385`). |
| `competency_status` | `short` | no | From `MOTIVATION-DOCUMENT-STRUCTURE.md:119`. |
| `safe_specification` | `short` | no | `:120`. |

**S13_SELF_DEFENCE additions** (`motivation-fields.ts:151-180`):

| key | kind | required | note |
|---|---|---|---|
| `nearest_police_station` | `short` (autocomplete over canonical station names) | **yes** | Resolves to a stored `precinctId`. Ask, never geocode. |
| `residence_security_measures` | `long` | no | `MOTIVATION-DOCUMENT-STRUCTURE.md:121`. |
| `local_threat_picture` | `long` | no | `:121`. Note the help text must keep the `:157` line: general crime statistics carry no weight on their own. |

**S15 / S16_DEDICATED_HUNTER additions:** `typical_shot_range_m` (`short`), `vital_zone_cm` (`short`, optional — drives MPBR), `calibre_justification` (`long`).

**S16_DEDICATED_SPORT:** promote `discipline_requirement` (`:294-301`) to `required: true` and let the Haiku follow-up chase it; add `exercises_shot` (`long`) and `association_accreditation_no` (`short`).

⚠️ **Adding required fields changes `missingRequired` and will block existing drafts.** The flag is still off (`motivation_writer_enabled` defaults false — `motivations.module.ts:11-15`), so this is safe now. It will not be safe after beta opens.

### 4.2 Prisma

**New models:** `CrimeRelease`, `CrimePrecinct`, `CrimePrecinctAlias`, `CrimeStat` (§1.4); `MotivationExistingFirearm` + `ExistingFirearmSource` + `ExistingFirearmState` (§2.2).

**`Motivation` additions:**
```prisma
researchFactsEncrypted     String?   @db.Text     // the confirmed sentence set, for the sources annexure
researchReleaseKey         String?   @db.VarChar(24)
researchConfirmedAt        DateTime?
existingFirearmsConfirmedAt DateTime?
layoutRecipeId             String?   @db.VarChar(16)
layoutJitter               String?   @db.VarChar(16)
layoutFingerprint          String?   @db.VarChar(160)  // derived, non-PII, queryable
existingFirearms           MotivationExistingFirearm[]
```
**`MotivationStatus`:** add `EVIDENCE_REVIEW` (`schema.prisma:4008-4017`), and add it to `EDITABLE` (`motivations.service.ts:70-74`).

**`MotivationUpload`:** add the back-relation `existingFirearms MotivationExistingFirearm[]` (FK is `onDelete: SetNull` on the child).

**No change to `SecureFileNamespace`** (`src/common/secure-file-storage.service.ts:45-47`) — crime reference data is not PII and lives in seed JSON + the DB, not in encrypted storage.

### 4.3 Settings flags

New: `motivation_research_enabled` (default **false**), `motivation_layout_library_enabled` (default **false**), `motivation_existing_firearms_enabled` (default **false**).

⚠️ **`settings-registry-sync.spec.ts:79-91` hard-codes the exact list of `motivation_*` flags** and asserts it against both registries. Adding a flag without updating that test fails the suite — and registering it in only one registry fails it too.

---

## 5. WHAT NOT TO BUILD

### 5.1 Not worth it — cut these

| Don't build | Why |
|---|---|
| **Any web/search call at generation or render time** | §0.1. Also: `price-estimate.service.ts:409-411` uses `web_search` with `max_uses:1` and **no allowlist** — that is the precedent NOT to copy. If live retrieval ever happens, it belongs in the wizard with its own status and its own retry, never in `generate()`. |
| **News-article research; article annexures** | A news incident is someone else's robbery — the weakest evidence for *this* applicant and the highest misattribution risk. Reproducing an article in full, commercially, at scale, fits no exception in the Copyright Act. The far stronger artefact is the applicant's own SAPS CAS number or armed-response incident report, which is grounded, unique per applicant, and becomes an annexure. |
| **Automated quarterly ingest cron + "SAPS is overdue" alerting** | §0.1. SAPS's own schedule slips indefinitely; the alert would fire on SAPS politics and be trained out, destroying the signal. A stale seed file is visible in git. |
| **Third-party aggregator citations** (ISS Crime Hub, StreetSignal, SafeSuburb, policedata.online) | Figures are re-derived, cadence is outside our control, and a citation to a commercial site is materially weaker to the Registrar than the SAPS release. `afrith/crime-stats` is used for rename aliases only. |
| **Any silent widening to district / province / national when a precinct has no usable data** | That is exactly the "national crime statistics alone" weakness the Registrar discounts (`MOTIVATION-DOCUMENT-STRUCTURE.md:87`). |
| **Address → precinct geocoding, boundary polygons, fuzzy station matching** | Precinct boundaries do not follow suburbs, station names are not unique, and stations get renamed. Ask the applicant. |
| **A curated BC table; a `FactoryLoad` table at beta** | BC ambiguity is handled by lower-of / drop. Factory ammunition data is a real gap (most applicants shoot factory ammo) but the honest fallback — quote the handload figure *and label it*, or omit velocity — is correct and free. Revisit post-beta. |
| **Deriving calibre class from `caseCapacityGrH2O` / `maxPressureBar`** | Produces a plausible-sounding but unsourced claim the applicant signs. Curated band table only; unknown → no distinction. |
| **Inferring action type, barrel length, optics or capacity from a licence** | They are not printed on an SA licence card. ABSOLUTE RULE 8. |
| **Deliberate imperfection of any kind** | No injected typos, no fake handwriting, no randomised Afrikaans, no scrubbed PDF metadata. The line between "genuinely different documents" and "disguise" is the one thing that would make this indefensible. |
| **A layout-collision text regeneration** | Re-deal the recipe first: free, no model call. Only regenerate text if prose sameness still exceeds 0.55. |
| **Family C recipes; a third typeface** | After the attorney sitting; a third family means shipping a TTF into the `dist/`-assets trap (`motivation-pdf.service.ts:8-25`). |

### 5.2 Blocked on an attorney — cannot ship at all until reviewed

1. **The footer / disclaimer decision** (§3.1). Gates the entire template library. Three equivalent disclaimer wordings, or an accepted residual fingerprint.
2. **The split declaration.** `DISCLAIMER_TEXT` (`motivations.service.ts:60-64`) currently has the applicant warrant *all* facts as true. Once researched figures are in the document they are warranting numbers they did not supply. It must split into (a) facts I supplied, warranted true, and (b) published figures quoted from the cited sources, which I reviewed and remain responsible for checking — plus an explicit FCA s120(9)(f) notice on the declaration screen. Bump `DISCLAIMER_VERSION` (`:58`) and `TEMPLATE_VERSION` (`:57`).
3. **The existing-firearms acknowledgement** wording (§2.3.6).
4. **The citation and quotation rules:** quotations ≤ 40 words, in quotation marks, publisher + title + date + URL; a numbered source list at the end; never a full article, never a SAPS table as an image, never a copyrighted work as an annexure.
5. **Any provincial legal minima / species / discipline tables.** Nine instruments plus subordinate regulations, with an unresolved reading of "a barrel of a calibre of six comma five millimetres" (land or groove — it decides whether a 6.5 Creedmoor is caught by the Cape ordinance for kudu/eland/buffalo/wildebeest/oryx/red hartebeest). One question, one answer, and it decides whether the flagship rule row fires. **Until then THE CALIBRE argues no quarry suitability at all** (§0.1).
6. **Reproducing association exercise rules.** Copyright (they are a private body's versioned documents — the SAHGCA universal rules moved from `J006.34.04E` Nov 2018 to `J006.34.12E` Nov 2022), staleness (a superseded rule in a signed submission is the same class of harm as a wrong pressure figure), and neutrality (`LICENCE-SERVICES-AND-FEED.md:175-176` parks multi-association support as the anti-FOSA wedge; shipping with one association populated reads as partisan). Use `discipline_requirement` in the applicant's own words instead.
7. **The standalone PAJA letter** (`MOTIVATION-DOCUMENT-STRUCTURE.md:91-100`) and Phase 2 escalation letters (`LICENCE-SERVICES-AND-FEED.md:136`). LPA 28 of 2014 s33 bars non-practitioners, for reward, from drawing up documents "relating to or required or intended for use in any action, suit or other proceedings in a court". A licence application to the Registrar is administrative and probably outside it; a formal legal demand asserting statutory rights, drafted for a fee, as the pre-litigation step of a review application, is where a Legal Practice Council complaint becomes plausible. **Cut from Phase 1**, or ship as a fixed fill-in-the-blanks template with zero model-generated legal reasoning.
8. **The POPIA paperwork**, before the flag flips: the s27(1)(b) justification for special personal information (`threat_circumstances` invites accounts of crimes by identifiable third parties — POPIA s26), the s72 position for the Anthropic transfer, an updated privacy notice naming research as a purpose, and a retention-period decision argued **shorter** than the general default because the linked record (name + ID + exact address + daily movements + safe location and who has access + firearm serials + a crime-risk assessment at that address) is a firearm-theft target list.
9. **The frontend claim vocabulary**, locked in one shared constants file **before the first page is written** (a repo-wide `frontend` search for "motivation" currently returns only a `node_modules` false positive — this is a one-time chance to centralise it, following the `frontend/lib/support-contact.ts` pattern). Banned: "improves your chances", "the CFR expects", "professionally researched to the standard the Registrar requires", any success rate, any comparison to refusal odds. Permitted claims describe the artefact only: "every figure carries its source and a link", "you review and approve each source before it goes in". Note that "extensively researched" is a CPA s41 substantiable claim and, by implication, an outcome claim — it needs a per-document research audit log as substantiation and a documented "we found nothing credible" path that produces a complete document and says so. **The free beta does not save us: s41 attaches to marketing regardless of price.**

---

## 6. BUILD ORDER

Each step is independently shippable and independently verifiable. Steps 1–4 are prerequisites and are worth doing regardless of the three features.

| # | Step | Verify by |
|---|---|---|
| **1** | **Retention purge cron** reading `retentionPurgeAt` in `src/tasks/tasks.service.ts`; files first, row second, mirroring `erase()` (`motivations.service.ts:348-378`). | Unit test: a row past its date, with an upload, loses both bytes and row. |
| **2** | **Release the beta seat on generation failure** (`motivations.service.ts:611-621`). **Write `costUsd`** (`schema.prisma:4098`). **Raise `max_tokens` to 8000** (`motivation-claude.service.ts:182`) and log wall-clock per generation. | Existing specs pass; a forced generate failure leaves `seatsTaken()` unchanged. |
| **3** | **Registry bump**: all fields in §4.1, `FIELD_REGISTRY_VERSION` (`motivation-fields.ts:26`). Migration for the `Motivation` columns and `EVIDENCE_REVIEW`. New settings flags **in both registries** + update `settings-registry-sync.spec.ts:79-91`. | `npx prisma migrate dev`; full backend suite green. |
| **4** | **Renderer refactor**: `render(input, recipe, plan)` with a single default recipe identical to today's output; heading re-rendering against `expectedHeadings(plan)`; `[[ANNEX:…]]` expansion; convert `motivation-pdf.service.spec.ts:157-172` to `describe.each(RECIPES)`. | Golden-file test: default recipe produces byte-identical output to the current renderer (`motivation-pdf.service.spec.ts:141-148` still passes). |
| **5** | **`motivation-layout.ts`** — types, `RECIPES` (families A+B, 9), seeded deal, eligibility predicates, jitter. Pure, no Nest, fully unit-testable. | Deterministic-deal test; no-repeat-within-9 test per bucket; eligibility advances rather than shrinks. |
| **6** | **Selection wired into `generate()`**: `LAY:<province>:<type>` counter by direct prisma upsert (`motivation-quota.service.ts:99-103` pattern); persist `layoutRecipeId` / `layoutJitter` / `layoutFingerprint` in the same update as `documentTextEncrypted` (`motivations.service.ts:542-557`); `LAYOUT_GUIDE` fragment into `generationUserPrompt`; two-tier regeneration. | Golden-file test per recipe; concurrent-generate test draws two different recipes. |
| **7** | **Upload endpoint + extraction**: `@Post(':id/uploads')`, `@Post(':id/uploads/:uploadId/extract')`, `motivation-licence-extraction.service.ts`, wired into `motivations.module.ts:32-39`. | Fixture licence image → correct field set; a competency certificate returns `COMPETENCY_CERT` and zero firearms; a 12 MB file is rejected; the same file twice does not re-extract. |
| **8** | **`MotivationExistingFirearm` CRUD + confirm contract**: `PATCH :id/firearms/:fid`, `POST :id/firearms` (typed), `DELETE`; re-key serials; the three code-side cross-checks; `generate()` throws `motivation-firearms-unconfirmed`. | s27 arithmetic test (s13 issued 2019 / expires 2029 → WARN); ID-mismatch test; unconfirmed rows never reach the pack. |
| **9** | **`motivation-comparison.ts`** — pure, unit-tested **first**, including "owns a .308, applies for a .308, said nothing" and the 14-firearm cap. Then `FactPack.existingFirearms` + `comparisonBrief` in `renderFacts`, ABSOLUTE RULE 8, gate rule, `existing_firearms` / `comparison` / `first_firearm` SectionIds + heading alternates + `movable`. | Rule-by-rule unit tests; `planFor` swaps in `first_firearm` on `NONE` and `followsPlan` passes. |
| **10** | **Crime reference**: `scripts/build-crime-reference.ts` (guarded, offline, aborts on header mismatch), human spot-check, `crime-reference.json`, `scripts/seed-crime-reference.ts`, the four Prisma models. | Committed fixture workbook → expected row count and category set; **no network in tests**. |
| **11** | **`motivation-research.ts`** — precinct resolution (exact, `(station, province)`), category selection from answers, seeded sentence templates with **varied openings**, symmetry rule, suppression floor, staleness, `verifyResearch()`. Pure, heavily tested. | Symmetry test: no template can render a count without its direction. Opening-variation test: five templates produce five distinct `S:` tokens via `structuralTokens`. Digit-check test: an injected number fails. |
| **12** | **`EVIDENCE_REVIEW` status + the confirm-the-sentence screen**; persist `sentenceHash` + `precinctId` + `releaseKey`; facts resolve **before** `planFor()` at `motivations.service.ts:495`. | Empty fact set → no research section planned, `followsPlan` passes. Unconfirmed sentence never reaches the pack. |
| **13** | **`FactPack.sourced` + `renderSourced()`** into generation **and** gate; the fifth gate score `attribution` (+ `ATTRIBUTION_FLOOR = 70`, divisor 4→5 at `motivation-claude.service.ts:315-317`, JSON contract at `motivation-prompts.ts:243-245`, pass expression at `:331`); amend `WHAT_MATTERS.S13` (`:51-53`) and ABSOLUTE RULE 1 (`:151-155`). | Gate test: a document containing a number absent from `<research-facts>` scores `attribution < 50` and fails. |
| **14** | **PDF footnotes + `SOURCES AND REFERENCES` block**, emitted structurally; `researchFactsEncrypted` persisted; bump `TEMPLATE_VERSION`. | Re-render months later from the stored fact list produces byte-identical bytes. |
| **15** | **`motivation-calibre.service.ts`** — exact-match cartridge resolution, chamber facts from `CartridgeSpec`, velocity **band** from `ManualLoad` with manual+page, energy from `BallisticsService`, `mpbr(vitalZoneCm)`, the physics invariant, mandatory test-barrel caveat, cap 2–3, degrade-to-silence. | Invariant property test over the curated rows; fixture test that a no-verified-row pack produces a CALIBRE section matching no `/ft-?lbf|fps|joule|MPBR|bar/`. |
| **16** | **Admin sameness + spend report**: bucket concentration, twin report, per-recipe quality, per-document research audit log. (Adding an admin controller here means importing `JwtModule.register({})` and providing `AdminJwtGuard` — `motivations.module.ts:16-21`.) | Renders with zero data; renders with 20 synthetic documents. |
| **17** | **Blind panel** (§3.7.5) → **then** open beta. | Panel does not cluster our documents. |
| **18** | **Attorney sitting** (§5.2 items 1–9) → Family C recipes, the legality gate, the PAJA letter. | — |

---

### Two things to hand the operator alongside this

1. **The reframe on "extensive research".** A curated, cited, applicant-adopted evidence layer is *more* persuasive to a DFO than model-generated prose, because it is checkable. It is the only version that survives the CPA substantiation test. It is reproducible when someone asks us to explain a document. And free-form research is the fastest possible way to create the template-sameness pattern he identified as the existential risk in his own third requirement. His three asks are in tension with each other; this design is what reconciles them.
2. **The direction problem, stated before it surprises him.** The newest SAPS quarter shows house robbery down ~20% — *the* s13 statistic, falling. The symmetry rule means our documents will say so. That is correct: assume every figure will be checked by someone with better access to it than us, and "still high, though falling" is a stronger sentence than a concealed decline. If he wants area-specific, current, signable material, the genuinely strong source is the applicant's own — SAPS case numbers for incidents they reported, CPF or neighbourhood-watch bulletins, their security company's incident reports, body-corporate minutes. Those are area-specific by definition and are the applicant's own facts to assert, which keeps the whole feature inside the existing trust boundary instead of breaching it. Prompting for a case number will out-perform any national dataset.