// ────────────────────────────────────────────────────────────────────
// WHETHER THE BOX IS ON SCREEN, AND HOW SOLIDLY.
//
// ⚠️ ONE DROPPED INFERENCE MUST NEVER BLINK THE BOX. Detection runs about ten
// times a second and misses are routine — a hand crossing the frame, a moment
// of motion blur, a frame the model simply declines. Hiding on the first miss
// turns a working tracker into a strobe, and a strobing overlay reads as a
// broken detector rather than as a document briefly obscured.
//
// So presence is a state machine with hysteresis in one direction only:
// appearing is immediate (the member has just aimed at their document and
// wants to see that), disappearing waits.
//
// ⚠️ AND RE-ACQUIRING DURING A FADE-OUT MUST NOT TELEPORT. If the box is
// halfway through fading and the document comes back, it fades back in from
// where it is — cancelling the fade, not restarting it. Restarting would flash
// the box to nothing and back, which is the very thing the hysteresis exists
// to prevent.
// ────────────────────────────────────────────────────────────────────

/** How long a fade in takes. */
export const FADE_IN_MS = 150;

/** How long a fade out takes, once it starts. */
export const FADE_OUT_MS = 180;

/**
 * Consecutive misses tolerated before the box starts to leave.
 *
 * At ~10Hz this is three or four dropped inferences — long enough to ride out
 * a hand passing over the page, short enough that pointing the phone at the
 * ceiling clears the box while the member is still moving it.
 */
export const GRACE_MS = 350;

/**
 * How much of its final size the box starts at when it appears.
 *
 * A hair over 1: the box settles INWARD onto the document, which reads as
 * landing on it. Growing outward from smaller reads as the detector still
 * searching.
 */
export const ENTER_SCALE = 1.03;

export type Presence = 'hidden' | 'entering' | 'shown' | 'leaving';

export interface PresenceState {
  phase: Presence;
  /** 0..1. Multiply the overlay's alpha by this. */
  opacity: number;
  /** 1 at rest; ENTER_SCALE..1 while entering. Scale the quad about its centre. */
  scale: number;
}

const HIDDEN: PresenceState = { phase: 'hidden', opacity: 0, scale: 1 };

/**
 * Tracks the box's visibility across frames.
 *
 * Fed every DRAWN frame with whether this frame has a quad, not only when an
 * inference lands — the fades are animations and need the display's clock.
 */
export class QuadPresence {
  private phase: Presence = 'hidden';
  /** Progress through the current fade, 0..1. */
  private t = 0;
  /** Milliseconds since the last frame that had a quad. */
  private missMs = 0;

  reset(): void {
    this.phase = 'hidden';
    this.t = 0;
    this.missMs = 0;
  }

  get state(): PresenceState {
    switch (this.phase) {
      case 'hidden':
        return HIDDEN;
      case 'entering': {
        // Ease-out, so it decelerates onto the document.
        const e = 1 - (1 - this.t) ** 3;
        return {
          phase: 'entering',
          opacity: e,
          scale: ENTER_SCALE + (1 - ENTER_SCALE) * e,
        };
      }
      case 'shown':
        return { phase: 'shown', opacity: 1, scale: 1 };
      case 'leaving':
        return { phase: 'leaving', opacity: 1 - this.t, scale: 1 };
    }
  }

  /**
   * Advance by `dtMs` and return what to draw.
   *
   * `has` is whether THIS frame has a quad worth drawing — the caller's own
   * gate (confidence, lock count) decides that; this only decides how it
   * appears and how long it lingers.
   */
  step(has: boolean, dtMs: number): PresenceState {
    const dt = Math.max(0, Math.min(250, dtMs));

    if (has) {
      this.missMs = 0;
      if (this.phase === 'hidden') {
        this.phase = 'entering';
        this.t = 0;
      } else if (this.phase === 'leaving') {
        // ⚠️ CANCEL THE FADE, DO NOT RESTART THE ENTRANCE. The box is already
        // partly visible; carrying its current opacity forward into an
        // 'entering' phase is what makes a brief loss look like nothing
        // happened at all.
        this.phase = 'entering';
        this.t = 1 - this.t;
      }
      if (this.phase === 'entering') {
        this.t = Math.min(1, this.t + dt / FADE_IN_MS);
        if (this.t >= 1) this.phase = 'shown';
      }
      return this.state;
    }

    this.missMs += dt;
    if (this.phase === 'hidden') return HIDDEN;

    if (this.phase === 'entering' || this.phase === 'shown') {
      if (this.missMs < GRACE_MS) {
        // Still inside the grace window: keep going as if nothing happened.
        if (this.phase === 'entering') {
          this.t = Math.min(1, this.t + dt / FADE_IN_MS);
          if (this.t >= 1) this.phase = 'shown';
        }
        return this.state;
      }
      this.phase = 'leaving';
      this.t = 0;
      return this.state;
    }

    // Leaving.
    this.t = Math.min(1, this.t + dt / FADE_OUT_MS);
    if (this.t >= 1) {
      this.phase = 'hidden';
      this.t = 0;
    }
    return this.state;
  }
}

/** Scale a quad about its own centre, for the entrance. */
export function scaleAboutCentre<T extends { x: number; y: number }>(
  quad: readonly T[],
  k: number,
): { x: number; y: number }[] {
  let cx = 0;
  let cy = 0;
  for (const p of quad) {
    cx += p.x;
    cy += p.y;
  }
  cx /= quad.length;
  cy /= quad.length;
  return quad.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}
