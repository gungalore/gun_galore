import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import {
  AIM_PASS_MARGIN,
  DCN_MEAN,
  DCN_SIZE,
  DCN_STD,
  decodeOutputs,
  mapFromRegion,
  measuredAspect,
  pickCandidate,
  regionForAim,
  toInputTensor,
} from './doccorner';

const quadOf = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('toInputTensor', () => {
  it('normalises with ImageNet mean/std, NHWC, from RGBA or RGB', () => {
    const n = DCN_SIZE * DCN_SIZE;
    const rgba = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 0;
      rgba[i * 4 + 2] = 128;
      rgba[i * 4 + 3] = 255;
    }
    const t = toInputTensor(rgba, 4);
    expect(t.length).toBe(n * 3);
    expect(t[0]).toBeCloseTo((1 - DCN_MEAN[0]) / DCN_STD[0], 5);
    expect(t[1]).toBeCloseTo((0 - DCN_MEAN[1]) / DCN_STD[1], 5);
    expect(t[2]).toBeCloseTo((128 / 255 - DCN_MEAN[2]) / DCN_STD[2], 5);
    // The last pixel lands at the end — NHWC, not planar.
    expect(t[n * 3 - 3]).toBeCloseTo(t[0], 6);

    const rgb = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = 255;
      rgb[i * 3 + 2] = 128;
    }
    expect(Array.from(toInputTensor(rgb, 3).slice(0, 3))).toEqual(Array.from(t.slice(0, 3)));
  });
});

describe('decodeOutputs', () => {
  it('reads TL TR BR BL fractions and a sigmoid presence', () => {
    const r = decodeOutputs([0.1, 0.2, 0.9, 0.2, 0.9, 0.8, 0.1, 0.8], 4);
    expect(r.quad[0]).toEqual({ x: 0.1, y: 0.2 });
    expect(r.quad[2]).toEqual({ x: 0.9, y: 0.8 });
    expect(r.score).toBeCloseTo(0.982, 3);
  });

  it('clamps a corner the head placed a hair outside the frame', () => {
    const r = decodeOutputs([-0.01, 0, 1.02, 0, 1, 1, 0, 1], -3);
    expect(r.quad[0].x).toBe(0);
    expect(r.quad[1].x).toBe(1);
    expect(r.score).toBeLessThan(0.05);
  });
});

describe('regionForAim / mapFromRegion', () => {
  it('grows the box by the margin and clamps to the frame', () => {
    const r = regionForAim({ x: 0.3, y: 0.4, width: 0.4, height: 0.2 });
    expect(r.x).toBeCloseTo(0.3 - 0.4 * AIM_PASS_MARGIN, 6);
    expect(r.w).toBeCloseTo(0.4 * (1 + 2 * AIM_PASS_MARGIN), 6);
    const edge = regionForAim({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 });
    expect(edge.x + edge.w).toBeLessThanOrEqual(1);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1);
  });

  it('maps a region quad back to frame fractions', () => {
    const q = mapFromRegion(quadOf(0, 0, 1, 1), { x: 0.25, y: 0.5, w: 0.5, h: 0.25 });
    expect(q[0]).toEqual({ x: 0.25, y: 0.5 });
    expect(q[2]).toEqual({ x: 0.75, y: 0.75 });
  });
});

describe('measuredAspect', () => {
  it('is long over short whichever way the document lies', () => {
    expect(measuredAspect(quadOf(0, 0, 160, 100))).toBeCloseTo(1.6, 6);
    expect(measuredAspect(quadOf(0, 0, 100, 160))).toBeCloseTo(1.6, 6);
  });
});

describe('pickCandidate — the card, not the sheet it lies on', () => {
  const frame = { frameW: 1000, frameH: 1500 };
  // A licence card (1.585) in the aim box, on a white A4 sheet.
  const aim = { x: 0.25, y: 0.4, width: 0.5, height: 0.2 };
  const card = quadOf(0.27, 0.41, 0.73, 0.59);
  const sheet = quadOf(0.05, 0.1, 0.95, 0.95);

  it('⚠️ PREFERS THE AIM-PASS CARD OVER THE FULL-PASS SHEET', () => {
    const p = pickCandidate(
      [
        { quad: sheet, score: 0.99, region: 'full' },
        { quad: card, score: 0.99, region: 'aim' },
      ],
      { ...frame, minScore: 0.5, expectAspect: 1.585, aim },
    );
    expect(p?.region).toBe('aim');
    expect(p?.px[0].x).toBeCloseTo(270, 6);
  });

  it('with no shape and no box, the full pass wins a tie', () => {
    const p = pickCandidate(
      [
        { quad: card, score: 0.99, region: 'full' },
        { quad: card, score: 0.99, region: 'aim' },
      ],
      { ...frame, minScore: 0.5 },
    );
    expect(p?.region).toBe('full');
  });

  it('drops a candidate under the presence score, and a triangle', () => {
    const triangle: Quad = [
      { x: 0.3, y: 0.4 },
      { x: 0.7, y: 0.4 },
      { x: 0.7, y: 0.6 },
      { x: 0.69, y: 0.59 },
    ];
    const p = pickCandidate(
      [
        { quad: card, score: 0.2, region: 'full' },
        { quad: triangle, score: 0.99, region: 'aim' },
      ],
      { ...frame, minScore: 0.5, expectAspect: 1.585, aim },
    );
    expect(p).toBeNull();
  });

  it('still takes the sheet when that is what the member said they are scanning', () => {
    const p = pickCandidate(
      [
        { quad: sheet, score: 0.99, region: 'full' },
        { quad: card, score: 0.99, region: 'aim' },
      ],
      {
        ...frame,
        minScore: 0.5,
        expectAspect: 1.414,
        aim: { x: 0.05, y: 0.1, width: 0.9, height: 0.85 },
      },
    );
    expect(p?.region).toBe('full');
  });
});
