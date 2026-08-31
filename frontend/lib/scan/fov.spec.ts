import { describe, expect, it } from 'vitest';
import {
  FOV_SAMPLE,
  type FovSample,
  centreCrop,
  correlate,
  matchFov,
  rankByFov,
  widerOf,
} from './fov';

/** A deterministic textured scene — the sort of thing any ordinary surface gives. */
function scene(size = FOV_SAMPLE, seed = 7): FovSample {
  const data = new Uint8Array(size * size);
  let s = seed;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      // Low-frequency structure plus grain, so a crop still correlates.
      // ⚠️ THE SEED MUST CHANGE THE STRUCTURE, NOT JUST THE GRAIN. A first
      // version varied only the noise term, so two "unrelated" scenes shared
      // the same dominant sine and correlated at 0.9 — the fixture was wrong,
      // not the correlator.
      const fx = 5 + (seed % 7);
      const fy = 4 + (seed % 5);
      const base = 128 + 80 * Math.sin(x / fx) * Math.cos(y / fy);
      data[y * size + x] = Math.max(0, Math.min(255, base + ((s >> 16) % 24) - 12));
    }
  }
  return { data, size };
}

/** What a NARROWER lens would see of the same scene: the centre, filling the frame. */
const narrowerView = (wide: FovSample, fraction: number) => centreCrop(wide, fraction);

describe('correlate', () => {
  it('⚠️ IGNORES BRIGHTNESS AND GAIN, WHICH DIFFER BETWEEN LENSES', () => {
    // Two lenses on one phone meter independently, so the same scene arrives
    // at different exposure through each. A plain difference would rank them
    // by brightness rather than by field of view.
    const a = scene();
    const brighter: FovSample = {
      size: a.size,
      data: Uint8Array.from(a.data, (v) => Math.min(255, v * 0.6 + 90)),
    };
    expect(correlate(a, brighter)).toBeGreaterThan(0.99);
  });

  it('is 1 against itself and near 0 against unrelated structure', () => {
    const a = scene(FOV_SAMPLE, 3);
    expect(correlate(a, a)).toBeCloseTo(1, 6);
    expect(Math.abs(correlate(a, scene(FOV_SAMPLE, 99)))).toBeLessThan(0.5);
  });

  it('returns 0 for a flat sample rather than dividing by zero', () => {
    const flat: FovSample = { data: new Uint8Array(FOV_SAMPLE * FOV_SAMPLE).fill(120), size: FOV_SAMPLE };
    expect(correlate(flat, scene())).toBe(0);
    expect(Number.isFinite(correlate(flat, flat))).toBe(true);
  });
});

describe('matchFov', () => {
  it('⚠️ RECOVERS THE RATIO BETWEEN A WIDE LENS AND A NARROW ONE', () => {
    // The whole mechanism: a narrower lens sees the centre of what the wide
    // one sees. Recovering that fraction is how we tell them apart without
    // reading a label or asking for focusDistance.
    const wide = scene();
    for (const truth of [0.4, 0.5, 0.7]) {
      const m = matchFov(wide, narrowerView(wide, truth));
      expect(m.trusted).toBe(true);
      expect(m.scale).toBeCloseTo(truth, 1);
    }
  });

  it('reports scale 1 when both lenses see the same field', () => {
    const a = scene();
    const m = matchFov(a, a);
    expect(m.scale).toBeCloseTo(1, 1);
    expect(m.trusted).toBe(true);
  });

  it('⚠️ DECLINES ON A BLANK SCENE INSTEAD OF INVENTING A RATIO', () => {
    // Pointed at a plain wall there is genuinely nothing to measure. A
    // confident number here would be noise dressed as a measurement.
    const flat: FovSample = { data: new Uint8Array(FOV_SAMPLE * FOV_SAMPLE).fill(200), size: FOV_SAMPLE };
    expect(matchFov(flat, flat).trusted).toBe(false);
  });
});

describe('widerOf', () => {
  it('⚠️ NAMES THE WIDER LENS — THE ONE THAT FOCUSES CLOSEST', () => {
    // On a phone the widest lens has the shortest focal length and therefore
    // the nearest minimum focus. That is the shortcut this whole file rests
    // on: we cannot measure focus distance blind, but we can measure field.
    const wide = scene();
    const narrow = narrowerView(wide, 0.45);
    expect(widerOf(wide, narrow)).toBe('a');
    expect(widerOf(narrow, wide)).toBe('b');
  });

  it('says "cannot tell" when the fields are the same', () => {
    const a = scene();
    expect(widerOf(a, a)).toBeNull();
  });

  it('says "cannot tell" on a featureless scene', () => {
    const flat: FovSample = { data: new Uint8Array(FOV_SAMPLE * FOV_SAMPLE).fill(30), size: FOV_SAMPLE };
    expect(widerOf(flat, flat)).toBeNull();
  });
});

describe('rankByFov', () => {
  it('orders three lenses widest first', () => {
    const wide = scene();
    const items = [
      { id: 'tele', sample: narrowerView(wide, 0.3) },
      { id: 'ultra', sample: wide },
      { id: 'main', sample: narrowerView(wide, 0.6) },
    ];
    expect(rankByFov(items).map((i) => i.id)).toEqual(['ultra', 'main', 'tele']);
  });

  it('⚠️ KEEPS THE ORIGINAL ORDER WHEN IT CANNOT TELL', () => {
    // A phone whose scene supports no decision must behave exactly as it does
    // today. A scanner that picks a different lens each time it opens is
    // worse than one that always picks the same mediocre lens.
    const flat: FovSample = { data: new Uint8Array(FOV_SAMPLE * FOV_SAMPLE).fill(90), size: FOV_SAMPLE };
    const items = [
      { id: 'first', sample: flat },
      { id: 'second', sample: flat },
      { id: 'third', sample: flat },
    ];
    expect(rankByFov(items).map((i) => i.id)).toEqual(['first', 'second', 'third']);
  });

  it('survives a single lens and an empty list', () => {
    expect(rankByFov([{ id: 'only', sample: scene() }]).map((i) => i.id)).toEqual(['only']);
    expect(rankByFov([])).toEqual([]);
  });
});
