import { describe, expect, it } from 'vitest';
import type { Gray } from './detect';
import {
  mapToBuffer,
  motionOf,
  rectQuad,
  regionExposure,
  sampleRegion,
  regionGray,
  coarsen,
} from './frame-stats';
import { autoBlocker, MOTION_STILL } from './autocapture';
import { GLARE_AT } from './exposure';

// ────────────────────────────────────────────────────────────────────
// THE THREE READINGS THAT STOPPED AUTO-CAPTURE ON A PHONE.
//
// Each describe below reproduces one of the faults as it actually occurred,
// asserts the old arithmetic would have failed, and asserts the new one does
// not. They are written against the real thresholds — MOTION_STILL and
// GLARE_AT are imported, never restated — because a test carrying its own copy
// of a threshold passes happily while the shipped gate is shut.
// ────────────────────────────────────────────────────────────────────

function gray(w: number, h: number, fill = 128): Gray {
  return { data: new Uint8Array(w * h).fill(fill), width: w, height: h };
}

describe('⚠️ the aim box maps per axis', () => {
  // The phone case: buffer built when the pane was 320x568 CSS, address bar
  // then collapses and the pane becomes 320x640. Width unchanged, height not.
  const g = gray(320, 568);
  const elBox = { x: 0, y: 0, width: 320, height: 640 };
  const box = { x: 32, y: 320, width: 256, height: 160 };

  it('keeps the box inside the buffer after the pane has resized', () => {
    const r = mapToBuffer(box, elBox, g);
    expect(r.y0).toBeGreaterThanOrEqual(0);
    expect(r.y1).toBeLessThanOrEqual(g.height);
  });

  it('⚠️ THE OLD SINGLE-SCALE MAPPING WALKED OFF THE BOTTOM', () => {
    // k = gray.width / elBox.width = 1.0, applied to y as well. The box
    // bottom is at 480 CSS, which lands at 480 in a buffer 568 tall — inside
    // here, but the ERROR is what matters: it is off by the aspect drift, and
    // it grows with it. Pin the discrepancy so nobody reintroduces one scale.
    const k = g.width / elBox.width;
    const oldY1 = (box.y + box.height) * k;
    const newY1 = mapToBuffer(box, elBox, g).y1;
    expect(oldY1).not.toBeCloseTo(newY1, 1);
    // The correct mapping is proportional: 480/640 of a 568-tall buffer.
    expect(newY1).toBeCloseTo((480 / 640) * 568, 5);
  });

  it('agrees with the single scale when nothing has drifted', () => {
    // Same aspect: the two mappings must be identical, or this "fix" would be
    // changing behaviour on the desktop path that always worked.
    const square = { x: 0, y: 0, width: 320, height: 568 };
    const r = mapToBuffer(box, square, g);
    const k = g.width / square.width;
    expect(r.x0).toBeCloseTo(box.x * k, 6);
    expect(r.y0).toBeCloseTo(box.y * k, 6);
  });

  it('rectQuad hands inkiness four corners clockwise from top-left', () => {
    const q = rectQuad({ x0: 1, y0: 2, x1: 3, y1: 4 });
    expect(q).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 4 },
      { x: 1, y: 4 },
    ]);
  });
});

describe('⚠️ motion ignores a uniform brightness shift', () => {
  const prev = Uint8Array.from({ length: 400 }, (_, i) => 100 + (i % 7));

  it('reads zero when the whole frame brightens by the same amount', () => {
    // An auto-exposure hunt. Every pixel moves +6 together.
    const cur = prev.map((v) => v + 6);
    expect(motionOf(cur, prev)).toBeCloseTo(0, 6);
  });

  it('⚠️ THE OLD PLAIN MEAN WOULD HAVE BLOCKED THE SHUTTER FOR EVER', () => {
    const cur = prev.map((v) => v + 6);
    let plain = 0;
    for (let i = 0; i < prev.length; i++) plain += Math.abs(cur[i] - prev[i]);
    plain /= prev.length;
    expect(plain).toBeGreaterThan(MOTION_STILL);
    expect(autoBlocker(true, { ink: 0.5, motion: plain, glare: 0, luma: 128 })).toBe('steady');
    // And with the shift removed, the same frame pair is allowed to fire.
    expect(
      autoBlocker(true, { ink: 0.5, motion: motionOf(cur, prev), glare: 0, luma: 128 }),
    ).toBeNull();
  });

  it('still sees a hand move', () => {
    // Real movement changes pixels by DIFFERENT amounts — that variation is
    // exactly what survives removing the mean.
    const cur = prev.map((v, i) => (i % 2 ? v + 30 : v - 30));
    expect(motionOf(cur, prev)).toBeGreaterThan(MOTION_STILL);
  });

  it('a shift on top of real movement does not hide the movement', () => {
    const cur = prev.map((v, i) => (i % 2 ? v + 30 : v - 30) + 6);
    expect(motionOf(cur, prev)).toBeGreaterThan(MOTION_STILL);
  });

  it('an identical frame is perfectly still', () => {
    expect(motionOf(prev, prev)).toBe(0);
  });

  it('an empty sample is still, not moving', () => {
    expect(motionOf(new Uint8Array(0), new Uint8Array(0))).toBe(0);
  });
});

describe('⚠️ exposure is judged on the aim box only', () => {
  /** A dark room, a well-lit document in the box, a blown window beside it. */
  function scene(): Gray {
    const g = gray(200, 100, 90);
    for (let y = 20; y < 80; y++)
      for (let x = 20; x < 90; x++) g.data[y * g.width + x] = 200; // document
    for (let y = 0; y < 100; y++)
      for (let x = 150; x < 200; x++) g.data[y * g.width + x] = 255; // window
    return g;
  }
  const box = { x0: 20, y0: 20, x1: 90, y1: 80 };

  it('does not count a window the member is not pointing at', () => {
    const { glare } = regionExposure(scene(), box, 1);
    expect(glare).toBe(0);
    expect(glare).toBeLessThanOrEqual(GLARE_AT);
  });

  it('⚠️ MEASURED WHOLE-FRAME, THE SAME SCENE REFUSED TO CAPTURE', () => {
    const g = scene();
    const whole = regionExposure(g, { x0: 0, y0: 0, x1: g.width, y1: g.height }, 1);
    expect(whole.glare).toBeGreaterThan(GLARE_AT);
    expect(
      autoBlocker(true, { ink: 0.5, motion: 0, glare: whole.glare, luma: whole.luma }),
    ).toBe('light');
    const inBox = regionExposure(g, box, 1);
    expect(
      autoBlocker(true, { ink: 0.5, motion: 0, glare: inBox.glare, luma: inBox.luma }),
    ).toBeNull();
  });

  it('still catches a reflection ON the document', () => {
    // The glare that actually matters is inside the box, and is unaffected.
    const g = scene();
    for (let y = 30; y < 50; y++)
      for (let x = 30; x < 60; x++) g.data[y * g.width + x] = 255;
    expect(regionExposure(g, box, 1).glare).toBeGreaterThan(GLARE_AT);
  });

  it('clamps a region that hangs off the buffer', () => {
    const g = gray(50, 50, 200);
    const r = regionExposure(g, { x0: -20, y0: -20, x1: 999, y1: 999 }, 1);
    expect(r.luma).toBe(200);
    expect(r.glare).toBe(0);
  });

  it('⚠️ AN EMPTY REGION READS MID-GREY, NOT BLACK', () => {
    // Returning 0 would sit below DARK_AT and block on 'light' — trading one
    // permanent phone-only stall for another. 'empty' is ink's job.
    const g = gray(50, 50, 200);
    const r = regionExposure(g, { x0: 100, y0: 100, x1: 120, y1: 120 }, 1);
    expect(r.luma).toBe(128);
    expect(autoBlocker(true, { ink: 0.5, motion: 0, glare: r.glare, luma: r.luma })).toBeNull();
  });
});

describe('⚠️ movement is read inside the box, not across the room', () => {
  /** A still document in the box, with a busy background churning outside it. */
  function scene(bg: number): Gray {
    const g = gray(100, 100, 30);
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) {
        const inBox = x >= 30 && x < 70 && y >= 30 && y < 70;
        // The document is identical in both frames; the carpet is not.
        g.data[y * g.width + x] = inBox ? 200 : (x * 7 + y * 13 + bg) % 256;
      }
    return g;
  }
  const box = { x0: 30, y0: 30, x1: 70, y1: 70 };

  it('reads still when only the background changed', () => {
    const a = sampleRegion(scene(0), box, 1);
    const b = sampleRegion(scene(120), box, 1);
    expect(motionOf(a, b)).toBe(0);
    expect(
      autoBlocker(true, { ink: 0.5, motion: motionOf(a, b), glare: 0, luma: 128 }),
    ).toBeNull();
  });

  it('⚠️ WHOLE-FRAME, THE SAME PAIR LOOKS VIOLENTLY IN MOTION', () => {
    // This is the shape of the operator's 22.31: a stationary document, a
    // textured surround, and a reading taken over both.
    const whole = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const a = sampleRegion(scene(0), whole, 1);
    const b = sampleRegion(scene(120), whole, 1);
    const m = motionOf(a, b);
    expect(m).toBeGreaterThan(MOTION_STILL);
    expect(autoBlocker(true, { ink: 0.5, motion: m, glare: 0, luma: 128 })).toBe('steady');
  });

  it('still sees the document itself move', () => {
    // Scoping must not make it blind — a document that shifts inside the box
    // has to register.
    const a = sampleRegion(scene(0), box, 1);
    const moved = scene(0);
    for (let y = 30; y < 50; y++)
      for (let x = 30; x < 70; x++) moved.data[y * moved.width + x] = 60;
    expect(motionOf(a, sampleRegion(moved, box, 1))).toBeGreaterThan(MOTION_STILL);
  });

  it('samples a stable count so consecutive frames can be compared', () => {
    const g = gray(100, 100);
    expect(sampleRegion(g, box, 2).length).toBe(sampleRegion(g, box, 2).length);
    expect(sampleRegion(g, box, 2).length).toBe(20 * 20);
  });

  it('clamps a box hanging off the buffer instead of reading rubbish', () => {
    const g = gray(50, 50, 77);
    const s = sampleRegion(g, { x0: -10, y0: -10, x1: 999, y1: 999 }, 1);
    expect(s.length).toBe(2500);
    expect([...new Set(s)]).toEqual([77]);
  });
});

describe('⚠️ motion survives a contrast change, not just a brightness one', () => {
  const prev = Uint8Array.from({ length: 900 }, (_, i) => 60 + ((i * 37) % 140));

  it('reads ~zero when the tone curve stretches', () => {
    // iOS retunes its tone curve continuously. Dark and bright pixels then
    // move by DIFFERENT amounts, so subtracting the mean delta — which is all
    // the previous version did — leaves most of it behind.
    const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
    const cur = prev.map((v) => Math.round((v - mean) * 1.25 + mean + 8));
    expect(motionOf(cur, prev)).toBeLessThan(MOTION_STILL);
  });

  it('⚠️ OFFSET-ONLY REMOVAL WOULD HAVE CALLED THAT MOVEMENT', () => {
    const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
    const cur = prev.map((v) => Math.round((v - mean) * 1.25 + mean + 8));
    let sum = 0;
    for (let i = 0; i < prev.length; i++) sum += cur[i] - prev[i];
    const shift = sum / prev.length;
    let offsetOnly = 0;
    for (let i = 0; i < prev.length; i++)
      offsetOnly += Math.abs(cur[i] - prev[i] - shift);
    offsetOnly /= prev.length;
    expect(offsetOnly).toBeGreaterThan(MOTION_STILL);
  });

  it('still sees the scene actually change', () => {
    const cur = Uint8Array.from({ length: 900 }, (_, i) => (i % 3 ? 20 : 230));
    expect(motionOf(cur, prev)).toBeGreaterThan(MOTION_STILL);
  });

  it('does not divide by a flat frame', () => {
    const flat = new Uint8Array(100).fill(120);
    expect(Number.isFinite(motionOf(flat, flat))).toBe(true);
    expect(motionOf(flat, new Uint8Array(100).fill(130))).toBeLessThan(MOTION_STILL);
  });
});

describe('⚠️ coarsening averages the fine detail away', () => {
  /** Printed text / carpet weave: high-frequency, alternating pixels. */
  function textured(w: number, h: number, phase: number): Gray {
    const d = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) d[y * w + x] = (x + y + phase) % 2 ? 235 : 25;
    return { data: d, width: w, height: h };
  }

  it('a one-pixel phase shift of fine texture stops reading as movement', () => {
    // This is the aliasing signature: sub-pixel sampling drift on dense
    // texture flipping every sampled pixel between light and dark.
    const a = textured(64, 64, 0);
    const b = textured(64, 64, 1);
    expect(motionOf(a.data, b.data)).toBeGreaterThan(MOTION_STILL); // before
    expect(
      motionOf(coarsen(a, 8).data, coarsen(b, 8).data),
    ).toBeLessThan(MOTION_STILL); // after
  });

  it('halves down to about the target and no further', () => {
    const c = coarsen({ data: new Uint8Array(320 * 371), width: 320, height: 371 }, 40);
    expect(c.width).toBeLessThanOrEqual(40);
    expect(c.width).toBeGreaterThan(20);
  });

  /** A big pale block on a dark ground — coarse structure, like a page. */
  function block(w: number, h: number, atX: number): Gray {
    const d = new Uint8Array(w * h).fill(30);
    for (let y = h >> 2; y < h - (h >> 2); y++)
      for (let x = atX; x < Math.min(w, atX + (w >> 1)); x++) d[y * w + x] = 220;
    return { data: d, width: w, height: h };
  }

  it('⚠️ STILL SEES THE DOCUMENT ITSELF MOVE', () => {
    // Coarsening must not make it blind. Structure at a scale that survives
    // averaging — a page sliding across the box — must still register.
    const a = coarsen(block(64, 64, 8), 8);
    const b = coarsen(block(64, 64, 24), 8);
    expect(motionOf(a.data, b.data)).toBeGreaterThan(MOTION_STILL);
  });

  it('⚠️ AND IS DELIBERATELY BLIND TO THE SCENE MERELY DIMMING', () => {
    // A flat frame going darker is an exposure change, not movement — the
    // affine match is supposed to cancel it, and a test that expected
    // otherwise was asserting the wrong thing.
    const lit: Gray = { data: new Uint8Array(64 * 64).fill(200), width: 64, height: 64 };
    const dim: Gray = { data: new Uint8Array(64 * 64).fill(40), width: 64, height: 64 };
    expect(motionOf(coarsen(lit, 8).data, coarsen(dim, 8).data)).toBeLessThan(
      MOTION_STILL,
    );
  });

  it('regionGray lifts exactly the rect', () => {
    const g = gray(10, 10, 5);
    g.data[3 * 10 + 3] = 99;
    const r = regionGray(g, { x0: 3, y0: 3, x1: 6, y1: 6 });
    expect(r.width).toBe(3);
    expect(r.height).toBe(3);
    expect(r.data[0]).toBe(99);
  });
});
