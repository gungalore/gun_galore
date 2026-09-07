import { describe, expect, it } from 'vitest';
import {
  reasonsFor,
  reasonSubject,
  unplacedReasons,
  type SkippedNote,
} from './offer-notes';

// ────────────────────────────────────────────────────────────────────
// ONE LINE PER REASON, UNDER THE SECTION IT IS ABOUT.
//
// The two faults the operator photographed on 2026-09-07, written down:
// the same sentence printed once per document in a run-on middot line, and
// firearm sentences appearing under the Competency and Dedicated-status panels
// because `skipped` was never filtered the way `items` is.
// ────────────────────────────────────────────────────────────────────

const OWNED = ['existing_firearm_'];
const full = 'the form has room for 6 firearms and they are all filled';

const note = (over: Partial<SkippedNote>): SkippedNote => ({
  title: 'A licence',
  why: full,
  ...over,
});

describe('one line per reason', () => {
  it('⚠️ COLLAPSES THREE DOCUMENTS WITH ONE REASON INTO ONE LINE', () => {
    const reasons = reasonsFor(
      [
        note({ title: 'Glock licence', key: 'existing_firearm_7_make' }),
        note({ title: 'Sako licence', key: 'existing_firearm_8_make' }),
        note({ title: 'Marlin licence', key: 'existing_firearm_9_make' }),
      ],
      OWNED,
    );
    expect(reasons).toEqual([
      {
        why: full,
        titles: ['Glock licence', 'Sako licence', 'Marlin licence'],
      },
    ]);
    expect(reasonSubject(reasons[0])).toBe('3 documents');
  });

  it('names the document when there is only one', () => {
    const reasons = reasonsFor(
      [note({ title: 'Glock licence', key: 'existing_firearm_7_make' })],
      OWNED,
    );
    expect(reasonSubject(reasons[0])).toBe('Glock licence');
  });

  it('keeps genuinely different reasons apart, in arrival order', () => {
    const reasons = reasonsFor(
      [
        note({ title: 'A', why: 'first', key: 'existing_firearm_1_make' }),
        note({ title: 'B', why: 'second', key: 'existing_firearm_2_make' }),
        note({ title: 'C', why: 'first', key: 'existing_firearm_3_make' }),
      ],
      OWNED,
    );
    expect(reasons).toEqual([
      { why: 'first', titles: ['A', 'C'] },
      { why: 'second', titles: ['B'] },
    ]);
  });
});

describe('under the section it is about', () => {
  const skipped = [
    note({ title: 'Glock licence', key: 'existing_firearm_7_make' }),
    note({
      title: 'Old competency',
      why: 'we could not read a certificate number off it',
      key: 'competency_number',
    }),
  ];

  it('⚠️ A FIREARM SENTENCE DOES NOT APPEAR UNDER COMPETENCY', () => {
    expect(reasonsFor(skipped, ['competency_'])).toEqual([
      {
        why: 'we could not read a certificate number off it',
        titles: ['Old competency'],
      },
    ]);
  });

  it('nor under dedicated status', () => {
    expect(reasonsFor(skipped, ['association_', 'dedicated_'])).toEqual([]);
  });

  it('and the firearm panel gets its own', () => {
    expect(reasonsFor(skipped, OWNED)).toEqual([
      { why: full, titles: ['Glock licence'] },
    ]);
  });

  it('matches on any of several keys', () => {
    expect(
      reasonsFor(
        [note({ keys: ['licence_expiry', 'existing_firearm_1_make'] })],
        OWNED,
      ),
    ).toHaveLength(1);
  });
});

describe('⚠️ a note that names no key belongs to no section', () => {
  const unkeyed = [note({ title: 'Glock licence' })];

  it('is on no section panel', () => {
    expect(reasonsFor(unkeyed, OWNED)).toEqual([]);
    expect(reasonsFor(unkeyed, ['competency_'])).toEqual([]);
    expect(reasonsFor(unkeyed, [])).toEqual([]);
  });

  it('⚠️ BUT IT IS STILL SHOWN — nowhere at all was the worse bug', () => {
    // The server carries no key on ANY skipped entry today, so dropping the
    // unkeyed ones silenced every "we read this and took nothing from it"
    // sentence on the whole screen. The operator's complaint was repetition,
    // not concealment.
    expect(unplacedReasons(unkeyed)).toEqual([
      { why: full, titles: ['Glock licence'] },
    ]);
  });

  it('collapses these the same way, one line per reason', () => {
    expect(
      unplacedReasons([
        note({ title: 'A' }),
        note({ title: 'B', why: 'second' }),
        note({ title: 'C' }),
      ]),
    ).toEqual([
      { why: full, titles: ['A', 'C'] },
      { why: 'second', titles: ['B'] },
    ]);
  });

  it('⚠️ AND A NOTE THAT NAMES A KEY IS NOT SHOWN TWICE', () => {
    // Once the server grows key/keys, every note lands on its own panel and
    // this list empties itself. Anything else double-prints the sentence.
    expect(
      unplacedReasons([note({ key: 'existing_firearm_7_make' })]),
    ).toEqual([]);
    expect(unplacedReasons([note({ keys: ['competency_number'] })])).toEqual(
      [],
    );
  });
});
