import type { Quad } from './geometry';
import { quadDrift } from './geometry';

// ────────────────────────────────────────────────────────────────────
// WHICH RECTANGLE ARE WE TRACKING.
//
// ⚠️ THIS EXISTS BECAUSE THE OVERLAY BLINKED, AND THE BLINK WAS NOT IN THE
// FILTER. It was here. The tracking step used to read:
//
//     if (agrees with current) { ema toward it; lock++ }
//     else                     { quad = detection; lock = 1 }
//
// and the overlay is drawn only while `lock >= 2`. So every time a detection
// disagreed with the one before it — a table edge, a second sheet, a hand, or
// simply the document moving quickly — the quad TELEPORTED and the markers
// VANISHED until the next inference confirmed them. At the live cadence that
// is 67ms of nothing, repeatedly, and it reads as a fault.
//
// ⚠️ BUT THE DISAGREEMENT CHECK ITSELF IS LOAD-BEARING AND MUST NOT GO. It was
// added for a real fault: when successive frames found two DIFFERENT
// rectangles — the card, then the table edge, then the card again — counting
// both towards one lock dragged the markers back and forth between them. That
// flip-flop WAS the jitter. Deleting the check brings it straight back.
//
// So the check stays and only its CONSEQUENCE changes. A disagreeing detection
// no longer becomes the truth on sight; it becomes a CANDIDATE, and has to
// show up again before it is believed. Two rectangles alternating never
// promote either one, because each alternation resets the candidate. A
// document that genuinely moved produces detections that agree with EACH
// OTHER, so it promotes in two frames and the filter glides there.
//
// Nothing here teleports and nothing here drops the lock. Committing a new
// rectangle sets a TARGET; the smoother decides how fast to travel.
// ────────────────────────────────────────────────────────────────────

/**
 * How far two detections may differ and still be called the same rectangle,
 * as a fraction of frame width.
 *
 * Unchanged from the value this logic was built around — the point of this
 * module is what happens on disagreement, not where the line sits.
 */
export const SAME_RECT = 0.08;

/**
 * Consecutive agreeing sightings before a new rectangle replaces the tracked one.
 *
 * ⚠️ TWO, AND THE LOWER BOUND IS THE FLIP-FLOP. One would promote on sight,
 * which is the teleport this module exists to remove. Three costs 200ms at the
 * live cadence before a document that has genuinely moved is followed, which
 * is visible as the overlay sticking to where the page WAS. Two is the
 * smallest number that cannot be reached by A-B-A-B alternation.
 */
export const CONFIRM_FRAMES = 2;

/** Highest the lock counts. Drawing starts at 2, corner markers at 3. */
export const LOCK_MAX = 3;

export interface TrackState {
  /** What to aim the smoother at, or null when nothing is being tracked. */
  quad: Quad | null;
  /** 0 = nothing, 2 = draw the outline, 3 = draw the corner markers. */
  lock: number;
}

export class QuadTracker {
  private quad: Quad | null = null;
  private lock = 0;
  private candidate: Quad | null = null;
  private seen = 0;

  get state(): TrackState {
    return { quad: this.quad, lock: this.lock };
  }

  reset(): void {
    this.quad = null;
    this.lock = 0;
    this.candidate = null;
    this.seen = 0;
  }

  /**
   * Take one detection — or `null` for a frame that found nothing.
   *
   * `frameWidth` is the width the quad's coordinates are expressed in, which
   * is what SAME_RECT is a fraction of.
   */
  push(detected: Quad | null, frameWidth: number): TrackState {
    const near = frameWidth * SAME_RECT;

    if (!detected) {
      // ⚠️ NEVER BLINK OFF. A single frame where a hand shadowed an edge must
      // not flash the markers away — it reads as a fault. Decay instead, and
      // only give up once the lock is spent.
      this.lock = Math.max(0, this.lock - 1);
      if (this.lock === 0) {
        this.quad = null;
        this.candidate = null;
        this.seen = 0;
      }
      return this.state;
    }

    // Nothing tracked yet: take it, but do not claim a lock we have not earned.
    if (!this.quad) {
      this.quad = detected;
      this.lock = 1;
      this.candidate = null;
      this.seen = 0;
      return this.state;
    }

    if (quadDrift(this.quad, detected) <= near) {
      // ⚠️ THE DETECTION IS THE TARGET, NOT A BLEND OF IT. There used to be an
      // EMA here (alpha 0.35) at the INFERENCE cadence, in front of the One
      // Euro filter that runs at the RENDER cadence. Two filters in series,
      // and the fixed-alpha one set a lag floor the speed-adaptive one could
      // never tune below — so raising the smoother's damping moved the feel
      // far less than its numbers said it should. One filter owns the
      // dynamics now, and it is the one that can see the render clock.
      this.quad = detected;
      this.lock = Math.min(LOCK_MAX, this.lock + 1);
      this.candidate = null;
      this.seen = 0;
      return this.state;
    }

    // A different rectangle. Make it prove itself; keep drawing the old one.
    if (this.candidate && quadDrift(this.candidate, detected) <= near) {
      this.seen += 1;
      this.candidate = detected;
      if (this.seen >= CONFIRM_FRAMES) {
        this.quad = detected;
        this.candidate = null;
        this.seen = 0;
        // ⚠️ THE LOCK SURVIVES THE SWITCH. Dropping it here is precisely the
        // blink: the member is still looking at a tracked document, and the
        // only thing that changed is which rectangle we believe it is.
      }
    } else {
      this.candidate = detected;
      this.seen = 1;
    }
    return this.state;
  }
}
