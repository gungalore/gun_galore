# The generate prompt: why MO000071 came out the way it did, and the replacement

Date: 2026-09-08. Source: `motivationpromptsS13.txt` (dump of the exact strings sent to
Gemini for S13 on 2026-09-08). Read alongside `MOTIVATION-S13-OUTPUT-REVIEW.md`; every
fault found in the document traces to a line in this prompt.

## 1. Diagnosis

**The structure asks for the product copy the rules forbid.** Rule 1 bans specifications.
The STRUCTURE then demands "4. Suitability of the firearm (about 4 paragraphs) ... use the
specification ... the cartridge, the ballistics at the ranges named, the action, the barrel,
the capacity, the mass" and "5. Why this cartridge for self-defence (about 4 paragraphs)".
Eight paragraphs about a Glock and 9mm in a self-defence motivation is what came out, because
the structure is the last and most concrete instruction and the model obeys it. Section 4's
guidance is a hunting/sport template ("in which discipline and at which stage or course of
fire, or on which species and at what range") reused for S13 unchanged.

**The arsenal is not in the facts.** `<applicant-facts>` carries `<derived name="firearms
already held">5</derived>` and nothing else about them: no makes, calibres, types, sections
or serials. The prompt then says "The applicant already holds a handgun. Meet that head on:
say what this one does that the one held does not." The writer was told to compare against
firearms it was never shown. Everything it wrote about the Mauser, Marlin, Howa, Nordiske
and CZ, including "section 15", was invented to satisfy that instruction. The reason
paragraph produced on the sheet (which does know the arsenal) is not passed to the writer
either.

**Paragraph budget contradicts the word budget.** The structure asks for about 26
paragraphs (1+4+2+4+4+3+3+2+3+1); rule 13 says 900 to 1,400 words. At 26 paragraphs that is
40 words each, so the model either pads or ignores the word band. It padded.

**Direct contradictions.** "Close by drawing the threads together in a short summary" sits
directly under a section 10 that says "No summary of everything above". Rule 9's
training-firearm rationale ("a firearm bought to do the practice is a firearm bought for
the sport") is sport content in an S13 prompt. Rule 4 contains a paragraph explaining that
it "said the opposite until now". Section 10 contains a paragraph about a bug in an earlier
worked example.

**The prompt is a changelog, not a spec.** Roughly a third of the system prompt is history:
what the rule used to say, which draft provoked it, what the operator decided on which
date. That belongs in code comments. A model reading "this rule said the opposite until now"
has two rules in front of it. Gemini in particular follows the most recent concrete
instruction and treats hedged history as licence.

**The gate cannot catch the worst fault.** It receives the same facts block, so it has no
arsenal to check the comparison against. It passed five invented sections and five invented
roles because nothing in its input contradicted them.

**Headings do not match the document design.** "Introduction:", "My situation:",
"Compliance history:" with trailing colons are what produced the inline numbered headings in
the PDF, and they are not the heading set in `MOTIVATION-LAYOUT-SPEC.md`.

## 2. Principles for the rewrite

- The prompt is a spec: rules, structure, facts. No history, no apologies, no worked
  examples of past bugs. Decision history lives in `motivation-prompts.ts` comments.
- Everything the document may say about a firearm, held or applied for, is in the facts as
  a structured row. The count is never sent without the rows.
- The reason paragraph from the sheet is supplied to the writer as a fact block and used
  verbatim or lightly fitted; the writer does not compose a second comparison.
- Structure is per licence type, with the layout spec's headings, a paragraph count that
  fits the word band, and no firearm or cartridge section in S13 beyond one paragraph.
- The writer never produces tables or placeholders; the renderer inserts the owned-firearms
  table from `arsenal[]` between the two prose blocks of that section. The prompt says so.
- One rule per idea, stated once. If two rules would conflict, the structure wins and says
  so.

## 3. Replacement: S13 system prompt

```
You draft the motivation that accompanies a South African firearm licence application.
The applicant signs it and files it with the Registrar of Firearms as their own account.

THE LAW ENGAGED
Section 13 of the Firearms Control Act 60 of 2000: a licence to possess one firearm, a
handgun or a shotgun that is not fully automatic, for self-defence. The Registrar must be
satisfied that the applicant needs a firearm for self-defence and cannot reasonably meet
that need by other means.

WHAT THE REVIEWER WEIGHS
This applicant's circumstances: where they live and move, what has happened there, what
they have already done about it, and why that is not enough. Specific beats general.

RULES
1. Facts come only from <applicant-facts>, <arsenal>, <reason> and <background-research>.
   Never invent an event, date, place, person, incident, qualification, membership,
   possession, statistic, measurement, capacity, weight, length or design feature. A
   hedge ("about", "typically") does not make a recalled figure admissible. If a fact is
   absent, argue without it and write less.
2. Every firearm the applicant holds is in <arsenal>, one row each, with its section and
   its licensed purpose where those were read from the licence or an endorsement. Name each
   with make, calibre and type. State its section only where the row carries one. Never
   assign a use to a held firearm that its row does not state; where the row has none, name
   the firearm and stop. A section 15 or 16 firearm is never described with self-defence,
   protection, carry, backup or home-defence words.
3. <reason> is the applicant's confirmed comparison paragraph. Use it as the substance of
   the "Firearms already licensed to me" section; fit its sentences to the document, do not
   contradict it and do not write a second comparison.
4. Write in the first person as the applicant. Never mention a service, platform,
   assistant or drafter.
5. Never predict or estimate the outcome. Ask for the licence; do not say it should be
   granted.
6. Quote the Act only from <statutory-text>, only in the section headed "Section 13
   applied to my case", verbatim and numbered as given; under each quoted element put the
   applicant's fact that meets it. Quote only elements you answer. Everywhere else name the
   section by number in plain words.
7. Cite an annexure only from the list given, only after a sentence that annexure proves,
   in the form "(Annexure C: SAPS competency certificate)". Most sentences are uncited.
8. No marketing, no manufacturer history, no cartridge history, no ballistics, no
   superlatives. Banned words: platform, tactical, terminal, stopping power, high-capacity,
   magazine capacity, split times, power factor, engage, dynamic, efficiently, close
   protection. One sentence on why a handgun (it can be carried on the person) and one on
   the calibre (a common service calibre; ammunition and training readily available) is
   the whole of the firearm argument.
9. No hunting, sport shooting, competition, association or reloading content. This is a
   self-defence motivation.
10. Plain South African English: licence (noun), license (verb), calibre, self-defence,
    favourable, authorisation, metres. Short sentences. Left to right, no flourish.
11. Do not assert the absence of a criminal record or of any adverse history. The
    declarations are on the SAPS form; SAPS verifies them.
12. Identify the applicant with full name and ID number in the first paragraph, and the
    firearm with type, make, model (if given), calibre and serial where it is introduced,
    verbatim from the facts.
13. Length: 850 to 1,200 words of prose. The structure below fixes the paragraph count;
    do not add paragraphs to reach the range, and come in under it when the facts are thin.

FORMAT
Return the motivation body only. Use the section headings supplied, each on its own line
with no number and no colon, a blank line, then that section's paragraphs separated by
blank lines. No markdown, no bullets, no tables, no placeholders. We insert the
owned-firearms table and number the headings when the document is typeset.
```

## 4. Replacement: S13 user prompt (structure and facts)

```
Draft the motivation for a section 13 self-defence application.

STRUCTURE. Eight sections, these headings, this order, these paragraph counts.

Application (1 paragraph)
  Who I am (full name, ID number), what I apply for (type, make, model, calibre, serial),
  under section 13, for self-defence. One sentence that I hold no section 13 licence and
  that nothing I hold serves this purpose.

Why I need a firearm (3 paragraphs)
  Where I live and the precinct's figures from the research block, quoted exactly with
  period and source. My routine and movements from the facts, and the figures for the
  precincts I pass through where the research block carries them. What has happened to or
  near me only where the facts state it, cited to its clipping. Sober; no national
  statistics; no fear language.

What I have already done, and why it is not enough (1 paragraph)
  The premises measures from the facts, then why they do not cover the situations in the
  previous section (the road, arriving home, away from the property).

The firearm, and how I would keep it (2 paragraphs)
  First: a handgun is the firearm that can be carried on the person and kept out of sight;
  the calibre is a common service calibre. Nothing more about the firearm. Second: how I
  would carry and keep it, from the carry-style facts, and the safe: type, mounting, key
  holder, from the facts, cited to the safe photographs.

Firearms already licensed to me (2 paragraphs)
  First paragraph: one or two sentences introducing the list ("I hold five firearms. None is
  licensed for self-defence and none can be carried on the person.") citing the licences
  annexure. We insert the table here. Second paragraph: the <reason> text, fitted.

Competency (1 paragraph)
  Certificate number and what it covers, from the facts, cited. Proficiency training where
  the facts give it. No expiry date.

Section 13 applied to my case (quote, then 1 paragraph)
  Quote 13(1)(b), 13(2)(a), 13(2)(b) and 13(3) verbatim from <statutory-text>. Then one
  paragraph mapping each to the section of this document that answers it.

Declaration (1 paragraph)
  That the facts are true, that I prepared the document with assistance from information I
  supplied and submit it as my own, an undertaking to store and use the firearm as the Act
  requires, and the request: "I respectfully request the Registrar to issue me with a
  licence under section 13 for the [make] [calibre] handgun, serial [no], for self-defence."

<statutory-text>
[section 13 verbatim, as now]
</statutory-text>

<arsenal>
One row per firearm the applicant holds, exactly as read from their licences and
endorsements. Fields absent were not read and must not be supplied.
<firearm make="Mauser" model="" type="Rifle" action="Bolt" calibre=".30-06 Springfield"
  serial="96008993" section="16" licensed_for="Dedicated hunting" expires="2034-10-28"/>
<firearm make="Marlin" type="Rifle" action="Lever" calibre=".45-70 Government" section="16"
  licensed_for="Dedicated hunting" expires="2034-10-28"/>
<firearm make="Howa" type="Rifle" action="Bolt" calibre="6.5mm Creedmoor" serial="B477423"
  section="15" licensed_for="Occasional hunting" expires="2032-11-28"/>
<firearm make="Nordiske Precision" type="Carbine" action="Self-loading" calibre=".223 Remington"
  serial="ZA2226548" section="16" licensed_for="Dedicated sport shooting"
  endorsement="SAHGCA EN0066291SS" expires="2035-09-21"/>
<firearm make="CZ" type="Handgun" action="Self-loading" calibre="6.35mm Browning" serial="81815"
  section="16" licensed_for="Dedicated sport shooting" endorsement="SAHGCA EN0064879SS"
  expires="2035-08-26"/>
</arsenal>

<reason>
[the confirmed reason paragraph from the sheet, verbatim]
</reason>

<background-research>
[precinct figures with period and source; clippings with paper, date, headline, annexure
letter; nothing about the firearm or cartridge for S13]
</background-research>

ANNEXURES (cite only these, exactly):
  Annexure A: Identity document
  Annexure B: Proficiency statement of results
  Annexure C: SAPS competency certificate
  Annexure D: Proof of residential address
  Annexure E: Photographs of the safe
  Annexure G: Existing firearm licences
  Annexure I: Press clippings and precinct figures

<applicant-facts>
[as now, plus every card the applicant tapped, the premises answers, carry style, the
competency number and classes, marital status and employer only if the structure uses them
(it does not for S13)]
</applicant-facts>

Write the document now.
```

## 5. Changes to the gate

- Give the gate `<arsenal>` and `<reason>`. Add to groundedness: any make, calibre, type,
  section or licensed purpose attached to a held firearm that does not match its
  `<arsenal>` row is ungrounded and drags the score below 50.
- Add to consistency: any self-defence vocabulary attached to a section 15/16 firearm, or
  any hunting/sport vocabulary in an S13 document.
- Add a mechanical pre-gate in code (no model): banned-word scan, section-per-firearm
  match, ID and serial presence, expired competency, word band, heading set exact. Only a
  document that passes the pre-gate reaches the model gate. This is the validator from
  `MOTIVATION-REASON-PROMPT.md` applied to the whole document.
- Remove the duplicated "specificity" block and the statute history paragraphs; state each
  scoring rule once.

## 6. Per-type structures (headings from the layout spec)

S15 / S16 hunter: Application · Why I need this firearm · My hunting (quarry, ground,
ranges, association exercises where supplied) · The firearm and how I would keep it ·
Firearms already licensed to me · Competency · Association and dedicated status (S16) ·
Section N applied to my case · Declaration. 1,000 to 1,400 words.

S16 sport: as above with "My sport shooting" (discipline or association exercises from
<association-activities>, formats, the endorsement) in place of hunting.

S24 renewal: Application · Continued use · The firearm and how it is kept · Firearms
already licensed to me · Competency · Section 24 applied to my case · Declaration. 600 to
900 words.

In every type the firearm section is two paragraphs, the comparison is `<reason>`, and the
table is inserted by the renderer.

## 7. Where this goes

`motivation-prompts.ts`: system prompts per licence type from §3 (S13) and its siblings;
structures per type from §4 and §6; decision history moved to comments above each
constant. `motivation-model.service.ts`: build `<arsenal>` from the same `arsenal[]` that
renders the table and fills 271 item 2.1; pass `<reason>`; pre-gate before the model gate.
`motivation-prompt-discipline.spec.ts`: assert no prompt string contains "until now",
"earlier version", "worked example", "operator decision" or a date; assert the S13 prompt
contains none of the banned words in §3 rule 8 outside the rule itself; assert the arsenal
block is present whenever `firearms already held` is greater than zero.
