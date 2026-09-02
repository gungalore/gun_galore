import {
  consolidate,
  needsReview,
  pickDisplayName,
  type ConsolidationInput,
} from './consolidate';

/**
 * THE BENCH — consolidation tests.
 *
 * These assert the rules a reloader's safety rests on: the published window
 * is the union of every manual's window, and each velocity stays attached to
 * the charge it was measured at.
 */

const row = (o: Partial<ConsolidationInput>): ConsolidationInput => ({
  startGr: 35,
  startFps: 2400,
  maxGr: 40,
  maxFps: 2700,
  coalMm: 71.1,
  bulletType: 'ELD Match',
  ...o,
});

describe('consolidate — the published window', () => {
  it('takes the lowest start and the highest max across manuals', () => {
    const out = consolidate([
      row({ startGr: 36.0, maxGr: 40.5 }),
      row({ startGr: 35.2, maxGr: 41.5 }),
      row({ startGr: 35.8, maxGr: 41.0 }),
    ]);
    expect(out.startGr).toBe(35.2);
    expect(out.maxGr).toBe(41.5);
  });

  it('keeps each velocity with its own charge, never mixing rows', () => {
    const out = consolidate([
      // the lowest start, with the fps measured at THAT start
      row({ startGr: 35.2, startFps: 2310, maxGr: 40.0, maxFps: 2650 }),
      // the highest max, with the fps measured at THAT max
      row({ startGr: 36.4, startFps: 2380, maxGr: 41.5, maxFps: 2755 }),
    ]);
    expect(out.startGr).toBe(35.2);
    expect(out.startFps).toBe(2310); // NOT 2380
    expect(out.maxGr).toBe(41.5);
    expect(out.maxFps).toBe(2755); // NOT 2650
  });

  it('never averages — the result is always a figure some manual printed', () => {
    const out = consolidate([row({ startGr: 30, maxGr: 40 }), row({ startGr: 40, maxGr: 50 })]);
    expect(out.startGr).toBe(30);
    expect(out.maxGr).toBe(50);
    expect(out.startGr).not.toBe(35); // the mean, which nobody tested
  });

  it('a single-charge row (start == max) consolidates normally', () => {
    const out = consolidate([row({ startGr: 27.0, maxGr: 27.0, startFps: 3100, maxFps: 3100 })]);
    expect(out.startGr).toBe(27.0);
    expect(out.maxGr).toBe(27.0);
    expect(out.sourcesCount).toBe(1);
  });

  it('is stable across re-import: a tie keeps the first row', () => {
    const rows = [row({ startGr: 35, startFps: 2400 }), row({ startGr: 35, startFps: 2450 })];
    expect(consolidate(rows).startFps).toBe(2400);
    expect(consolidate(rows).startFps).toBe(2400);
  });
});

describe('consolidate — COAL', () => {
  it('uses the COAL beside the highest max', () => {
    const out = consolidate([
      row({ maxGr: 40.0, coalMm: 70.9 }),
      row({ maxGr: 41.5, coalMm: 71.4 }), // the hottest published charge
    ]);
    expect(out.coalMm).toBe(71.4);
  });

  it('falls back to the most common COAL when the max row has none', () => {
    const out = consolidate([
      row({ maxGr: 41.5, coalMm: null }),
      row({ maxGr: 40.0, coalMm: 71.1 }),
      row({ maxGr: 39.0, coalMm: 71.1 }),
      row({ maxGr: 38.0, coalMm: 70.2 }),
    ]);
    expect(out.coalMm).toBe(71.1);
  });

  it('reports a range only when the spread exceeds 0.5 mm', () => {
    const tight = consolidate([row({ coalMm: 71.0 }), row({ coalMm: 71.3 })]);
    expect(tight.coalLoMm).toBeNull();
    expect(tight.coalHiMm).toBeNull();

    const wide = consolidate([row({ coalMm: 70.4 }), row({ coalMm: 71.6 })]);
    expect(wide.coalLoMm).toBe(70.4);
    expect(wide.coalHiMm).toBe(71.6);
  });

  it('survives a group with no COAL at all', () => {
    const out = consolidate([row({ coalMm: null }), row({ coalMm: null })]);
    expect(out.coalMm).toBeNull();
    expect(out.coalLoMm).toBeNull();
  });
});

describe('needsReview', () => {
  it('flags a window wider than 10% of its start', () => {
    // 35.0 → 41.5 is 18.6%: usually two things folded together by a name clash
    expect(needsReview(consolidate([row({ startGr: 35.0, maxGr: 41.5 })]))).toBe(true);
  });

  it('leaves an ordinary window alone', () => {
    expect(needsReview(consolidate([row({ startGr: 38.0, maxGr: 41.0 })]))).toBe(false);
  });
});

describe('pickDisplayName', () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));

  it('prefers the branded spelling over the manual’s block capitals', () => {
    // The real counts from consolidated_loads.csv.
    expect(pickDisplayName(m({ VARGET: 625, Varget: 481 }))).toBe('Varget');
  });

  it('leaves a name that is legitimately upper-case alone', () => {
    expect(pickDisplayName(m({ H4350: 900 }))).toBe('H4350');
    expect(pickDisplayName(m({ N140: 12 }))).toBe('N140');
    expect(pickDisplayName(m({ AR2208: 3 }))).toBe('AR2208');
  });

  it('does not let a rarer spelling win just for having a lowercase letter', () => {
    // "RL-16" and "Re-16" are different names, not two renderings of one.
    expect(pickDisplayName(m({ 'Re-16': 2, 'RL-16': 9 }))).toBe('RL-16');
  });

  it('prefers the branded casing only WITHIN one spelling', () => {
    expect(pickDisplayName(m({ 'IMR 4350': 40, 'imr 4350': 3, 'H4350': 10 }))).toBe('imr 4350');
  });

  it('is deterministic when frequencies tie', () => {
    const forms = m({ Bravo: 5, Alpha: 5 });
    expect(pickDisplayName(forms)).toBe('Alpha');
    expect(pickDisplayName(forms)).toBe('Alpha');
  });

  it('survives an empty set', () => {
    expect(pickDisplayName(new Map())).toBe('');
  });
});
