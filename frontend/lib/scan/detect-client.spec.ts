import { describe, expect, it } from 'vitest';
import { DETECT_ACCEPT, normaliseQuad } from './detect-client';

describe('normaliseQuad', () => {
  it('⚠️ DIVIDES BY THE DIMENSIONS THE SERVER USED, NOT THE RASTER\'S', () => {
    // The server answers in the pixels of the image it was handed. capture.ts
    // then decodes that image into a raster which is SHRUNK above 3000px on
    // the long edge. Mixing the two is silent and has broken four separate
    // harnesses on this project.
    const q = normaliseQuad(
      [{ x: 0, y: 0 }, { x: 2048, y: 0 }, { x: 2048, y: 1536 }, { x: 0, y: 1536 }],
      2048,
      1536,
    )!;
    expect(q[0]).toEqual({ x: 0, y: 0 });
    expect(q[2]).toEqual({ x: 1, y: 1 });
  });

  it('keeps corner order — TL TR BR BL, never sorted', () => {
    const q = normaliseQuad(
      [{ x: 100, y: 200 }, { x: 900, y: 260 }, { x: 880, y: 700 }, { x: 120, y: 640 }],
      1000,
      800,
    )!;
    expect(q[0].x).toBeCloseTo(0.1, 9);
    expect(q[1].x).toBeCloseTo(0.9, 9);
    expect(q[2].y).toBeCloseTo(0.875, 9);
    expect(q[3].x).toBeCloseTo(0.12, 9);
  });

  it('refuses nonsense rather than emitting Infinity', () => {
    const pts = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }];
    expect(normaliseQuad(pts, 0, 100)).toBeNull();
    expect(normaliseQuad(pts, 100, 0)).toBeNull();
    expect(normaliseQuad(pts.slice(0, 3), 100, 100)).toBeNull();
  });
});

describe('the accept threshold', () => {
  it('⚠️ SITS IN THE MEASURED GAP BETWEEN SUCCESS AND FAILURE', () => {
    // Minimum per-corner confidence over fifteen photographs of the
    // operator's own licence card, through the real service:
    const modelGotItWrong = [0.059, 0.121, 0.411, 0.427]; // all four white-on-white
    const modelGotItRight = [0.835, 0.892, 0.914, 0.915, 0.926, 0.932, 0.935, 0.943, 0.946];
    for (const c of modelGotItWrong) expect(c).toBeLessThan(DETECT_ACCEPT);
    for (const c of modelGotItRight) expect(c).toBeGreaterThan(DETECT_ACCEPT);
  });

  it('leaves real headroom on both sides, not a hairline fit', () => {
    // A threshold wedged against its nearest sample is tuned to fifteen
    // photographs rather than to the world.
    expect(DETECT_ACCEPT - 0.427).toBeGreaterThan(0.3);
    expect(0.835 - DETECT_ACCEPT).toBeGreaterThan(0.03);
  });
});
