import { describe, expect, it } from 'vitest';
import { FLOOR_DPI, TARGET_DPI } from './framing';
import { GLARE_BAD, LUMA_LOW, TILT_OK, gradeScan } from './quality';

describe('gradeScan', () => {
  it('calls a sharp square scan good, and says why', () => {
    const q = gradeScan({ dpi: 320, tilt: 0.4, glare: 0.001, luma: 150 });
    expect(q.grade).toBe('good');
    expect(q.label).toBe('Good');
    expect(q.reasons).toHaveLength(0);
    expect(q.detail).toContain('320');
  });

  it('⚠️ NEVER CALLS AN UNREADABLE SCAN ANYTHING BUT POOR', () => {
    // The badge exists to be trusted. A green word over a 140 dpi photograph
    // of a licence is worse than no badge — somebody keeps it and finds out
    // when SAPS asks.
    const q = gradeScan({ dpi: FLOOR_DPI - 60, tilt: 0, glare: 0, luma: 150 });
    expect(q.grade).toBe('poor');
    expect(q.detail).toMatch(/readable/i);
  });

  it('⚠️ RESOLUTION IS THE ONLY THING THAT CAN FAIL A SCAN ALONE', () => {
    // Tilt, glare and exposure degrade something still readable. Missing
    // pixels are gone and no later processing brings them back.
    expect(gradeScan({ dpi: 300, tilt: 12 }).grade).toBe('acceptable');
    expect(gradeScan({ dpi: 300, glare: GLARE_BAD * 3 }).grade).toBe('acceptable');
    expect(gradeScan({ dpi: 300, luma: LUMA_LOW - 20 }).grade).toBe('acceptable');
    expect(gradeScan({ dpi: FLOOR_DPI - 1 }).grade).toBe('poor');
  });

  it('⚠️ HAS NO MIDDLE DPI BAND WHILE TARGET AND FLOOR ARE EQUAL', () => {
    // Same collapse as framing's 'relaxed' verdict, and for the same reason:
    // the operator set one bar at 200 dpi, so there is no gap between "hit the
    // target" and "hit the floor" for a scan to land in. Raise TARGET_DPI and
    // the band comes back on its own. Pinned so the absence reads as designed.
    expect(TARGET_DPI).toBe(FLOOR_DPI);
    expect(gradeScan({ dpi: FLOOR_DPI }).grade).toBe('good');
    expect(gradeScan({ dpi: FLOOR_DPI - 1 }).grade).toBe('poor');
  });

  it('takes the worst of several faults, not the average', () => {
    const q = gradeScan({ dpi: 120, tilt: 9, glare: 0.1 });
    expect(q.grade).toBe('poor');
    expect(q.reasons.length).toBeGreaterThan(1);
    // The dpi problem leads, because it is the one that cannot be undone.
    expect(q.detail).toMatch(/dpi/);
  });

  it('mentions a fallback crop without lowering the grade for it', () => {
    // Using the member's own frame is often exactly right. It is worth
    // SAYING, because that is when checking the corners is most worthwhile.
    const q = gradeScan({ dpi: 320, source: 'aim' });
    expect(q.grade).toBe('good');
    expect(q.reasons.join(' ')).toMatch(/your frame/i);
  });

  it('grades without a dpi, for a shape whose size is unknown', () => {
    const q = gradeScan({ dpi: null, tilt: 0.5 });
    expect(q.grade).toBe('good');
    expect(q.detail.length).toBeGreaterThan(0);
  });

  it('holds tilt to the same bound the live guidance uses', () => {
    expect(gradeScan({ dpi: 300, tilt: TILT_OK - 0.1 }).grade).toBe('good');
    expect(gradeScan({ dpi: 300, tilt: TILT_OK + 0.1 }).grade).toBe('acceptable');
  });
});

describe('the badge label', () => {
  it('carries the measured dpi beside the word', () => {
    expect(gradeScan({ dpi: 283 }).dpiLabel).toBe(' — 283 dpi');
  });

  it('⚠️ SAYS NOTHING RATHER THAN ZERO WHEN THE SIZE IS UNKNOWN', () => {
    // "Good — 0 dpi" is worse than "Good": a number invites trust that a
    // placeholder has not earned.
    expect(gradeScan({ dpi: null }).dpiLabel).toBe('');
    expect(gradeScan({ dpi: Number.NaN }).dpiLabel).toBe('');
  });
});

describe('⚠️ a clipped page — the failure the aspect correction conceals', () => {
  // The operator photographed an A4 touching the frame edge. The detector's
  // quad was cut off at 1.087 where A4 is 1.414; the known-aspect forcing then
  // narrowed it to exactly 1.4143 and the file came out perfectly
  // proportioned, confidently graded, and missing part of the page.
  it('fails a clipped scan outright, whatever its resolution', () => {
    const q = gradeScan({ dpi: 400, clipped: true });
    expect(q.grade).toBe('poor');
  });

  it('leads with the clipping, because it is the unfixable part', () => {
    const q = gradeScan({ dpi: 120, clipped: true, tilt: 9 });
    expect(q.detail).toMatch(/ran off|touching the edge/i);
  });

  it('says the shape is wrong when the ratio confirms it', () => {
    const q = gradeScan({
      dpi: 216,
      clipped: true,
      measuredRatio: 1.087,
      expectedRatio: 1.414,
    });
    expect(q.detail).toMatch(/shape is wrong/i);
    expect(q.detail).toMatch(/take it again/i);
  });

  it('is gentler when only the margin is tight', () => {
    const q = gradeScan({
      dpi: 300,
      clipped: true,
      measuredRatio: 1.41,
      expectedRatio: 1.414,
    });
    expect(q.detail).toMatch(/move back a little/i);
    expect(q.detail).not.toMatch(/shape is wrong/i);
  });

  it('says nothing about clipping when the page is inside the frame', () => {
    expect(gradeScan({ dpi: 300, clipped: false }).reasons).toHaveLength(0);
  });
});

describe('⚠️ the exposure bounds are measured on the RAW photograph', () => {
  // ⚠️ THIS DESCRIBE BLOCK USED TO SAY "on an ENHANCED page", AND THAT WAS THE
  // BUG WEARING A TEST AS A DISGUISE. inspect() was being handed enhance()'s
  // output, whose paper is deliberately lifted to WHITE=245, so the bound was
  // raised 215 -> 238 to stop it firing on good captures. It did not even
  // work: enhanced paper measures 242. capture.ts now inspects `flat`, the
  // rectified page before any cleanup, so these bounds mean what they say.
  //
  // Measured across 94 real fixture photographs:
  //     mean luma  p05 66.7   p50 155.0   p95 200.1   max 206.6
  // Nothing in the set comes within 8 points of the bound.
  it('passes every exposure a real photograph actually produces', () => {
    // The top of the measured range, and then some.
    expect(gradeScan({ dpi: 300, luma: 200 }).grade).toBe('good');
    expect(gradeScan({ dpi: 300, luma: 207 }).grade).toBe('good');
  });

  it('catches a genuinely blown page', () => {
    expect(gradeScan({ dpi: 300, luma: 216 }).grade).toBe('acceptable');
    expect(gradeScan({ dpi: 300, luma: 244 }).grade).toBe('acceptable');
  });

  it('still catches a dark one', () => {
    expect(gradeScan({ dpi: 300, luma: 40 }).grade).toBe('acceptable');
  });
});
