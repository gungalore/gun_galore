import { describe, expect, it } from 'vitest';
import { answerValue, isCardPlaceholder } from './card-placeholder';

// ────────────────────────────────────────────────────────────────────
// THE SECOND COPY, PINNED TO THE FIRST.
//
// backend/src/common/card-placeholder.ts holds the same rule at the ANSWER
// boundary; there is no import path from here to there (see the header on
// lib/card-placeholder.ts). This spec exists so the copy cannot drift quietly:
// every case below is a case the server's own rule is written for, and a change
// to the pattern on either side fails here first.
//
// ⚠️ THE CASE THAT PUT IT ON A MEMBER'S SCREEN. The prefill offer and the "What
// you own" row printed "Firearm 6 — frame serial NONE · barrel serial NONE"
// while the server, which runs this rule, wrote nothing into either box. Two
// screens describing one firearm two ways, and the one that was wrong was the
// one the member reads.
// ────────────────────────────────────────────────────────────────────

describe('what a card prints to mean "nothing here"', () => {
  it.each([
    'NONE',
    'none',
    ' None ',
    'N/A',
    'n/a',
    'N.A.',
    'NA',
    'nil',
    'NULL',
    'not applicable',
    'Not Applicable',
    'geen',
    'onbekend',
    'unknown',
    '-',
    '--',
    '–',
    '—',
    '...',
    '',
    '   ',
  ])('%j is the card saying nothing', (v) => {
    expect(isCardPlaceholder(v)).toBe(true);
    expect(answerValue(v)).toBe('');
  });

  it('null and undefined are nothing too', () => {
    expect(isCardPlaceholder(null)).toBe(true);
    expect(isCardPlaceholder(undefined)).toBe(true);
    expect(answerValue(null)).toBe('');
  });
});

describe('⚠️ ANCHORED, so a real value that CONTAINS one is untouched', () => {
  it.each([
    ['NA1234', 'NA1234'],
    ['None Series', 'None Series'],
    ['ZABA01892', 'ZABA01892'],
    ['NILE-7', 'NILE-7'],
    ['  A-7  ', 'A-7'],
  ])('%j survives as %j', (raw, kept) => {
    expect(isCardPlaceholder(raw)).toBe(false);
    expect(answerValue(raw)).toBe(kept);
  });
});
