import { describe, expect, it } from 'vitest';
import { withLineContext, type ConfirmRow } from './desk-order';

// ────────────────────────────────────────────────────────────────────
// THE MONEY CONFIRM HAS TO NAME THE LINE.
//
// Money on an order is per-LINE, never per-order — the server refuses a full
// refund of a consolidated carrier line while its siblings are still held, in
// an order the operator cannot predict from the screen. That is why there is
// no "refund the order" button anywhere: you pick a line first.
//
// The confirm is the last place that choice can be checked, and it named the
// amount and the recipient and never the line — so on a three-line cart every
// lever read identically whichever line was selected.
//
// The artboard (docs/design/desk-pwa/Order.dc.html) specifies both halves: a
// "Line" row, and a "Then" that ends "...The other two lines are untouched."
// ────────────────────────────────────────────────────────────────────

const RELEASE: ConfirmRow[] = [
  { k: 'To', v: '@skietrob' },
  { k: 'Amount', v: 'R 15 390.00' },
  { k: 'Then', v: 'The payout becomes due and the next sweep pays it.' },
];

const TIKKA = { title: 'Tikka T3x Lite .308', index: 1, total: 3 };

describe('🚨 the confirm names the line it acts on', () => {
  it('adds a Line row reading "<title> — N of M"', () => {
    const rows = withLineContext(RELEASE, TIKKA);
    expect(rows.find((r) => r.k === 'Line')?.v).toBe('Tikka T3x Lite .308 — 1 of 3');
  });

  it('states the line BEFORE the consequence, not after it', () => {
    // What is being acted on, then what follows from it. Reversed, the
    // operator reads the outcome before knowing whose outcome it is.
    const rows = withLineContext(RELEASE, TIKKA);
    expect(rows.map((r) => r.k)).toEqual(['To', 'Amount', 'Line', 'Then']);
  });

  it('does not disturb the rows it was given', () => {
    const rows = withLineContext(RELEASE, TIKKA);
    expect(rows.find((r) => r.k === 'To')?.v).toBe('@skietrob');
    expect(rows.find((r) => r.k === 'Amount')?.v).toBe('R 15 390.00');
    // And the original array is not mutated — dialogFor rebuilds per render.
    expect(RELEASE).toHaveLength(3);
  });
});

describe('🚨 and says which lines it leaves alone', () => {
  it('extends the Then row rather than replacing it', () => {
    const then = withLineContext(RELEASE, TIKKA).find((r) => r.k === 'Then')?.v ?? '';
    // The original consequence survives...
    expect(then).toContain('The payout becomes due and the next sweep pays it.');
    // ...and the half that was missing is appended.
    expect(then).toContain('The other 2 lines are untouched.');
  });

  it('says "line", singular, on a two-line cart', () => {
    const then = withLineContext(RELEASE, { ...TIKKA, total: 2 }).find((r) => r.k === 'Then')?.v;
    expect(then).toContain('The other line is untouched.');
    expect(then).not.toContain('1 lines');
  });
});

describe('a single-line sale is left alone entirely', () => {
  it('adds nothing when there is no line context', () => {
    // parcelPosition returns null for a single-item sale, which is every
    // pre-cart checkout. "1 of 1" is noise, and noise on a money confirm is
    // how people learn to tap through them.
    expect(withLineContext(RELEASE, null)).toEqual(RELEASE);
  });

  it('claims no untouched siblings when there are none', () => {
    const then = withLineContext(RELEASE, { ...TIKKA, total: 1 }).find((r) => r.k === 'Then')?.v;
    expect(then).toBe('The payout becomes due and the next sweep pays it.');
    expect(then).not.toContain('untouched');
  });
});

describe('every lever gets it, not just the obvious two', () => {
  it('appends a Line row when a lever has no Then row at all', () => {
    // Wrapping dialogFor is what makes this true for all seven levers. A
    // lever that states no consequence still has to name its subject.
    const rows = withLineContext([{ k: 'To', v: '@boet' }], TIKKA);
    expect(rows.map((r) => r.k)).toEqual(['To', 'Line']);
  });

  it('works on a refund, where the line is the whole point', () => {
    // Refunding a sibling while others are held is the exact call the server
    // refuses — so this is the confirm that most needed a subject.
    const refund: ConfirmRow[] = [
      { k: 'To', v: '@boet' },
      { k: 'Amount', v: 'R 1 100.00' },
      { k: 'Then', v: 'The buyer is refunded and the seller is not paid for this line.' },
    ];
    const rows = withLineContext(refund, { title: 'Federal Premium .308', index: 3, total: 3 });
    expect(rows.find((r) => r.k === 'Line')?.v).toBe('Federal Premium .308 — 3 of 3');
    expect(rows.find((r) => r.k === 'Then')?.v).toContain('The other 2 lines are untouched.');
  });
});
