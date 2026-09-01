import { type Quad, isConvex, minInteriorAngle } from './geometry';

// ────────────────────────────────────────────────────────────────────
// IS THIS THE SHAPE OF A PHOTOGRAPHED RECTANGLE?
//
// ⚠️ THE MODEL'S QUAD WAS NEVER CHECKED, AND THE CLASSICAL DETECTOR'S ALWAYS
// WAS. detect.ts rejects its own output on isConvex and minInteriorAngle in
// three separate places. The model path had no equivalent: four corners came
// out of four INDEPENDENT heatmap planes — one argmax each, with nothing tying
// them to one another — and went straight to the tracker, the overlay, and the
// guidance.
//
// Four independent argmaxes cannot be constrained to form a rectangle, so they
// sometimes do not. Measured by running DocQuadNet256 over 30 real fixture
// photographs, framed as the phone frames them: 3 of 30 quads were invalid.
// Two had a corner tens of degrees past square (32.3° and 45.5°), one had a
// corner off the frame entirely. About one in ten.
//
// ⚠️ AND CONFIDENCE DOES NOT CATCH IT, WHICH IS THE WHOLE REASON THIS IS A
// SEPARATE CHECK. The 45.5° case carried minConfidence 0.546 — four corners
// each individually plausible, mutually impossible. Confidence is measured per
// corner; nothing in it can see the shape they make together.
//
// A bad quad is not merely drawn badly. occupancy() takes its shoelace area,
// which a crossed quad under-reports; dpi comes off an edge that may run off
// screen; and the tracker counts it toward the lock like any other sighting.
// That is the guidance flipping between MOVE CLOSER and MOVE FURTHER on
// neighbouring frames, and the overlay "losing the page" while apparently
// tracking something.
// ────────────────────────────────────────────────────────────────────

/**
 * How far past square a corner may open before the quad is not a rectangle.
 *
 * ⚠️ MATCHES detect.ts's OWN GATE, DELIBERATELY. The classical detector
 * refuses below 50°, and two detectors disagreeing about what a document
 * looks like is how a scanner ends up with two personalities. A rectangle
 * photographed at a punishing angle still holds well above this; the measured
 * failures sat at 32° and 45°, which is not perspective, it is a bad decode.
 */
export const MIN_ANGLE = 50;

/**
 * How far outside the frame a corner may sit, as a fraction of frame width.
 *
 * ⚠️ NOT ZERO, AND THAT IS NOT SLOPPINESS. A document held right up to the
 * edge genuinely has corners within a pixel or two of it, and letterbox
 * rounding can put one just past. What this rejects is the failure actually
 * seen in a recording — a corner well off the side of the screen, drawn as a
 * line running out of the viewfinder. toSourceSpace() does no clamping, so a
 * corner decoded near the padding maps to a negative coordinate with nothing
 * in the way.
 */
export const OUT_OF_FRAME = 0.04;

export type Implausible = 'not-convex' | 'thin-corner' | 'off-frame' | 'degenerate';

/**
 * Why this quad cannot be a photograph of a rectangle, or null if it can be.
 *
 * Returning a REASON rather than a boolean because the diagnostic report shows
 * it: "the detector is running and finding nothing" and "the detector is
 * finding things and we are throwing them away" are different faults, and
 * without the reason they look identical from the outside.
 */
export function implausibleWhy(
  q: Quad | null | undefined,
  frameW: number,
  frameH: number,
): Implausible | null {
  if (!q || q.length !== 4) return 'degenerate';
  for (const p of q) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'degenerate';
  }
  // A quad with two corners in the same place has no shape to judge.
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1) return 'degenerate';
  }
  if (frameW > 0 && frameH > 0) {
    const padX = frameW * OUT_OF_FRAME;
    const padY = frameW * OUT_OF_FRAME;
    for (const p of q) {
      if (p.x < -padX || p.x > frameW + padX) return 'off-frame';
      if (p.y < -padY || p.y > frameH + padY) return 'off-frame';
    }
  }
  if (!isConvex(q)) return 'not-convex';
  if (minInteriorAngle(q) < MIN_ANGLE) return 'thin-corner';
  return null;
}
