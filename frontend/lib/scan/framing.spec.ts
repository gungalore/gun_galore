import { describe, expect, it } from 'vitest';
import { SHAPES, acrossMm, SHAPE_ORDER, guideAspect } from './shapes';
import {
  AIM_MARGIN,
  FLOOR_DPI,
  MIN_FOCUS_MM,
  TARGET_DPI,
  dpiOf,
  fillForDpi,
  framingHint,
  framingPlan,
  shortAxisPx, OUTPUT_MAX_EDGE } from './framing';

// ────────────────────────────────────────────────────────────────────
// The aim box used to be a constant, and the constant is what made the
// operator's Samsung refuse to focus: a box demanding the card fill 82% of
// the frame puts the phone nearer than the lens can manage. These tests pin
// the arithmetic that replaces it.
// ────────────────────────────────────────────────────────────────────

const CARD_MM = acrossMm('card')!;

describe('dpiOf — the measured resolution, not a predicted one', () => {
  it('reads dots per inch off a span in pixels and its real millimetres', () => {
    // An ID-1 card is 85.6mm across. 300 dpi over 85.6mm is 85.6/25.4*300 px.
    const px = (CARD_MM / 25.4) * 300;
    expect(dpiOf(px, CARD_MM)).toBeCloseTo(300, 6);
  });

  it('is the inverse of fillForDpi', () => {
    const shortPx = 2160;
    const fill = fillForDpi(300, CARD_MM, shortPx);
    expect(dpiOf(fill * shortPx, CARD_MM)).toBeCloseTo(300, 6);
  });

  it('refuses to divide by a document of no size', () => {
    expect(dpiOf(1000, 0)).toBe(0);
  });
});

describe('framingPlan — the box follows the camera', () => {
  it('⚠️ STOPS SHRINKING THE BOX ONCE THE DETECTOR BECOMES THE CONSTRAINT', () => {
    // This test USED to assert the opposite — that more pixels always buy a
    // smaller box and more working distance — and that was right while
    // resolution was the only demand being made.
    //
    // It is not any more. More resolution cannot make a document easier to
    // FIND, so below a certain size the detection floor takes over and the box
    // stops shrinking however good the camera gets. That is the fix for the
    // operator's "never held the phone 710mm away from the ID": sizing a card
    // or an ID book for 200 dpi alone puts it at ~5% of frame and arm's
    // length, where nothing can detect it.
    const hd = framingPlan({ width: 1920, height: 1080 }, 'card', 0.82);
    const uhd = framingPlan({ width: 3840, height: 2160 }, 'card', 0.82);
    // Never LARGER on the better camera...
    expect(uhd.fill).toBeLessThanOrEqual(hd.fill + 1e-9);
    // ...and the extra pixels go into resolution rather than distance.
    expect(uhd.dpi).toBeGreaterThan(hd.dpi);
    expect(uhd.distanceMm).toBeLessThan(900);
  });

  it('⚠️ A4 IS STILL RESOLUTION-BOUND, so nothing changed for the big case', () => {
    // fillForDetection must only bind where it is genuinely the constraint. An
    // A4 needs 55% of the short axis for 200 dpi and only 38% to be found, so
    // its box and distance are untouched by the floor.
    const plan = framingPlan({ width: 3840, height: 2160 }, 'a4', 0.82);
    expect(plan.dpi).toBeGreaterThanOrEqual(FLOOR_DPI);
    expect(plan.dpi).toBeLessThan(260);
  });

  it('reaches full scanning quality on a 4K stream', () => {
    const plan = framingPlan({ width: 3840, height: 2160 }, 'card', 0.82);
    expect(plan.verdict).toBe('good');
    // ⚠️ COMFORTABLY ABOVE THE TARGET, NOT EQUAL TO IT, AND THAT IS THE POINT
    // OF fillForDetection. A card sized only for 200 dpi covers 5% of the
    // frame and the detector cannot find it; sized to be FINDABLE it lands
    // near 500 dpi as a side effect. plan.dpi reports what the box achieves.
    expect(plan.dpi).toBeGreaterThanOrEqual(TARGET_DPI);
    expect(plan.distanceMm).toBeGreaterThan(MIN_FOCUS_MM);
  });

  it('reaches the 200 dpi bar on a 1080p stream with room to spare', () => {
    // ⚠️ THIS TEST INVERTED WHEN TARGET_DPI DROPPED TO 200, AND THAT IS THE
    // POINT OF THE CHANGE. At 300 a card needed ~1011px of a 1080px short
    // axis — 94%, no room for margin — so 1080p always fell back to the
    // floor. At 200 it needs ~674px, 62%, which clears the frame-edge cliff
    // comfortably. The commonest stream a browser hands out now meets the
    // bar outright instead of quietly conceding it.
    const plan = framingPlan({ width: 1920, height: 1080 }, 'card', 0.82);
    expect(plan.verdict).toBe('good');
    expect(plan.dpi).toBeGreaterThanOrEqual(TARGET_DPI);
    expect(plan.fill).toBeLessThanOrEqual(1);
    expect(plan.distanceMm).toBeGreaterThan(MIN_FOCUS_MM);
  });

  it('⚠️ SAYS SO WHEN NO BOX WORKS, INSTEAD OF DRAWING ONE ANYWAY', () => {
    // A 720p stream cannot render a card's small print at any distance this
    // camera focuses at. Drawing a box regardless hands somebody an
    // unreadable photograph of a statutory document and calls it a scan.
    const plan = framingPlan({ width: 1280, height: 720 }, 'card', 0.82);
    expect(plan.verdict).toBe('impossible');
    expect(framingHint(plan)).toContain('normal camera app');
  });

  it('stays silent when the news is fine', () => {
    expect(framingHint(framingPlan({ width: 3840, height: 2160 }, 'card', 0.82))).toBeNull();
    expect(framingHint(framingPlan({ width: 1920, height: 1080 }, 'card', 0.82))).toBeNull();
  });

  it('leaves the document margin inside the box', () => {
    const plan = framingPlan({ width: 3840, height: 2160 }, 'card', 0.82);
    // The box is larger than the document's own fill by exactly the margin,
    // so a document filling the box lands at the dpi we planned for.
    const docFill = plan.fill * (1 - AIM_MARGIN);
    // Rounded to a whole dpi for display, so compare loosely.
    expect(dpiOf(docFill * 2160, CARD_MM)).toBeCloseTo(plan.dpi, 0);
  });

  it('plans a real box for every shape, none of them fixed constants', () => {
    // The fallback-to-0.82 path was reachable only through 'Something else',
    // whose size was unknown. With that shape gone, every plan is computed
    // from real millimetres against the real stream — which is what makes the
    // dpi readout mean anything.
    for (const shape of SHAPE_ORDER) {
      const plan = framingPlan({ width: 3840, height: 2160 }, shape, 0.82);
      expect(plan.dpi, `${shape} planned no dpi`).toBeGreaterThanOrEqual(FLOOR_DPI);
      expect(plan.verdict).not.toBe('relaxed');
    }
  });

  it('survives a camera that reports nothing', () => {
    const plan = framingPlan({ width: 0, height: 0 }, 'card', 0.82);
    expect(plan.fill).toBe(0.82);
    expect(Number.isFinite(plan.fill)).toBe(true);
  });

  it('frames against the short axis whichever way the stream is reported', () => {
    // A phone can report 1080x1920 or 1920x1080 for the same camera.
    expect(shortAxisPx({ width: 1920, height: 1080 })).toBe(1080);
    expect(shortAxisPx({ width: 1080, height: 1920 })).toBe(1080);
    const a = framingPlan({ width: 1920, height: 1080 }, 'card', 0.82);
    const b = framingPlan({ width: 1080, height: 1920 }, 'card', 0.82);
    expect(a.fill).toBeCloseTo(b.fill, 9);
  });

  it('⚠️ A BIGGER DOCUMENT IS HARDER, AND A4 ONLY JUST CLEARS THE BAR', () => {
    // Counter-intuitive and worth pinning: a BIGGER document is HARDER, not
    // easier. A4 is 210mm across against a card's 85.6mm, so it needs 2.45x
    // the pixels for the same dpi. At the old 300 that meant ~2480px across a
    // 2160px axis — not reachable on any stream a browser hands out, on any
    // phone, ever. That impossibility is what forced the target down to 200,
    // where A4 needs ~1654px of 2160 and fits.
    //
    // "Fits" is the whole margin, though: 77% of the short axis before the
    // aim margin, 85% of the box after it. A4 is the document this system is
    // tightest on, so if a future change makes anything worse, this is where
    // it shows up first.
    const plan = framingPlan({ width: 3840, height: 2160 }, 'a4', 0.82);
    expect(plan.verdict).toBe('good');
    expect(plan.dpi).toBe(TARGET_DPI);
    expect(plan.fill).toBeLessThanOrEqual(1);
    expect(plan.distanceMm).toBeGreaterThan(MIN_FOCUS_MM);
    // And nothing is said to the member about it, because nothing is wrong.
    expect(framingHint(plan)).toBeNull();
  });
});

describe('⚠️ the frame-edge cliff — measured 2026-08-31, not inferred', () => {
  // Sweeping the document's margin from the frame edge across the fifteen
  // fixture photographs, scored against hand-verified ground truth:
  //
  //     flush to the edge   0/15 usable, median IoU 0.209
  //     one step off        11/15 usable, median IoU 0.959
  //     comfortable margin  13/15 usable, median IoU 0.942
  //
  // Zero to eleven on one step. These tests exist so nobody can walk the box
  // back onto that edge in pursuit of a higher dpi number.

  /** What fraction of the frame's short axis the DOCUMENT itself ends up at. */
  const docFill = (plan: ReturnType<typeof framingPlan>) => plan.fill * (1 - AIM_MARGIN);

  it('⚠️ NEVER SITS THE DOCUMENT FLUSH TO THE FRAME EDGE, ON ANY STREAM', () => {
    // The failure is not gradual. A document touching the edge is not detected
    // at all, so there is no stream size for which crowding the edge is a
    // reasonable trade against resolution.
    for (const [w, h] of [
      [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [1080, 1920], [4032, 3024],
    ] as const) {
      for (const shape of ['card', 'a4'] as const) {
        const plan = framingPlan({ width: w, height: h }, shape, 0.82);
        // 'impossible' draws no usable box and tells the member to go
        // elsewhere, so it is exempt — it is the honest refusal, not a crowded box.
        if (plan.verdict === 'impossible') continue;
        expect(docFill(plan)).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it('⚠️ NEVER CLAMPS THE BOX PAST THE FRAME TO BUY DPI', () => {
    // The invariant the old 300-dpi version of this test was really
    // protecting, stated directly instead of through one example. A plan may
    // concede resolution; it may never concede the frame-edge margin, because
    // the cliff is measured (0/15 flush, 11/15 one step off) and resolution
    // is a gradient. If a fill above 1 ever comes back green, somebody has
    // clamped the box rather than rejecting it.
    for (const stream of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
    ]) {
      for (const shape of ['card', 'a4'] as const) {
        const plan = framingPlan(stream, shape, 0.82);
        if (plan.verdict === 'impossible') continue;
        expect(plan.fill).toBeLessThanOrEqual(1);
        expect(docFill(plan)).toBeLessThan(0.9);
      }
    }
  });

  it('⚠️ THE RELAXED BAND IS EMPTY WHILE TARGET AND FLOOR ARE EQUAL', () => {
    // Not dead code — a function of two constants. The operator set the bar
    // at a single 200 dpi, so there is no gap between "hit the target" and
    // "hit the floor" for a plan to land in, and every plan is now either
    // good or impossible. Raise TARGET_DPI and the band comes back on its
    // own. This is here so the absence reads as designed rather than broken.
    expect(TARGET_DPI).toBe(FLOOR_DPI);
    for (const w of [640, 1280, 1920, 2560, 3840]) {
      for (const shape of ['card', 'a4'] as const) {
        const plan = framingPlan({ width: w, height: (w * 9) / 16 }, shape, 0.82);
        expect(plan.verdict).not.toBe('relaxed');
      }
    }
  });

  it('puts the document at a plausible size in frame, computed honestly', () => {
    // ⚠️ AREA IS NOT docFill SQUARED. docFill is the fraction of the frame's
    // SHORT axis the document spans; its other dimension follows from the
    // document's own aspect, and the frame's own aspect divides it. The naive
    // square version overstated a 4K card as 21.9% of frame when it is 7.8%,
    // and passed a band assertion by luck. Compute it properly or not at all.
    const spec = SHAPES.card;
    const stream = { width: 3840, height: 2160 };
    const shortPx = shortAxisPx(stream);
    const longPx = Math.max(stream.width, stream.height);
    const plan = framingPlan(stream, 'card', 0.82);
    const across = plan.fill * (1 - AIM_MARGIN) * shortPx;
    const along = across * (spec.shortMm! / spec.longMm!);
    const areaFraction = (across * along) / (shortPx * longPx);

    // The oracle-cropped sweep put the detector's preferred band at 13-23% of
    // frame area, and a 4K card lands at ~8% — BELOW it, not inside. That is
    // deliberate and worth stating rather than tuning away: coverage bought
    // only +2/15 (11 -> 13) in that sweep, which at n=15 is about 1.3 sigma,
    // while the resolution this buys is real and the frame-edge margin it
    // preserves is the thing that actually matters. If someone later wants to
    // chase the band, the cost is working distance and the gain is marginal.
    // ⚠️ THE LOWER BOUND MOVED WITH THE TARGET, 0.04 -> 0.03. Asking for 200
    // dpi rather than 300 asks for two thirds of the pixels, which is a
    // smaller document in frame and stands the member further back. That is
    // the trade being made deliberately, not a regression: further back is
    // the safe direction, since too close is a hard blur failure and too far
    // is a linear loss.
    expect(areaFraction).toBeGreaterThan(0.03);
    expect(areaFraction).toBeLessThan(0.25);
  });
});

describe('⚠️ the output cap must never make the target unreachable', () => {
  // The bug this pins: OUTPUT_MAX_EDGE was hard-coded at 2000, which on a
  // 1.414 page is a 1414px short edge — and 1414 over 210mm is exactly 171
  // dpi. Both of the operator's phones reported precisely that, on different
  // cameras, because it was never a measurement. Every A4 was shrunk below our
  // own floor on the way out and then graded "Poor" for it.
  it('lets the largest document we accept clear the floor', () => {
    for (const shape of SHAPE_ORDER) {
      const across = acrossMm(shape)!;
      const a = guideAspect(shape)!; // width over height
      // The output at the cap: long edge capped, short edge follows.
      const shortPx = a >= 1 ? OUTPUT_MAX_EDGE * a : OUTPUT_MAX_EDGE * a;
      const dpi = dpiOf(a >= 1 ? OUTPUT_MAX_EDGE : shortPx, across);
      expect(dpi, `${shape} is capped below the floor`).toBeGreaterThanOrEqual(
        FLOOR_DPI,
      );
    }
  });

  it('clears it with headroom, not by a hair', () => {
    // A cap that lands exactly on the floor leaves a member who frames well
    // no better off than one who does not.
    const dpi = dpiOf(OUTPUT_MAX_EDGE / (297 / 210), 210);
    expect(dpi).toBeGreaterThan(FLOOR_DPI * 1.1);
  });

  it('follows TARGET_DPI rather than sitting beside it', () => {
    // Derived, so raising the target cannot leave the cap behind.
    expect(OUTPUT_MAX_EDGE).toBeGreaterThan((297 / 25.4) * TARGET_DPI);
  });
});
