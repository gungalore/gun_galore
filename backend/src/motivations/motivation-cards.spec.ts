import { MotivationLicenceType } from '@prisma/client';
import { CARD_SETS, OVERLAP_ANGLES } from './motivation-cards';
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
