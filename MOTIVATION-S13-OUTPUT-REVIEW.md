# First output from the new Licence Centre: MO000071 (S13) and the sheet

Date: 2026-09-08. Reviewed the generated pack `MO000071inspect.pdf` (27 pages, 4,938
words, pdf-lib) and walked `/licence-centre/applications` as `turbosnail`, starting
MO000072 (S13) to see the questions as they are asked today. Read-only. Delete MO000072.

Verdict: the bones are right and most of the brief is built. The document fails on the
things the reason-prompt rules were written to stop: it invents licence sections and roles
for the owned firearms, it pastes product copy into an S13, and it lets a quality gate pass
a motivation that cites an expired competency. The sheet is close; the gaps in it are what
caused the document faults.

---

## 1. The document: what is wrong, in order of damage

### 1.1 Wrong licence sections stated as fact (refusal risk)
Section 9: "a MARLIN rifle in .45-70 Government under section 15". The Marlin is a section
16 licence (operator, 2026-09-08: the Howa is section 15, everything else is section 16, so
the Howa line happens to be right). The sheet's owned-firearm rows carry make, calibre,
serial and expiry but no section, so the model guessed, and one of its two guesses is
wrong. A DFO with the licence copies in Annexure G will see the contradiction on the page.
A guess that is right by chance is still a guess; the fix is the same. Fix: section is a required column on every owned firearm (read
off the card by `licence-card-ocr.service.ts`; the card prints it), and the writer may not
name a section that is not in the data (validator: every "section N" attached to a held
firearm must match `arsenal[].section`).

### 1.2 Invented roles for every owned firearm
Same section: "long-range game harvesting and sport shooting", "designed for bushveld
hunting and sporting use", "dedicated precision sport shooting rifle chambered for
extended-range accuracy", "utilized for dedicated sport shooting disciplines", "very small
pocket calibre intended for specific restricted sport use". None was supplied. The sheet's
blurb says "what each one is for" but asks nothing; `primary_use` is not on the rows and
the SAHGCA endorsements were not read. This is prompt rule 12 and it must be enforced by
the validator, not hoped for.

For an S13 the comparison only needs one true sentence per held firearm: "licensed under
section 16 for [hunting / sport shooting, from the endorsement]; a section 16 firearm may
not be used for self-defence, and a rifle cannot be carried on the person". That is the
whole argument and it is provable from Annexure G.

### 1.3 Expired competency printed in the motivation
Section 7: "competency certificate C9882094 ... remains valid until 2026-08-26". The
document is dated 9 September 2026. Either the derived date is wrong (the card carries no
expiry; the vault derives it from the longest licence in the class) or the competency has
lapsed, in which case section 6(2) means no licence can be issued. Either way it cannot be
printed. Fix: a pre-generation check; if `competency_expiry < today`, block with a plain
message on the sheet ("your competency expired on ...; renew it first"), and never print a
derived expiry, only "valid" with the certificate number.

### 1.4 Product copy in an S13
Section 4 (150 words on short-recoil, tilting barrel, polymer frame, Safe Action, "dust,
lint, and variable maintenance cycles") and section 5 (9x19 "globally standardized service
cartridge", 115-147 grains, "3 to 5 foot-pounds", "high magazine capacities", "terminal
ballistics"). None of this is a reason a person needs a firearm, and "high magazine
capacities" and "terminal ballistics" are phrases a Registrar reads against the applicant.
The approved S13 on file (your own Midrand letter) has none of it. Fix: for S13, sections
4 and 5 collapse to one paragraph of at most 60 words: type, calibre, why a handgun and not
a rifle (carry), one sentence on the calibre being a common service calibre with ammunition
readily available. Banned-phrase list (prompt rule 15) applied to the whole document, not
only the reason paragraph.

### 1.5 The reason section is the best part and it is buried
Section 3 (precinct figures for Kraaifontein, Bothasig, Goodwood, tied to the areas the
applicant ticked, with clipping references) is exactly what the approved S13 does and better
sourced. It sits third, after a personal-circumstances paragraph that contains "I am
single" and the employer's street address. Order for S13: background (2 sentences),
exposure to risk (this section), how the firearm would be kept and carried, existing
measures and why they are insufficient, the firearm (short), the battery and why none of it
serves, statute, summary. Marital status and employer address are 271 boxes, not prose.

### 1.6 Structure and layout
- Contents page lists only the annexures (from page 6). The motivation's own sections
  (pages 3-6) are not in the contents, and the running header on pages 3-5 reads
  "CONTENTS". Contents must list the eleven motivation sections with page numbers, then the
  annexures.
- Section headings are inline ("4. The firearm applied for:") in body size. Use the fixed
  heading set from the UX review, set as headings.
- The owned-firearms table (page 6) has no type, section or status column and sits after
  the summary and before the signature. Move it into the battery section, add Type, Section
  and Status (dedicated / self-defence / disclosed event), keep the signature directly after
  the summary.
- "Prepared 9 September 2026" on the cover; the consent annexure is dated 8 September;
  fine, but the cover date must be the generation date, not a future one (check clock/TZ).
- The preview watermark letters ("NOT FOR USE") are extracted as stray capitals by any text
  tool; a DFO scanning the PDF will see the same. Use a vector watermark on its own layer
  or a raster.

### 1.7 Annexures
- Press clippings (Annexure I) are a headline, two lines and a URL per page. That is not a
  clipping. Either embed the article body (with the paraphrase rule relaxed for an annexed
  source, since it is attributed and unedited) or a screenshot of the article page, plus the
  station's quarterly figures table for that precinct, which the motivation already cites.
- The consent annexure is fine structurally (the applicant consenting to himself is test
  data).
- The "Take these with you" pages are good and should stay, with two corrections: "The
  dealer's tax invoice for the firearm" appears on a private-owner route; make the list
  route-aware. And it lists "Character references, if you have them" while the pack has no
  character reference slot in the sheet; either add the slot (`CHARACTER_REFERENCE` exists
  as an upload kind) or drop the line.
- Proof of address (page 25) is a rental statement showing the rent amount and arrears.
  It proves the address; it also puts the applicant's rent and a R134 arrears line in front
  of a police official. Offer the applicant a choice of which document proves the address,
  and prefer a municipal account or bank letter when both exist.

### 1.8 Small
- "grip-attacks" (from Afrikaans "gryp") in section 3; the clipping summariser should not
  translate the crime type literally. Use SAPS categories (common robbery, snatch theft).
- "9MM PAR ( 9X19MM )" with spaces inside the brackets, three times. Normalise calibre
  display from `saps-vocabulary.ts`.
- "Refer to Annexure E: Photographs of your safe" - annexure titles are in the second
  person in a first-person document. Title annexures as "Photographs of the safe".
- Section 8 "My record" is a list of documents submitted, not a record. Fold into the
  statute section or drop; the annexure index already does this.

## 2. The sheet: what is right and what is missing

Right, and matching the brief: single page, sections anchored, document shelf on top,
item rows with source chips and Change, cards in Your case, preview drawer, one red button,
profile-scoped premises and reloading, declarations with No first, F-by-route note, the
DFO list. This is the design.

Gaps, in the order they hurt the document:

1. **Owned firearms carry no section and no purpose.** Rows show make, calibre, serial,
   expiry. Add Section (read from the card; required) and "What it is for" (from the
   endorsement if one is in the vault, else a card row with calibre-derived suggestions).
   This one change removes 1.1 and 1.2 above.
2. **Endorsements are not in the shelf.** Three SAHGCA endorsements exist for this member
   and none appears as a document or feeds a row. Brief §5.5a.
3. **Competency picks nothing** when four certificates exist, and the unit-standard
   warning fires before any document is chosen. Once `firearm_type` is answered, choose the
   certificate whose class matches; show the warning only if the matching statement of
   results lacks 117705.
4. **Reloading is asked on an S13** and lands in the document as "experience". Reloading
   is hunting/sport content; hide the profile row on S13 and never write it into an S13.
5. **The incident list under "Where you travel"** offers a child-rape case in Atlantis and
   an Afrikaans court-postponement story. Filter `NewsIncident` to robbery, housebreaking,
   hijacking, murder, assault; exclude sexual offences and court-diary items; never show a
   headline the applicant would not want in their own pack.
6. **"Use my current location"** appears under Employer's address. Remove; an employer
   address is typed or read from the employment letter.
7. **Declarations says "Five questions"; the preview says "six".** The 271 has six with
   negligence conditional on lost/stolen. Say "six" in both, or "five, and one more if a
   firearm was lost".
8. **Two progress figures still disagree**: header "16 things left" and pack "37% of the
   boxes". Keep the header count; the meter belongs on the pack step only, after the count
   reaches zero.
9. **`/licence-centre/applications` shows no existing applications.** MO000071 exists and
   there is no way to reopen it from that page. List them above the "start new" cards.
10. **Barrel, frame and receiver** ("6 rows", collapsed) on an S13 handgun with no card
    read yet. Show only after a card or invoice is read, otherwise leave to the 271 fill.

## 3. Generation: gates that must exist before the next run

- Section and role validator (1.1, 1.2): any "section N" or use-word attached to a held
  firearm must match `arsenal[]` data; otherwise regenerate once, then fail the run with
  the offending sentence shown to the operator, never to the applicant.
- Competency currency (1.3): expired or unknown expiry blocks generation with a sheet
  message.
- Banned phrases over the whole document (1.4).
- S13 scope: no hunting, sport, reloading or competition words anywhere in an S13 document.
- Word budget for S13: 900-1,400 words of motivation; MO000071's motivation body is about
  1,300 including the product copy, so the budget holds once 4 and 5 shrink and the reason
  section grows.

## 4. What to hand Claude Code

In this order, each its own session:
1. Owned-firearm rows: Section column from the card OCR, purpose from endorsement or card
   row; endorsement OCR and shelf entry (brief §5.5a). Validator for sections and roles.
2. Competency currency check; certificate auto-pick by firearm type; hide reloading on S13.
3. Writer: S13 section order and lengths per 1.5; banned phrases document-wide; headings
   as headings; contents page covering the motivation sections; battery table with Type,
   Section, Status inside the battery section; annexure titles first person.
4. Annexures: clippings as article body or screenshot plus precinct figures table;
   route-aware "take with you" list; proof-of-address choice.
5. Sheet cosmetics: incident filter, remove location button, declarations count, single
   progress figure, applications list on the landing page.
