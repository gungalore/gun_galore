# Motivation writer — audit, 2026-08-19

Scope: faults in the live build, effort reduction, and our requirements weighed
against what the SAPS licence process actually asks for (verified against the
official NatShoot SAPS 271 checklist, SAPS FAQs and current guides — sources at
the bottom). Numbers below are measured off the registry, not estimated.

**The load today, s13 self-defence:** 116 fields in the registry, **79 shown
immediately**, **21–26 answers required before Generate** (married + safe adds
five). The document itself genuinely consumes about **13** of those. Everything
else exists for the SAPS 271's boxes.

---

## A. Faults

### A1 — CRITICAL: the follow-up loop is a dead end

`openQuestions` in the wizard hides any Boet question whose target field has
text:

```ts
messages.filter(m => m.role === 'assistant' && !(answers[m.fieldKey] ?? '').trim())
```

But by the time Generate runs, every **required** field has text (Generate
refuses otherwise), so the gate's follow-ups are about **thin** fields — which
have text. Result: the gate fails, status goes to `NEEDS_MORE_INFO`, and the
applicant sees **no questions at all**. They are stuck with no visible way
forward, on the exact path a weak application takes.

*Fix:* a question is "open" until a **user message with the same `fieldKey`
exists after it** (the data is already in `messages`), not until the field is
non-empty.

### A2 — HIGH: the overlap engine is dead code

`checkOverlap` — the ".308 and .270 are both medium game, justify both" feature
the operator specifically asked for — has **zero call sites**.
`queueFollowUps(..., overlapNeedsJustification = false)` is never passed `true`,
so the justification field is stripped from every interview and the writer note
never reaches the prompt. The module and its 15 tests are live; the pipeline
never consults them.

*Fix:* in `generate()` (and on save of any `existing_firearm_*_calibre`), run
`checkOverlap(firearm_calibre, existing calibres, { dedicatedStatus })`; feed
`writerNote` into the fact pack and pass `needsJustification` through to the
gap ranking that already handles it.

### A3 — HIGH: the filled SAPS 271 is unreachable

`Saps271Service` is built, tested (20 tests), registered in the module — and has
**no endpoint and no UI**. 144 measured boxes deliver nothing to anyone.

*Fix:* `GET :id/saps271` with the same headers/posture as `:id/pdf`, a second
button beside "Open your motivation", and a checklist entry ("Your SAPS 271,
pre-filled — check it, do NOT sign it"). Return `leftBlank` alongside so the UI
can say which boxes still need a pen.

### A4 — HIGH: ID numbers with spaces are destroyed

People type `8001 0150 0908 7`. The HTML input has `maxLength=13` — counting
spaces — so typing **stops four digits early**; anything pasted is server-side
sliced to 13 characters *including spaces*. The stored ID then fails
`readSaId`, and DOB, age, gender and citizenship silently vanish from the form.
Same bug on `spouse_id_number`.

*Fix:* strip non-digits for ID-shaped fields before the cap (client and in
`sanitiseAnswers`), or raise the cap to 20 and normalise. One-line class of fix.

### A5 — MEDIUM: a married applicant whose spouse has a passport cannot generate

`spouse_id_number` is `required` + `showIf marital_status=Married`. Choosing
`spouse_id_type = Passport` still leaves the SA-ID field required → Generate is
blocked by a field the applicant cannot truthfully fill.

*Fix:* gate `spouse_id_number` on `spouse_id_type = 'SA ID'` and make
`spouse_id_type` the required one when married.

### A6 — MEDIUM: form-only fields block the document

Of the 21–26 answers Generate demands, roughly half are `formOnly` — marital
status, `safe_present`/`safe_mounted`, six history yes/nos, `residence_type` —
none of which the writer is even allowed to see. An Opus generation is held
hostage to postal-tier data. (Effort plan in §C fixes this properly.)

### Minor
- **A7** `overlap_justification` renders for everyone (no `showIf`) even with no
  overlap found.
- **A8** Step numbers start at "2" when there is no profile offer, and shift
  when it is consented away.
- **A9** Extraction runs synchronously inside the upload request — a 10–30 s
  frozen file input with no progress state.
- **A10** A second `CURRENT_LICENCE` upload can never extract: it always
  proposes `existing_firearm_1_*`, which the client filters as already answered.
- **A11** Accepting suggestions merges `...accept` last client-side, overriding
  anything typed into those fields between upload and accept (server refuses the
  overwrite; the screen doesn't).

---

## B. What SAPS requires vs what we cover

Verified against the official checklist (NatShoot mirror of the SAPS list),
SAPS FAQs and current 2025/26 guides.

| SAPS requires | Our coverage | Gap |
|---|---|---|
| SAPS 271 form | filled, 144 boxes | **unreachable (A3)** |
| Motivation, signed | core product | ✅ |
| Competency certificate (must exist — no competency, no licence) | optional field + upload | **no interlock**: we let someone build the whole pack without competency and never warn the application is dead on arrival |
| Training / proficiency certificate (separate from competency) | upload kind exists | not named in take-to-station list |
| **Two character references** (~2 yrs acquaintance, non-family preferred) | upload kind exists | checklist never says TWO or the criteria; wizard never mentions them |
| **SAPS 541 undertaking (safe storage) or DFO safe inspection** | — | absent everywhere |
| Certified ID copy, **≤ 3 months** | "two copies of your ID" | no *certified*, no age limit |
| Certified proof of residence, **≤ 3 months** | upload kind only | not in take-to-station list |
| Two passport photos | ✅ checklist | ✅ |
| **Dealer's tax invoice / proof of purchase** | — | absent — and for on-platform sales **we hold this document** |
| Safe invoice/receipt | — | absent |
| s16: association **endorsement letter** (calibre suitability — NHSA-style prerequisite) | membership card only | endorsement ≠ membership card; not asked |
| Fee (~R183, 2025/26, adjusted annually) | "confirm the amount" | fine as is |
| Renewal → **SAPS 518(a)**, not the 271 | we correctly refuse | roadmap: map `e518a.pdf` with the same measuring tool |

Nothing we ask is superfluous to the process — every field lands on the 271.
The problem is ordering and gating, not scope.

---

## C. Shrinking the effort

**C1 — Split "required" into two tiers.** `requiredForDocument` (~13 fields)
gates Generate; `requiredForForm` (the rest) gates only the *271 completeness
meter*. The applicant gets their motivation after ~13 answers; the form fields
become an explicit "finish your SAPS form" stage they can do afterwards — the
271 already renders with blanks plus a `leftBlank` list. Biggest single
reduction, no data lost.

**C2 — Let the documents do the typing** (already live, now make it count).
Extraction + profile prefill can already cover full name, ID, address, postal
code, cellphone, competency number/dates/types, association details, and an
existing firearm's five columns. With ID + competency + licence + proof of
address uploaded, **~10 of the 13 document-tier answers arrive prefilled** —
typed effort collapses to: the firearm applied for, why it fits, storage
detail, and (s13) circumstances/routine.

**C3 — On-platform purchase tie-in.** When the motivation is linked to an order:
prefill `firearm_type/make/model/calibre/serial` from the listing **and
auto-attach our own tax invoice as an annexure** (SAPS wants it; we generate
it). Kills six fields and one document for exactly the R99 cohort we most want
to convert.

**C4 — One screen for the six history questions.** Six No/Yes toggle rows
(still defaulting to unanswered), detail sliding open on Yes. Same data, reads
as 20 seconds instead of a page of dropdowns.

**C5 — Fold the form-only personal fields** (phones, postal codes,
marital/spouse, employer address) into one collapsed "Only needed for the SAPS
form" group with a visible *skip for now* — honest, and pairs with C1.

**C6 — Competency interlock.** First question of the wizard: "Do you have a
competency certificate for a [handgun/rifle/shotgun]?" If no → do not block,
but show plainly that SAPS will not accept the application without one, link
the checklist item, and mark the pack "waiting on competency". Prevents the
worst outcome we can cause: a beautiful pack that is dead on arrival.

**C7 — Checklist additions** (cheap, high trust): two character references with
the 2-year/non-family wording; SAPS 541 or DFO inspection; *certified* copies
≤ 3 months; safe invoice; tax invoice; s16 endorsement letter.

---

## D. Suggested order

1. **A1** (dead end) + **A4** (ID truncation) — the two that hurt live beta users today.
2. **A3** (serve the 271) + **A5** (spouse passport) + C7 checklist lines.
3. **A2** (wire the overlap engine — it is the differentiator).
4. **C1/C5** two-tier required + form-only grouping.
5. **C3** purchase tie-in (needs order linkage — also the R99 voucher hook).
6. **C6** competency interlock, **C4** history screen, minors A7–A11.

Sources: [NatShoot — official SAPS 271 checklist](https://natshoot.s3.amazonaws.com/uploads/Firearm%20Licensing/SAPS%20271%20Check%20List.pdf) · [SAPS — applying for a new licence FAQ](https://www.saps.gov.za/services/flash/firearms/faq_applying.php) · [SAPS — renewal FAQ (518a)](https://www.saps.gov.za/services/flash/firearms/faq_renewal.php) · [SAPS 518(a) form](https://www.saps.gov.za/services/flash/firearms/forms/english/e518a.pdf) · [TrackMyApp — documents checklist](https://www.trackmyapp.co.za/guide/firearm-licence-documents/) · [TrackMyApp — 2026 application guide (fees)](https://www.trackmyapp.co.za/guide/firearm-licence-application/) · [SA Hunters — licence application guide](https://sahunters.co.za/wp-content/uploads/2024/04/5.-Firearm-Licence-Application.pdf)
