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
 * Below this fraction of the frame, the document is too small to read well.
 *
 * ⚠️ 0.45, NOT THE 0.65 FIRST ASKED FOR, AND THE REASON IS GEOMETRY. An A4
 * page is 0.707 wide-over-tall against a 0.75 frame, so a page whose height
 * fills the frame already covers 94% of its AREA. 65% area put the document
 * at roughly 82% of frame height — "almost fills the screen completely", in
 * the operator's words, and close enough to the edge to sit on the measured
 * cliff.
 *
 * There is a genuine tension here and it is worth stating: framing.ts wants
 * the document to span 82% of the short axis to reach 300 dpi on A4, which is
 * about 78% of area — essentially edge to edge. The cliff says a document
 * approaching the frame edge scores 0/15. Both cannot hold, so the target
 * gives way: 200 dpi on an A4 is entirely legible, because its type is many
 * times larger than the serial numbers on a licence card that 300 dpi exists
 * for. 45% area lands near 200 dpi at 4K with margin to spare.
 */
export const TOO_SMALL = 0.45;

/**
 * Above this, it is crowding the frame edge.
 *
 * ⚠️ THE UPPER BOUND IS NOT FUSSINESS — IT IS THE MEASURED CLIFF. Sweeping a
 * document's margin from the frame edge across the fixture set: flush to the
 * edge scores 0/15 usable, one step off scores 11/15. A document filling the
 * frame is a document whose corners are about to leave it, and a corner
 * outside the frame is not a corner the detector can find or the crop can
 * keep.
 */
export const TOO_BIG = 0.7;

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
  | 'tilt-top'
  | 'tilt-bottom'
  | 'tilt-left'
  | 'tilt-right'
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
 * Which way the phone needs to lean, from the edge lengths.
 *
 * The SHORTER edge is the far one — perspective shrinks whatever is further
 * away — so the phone should lean towards it. Returns null when the document
 * is square enough to leave alone.
 */
export function tiltAdvice(
  q: Quad,
): 'tilt-top' | 'tilt-bottom' | 'tilt-left' | 'tilt-right' | null {
  if (squareness(q) <= Math.max(SQUARE_MAX - 90, 90 - SQUARE_MIN)) return null;
  const len = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y);
  const top = len(q[0], q[1]);
  const bottom = len(q[3], q[2]);
  const left = len(q[0], q[3]);
  const right = len(q[1], q[2]);
  // Whichever pair disagrees more is the axis that is off.
  const hGap = Math.abs(top - bottom) / Math.max(top, bottom, 1);
  const vGap = Math.abs(left - right) / Math.max(left, right, 1);
  if (hGap >= vGap) return top < bottom ? 'tilt-top' : 'tilt-bottom';
  return left < right ? 'tilt-left' : 'tilt-right';
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
   * Null whenever no document type was chosen: dpi is pixels divided by KNOWN
   * millimetres, and with shape 'any' there are no known millimetres. A gate
   * on a number we do not have is not a gate, so it passes.
   */
  dpi?: number | null;
  /** The tracked quad, for the squareness check. Omit to skip it. */
  quad?: Quad;
}): Guidance {
  if (input.occupancy === null || !input.locked) return 'point';
  if (input.occupancy < TOO_SMALL) return 'closer';
  if (input.occupancy > TOO_BIG) return 'further';
  // ⚠️ THE REAL QUALITY FLOOR, AND IT OUTRANKS THE BRACKET. Occupancy is a
  // proxy for resolution; dpi IS resolution, measured off this quad on this
  // lens at this distance. Where the two disagree the measurement wins, and
  // "move closer" is the correct instruction because more frame is exactly
  // what more dpi costs. Operator: "we set the quality floor at 200dpi".
  if (input.dpi !== null && input.dpi !== undefined && input.dpi < FLOOR_DPI) {
    return 'closer';
  }
  // ⚠️ SIZE FIRST, THEN SQUARENESS. Asking somebody to level the phone while
  // the document is still half a frame away wastes the instruction — moving
  // closer changes the geometry anyway, and two corrections at once is one
  // too many.
  if (input.quad) {
    const tilt = tiltAdvice(input.quad);
    if (tilt) return tilt;
  }
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
    case 'tilt-top':
      return 'Tilt the top of the phone down';
    case 'tilt-bottom':
      return 'Tilt the bottom of the phone down';
    case 'tilt-left':
      return 'Tilt the left of the phone down';
    case 'tilt-right':
      return 'Tilt the right of the phone down';
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
