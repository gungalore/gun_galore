import { describe, expect, it } from 'vitest';
import type { Gray } from './detect';
import type { Quad } from './geometry';
import { STRONG, bestCandidate, maskIoU, scoreQuad } from './quad-score';

const W = 300;
const H = 400;

/**
 * A page on a darker desk, with print on it.
 *
 * The print matters: it is what a naive "is there a gradient here" test would
 * mistake for a document edge, and it is what a spine-straddling quad runs
 * through.
 */
function scene(doc = { x0: 60, y0: 80, x1: 240, y1: 330 }): Gray {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const onPage = x >= doc.x0 && x <= doc.x1 && y >= doc.y0 && y <= doc.y1;
      let v = onPage ? 232 : 96;
      // Lines of print across the middle of the page.
      if (onPage && y % 18 < 4 && x > doc.x0 + 20 && x < doc.x1 - 20) v = 70;
      data[y * W + x] = v;
    }
  }
  return { data, width: W, height: H } as Gray;
}

const quadOf = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('scoreQuad', () => {
  it('gives full support to a quad sitting on the real edges', () => {
    const s = scoreQuad(scene(), quadOf(60, 80, 240, 330));
    expect(s.support).toBeGreaterThan(0.9);
    expect(s.worstSide).toBeGreaterThan(0.9);
  });

  it('⚠️ CATCHES THE ONE SIDE THAT RUNS THROUGH OPEN PAGE', () => {
    // The spine-straddling failure in miniature: three sides land on the
    // document's real border, the fourth cuts across printed content. The
    // AVERAGE still looks respectable — which is why worstSide is what the
    // arbitration reads.
    const s = scoreQuad(scene(), quadOf(150, 80, 240, 330));
    expect(s.worstSide).toBeLessThan(0.3);
    expect(s.support).toBeGreaterThan(s.worstSide);
  });

  it('scores a quad in empty desk at nearly nothing', () => {
    const s = scoreQuad(scene(), quadOf(10, 10, 50, 60));
    expect(s.support).toBeLessThan(0.15);
  });

  it('is not fooled by lines of print into calling them a border', () => {
    // A quad snapped onto two text lines has horizontal gradient support but
    // no vertical: its worst side must fail.
    const s = scoreQuad(scene(), quadOf(100, 98, 200, 116));
    expect(s.worstSide).toBeLessThan(0.5);
  });

  it('needs a real contrast step, not a whisper', () => {
    const flat: Gray = {
      data: new Uint8Array(W * H).fill(150),
      width: W,
      height: H,
    } as Gray;
    // A few levels of noise must not read as an edge.
    for (let y = 80; y < 330; y++) {
      for (let x = 60; x < 240; x++) flat.data[y * W + x] = 150 + (STRONG - 6);
    }
    expect(scoreQuad(flat, quadOf(60, 80, 240, 330)).support).toBeLessThan(0.2);
  });
});

describe('maskIoU', () => {
  const inBox =
    (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) =>
      x >= x0 && x <= x1 && y >= y0 && y <= y1;

  it('is near 1 for a quad matching the mask', () => {
    expect(
      maskIoU(quadOf(60, 80, 240, 330), inBox(60, 80, 240, 330), { x0: 0, y0: 0, x1: W, y1: H }),
    ).toBeGreaterThan(0.9);
  });

  it('is low for a quad covering half the mask', () => {
    // Integrated over the FRAME, not the quad's neighbourhood — otherwise the
    // union is truncated and the score flatters the quad.
    const iou = maskIoU(quadOf(150, 80, 240, 330), inBox(60, 80, 240, 330), {
      x0: 0, y0: 0, x1: W, y1: H,
    });
    expect(iou).toBeLessThan(0.6);
    expect(iou).toBeGreaterThan(0.35);
  });

  it('is 0 for a degenerate quad', () => {
    expect(maskIoU(quadOf(10, 10, 10, 10), inBox(0, 0, W, H))).toBe(0);
  });
});

describe('bestCandidate', () => {
  it('⚠️ PREFERS EVIDENCE OVER WHICHEVER HEAD WAS MORE CONFIDENT', () => {
    const g = scene();
    const good = { quad: quadOf(60, 80, 240, 330), from: 'mask' };
    const spine = { quad: quadOf(150, 80, 240, 330), from: 'corners' };
    // Order reversed too, so the answer cannot come from array position.
    for (const list of [[good, spine], [spine, good]]) {
      const r = bestCandidate(g, list);
      expect(r?.pick.from).toBe('mask');
    }
  });

  it('uses the mask to break a near-tie', () => {
    const g = scene();
    // Two quads with similar edge support; the mask agrees with only one.
    const a = { quad: quadOf(60, 80, 240, 330), from: 'a' };
    const b = { quad: quadOf(60, 80, 240, 330 - 2), from: 'b' };
    const r = bestCandidate(
      g,
      [b, a],
      (x, y) => x >= 60 && x <= 240 && y >= 80 && y <= 330,
      { x0: 0, y0: 0, x1: W, y1: H },
    );
    expect(r?.pick.from).toBe('a');
  });

  it('returns null for no candidates', () => {
    expect(bestCandidate(scene(), [])).toBeNull();
  });
});

describe('⚠️ a lone candidate is still scored — the regression that shipped', () => {
  // The bug, in one sentence: `candidates.length === 1` took the quad straight
  // through with no scoring, so when the corner heads declined the mask won
  // unvalidated. It broke by document type — cards have confident corners and
  // always had two candidates, so arbitration ran and hid the fault; A4 and ID
  // books decline more often and got the unchecked mask.
  //
  // Scoring is the admission test, not a tie-break.
  it('scores a single candidate rather than waving it through', () => {
    const g = scene();
    const onlyBad = [{ quad: quadOf(150, 80, 240, 330), from: 'mask' }];
    const r = bestCandidate(g, onlyBad);
    expect(r).not.toBeNull();
    // A lone candidate is still returned — the CALLER decides whether the
    // score clears its floor — but the score must be present and must be low.
    expect(r!.score.worstSide).toBeLessThan(0.3);
  });

  it('gives a lone good candidate a score that clears any sane floor', () => {
    const r = bestCandidate(scene(), [{ quad: quadOf(60, 80, 240, 330), from: 'mask' }]);
    expect(r!.score.worstSide).toBeGreaterThan(0.8);
  });

  it('separates a real quad from a spine-straddler by more than a whisker', () => {
    // The gap the floor sits in. If these ever converge, the floor is
    // arbitrary and needs measuring on real captures instead.
    const g = scene();
    const good = bestCandidate(g, [{ quad: quadOf(60, 80, 240, 330), from: 'a' }])!;
    const bad = bestCandidate(g, [{ quad: quadOf(150, 80, 240, 330), from: 'b' }])!;
    expect(good.score.worstSide - bad.score.worstSide).toBeGreaterThan(0.5);
  });
});
