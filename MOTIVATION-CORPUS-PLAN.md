# Ranked plan — NATSHOOT corpus against the motivation generator

## Before the plan: three corrections to the inputs

**The statute has landed.** `motivation-statute.ts` is no longer unimported — `C:\dev\gun-galore\backend\src\motivations\motivation-prompts.ts:5` imports `AS_AT`, `renderStatute`, `statutoryTextFor`; `generationUserPrompt` calls `renderStatute(pack.licenceType)` and `gateUserPrompt` emits a `<statutory-text>` block. The **argument** analysis's item 7 ("dead code, rule 4's quoting branch never fires") is stale by about an hour. Per the brief, nothing below plans it.

**The corpus does not agree with itself about section order, and the disagreement is not the interesting part.** `layout.txt` puts the battery at §1; `hunt.txt` and all three sport examples put it at §7, immediately before §8 purpose. What is invariant across all six is a *three-pass* treatment: asserted in the synopsis, evidenced per-firearm in the battery, argued by backward reference in the purpose section. That pattern — not a section number — is what the plan maps against.

**The single most important thing in this plan is a coupling, and none of the three analyses states it sharply.** The per-firearm battery paragraph (prompt change) and `existing_firearm_N_use` (new field) are one change, not two. Today the writer sees each held firearm as `type` + `calibre` + `make` and nothing else. A brief that demands one paragraph per firearm ending in "and it cannot do this job" without supplying what each firearm *is currently used for* does not produce the corpus paragraph — it produces five paragraphs of invention pressure aimed straight at rule 1. `ARGUE_IT` authorises the **distinction** as rationale; it does not authorise "I use this rifle for kudu in the bushveld", which is history under rule 8 and must be supplied. **Ship the field or do not ship the brief.**

---

## Master ranking

| # | Change | Bucket | Effect |
|---|---|---|---|
| 1 | Per-firearm battery paragraphs **+** `existing_firearm_N_use` | A + C (coupled) | **Document, high** |
| 2 | Move the battery section ahead of `the_firearm` | B | **Document, high** |
| 3 | Comparison assertion in the synopsis | A | Document, moderate–high |
| 4 | Battery section conditional on *any* holding, not on same-class overlap | B | Document, moderate |
| 5 | Resolve rule 9 against the `the_discipline` brief | A | Document, moderate |
| 6 | Residential address into rule 10 | A | Document, moderate |
| 7 | The closing request to the Registrar | A | Document, moderate |
| 8 | Enumerate `experience` in its brief (do **not** split the section) | A | Document, moderate |
| 9 | Proficiency facts, by extraction only | C | Document, moderate |
| 10 | Reloading: one yes/no, one line, conditional section | B + C | Document, low–moderate |
| 11 | Permit one attributed research source, narrowly | A | Document, low–moderate |
| 12 | Close the adjectival over-claim hole | A | Document, low |
| 13 | NATSHOOT/NHSA rows in `shooting-disciplines.ts` | C-adjacent (data) | Document for NHSA applicants; process otherwise |
| 14 | Render held firearms as grouped rows | A (mechanical) | Document, low — enabling |
| 15 | Storage brief: residential security where volunteered | A | Document, low |
| 16–18 | Front-of-pack attached list; SAPS 359(a) naming; annexure-letter overflow guard | process | **Process only** |

---

## A. PROMPT-ONLY CHANGES

### 1 (prompt half). Per-firearm battery paragraphs
**Touches:** `motivation-prompts.ts` → `SECTION_BRIEFS.comparison`; `motivation-overlap.ts` → the `notes` construction in `checkOverlap()` (~L556–609), which currently joins matches with `', '` into one list.

Rewrite the brief from "one passage naming the held firearm" to "one short paragraph per firearm held: what it is, what I use it for, and why it cannot do the job this application is about." Restructure the overlap note to emit one direction block per matched row rather than a joined list, so the writer is handed *n* arguments instead of one.

**Corpus:** the defining habit. `hunt.txt:150–189` — seven paragraphs, one per firearm, including two shotguns in a **rifle** application and a .22LR that gets disqualified in one sentence. `Example-motivation-for-sport-rifle.txt:90–100` — five, each ending in a reasoned disqualifier. `Example-motivation-or-Sport-handgun.txt:115,119` disqualifies by **licence section and role** rather than ballistics ("This handgun is a Section 13 for Self-protection… too compact"). `layout.txt:106–108` makes it mandatory and per-item.

**Effect: document, high** — and it is the corpus's own strongest move. Enumerating and disposing of each holding pre-empts the licence-record check a DFO does before opening the motivation. Conditional on the field in C1.

### 3. Put the comparison assertion in the synopsis
**Touches:** `SECTION_BRIEFS.introduction`.

Add: where an overlap note is present, the opening paragraph must carry one sentence stating that nothing already held serves this purpose. Gate on `pack.overlapNote` so a first application never fires it.

**Corpus:** all four worked examples, sentence two, above the fold — `Example-motivation-for-sport-rifle.txt:50`, `hunt.txt:93`, handgun `:75`, shotgun `:69`.

**Effect: document, moderate–high.** Cheapest item on this list and the pass a skim-reading reviewer actually sees. It also removes the forward reference that change 2 would otherwise create.

⚠️ **Ask for the move, not the sentence.** The corpus's version is near-boilerplate across all four documents ("…are not one set-up for, neither can they achieve the accuracy needed…"). Word the brief to require the assertion in the applicant's own terms and vary it; a fixed opening sentence in every document we produce is precisely what `fingerprint()` (`motivation-structure.ts`) exists to detect, and we would be manufacturing the signal ourselves.

### 5. Resolve rule 9 against the `the_discipline` brief
**Touches:** rule 9 (`motivation-prompts.ts:427–430`) and `SECTION_BRIEFS.the_discipline`.

These currently contradict each other. Rule 9: *"The discipline's published requirements are CONTEXT FOR YOU. Do not reproduce them."* The brief: *"the course of fire, the distances, the positions, the time limits, the class or division"* — which is the published requirement, restated. And `discipline_requirement` is **prefilled** from `shooting-disciplines.ts` with paragraphs of division specifications, so it arrives in `<applicant-facts>` as an applicant answer, wearing the authority of something they typed.

Resolution — narrower than either side: **the specific exercise this firearm will be entered in, in prose, as the requirement it must meet.** Never the association's catalogue, never a division table transcribed.

**Corpus:** resolves it the wrong way — `Example-motivation-for-sport-rifle.txt:127–136` reproduces plate dimensions, spacing tolerances and firing positions verbatim; the handgun example runs ~20 exercises across `:158–210`. Do not follow.

**Effect: document, moderate.** Free, and it fixes a live internal contradiction independent of the corpus.

### 6. Residential address into rule 10
**Touches:** rule 10 (`motivation-prompts.ts:462–472`).

Rule 10 mandates name + ID in the opening paragraph and make/model/calibre/serial where the firearm is introduced. Add the residential address. `residential_address` is `required: true`, not `formOnly` (`motivation-fields.ts:211–220`), so it already reaches the writer — this costs nothing.

**Corpus:** all six documents open "I, X (ID …) (Annexure A1), live at … (Annexure A2)" — `layout.txt:117`, `hunt.txt:99`, sport rifle `:53`, handgun `:80`, self-defence, renewal.

**Effect: document, moderate.** Two concrete gains. (a) The S16 and S24 skeletons have no `personal_circumstances` section, so an S16 pack can currently ship an `ADDRESS_CONFIRMATION` annexure that no sentence cites — and `ANNEXURE_ORDER`'s own comment (`motivation-checklist.ts:195–198`) states why it matters: the application is lodged at the DFO for the area of ordinary residence. (b) It is cheaper than the structure analysis's alternative of adding `personal_circumstances` to the S16/S24 skeletons, which spends a whole section on a document that does not need one.

### 7. The closing request
**Touches:** `SECTION_BRIEFS.conclusion` (which currently says "no request for a favourable outcome") and `CLOSING_GUIDE` (`motivation-prompts.ts:101–105`).

Permit — as one sentence inside whichever closing mode was drawn, **not** as a new section — "I request the Registrar to issue a licence for [type, make, calibre, serial] for [purpose]."

**Corpus:** universal. `layout.txt:195–199` (§11), `hunt.txt:305–308`, sport rifle `:160`, handgun `:240`, shotgun `:211`, self-defence.

**Effect: document, moderate.** Rule 3 bans *predicting* the outcome; a request is not a prediction, and the ban over-reads it. The real value is that the prayer restates the identity triple and the purpose immediately above the signature, which is where a reviewer confirms what was actually asked for. Two constraints: (a) explicitly refuse the renewal template's *"be favourably considered"* (`Template-renewal-application.txt`), which drifts into the outcome language the operator has ruled out; (b) do **not** make it a new `SectionId` — a mandatory fixed closing section in every document we produce is an anti-template cost we have no reason to pay for one sentence.

### 8. Enumerate `experience` in its brief — do not split the section
**Touches:** `SECTION_BRIEFS.experience`.

Rewrite from *"Training, competency, proficiency, hours and years"* to an ordered instruction: take proficiency training, competency, accredited-association membership, dedicated status, clubs, and further training **in turn**, each with its date, its number where supplied, and its annexure.

**Corpus:** those are six separately numbered sections in every document (`layout.txt` §2–§7; `hunt.txt` §1–§6; sport rifle `:55–86`). Our single section carries all of it in 2–4 paragraphs.

**Effect: document, moderate.** I am **rejecting** the structure analysis's proposal to split into two `SectionId`s. The corpus evidence supports *six*, nobody is proposing six, and two is an arbitrary midpoint that costs a schema change, new heading alternates, five skeleton edits and test churn to sort the same facts. An enumerating brief captures most of the gain for free. Revisit only if the sameness report shows S16 documents converging.

### 11. Permit one attributed research source — narrowly
**Touches:** `renderResearch()` (`motivation-prompts.ts:171–195`).

`research()` already asks for *"the source (publication and URL) after each cluster of facts"*, and `renderResearch` then tells the writer to weave it in as prose in the applicant's voice, never saying attribution is permitted. Add: where the research block itself carries an attribution, **one** attributed sentence is allowed in `the_calibre` or `the_firearm`, and it must be followed immediately by the application to this applicant.

**Corpus:** `Example-motivation-for-sport-rifle.txt:108–113` — named author, date, URL, then *"This write-up… clearly describes the 6,5 Creedmoor calibre's capability to be used as a serious long-range target shooting calibre."*

**Effect: document, low–moderate.** Converts an assertion about a cartridge into something a reviewer can check. Keep it to one sentence: the corpus's own next line is the uncited *"39 out of the 50 top-shots"*, which is the failure mode this permission opens the door to.

### 12. Close the adjectival over-claim hole
**Touches:** rule 3, or the rationale paragraph of rule 9.

Rule 1 catches fabricated **figures**; nothing catches a performance prediction carrying no number. Add: a claim about how the firearm will perform *for this applicant* is written as intent, never as prediction, unless the research block supports it.

**Corpus:** `Example-motivation-for-sport-rifle.txt:142` — *"will, judging by all written reports and listening to other Creedmoor owners… definitely put me in a position to be really competitive"*; near-identical at handgun `:215`.

**Effect: document, low.** Small hole, cheap patch, adjacent to rule 3's territory.

### 14. Render held firearms as grouped rows
**Touches:** `renderFacts()` (`motivation-prompts.ts`).

Emit the six `existing_firearm_N_*` rows as one compact block, one line per firearm, rather than as 18–24 loose `<answer>` scalars. They are already contiguous and ordered in registry order, so this is a readability improvement rather than a bug fix — but once `_use` exists the **row** is the unit of the argument, and per-firearm paragraphs should be asked of a per-firearm rendering.

**Effect: document, low — but enabling for change 1.** Bundle it.

### 15. Storage brief: residential security where volunteered
**Touches:** `SECTION_BRIEFS.storage_safety` and the `safe_storage_detail` help text (`motivation-fields.ts:510–518`).

Invite the perimeter/alarm/armed-response context where the applicant volunteers it; do not add a field.

**Corpus:** `hunt.txt:290–294`, handgun `:231`. **Effect: document, low** — and see D6 for the hard limit on how much of this we reproduce.

### Gate rubric, alongside changes 1 and 4
**Touches:** `gateSystemPrompt()` completeness rubric (`motivation-prompts.ts:~705–720`).

The rubric already penalises *"a same-class holding with no comparison"*. Extend it to: a battery paragraph that names a holding without stating its role and disposing of it has not done the section's work. ⚠️ Word it as a *completeness* deduction only, and repeat the existing carve-out — a reasoned distinction built from the pack's own facts is **complete and grounded**, and only an invented fact inside it fails. The gate has already once scored correct behaviour at 40 (`motivation-prompts.ts:~670`); do not build a second grader that pushes the writer toward inventing a use it was not given.

---

## B. STRUCTURE CHANGES

### 2. Move the battery section ahead of `the_firearm`
**Touches:** `SECTION_SKELETONS` in `motivation-structure.ts:365–442`, all five entries.

`comparison` currently sits eighth of ten, **after** `the_firearm`, `the_calibre` and `compliance_history`, while `renderOverlap()` tells the writer *"Deal with it plainly and early."* We instruct early and schedule late.

New position: **immediately after the purpose section and before `the_firearm`** — `the_discipline`/`the_quarry`/`the_threat` → battery → `the_firearm` → `the_calibre`.

I am deliberately **diverging from the corpus's literal position** (battery *before* purpose, `hunt.txt` §7→§8) and should say why: their §8 fuses requirement and firearm argument, so the battery has to precede the pair. Ours splits them. Placing the battery between our purpose section and our firearm section gives the disqualifiers a fully-stated requirement to be measured against — strictly better than the corpus, and it keeps rule 12 and the `purposeIdx > firearmIdx` backstop (`motivation-structure.ts:~500`) intact.

**Corpus:** `Example-motivation-for-sport-rifle.txt:104` — *"As can be seen from the content of paragraph 7 above, I do not own any rifle which is capable of accurate precision shooting over distances of 300 to 1,000m."* That backward reference is the shape our order cannot currently produce; ours would point forward, which is the exact defect the fix-5 comment at `motivation-structure.ts:~385` diagnosed for purpose→firearm and left unfixed one section over.

**Effect: document, high.** Depends on change 3 to stay coherent (the reader needs the purpose asserted on page 1 before the battery is measured against it).

### 4. Battery section conditional on *any* holding
**Touches:** the `.filter((id) => id !== 'comparison' || opts.hasOverlap === true)` in `planFor()` (`motivation-structure.ts:~538`), and `PlanOptions`.

Today an applicant holding six firearms, none same-class, gets no prose inventory at all. The design comment defends this on the ground that without an overlap the writer *"has nothing to fill it with but invention"* — a good reason that **stops being true once `_use` exists**.

Change the gate to "any held firearm", and branch the brief: with an overlap note it is the rebuttal section; without, it is the battery statement. Keep the heading alternates distinct for the two cases.

**Corpus:** the hunt example disqualifies both shotguns in a rifle application (`hunt.txt:184–189`) and the sport-rifle example disqualifies the .22LR (`:100`) — out-of-class disposals that foreclose "why not use the shotgun you already have".

**Effect: document, moderate.** Two cautions: the `paragraphs: 2 + rng()*3` floor would give a one-.22LR battery two paragraphs of nothing — scale the paragraph count with row count, or floor it at 1 in the no-overlap case. And the PDF's `ownedTable` (`motivation-pdf.service.ts:1012`) already puts the bare holdings in front of the DFO, so the marginal gain here is the *reasoning*, not the *list*.

### 10 (structure half). Reloading as a conditional section
**Touches:** a new `SectionId` plus `HEADING_ALTERNATES`, dropped when the yes/no is not "Yes" — same mechanism as `comparison`.

**Corpus:** a numbered section in five of six (`layout.txt` §9; `hunt.txt:267–286`; sport rifle `:144–152`; handgun `:218–226`; shotgun `:191–197`). Its argumentative work is real rather than decorative: it is what makes the per-firearm disqualifier concrete — the .375 in `Example-motivation-for-sport-rifle.txt:90` fails because *its handload is formulated for 150 m one-shot kills*. It also has a statutory hook the corpus never states: FCA s 93(1) exempts loading for one's own licensed firearms, and s 93(2)(b) lifts the primer cap specifically for a dedicated hunter or dedicated sports person.

**Effect: document, low–moderate**, and ranked below the battery work deliberately. It only pays once change 1 has landed — before that there is no per-firearm disqualifier for it to make concrete. See D5 for what we refuse to write inside it.

---

## C. NEW DATA — with the do-not-interrogate rule applied

The operator's rule (2026-08-20): *"no one ever has to answer a bunch of technical shit questions."* `findGaps()` already enforces the tight version — a required field that is **empty**, and nothing else. Everything below is measured against that.

### C1. `existing_firearm_N_use` — the one item that must be a visible box
**Touches:** `motivation-fields.ts`, the `existing_firearm_N_*` block (~L970–1030).

One optional short line per row, `kind: 'short'`, rendered in the review card **next to a firearm we already read off an uploaded licence** — never as a blank six-row interrogation of someone who has uploaded nothing.

- **What it buys:** the load-bearing fact of the corpus battery paragraph. Two words ("bushveld plains game", "clay targets") beats our current nothing.
- **Rule 8 posture:** current use is a **verifiable fact**, so it must be supplied. The distinction between firearms is rationale and stays the writer's job under `ARGUE_IT`.
- **Interrogation cost:** the rows already exist and are already prefilled from `CURRENT_LICENCE`. An applicant with no licences never sees it. Optional, never blocking.

This is the only genuinely new blank box in the plan.

### C2. Proficiency facts — extraction only, never a question
**Touches:** `EXTRACTABLE.PROFICIENCY_CERTIFICATE` in `motivation-extract.service.ts:71`, which today yields exactly one key (`competency_for`); plus 3–4 new `docSourced: 'PROFICIENCY_CERTIFICATE'` fields.

Add: provider name, training date, certificate number. `PROFICIENCY_CERTIFICATE` is already a **required upload** for every licence type (`motivation-documents.ts:202–216`) and is already annexed — so the pack currently carries a tab that no sentence in the document cites and no fact describes.

**Corpus:** its own numbered section in all six (`layout.txt` §2; `hunt.txt:102–109`; sport rifle `:57–60`).

**Do not ask for unit-standard codes.** No applicant knows US 190748 / 10754 / 10750 / 119651 off-hand; asking is the definition of the technical-shit question. Extract them at lowest priority — they are the most OCR-error-prone item on the certificate and the least load-bearing, since the certificate itself is in the pack. Where extraction fails, the sentence reads fine without them.

**On POSLEC:** the corpus names a second document (statement of results, its own number and annexure). Allow a second `PROFICIENCY_CERTIFICATE` upload — the annexure code already prints "(1 of 2)" — and do **not** put "POSLEC" in applicant-facing copy; POSLEC SETA became SASSETA in 2005. Word it "your training certificate and statement of results".

**Effect: document, moderate.** One checkable sentence that makes an already-annexed, currently-uncited tab land.

### C3. Reloading — one yes/no plus one revealed line
`yesno` + a short "since when / for which calibres" revealed on Yes, plus an optional bench photograph as a conditional upload kind. A non-reloader answers one tap and sees nothing else. Feasible to *default* rather than ask: the site already sells components and runs Load Lab.

### C4. Free wins that need no question at all
- **Un-hide three competency fields.** `competency_issued`, `competency_expiry` and `competency_for` are `formOnly: true` (`motivation-fields.ts:389–407`), so the writer never sees them — we **hold** the issue date and the covered types and cannot write "I was declared competent to possess handguns, rifles and shotguns on [date], certificate number X", the exact sentence in all six corpus documents. Deleting flags, zero applicant impact. `competency_number` is already visible, so the asymmetry is accidental rather than designed.
- **`association_joined`, as `docSourced: 'ASSOCIATION_CARD'`.** Association 1 has only `dedicated_since`; associations 2 and 3 have `_joined`. The sport-rifle example runs member 2004 → dedicated 2015, and an 11-year membership is the strongest date in that section. Extracted, not asked.
- **Relabel `association_2_name`** from "Another association you belong to" to "…or club". One word; covers corpus §6 without a new field.
- **NATSHOOT/NHSA rows in `shooting-disciplines.ts`** (change 13). 76 KB covering IPSC, SADPA, CHASA, SABU, SAPSA, SAHGCA and ~25 other bodies, and no entry for the SAPS-accredited association this corpus comes from. An NHSA member today picks "Something else" and types `discipline_requirement` from scratch — which is the interrogation the operator's rule exists to prevent. This *removes* a question. It is research/data-entry work, not generator design, and its document effect is confined to NHSA applicants.

---

## D. What I would explicitly NOT do

**D1. Do not release `existing_firearm_N_licence_no` or the two serials from `NEVER_PROMPTED`** (`motivation-fields.ts:1915–1916`), notwithstanding the argument analysis's item 2. The corpus prints them; nothing in the *argument* turns on them. They are `sensitive: true`, they are already visible on the annexed licence copies, and sending six licence numbers plus twelve serials into a prompt trades data minimisation for nothing but corpus parity — while adding twelve chances to transcribe a digit wrong into a document the applicant signs. Change 1 works without them.

**D2. Do not cite an annexure per held firearm.** Two analyses imply it; it is mechanically impossible and would breach rule 11. Every `CURRENT_LICENCE` upload collapses to **one** letter with an accumulated count (`motivation-checklist.ts:420–441`), and the writer only receives `{letter, label}` — the "(2 of 4)" lives on the printed page caption, not in the prompt. A citation naming a specific licence is a wrong citation, which rule 11 correctly calls worse than none.

**D3. Do not copy the disqualifier sentence.** In `Example-motivation-for-sport-rifle.txt` the clause *"…and is not suited for long-range sport shooting up to 1,000m for which the rifle this application refers to, is meant for"* appears at `:90`, `:94`, `:96`, `:98` — four times, near word-for-word. Adopt the per-firearm **paragraph**; refuse the copy-paste **sentence**. This is the shared-origin signal `fingerprint()` (`motivation-structure.ts`) exists to detect, and it would score.

**D4. Do not adopt NATSHOOT's numbered heading list** (`layout.txt:21–41`). Taking the *order* is defensible and change 2 partly does. Taking the *headings* would give every document we produce the same table of contents as every NATSHOOT-templated document in the country — the exact opposite of what `HEADING_ALTERNATES` is for.

**D5. Do not write load data inside the reloading section.** `Example-motivation-for-sport-rifle.txt:148` gives bullet weight, 41.5 gr of a named propellant, case brand, primer type and 2,850 fps. Every one of those is the class of figure rule 1 exists to keep out of a signed document, and publishing a specific charge weight in a document we generate at volume is a second problem on top of the first. The reloading section states *that* the applicant loads for their firearms and *that* a workup will be needed for the new one — nothing more.

**D6. Do not map the applicant's home defences.** `hunt.txt:291–294` and handgun `:231` give wall height, palisade, electric fence, trellidoor placement and beam positions. Change 15 invites the *context*; it stops at the safe. A circulating document that describes exactly how a house is protected is not a document to generate at volume.

**D7. Do not run the applicant down.** Handgun `:150` *"achieve below average results, but never outstanding"*; `:212` *"my current handgun is just not good enough"*; rifle `:115`. The equipment-limited-at-range argument is legitimate and is the corpus's core sport argument — keep it. The self-assessment is not: "I achieve below average results" is a **verifiable claim about the scores report the pack annexes**, so rule 8 bars it unsupplied anyway, and it is an odd thing to hand a reviewer deciding fitness. Keep "the rifle is limited beyond 350 m"; drop "I am not very good".

**D8. Do not reproduce the exercise catalogue.** Handgun `:158–210` lists ~20 exercises — including 10 m Air Pistol, 15 m Black Powder and Historic Revolver in .38 S&W — for an application for **one** handgun. Beyond padding, it is self-harm: it puts on record that the firearm is being motivated against events it is not eligible for, inviting exactly the equipment-rules reading rule 9 keeps out.

**D9. Do not adopt "convenience" as a reason.** Shotgun `:154`: *"It is convenient to have my own shotgun, seeing that I have to lent shotguns from friends and family."* Borrowing is a fact worth stating if true; "convenient" is a poor frame in a document whose s 13 test is that the need cannot reasonably be met otherwise.

**D10. Do not repeat an association's view of what SAPS requires.** `layout.txt:63,65` and handgun `:41–44`: club membership *"not required — NHSA has all exercises"*. That is NATSHOOT asserting its own sufficiency. Not ours to reproduce over an applicant's signature.

**D11. Do not add per-firearm photographs.** `layout.txt:110–112` wants a photo of each owned firearm beside its paragraph. N framed photographs from someone who has already uploaded N licence copies, for nil gain over the licence copy already annexed — and it would balloon a pack that already runs long. If it is ever wanted, `motivation-firearm-image.ts` can fetch a stock image from make+model with zero applicant effort; that is the route, not an upload.

**D12. Do not adopt the self-defence example's research method.** *"GET EXAMPLES FROM GOOGLE AND ADD THAT AS PROOF… crime statistics… news articles."* We already supply researched area context through `research()`, and the `the_threat` brief already bans national statistics used as atmosphere. The corpus's version produces a fear document; ours is better. No change.

**D13. Do not add "I have no criminal record" or "inspected by SAPS (if applicable)".** `Template-renewal-application.txt:21` and handgun `:235`. The `compliance_history` brief already refuses the first — *"SAPS verifies this themselves"* — and it is right. The second is a verifiable fact shipped with an "(if applicable)" beside it, which is a template artefact, not a claim. If the operator wants the safe-inspection sentence, it needs a field and it should surface **only** where the applicant already holds a licence; it is meaningless to a first-time applicant.

**D14. Do not treat `statutory_application`'s absence from the corpus as evidence against it.** None of the six quotes the Act; only Reg 86 appears, inside safe storage. That is weak evidence it is not *expected*, not evidence it is unwelcome — and the approved-motivation corpus that justified the section is better evidence than this one. Keep it. If word budget has to come from somewhere to fund changes 1–8, its 3–4 paragraph floor (`motivation-structure.ts:~565`) is the place to look before anything in the purpose block.

---

## Process-only tail (16–18)

- **Front-of-pack attached-documents list.** NATSHOOT names its attachments on page 1; ours is a count on the cover (`motivation-pdf.service.ts:~789`) and a full index at the back (`:1326`). A compact list on the `CONTENTS` page would serve a DFO's completeness check. Keep the full index, with its certification notes and not-printed list, where it is.
- **Name the form on `FIREARM_SOURCE_PROOF`.** Its copy says "the dealer's invoice or quote" (`motivation-documents.ts:237`); every corpus document names the **SAPS 359(a) / 350(a) Dealer's Stock Return**. A stock return is not an invoice, and an applicant told "invoice" brings the wrong page. Copy change only.
- **Annexure-letter overflow.** `String.fromCharCode(65 + i)` (`motivation-checklist.ts:406/430/444`) emits `[`, `\`, `]` past 26. Unreachable today — 23 `ANNEXURE_ORDER` entries less four safe-photo and one association collapse leaves 18 — and one enum value away from not being. Latent, not live; guard it when something else touches the file.

**Open question for the operator, not for me to settle:** NATSHOOT treats the **motivation itself as "ANNEXURE A"** to the SAPS 271 (the header on `layout.txt` and on the sport-rifle example). Our lettering gives `A` to the applicant's identity document. If DFOs in a given province expect the motivation to be Annexure A, our index collides with their mental model. Worth deciding either way; I have no evidence which convention a DFO actually applies.