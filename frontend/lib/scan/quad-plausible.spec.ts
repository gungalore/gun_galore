import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import { MIN_ANGLE, OUT_OF_FRAME, implausibleWhy } from './quad-plausible';

const W = 1000;
const H = 1400;
const good: Quad = [
  { x: 200, y: 300 },
  { x: 800, y: 300 },
  { x: 800, y: 1150 },
  { x: 200, y: 1150 },
];

describe('the model quad has to be the shape of a photographed rectangle', () => {
  it('passes an ordinary page', () => {
    expect(implausibleWhy(good, W, H)).toBeNull();
  });

  it('passes a page at a punishing but real angle', () => {
    // Perspective opens corners; it does not open them past MIN_ANGLE. A quad
    // that fails this test failed to decode, it was not photographed badly.
    const steep: Quad = [
      { x: 330, y: 300 },
      { x: 700, y: 300 },
      { x: 880, y: 1150 },
      { x: 130, y: 1150 },
    ];
    expect(implausibleWhy(steep, W, H)).toBeNull();
  });

  it('⚠️ REJECTS A THIN CORNER EVEN THOUGH THE SHAPE IS CONVEX', () => {
    // The measured failures were at 32.3° and 45.5°, and one of them carried
    // minConfidence 0.546 — four corners each individually plausible to the
    // model, mutually impossible as a rectangle. Confidence is computed PER
    // CORNER and can never see the shape they make together, which is the
    // whole reason this is a separate check rather than a higher threshold.
    //
    // A convex kite, so it gets past isConvex and has to be caught on the
    // angle: the top corner opens 2*atan(400/900) = 48°.
    const kite: Quad = [
      { x: 500, y: 100 },
      { x: 900, y: 1000 },
      { x: 500, y: 1100 },
      { x: 100, y: 1000 },
    ];
    expect(implausibleWhy(kite, W, H)).toBe('thin-corner');
  });

  it('rejects a corner well off the side of the screen', () => {
    const off: Quad = [
      { x: -0.2 * W, y: 300 },
      { x: 800, y: 300 },
      { x: 800, y: 1150 },
      { x: 200, y: 1150 },
    ];
    expect(implausibleWhy(off, W, H)).toBe('off-frame');
  });

  it('⚠️ TOLERATES A PAGE RIGHT ON THE EDGE, WHICH IS A REAL FRAMING', () => {
    // Not zero tolerance: a document held to the edge genuinely has corners
    // within a pixel of it, and letterbox rounding can put one just past.
    const edge: Quad = [
      { x: -OUT_OF_FRAME * W * 0.5, y: 10 },
      { x: W + OUT_OF_FRAME * W * 0.5, y: 10 },
      { x: W, y: H - 10 },
      { x: 0, y: H - 10 },
    ];
    expect(implausibleWhy(edge, W, H)).toBeNull();
  });

  it('rejects a bowtie', () => {
    const crossed: Quad = [
      { x: 200, y: 300 },
      { x: 800, y: 300 },
      { x: 200, y: 1150 },
      { x: 800, y: 1150 },
    ];
    expect(implausibleWhy(crossed, W, H)).not.toBeNull();
  });

  it('rejects nothing, NaN, and collapsed corners without throwing', () => {
    expect(implausibleWhy(null, W, H)).toBe('degenerate');
    const nan = good.map((p, i) => (i === 2 ? { x: NaN, y: p.y } : p)) as Quad;
    expect(implausibleWhy(nan, W, H)).toBe('degenerate');
    const collapsed: Quad = [
      { x: 200, y: 300 },
      { x: 200, y: 300 },
      { x: 800, y: 1150 },
      { x: 200, y: 1150 },
    ];
    expect(implausibleWhy(collapsed, W, H)).toBe('degenerate');
  });

  it('matches the classical detector rather than inventing its own bar', () => {
    // Two detectors disagreeing about what a document looks like is how a
    // scanner ends up with two personalities. detect.ts refuses below 50.
    expect(MIN_ANGLE).toBe(50);
  });
});
