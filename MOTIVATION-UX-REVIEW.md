# Motivation Centre: live walkthrough and document review

Date: 2026-09-07. Walked the live pack screen at alloutdoor.co.za/licence-services as
member `turbosnail`, application MO000066 (Section 16, created for this review and left
in the account; delete it). Read-only: nothing changed. Companion to
`MOTIVATION-INTAKE-PLAN.md`; that plan fixes the question model, this fixes how the
screens and the document read.

Confirmed on the way: the pack screen (`/licence-services/[id]`, 11 steps) is what
members walk today. Step changes belong in `wizard-rail.tsx`, not `STEP_PLAN`.

---

## 1. What is wrong with the flow, in the order a member meets it

### 1.1 Wrong section recorded at start (verify)
Clicked "Dedicated sports shooter" on `/licence-services/new`; the application opened as
"Section 16, dedicated hunter". Either the card hit area overlaps the row above or the
create call maps sport to hunter. Reproduce before anything else: a wrong section is fixed
"once the application starts" and changes every question after it.

### 1.2 Every step opens with the same banner
"We added 3 documents from your Document Centre ... Got it" appears at the top of all ten
steps until dismissed, and stays above the fold. Show it once, on step 2, then collapse it
to one line in the right-hand panel.

### 1.3 Answers are hidden behind rows
Every question renders as a grey row: label, italic "You may know it", a "Still needed"
pill. No input is visible. Clicking the row text does nothing; only a narrow invisible
button opens one field at a time, with a "Done" link to close it. Seven required answers on
the firearm step means seven open-answer-Done cycles. This is the single biggest reason
the form feels like work.

Fix: render inputs inline and always visible. A select is a select; a short field is a
field. Keep the "Still needed / Optional / Read from your licence card" pill on the right
of the input. The collapsed row was designed for the doc-sourced case (a value we already
hold, shown with its source), and it is right there; it is wrong for an empty required
field.

### 1.4 "You may know it" is the wrong prompt
It appears on every unanswered field including "Should we fill in your SAPS 271 form?" and
"Why this particular firearm suits the purpose". It reads as a shrug. Placeholder text
should be the answer shape: "Bolt action", "CZ", ".308 Win", "Rifle safe, bolted to the
wall".

### 1.5 A whole step with nothing to do, and it asserts something false
Step 3 "Where it is from" showed "You told us this firearm is coming from a dealer" when
`firearm_source` was never answered (the question sits on step 2, marked Optional). The
step has no input of its own. Move the source question onto this step as its one
question, or fold the step into step 2. Never state an unanswered default as "you told us".

### 1.6 The competency step is a diagnostics dump
Two scanner blocks, two reuse dropdowns listing nine vault credentials, a warning "We could
not read your proficiency codes", a note "we will fill your competency in as soon as you
have said which firearm this application is for", and a stray line about a Marlin being a
duplicate of Firearm 2. All of that is true and none of it should be visible. When the
vault holds five competencies and four proficiencies, the step is: "Your competency:
Handgun, Manual Rifle, Semi-auto Rifle + Shotgun (certificate 1234, issued 2024)", one
line per certificate, "Correct" or "Change". The upload doors appear only when the vault
has nothing for this firearm type.

### 1.7 Documents already attached still show their full upload door
Step 6 lists the ID and proof of address as attached (Annexure A, Annexure C), then shows
the full scanner + upload + reuse block for the identity document and for the proof of
address again underneath. Once a kind is attached, its door collapses to "Replace".

### 1.8 Masked values the applicant cannot check
Full name shows as "GE••••••••", ID as "8905 •••• •••", address as "36•••••". The
applicant is about to sign these on a police form and cannot read them. Mask in logs and
admin, not on the applicant's own screen. Show the value, with an eye toggle if you want
one.

### 1.9 "Why you need this firearm" is the smallest thing on its page
Step 8 is the step the DFO reads. It renders as a large red scanner block, an upload box, a
reuse dropdown, and then four grey rows in a two-column grid ("Your hunting record",
"Shooting disciplines you compete in", "What the discipline requires", "Association
activities"). Opening "Your hunting record" gives an empty textarea with the hint "Species,
terrain, ranges, roughly how many hunts a year". That is the composition problem the intake
plan replaces with cards; until then, at minimum: this step's questions come first, one
column, textarea open, evidence door underneath.

### 1.10 Declarations shows complete before anything is answered
Step 10 carried a green tick on the rail from the moment the application opened, its
footer read "Nothing outstanding here", and the right-hand panel simultaneously read
"H Declarations 0%". Cause: the six history questions are `formOnly`, the 271 opt-in was
unanswered, so the step rendered only the optional `prior_refusals` box and counted itself
done. Removing the gate (intake plan §5.3) fixes the substance; separately, a step must not
tick while its panel row says 0%.

### 1.11 Two progress systems disagree
The rail ticks steps, the footer counts "7 answers still needed", the right panel gives
per-letter percentages, and the pack step lists "15 answers still to give" as chips. Four
views of the same state, and 1.10 shows they can contradict. Keep two: the rail (step
done or not) and the right panel (what the 271 needs). The footer line stays; the pack
chips go, replaced by links back to the step that owns each gap.

### 1.12 Scroll position carries across steps
Continue lands the next step mid-page (step 5 opened at the firearm table, step 8 at its
last row). Scroll to the step heading on every transition.

### 1.13 The right panel repeats the same footnote on every step
"A section counts only the boxes that apply to you. Answering 'no' to a history question
closes its follow-ups; an owned-firearm row you never use is not an empty box." Nobody
needs that eleven times. Once, on hover of the percentage.

### 1.14 The pack step is a chip cloud
"15 answers still to give" as fifteen unlinked chips, "5 documents still needed" as five
more, then a list of every deliverable with To do / Done. Group by step, link each chip to
its field, and put "Your motivation: we write this once the questions are answered" at the
top with the one button that matters.

### 1.15 Continue never blocks and never explains
Every step allowed Continue with required answers missing. That is fine (leave-and-return
is a feature), but the button should say "Skip for now" when the step is incomplete and
"Continue" when it is done, so the member knows which they pressed.

---

## 2. Screen-level layout

- Two-thirds of every step is scanner/upload furniture in brand red. The red block is the
  loudest element on ten screens in a row and it is a secondary action once the vault is
  populated. One neutral "Add a document" row per step; red is for Continue.
- Step body is a single 540px column on a 1400px layout with the right panel at the far
  edge. Widen the body to ~760px so a textarea is a textarea and labels stop wrapping to
  three lines ("Why this particular / firearm suits the / purpose").
- Rail labels ("Where it is from", "What you own", "Your case") are fine. Eleven steps is
  not; the intake plan's nine (source folded into firearm, declarations kept) is the
  target.

---

## 3. The document

No generated motivation was available to read (this account has none, and no rendered
sample is in the repo or Downloads). Drop one PDF into Downloads and I will do a line-level
pass. What follows is from `motivation-prompts.ts`, `motivation-structure.ts`,
`MOTIVATION-DOCUMENT-STRUCTURE.md` and the seven approved packs.

### 3.1 It is too long by design
Length bands in the prompt: S13 1200-2500 words, S15 1800-3000, S16 2500-4500. The
Gerstner and Fourie packs are 13-21 pages but 60% of that is manufacturer copy, cartridge
history and quoted regulations, which your own rule 7 and the "no padding" decision of
2026-08-18 forbid. Take that out and an approved S16 is 900-1400 words of argument. Cut
the bands to roughly S13 900-1400, S15/S16 1200-1800, S24 600-900. A DFO reads the first
page and the section that names the firearm; nothing after 1800 words is read.

### 3.2 No lists, no tables, anywhere
The prompt says "no markdown, no bullet points" and the renderer honours it, so the
firearm particulars, the owned-firearms battery and the annexure index all arrive as
prose. Every approved pack puts exactly those three things in tables, and the structured
data exists. Keep prose for the argument; render these from the fact pack, not from the
model:

- a particulars block on page 1 (type, make, model, calibre, serials, section applied for)
- the battery table (make, model, calibre, section, licence expiry, what it is used for)
- the annexure index with letters
- for S13, a short existing-measures list (alarm, armed response, fence, bars)

### 3.3 Randomised headings and cadence
`HEADING_ALTERNATES`, three cadences (plain/measured/detailed), and a similarity
regenerate threshold exist so two documents never read alike. Two-thirds of the time an
applicant therefore gets "measured" or "detailed" prose. A DFO does not compare
applicants' motivations for plagiarism; they compare the facts to the annexures. Fix the
cadence to plain and let variation come from the facts and the section ordering. Fix the
headings to the twelve the approved packs use (Personal details, Firearm experience,
Competency, Security and safe storage, Firearm applied for, The calibre, Existing firearms,
Association membership and status, Application under section N, PAJA, Conclusion,
Annexures), because a DFO who has read a thousand of these skims by heading.

### 3.4 The statutory section
Rule 5 forbids quoting the Act except from `<statutory-text>`, so the writer paraphrases
section 16 in its own words across several paragraphs. The approved packs do the opposite:
quote the subsection verbatim, then one paragraph applying the applicant to each element.
Quote-then-apply is shorter and is what the reviewing officer expects; the paraphrase is
what makes the section feel like a legal essay. Since the text is in `motivation-statute.ts`
already, render the quote from code and ask the model only for the application paragraphs.

### 3.5 The opening
Two openings are randomised ("need first", "purpose first"). Every approved pack opens
the same way and it works: name, ID, citizenship, address, employer, then one sentence
naming the firearm and the section. Fix it.

### 3.6 Annexure citations inline
"(Refer to Annexure D: Proof of address)" after the sentence it proves is right and the
approved packs do it. Keep it; make sure the renderer prints the letter in the margin as
well, which is how a DFO finds the page.

### 3.7 Cover
The Claude Design A4 cover with the firearm photo is good; the Engala packs open with a
checklist page ("take all of the following to SAPS"). Put that checklist as page 2, from
`DFO-application-documents-by-section.md` by section and source route. It is the single
most useful page in the pack for the applicant on the day.

---

## 4. Order to do it in

1. 1.1 (section mapping), 1.10 (declarations tick), 1.5 (false "you told us"): bugs.
2. 1.3, 1.4, 1.8: inputs visible, real placeholders, unmasked values. One component
   (`motivation-field-input.tsx` / the pack screen's row) and most of the pain is gone.
3. 1.2, 1.6, 1.7, 1.13, 1.12: noise removal.
4. §2 layout and §1.11/1.14 progress.
5. §3 document: length bands and cadence are prompt constants; tables and the statutory
   quote are renderer changes; headings and opening are `motivation-structure.ts`.
