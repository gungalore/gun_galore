import { describe, expect, it } from 'vitest';
import { acrossMm } from './shapes';
import {
  AIM_MARGIN,
  FLOOR_DPI,
  MIN_FOCUS_MM,
  TARGET_DPI,
  dpiOf,
  fillForDpi,
  framingHint,
  framingPlan,
  shortAxisPx,
} from './framing';

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
  it('⚠️ ASKS FOR A SMALLER BOX WHEN THE CAMERA GIVES MORE PIXELS', () => {
    // The whole point. More resolution means the document can sit further
    // away and still be legible, and further away is where focus lives.
    const hd = framingPlan({ width: 1920, height: 1080 }, 'card', 0.82);
    const uhd = framingPlan({ width: 3840, height: 2160 }, 'card', 0.82);
    expect(uhd.fill).toBeLessThan(hd.fill);
    expect(uhd.distanceMm).toBeGreaterThan(hd.distanceMm);
  });

  it('reaches full scanning quality on a 4K stream', () => {
    const plan = framingPlan({ width: 3840, height: 2160 }, 'card', 0.82);
    expect(plan.verdict).toBe('good');
    expect(plan.dpi).toBe(TARGET_DPI);
    expect(plan.distanceMm).toBeGreaterThan(MIN_FOCUS_MM);
  });

  it('falls back to the legible floor on a 1080p stream rather than refusing', () => {
    // 300 dpi over 85.6mm needs ~1011px, which is 94% of a 1080px short axis
    // — no room for margin. The floor is reachable and is a perfectly good
    // scan, so it is taken quietly.
    const plan = framingPlan({ width: 1920, height: 1080 }, 'card', 0.82);
    expect(plan.verdict).toBe('relaxed');
    expect(plan.dpi).toBe(FLOOR_DPI);
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
    expect(dpiOf(docFill * 2160, CARD_MM)).toBeCloseTo(plan.dpi, 3);
  });

  it('keeps the old constant for a shape whose size we do not know', () => {
    const plan = framingPlan({ width: 3840, height: 2160 }, 'any', 0.82);
    expect(plan.fill).toBe(0.82);
    expect(plan.verdict).toBe('relaxed');
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

  it('⚠️ CANNOT REACH 300 DPI ON AN A4 PAGE, EVEN AT 4K — AND SAYS SO', () => {
    // Counter-intuitive and worth pinning: a BIGGER document is HARDER, not
    // easier. A4 is 210mm across against a card's 85.6mm, so it needs 2.45x
    // the pixels for the same dpi — 300 dpi would want ~2480px across a
    // 2160px axis. Not reachable on any stream a browser hands out.
    //
    // That is fine, and it is why FLOOR_DPI exists. An A4 certificate's text
    // is many times larger than a licence card's serial number, so 200 dpi
    // reads perfectly. The point of the assertion is that the code reports
    // the floor honestly rather than claiming a target it did not hit.
    const plan = framingPlan({ width: 3840, height: 2160 }, 'a4', 0.82);
    expect(plan.verdict).toBe('relaxed');
    expect(plan.dpi).toBe(FLOOR_DPI);
    expect(plan.fill).toBeLessThanOrEqual(1);
    expect(plan.distanceMm).toBeGreaterThan(MIN_FOCUS_MM);
    // And nothing is said to the member about it, because nothing is wrong.
    expect(framingHint(plan)).toBeNull();
  });
});
