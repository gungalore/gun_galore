import type { Quad } from './geometry';

// ────────────────────────────────────────────────────────────────────
// Making the tracked quad move like Scanbot's.
//
// ⚠️ THE PROBLEM WAS NEVER THE DETECTOR. Ours returns a good quad at 0.95+
// confidence roughly ten times a second, and we drew exactly that quad until
// the next one arrived — so the box made ten discrete jumps per second while
// the screen refreshed sixty times. Every jump is a step change of a few
// pixels in four places at once, and the eye reads a rectangle that twitches
// as broken even when every individual position is correct.
//
// Two separate things fix it, and they are often confused:
//
//   1. JITTER. Consecutive detections of a stationary document disagree by a
//      pixel or two — the model is not deterministic across noisy frames.
//      Fixed by low-pass filtering the corner positions.
//   2. STUTTER. Detections arrive at 10Hz and the display runs at 60Hz, so
//      five frames in six show a stale quad. Fixed by advancing toward the
//      latest detection every DRAWN frame rather than only when one arrives.
//
// A plain exponential average addresses (1) and makes (2) worse: enough
// smoothing to kill jitter at rest is enough lag to visibly trail a moving
// document. That trade is what the One Euro filter exists to escape — it
// raises its own cutoff with the observed speed, so it is heavily smoothed
// when the phone is still and barely smoothed when it is moving.
//
// Reference: Casiez, Roussel & Vogel, "1€ Filter: A Simple Speed-based
// Low-pass Filter for Noisy Input in Interactive Systems", CHI 2012.
// ────────────────────────────────────────────────────────────────────

/**
 * Smoothing at rest, in Hz. Lower is steadier and laggier.
 *
 * 1.2 was chosen against the measured detection rate: at ~10Hz input a 1.2Hz
 * cutoff removes the pixel-scale disagreement between consecutive detections
 * without visibly softening a deliberate move.
 */
export const MIN_CUTOFF = 1.2;

/**
 * How hard speed raises the cutoff.
 *
 * ⚠️ THE WHOLE POINT OF THE FILTER IS THIS TERM. At beta 0 it degrades to a
 * fixed low-pass and the box lags behind a moving document, which reads worse
 * than jitter because it looks like the detector has lost the page.
 */
export const BETA = 0.02;

/** Cutoff for the speed estimate itself. Standard value from the paper. */
export const D_CUTOFF = 1.0;

/**
 * How far a corner may move between detections before we stop easing and jump.
 *
 * ⚠️ WITHOUT THIS, RE-ACQUIRING LOOKS LIKE A BUG. When the member moves to a
 * new document — or the detector drops the page and finds it again somewhere
 * else — smoothing turns an instantaneous change into the box gliding across
 * the screen over half a second, passing over things that are not documents
 * on the way. A jump is honest; a glide is a lie about what was detected.
 *
 * As a fraction of the frame's short axis, so it means the same thing on
 * every device.
 */
export const SNAP_DISTANCE = 0.18;

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * One scalar channel of the filter.
 *
 * ⚠️ THE CUTOFF IS SUPPLIED, NOT COMPUTED HERE. Each channel used to derive
 * its own speed and therefore its own cutoff, which let the four corners move
 * at four different rates — the quad stopped being rigid and started to swim,
 * one corner easing while its neighbour snapped. A rectangle that deforms
 * while it tracks reads as a worse bug than the jitter the filter removes.
 */
class Channel {
  private x: number | null = null;

  reset(): void {
    this.x = null;
  }

  set(value: number): void {
    this.x = value;
  }

  get value(): number | null {
    return this.x;
  }

  /** Speed of this channel, for the shared estimate. Null before the first. */
  speed(value: number, dt: number): number | null {
    return this.x === null ? null : Math.abs(value - this.x) / dt;
  }

  filter(value: number, a: number): number {
    if (this.x === null) {
      this.x = value;
      return value;
    }
    this.x = this.x + a * (value - this.x);
    return this.x;
  }
}

/**
 * Smooths a tracked quad for display.
 *
 * ⚠️ FOR DISPLAY ONLY. The quad that CROPS a statutory document must be the
 * one the detector actually returned, not a filtered approximation of it —
 * smoothing exists so the preview does not twitch, and a crop is not a
 * preview. Anything deciding or committing reads the raw quad.
 */
export class QuadSmoother {
  private channels = Array.from({ length: 8 }, () => new Channel());
  private last: Quad | null = null;
  /** The quad's shared, low-passed speed. One number, not eight. */
  private dx = 0;

  reset(): void {
    for (const c of this.channels) c.reset();
    this.last = null;
    this.dx = 0;
  }

  /** What is currently being shown, or null before the first quad. */
  get current(): Quad | null {
    return this.last;
  }

  /**
   * Advance toward `target` by `dt` seconds and return what to draw.
   *
   * Call this EVERY DRAWN FRAME with the most recent detection, not only when
   * a new detection arrives — that is what turns 10Hz of input into 60Hz of
   * motion. Feeding the same target repeatedly is correct and expected: the
   * filter keeps converging on it.
   */
  push(target: Quad, dt: number, shortAxis: number): Quad {
    // Guard the clock. A backgrounded tab returns with a dt of several
    // seconds, and alpha() at that dt is ~1 — which would snap anyway, but
    // through a divide that is better not to trust.
    const step = Math.min(0.1, Math.max(1 / 240, dt));

    if (this.last && shortAxis > 0) {
      let worst = 0;
      for (let i = 0; i < 4; i++) {
        worst = Math.max(
          worst,
          Math.hypot(target[i].x - this.last[i].x, target[i].y - this.last[i].y),
        );
      }
      if (worst / shortAxis > SNAP_DISTANCE) {
        for (let i = 0; i < 4; i++) {
          this.channels[i * 2].set(target[i].x);
          this.channels[i * 2 + 1].set(target[i].y);
        }
        this.last = target.map((p) => ({ x: p.x, y: p.y })) as Quad;
        return this.last;
      }
    }

    // ⚠️ ONE SPEED FOR THE WHOLE QUAD, AND THEREFORE ONE CUTOFF. This is what
    // keeps the rectangle rigid. Per-channel speed let a corner over a
    // high-contrast edge track tightly while its neighbour over a soft edge
    // lagged, and the quad visibly sheared between them.
    //
    // The MEAN rather than the max: a single noisy corner should not unlock
    // the damping for the other three, which is precisely how one bad corner
    // used to make the whole box twitch.
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 4; i++) {
      for (const [c, v] of [
        [this.channels[i * 2], target[i].x],
        [this.channels[i * 2 + 1], target[i].y],
      ] as const) {
        const sp = c.speed(v, step);
        if (sp !== null) {
          sum += sp;
          n++;
        }
      }
    }
    const speed = n ? sum / n : 0;
    this.dx = this.dx + alpha(D_CUTOFF, step) * (speed - this.dx);
    const a = alpha(MIN_CUTOFF + BETA * this.dx, step);

    const out = target.map((p, i) => ({
      x: this.channels[i * 2].filter(p.x, a),
      y: this.channels[i * 2 + 1].filter(p.y, a),
    })) as Quad;
    this.last = out;
    return out;
  }
}
