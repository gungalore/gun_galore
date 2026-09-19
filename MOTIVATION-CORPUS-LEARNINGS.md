# What the approved motivations teach

Date: 2026-09-07. Source: the operator's Downloads folder. Every document below was
written by a paid motivation writer (Engala Motivations, an NHSA-linked writer, and one
writer for the Gerstner packs), the applicant typed nothing, and every one except the
operator's own Glock drafts was approved by the CFR. That makes this corpus the ground
truth for what passes, which matters more than what reads well.

## 1. Corpus

| Pack | Section | Firearm | Pages | Words | Writer style |
|---|---|---|---|---|---|
| Gerstner, Beretta 1301 Tactical | S16 sport | 12ga semi-auto shotgun | 22 | 6,300 | compiled |
| Gerstner, Springfield Prodigy | S16 sport | 9mm handgun | 40 | 9,850 | compiled |
| Gerstner, Glock G43X | S16 sport | 9mm handgun (his 4th 9mm) | 33 | 7,400 | compiled |
| Gerstner, Barrett REC7 11.5" | S16 sport | 5.56 self-loading rifle | 39 | 10,500 | compiled |
| Fourie, Marlin .45-70 (Engala) | S16 hunter | lever rifle | 11 | 3,250 | template |
| Fourie, Mauser .30-06 (Engala) | S16 hunter | bolt rifle | 27 incl. 271 + consent | 6,100 | template |
| Fourie, ADP 9mm (Afrikaans SD) | S13 | handgun | 5 + 3 annexes | 1,600 | personal letter |
| Oosthuizen, Remington 783 | S15 hunter | 6.5 Creedmoor | 13 | 3,800 | compiled |
| NHSA generic layout | any | - | 5 | 1,150 | the writer's own template |
| NHSA example set (4 docx + 1 pdf) | S13/S15/S16 | handgun, rifle, shotgun, SD | - | 1,300-2,350 | templates |

Word counts are the whole PDF. Applicant-specific prose in the biggest pack is under 400
words; the rest is manufacturer copy, cartridge articles, association programme text,
exercise rules and quoted statute.

## 2. What every approved pack has (the bundle anatomy)

In this order, near enough, in all of them:

1. Cover: applicant, ID, contact, the firearm (type, make, model, calibre, serial),
   section applied for. Engala adds a "take this to SAPS" checklist page for the DFO.
2. Personal details: name, ID, citizenship, address, employer, "law-abiding citizen".
   Every fact followed by "(Refer to Annexure X)".
3. Firearm experience: how they came to firearms, what they shoot now, unit standards
   completed (117705 + the type codes), "passed under the watchful eye of our instructor".
4. Competency: certificate, proficiency, sometimes Reg. 13 quoted.
5. Security and safe storage: property enclosure, gate, lighting, bars, alarm, armed
   response, safe type, bolted where, sole key holder, "complies with section 86".
6. Association membership and dedicated status, with the endorsement referenced.
7. Firearm applied for: make/model/calibre/serial, then capability copy.
8. The calibre: history and ballistics copy.
9. Existing firearms: a TABLE (make, calibre, type, issue date, section and status,
   expiry). Gerstner's Barrett pack lists a STOLEN CZ in that table. Disclosure, in the
   table, not in prose.
10. Comparison: existing firearm(s) vs applied-for, or type vs type (self-loading vs bolt,
    rifle vs pistol carbine).
11. Application under section N: the subsection quoted verbatim, then "as a dedicated
    sport shooter I will participate in..." followed by the association's programme text
    and the RULES of the specific exercises this firearm will be shot in (NHSA: "10m
    centre-fire handgun exercise", "223/5.56 semi-auto rifle exercise").
12. PAJA paragraph (request for prior notice before refusal).
13. Conclusion, signature.
14. Annexure list with letters.

## 3. What the CFR evidently tolerates

This is the uncomfortable part and it should recalibrate the quality gate.

- Gerstner's G43X was his fourth 9mm (S13 CZ, S16 CZ SP-01, S16 CZ carbine, then G43X);
  the Barrett pack shows the battery grew to two more 9mm Springfields afterwards. The
  comparison section for the G43X is a generic "CZ Shadow vs Glock" product comparison
  that praises the Glock for "concealed carry" on a section 16 application. Approved.
- The Barrett comparison is a 1,200-word essay titled "Exploring the Contrasts" that
  never names the applicant's own firearms. Approved.
- Engala's .30-06 motivation does not mention the .45-70 or any other firearm the
  applicant held. Approved.
- The Oosthuizen S15 pack has "Existing Firearms: see attached" and one sentence.
  Approved.
- The Afrikaans-era S13 letter is 1,600 words of general crime narrative plus three
  attached articles and a precinct statistics printout, closes on "peace of mind", and
  includes "I have no criminal record". Approved.

So: the CFR is not refusing on overlap prose, on generic comparisons, or on padding. What
carries these packs is the BUNDLE: dedicated status, endorsement for this serial, the
association's programme and exercise rules bound in, competency, safe photos, and every
claim pointing to an annexure. The reason paragraph is necessary but it is not where
approvals are won or lost. Our overlap engine and reason generator should make the
document better than these, but a gate that refuses to generate because a fourth 9mm
"cannot be justified" is stricter than the Registrar and would block applications that
would pass.

## 4. What the writers do that we should copy

- **Exercise eligibility rules as the differentiator.** The NHSA handgun example lists
  every postal exercise with its equipment rule: "5m Snubby and Pocket Pistol: barrel not
  longer than 100mm"; "7m 2x5 shot: only 9mmP pistols and larger"; "50m Hunting
  Handgun: min .357 Mag, 4-inch barrel"; "10m centre-fire: all calibres". A 6.35mm pocket
  pistol is eligible for the first and ineligible for the second. That is a verifiable,
  document-backed gap between two handguns, and it is stronger than any calibre opinion.
  This is what `association_activities[]` must carry: exercise, firearm class, the rule.
- **The battery table carries section and status.** Make, calibre, type, issue, section
  (13 / 16 dedicated), expiry. Sections visible means the reviewer can see at a glance
  which firearms are sport and which is self-defence. Render it from data.
- **Bind the association's own text into the pack.** Programme description and the rules
  of the exercises named. Paraphrase the programme (copyright, and the layout doc's own
  instruction), but the exercise rules can be attached as an annexure in the association's
  words with a source line.
- **The NHSA layout's own instruction**: "Short description and capabilities of this
  firearm (not multiple pages of history and data)" and "explain why the firearms you have
  of the same type cannot do the job you want this one to do". The writer who wrote the
  template knew; the writers who used it padded anyway. We follow the template.
- **Engala's cover checklist** for the DFO, by section and source route, with what is
  already in the pack ticked. Page 2 of every pack.
- **Disclose in tables.** The stolen CZ sits in the battery table with "STOLEN" in the
  status column. Our history answers should produce exactly that: a table row, not a
  paragraph.
- **S13 shape**: residence and precinct with attached station statistics, home invasion
  reality, travel and work exposure (hours, routes, equipment carried, overnight stays),
  hijacking at the gate, the "police respond in minutes, a life is lost in seconds" line,
  existing measures and why they are insufficient, last-resort statement. The engine's S13
  card set already maps onto this one to one.
- **Hunting shape**: association exercises as off-season practice, quarry list with terrain,
  "biltong and meat for the pot", back-up rifle to finish wounded game, ethics learned.
  Species lists and range bands do the work; the calibre article does not.

## 5. What not to copy

- Pasted manufacturer pages and cartridge Wikipedia text (Beretta history from 1526; the
  6.5 Creedmoor article). Rule 7 already bans it; the corpus shows it is unnecessary.
- "Concealed carry", "home defence", "stopping power" anywhere in an S15/S16 pack. It
  passed for Gerstner; it is still an admission of use outside the licence and a different
  reviewer will read it.
- Reg. 13 quoted in full under "Current competency status". Cite the competency
  certificate and move on.
- "I have no criminal record" and similar clean-record padding. Approved once; still the
  kind of sentence rule 7 exists to prevent (a table row does the disclosure job).
- Comparison essays. One paragraph naming the held firearm and its role, one naming the
  new firearm and the exercise or quarry it is for.

## 6. Changes this makes

**Reason generator (`MOTIVATION-REASON-PROMPT.md`)**
- Rule 10 becomes a warning, not a stop: the paragraph is always produced; `blockers`
  is renamed `warnings` and shown to the applicant as "the Registrar may ask about this".
- New preferred angle for handguns and rifles: `exercise_eligibility` - the applied-for
  firearm is eligible for a named association exercise that a held firearm of the same
  type is not (by calibre floor, barrel length, action or class rule), with the rule
  quoted from `association_activities[]`.
- The battery sentence names section and status for each held firearm, as the tables do.

**Rebuild brief (`MOTIVATION-REBUILD-BRIEF.md` §5.5a, §5.6)**
- `association-activities.ts` entries carry, per exercise: name, distance, firearm class,
  eligibility rule (calibre floor/ceiling, barrel length, action, box-to-fit), status it
  counts toward (hunter / sport), source URL and `verifiedAt`. Seed NHSA from
  natshoot.co.za's postal exercise pages and SAHGCA from sahunters.co.za's exercise
  pages; operator reviews.
- The pack binds, as an annexure, the rules of the exercises the reason names, in the
  association's words with source line.
- Battery table rendered from data with a status column that shows section, "dedicated",
  and any disclosed event (stolen, lost) from the history answers.
- Engala-style cover checklist as page 2.
- Length bands stay as set in the UX review; the corpus confirms the argument is under
  400 words even in a 40-page pack.

**Intake plan** - no change. The premises block, the history table and the cards are all
present in the corpus in the shapes already specified.

## 7. Files worth keeping as fixtures

- `Suggested-generic-layout-of-motivation.pdf` - the NHSA writer's own template; the
  closest thing to a spec the industry has. Copy to `docs/history/`.
- `Example-motivation-or-Sport-handgun.docx` - the NHSA postal exercise list with
  eligibility rules, as a seed for `association-activities.ts`.
- `Gerstner G - (Barrett 5.56...)` pages 9 and 27-35 - battery table with a stolen
  disclosure, and a complete exercise-rules annexure.
- `1 - Motivering - SD New - Gerhard.pdf` plus `2 - Suport Doc Midrand.pdf` and
  `3 - police_station_figures_Midrand2016.pdf` - the S13 shape and its two annexures.
- `Binder2 - motivation 30-06 - Fourie.pdf` - a complete Engala pack: checklist, filled
  271 by the writer, consent letter, motivation. This is what "the pack" means.
