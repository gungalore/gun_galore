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

/** Below this fraction of the frame, the document is too small to read well. */
export const TOO_SMALL = 0.65;

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
export const TOO_BIG = 0.85;

export type Guidance =
  /** Nothing found. */
  | 'point'
  /** Found, too small in frame. */
  | 'closer'
  /** Found, crowding the edges. */
  | 'further'
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

export function guidanceFor(input: {
  /** Null when the detector has nothing. */
  occupancy: number | null;
  /** Has the quad been stable for long enough to trust? */
  locked: boolean;
  /** Is the phone still? */
  still: boolean;
}): Guidance {
  if (input.occupancy === null || !input.locked) return 'point';
  if (input.occupancy < TOO_SMALL) return 'closer';
  if (input.occupancy > TOO_BIG) return 'further';
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
