import { HEATMAP_SIZE, cellToModelSpace, letterboxFor, toSourceSpace } from './letterbox';
import { maskCoverage, readCorners, refinePeak } from './docquad-postprocess';

/** Heatmaps with a single sharp peak per channel at the given cells. */
function peaksAt(cells: Array<[number, number]>, peak = 8, floor = -4): Float32Array {
  const n = HEATMAP_SIZE * HEATMAP_SIZE;
  const out = new Float32Array(4 * n).fill(floor);
  cells.forEach(([col, row], c) => {
    out[c * n + row * HEATMAP_SIZE + col] = peak;
  });
  return out;
}

describe('readCorners', () => {
  it('⚠️ RETURNS SOURCE-FRAME COORDINATES, NOT MODEL SPACE', () => {
    // The single most repeated bug in this project: predictions left in
    // 256-space and compared against ground truth in original pixels. A
    // corner at cell (32,32) is mid-frame, so it must come back mid-frame.
    const lb = letterboxFor(2048, 1536);
    const r = readCorners(peaksAt([[32, 32], [32, 32], [32, 32], [32, 32]]), lb);
    // NOT exactly mid-frame, and that is the cell-centre convention working.
    // Cell 32's centre is (32+0.5)*4 = 130 in model space, and with 64 cells
    // the true midpoint falls BETWEEN cells 31 and 32. Undoing a 0.125 scale
    // and a 32px vertical pad puts it at (1040, 784). The naive (i/64)*256
    // mapping would give exactly (1024, 768) — which looks tidier and is
    // half a cell wrong on every corner, in the same direction, always.
    expect(r.quad[0].x).toBeCloseTo(1040, 6);
    expect(r.quad[0].y).toBeCloseTo(784, 6);
    // Sanity: it is near the middle, just not exactly on it.
    expect(Math.abs(r.quad[0].x - 1024)).toBeLessThan(32);
  });

  it('agrees exactly with the letterbox inverse, corner by corner', () => {
    const lb = letterboxFor(1920, 1080);
    const cells: Array<[number, number]> = [[8, 20], [55, 22], [56, 44], [9, 46]];
    const r = readCorners(peaksAt(cells), lb);
    cells.forEach(([col, row], i) => {
      const want = toSourceSpace(lb, cellToModelSpace(col, row));
      expect(r.quad[i].x).toBeCloseTo(want.x, 9);
      expect(r.quad[i].y).toBeCloseTo(want.y, 9);
    });
  });

  it('reports the WEAKEST corner, never an average', () => {
    // Three excellent corners must not carry one fabricated one — that is
    // exactly what made our old aggregate score uncorrelated with correctness.
    const n = HEATMAP_SIZE * HEATMAP_SIZE;
    const h = peaksAt([[10, 10], [50, 10], [50, 40], [10, 40]], 10);
    // Flatten the fourth channel: strong elsewhere, nothing here.
    for (let i = 0; i < n; i++) h[3 * n + i] = 0.01;
    const r = readCorners(h, letterboxFor(1920, 1080));
    expect(r.minConfidence).toBeLessThan(0.6);
    expect(r.corners[0].confidence).toBeGreaterThan(0.99);
    // The mean of the four would have looked fine; the min does not.
    const mean = r.corners.reduce((s, c) => s + c.confidence, 0) / 4;
    expect(mean).toBeGreaterThan(r.minConfidence);
  });

  it('a sharp peak scores high sigma, a flat plane scores none', () => {
    const sharp = readCorners(peaksAt([[10, 10], [50, 10], [50, 40], [10, 40]], 20), letterboxFor(1920, 1080));
    expect(sharp.minSigma).toBeGreaterThan(5);
    const flat = new Float32Array(4 * HEATMAP_SIZE * HEATMAP_SIZE).fill(1.5);
    const none = readCorners(flat, letterboxFor(1920, 1080));
    expect(none.minSigma).toBe(0);
  });

  it('notices a corner predicted out on the letterbox padding', () => {
    // 1920x1080 pads top and bottom, so row 0 is grey border, not document.
    const lb = letterboxFor(1920, 1080);
    const r = readCorners(peaksAt([[32, 0], [32, 32], [32, 32], [32, 32]]), lb);
    expect(r.corners[0].onPadding).toBe(true);
    expect(r.corners[1].onPadding).toBe(false);
  });

  it('survives a large logit without overflowing to NaN', () => {
    const r = readCorners(peaksAt([[1, 1], [2, 2], [3, 3], [4, 4]], 900, -900), letterboxFor(1920, 1080));
    expect(Number.isFinite(r.minConfidence)).toBe(true);
    expect(r.minConfidence).toBeGreaterThan(0.99);
  });
});

describe('refinePeak — the corner between the cells', () => {
  const n = HEATMAP_SIZE * HEATMAP_SIZE;

  it('an isolated peak reads exactly its cell, so integer fixtures are unchanged', () => {
    const r = refinePeak(peaksAt([[20, 30], [0, 0], [0, 0], [0, 0]]), 0, 20, 30, 8);
    expect(r.col).toBeCloseTo(20, 4);
    expect(r.row).toBeCloseTo(30, 4);
  });

  it('two equal neighbours read the midpoint — the case the argmax cannot express', () => {
    const h = new Float32Array(4 * n).fill(-4);
    h[30 * HEATMAP_SIZE + 20] = 8;
    h[30 * HEATMAP_SIZE + 21] = 8;
    const r = refinePeak(h, 0, 20, 30, 8);
    expect(r.col).toBeCloseTo(20.5, 4);
    expect(r.row).toBeCloseTo(30, 4);
  });

  it('recovers the true centre of a blurred peak to a fraction of a cell', () => {
    // A Gaussian blob centred at (20.3, 30.7) — what a heatmap head actually
    // emits — sampled on the cell grid. The argmax says (20, 31); the mass
    // says where it really is.
    const h = new Float32Array(4 * n).fill(-6);
    const cx = 20.3;
    const cy = 30.7;
    for (let y = 26; y <= 35; y++) {
      for (let x = 16; x <= 25; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        h[y * HEATMAP_SIZE + x] = 8 - d2 / (2 * 1.2 * 1.2);
      }
    }
    const r = readCorners(h, letterboxFor(1000, 1000));
    const want = toSourceSpace(letterboxFor(1000, 1000), cellToModelSpace(cx, cy));
    // Within a tenth of a cell (a cell is 1000/64 ≈ 15.6 source px here).
    expect(Math.abs(r.quad[0].x - want.x)).toBeLessThan(1.6);
    expect(Math.abs(r.quad[0].y - want.y)).toBeLessThan(1.6);
  });

  it('clips at the plane edge instead of reading off it', () => {
    const r = refinePeak(peaksAt([[0, 0], [0, 0], [0, 0], [0, 0]]), 0, 0, 0, 8);
    expect(r.col).toBeGreaterThanOrEqual(0);
    expect(r.row).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.col)).toBe(true);
  });
});

describe('maskCoverage — the output we have been throwing away', () => {
  it('reads near zero on an empty frame and high on a full one', () => {
    const n = HEATMAP_SIZE * HEATMAP_SIZE;
    expect(maskCoverage(new Float32Array(n).fill(-6))).toBe(0);
    expect(maskCoverage(new Float32Array(n).fill(6))).toBe(1);
  });

  it('measures the fraction the model calls document', () => {
    const n = HEATMAP_SIZE * HEATMAP_SIZE;
    const m = new Float32Array(n).fill(-6);
    for (let i = 0; i < n / 4; i++) m[i] = 3;
    expect(maskCoverage(m)).toBeCloseTo(0.25, 6);
  });
});
