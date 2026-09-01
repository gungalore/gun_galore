import { FLOOR_DPI } from './framing';
import type { Quad } from './geometry';

// ────────────────────────────────────────────────────────────────────
// Telling the member what to do, from the tracked quad alone.
//
// ⚠️ THIS REPLACES THE AIM BOX. The box was an instruction — "put it here" —
// and its real job was to guarantee resolution: fill the rectangle and the
// document is big enough in frame to be legible. That worked, and it made the
// member do the measuring.
//
// Now the detector finds the document itself, so we can measure the thing we
// actually cared about — how much of the frame it occupies — and say the one
// sentence that follows from it. A box that says "put it here" and a quad that
// says "it is there" are contradictory instructions on one screen; only one of
// them can be the truth, and it is the quad.
//
// Operator: "the A4 must occupy at least 65% of the screen and not more than
// 85%. so less than 65% is Move closer and more than 85% is Move further and
// as soon as it's in that bracket we ask hold still."
// ────────────────────────────────────────────────────────────────────

/**
 * Below this fraction of the frame, the detector starts struggling to find it.
 *
 * ⚠️ THIS IS A DETECTION FLOOR, NOT A RESOLUTION ONE — AND CONFUSING THE TWO
 * MADE THE FIREARM LICENCE UNCAPTURABLE. It was 0.45, chosen as a proxy for
 * "big enough to read". Measured against what a document can actually reach in
 * a phone viewfinder:
 *
 *     max achievable occupancy      card    A4 / ID book
 *     Samsung portrait               49%        91%
 *     iPhone portrait                53%        84%
 *     tall portrait viewfinder       30%        68%
 *
 * A card is landscape in a portrait frame, so it wastes the bands above and
 * below it however well it is framed. At 0.45 the card had a four-point
 * window on the Samsung — reachable only by touching both side edges, which
 * is the measured cliff — and on a tall viewfinder it could not reach the
 * bracket AT ALL. Auto-capture was impossible for the single most important
 * document in the product, on a viewport aspect nobody had checked.
 *
 * Occupancy of the frame is not a property of the document. It is a property
 * of the document AND the viewport, so it cannot carry a requirement that
 * belongs to the document alone. Resolution is now MEASURED, in dpi, against
 * known millimetres — so that is where the resolution bound lives, and this
 * one keeps only the job it can actually do: keeping the document big enough
 * for the detector to find.
 *
 * 0.15 sits at the bottom of the 13-23% band the oracle-cropped sweep found
 * the detector preferring, and every shape can reach it on every viewport
 * above.
 */
export const TOO_SMALL = 0.15;

/**
 * How close a corner may come to the frame edge, as a fraction of the short
 * axis.
 *
 * ⚠️ REPLACES AN AREA CAP, BECAUSE THE CLIFF WAS NEVER ABOUT AREA. Sweeping a
 * document's margin from the frame edge across the fifteen fixtures:
 *
 *     document flush to the frame edge   0/15 usable, median IoU 0.209
 *     one step off the edge             11/15 usable, median IoU 0.959
 *     a comfortable margin              13/15 usable, median IoU 0.942
 *
 * Zero to eleven, on one step. But what that measures is a CORNER leaving the
 * frame, and an area cap only approximates it — badly, and differently for
 * every document shape and viewport aspect. A 70% area cap let a portrait A4
 * sit closer to the edge than a landscape card at 45%, which is backwards.
 *
 * Measuring the margin directly says the thing the cliff is about, in one
 * number, for every shape.
 */
export const EDGE_MARGIN = 0.04;

/**
 * How far a corner may sit from square before we say something.
 *
 * ⚠️ A CORNER ANGLE MEASURES TILT, NOT ROTATION. Rolling the phone rotates the
 * quad rigidly and every corner stays at 90 degrees — angles are invariant
 * under rotation. What opens a corner past 93 is the phone not being PARALLEL
 * to the document: one edge sits further away, perspective shrinks it, and the
 * corners at that end close while the near ones open.
 *
 * So the operator's thresholds are the right measure and "rotate the phone"
 * would be the wrong instruction — it changes nothing about the angles. What
 * fixes it is levelling the phone, and the edge lengths say which way.
 */
// Asked for 1 degree, relaxed to 2 after holding a phone over a document by
// hand and finding 1 never settles. A gate nobody can satisfy is a gate that
// gets switched off.
export const SQUARE_MIN = 88;
export const SQUARE_MAX = 92;

/**
 * How long the phone must be still before the shutter may fire.
 *
 * ⚠️ THIS IS WHAT MAKES "HOLD STILL" APPEAR AT ALL. `still` used to be an
 * INSTANTANEOUS reading — motion under the threshold on this one frame — so
 * the moment a member stopped moving, guidance went straight from "Move
 * closer" to ready and the shutter fired. 'steady' was occupied for a single
 * frame, far too briefly to render, let alone read. Operator: "when the
 * conditions are met there is no Hold Still instruction given." The state was
 * never missing; it had no duration.
 *
 * Giving stillness a clock fixes both halves at once. The member gets a
 * readable half-second of "Hold still…" telling them the scan is coming, and
 * the capture lands on a phone that has demonstrably settled rather than one
 * caught at the instant it crossed the motion threshold — which is also when
 * it is most likely to still be drifting.
 */
export const STEADY_MS = 500;

export type Guidance =
  /** Nothing found. */
  | 'point'
  /** Found, too small in frame. */
  | 'closer'
  /** Found, crowding the edges. */
  | 'further'
  /** Found, well sized, but the phone is not parallel to the document. */
  /** Found, well sized, still moving. */
  | 'steady'
  /** Found, well sized, held still. Fire. */
  | 'ready';

/**
 * How much of the frame the quad covers, 0..1.
 *
 * Shoelace over the actual quad rather than its bounding box: a document held
 * at an angle has a bounding box far larger than itself, and measuring that
 * would call a small skewed page "big enough" and stop asking the member to
 * move closer.
 */
export function occupancy(quad: Quad, frameW: number, frameH: number): number {
  if (!(frameW > 0) || !(frameH > 0)) return 0;
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.min(1, Math.abs(a) / 2 / (frameW * frameH));
}

/**
 * The four interior angles of the quad, in degrees, TL TR BR BL.
 *
 * A rectangle photographed square-on gives four 90s. Perspective pulls them
 * apart in opposite pairs, which is what makes the deviation a usable measure
 * of how far off parallel the phone is.
 */
export function cornerAngles(q: Quad): [number, number, number, number] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const c = q[i];
    const a = q[(i + 3) % 4];
    const b = q[(i + 1) % 4];
    const v1 = { x: a.x - c.x, y: a.y - c.y };
    const v2 = { x: b.x - c.x, y: b.y - c.y };
    const n1 = Math.hypot(v1.x, v1.y) || 1;
    const n2 = Math.hypot(v2.x, v2.y) || 1;
    const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)));
    out.push((Math.acos(cos) * 180) / Math.PI);
  }
  return out as [number, number, number, number];
}

/** The worst corner's distance from square, in degrees. */
export function squareness(q: Quad): number {
  return Math.max(...cornerAngles(q).map((a) => Math.abs(a - 90)));
}


/**
 * How close the nearest corner comes to the frame edge, as a fraction of the
 * frame's SHORT axis. 0 means touching.
 *
 * Short axis rather than each corner's own axis, so one number means the same
 * thing on a portrait and a landscape frame — a margin that is generous
 * sideways and none at all vertically is not a margin.
 */
export function edgeMargin(quad: Quad, frameW: number, frameH: number): number {
  if (!(frameW > 0) || !(frameH > 0)) return 0;
  const shortAxis = Math.min(frameW, frameH);
  let worst = Infinity;
  for (const p of quad) {
    worst = Math.min(worst, p.x, p.y, frameW - p.x, frameH - p.y);
  }
  return Math.max(0, worst) / shortAxis;
}

export function guidanceFor(input: {
  /** Null when the detector has nothing. */
  occupancy: number | null;
  /** Has the quad been stable for long enough to trust? */
  locked: boolean;
  /**
   * Has the phone been still for STEADY_MS?
   *
   * ⚠️ A DURATION, NOT AN INSTANT — see STEADY_MS. Passing "motion is low
   * right now" collapses 'steady' to a single frame and the member never sees
   * the instruction.
   */
  still: boolean;
  /**
   * Measured resolution on the document, or null when it cannot be known.
   *
   * ⚠️ EVERY OFFERED SHAPE NOW HAS A SIZE, so in the product this is never
   * null — that is precisely why 'Something else' was removed. The nullable
   * path stays because dpi is also unavailable before the first quad is
   * measured, and because a gate on a number we do not have is not a gate. It
   * must never become an escape hatch: see shapes-mandatory.spec.ts.
   */
  dpi?: number | null;
  /**
   * How close the nearest corner is to the frame edge, from edgeMargin().
   *
   * Omitted only where there is no frame to measure against — the tests that
   * exercise the size and tilt rules alone. In the product it is always
   * passed, because it is the check the frame-edge cliff actually needs.
   */
  edgeMargin?: number;
  /** The tracked quad, for the squareness check. Omit to skip it. */
  quad?: Quad;
}): Guidance {
  if (input.occupancy === null || !input.locked) return 'point';
  // ⚠️ THE EDGE CHECK COMES FIRST, because a corner leaving the frame is the
  // one failure the detector cannot recover from — a corner it cannot see is
  // a corner it invents. Everything below is a matter of degree; this is not.
  if (input.edgeMargin !== undefined && input.edgeMargin < EDGE_MARGIN) {
    return 'further';
  }
  if (input.occupancy < TOO_SMALL) return 'closer';
  // ⚠️ THE REAL QUALITY FLOOR, AND IT OUTRANKS THE BRACKET. Occupancy is a
  // proxy for resolution; dpi IS resolution, measured off this quad on this
  // lens at this distance. Where the two disagree the measurement wins, and
  // "move closer" is the correct instruction because more frame is exactly
  // what more dpi costs. Operator: "we set the quality floor at 200dpi".
  if (input.dpi !== null && input.dpi !== undefined && input.dpi < FLOOR_DPI) {
    return 'closer';
  }
  // ⚠️ THERE IS NO TILT INSTRUCTION ANY MORE, AND ITS REMOVAL IS DELIBERATE.
  // It used to name a specific edge and draw an arrow on it. Two problems, and
  // the operator hit both: it competed with "move closer" for the same moment,
  // so the two alternated frame to frame and neither could be acted on; and
  // levelling a phone is a correction nobody is holding still enough to make
  // while also being told to move. Operator: "lets lose the arrows and tilt
  // text. just keep the move closer and further."
  //
  // Nothing is lost from the CAPTURE. Tilt is still measured — squareness()
  // feeds the diagnostic readout, and the capture ladder still rectifies
  // whatever angle the page was photographed at. What went is the instruction,
  // not the correction.
  return input.still ? 'ready' : 'steady';
}

/**
 * The sentence to show.
 *
 * One instruction, in the member's own terms, always something they can act
 * on. No exclamation marks and no blame — a member holding a phone over a
 * statutory document does not need to be told off.
 */
export function guidanceText(g: Guidance, doc: string): string | null {
  switch (g) {
    case 'point':
      return `Point the camera at your ${doc}`;
    case 'closer':
      return 'Move closer';
    case 'further':
      return 'Move further away';
    case 'steady':
      return 'Hold still…';
    case 'ready':
      // Nothing to say — the shutter is about to fire and a message here would
      // be read after the fact.
      return null;
  }
}

/** Is this the state the shutter may fire in? */
export function mayCapture(g: Guidance): boolean {
  return g === 'ready';
}
