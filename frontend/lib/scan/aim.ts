import { Rect, rectIoU } from './geometry';
import { DocShape, guideAspect } from './shapes';

// ────────────────────────────────────────────────────────────────────
// THE BOX THE MEMBER AIMS INTO.
//
// One rectangle, used for three things that must never disagree: what is
// drawn on the viewfinder, what the detector is nudged towards, and what the
// "hold it still" logic considers close enough.
//
// ⚠️ IT IS SIZED BY WHAT A PHONE CAN ACTUALLY DO. Across the eighteen
// photographs the operator took of a real licence card and a real ID book,
// the document occupied between 20% and 58% of the frame's AREA — never
// more. A box drawn at 90% of the screen would be a box nobody can fill:
// they would keep moving closer, run past the lens's near focus, and end up
// with a blurred photograph and the feeling that the scanner is broken.
//
// FILL is the fraction of the viewfinder's shorter axis the box may take.
// At 0.82 a card comes out around 24% of the frame's area and an A4 page
// around 53% — both inside the range the operator's own hands produced.
// ────────────────────────────────────────────────────────────────────

const FILL = 0.82;

export type { Rect };

/**
 * Where the aim box goes inside a viewfinder.
 *
 * @param shape what the member said they are photographing
 * @param view  the viewfinder, in CSS pixels
 */
export function aimBox(shape: DocShape, view: { width: number; height: number }): Rect {
  const aspect = guideAspect(shape);
  const maxW = view.width * FILL;
  const maxH = view.height * FILL;

  // No fixed size: a loose box, still smaller than the frame so there is
  // somewhere for the document's edges to sit. A box at the frame's own edge
  // would be asking for a photograph with no border, and the detector needs
  // a border to find an edge against.
  if (aspect === null) {
    return centred(maxW, Math.min(maxH, maxW * 1.25), view);
  }

  // Fit the aspect inside both limits. Whichever runs out first wins — the
  // same rule as object-fit: contain, and for the same reason.
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return centred(w, h, view);
}

function centred(w: number, h: number, view: { width: number; height: number }): Rect {
  return { x: (view.width - w) / 2, y: (view.height - h) / 2, width: w, height: h };
}

/**
 * How much a quad's bounds and the aim box agree, 0 to 1.
 *
 * The arithmetic lives in geometry.ts as `rectIoU` so the DETECTOR can use
 * the same number — it is both what turns the corners green and what nudges
 * the detector towards the right rectangle, and those two must not be
 * computed two different ways.
 */
export function aimAgreement(quadBounds: Rect, box: Rect): number {
  return rectIoU(quadBounds, box);
}
