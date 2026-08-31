import { describe, expect, it } from 'vitest';
import { DETAIL_FLOOR_RATIO, FOV_SAMPLE, type FovSample, detailOf } from './fov';

/** A sample carrying fine structure — alternating pixels at `amp` contrast. */
function fine(amp: number): FovSample {
  const n = FOV_SAMPLE;
  const data = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) data[y * n + x] = 128 + ((x + y) % 2 ? amp : -amp);
  }
  return { data, size: n };
}

/** The same total contrast, but only coarse structure — one soft ramp. */
function coarse(amp: number): FovSample {
  const n = FOV_SAMPLE;
  const data = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      data[y * n + x] = 128 + Math.round(amp * Math.sin((2 * Math.PI * x) / n));
    }
  }
  return { data, size: n };
}

describe('detailOf', () => {
  it('is zero for a flat sample — no structure is neither fine nor coarse', () => {
    const n = FOV_SAMPLE;
    expect(detailOf({ data: new Uint8Array(n * n).fill(128), size: n })).toBe(0);
  });

  it('scores fine structure far above coarse structure of the same contrast', () => {
    // This is the whole point: a depth sensor renders a recognisable but
    // mushy scene — plenty of contrast, no detail.
    expect(detailOf(fine(40))).toBeGreaterThan(detailOf(coarse(40)) * 10);
  });

  it('is contrast-invariant, so it does not just rank lenses by exposure', () => {
    // Two lenses metering the same scene differently must not be separated by
    // that alone — dividing by each sample's own deviation is what prevents it.
    const bright = detailOf(fine(60));
    const dim = detailOf(fine(20));
    expect(Math.abs(bright - dim) / bright).toBeLessThan(0.05);
  });

  it('puts a mushy sensor below the floor and a softer real lens above it', () => {
    const main = detailOf(fine(40));
    // An ultra-wide is softer than a main, but nothing like half.
    const ultrawide = detailOf(fine(40)) * 0.8;
    const depth = detailOf(coarse(40));
    expect(ultrawide).toBeGreaterThanOrEqual(main * DETAIL_FLOOR_RATIO);
    expect(depth).toBeLessThan(main * DETAIL_FLOOR_RATIO);
  });
});
