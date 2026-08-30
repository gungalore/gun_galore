import { Rect, rectIoU } from './geometry';
import {
  DocShape,
  FULL_FRAME_DISTANCE_RATIO,
  SHAPE_ORDER,
  acrossMm,
  guideAspect,
} from './shapes';

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
// FILL is the CEILING on the fraction of the viewfinder's shorter axis the
// box may take. A page reaches it; a card no longer does, because the same
// fill is a fixed ANGLE rather than a fixed distance and a small document at
// a large angle means a phone held closer than it can focus. See
// NEAR_LIMIT_MM below, which is what actually sizes the small shapes now.
// ────────────────────────────────────────────────────────────────────

const FILL = 0.82;

/**
 * The closest we will ask anybody to hold the phone, in mm.
 *
 * ⚠️ A BOX THE CAMERA CANNOT FOCUS ON IS A BOX NOBODY CAN FILL. Operator, on
 * a Samsung S23: "i am holding the samsung to close for it to focus when the
 * card fits in the box." His iPhone was fine with the same box, because field
 * of view differs between phones and a fixed fill is a fixed ANGLE, not a
 * fixed distance.
 *
 * At FILL, using the measured ratio below, a card sits 19cm from the lens and
 * an A4 page sits 47cm. So the card box was asking somebody to get two and a
 * half times closer than the page box does, and on one of two phones that was
 * past what its camera would focus at.
 *
 * 300mm is chosen to clear the near limit of any phone with room to spare —
 * holdHint's own note puts the floor at "roughly 100mm" and that is a best
 * case, not a typical one.
 *
 * ⚠️ AND IT COSTS ALMOST NOTHING TO GIVE UP. On the operator's measured
 * 2160-wide track a card fills 1771px at 0.82 and 1145px at the capped fill —
 * 526 DPI against 340. Both are far past what reading a licence number needs,
 * and 300 DPI is the print standard. Detail was never the binding constraint
 * here; focus was.
 */
export const NEAR_LIMIT_MM = 300;

export type { Rect };

/**
 * The largest fraction of the frame this document may be asked to fill without
 * pulling the phone inside NEAR_LIMIT_MM.
 *
 * Falls back to FILL for a shape whose size we do not know — there is nothing
 * to compute a distance from, and 'any' is already the tallest box we draw.
 */
function fillFor(shape: DocShape): number {
  const across = acrossMm(shape);
  if (across === null) return FILL;
  return Math.min(FILL, (across * FULL_FRAME_DISTANCE_RATIO) / NEAR_LIMIT_MM);
}

/**
 * Where the aim box goes inside a viewfinder.
 *
 * @param shape what the member said they are photographing
 * @param view  the viewfinder, in CSS pixels
 */
export function aimBox(shape: DocShape, view: { width: number; height: number }): Rect {
  const aspect = guideAspect(shape);
  const fill = fillFor(shape);
  const maxW = view.width * fill;
  const maxH = view.height * fill;

  // ⚠️ AN UNKNOWN SHAPE GETS THE TALLEST KNOWN ONE, NOT A ROUND NUMBER.
  //
  // This was `min(maxH, maxW * 1.25)` — a box of ratio 0.8 chosen for nothing
  // in particular. An A4 page is 0.707, so fitting a page to that box's WIDTH
  // needs more height than the box has, and the capture crops exactly the box:
  // the operator photographed an A4 certificate on a Samsung S23 and got it
  // back with the top and bottom edges cut off. `FIREARM_SOURCE_PROOF` is
  // where this bites, because it is described to the member as "a licence
  // card, a dealer invoice, an advert" and matches nothing in shapeForKind, so
  // it lands on 'any'.
  //
  // The asymmetry decides it. A TALL box CONTAINS a card — the card just does
  // not fill it, which costs a little resolution and nothing else. A SHORT box
  // CUTS a page, and what it cuts is gone: the crop is the file we keep. So
  // when we do not know the shape, take the one that cuts nothing, which is
  // the tallest we support.
  //
  // Still bounded by maxH on the same contain rule as everything else, so a
  // very tall viewfinder does not produce a sliver.
  if (aspect === null) {
    const tallest = Math.min(
      ...([...SHAPE_ORDER]
        .map(guideAspect)
        .filter((a): a is number => a !== null)),
    );
    let w = maxW;
    let h = w / tallest;
    if (h > maxH) {
      h = maxH;
      w = h * tallest;
    }
    return centred(w, h, view);
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
