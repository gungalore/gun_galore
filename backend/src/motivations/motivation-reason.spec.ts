import { MotivationLicenceType } from '@prisma/client';
import {
  REASON_ANGLES,
  anglesFor,
  REASON_MAX_WORDS,
  REASON_MIN_WORDS,
  countWords,
  proseFirearmName,
  reasonSystemPrompt,
  validateReason,
  type ReasonResult,
} from './motivation-reason';

// ────────────────────────────────────────────────────────────────────
// THE REASON GENERATOR'S GUARD RAIL.
//
// The model writes a paragraph that goes onto a document somebody signs, in
// front of a Designated Firearms Officer. Everything asserted here is a way
// that paragraph can be wrong in a manner the applicant would carry the cost
// of — a firearm they do not own, a case that does not fit the section they
// applied under, a reason the CFR refuses on sight.
//
// ⚠️ THE MODEL IS NOT TRUSTED ABOUT ITS OWN OUTPUT, and the word count is the
// cheapest demonstration: it is asked to count and it is asked to obey a range,
// and those are two different failures.
// ────────────────────────────────────────────────────────────────────

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;
const S16S = MotivationLicenceType.S16_DEDICATED_SPORT;
const S16H = MotivationLicenceType.S16_DEDICATED_HUNTER;

/** A paragraph of exactly `n` words that trips none of the content rules. */
const words = (n: number) => Array.from({ length: n }, () => 'shooting').join(' ');

const result = (over: Partial<ReasonResult> = {}): ReasonResult => {
  const paragraph = over.paragraph ?? words(220);
  return {
    angle: 'division_differentiation',
    paragraph,
    examples: [],
    existingRoles: [],
    continuity: 'first application',
    warnings: [],
    wordCount: countWords(paragraph),
    ...over,
    // The count follows the paragraph unless a case is deliberately about the
    // two disagreeing.
    ...(over.wordCount === undefined
      ? { wordCount: countWords(over.paragraph ?? paragraph) }
      : {}),
  };
};

const ctx = (over: Partial<Parameters<typeof validateReason>[1]> = {}) => ({
  licenceType: S16S,
  knownFirearms: ['CZ Shadow 2 9mm', 'CZ P-10 C 9mm'],
  knownTerms: ['IPSC Handgun Production Optics'],
  ...over,
});

describe('the length', () => {
  it('accepts a paragraph in range', () => {
    expect(validateReason(result(), ctx())).toEqual([]);
  });

  it(`refuses one under ${REASON_MIN_WORDS} words`, () => {
    const bad = validateReason(result({ paragraph: words(120) }), ctx());
    expect(bad.join(' ')).toContain('outside');
  });

  it(`refuses one over ${REASON_MAX_WORDS} words`, () => {
    const bad = validateReason(result({ paragraph: words(400) }), ctx());
    expect(bad.join(' ')).toContain('outside');
  });

  it('⚠️ CORRECTS A COUNT THAT DOES NOT MATCH, RATHER THAN REFUSING', () => {
    // Two live generations in a row claimed 218 words for paragraphs of 176
    // and 196. Counting words is a known weakness of something that thinks in
    // tokens, the length rule is already enforced against a REAL count above,
    // and throwing away a good paragraph over the model's arithmetic charges
    // the applicant for our problem.
    const r = result({ paragraph: words(220), wordCount: 231 });
    expect(validateReason(r, ctx())).toEqual([]);
    expect(r.wordCount).toBe(220);
  });
});

describe('the angle must fit the section', () => {
  it('⚠️ REFUSES A SPORT ANGLE ON A SELF-DEFENCE APPLICATION', () => {
    // A DFO reads hundreds of these; one arguing "a different division of the
    // sport" for personal protection is one they stop reading.
    const bad = validateReason(
      result({ angle: 'division_differentiation' }),
      ctx({ licenceType: S13, knownFirearms: ['CZ P-10 C 9mm'] }),
    );
    expect(bad.join(' ')).toContain('not allowed');
  });

  it('accepts each section its own angles', () => {
    for (const [type, angles] of Object.entries(REASON_ANGLES)) {
      expect(angles.length).toBeGreaterThan(0);
      expect(
        validateReason(
          result({ angle: angles[0] }),
          ctx({
            licenceType: type as MotivationLicenceType,
            // ⚠️ THE FULL LIST NEEDS THE FULL INPUTS. `angles[0]` is
            // `exercise_eligibility` for the sporting sections, which is
            // withheld until an association rule can feed it — see the angle
            // gate below. This asserts the section mapping, not the gate.
            hasActivityRules: true,
          }),
        ).filter((b) => b.includes('not allowed')),
      ).toEqual([]);
    }
  });
});

describe('reasons the CFR refuses on sight', () => {
  for (const word of ['collect', 'investment', 'peace of mind', 'in case']) {
    it(`refuses "${word}"`, () => {
      const bad = validateReason(
        result({ paragraph: `${words(219)} ${word}` }),
        ctx(),
      );
      expect(bad.join(' ')).toContain(word);
    });
  }

  it('⚠️ "semi-automatic" IS NOT "automatic", and the naive check trips on it', () => {
    // The spec's own list bans "automatic (unless semi-automatic)" — written
    // as a substring test it refuses every legitimate self-loading firearm.
    expect(
      validateReason(
        result({ paragraph: `This is a semi-automatic handgun. ${words(215)}` }),
        ctx(),
      ),
    ).toEqual([]);
  });

  it('still refuses a genuinely automatic firearm', () => {
    const bad = validateReason(
      result({ paragraph: `${words(219)} automatic` }),
      ctx(),
    );
    expect(bad.join(' ')).toContain('automatic');
  });

  it('refuses an exclamation mark', () => {
    const bad = validateReason(
      result({ paragraph: `${words(219)} today!` }),
      ctx(),
    );
    expect(bad.join(' ')).toContain('exclamation');
  });
});

describe('the section keeps to its own subject', () => {
  it('⚠️ A SELF-DEFENCE REASON MAY NOT ARGUE HUNTING OR SPORT', () => {
    const bad = validateReason(
      result({
        angle: 'concealability_for_carry',
        paragraph: `I hunt on weekends. ${words(216)}`,
      }),
      ctx({ licenceType: S13, knownFirearms: ['CZ P-10 C 9mm'] }),
    );
    expect(bad.join(' ')).toContain('says "hunt"');
  });

  it('⚠️ BUT "matches" IS NOT "match", AND THE SPEC’S LIST WOULD HAVE CAUGHT IT', () => {
    // A false rejection costs the applicant the written paragraph and hands
    // them the templated one instead, for no fault of theirs.
    expect(
      validateReason(
        result({
          angle: 'concealability_for_carry',
          paragraph: `The firearm matches the description above. ${words(214)}`,
        }),
        ctx({ licenceType: S13, knownFirearms: ['CZ P-10 C 9mm'] }),
      ),
    ).toEqual([]);
  });

  it('a hunting reason may not argue self-defence', () => {
    const bad = validateReason(
      result({
        angle: 'species_class_gap',
        paragraph: `I need it for self-defence. ${words(215)}`,
      }),
      ctx({ licenceType: S16H, knownFirearms: ['Howa 1500 6.5 Creedmoor'] }),
    );
    expect(bad.join(' ')).toContain('self-defence');
  });
});

describe('it may not name a firearm the applicant does not hold', () => {
  it('⚠️ THE WORST FAILURE HERE, because it reads as fact on a signed document', () => {
    const bad = validateReason(
      result({ paragraph: `I own a Beretta. ${words(217)}` }),
      ctx(),
    );
    expect(bad.join(' ')).toContain('Beretta');
  });

  it('allows a make that is in the arsenal', () => {
    expect(
      validateReason(
        result({ paragraph: `My CZ is my carry handgun. ${words(215)}` }),
        ctx(),
      ),
    ).toEqual([]);
  });
});

describe('examples come from what we supplied', () => {
  it('⚠️ DROPS AN INVENTED BODY, AND KEEPS THE PARAGRAPH', () => {
    // The paragraph is what the applicant signs and is already checked for
    // invented firearms, banned reasons and the wrong section. Throwing the
    // whole generation away over an example label is disproportionate.
    const r = result({
      examples: [
        { kind: 'discipline', label: 'IDPA Stock Service Pistol', detail: 'x' },
        {
          kind: 'discipline',
          label: 'IPSC Handgun Production Optics',
          detail: 'y',
        },
      ],
    });
    expect(validateReason(r, ctx())).toEqual([]);
    expect(r.examples.map((e) => e.label)).toEqual([
      'IPSC Handgun Production Optics',
    ]);
  });

  it('⚠️ DOES NOT DEMAND EVERY ORDINARY WORD BE QUOTED BACK', () => {
    // "SAPSA Provincial Matches" was refused live because "matches" was not in
    // the supplied terms. Ordinary words are how a person writes.
    const r = result({
      examples: [
        { kind: 'format', label: 'IPSC Provincial Matches', detail: 'x' },
      ],
    });
    expect(validateReason(r, ctx())).toEqual([]);
    expect(r.examples).toHaveLength(1);
  });

  it('keeps one drawn from the research block', () => {
    const r = result({
      examples: [
        {
          kind: 'discipline',
          label: 'IPSC Handgun Production Optics',
          detail: 'Slide-mounted optic permitted.',
        },
      ],
    });
    expect(validateReason(r, ctx())).toEqual([]);
    expect(r.examples).toHaveLength(1);
  });
});

describe('the system prompt', () => {
  it('⚠️ SHOWS A SECTION ONLY ITS OWN ANGLES', () => {
    // The model reaches for what it is shown; handing a self-defence applicant
    // the sport angles is an invitation to argue the wrong case.
    const s13 = reasonSystemPrompt(S13);
    expect(s13).toContain('concealability_for_carry');
    expect(s13).not.toContain('division_differentiation');
  });

  it('carries the word range it will be judged against', () => {
    expect(reasonSystemPrompt(S16S)).toContain(`${REASON_MIN_WORDS} to ${REASON_MAX_WORDS}`);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE NEGATIVE EXAMPLE, FROM THE OPERATOR'S OWN VAULT (2026-09-07).
//
// MOTIVATION-REASON-PROMPT.md records a live generation in full. It described
// his section 16 CZ as "dedicated to backup use and close protection", invented
// a role for all five of his firearms — none of which had one on file — named
// a USPSA division that is not shot here, and wrote in the register of a
// catalogue. Every fault below is one line of that paragraph.
//
// ⚠️ AND NOT ONE OF THEM WAS CAUGHT. The section check ran on the two hunting
// types and not on section 16 sport, which is the type this application was.
// ────────────────────────────────────────────────────────────────────

describe('a sporting firearm is never a defensive one', () => {
  for (const w of ['backup', 'close protection', 'self-defence', 'concealed']) {
    it(`⚠️ REFUSES "${w}" ON A SECTION 16 SPORT APPLICATION`, () => {
      // Describing a section 16 firearm as defensive tells the Registrar the
      // applicant uses a sport firearm outside its licence. It is a refusal on
      // its own, and it was in the applicant's own motivation.
      const bad = validateReason(
        result({ paragraph: `My CZ is for ${w}. ${words(215)}` }),
        ctx(),
      );
      expect(bad.join(' ')).toContain('section 15/16');
    });
  }

  it('⚠️ BUT "protected species" IS ORDINARY IN A HUNTING MOTIVATION', () => {
    // The rule is about a firearm's USE, not about the word — which is why
    // the list carries "protection" and not "protect".
    expect(
      validateReason(
        result({
          angle: 'species_class_gap',
          paragraph: `I never shoot protected species. ${words(215)}`,
        }),
        ctx({ licenceType: S16H, knownFirearms: ['Howa 1500 6.5 Creedmoor'] }),
      ),
    ).toEqual([]);
  });
});

describe('the register of a catalogue', () => {
  for (const w of [
    'power factor',
    'split times',
    'platform',
    'dynamic',
    'competitively',
    'efficiently',
  ]) {
    it(`refuses "${w}"`, () => {
      const bad = validateReason(
        result({ paragraph: `${words(215)} the ${w} of it` }),
        ctx(),
      );
      expect(bad.join(' ')).toContain('product page');
    });
  }

  it('⚠️ LEAVES "competition" AND "competitor" ALONE', () => {
    // `has()` anchors at a word boundary, so banning the adverb does not ban
    // the noun — and a sport motivation that may not say "competition" is a
    // sport motivation that cannot be written.
    expect(
      validateReason(
        result({ paragraph: `I shoot competition against every competitor. ${words(212)}` }),
        ctx(),
      ),
    ).toEqual([]);
  });
});

describe('divisions that are not shot here', () => {
  it('⚠️ REFUSES "Carry Optics", which is USPSA and does not exist in SA', () => {
    const bad = validateReason(
      result({ paragraph: `I shoot Carry Optics. ${words(216)}` }),
      ctx(),
    );
    expect(bad.join(' ')).toContain('not shot in South Africa');
  });
});

describe('a role nobody gave us', () => {
  const five = [
    'CZ 6.35mm Browning',
    'Mauser .30-06 Springfield',
    'Marlin .45-70 Government',
    'Howa 6.5 Creedmoor',
  ];

  it('⚠️ REFUSES A CLAIMED SOURCE FOR A FIREARM WITH NO USE ON FILE', () => {
    const bad = validateReason(
      result({
        existingRoles: [
          { firearm: 'CZ handgun in 6.35mm Browning', role: 'backup', source: 'primary_use' },
        ],
      }),
      ctx({ knownFirearms: five, roleless: five }),
    );
    expect(bad.join(' ')).toContain('nothing on file gives a use for');
  });

  it('⚠️ AND "none" IS THE CORRECT ANSWER, so it passes', () => {
    expect(
      validateReason(
        result({
          existingRoles: [
            { firearm: 'CZ 6.35mm Browning', role: '', source: 'none' },
          ],
        }),
        ctx({ knownFirearms: five, roleless: five }),
      ),
    ).toEqual([]);
  });

  it('⚠️ MATCHES ACROSS A RE-WORDING, or every invented role escapes', () => {
    // The arsenal supplies "Howa 6.5 Creedmoor"; the model returns "my Howa
    // rifle in 6.5 Creedmoor". Demanding the strings match would let the whole
    // rule through on a paraphrase.
    const bad = validateReason(
      result({
        existingRoles: [
          {
            firearm: 'my Howa rifle in 6.5 Creedmoor',
            role: 'precision long-range shooting',
            source: 'inferred',
          },
        ],
      }),
      ctx({ knownFirearms: five, roleless: ['Howa 6.5 Creedmoor'] }),
    );
    expect(bad.join(' ')).toContain('Howa');
  });

  it('⚠️ AND SAYS NOTHING WHEN TWO FIREARMS FIT EQUALLY WELL', () => {
    // A battery with two CZ 9mm handguns: "my CZ 9mm" matches both by make and
    // calibre and identifies neither. Refusing a generation on a guess costs
    // the applicant a paragraph they would have signed.
    expect(
      validateReason(
        result({
          existingRoles: [
            { firearm: 'my CZ 9mm', role: 'match pistol', source: 'primary_use' },
          ],
        }),
        ctx({
          knownFirearms: ['CZ Shadow 2 9mm', 'CZ P-10 C 9mm'],
          roleless: ['CZ P-10 C 9mm'],
        }),
      ),
    ).toEqual([]);
  });

  it('leaves a firearm whose use WAS supplied alone', () => {
    expect(
      validateReason(
        result({
          existingRoles: [
            { firearm: 'CZ Shadow 2 9mm', role: 'match pistol', source: 'primary_use' },
          ],
        }),
        ctx({ roleless: ['CZ P-10 C 9mm'] }),
      ),
    ).toEqual([]);
  });
});

describe('the angle list', () => {
  it('⚠️ CARRIES exercise_eligibility FOR SPORT AND HUNTING, AND FIRST', () => {
    // The preferred angle in the approved packs: an association exercise the
    // applied-for firearm is eligible for and a held one is not, by the
    // association's own printed equipment rule.
    expect(REASON_ANGLES[S16S][0]).toBe('exercise_eligibility');
    expect(REASON_ANGLES[S16H]).toContain('exercise_eligibility');
    expect(REASON_ANGLES[S13]).not.toContain('exercise_eligibility');
  });

  it('⚠️ BUT WITHHOLDS IT UNTIL SOMETHING CAN FEED IT', () => {
    // Its whole substance is the association's printed rule, and rule 16
    // refuses one we cannot annex. Offering it anyway asks the model to argue
    // a case and then refuses every sentence it writes: two live generations
    // in a row died that way, one on "restricted to" and one on a paragraph
    // that shrank under the floor while trying to avoid it.
    expect(anglesFor(S16S, false)).not.toContain('exercise_eligibility');
    expect(anglesFor(S16S, true)).toContain('exercise_eligibility');
    expect(reasonSystemPrompt(S16S)).not.toContain('exercise_eligibility');
    expect(reasonSystemPrompt(S16S, true)).toContain('exercise_eligibility');
  });

  it('⚠️ AND THE VALIDATOR REFUSES IT BACK, not just the prompt', () => {
    // Hiding an angle from the prompt and accepting it back is how a model's
    // memory of an earlier draft reaches the applicant.
    const bad = validateReason(
      result({ angle: 'exercise_eligibility' }),
      ctx({ hasActivityRules: false }),
    );
    expect(bad.join(' ')).toContain('not allowed');
  });

  it('tells a section without rules how to reach the floor honestly', () => {
    const p = reasonSystemPrompt(S16S);
    expect(p).toContain('NO ASSOCIATION EXERCISES WERE SUPPLIED');
    expect(p).toContain('HOW TO REACH THE WORD FLOOR');
  });
});

// ────────────────────────────────────────────────────────────────────
// THE PARAGRAPH ITSELF, WORD FOR WORD.
//
// This is what the generator wrote onto the operator's live application on
// 2026-09-07, and what was still sitting in `firearm_fit_reason` on
// alloutdoor.co.za when these rules were written. It is reproduced in
// MOTIVATION-REASON-PROMPT.md as the negative example.
//
// ⚠️ THE PARTS THAT MATTER ARE NOT THE UGLY ONES. "Platform" and "split times"
// are embarrassing; "dedicated to backup use and close protection" on a
// section 16 firearm is a REFUSAL, in the applicant's own words, on a document
// he was going to sign. Every rule below existed in the spec; none of them was
// implemented.
// ────────────────────────────────────────────────────────────────────
describe('the paragraph that reached production', () => {
  const LIVE = `I currently hold a CZ in 6.35mm Browning which is dedicated to backup use and close protection, alongside four rifles comprising a Mauser in .30-06 Springfield for plains game, a Marlin in .45-70 Government for heavy bushveld hunting, a Howa in 6.5mm Creedmoor for precision long-range shooting, and a Nordiske Precision in .223 Rem for small-calibre target work. None of my existing firearms are suited to action shooting sports governed by the South African Practical Shooting Association. To participate competitively in dynamic sport shooting disciplines, I require the Glock semi-automatic handgun in 9mm Parabellum applied for here. This specific platform allows me to compete in the Production and Carry Optics divisions where the 9mm calibre meets the power factor floor efficiently and permits rapid split times and high-volume practice. I will use this Glock strictly for sport shooting matches and training drills at registered shooting ranges.`;

  const battery = [
    'Glock 9mm Parabellum',
    'CZ 6.35mm Browning',
    'Mauser .30-06 Springfield',
    'Marlin .45-70 Government',
    'Howa 6.5mm Creedmoor',
    'Nordiske Precision .223 Rem',
  ];

  const check = () =>
    validateReason(
      result({
        angle: 'division_differentiation',
        paragraph: LIVE,
        existingRoles: [
          { firearm: 'CZ 6.35mm Browning', role: 'backup and close protection', source: 'inferred' },
          { firearm: 'Mauser .30-06 Springfield', role: 'plains game', source: 'inferred' },
        ],
      }),
      ctx({
        licenceType: S16S,
        knownFirearms: battery,
        // Not one of the five had a primary_use on file.
        roleless: battery.slice(1),
      }),
    ).join(' | ');

  it('⚠️ REFUSES IT — the whole point of this file', () => {
    expect(check()).not.toBe('');
  });

  it('names the section 16 firearm described as defensive', () => {
    expect(check()).toContain('section 15/16');
  });

  it('names the invented roles', () => {
    expect(check()).toContain('nothing on file gives a use for');
  });

  it('names the USPSA division', () => {
    expect(check()).toContain('not shot in South Africa');
  });

  it('names the catalogue words', () => {
    expect(check()).toContain('product page');
  });
});

// ────────────────────────────────────────────────────────────────────
// THE SECOND GENERATION (2026-09-08), AND WHAT IT STILL GOT WRONG.
//
// Rewriting the operator's Glock reason under the new rules fixed everything
// the corpus doc named: no defence words on a section 16 firearm, no invented
// roles, no USPSA division, no catalogue vocabulary, 204 words in two
// paragraphs, `warnings: ["roles_unconfirmed"]`. Two faults survived, and both
// are the input's fault rather than the model's.
// ────────────────────────────────────────────────────────────────────

describe('a firearm name in a sentence', () => {
  it('⚠️ STOPS THE LICENCE CARD SHOUTING', () => {
    // "a NORDISKE PRECISION 223 REM rifle licensed under section 16" is what
    // rule 13 produces when the input is the card's own transcription.
    expect(proseFirearmName('MAUSER')).toBe('Mauser');
    expect(proseFirearmName('.30-06 SPRINGFIELD')).toBe('.30-06 Springfield');
    expect(proseFirearmName('NORDISKE PRECISION')).toBe('Nordiske Precision');
    expect(proseFirearmName('6.35MM BROWNING')).toBe('6.35mm Browning');
  });

  it('⚠️ AND LEAVES AN INITIALISM ALONE — under four letters is never renamed', () => {
    // A three-letter all-caps token in this trade is nearly always an
    // initialism a person also writes in capitals. Renaming a manufacturer is
    // the failure; leaving one shouty is merely untidy.
    expect(proseFirearmName('CZ')).toBe('CZ');
    expect(proseFirearmName('ADP')).toBe('ADP');
    expect(proseFirearmName('.223 REM')).toBe('.223 REM');
  });

  it('⚠️ AND NEVER TOUCHES A MODEL DESIGNATION', () => {
    // "T3X" and "SP-01" begin with a letter and carry a digit. Lower-casing
    // them prints a firearm nobody sells.
    expect(proseFirearmName('T3X')).toBe('T3X');
    expect(proseFirearmName('SP-01')).toBe('SP-01');
    expect(proseFirearmName('P-10 C')).toBe('P-10 C');
  });

  it('tidies the card’s own bracket spacing', () => {
    expect(proseFirearmName('9MM PAR ( 9X19MM )')).toBe('9mm PAR (9x19mm)');
  });

  it('leaves something already written for a person alone', () => {
    expect(proseFirearmName('Howa 1500 6.5 Creedmoor')).toBe(
      'Howa 1500 6.5 Creedmoor',
    );
  });
});

describe('a rule we cannot show the reviewer', () => {
  // The second generation wrote that the CZ "is restricted to pocket pistol
  // events and cannot meet the chambering and capacity requirements", and that
  // the Glock "meets the entry criteria ... up to twenty five metres". Every
  // one is plausible, probably true, and supported by nothing in the pack.
  for (const phrase of [
    'restricted to pocket pistol events',
    'cannot meet the capacity requirements',
    'meets the entry criteria',
    'is not eligible for that exercise',
  ]) {
    it(`refuses "${phrase}" while no association rule is supplied`, () => {
      const bad = validateReason(
        result({ paragraph: `${words(210)} ${phrase}` }),
        ctx({ knownTerms: [] }),
      );
      expect(bad.join(' ')).toContain('no association rule supplied');
    });
  }

  it('⚠️ REFUSES A DISTANCE NOTHING SUPPLIED SUPPORTS', () => {
    const bad = validateReason(
      result({ paragraph: `I shoot to 25 metres. ${words(215)}` }),
      ctx({ knownTerms: [] }),
    );
    expect(bad.join(' ')).toContain('distance nothing supplied supports');
  });

  it('⚠️ BUT A HUNTING RANGE BAND IS SUPPLIED, so it passes', () => {
    // REASON_BANKS carries "150-300 m open ground" and the service hands the
    // banks over on every call. A rule that refused those would refuse every
    // hunting motivation.
    expect(
      validateReason(
        result({
          angle: 'species_class_gap',
          paragraph: `I shoot plains game at 200 m. ${words(213)}`,
        }),
        ctx({
          licenceType: S16H,
          knownFirearms: ['Howa 1500 6.5 Creedmoor'],
          knownTerms: ['6.5 Creedmoor: kudu, gemsbok; 100-300 m'],
        }),
      ),
    ).toEqual([]);
  });

  it('⚠️ AND ALLOWS THE RULE ONCE WE CAN ANNEX IT', () => {
    // The whole point of exercise_eligibility. Once association-activities.ts
    // supplies "only 9mmP pistols and larger" with a source, quoting it is the
    // strongest thing the paragraph can do.
    expect(
      validateReason(
        result({
          angle: 'exercise_eligibility',
          paragraph: `The 7m exercise is restricted to 9mmP and larger. ${words(210)}`,
        }),
        ctx({ hasActivityRules: true }),
      ),
    ).toEqual([]);
  });
});

describe('South African English', () => {
  // Rule 8 has forbidden Americanisms since the first draft and nothing
  // enforced it. The generation that passed every other check wrote
  // "authorized", "utilized" and "recognized" in a document lodged with the
  // South African Police Service under an Act that spells it "licence".
  for (const w of ['authorized', 'utilized', 'recognized', 'caliber', 'defense']) {
    it(`refuses "${w}"`, () => {
      const bad = validateReason(
        result({ paragraph: `${words(215)} ${w} thing` }),
        ctx(),
      );
      expect(bad.join(' ')).toContain('South African English');
    });
  }

  it('⚠️ AND NEVER TRIPS ON "licensed", which is correct in both registers', () => {
    // "licence" is the noun and "license" the verb in British and South
    // African English alike, and "licensed under section 16" is the commonest
    // phrase in this whole paragraph.
    expect(
      validateReason(
        result({
          paragraph: `I hold a CZ, licensed under section 16, on a licence issued in 2024. ${words(206)}`,
        }),
        ctx(),
      ),
    ).toEqual([]);
  });
});
