import { MotivationLicenceType } from '@prisma/client';
import {
  CARD_SETS,
  OVERLAP_ANGLES,
  OVERLAP_ANGLES_BY_SECTION,
  overlapAnglesFor,
} from './motivation-cards';
import {
  OVERLAP_ANGLE_KEY,
  allowedValues,
  fieldsFor,
  sanitiseAnswers,
} from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// THE WORDING OF EVERY CARD AN APPLICANT CAN TAP.
//
// ⚠️ THIS SUITE READS SENTENCES, NOT BEHAVIOUR, AND THAT IS THE POINT. Each
// card is a first-person statement the applicant signs their name under —
// section 120(9)(f) of the Firearms Control Act makes a false statement on an
// application an offence — so the wording is the safety property, and it is
// reviewed by the operator before a set ships. What can be checked
// mechanically is checked here, so a review is spent on judgement rather than
// on spotting a missing full stop.
// ────────────────────────────────────────────────────────────────────

const ALL_CARDS = Object.entries(CARD_SETS).flatMap(([set, options]) =>
  options.map((o) => ({ set, ...o })),
);

describe('every card set', () => {
  it('is non-empty and reachable through CARD_SETS', () => {
    // ⚠️ A SET THAT IS NOT ON THE MAP SHIPS UNREVIEWED. This suite walks
    // CARD_SETS, so the map is what makes a set visible to the one thing that
    // reads every sentence.
    expect(Object.keys(CARD_SETS).length).toBeGreaterThan(5);
    for (const [name, options] of Object.entries(CARD_SETS)) {
      expect(options.length).toBeGreaterThan(1);
      expect(name.trim()).not.toBe('');
    }
  });

  it('has unique keys within a set', () => {
    // A duplicate key makes one card unreachable and silently changes what a
    // tap stores — the same failure a duplicate <option> value causes.
    for (const [name, options] of Object.entries(CARD_SETS)) {
      const keys = options.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(name).toBeTruthy();
    }
  });

  it('keys are stable slugs, not prose', () => {
    // ⚠️ THE KEY IS STORED AND THE SENTENCE IS DISPLAYED, so a reword must
    // never touch the key. Keeping keys to a slug shape is what makes that
    // obvious to whoever does the wording review.
    for (const c of ALL_CARDS) {
      expect(c.key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('every card sentence', () => {
  it('is written in the first person', () => {
    // The applicant is speaking. A card in the second person ("You live in…")
    // is the product telling somebody what is true about them.
    for (const c of ALL_CARDS) {
      expect(c.sentence).toMatch(/\b(I|My|me|my)\b/);
      expect(c.sentence).not.toMatch(/\byou\b/i);
    }
  });

  it('is one complete sentence ending in a full stop', () => {
    for (const c of ALL_CARDS) {
      expect(c.sentence.trim()).toBe(c.sentence);
      expect(c.sentence.endsWith('.')).toBe(true);
      expect(c.sentence[0]).toBe(c.sentence[0].toUpperCase());
      // ⚠️ NOT A MINIMUM LENGTH. "I play golf." is twelve characters and is a
      // perfectly good card; a character floor would only push somebody to
      // pad a true, short statement. What matters is that it is a SENTENCE —
      // a subject and a verb — and that it fits on a tile.
      expect(c.sentence.split(/\s+/).length).toBeGreaterThan(2);
      expect(c.sentence.length).toBeLessThan(180);
    }
  });

  it('carries no emoji and no exclamation mark', () => {
    for (const c of ALL_CARDS) {
      expect(c.sentence).not.toMatch(/[!]/);
      expect(c.sentence).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('never predicts an outcome', () => {
    // ⚠️ THE CENTRE'S STANDING RULE. A card saying "this will get my
    // application approved" would put a prediction in the applicant's mouth,
    // and we do not make predictions about what a DFO will decide.
    for (const c of ALL_CARDS) {
      expect(c.sentence).not.toMatch(
        /\b(approved|guarantee|guaranteed|will be granted|best chance)\b/i,
      );
    }
  });

  it('never names a competitor', () => {
    for (const c of ALL_CARDS) {
      expect(c.sentence).not.toMatch(/\b(engala|gungalore|gun galore)\b/i);
    }
  });

  it('states a fact about the applicant, not the conclusion drawn from it', () => {
    // ⚠️ THE ARGUMENT IS THE WRITER'S JOB. "I live in a precinct with a
    // documented housebreaking problem" is something the applicant can stand
    // behind; "I therefore need a firearm" is the conclusion the document has
    // to earn, and a card that asserts it skips the earning.
    for (const c of ALL_CARDS) {
      expect(c.sentence).not.toMatch(/\btherefore\b/i);
      expect(c.sentence).not.toMatch(/\bI need a firearm\b/i);
    }
  });
});

describe('cards and the registry agree', () => {
  const TYPES = Object.values(MotivationLicenceType);

  it('gives every cards field a non-empty option list', () => {
    for (const t of TYPES) {
      for (const f of fieldsFor(t)) {
        if (f.kind !== 'cards') continue;
        expect(f.options?.length ?? 0).toBeGreaterThan(1);
      }
    }
  });

  it('validates a stored answer against the card KEYS, never the sentences', () => {
    // ⚠️ THIS IS WHAT LETS THE OPERATOR REWORD A CARD SAFELY. If allowedValues
    // read sentences, every reword would fail sanitiseAnswers for anybody who
    // had already tapped that card — on every keystroke, for ever.
    const field = fieldsFor(MotivationLicenceType.S13_SELF_DEFENCE).find(
      (f) => f.key === 's13_reasons',
    )!;
    const allowed = allowedValues(field);
    expect(allowed).toContain('night_travel');
    expect(allowed).not.toContain(
      'I regularly travel at night, or on roads where I would be on my own if I stopped.',
    );
  });

  it('stores a tap as a comma list in the offered order', () => {
    // Exactly like `multi`, which is the whole reason `cards` reuses that
    // storage format: showIf, the fact pack and every existing reader work
    // unchanged.
    const { answers, rejected } = sanitiseAnswers(
      MotivationLicenceType.S13_SELF_DEFENCE,
      { s13_reasons: 'rented, night_travel' },
    );
    expect(rejected).toEqual([]);
    expect(answers.s13_reasons).toBe('night_travel, rented');
  });

  it('refuses a value that is not a real card', () => {
    // These are printed into a document the applicant signs. An arbitrary
    // string arriving from a hand-rolled request would become a statement
    // about them that they never made.
    const { rejected, refused } = sanitiseAnswers(
      MotivationLicenceType.S13_SELF_DEFENCE,
      { s13_reasons: 'night_travel, i_am_a_wizard' },
    );
    expect(rejected).toContain('s13_reasons');
    expect(refused).toContain('s13_reasons');
  });
});

describe('the overlap angles', () => {
  it('are a fixed vocabulary the registry can validate against', () => {
    // ⚠️ RANKED PER APPLICANT, BUT NEVER INVENTED PER APPLICANT.
    // motivation-overlap.ts reorders these; it may not add to them. A set
    // computed per applicant could not be checked on save at all.
    const field = fieldsFor(MotivationLicenceType.S16_DEDICATED_SPORT).find(
      (f) => f.key === OVERLAP_ANGLE_KEY,
    )!;
    expect(field.kind).toBe('cards');
    expect(allowedValues(field)).toEqual(OVERLAP_ANGLES.map((o) => o.key));
  });

  it('is never required — somebody who holds nothing has no overlap', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      const field = fieldsFor(t).find((f) => f.key === OVERLAP_ANGLE_KEY);
      if (field) expect(field.required).toBeUndefined();
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// THE ANGLES A SECTION MAY BE OFFERED.
//
// Operator, 2026-09-08: "the reasons underneath this Why this one as well as
// the ones you hold does not even make sense."
//
// ⚠️ SIXTEEN ANGLES WERE SERVED TO EVERY LICENCE TYPE. Five argue the sport
// and four argue hunting, and the operator's own SECTION 13 carries
// `overlap_angle: "different_division"` — "a different division of the sport"
// — because that sentence was on the screen of a self-defence application.
//
// ⚠️ AND THE TAPPED SENTENCE GOES INTO THE DOCUMENT VERBATIM. This is worse
// than a bad option shown to a model: a sport reason on a section 13 is a
// refusal trigger, and the applicant put it there because we offered it.
// ────────────────────────────────────────────────────────────────────
describe('overlapAnglesFor', () => {
  const keys = (t: string) => overlapAnglesFor(t).map((o) => o.key);

  it('⚠️ NEVER OFFERS THE SPORT OR THE HUNT TO A SELF-DEFENCE APPLICANT', () => {
    const s13 = keys('S13_SELF_DEFENCE');
    expect(s13).not.toContain('different_division');
    expect(s13).not.toContain('match_and_practice');
    expect(s13).not.toContain('different_quarry');
    expect(s13).not.toContain('terrain_reach');
  });

  it('⚠️ AND GIVES IT SOMETHING TRUTHFUL TO TAP INSTEAD', () => {
    // Of the original sixteen, what was left for a section 13 after removing
    // the sport and the hunt was generic. The commonest real reason somebody
    // licensed for self-defence applies for a second is this pair, and neither
    // could be said.
    const s13 = keys('S13_SELF_DEFENCE');
    expect(s13).toContain('concealable');
    expect(s13).toContain('home_and_carry');
    expect(s13.length).toBeGreaterThanOrEqual(6);
  });

  it('does not offer carry or concealment on a sporting application', () => {
    for (const t of ['S16_DEDICATED_SPORT', 'S16_DEDICATED_HUNTER']) {
      expect(keys(t)).not.toContain('concealable');
      expect(keys(t)).not.toContain('home_and_carry');
    }
  });

  it('gives each section its own', () => {
    expect(keys('S16_DEDICATED_SPORT')).toContain('different_division');
    expect(keys('S16_DEDICATED_HUNTER')).toContain('different_quarry');
    expect(keys('S15_OCCASIONAL_HUNTER')).toContain('close_cover');
  });

  it('⚠️ A TYPE WE DO NOT RECOGNISE GETS THE WHOLE SET, not none', () => {
    // The safe direction: a member can decline a card they do not recognise,
    // and cannot tap one we never showed.
    expect(overlapAnglesFor('S24_RENEWAL')).toEqual(OVERLAP_ANGLES);
    expect(overlapAnglesFor('WHAT')).toEqual(OVERLAP_ANGLES);
  });

  it('⚠️ EVERY NAMED KEY EXISTS, or the section silently loses a card', () => {
    const known = new Set(OVERLAP_ANGLES.map((o) => o.key));
    for (const [group, list] of Object.entries(OVERLAP_ANGLES_BY_SECTION)) {
      for (const k of list) {
        expect(`${group}:${k}`).toBe(`${group}:${known.has(k) ? k : 'MISSING'}`);
      }
    }
  });

  it('⚠️ NO CARD MENTIONS A SEASON OR A DIVISION OUTSIDE THE SPORT', () => {
    // "This one is my backup, so a breakage does not end my season" was shown
    // to everybody. The wording is the fault as much as the grouping.
    for (const t of ['S13_SELF_DEFENCE', 'S16_DEDICATED_HUNTER']) {
      for (const o of overlapAnglesFor(t)) {
        expect(o.sentence.toLowerCase()).not.toContain('season');
        expect(o.sentence.toLowerCase()).not.toContain('division');
      }
    }
  });
});
