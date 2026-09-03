import {
  DEFAULT_WEIGHT_TOLERANCE_GR,
  WEIGHT_TOLERANCES_GR,
  resolveTolerance,
  weightWindow,
} from './bullet-weight';

describe('weightWindow', () => {
  it('is inclusive at both ends', () => {
    // A member who says 150 ± 5 means 145 and 155 are in. A half-open window
    // drops the heaviest bullet they asked for, which is the one they notice.
    expect(weightWindow(150, 5)).toEqual({ gte: 145, lte: 155 });
  });

  it('defaults to the inherited five grains', () => {
    expect(weightWindow(150)).toEqual({ gte: 145, lte: 155 });
    expect(DEFAULT_WEIGHT_TOLERANCE_GR).toBe(5);
  });

  it('collapses to the stated weight at zero', () => {
    expect(weightWindow(168, 0)).toEqual({ gte: 168, lte: 168 });
  });

  it('never inverts the window on a negative tolerance', () => {
    // An inverted range matches nothing, and an empty result reads as a broken
    // screen rather than a bad input.
    expect(weightWindow(150, -20)).toEqual({ gte: 150, lte: 150 });
  });

  it('handles the fractional weights the sources carry', () => {
    // 55.5gr and the like appear in the data; the window must not round them.
    expect(weightWindow(55.5, 5)).toEqual({ gte: 50.5, lte: 60.5 });
  });
});

describe('resolveTolerance', () => {
  it('takes the offered widths as they are', () => {
    for (const t of WEIGHT_TOLERANCES_GR) expect(resolveTolerance(t)).toBe(t);
    expect(resolveTolerance('10')).toBe(10);
  });

  it('falls back to the default on anything unreadable', () => {
    for (const bad of [undefined, null, '', 'wide', {}, Number.NaN]) {
      expect(resolveTolerance(bad)).toBe(DEFAULT_WEIGHT_TOLERANCE_GR);
    }
  });

  it('clamps a stranger from the query string to an offered width', () => {
    // ⚠️ Unbounded, one request could ask for every bullet weight in the
    // catalogue; negative, it would invert the window.
    expect(resolveTolerance(9999)).toBe(15);
    expect(resolveTolerance(-40)).toBe(0);
    expect(WEIGHT_TOLERANCES_GR).toContain(resolveTolerance(7));
  });

  it('is deterministic — the same input answers the same way', () => {
    expect(resolveTolerance(7)).toBe(resolveTolerance(7));
  });
});

describe('the model this encodes', () => {
  it('a 150gr window admits the neighbours a reloader would call the same shelf', () => {
    const w = weightWindow(150, DEFAULT_WEIGHT_TOLERANCE_GR);
    // The real .30-06 + N550 rows: 147, 150 and 155 grain bullets across
    // Barnes, Sierra, Lapua, Norma, Hornady and others. Under the old
    // maker+category match this bench returned nothing at all.
    for (const found of [147, 150, 155]) {
      expect(found).toBeGreaterThanOrEqual(w.gte);
      expect(found).toBeLessThanOrEqual(w.lte);
    }
    // …and stops before the weights that are a different bullet entirely.
    for (const other of [125, 165, 180]) {
      expect(other >= w.gte && other <= w.lte).toBe(false);
    }
  });
});
