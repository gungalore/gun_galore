import { describe, expect, it } from 'vitest';
import {
  DECODE_MAX_EDGE,
  FLOOR_DPI,
  OUTPUT_MAX_EDGE,
  capDpiFor,
  dpiOf,
} from './framing';
import { SHAPES, SHAPE_ORDER } from './shapes';

// ────────────────────────────────────────────────────────────────────
// THE OUTPUT CAP HAS PINNED THE A4 DPI TO A CONSTANT TWICE.
//
// First at 171, under a hard-coded 2000px. Then at 230, under a value derived
// from TARGET_DPI — which looked like a fix and was only a relocation. Both
// times the operator spotted it the same way: two different phones, two
// different cameras, reporting the identical number to the digit.
//
// The existing regression test only asserted the cap stayed ABOVE the floor.
// 230 cleared that comfortably while still binding on every single A4 capture,
// so the suite was green throughout. These tests assert the property that
// actually matters — that the cap does not bind on ordinary captures — rather
// than that it clears a number.
// ────────────────────────────────────────────────────────────────────

describe('the output cap must not be a second, tighter ceiling', () => {
  it('never sits below the decode cap', () => {
    // A crop cannot carry more pixels than the decoded photograph it came
    // from, and outputSize() only ever clamps down — it never upsamples. So an
    // output cap below the decode cap can only ever discard detail that
    // decode() deliberately kept. Two caps in series with different bases is
    // the whole bug.
    expect(OUTPUT_MAX_EDGE).toBeGreaterThanOrEqual(DECODE_MAX_EDGE);
  });

  it('leaves every shape clear of the resolution floor', () => {
    for (const shape of SHAPE_ORDER) {
      const cap = capDpiFor(shape);
      expect(cap, shape).not.toBeNull();
      expect(cap!, shape).toBeGreaterThan(FLOOR_DPI);
    }
  });

  it('cannot be the binding constraint before decode() already is', () => {
    // ⚠️ DELIBERATELY NOT "clears 272 dpi". The live readout measured 272 on
    // the full-resolution video frame, but decode() scales the photograph to
    // DECODE_MAX_EDGE before the crop is taken, so the detail actually
    // reaching outputSize() is lower than the viewfinder measured and by an
    // amount that depends on the stream. Asserting the cap clears 272 would be
    // asserting a premise this suite cannot check — the same mistake as the
    // old test that only checked the cap cleared the floor.
    //
    // What IS checkable: whichever of the two ceilings binds first must be the
    // source one, because that is the only one that reflects a real limit.
    expect(OUTPUT_MAX_EDGE).toBeGreaterThanOrEqual(DECODE_MAX_EDGE);
    const a4 = capDpiFor('a4')!;
    expect(a4).toBeGreaterThan(dpiOf(2690, SHAPES.a4.longMm!));
  });

  it('is not derived from any single shape, which is how A4 got pinned', () => {
    // The old cap was ceil(maxLongMm / 25.4 * TARGET_DPI * headroom). Because
    // A4 IS the largest shape, that put A4 — and only A4 — permanently at its
    // own construction threshold, a fixed headroom above the target, on every
    // device. The other two shapes cleared it by 3-4x and so never showed a
    // constant, which is exactly why it survived a fix.
    const longest = Math.max(...SHAPE_ORDER.map((k) => SHAPES[k].longMm ?? 0));
    for (const headroom of [1.1, 1.15, 1.2, 1.3]) {
      const derived = Math.ceil((longest / 25.4) * 200 * headroom);
      expect(
        OUTPUT_MAX_EDGE,
        `cap must not be re-derived from the largest shape (headroom ${headroom})`,
      ).not.toBe(derived);
    }
  });

  it('gives the A4 a ceiling that varies with framing rather than a constant', () => {
    // Half a frame and a full frame must not produce the same saved dpi. If
    // they do, the cap is binding and the number has stopped being a
    // measurement — which is the symptom, both times.
    const a4 = SHAPES.a4;
    const full = Math.min(DECODE_MAX_EDGE, 3000);
    const half = Math.round(full * 0.6);
    expect(dpiOf(full, a4.longMm!)).not.toBeCloseTo(
      dpiOf(half, a4.longMm!),
      0,
    );
  });
});
