# Licence application rebuild — build plan

Built from the four-artboard design canvas (`Main` · `Capture` · `Seller` · `Ready`),
Section 16 dedicated sport shooter, private sale.

- **Wizard (current design): https://claude.ai/code/artifact/52a67bc8-9bd2-4b84-a769-b69f2d9b9141**
  — ten steps, ordered so each feeds the next; per-section 271 completeness on every page.
  **This supersedes the first canvas below**, which is kept for the capture and pack detail.
- First canvas: https://claude.ai/code/artifact/5081a315-4522-4dcb-aab8-e4e948a9294b
- Working files: `scratchpad/wizard/*.dc.html`, `scratchpad/canvas/*.dc.html`
- Branch at time of writing: `feat/winkel-rebuild` @ `7b4139c`

---

## Build log

The findings below describe the gap **as it was found** and are left as written.
This records what has since been closed. Nothing is committed or deployed.

| Phase | State | What landed |
|---|---|---|
| **1 · Provenance spine** | ✅ done | `common/answer-provenance.ts`; `Motivation.answerProvenance Json?` + migration; all **six** write paths wired (the plan said three — `applyExtraction` and `answerFollowUp` were missing from it). 44 + 19 tests |
| **2 · The pack payload** | ✅ done | `ChecklistItem` gains `state`, `closer`, `captureRoutes` — all derived, none authored per row. `GET :id/pack`. 13 + 19 tests |
| **3 · The live 271** | ✅ done | `saps271-coverage.ts` — **per question, not per box** (operator, 2026-08-28). Applicability is `isVisible()`, the same function the form uses. 22 + 3 tests |
| **4 · Section F** | ◐ part | **B7 and B8 done** — the map went 144 → **170** fields with zero of the existing 144 moving. **B9 (the seller's capture) is next** |
| **4a · Defect sweep** | ✅ done | Eleven operator-spotted defects, then the same fix class swept across the whole form. Map now **184 of 184** boxes measured. Unwritten: **6**, each deliberate and documented where it is decided |
| **B9 · Section F reaches paper** | ✅ done | The consent form now asks the seller for **his half of section F** plus **two declarations** (consent, and truth under s 120(9)(f)); `renderSaps271` passes it. 22 boxes went from mapped-but-unreachable to filled |
| **4c · Two routes only** | ✅ done | `firearm_source` offers **private / dealer / not decided**. Estate is **retired, not deleted** — `retiredChoices` keeps it valid on write so existing applications still save. Consent flow now served per route |
| **4b · Item 1.2 routing** | ✅ done | The owner-type tick came off the **stated route**, not off holding a seller. Map **188 of 188**; all five A–E ticks measured. Fixed *before* B9 wires the seller through |

**Closed by the build:**

- §3.1 Section F had zero mapped boxes → **22 boxes mapped**, type A (private sale)
  plus the declaration block, and filled from a new `Saps271Seller` input.
- §3.3 four captured firearm fields had nowhere to print → **mapped and filled**
  (`e_barrel_serial`, `e_barrel_make`, `e_frame_make`, `e_receiver_make`).
- §3.4 nothing persisted provenance → **it does now**, on every write path.
- §3.5 `ChecklistItem` too thin → **three fields added**, `done`/`oursDone` untouched.

**Found while building, and not in the original plan:**

- The migration chain **could not be replayed into an empty database** — one migration
  used a type another created later. Fixed additively; a spec now guards it.
- The **local database was 30 migrations behind** and had no licence-services tables at
  all. Rebuilt from the chain; 52 → 79 tables.
- **`CHARACTER_REFERENCE` is in no `RECOMMENDED` list**, so the checklist has no row for
  character references at all — despite the witness engine being built and the design
  showing them. Adding one moves `oursTotal` for every licence type, so it is a product
  decision, not a refactor.
- **`MotivationUpload` has no persisted origin**, so a per-document provenance chip has
  nothing honest to show. `ChecklistItem.source` was deliberately left out rather than
  ship a field that is always `undefined`.

**The defect sweep (4a), in the order the operator caught them:**

Every one of these was found by eye on a rendered PDF, and every one turned out to be a
**class** of defect rather than a single wrong box. The rule that came out of it: when a
box is wrong, sweep the map for every box that could be wrong the same way.

| Caught | Was | Class it belonged to |
|---|---|---|
| Postal codes all four digits in box one | mapped `text`, not `chars` | **three** fields, not one; a spec now asserts every `*postal_code` has exactly 4 cells |
| Date of birth wrong | we wrote DDMMYYYY, the form rules YYYY-MM-DD | **every** date row on the form. `dateDigits()` fixed once |
| Applicant's own postal codes missing | mapped, never written | a whole sweep for **measured-but-never-written** boxes: 21 found |
| Items 1.5–1.11 printed left of their boxes | a narrow empty spacer column read as the value box | the fillable template's widget rectangles settled it; one conservative hop, never a search |
| G.1 competency had no ticks | 8 boxes unmeasured | measured; only category **D** is ever ticked, and why is written into the test |
| F item 15 had no tick box | unmeasured | measured both |
| F Type E overflowed with the wrong address | — | items 79/80 are **where the firearm is kept while the application runs**, not the owner's home. Never defaulted |
| `f_id_number` had 17 cells to its siblings' 16 | a 57.3pt spacer read as a character cell | pushed **every ID digit one box early** and the service's own `chars > cells` guard made it *more* false, never firing. Same fix corrected a latent `g_spouse_passport` |
| Association expiry (item 60) blank | no registry field existed at all | the vault had held the date all along in `Credential.expiresOn`; nothing carried it |
| Items 68.1/69.1 "SUBMIT FULL DETAILS" blank | only the X was ever drawn | answered with **"See Annexure F (photographs of the safe)"**, carrying the letter that pack actually assigned |

**Two guards that came out of it and are worth keeping:**

- **A pointer to an annexure that is not in the pack is worse than a blank box.**
  Items 68.1/69.1 write nothing unless the safe photographs were actually uploaded, and
  the applicant is told why. The letter is computed from the pack's own index, never
  hardcoded — it moves with what else was uploaded.
- **Item 60's date comes from the same document that named the association.** A member
  holding a discipline document from each of three bodies is the normal case, and the
  schema says so. A longest-expiry sweep across all of them would print body A's name in
  item 56 beside body B's date in item 60 — two true facts making one false statement.
  Proven by breaking the guard.

### 4b — the owner-type tick, item 1.2

**The bug.** `saps271-map.ts` ticked **`f_owner_type_a` — "A. Private owner" — unconditionally**,
the moment an `input.seller` object existed. The presence of that object was mistaken for the answer
to the form's own question. A dealer purchase would have printed *"private owner"*; so would an
inherited firearm. That is a false statement about who owns the firearm, on a form signed under
**s 120(9)(f)**.

**Why it had not bitten yet.** `renderSaps271` ([motivations.service.ts:4478]) passes `licenceType`,
`answers`, `email`, `motivationReference` and `safeAnnexureLetter` — **and no `seller`**. Section F's
22 boxes are built, tested, and unreachable from the live PDF download. That wiring is B9. So this
was fixed *before* the wiring landed rather than after, which is the only cheap moment.

**What it does now.** The tick comes from the applicant's stated route, **and from nothing else**:

| `firearm_source` | Ticks | Fills the Type A block? |
|---|---|---|
| From a private owner | **A** | yes |
| From a dealer | **B** | **no.** Operator: *"a dealer needs to fill in those"* |
| Inherited from a deceased estate *(stored answers only)* | **E** | no |
| Not decided yet, or unanswered | **none** | no |

**⚠️ Nothing is inferred.** A first attempt let a completed seller consent stand in for an unanswered
route. Operator, 2026-08-28: *"the tich should be either dealer or private. not default to fucking
private. We have a option to select where this firearm is coming from."* That was the same mistake in
a smaller costume — the form asks the question, we ask the question, and answering it from a side
effect of another part of the flow is how "A. Private owner" got printed on everything to begin with.
**Unanswered means unticked**, and the applicant is told which question closes the box.

The tick and the block answer **different questions**: item 1.2 asks what KIND of owner this is, and
the applicant has answered that the moment they pick "private owner" — before anyone has approached
the seller. The block below it asks WHO, and stays blank until he says.

Every fixture in `saps271-section-f.spec.ts` now **states** the route, because the whole suite had
been relying on exactly the implicit default that was wrong.

All five ticks A–E are measured (one printed row, five 19.1pt cells, 95.4pt apart). **C and D are
never ticked by anything** — the platform offers neither route — and are measured only so the day
either is built the geometry is derived from the form rather than guessed at under deadline.

Proven by breaking it five ways (restore the original unconditional tick; fill Type A on every route;
route a dealer to A; and twice re-introduce an inference from holding a seller) — each caught. And proven
on the page: the PDF is rendered and the X located **by its x coordinate**, because all five boxes
are on the same page and a page-level assertion cannot tell them apart.

**The 16 boxes still unwritten, all on purpose:** `f_owner_type_c` and `f_owner_type_d` (above), plus: `g_competency_type_a/b/c` (sections 13,
15 and 16 are possession licences, so only a category-D competency can be what they rest
on), `g_association_no` (an unanswered question is not a "no", and on a section 16 it
would contradict the applicant's own pack), `g_association_far` (the registry asks for
the association's own FAR number nowhere), `h_unfit_date_from`.

### 4c — two routes, and the paper each one wants

`firearm_source` now offers **private / dealer / not decided**. The estate route is **retired, not
deleted**.

**Why the one-line edit was not safe.** Six agents swept this; the naive "just drop it from
`choices`" would have shipped a live bug. `sanitiseAnswers` validates against `choices` on **write**,
and the wizard resends the *whole* answers blob on every autosave — so an existing estate applicant
would have hit, on their very next keystroke in **any** field:

- `logger.error(...REFUSED values... the form and the validator disagree)`, forever, indistinguishable
  from real registry drift;
- a banner reading *"We could not store your answer... please tell support"* — while the value was in
  fact still safe in Postgres (a refusal drops the key rather than blanking it);
- a `<select>` rendering **blank**, because the plain choice renderer had no fallback for an
  unrecognised stored value — inviting them to "re-answer" a question that already had a true answer,
  which would then have ticked **A. Private owner** on an inherited firearm.

So `MotivationField.retiredChoices` was added: **accepted on write, never offered**. Same shape as the
existing `allowOther`/`DISCIPLINE_OTHER` case, same discipline as the retired Prisma enum values.

**The paper each route wants.** Both hang off one row — "Where this firearm is coming from" — and the
row changes with the answer:

| Route | Row shows |
|---|---|
| Private | the seller-consent flow **plus** upload |
| Dealer | upload only — the dealer's invoice or quote |
| Not decided / unanswered | upload only; the guidance describes both |
| Stored estate | upload only; guidance names the executor's letter |

Served as a `DocumentNeed.sellerConsent` flag, **not** tested in the wizard. The frontend hardcodes no
route value anywhere — which is why retiring a whole route cost **zero** client changes — and a
`firearm_source === '...'` test in a component would have been the first crack in that.

### B9 — the current owner's half, collected and printed

**The gap.** 22 section F boxes were mapped and tested and **nothing could reach them**:
`renderSaps271` passed no `seller`, so every rendered form went to a DFO with the current owner's
half blank — while `saps271-coverage.ts` told the applicant *"Piet has signed his half."* The screen
said done; the paper said nothing.

**What the consent form now asks.** Operator, 2026-08-28: *"F should be filled, type A - the consent
form should ask these details along the details of the firearm and with the consent tick and the
information provided is the truth tick."*

- **His details** — residential address and code, cellphone, email, and items 79/80 (where the
  firearm is kept while the application runs). **Every box optional**: a consent link that refused
  because a seller has no landline is a dead link, and the private route dies with it.
- **The firearm** — already asked, confirmed by him off his own card, and already the firearm of record.
- **Two declarations, and never one box.** Item 81 makes two claims — that he proposes to supply the
  firearm once the licence comes through (**consent**), and that the particulars are correct and
  accurate under **s 120(9)(f)** (**truth**). A DFO reads them as two. Neither starts ticked: a
  pre-ticked box is not a declaration. `submit()` refuses without both, **before the signature is even
  looked at**, and writes nothing at all — proven by breaking each gate.

Stored in `sectionFEncrypted`, a column that had existed since the consent-documents migration with
nothing writing it. Read back only from a **COMPLETED** consent, and only rendered when the applicant
also said the route was private — two independent gates, because printing one person's particulars
under another person's declaration is the failure this section can produce.

**Type B stays blank and says so.** *"your dealer completes section F — we tick that the current owner
is a firearm dealer and leave the rest of that section blank for them. Upload their invoice or quote
if you have one; it is not required."*

### Items 79–87 belong to Type E, and are never written

**Settled by the operator, 2026-08-28**, after I read them the other way and put the evidence up:

> *"the declaration is there because of the nature of Type E, because there is no living person the
> license could belong too. Someone has to keep the firearms. If it is Type A, the license will be in
> a living persons name and they will need to have it in a safe at their house of residence according
> to law. So no need to declare you are keeping it safe in Type A's case or Type B as a dealer."*

That reasoning is what the boxes turn on. On a private sale the current owner is a living licence
holder whose own licence already obliges him to keep the firearm in a compliant safe at his residence
— **s 83** and **reg 86** — so item 79 asks him to state a fact the law has already settled. On a
deceased estate there is no such person, and somebody must say where the firearms are and that they
hold them lawfully.

**The consent is not lost by leaving them blank.** It is captured on *our own* signed annexure — his
two declarations, his signature, and both sides of his licence card — which goes into the pack.

Eight boxes stopped being written: `f_firearm_address`, `f_firearm_address_2`,
`f_firearm_postal_code`, `f_owner_name`, `f_owner_id`, `f_designation`, `f_place`,
`f_declaration_date`. Coordinates kept, so the day an estate route is built the geometry is not
re-derived under deadline. The consent form no longer asks where the firearm is kept either.

**Noted for whoever revisits this**, because the contrary evidence is real and should not have to be
rediscovered: Section F's numbering runs 1 → 87 unbroken with no TYPE heading before 79; Type A's own
block ends at item 15 with no declaration; item 81 reads *"…I propose to sell or supply it to the
applicant once the necessary licence(s) has/have been obtained"*; and item 82 is headed *"current
owner/authorized person"*. The operator's reading is the one in force. `saps271-map.ts` has a single
marked block that reverses it.

**Still deferred, on purpose:** owned-firearm rows 7–26 (decision 6 decides the data
shape as well as the coordinates), and the association request (§3.8).

---

## 1. What the design actually changes

The Motivation Centre today asks questions, then asks for documents, then generates a
pack. The design inverts that: **it starts from what the member already holds and only
asks for what is genuinely missing.**

Three ideas carry the whole thing. Everything below exists to serve them.

1. **The pack is the object, not the form.** A living checklist that fills itself, with
   the SAPS 271 completing beside it in a permanently visible right rail.
2. **Every row names who can close it and how.** Not "required" — *"your association
   issues this"*, *"waiting on Piet's phone"*, *"photograph it"*. And every row carries
   where its value came from: **From your vault** / **Read from your upload** / **They
   issue it**.
3. **Two doors, one destination.** **Scan by QR** and **Upload** — and no webcam, on any
   surface (operator, 2026-08-28). Both already land in the same place server-side, as of
   the upload-parity work. Documents already in the Document Centre are not a third door;
   they are simply already there.

The honest framing of the build: **the backend is ~70% there, the frontend is a new
information architecture.** We are not restyling the current wizard. We are re-shelling it
around a checklist that is already computable.

---

## 2. What we already have — reuse, do not rebuild

| The design needs | Already exists | State |
|---|---|---|
| Checklist grouped by importance | `backend/src/motivations/motivation-checklist.ts` → `buildChecklist()`, `buildAnnexures()`, `CERTIFICATION` map | Solid. Needs a richer item shape (§4) |
| Vault → application prefill | `motivations.service.ts` create-time prefill; `motivation-credentials.ts` → `credentialOffer()` | Works. Provenance is thrown away (§4) |
| Profile → application prefill | `motivation-profile.ts` → `profileOffer()`, returns `values` **and** `from` | `from` is already plain-English provenance — it just isn't persisted |
| Kind-agnostic firearm reader | `backend/src/common/firearm-identity.ts` (12 fields), `motivation-extract.service.ts#readFirearm` | Done. Powers the `Capture` artboard as designed |
| Shared field alias table (both centres) | `backend/src/common/document-fields.ts` | Done |
| Upload doors, identical server-side | `licence-centre/upload-limits.ts`, `motivations-scan.controller.ts`, `licence-centre-scan.controller.ts` | Done and verified. **Drop the camera door from the UI** — QR and Upload only |
| Seller does his half on his own phone | `motivation-seller-consent.service.ts` + `motivations-consent.controller.ts` (`invite` / `resolve` / `read-front` / `submit` / `signature`) | Exists. Captures less than the design promises (§3.2) |
| Character-reference wording + requests | `motivation-witness.service.ts`, `motivation-witness-form.ts`, `motivations-witness.controller.ts` | Exists |
| SAPS 271 render | `saps271.service.ts`, `saps271-map.ts`, `saps271-coords.ts` (144 mapped boxes, 12 pages) | Exists. Section F unmapped (§3.1) |
| Counter-only jobs | `CERTIFICATION: Record<AnnexureKind, 'required'|'expected'|'none'>` | Exists. Not surfaced as the design's "six things only you can do" |
| Step rail | `frontend/components/motivation-step-rail.tsx` | Reusable as-is; step *list* changes |
| Tile elevation, white retail skin | `frontend/app/globals.css` — `.gg-tile`, `.gg-tile-lift`, `--elev-1`, `--elev-2` | Done. The mockup's `--elev` **is** `--elev-1` |

---

## 3. The gaps the design opens — measured, not guessed

These are counted from the code, not estimated.

### 3.0 ⚠️ The designed flow has no home for half the form

**This is the biggest finding and it invalidates the five-step rail as drawn.**

The answer registry holds **162 field definitions** in eleven sections. Mapping each
section onto the design's rail — *The firearm → You → Your dedicated status → The seller →
Your pack*:

| Registry section | Fields | Design step | |
|---|---:|---|---|
| The firearm | 16 | 1 · The firearm | ✅ |
| The existing licence | 3 | 1 · The firearm | ✅ |
| About you | 21 | 2 · You | ✅ |
| Your circumstances | 3 | 2 · You | ✅ |
| Your competency | 4 | 2 · You | ✅ |
| Dedicated status | 18 | 3 · Your dedicated status | ✅ |
| Experience | 12 | 3 · Your dedicated status | ✅ |
| **Firearms you already own** | **43** | — | ❌ **no step** |
| **History** | **36** | — | ❌ **no step** |
| **Storage and safety** | **5** | — | ❌ **no step** |
| The SAPS 271 form | 1 | — | the opt-in the design drops |

**85 of 162 fields — 52% — have nowhere to go.** The canvas confirms it: across all four
artboards, "firearms held" appears once (one line inside the 271 preview on `Ready`),
"safe" appears twice (a photograph row and an annexure), and **convictions, pending cases,
lost or stolen firearms, negligence, unfitness and confiscation are not mentioned
anywhere at all.**

The same holds on the form itself. Of the 144 mapped 271 boxes:

- `g_owned_1..6_{type,calibre,make,barrel_serial,frame_serial,licence}` — **36 boxes**
- `h_*` — the six history questions — **36 boxes**
- `safe_*` — **10 boxes**
- `g_association_{yes,no,name,far,number,joined,expiry}` — **7 boxes**

That is **89 of 144 boxes — 62% of the form — that the designed flow never asks about.**

The design is an excellent *document-gathering* model. It is an incomplete *application*
model: it designed the attachments and left out the form's own questions.

#### 3.0a Firearms already owned — the plumbing is built, only the screen is missing

Good news: the chain already works end to end.

```
vault FIREARM_LICENCE  →  existing_firearm_{n}_*  →  g_owned_{n}_*  →  printed
   (document-fields.ts)      (credentialOffer)        (saps271-map.ts)
```

`credentialOffer()` already allocates rows 1–6, already de-duplicates on licence number,
barrel serial and frame serial, already refuses to treat a serial reading `NONE` as an
identifier, and already reports *"the form has room for 6 firearms and they are all
filled"* when it runs out. **Auto-add works today. Nothing renders it.**

So this is a UI gap, not a data gap — which is the cheapest kind to close.

> ⚠️ **And it is not only a 271 field.** From the registry's own comment:
> `motivation-overlap.ts` reads the calibre, make and type off these rows and its verdict
> goes straight into the writer's prompt. *"Does this applicant already hold something that
> does this job"* is the objection that gets a second medium-game rifle refused. These
> fields were marked `formOnly` once; the whole section then vanished on the dealer path,
> the overlap note came out empty, and the quality gate marked the document down for that
> very gap — **seen live on MO000017.**
>
> Leaving owned firearms out of the flow does not just blank 36 boxes. It removes the
> input to the strongest counter-argument the motivation makes.

**Work:** an `OwnedFirearms` block on step 2, rows collapsed to make + calibre as you
asked, expanding to type, barrel serial, frame/receiver serial, licence number and what
it is used for. Vault licences pre-populate it with a **From your vault** chip; **Add
another** opens an empty row with the same two capture doors.

#### 3.0b The table is 26 rows. We map 6.

Measured off `backend/assets/saps271-blank.pdf` with the same pdfjs geometry the coordinate
map was derived from:

| | Rows | Row pitch | Headed? |
|---|---:|---|---|
| Page 5, under the `2.1` headings | **14** | 18.1 pt | yes |
| Page 6, top band | **12** | 18.1 pt | **no — the columns continue unlabelled** |
| | **26** | | |

The page-6 band carries the **identical seven column rules** — x = 45.2, 120.8, 197.4,
274.9, 370.3, 463.9, 560.3 — to the tenth of a point, at the same pitch, with no text of
any kind in it. It sits between item 2 (the firearms table, page 5) and item 3 (natural
person's details, page 6), so it can only be item 2 continued.

The registry comment saying *"the form has fourteen"* counted page 5 and stopped at the
page break. **We map 6 of 26 — 23%.**

Extending the map is cheap: the geometry is already derived, the pitch is constant, and
both bands are known. 26 rows × 6 columns = **156 owned boxes**, which takes the mapped
total from 144 to **264**.

> ⚠️ **But do not extend the flat key scheme to match.** `existing_firearm_{n}_*` is seven
> keys per row. At 26 rows that is **182 registry fields for this one section**, in a
> registry that holds 162 fields in total — plus 182 provenance entries, and a screen that
> must not render twenty-six empty rows.
>
> Owned firearms should be stored as a **list**, rendered as *the rows you have, plus Add
> another*, and flattened to `existing_firearm_{n}_*` only at 271-render time. That keeps
> the 271 map, `motivation-overlap.ts` and `credentialOffer()`'s de-duplication working
> unchanged — they all read the flat keys — while the member sees a list that grows.

See §10 for the decision.

### 3.0c The wizard, and what it changed

The design is now a **ten-step wizard** rather than a single pack screen. Two rules produced
the order: *what unlocks a lookup goes early*, *what nothing can help with goes late*.

> **Section → firearm → seller → competency → what you own → about you → dedicated status
> → storage → declarations → pack**

Three placements are load-bearing:

- **The section is chosen first**, so every later step can be checked against it (§3.11).
- **The firearm is second**, so we know which competency to pull and which endorsement to
  ask the association for.
- **The seller is third**, so his half runs in the background instead of at the end.

Also settled by the design:

- **Two capture doors only — "Open the scanner on your phone" (QR) and "Upload".** No
  webcam anywhere, on any surface. Remove the camera door from the earlier capture design.
- **The 271 panel is per-section percentages, not a box grid**, and it appears on every
  step. Critically it counts **only the boxes that apply to you**: six "no" answers close
  24 follow-up boxes, so section H is 12 boxes, not 36; 23 unused owned-firearm rows are
  not "unfilled". Counting all boxes would peg an honest applicant near 40% forever.

### 3.9 The seller needs an email address and a cell number, and a real upload screen

Today `MotivationSellerConsent` reaches him by SMS only, and the flow is a fixed four-step
march with no file list and no way back.

**What it becomes:**

| | |
|---|---|
| Contact | Capture **both** email and cell at step 3. Email carries the link (better for attachments and for a desktop); SMS is the nudge |
| Doors | **Scan by QR** and **Upload** — the same two as everywhere else, same server path |
| Upload timing | **Each file transmits the moment it is captured or chosen.** Not batched, not held until submit — a seller who closes the tab has still delivered what he already sent |
| What he sees | A live list of everything he has sent: thumbnail or filename, what we read it as, when it arrived |
| Delete | **A delete control on every row.** He photographed the wrong card, or a blurred one — he removes it himself rather than sending a second and leaving us to guess which is current |
| Certification | If he sends a **licence and ID already certified**, that is what goes in the pack (§3.10) |

**Work:** two new columns on `MotivationSellerConsent` (email, and a per-file audit),
per-file `DELETE` on the consent controller scoped to his token, and a rework of the
consent page from a linear wizard into a checklist with a file list. The delete must be
soft — the row stays, the bytes go — so the audit trail survives.

> ⚠️ **His delete is his, and only within his own consent.** The token scopes it. The
> applicant must never be able to delete the seller's documents, and vice versa.

### 3.10 Certified copies: what the sources actually say

The operator's rule is that a **licence and ID certified within the last three months** are
accepted by the DFO, so no physical originals need to be handed over — the pack prints them
anyway.

Two things must be said separately here, because the plan cites law elsewhere and this part
is not law:

- **What the Regulations say.** `regulation 13(4)(b)` requires a certified copy of the ID
  page showing photo and particulars, and ties it to `regulation 13(4)(a)` — the
  application is submitted **by the applicant in person** to the DFO.
  `regulation 13(3)` requires the form to be completed **in black ink, personally**. Those
  three counter jobs are statutory and stay.
- **The three-month currency is not in the bundled Act or Regulations.** Neither instrument
  states how recent a certification must be.

**Settled, operator 2026-08-28: three months is the house rule, not a DFO's.** *"Some DFOs
care some don't, so we make it a soft requirement, not a blocker."*

That answers the question and it decides the shape. **Three states, and only one of them is
a real gap:**

| What we hold | Treatment |
|---|---|
| **Certified, inside the window** | ✅ Green. Counter job drops off |
| **Certified, older than the window** | 💬 **Soft nudge only.** Not a gap, does not block, does not mark the pack incomplete, does not appear in the missing list. One line of advice and the applicant moves on |
| **A plain photograph, never certified** | ⚠️ **A real gap, and a statutory one** — `regulation 13(4)(b)` requires a certified copy. The counter job stands |

The distinction between the last two is the whole point and must not be collapsed. One is
our preference; the other is the Regulations.

**Rules for the build:**

- **The window is one configurable value with a date and an owner.** It changes without a
  deploy. It is not a constant and it is not a citation.
- **The copy says whose rule it is.** *"Certified 5 months ago. We suggest under 3 months —
  some offices ask for fresher, many do not."* Never *"SAPS requires"*, because that would
  be false.
- **It never gates anything.** Not Continue, not the pack percentage, not the missing-field
  list. A soft requirement that quietly blocks is just a blocker with better manners.
- **Never mark a plain photograph as certified**, whatever its date.
- If it later turns out to differ by office, the value becomes per-office. It is a single
  value today because you said so, not because the model cannot hold more.

### 3.11 The section is chosen first — which makes warnings possible

Choosing the section up front lets us check two different things the moment the firearm is
read, instead of at the counter. Both are **warnings, never blocks** (see §6, and the
version note there).

### 3.1 Section F of the SAPS 271 has zero mapped boxes

`SAPS271_COORDS` holds **144 fields**: D = 5, E = 11, G = 82, H = 36, safe = 10.
**F = 0.**

Section F is *particulars of the current owner*. It is the entire value proposition of the
`Seller` artboard — "the part an applicant most often gets sent back for, comes back
done." Right now we could collect every answer from the seller and still have nowhere on
the form to print it.

**And I now know exactly where it lives.** Reading the blank form's own geometry:

| Page | What is on it |
|---:|---|
| 3 | Section F, owner **type A** (private owner) and **type B** — nothing mapped |
| 4 | Section F, owner **type C** (companies, boxes 41–58) and **type D** (imported firearms, from box 59) — nothing mapped |
| 5, top | Section F **boxes 79–87** — the declaration block. Nothing mapped |
| 5, from y 546 | **G** begins · competency 1.1–1.7, then the firearms table from item 2 |
| 6 | Firearms table continues unheaded (§3.0b), then item 3 — natural person's details |
| 7 | Spouse, association particulars, motivation reference |
| 8 | **H** — the six history questions |
| 9 | Safe |

The declaration block at the top of page 5, verbatim from the form:

```
79  Physical address where firearm(s) is kept          84  Designation
80  Postal Code                                        85  Date
81  DECLARATION BY PERSON WHO IS LAWFULLY IN           86  Place
    POSSESSION OF THE FIREARM(S)                       87  Signature of current owner
82  Name and surname of current owner/authorized           /authorized person
    person
83  Identification number of current owner
    /authorized person
```

Box 81 carries the sentence the seller is signing:

> *"I hereby declare that the above firearm(s) is/are legally in my possession and that I
> propose to sell or supply it to the applicant once the necessary licence(s) has/have been
> obtained… I am aware that it is an offence in terms of section 120(9)(f) of the Firearms
> Control Act, 2000 to make a false statement in this application."*

That wording should appear on the seller's phone screen **before** he signs, not only on the
printed page. He is making a criminal-liability declaration; the design's four-step phone
flow currently says "Sign the declaration" without showing him what it says.

**Work:** re-run `backend/scripts/saps271-measure.mjs` against
`backend/assets/saps271-blank.pdf`. It derives coordinates from the form's own ruling
lines rather than from eyeballing — that is how the existing 144 were produced, and it
regenerates the whole map, so B7 and B8 are one job, not two. Then bind the new `f_*`
fields in `saps271-map.ts`.

> ⚠️ The measure script's header records why the fill path is what it is: the form has
> **zero AcroForm fields** across its 12 flat pages, and the operator's fillable template
> shares field names across widgets (205 fields over 1,136 widgets), so setting one value
> paints it into up to twelve boxes on different pages. Everything is drawn at absolute
> coordinates. Do not "improve" this into a form-fill.

### 3.2 The seller flow collects less than Section F needs

`ConsentAnswers` is `{ fullName, idNumber }` plus a `FirearmSnapshot`. Section F wants
address, contact number, type-of-owner, where the firearm is currently kept, and a signed
declaration — and the `Ready` artboard promises his ID and licence are *attached behind
it* as annexures.

**Work:** extend the consent submission to capture those, store his licence card and ID as
upload rows on the application (kind `SELLER_LICENCE`, and a seller-ID kind), and feed
them into the new Section F map.

Also: the mockup SMS says the link **expires in 24 hours**; `CONSENT_TOKEN_TTL_MS` is
**48**. Pick one and make both agree (see §10).

### 3.3 Four firearm fields we now capture have nowhere to print

Section E maps `e_make`, `e_model`, `e_calibre`, `e_frame_serial`, `e_receiver_serial`
plus type/action ticks. The kind-agnostic reader captures twelve. **`barrel_serial`,
`barrel_make`, `frame_make` and `receiver_make` are captured and unmapped** — and the
`Ready` artboard prints all three serial rows *with their own makes*, which is exactly
what a real licence card carries.

**Work:** map those four boxes in Section E.

### 3.4 Nothing persists where a value came from

`profileOffer()` returns a `from` map. `credentialOffer()` returns `items[].from` and
`credentialId`. Both are **transient** — the offer is applied into the encrypted answers
blob and the origin is discarded.

The design cannot be built without it. The provenance chips, the "we filled 23 things
before you typed anything" banner, and "everything is editable" all read from it. This is
the one real architectural change and it gets its own section (§4).

### 3.5 `ChecklistItem` is too thin

`owner: 'us' | 'applicant'` — two values. The design needs, per row: a state (done /
waiting-on-someone / not started), a source chip, a plain-English "who closes this and
how", and the capture routes offered when the row expands.

### 3.6 The design's headline Essential row has no enum home

*"Chairperson's sworn statement of dedicated status"* — the document that defines a
Section 16 application. `MotivationUploadKind` has 23 values and none of them is it; the
nearest are `GOOD_STANDING_LETTER` and `ASSOCIATION_ENDORSEMENT`, which are different
papers. `CredentialKind` has `DEDICATED_STATUS`, which is the status, not the sworn
statement.

**Work:** decide (§10) whether this is a new kind on both enums or folds into
`GOOD_STANDING_LETTER`. It must not be silently mapped to the wrong one — a DFO reading
the pack can tell them apart.

### 3.7 The frontend is two monoliths

- `frontend/app/motivations/[id]/page.tsx` — **3,864 lines**
- `frontend/app/licence-centre/page.tsx` — **3,045 lines**

The design is a different IA, not a different skin. Extracting components out of these as
we go is part of the work, not a cleanup afterwards.

### 3.8 "Request it from SA Hunters" does not exist

The primary action on the design's most important row. There is no outbound
association-request capability anywhere in the codebase.

**Work:** scope it honestly (§10). The cheap, real version is a pre-written request the
member sends themselves — draft the wording, name the association, give them a
mail/WhatsApp handoff and a "mark as requested" state. The expensive version is an
integration no association currently offers us.

---

## 4. The spine: provenance becomes a persisted, first-class thing

**This is the change that makes the design possible. Build it first.**

Today an answer is a string in an encrypted blob. After this, every answer also carries a
short record of *where it came from* and *when*.

```ts
// backend/src/common/answer-provenance.ts   (new)

export type ProvenanceSource =
  | 'PROFILE'        // "From your profile"
  | 'VAULT'          // "From your vault"      — carries credentialId
  | 'READ'           // "Read from your upload" — carries uploadId
  | 'SELLER'         // "From the seller"       — carries consentId
  | 'ASSOCIATION'    // "Synced from your association profile"
  | 'MEMBER';        // typed or corrected by hand — always wins

export interface AnswerProvenance {
  source: ProvenanceSource;
  /** credentialId | uploadId | consentId — whichever applies. */
  sourceId?: string;
  /** The member's own words for the source: "My .308 licence". */
  from: string;
  at: string;        // ISO
  /** Only for READ: was this split/inferred rather than read verbatim? */
  inferred?: boolean;
}
```

Rules, and they matter:

- **`MEMBER` always wins.** The moment a member edits a field, provenance flips to
  `MEMBER` and no automatic pass may overwrite it. This is the same discipline as
  [never move a field while someone is typing].
- **Provenance is metadata, not content.** It holds a source name and an id — never a
  value, never an ID number. So it can live **unencrypted** in its own column, which is
  what lets the banner count "23 things" and the chips render without decrypting the
  answers blob on every paint.
- **It is written by the same code paths that already build the offers** — `profileOffer`,
  `credentialOffer`, `readFirearm`, the consent submit. Each already knows its own source;
  today it just drops it on the floor.
- **`inferred: true` is the `Capture` artboard's amber tag.** "Action: Manual — *split
  from 'manually operated rifle' — check*". One field that needs a human, marked, not
  buried.

---

## 5. Data model

```prisma
model Motivation {
  // ...
  /// Field key → AnswerProvenance. NOT encrypted, deliberately: it holds a
  /// source name and a row id, never a value. That is what lets the pack
  /// screen render "From your vault" chips and the prefill count without
  /// decrypting answersEncrypted on every read.
  answerProvenance Json?
}

model MotivationUpload {
  // ...
  /// Who supplied it. 'MEMBER' | 'SELLER' | 'REFEREE' — a seller's licence
  /// card is on the application but was never the applicant's to hold.
  suppliedBy String @default("MEMBER") @db.VarChar(16)
}

model MotivationSellerConsent {
  // ...
  /// Section F answers beyond name and ID: address, contact, where the
  /// firearm is kept, type of owner. Encrypted — this is his personal
  /// information, on our system, for one purpose.
  sectionFEncrypted String? @db.Text
}
```

Plus, pending §10: a new value on `MotivationUploadKind` and `CredentialKind` for the
chairperson's sworn statement.

**Migration note:** existing drafts get `answerProvenance = null`, which must render as
"no chip" and count zero — not as an error and not as "typed by you". A null is *unknown*,
not *manual*.

---

## 6. Backend work

| # | Work | Files | Notes |
|---|---|---|---|
| B1 | `AnswerProvenance` type + helpers | `common/answer-provenance.ts` *(new)* | Pure, unit-testable. Start here |
| B2 | Persist provenance on every prefill path | `motivations.service.ts`, `motivation-profile.ts`, `motivation-credentials.ts` | The offers already carry `from`; stop discarding it |
| B3 | Flip to `MEMBER` on edit | `motivations.service.ts#updateAnswers` | Must be impossible to skip — test it |
| B4 | Richer `ChecklistItem` | `motivation-checklist.ts` | Add `state`, `source`, `closedBy`, `routes[]`. Keep `key` stable |
| B5 | `GET :id/pack` — one payload for the whole left column | `motivations.controller.ts` | Checklist + provenance + counts in one call. The current screen makes several |
| B6 | 271 box-coverage summary | `saps271-map.ts` → `saps271Coverage()` | Returns per-section `{filled, waiting, byHand}` over the **real 144**, never a hard-coded 61 |
| B7 | Map Section F | `scripts/saps271-measure.mjs`, `saps271-map.ts` | §3.1. Re-run the measure script — it regenerates the whole map from the form's ruling lines |
| B8 | Map the four missing E boxes, and owned rows 7–26 | same | §3.3, §3.0b. **Same script run as B7** — one job |
| B8b | Owned firearms become a list, flattened at render | `motivation-fields.ts`, new list type, `saps271-map.ts` | §3.0b. 26 × 7 flat keys would swamp a 162-field registry |
| B9 | Extend seller consent to full Section F | `motivation-seller-consent.service.ts`, `motivations-consent.controller.ts` | §3.2 + store his card and ID as uploads with `suppliedBy: 'SELLER'` |
| B10 | Counter-jobs list endpoint | `motivation-checklist.ts` | Derive from `CERTIFICATION` + fixed six. Never hard-code the list in the UI |
| B11 | Association request | new, small | §3.8 — scope per §10 |
| B12 | Seller email + immediate per-file upload + per-file delete | `motivation-seller-consent.service.ts`, `motivations-consent.controller.ts` | §3.9. Delete is soft and token-scoped |
| B13 | Section eligibility + holding-limit warnings | new `licence-eligibility.ts` | Below. Pure function over (section, firearm, vault) → warnings |
| B14 | Certification currency | `motivation-checklist.ts` | §3.10. Operator policy value, not a constant |

### Section eligibility and holding limits — what the Act actually says

*Firearms Control Act 60 of 2000, as assented to 4 April 2001. Read from the text, not
recalled. **See the version note at the end of this block — it matters here more than
anywhere else in this document.***

**Two independent checks.** They fail for different reasons and should read differently.

#### Check 1 — can this firearm be licensed under this section at all?

| Section | What may be licensed |
|---|---|
| **13** self-defence | Shotgun that is **not fully or semi-automatic**; handgun that is not fully automatic — `s 13(1)`. **A rifle cannot be licensed under s 13 at all** |
| **14** restricted, self-defence | Semi-automatic rifle or shotgun not readily convertible to fully automatic, or anything the Minister declares restricted — `s 14(1)`. Requires showing a `s 13(1)` firearm gives insufficient protection — `s 14(4)` |
| **15** occasional hunting / sport | Handgun not fully automatic; rifle or shotgun **not fully or semi-automatic**; a barrel, frame or receiver of those — and **not a restricted firearm** — `s 15(1)` |
| **16** dedicated hunter / sport | Handgun not fully automatic; rifle or shotgun not fully automatic; **semi-automatic shotgun made to fire no more than five shots** without reloading; or a barrel, frame or receiver — `s 16(1)` |

This is the more valuable check of the two, because it catches an application that can
never succeed. We read the firearm's type and action at step 2; the section is already
known from step 1. A semi-automatic rifle under s 15 is a dead application, and we can say
so in the same second we read the card.

#### Check 2 — how many may they already hold?

| Section | Limit |
|---|---|
| **13** | **One licence.** *"No person may hold more than one licence issued in terms of this section"* — `s 13(3)` |
| **14** | **One licence** — `s 14(5)` |
| **15** | **Four** — `s 15(3)(a)`; **but three** if the person also holds a s 13 licence — `s 15(3)(b)`; **at most one handgun** — `s 15(3)(c)`; and the allowance is **reduced by every s 12 additional licence** held in respect of a s 15 or s 13 firearm — `s 15(3)(d)` |
| **16** | **No numerical cap in the section.** It requires instead a sworn statement or solemn declaration from the chairperson of an accredited association stating the applicant is a registered member — `s 16(2)` |

`s 12(1)` additional licences are the awkward part: the Registrar may issue one to every
person residing on the same premises as the holder, and `s 15(3)(d)` counts them against
the applicant's own allowance. We will not reliably know about them.

**So the operator's two examples land like this:**

- *Already holds a s 13 handgun, applying under s 13* → **strong warning.** `s 13(3)` is
  unambiguous, and this application cannot be granted as it stands.
- *Already holds a s 13 licence and is applying under s 15* → **warning**, and a useful
  one: `s 15(3)(b)` drops the s 15 allowance from four to three, which people do not know.
- *Four s 15 licences already* → **warning at the cap**, plus the constructive route:
  `s 16` has no numerical cap, but it needs dedicated status and the chairperson's
  statement. That is the whole reason the sections differ, and it is the most useful thing
  the screen can say.

#### How the warnings must behave

- **Warn, explain, cite, and let them continue.** Never block. Three reasons: our count
  comes from their Document Centre and may be incomplete; `s 12` additional licences are
  invisible to us; and the Registrar has discretion.
- **Quote the provision.** *"No person may hold more than one licence issued in terms of
  this section — s 13(3)"* is worth more than "limit reached", and it is checkable.
- **Say where our number came from.** *"You hold 4 licences under section 15 — counted
  from your Document Centre. If you hold others we have not seen, add them at step 5."*
- **Never assert the outcome.** Not "this will be refused" — *"as we read the Act, this
  application cannot be granted while you hold the first one."*

> ⚠️ **Version note, and it is the important one.** The bundled Act is the text **as
> assented to on 4 April 2001**, before the Firearms Control Amendment Acts of 2003 and
> 2006, and `s 13–16` categories and numerical caps are on the reference's own list of
> **most amendment-sensitive** provisions. Do **not** hard-code these numbers. Put them in
> one table with a source citation and an "as at" date per rule, confirm them against the
> consolidated current Act before this ships, and make them changeable without a deploy.
> A confident wrong limit is worse than no limit.

**Not legal advice, and it must not read as such on screen.** This is a warning that
prompts the applicant to check, not a determination.

**Test posture:** B1–B6 are pure functions or thin service methods and should land with
specs alongside, in the style of the existing `*.spec.ts` files. B7/B8 are coordinate data
— verify by rendering a filled 271 and looking at it, not by unit test.

---

## 7. Frontend handoff spec

### 7.1 Routes

| Route | Artboard | Status |
|---|---|---|
| `/licence-services/[id]` | `Main` | **New shell.** Replaces the body of `motivations/[id]` |
| `/licence-services/[id]/capture` | `Capture` | New. Modal on desktop, full page on mobile |
| `/s/[token]` | `Seller` | Extend the existing consent page |
| `/licence-services/[id]/ready` | `Ready` | New. Step 5 |

Keep `/motivations/[id]` working and redirecting until the new shell is complete. Do not
break a draft mid-flight.

### 7.2 Tokens — all of these already exist in `globals.css`

The mockups were authored from the live tokens, so there is nothing new to define. Use the
variable, never the hex.

| Token | Value | Used for |
|---|---|---|
| `--bg` / `--bg-card` | `#FFFFFF` | Page and card ground |
| `--bg-inset` | `#F4F2EC` | Meter track, empty 271 boxes, source document panel |
| `--border` | `#DDD8CC` | Card and row borders |
| `--border-hover` | `#D5CFC2` | Row hover border |
| `--border-divider` | `#EDEAE1` | Inside-card rules |
| `--red` | `#C8102E` | Primary buttons, active step dot, selected row border |
| `--ink` / `--ink-2` / `--ink-3` | `#1A1613` / `#4A443C` / `#7A7267` | Heading / body / secondary |
| `--gold` `--gold-strong` `--gold-line` `--gold-wash` | — | **Waiting on someone.** Never red — a row waiting on a third party is not an error |
| `--success` | `#1F7A50` | Done rows, filled 271 boxes, the prefill banner |
| `--r-sm` / `--r-md` / `--r-lg` | 6 / 8 / 12px | Buttons / cards / panels |
| `--elev-1` / `--elev-2` | — | Via `.gg-tile` / `.gg-tile-lift` only |
| `--ease-out` `--dur-fast` | `cubic-bezier(.22,1,.36,1)` / 200ms | All transitions |

Two additions are needed, both derived from `--success`, matching the existing
`--gold-wash` / `--gold-line` pattern:

```css
--success-wash: rgba(31,122,80,.08);
--success-line: rgba(31,122,80,.35);
```

> ⚠️ `* { box-shadow: none !important }` is still global. Every card and row in these
> screens gets its elevation from the `.gg-tile` class, never from an inline or utility
> shadow. This is why the mockups look right and a naive port will look flat.

### 7.3 Components

| Component | Props | Notes |
|---|---|---|
| `PackRow` | `item: ChecklistItem`, `expanded`, `onToggle` | The core unit. `gg-tile gg-tile-lift`, 13px/15px padding, 8px gap between rows |
| `ProvenanceChip` | `source: ProvenanceSource` | Pill, 11px/600. vault → `--bg-inset`; read → red at 8% ; them → `--gold-wash` |
| `PackGroup` | `title`, `children` | Eyebrow: 11px, `.11em` tracking, uppercase, `--ink-3` |
| `CaptureRoutes` | `routes[]`, `onPick` | The four doors. First is primary (`--red` fill) |
| `Saps271Meter` | `coverage` | Sticky right rail. Progress bar + 12-column box grid + per-section table |
| `PrefillBanner` | `count`, `sources[]` | `--success-wash` / `--success-line`. **Count is computed** |
| `CounterJobsCard` | `jobs[]` | Gold card. The six things only the member can do |
| `SellerPhoneFlow` | — | Extends the existing consent page |
| `ReadResult` | `fields[]` | Per-field value + confidence tag + inline edit pen |
| `OwnedFirearms` | `rows[]`, `onAdd`, `max` | §3.0a. Collapsed row = make + calibre; expands to the seven registry fields. Vault rows carry a **From your vault** chip. **Add another** opens an empty row with the four capture doors |
| `DeclarationQuestions` | `questions[]` | The six history questions. Yes/no, and a "yes" reveals station, case number, charge, outcome. Applicant-only — no chip, no prefill, ever |
| `SafeDetails` | `answers` | The 10 `safe_*` boxes, alongside the photograph row that already exists |
| `SectionPicker` | `sections[]`, `held` | Step 1. Shows what each section may cover and what the member already holds under it, before they choose |
| `EligibilityWarning` | `warnings[]` | Amber, never red, never blocking. Quotes the provision and says where our count came from (§6) |
| `SellerFileList` | `files[]`, `onDelete` | The seller's own screen — every file he has sent, what we read it as, a delete on each row (§3.9) |

Reuse `motivation-step-rail.tsx`. **The rail is ten steps** (§3.0c) — the wizard mockup is
the reference:

> *Section → The firearm → The seller → Competency → What you own → About you →
> Dedicated status → Storage → Declarations → Your pack*

**Section first**, because every later check depends on it and because it is the one
question the applicant already knows the answer to. **The firearm second**, so we can pull
the right competency and ask the association for an endorsement that names it — and so the
eligibility check can fire immediately. **The seller third**, so his half runs while the
applicant carries on. **Declarations ninth**, because nothing can help with them and
meeting six questions about convictions on screen one makes an application feel like a
charge sheet.

### 7.4 States and interactions

| Element | State | Behaviour |
|---|---|---|
| `PackRow` | default | White, `--border`, `--elev-1` |
| | done | `--success-wash` ground, `--success-line` border, filled green tick |
| | waiting | `--gold-wash` ground, `--gold-line` border, gold `!` |
| | todo | White, `--border`, hollow `○` in `--ink-3` |
| | hover | `--border-hover`, `translateY(-1px)`, `--elev-2`. **Desktop pointers only** |
| | focus | 2px `--red` outline, 2px offset. Never removed |
| | expanded | Rule in `--border-divider`, then the explanation and capture routes |
| `CaptureRoutes` button | primary | `--red` fill, white ink |
| | hover | Border and ink → `--red` |
| | busy | Disabled, spinner, label → "Reading…" |
| `ProvenanceChip` | — | Non-interactive. `title` gives the full source name |
| `Saps271Meter` | filling | Bar width transitions 800ms `--ease-out` |
| `PrefillBanner` | zero | **Do not render.** "We filled 0 things" is worse than silence |
| Read result field | inferred | Amber tag naming what was inferred, and from what |
| | unread | Italic `--ink-3` placeholder, never a guessed value |

### 7.5 Responsive

| Breakpoint | Behaviour |
|---|---|
| ≥ 1200px | Two columns, `1fr 400px`. Right rail `position: sticky; top: 20px` |
| 768–1199px | Single column. 271 meter collapses to a summary bar pinned under the step rail; tap opens it as a sheet |
| < 768px | Single column, 16px page padding. Step rail keeps its dots and drops labels (already the rail's behaviour). Capture routes stack full-width. **Camera is the first door on mobile** |

### 7.6 Motion

Deliberately restrained — this is a functional, information-dense screen, and the house
budget is 150–300ms.

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| `PackRow` | hover | `translateY(-1px)` + `--elev-1` → `--elev-2` | 200ms | `--ease-out` |
| `PackRow` | expand | height + opacity | 200ms | `--ease-out` |
| 271 progress bar | coverage change | `width` | 800ms | `--ease-out` |
| 271 box | fills | `background-color` | 500ms | `ease` |
| `PrefillBanner` | first paint after prefill | fade + 4px rise | 300ms | `--ease-out` |
| Read result rows | reveal | 40ms stagger, max 8 rows | 200ms each | `--ease-out` |

The mockup's `fill()` sweep — boxes turning green one after another — is the one
**earned** flourish: it happens once, on an explicit click, on a rare screen, and it is
explanatory rather than decorative. Keep it. Everything else stays under 300ms.

`prefers-reduced-motion`: transforms and staggers drop to opacity-only; the 271 bar jumps
to its final width. Gentler, not zero.

### 7.7 Content rules and edge cases

- **Never print a number the design hard-codes.** "23 things", "38 of 61", "11 hunts" are
  mockup values. All three are computed. The 271 denominator is the real mapped count,
  currently **144**, and it changes the moment Section F lands.
- **Mask identity numbers on screen.** The `Main` artboard shows a full ID; the `Ready`
  artboard shows `7204••••••••`. **The masked form is the rule** — full value only in the
  edit field the member opened, and in the printed pack.
- **Never a bare "required".** Every incomplete row states who closes it and how. If we
  cannot say who, the row is not ready to ship.
- **Empty pack** (new application, empty vault): the banner does not render; every row is
  todo; the hero copy changes to *"Nothing in your vault yet — start with the firearm."*
  The screen must not look broken when it is simply new.
- **Long values** (association names, addresses): one line, ellipsis, full value in
  `title` and on expand. Rows must not reflow.
- **Reading fails:** fail-soft, as established. The attachment is kept, the autofill is
  lost, the row says so and offers manual entry. *An unreadable blob costs the autofill,
  not the attachment.*
- **Seller declines or the link expires:** the row goes gold with "Piet declined — you can
  ask him again or upload his licence copy yourself", never red, never a dead end.
- **Show the seller box 81 before he signs.** The design's phone flow says "Sign the
  declaration" and shows him nothing. He is declaring the firearm is lawfully his and that
  a false statement is an offence under s 120(9)(f) of the Firearms Control Act — put the
  wording on the screen above the signature pad, not only on the printed page (§3.1).

### 7.8 Accessibility

- Focus order follows the visual order: step rail → banner → each group's rows in order →
  right rail → primary action.
- `PackRow` is a `<button>` with `aria-expanded`; the expansion is the button's controlled
  region via `aria-controls`.
- Row state is announced, not just coloured: the accessible name ends with "— done",
  "— waiting on the seller", "— not started". **Colour is never the only indicator** —
  every state also has its own glyph (`✓` / `!` / `○`).
- The 271 grid is decorative and `aria-hidden`; the real information is the adjacent
  per-section table, which is a real `<table>` with row headers.
- Live region on the prefill banner and on the 271 counter, `aria-live="polite"`, so a
  screen-reader user hears "41 of 144 boxes filled" when a document lands.
- Every capture route button has a text label, not an icon alone.
- Minimum 44×44px touch targets on all four capture doors.

---

## 8. Phases

Each phase is independently shippable and independently verifiable. Nothing here needs a
big-bang cutover.

**Phase 1 — Provenance spine** (B1–B3, +migration)
No visible change. Every prefill starts recording where it came from; member edits flip to
`MEMBER`. Verify by reading `answerProvenance` on a fresh application.

**Phase 2 — The pack screen** (B4, B5, `Main` artboard)
The new left column at `/licence-services/[id]`, behind a flag. Rows, groups, chips,
prefill banner, expandable capture routes. The old wizard still works.

**Phase 2b — The two missing steps** (§3.0)
`OwnedFirearms`, `DeclarationQuestions`, `SafeDetails`, and the rail goes to seven steps.
Owned firearms is mostly rendering work — `credentialOffer()` already fills the rows. The
declarations are new UI over fields that already exist. **Do not ship Phase 2 without
this**; a pack screen that never asks about convictions looks finished and is not.

**Phase 3 — The live 271** (B6, right rail)
Coverage summary over the real 144 boxes, the meter, the per-section table, the fill
animation. This is where the design starts to feel like the mockup.

**Phase 4 — Section F and the seller's half** (B7, B8, B9, `Seller` artboard)
The biggest genuine win and the biggest new work. Map Section F, extend the consent
capture, attach his card and ID as annexures. Verify by printing a real pack.

**Phase 5 — Capture screen** (`Capture` artboard)
Four doors, the read result with confidence tags, the "we took nothing about the person"
panel. Mostly a re-shell of capabilities that already exist.

**Phase 6 — Ready** (B10, `Ready` artboard)
The printed pack list, the six counter jobs, the 271 preview, the dealer swap-pages
option.

**Phase 7 — Association request** (B11)
Scope-dependent. Can ship any time after Phase 2.

---

## 9. Deviations from the mockup we should make on purpose

1. **No emoji as icons.** The mockups use 📷 📱 ⬆️ 🗄️ ⚖️ as placeholders. Ship SVG
   icons from the site's existing set. House rule, and emoji render differently on every
   platform.
2. **Mask the ID number** on the pack screen (§7.7).
3. **Gold ink on gold wash** — `--gold-strong` on `--gold-wash` is thin. Check it measures
   4.5:1 before shipping the "They issue it" chip; darken the ink, not the wash, if not.
4. **The 271 denominator is 144, not 61.** The mockup's grid was drawn for the picture. A
   12-column grid of 144 cells is 12 rows and reads fine.
5. **`--elev` in the mockups is `--elev-1`** — do not redefine it, use `.gg-tile`.
6. **Seller link TTL** — the mockup says 24h, the code says 48h. §10.

---

## 10. Decisions I need from you

| # | Question | Why it blocks |
|---|---|---|
| 1 | **The 271 opt-in.** The design drops the "would you like the form filled?" question and just fills it. You previously said keep the option. Keep the toggle, or make it always-on as designed? | Changes whether `formOnly` fields stay gated |
| 2 | **Chairperson's sworn statement** — new enum value on both `MotivationUploadKind` and `CredentialKind`, or fold into `GOOD_STANDING_LETTER`? | §3.6. Wrong choice mislabels a document in a pack a DFO reads |
| 3 | **"Request it from SA Hunters"** — pre-written request the member sends themselves (cheap, real, ~half a day), or something more? No association offers us an integration today | §3.8 |
| 4 | **Seller link TTL** — 24h or 48h? | One line either way, but the SMS copy and the code must agree |
| 5 | **Section F measurement** — I can map the coordinates from the SAPS 271 PDF already in the repo, but a filled test print needs your eyes before it goes near a DFO | Phase 4 gate |
| 6 | **Owned-firearm rows.** Measured: the table is **26 rows** — 14 headed on page 5, 12 unheaded at the top of page 6. We map 6. My recommendation is to map all 26 and move the answers to a list shape (§3.0b); the geometry is already derived, so the coordinate work is an afternoon. The alternative — keep 6 and say the limit out loud — is worse for exactly your users, who routinely hold more | §3.0b. Also decides the data shape, which is harder to change later than the coordinates |
| 7 | **Confirm the holding limits against the current Act before B13 ships.** I read them off the Act as assented to in 2001; the reference flags `s 13–16` caps as amendment-sensitive. Either you confirm them, or an attorney does, or we ship the engine with the rules visible and dated so a wrong one is obvious and cheap to fix. **I would not ship a number I could not date** | §6. Blocks B13, nothing else |
| ~~8~~ | ~~Certification currency~~ — **ANSWERED 2026-08-28: three months is the house rule, not a DFO’s. Soft requirement, never a blocker.** See §3.10 | Closed |

None of these block Phase 1. I can start on the provenance spine immediately.

---

## 11. What this does not touch

- The Document Centre / vault itself — it stays exactly as it is and becomes the source
  the pack reads from.
- The Licence Centre list, reminders, renewal maths, expiry rules.
- Motivation PDF rendering, templates, layouts, colourways, cover photos.
- The witness/character-reference engine beyond surfacing it as a pack row.
- Anything in the storefront.

---

## Open items carried in from before this design

- `SELLER_LICENCE` first in the checklist — asked for, still needs an answer on what
  "current owner's licence" means on dealer and estate routes.
- Existing vault rows carrying bogus expiries on proficiency and ID documents — the
  never-expires change set defaults for new uploads only. A data migration needs your
  say-so.
- Passport handling — currently a member unticks never-expires. May want its own kind.
- The phone-upload confirm prompt — the root cause of the 0-of-5 confirmed licences. Worked
  around, not fixed. Unconfirmed documents still cannot arm renewal reminders.
