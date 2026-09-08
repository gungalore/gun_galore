# Reason generator: prompt and contract

Purpose: given the applicant's arsenal, the firearm applied for, the licence type, and
their previous motivations with us, produce the "why this firearm" paragraph (180-320
words) plus concrete examples (quarry, disciplines, formats, terrain) the motivation can
build on. Runs before the writer; its output goes into the fact pack as
`reason { angle, paragraph, examples[], continuity }` and is shown to the applicant as a
prefilled, editable card. The applicant confirms it; only then is it theirs.

Model: Gemini (operator, 2026-09-07), through `common/llm` with the Gemini provider, no
search tool on this call. Research facts (`research{}`) and the association activity list
arrive already fetched; this call composes, it does not look anything up. Use Gemini's
native JSON output (`responseMimeType: application/json` + the schema in §Output via
`gemini-schema.ts`), temperature 0. Gemini is more prone than the Anthropic writer to
product-page phrasing and to remembered division names, so the code validator below is
mandatory, not defensive: no output reaches the applicant without passing it.

Three inputs decide whether the paragraph is any good, and all three come from documents,
not from the applicant:
- `endorsements[]`: the association's per-firearm endorsement (SAHGCA form: type, calibre,
  make, action, serial, status type, endorsement number, issue date). One for the firearm
  applied for; one for each owned firearm that has one in the vault. An owned firearm's
  endorsement IS its `primary_use` ("SAHGCA sport-shooting exercises, endorsed
  EN0064879SS"); the "roles_unconfirmed" warning only arises for a same-type firearm with
  neither an endorsement nor a stated use.
- `association_activities[]`: what the endorsing association actually runs, from a
  library keyed on the SAPS accreditation number (SAHGCA 400001 hunting / 1300091 sport;
  Natshoot, SAPSA, SA Wingshooters, CHASA, etc.), with the firearm types each exercise
  uses. Tier 1: researched once per association, cached, never asked. The paragraph may
  name activities from this list only.
- `previous_motivations[]`: the storyline.

The CFR-verifiable chain the paragraph must make explicit: status (dedicated number) →
endorsement (this firearm, this serial, suitable for hunting/sport shooting, EN number)
→ activity (the association's named exercises this firearm type is used in) → gap (which
held firearm cannot do that job, by its own endorsement or section). Every link points at
an annexure in the same pack. The endorsement footer says it "does not replace the
personal motivation"; this paragraph is that motivation.

---

## System prompt

```
You write the "reason" section of a South African firearm licence motivation under the
Firearms Control Act 60 of 2000. You are given structured facts about one applicant and
one firearm. You return one paragraph and a short list of examples. Nothing else.

WHO READS IT
A Designated Firearms Officer and then the Central Firearms Register. They read hundreds
of these. They refuse applications that (a) do not explain why this firearm when the
applicant already holds a similar one, (b) argue in generalities that do not fit the
section applied for, or (c) claim things the annexures do not support. They approve
applications that name the existing firearms, give each a role, give this firearm a
different role, and tie that role to something concrete: a species and range band, a
discipline and its equipment rules, a documented threat.

ABSOLUTE RULES
1. Use only the facts supplied. Do not invent a hunt, a competition, a farm, an incident, a
   family member, a job duty or a date. If a fact you want is absent, argue without it.
2. Name every existing firearm in the same class (make, model, calibre) and say what it is
   for before saying what the new one is for. Never write around the arsenal.
3. Never contradict a previous motivation. If a firearm was described as "my plains-game
   rifle" in an earlier motivation, it is still that. Build on the storyline; do not
   rewrite it.
4. The reason must fit the section:
   - S13 self-defence: a need for protection of the person, one firearm only, argued from
     circumstances (area, movement, dependants, existing measures). No hunting or sport
     content. Never "in case" or "peace of mind" alone.
   - S15 occasional hunting/sport: a genuine, described activity and a firearm suited to
     it; no dedicated-status language.
   - S16 dedicated hunter: quarry, terrain, ranges, the association's hunting exercises,
     the role gap in the battery.
   - S16 dedicated sport: the discipline and its equipment rules, division or format,
     the role gap (division, backup, match/practice, format, configuration).
   - S24 renewal: continued use for the original purpose; nothing new.
5. Never offer these as reasons: collecting, investment, appreciation, "because I can",
   variety, a gift, resale value, "my friend has one", or anything about the firearm being
   rare or desirable. Never propose a fully automatic firearm as licensable.
6. Never quote the Act. Name a section by number in plain words if needed.
7. No marketing copy, no superlatives, no manufacturer history, no ballistics tables. One
   or two capability facts from the research block, in plain words, are enough.
8. First person, the applicant's voice, plain South African English, no Americanisms
   ("calibre", "licence", "metres"). Short sentences. No headings, no bullets, no
   exclamation marks.
9. 180 to 320 words for the paragraph, as two paragraphs: the battery and the gap, then
   the firearm and its use. Count. A battery of five needs the room; a battery of one does
   not, so stay near the floor when there is little to say.
10. If the facts leave the distinction thin (a fourth 9mm handgun with three already
    described as backup, match and practice), say so in `warnings` and still write the
    best honest paragraph. Do not manufacture a distinction and do not refuse to write.
    The Registrar has approved thinner cases than this when the bundle was complete; the
    warning is for the applicant's eyes, not a gate.

SECTION DISCIPLINE FOR EXISTING FIREARMS (this is where refusals come from)
11. Every existing firearm carries the section it is licensed under. That section fixes
    the words you may use for it:
    - S13 or S14: self-defence, carry, protection of the person. Nothing else.
    - S15: occasional hunting or sport shooting. Never self-defence, protection, backup,
      carry, home defence.
    - S16: dedicated hunting or dedicated sport shooting. Never self-defence, protection,
      backup, carry, home defence.
    - S17: collection. Never a use of any kind.
    Describing a section 16 handgun as "backup" or "close protection" tells the Registrar
    the applicant uses a sport firearm outside its licence. It is a refusal on its own.
12. A role for an existing firearm comes ONLY from `primary_use` or from a previous
    motivation's `stated_purpose`. If neither is supplied, do not assign one. Write the
    firearm with its calibre and section and nothing more ("a CZ in 6.35mm Browning,
    licensed under section 16"), list it in `existing_roles` with source "none", and add
    "roles_unconfirmed" to `warnings`. Never write "for precision work", "for small-game",
    "for backup" or any role you were not given.
13. Make, model, calibre and association names appear in the paragraph only as they
    appear in the input, spelled the same way. If `applied_for.model` is absent, write
    "the 9mm handgun applied for", not a model you believe is likely. If no association
    is in the input, name none.
14. Discipline, exercise and division names come only from `association_activities[]`
    of the association that endorsed the firearm, or from `cards_tapped`. Do not supply
    divisions from memory and do not name another association's disciplines. An SAHGCA
    endorsement means SAHGCA exercises, not IPSC. ("Carry Optics" is a USPSA division and
    does not exist in South African shooting.)
14a. When `endorsements[]` contains one for the firearm applied for, the paragraph must
    state it in one sentence: association, status type, that this firearm (make, calibre,
    serial) is endorsed as suitable, and the endorsement number. When an owned firearm has
    an endorsement, its role is that endorsement's status type and nothing else.
14b. The gap sentence must name the held firearm that cannot do the job and say why in
    terms the pack proves: a different type (rifle vs handgun), a different endorsed
    status (hunting vs sport), or a different section. Not calibre opinion unless
    `research` supplies the exercise's calibre requirement.
15. Banned phrasing: power factor, split times, high-volume, platform, tactical, close
    protection, engage targets, dynamic, competitively (as an adverb), efficiently,
    dedicated (as a synonym for "used for"), any sentence that reads like a product page.

METHOD (do this silently, return only the JSON)
a. Classify the applied-for firearm: type, action, calibre band, configuration.
b. For each existing firearm: same class? same calibre band? what role does the applicant
   already give it (from primary_use or previous motivations)?
c. Choose ONE angle from the allowed list for the section (below). Prefer the angle a
   supplied document already uses (association endorsement wording, a previous
   motivation). Prefer the angle that is verifiable from the firearms themselves.
d. Pick 3 to 6 concrete examples that fit the angle and the calibre: species with range
   bands, disciplines with the equipment rule that matters, terrain and provinces, match
   formats. Use only examples consistent with the research block and with South African
   hunting and sport-shooting practice.
e. Write the paragraph: existing firearms and their roles (2-3 sentences), the gap
   (1-2), this firearm and why it fills it (3-5), what the applicant will do with it
   (2-3, drawing on the examples), one sentence tying it to the section.

ALLOWED ANGLES
hunting: species_class_gap | range_band_gap | terrain_configuration | backup_for_remote_trips |
         dedicated_load_development | wingshooting_vs_rifle | first_hunting_rifle |
         exercise_eligibility
sport:   exercise_eligibility | division_differentiation | primary_and_backup |
         match_and_practice | different_format | classification_progression |
         physical_configuration | first_competition_firearm

PREFERRED ANGLE: exercise_eligibility. When `association_activities[]` carries an
exercise with an equipment rule (calibre floor or ceiling, barrel length, action, class,
box-to-fit) that the applied-for firearm meets and a held firearm of the same type does
not, lead with it and quote the rule. "The association's 7m rapid-fire handgun exercise
is open only to 9mmP pistols and larger; my 6.35mm CZ shoots the 5m pocket-pistol
exercise and cannot enter it." That is a gap the reviewer can check against the annexed
rules, and it is what the approved packs on file actually do.

THE BATTERY SENTENCE names each held firearm with make, calibre, type, section and
status, the way the packs' tables do: "a CZ 6.35mm handgun (section 16, dedicated)".
A disclosed event from the history answers is stated in the same breath, plainly:
"(section 13; reported stolen, CAS 123/4/2024)".
self_defence: concealability_for_carry | home_defence_vs_carry (only if no S13 held) |
         first_self_defence_firearm
renewal: continued_use

OUTPUT
Return exactly one fenced JSON block:

{
  "angle": "<one of the allowed angles>",
  "paragraph": "<150-250 words>",
  "examples": [
    { "kind": "species|discipline|format|terrain|threat", "label": "<short>",
      "detail": "<one sentence: range band, equipment rule, province, or circumstance>" }
  ],
  "existing_roles": [
    { "firearm": "<make model calibre>", "role": "<as stated or inferred>",
      "source": "primary_use|previous_motivation|inferred" }
  ],
  "continuity": "<one sentence on how this fits the applicant's previous motivations, or 'first application'>",
  "warnings": ["<only if rule 10 applies>"],
  "word_count": <integer>
}

Anything marked "inferred" in existing_roles is a suggestion the applicant must confirm;
say so by keeping it out of the paragraph unless no stated role exists.
```

---

## User message (built by code, one JSON object)

```json
{
  "licence_type": "S16_DEDICATED_SPORT",
  "applicant": {
    "occupation": "Salesperson, outdoor retail",
    "province": "Western Cape",
    "residence_type": "flat",
    "dependants": 0,
    "reloads": { "yes": true, "calibres": ["9mm", ".308 Win"], "since": 2021 }
  },
  "applied_for": {
    "type": "Handgun", "action": "Semi-automatic", "make": "CZ", "model": "Shadow 2 OR",
    "calibre": "9mm Parabellum", "configuration": ["optics-ready", "5-inch barrel"]
  },
  "arsenal": [
    { "make": "CZ", "model": "P-10 C", "calibre": "9mm Parabellum", "type": "Handgun",
      "section": "S13", "licence_expiry": "2029-03-01",
      "primary_use": "self-defence carry" },
    { "make": "Howa", "model": "1500", "calibre": "6.5 Creedmoor", "type": "Rifle",
      "section": "S16", "primary_use": "plains game to 300 m" }
  ],
  "associations": [
    { "name": "SAPSA", "accreditation": "1300xxx", "status": "dedicated sport shooter",
      "since": "2022-04-11", "dedicated_no": "..." }
  ],
  "endorsements": [
    { "for": "applied_for", "association": "SAPSA", "status_type": "sport",
      "firearm": "Handgun 9mm Parabellum CZ Shadow 2 OR self-loading", "serial": "…",
      "number": "…", "issued": "2026-08-30" }
  ],
  "association_activities": [
    { "association": "SAPSA", "name": "IPSC Handgun, Production Optics division",
      "firearm_types": ["Handgun"], "rule": "slide-mounted optic permitted; Production prohibits it" },
    { "association": "SAPSA", "name": "Club league, monthly", "firearm_types": ["Handgun"] }
  ],
  "activity": {
    "competitions_24m": ["club league monthly", "WP provincial 2025"],
    "disciplines": ["IPSC Handgun Production"]
  },
  "cards_tapped": [
    "I want to compete in Production Optics, which my current handgun is not set up for.",
    "I want to shoot the association's postal exercises with suitable equipment."
  ],
  "research": {
    "firearm": "CZ Shadow 2 OR: steel-framed competition 9mm with optics-ready slide, used in IPSC Production Optics; not a carry configuration.",
    "discipline": "IPSC Production Optics permits a slide-mounted optic on a production-list handgun; Production division does not.",
    "sources": ["ipsc.org handgun rules 2024 §D", "cz-usa.com"]
  },
  "previous_motivations": [
    { "ref": "MO000031", "date": "2024-06-02", "licence_type": "S13_SELF_DEFENCE",
      "firearm": "CZ P-10 C 9mm",
      "stated_purpose": "compact handgun carried daily for personal protection; works in retail with cash handling",
      "outcome": "approved" },
    { "ref": "MO000047", "date": "2025-02-14", "licence_type": "S16_DEDICATED_HUNTER",
      "firearm": "Howa 1500 6.5 Creedmoor",
      "stated_purpose": "plains game in the Karoo and Overberg to 300 m; biltong hunting each winter",
      "outcome": "approved" }
  ],
  "constraints": {
    "s13_held": true,
    "overlap": { "same_calibre": ["CZ P-10 C 9mm"], "same_type": ["CZ P-10 C 9mm"],
                 "suggested_angle": "division_differentiation" }
  }
}
```

Fields that are unknown are omitted, never sent as null or "unknown". `research` may be
empty; the model then writes without capability facts.

---

## Expected output for the example

```json
{
  "angle": "division_differentiation",
  "paragraph": "I hold two firearms. My CZ P-10 C in 9mm is licensed under section 13 and is the compact handgun I carry daily for personal protection, as set out in my earlier application; it is not a competition firearm and I do not use it as one. My Howa 1500 in 6.5 Creedmoor is my plains-game rifle for the Karoo and Overberg. Neither firearm serves the sport I compete in. I have shot IPSC Handgun in the Production division with SAPSA since 2022, in the monthly club league and at the 2025 Western Province provincial. I now want to compete in Production Optics, which allows a slide-mounted optic and which the Production division does not. A carry handgun with a short slide cannot be set up for it without changing what it is licensed for. The CZ Shadow 2 OR is a steel-framed 9mm built for this division, with an optics-ready slide and a five-inch barrel; it is heavier and larger than my carry pistol and is not a carry firearm. It will be my competition handgun for Production Optics matches and the association's postal exercises, while the P-10 C stays what it has always been. Applying under section 16 as a dedicated sport shooter, this firearm is for the discipline I already practise, in a division I cannot enter with what I hold.",
  "examples": [
    { "kind": "discipline", "label": "IPSC Handgun Production Optics",
      "detail": "Slide-mounted optic permitted; Production division prohibits it." },
    { "kind": "format", "label": "SAPSA club league, monthly",
      "detail": "Regular match attendance the association records for dedicated status." },
    { "kind": "format", "label": "Provincial championship",
      "detail": "Multi-stage event where division equipment rules are enforced." },
    { "kind": "format", "label": "Association postal exercises",
      "detail": "Scored exercises shot at the home range and submitted to the association." }
  ],
  "existing_roles": [
    { "firearm": "CZ P-10 C 9mm", "role": "daily carry for self-defence", "source": "previous_motivation" },
    { "firearm": "Howa 1500 6.5 Creedmoor", "role": "plains game to 300 m", "source": "primary_use" }
  ],
  "continuity": "Consistent with MO000031 (P-10 C as carry) and MO000047 (Howa as plains-game rifle); this is the first sport handgun and does not change either earlier role.",
  "warnings": [],
  "word_count": 231
}
```

---

## Per-type example banks the model may draw from

Give these to the model inside `research` when the research layer has nothing better;
they are the fallback, kept in `motivation-cards.ts` next to the card sentences so the
operator reviews them once.

Hunting, by calibre band (range bands are typical SA practice, not law):
- .22 LR / .22 Hornet / .223: small game, jackal, springhare, practice; to 150 m
- .243 / 6.5x55 / .270 / 7x57: springbok, impala, blesbok, reedbuck; 150-300 m open ground
- 6.5 Creedmoor / .308 / .30-06 / 7mm Rem Mag: kudu, gemsbok, blue wildebeest, red
  hartebeest; 100-300 m, Karoo, Free State, Eastern Cape hills
- .375 H&H and up: eland, buffalo where permitted; provincial minimums apply
- .45-70 / lever guns / short carbines: bushveld, thick cover, under 100 m, follow-up shots
- 12 / 20 gauge: wingshooting (guineafowl, francolin, rock pigeon, waterfowl), clays

Sport, by discipline (equipment rule that matters):
- IPSC Handgun: Production (no optic, list handguns), Production Optics (slide optic),
  Standard (no optic, box), Open (optic + compensator), Classic (1911 pattern)
- IPSC/PPC/Practical Shotgun: semi-auto vs pump divisions, magazine capacity limits
- IPSC Rifle / 3-Gun: semi-auto rifle, optic divisions, stage round counts
- Precision Rifle Series / F-Class: heavy barrel, chassis, calibre by class (F-TR .308/.223)
- Bisley / target rifle, service rifle, silhouette, benchrest: calibre and sight rules
- Clays: trap, skeet, sporting; 12/20 gauge, over-under vs semi-auto
- Association exercises (SAHGCA, NHSA, Natshoot): hunting-derived exercises open to most
  firearm types; monthly and postal

Self-defence, circumstances the paragraph may use if supplied as facts:
precinct crime figures (from `crime-stats`), occupation involving cash or stock, night
travel, smallholding without armed response, dependants at home, load shedding and
perimeter power, rented property, prior incident with CAS number, existing measures the
firearm supplements.

---

## Validator (code, after the call)

Reject and retry once, then fall back to the templated preview paragraph, if any of:
- `word_count` outside 180-320 or does not match a real count of `paragraph`
- `angle` not in the allowed list for the licence type
- any make/model/calibre in `paragraph` not present in `applied_for` or `arsenal`
- any string in `examples[].label` not present in `research`, `cards_tapped`,
  `associations`, `activity` or the fallback banks
- `paragraph` contains: "collect", "investment", "appreciat", "peace of mind", "in case",
  "automatic" (unless "semi-automatic"), "Act 60 of 2000" quoted text, an exclamation mark
- for S13: any of "hunt", "compet", "discipline", "match"
- for S15/S16 hunting: "self-defence", "protect"
- `existing_roles` omits any arsenal item of the same type as `applied_for`
- `existing_roles[].source` is "inferred" or "none" for any firearm whose role words
  appear in `paragraph` (a role may only be written when stated)
- for each arsenal item with `section` S15/S16/S17, the sentence naming it contains any of
  "defence", "defense", "protect", "backup", "back-up", "carry", "home"; for each S13/S14
  item, the sentence naming it contains any of "hunt", "compet", "match", "discipline"
- any make or model token in `paragraph` that is not a token of `applied_for` or an
  `arsenal[]` entry (case-insensitive, punctuation stripped); this catches an invented
  firearm as well as an invented model
- any association or division name in `paragraph` not present in `associations[]`,
  `research`, `activity` or `cards_tapped`
- any banned phrase from rule 15
- `continuity` contradicts a `previous_motivations[].stated_purpose` (string-check the
  firearm's role words; a model-judged check is not needed here)

Log `angle`, `word_count`, `warnings` per generation so the operator can see which
angles the CFR approves over time.

---

## Negative example (operator's own vault, 2026-09-07)

Input: arsenal CZ 6.35mm Browning (S16), Mauser .30-06 (S16), Marlin .45-70 (S16), Howa
6.5 Creedmoor (S15), Nordiske Precision .223 (S16); no `primary_use` on any; applied for a
Glock 9mm handgun under S16 dedicated sport. Generator returned:

> I currently hold a CZ in 6.35mm Browning which is dedicated to backup use and close
> protection, alongside four rifles comprising a Mauser in .30-06 Springfield for plains
> game, a Marlin in .45-70 Government for heavy bushveld hunting, a Howa in 6.5mm
> Creedmoor for precision long-range shooting, and a Nordiske Precision in .223 Rem for
> small-calibre target work. None of my existing firearms are suited to action shooting
> sports governed by the South African Practical Shooting Association. To participate
> competitively in dynamic sport shooting disciplines, I require the Glock semi-automatic
> handgun in 9mm Parabellum applied for here. This specific platform allows me to compete
> in the Production and Carry Optics divisions where the 9mm calibre meets the power
> factor floor efficiently and permits rapid split times and high-volume practice. ...

Faults, each now a rule and a validator line:
- "backup use and close protection" on an S16 handgun: rule 11. Admits use outside the
  licence. Refusal trigger.
- Roles for all five firearms invented: rule 12. None was supplied.
- "Carry Optics": rule 14. Not an IPSC division.
- "South African Practical Shooting Association": rule 13 if not in input.
- "platform", "power factor floor efficiently", "rapid split times", "high-volume",
  "dynamic", "competitively": rule 15.
- "Glock semi-automatic handgun" with no model: rule 13; write "the Glock 9mm applied
  for" only if make is in the input.

The vault in fact holds the answers the generator lacked. Three SAHGCA endorsements are on
file (member 108828, dedicated sport shooter SA115153SS, accreditation 400001 / 1300091):
EN0064879SS for the CZ 6.35mm Browning handgun, EN0064880SS for the Glock 9mm handgun
(serial ZABA01892), EN0066291SS for the Nordiske Precision .223 carbine, all "suitable for
sport shooting". With `endorsements[]` and SAHGCA's `association_activities[]` supplied,
the same application should produce:

> I am a dedicated sport shooter with the SA Hunters and Game Conservation Association,
> dedicated number SA115153SS, and I hold five firearms: four under section 16 and my Howa
> in 6.5mm Creedmoor under section 15. Two carry SAHGCA sport-shooting endorsements: my CZ
> handgun in 6.35mm Browning (EN0064879SS) and my Nordiske Precision carbine in .223
> Remington (EN0066291SS) are used in the association's shooting exercises, and my Mauser
> in .30-06 Springfield and Marlin in .45-70 Government (section 16) and the Howa (section
> 15) are my hunting rifles. SAHGCA has
> endorsed the Glock handgun in 9mm Parabellum, serial ZABA01892, as suitable for sport
> shooting (EN0064880SS). The association's handgun exercises are shot with a
> service-calibre handgun; my CZ is a 6.35mm pocket pistol and is not the firearm those
> exercises are set for, and none of my rifles can be used in a handgun exercise at all.
> The Glock will be my handgun for SAHGCA's handgun exercises, club shoots and postal
> shoots, while the CZ and the carbine continue in the exercises they are already used for
> and the rifles remain hunting rifles. Applying under section 16 as a dedicated sport
> shooter, this firearm fills the one place in my battery the association's own programme
> leaves open.

`existing_roles`: CZ and Nordiske `source: "endorsement"`; Mauser, Marlin, Howa
`source: "previous_motivation"` (the Fourie hunting packs on file) or `"none"` if those
are not loaded, in which case the rifle sentence drops "hunting" and says "licensed under
section 16" only. The "service-calibre handgun" clause is permitted only if
`association_activities[]` carries that rule for SAHGCA's handgun exercises; otherwise
the gap rests on type alone ("none of my rifles can be used in a handgun exercise"),
which is still true and still provable. `warnings: []`.

Operationally: the sheet must load every endorsement in the vault into `endorsements[]`
(kind `ASSOCIATION_ENDORSEMENT`; OCR the SAHGCA form: member no, dedicated no, status type,
the firearm row, EN number, issue date) and resolve `association_activities[]` from the
accreditation number before this call runs. The generator is the last line of defence,
not the first.

## Storyline

Store, per approved application: `firearm`, `licence_type`, `angle`, `stated_purpose`
(the first sentence of the reason paragraph that names the role), `date`, `outcome`.
Feed the list in `previous_motivations` on every later call. Rules the prompt already
enforces: a role once stated is permanent; a new firearm gets a new role; the paragraph
names the old roles first. This is what makes the third and fourth application read as
one person's progression rather than four unrelated documents, which is the thing the CFR
actually checks.
