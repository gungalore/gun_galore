import { describe, expect, it } from 'vitest';
import type { MotivationField } from '@/lib/motivations-api';
import {
  answerHeading,
  NO_ANSWERS,
  outstandingHint,
  stepFieldsFor,
  tallyAnswers,
} from './step-answers';

// ────────────────────────────────────────────────────────────────────
// THE HEADER AND THE FOOTER COUNT THE SAME THING.
//
// ⚠️ THEY DID NOT, AND BOTH SENTENCES WERE ON ONE SCREEN. The operator's live
// section 13, 2026-09-07:
//
//   competency  header "WE HAVE 3 OF THE 4 ANSWERS THIS SECTION ASKS FOR",
//               a row pilled "Still needed", footer "Nothing outstanding here."
//   firearm     header "0 OF THE 9 ANSWERS", footer "7 answers still needed."
//
// Both were true. The header counted every field including the optional ones;
// the footer counted only what the server still requires. The pair is
// unreadable, and a member cannot tell from it whether they are finished.
//
// The two cases below are those two screens, written as tests.
// ────────────────────────────────────────────────────────────────────

const f = (over: Partial<MotivationField> & { key: string }): MotivationField =>
  ({
    label: over.key,
    kind: 'short',
    section: 'S',
    ...over,
  }) as MotivationField;

describe('⚠️ the two screens the operator photographed', () => {
  it('competency: three required in, one optional empty', () => {
    const fields = [
      f({ key: 'a', required: true }),
      f({ key: 'b', required: true }),
      f({ key: 'c', required: true }),
      f({ key: 'd' }),
    ];
    const t = tallyAnswers(fields, new Set());
    // The header no longer says "3 of the 4" over a footer saying nothing is
    // outstanding: both now describe the three answers that are required.
    expect(answerHeading(t)).toBe(
      'We have 3 of the 3 answers this section needs · one more is optional',
    );
    expect(outstandingHint(t)).toBe('Nothing outstanding here.');
  });

  it('firearm: seven required missing, two optional', () => {
    const fields = [
      ...Array.from({ length: 7 }, (_, i) =>
        f({ key: `r${i}`, required: true }),
      ),
      f({ key: 'o1' }),
      f({ key: 'o2' }),
    ];
    const missing = new Set(fields.filter((x) => x.required).map((x) => x.key));
    const t = tallyAnswers(fields, missing);
    expect(answerHeading(t)).toBe(
      'We have 0 of the 7 answers this section needs · 2 more are optional',
    );
    expect(outstandingHint(t)).toBe('7 answers still needed.');
  });
});

describe('the tally', () => {
  it('counts an outstanding key even when the served field is not required', () => {
    // ⚠️ The page's `missing` is a UNION with the server's own missingRequired,
    // and the server requires things on registry logic this client does not
    // evaluate. Treating such a key as optional would print "nothing
    // outstanding" over a step that cannot finish.
    const fields = [f({ key: 'a' }), f({ key: 'b' })];
    const t = tallyAnswers(fields, new Set(['a']));
    expect(t).toEqual({ needed: 1, have: 0, optional: 1, total: 2 });
    expect(outstandingHint(t)).toBe('One answer still needed.');
  });

  it('says so when a section asks nothing that is required', () => {
    const t = tallyAnswers([f({ key: 'a' })], new Set());
    expect(answerHeading(t)).toBe(
      'Nothing here is required — one answer you may add',
    );
    expect(outstandingHint(t)).toBe('Nothing outstanding here.');
  });

  describe('⚠️ AN OPTIONAL ANSWER ALREADY GIVEN IS NOT STILL ON OFFER', () => {
    // "· one more is optional" over an optional answer that is already IN
    // reads as one still outstanding — the same ambiguity this tally exists to
    // remove, one clause further along.
    const fields = [
      f({ key: 'a', required: true }),
      f({ key: 'b', required: true }),
      f({ key: 'c', required: true }),
      f({ key: 'd' }),
    ];

    it('drops out of the count once it is filled', () => {
      const t = tallyAnswers(fields, new Set(), { d: 'Something' });
      expect(t).toEqual({ needed: 3, have: 3, optional: 0, total: 4 });
      expect(answerHeading(t)).toBe(
        'We have 3 of the 3 answers this section needs',
      );
    });

    it('whitespace is not an answer', () => {
      const t = tallyAnswers(fields, new Set(), { d: '   ' });
      expect(t.optional).toBe(1);
    });

    it('⚠️ AND A STEP OF NOTHING BUT ANSWERED OPTIONALS DOES NOT READ EMPTY', () => {
      // `needed === 0` used to say "Nothing here is required — 4 answers you
      // may add" over four answers already added, and "Nothing to answer here"
      // is the sentence for a step with no fields at all — over four the
      // member has just typed it reads as though they had been thrown away.
      const optionals = Array.from({ length: 4 }, (_, i) => f({ key: `o${i}` }));
      const all = Object.fromEntries(optionals.map((x) => [x.key, 'in']));
      expect(answerHeading(tallyAnswers(optionals, new Set(), all))).toBe(
        'Nothing here is required, and it is all in',
      );
      expect(answerHeading(tallyAnswers(optionals, new Set(), {}))).toBe(
        'Nothing here is required — 4 answers you may add',
      );
    });
  });

  it('says so when a section has no fields at all', () => {
    const t = tallyAnswers([], new Set());
    expect(answerHeading(t)).toBe('Nothing to answer here');
    expect(outstandingHint(t)).toBe('Nothing outstanding here.');
  });
});

describe('⚠️ the hint counts documents too', () => {
  // A step whose required document is not attached cannot finish, and the rail
  // tick already knew it — the hint underneath said "Nothing outstanding here."
  const nothing = NO_ANSWERS;

  it('names a missing document on its own', () => {
    expect(outstandingHint(nothing, 1)).toBe('One document still needed.');
    expect(outstandingHint(nothing, 3)).toBe('3 documents still needed.');
  });

  it('names both when both are outstanding', () => {
    expect(outstandingHint({ needed: 4, have: 1, optional: 0, total: 4 }, 1)).toBe(
      '3 answers and one document still needed.',
    );
  });

  it('still says nothing when nothing is outstanding', () => {
    expect(outstandingHint({ needed: 2, have: 2, optional: 1, total: 3 }, 0)).toBe(
      'Nothing outstanding here.',
    );
  });
});

describe('the field selection', () => {
  const fields = [
    f({ key: 'a', section: 'One' }),
    f({ key: 'b', section: 'Two' }),
    f({ key: 'c', section: 'One' }),
  ];

  it('keeps the sections in the order the step names them', () => {
    expect(stepFieldsFor(['Two', 'One'], fields, {}).map((x) => x.key)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('is empty for a step that names no section', () => {
    expect(stepFieldsFor(undefined, fields, {})).toEqual([]);
    expect(stepFieldsFor([], fields, {})).toEqual([]);
  });

  it('⚠️ DROPS A FIELD BEHIND AN UNMET showIf', () => {
    // The header and the footer both count this selection, so a field the
    // member cannot see must not be counted by either of them.
    const gated = [
      f({ key: 'married', section: 'One' }),
      f({
        key: 'spouse',
        section: 'One',
        showIf: { key: 'married', equals: 'Yes' },
      } as Partial<MotivationField> & { key: string }),
    ];
    expect(stepFieldsFor(['One'], gated, {}).map((x) => x.key)).toEqual([
      'married',
    ]);
    expect(
      stepFieldsFor(['One'], gated, { married: 'Yes' }).map((x) => x.key),
    ).toEqual(['married', 'spouse']);
  });
});


// ────────────────────────────────────────────────────────────────────
// THE ASSOCIATION SLOTS APPEAR AS THEY ARE USED, NOT ALL AT ONCE.
//
// ⚠️ TEN ROWS FOR A MEMBER OF ONE ASSOCIATION. The section 16 step drew all
// three registry slots flat, so the operator's live application listed seven
// empty rows including three byte-identical label pairs — "Another association
// you belong to" twice, "Membership number there" twice, "Member there since"
// twice. The registry's own comment says the wizard was supposed to hide them
// ("operator, 2026-08-20"); the old wizard does, and this one never did.
// ────────────────────────────────────────────────────────────────────

const ASSOCIATION_FIELDS: MotivationField[] = [
  f({ key: 'association_name', required: true }),
  f({ key: 'association_number' }),
  f({ key: 'association_2_name' }),
  f({ key: 'association_2_number' }),
  f({ key: 'association_3_name' }),
  f({ key: 'association_3_number' }),
].map((x) => ({ ...x, section: 'Dedicated status' }));

const keysOn = (answers: Record<string, string>) =>
  stepFieldsFor(['Dedicated status'], ASSOCIATION_FIELDS, answers).map(
    (x) => x.key,
  );

describe("⚠️ a member of one association is not shown three", () => {
  it('offers the first slot only, until it is used', () => {
    expect(keysOn({})).toEqual(['association_name', 'association_number']);
  });

  it('offers the next slot once the one before it is in use', () => {
    expect(keysOn({ association_name: 'SAHGCA' })).toContain(
      'association_2_name',
    );
    expect(keysOn({ association_name: 'SAHGCA' })).not.toContain(
      'association_3_name',
    );
  });

  it('offers the third only once the second is in use', () => {
    const all = keysOn({
      association_name: 'SAHGCA',
      association_2_name: 'NARFO',
    });
    expect(all).toContain('association_3_name');
  });

  it('does not open a later slot on a blank name', () => {
    expect(keysOn({ association_name: '   ' })).not.toContain(
      'association_2_name',
    );
  });

  it('counts what it shows, so the header and the footer cannot disagree', () => {
    const shown = stepFieldsFor(['Dedicated status'], ASSOCIATION_FIELDS, {});
    const tally = tallyAnswers(shown, new Set(['association_name']));
    expect(tally.total).toBe(2);
    expect(tally.needed).toBe(1);
  });
});
