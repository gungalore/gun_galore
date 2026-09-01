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
 * The cutoff at rest, in Hz. LOWER IS MORE DAMPED.
 *
 * ⚠️ 0.25, DOWN FROM 1.2, AND THE DIRECTION IS THE EASY THING TO GET WRONG.
 * A higher cutoff passes more of the signal, so raising it makes the overlay
 * MORE twitchy, not less. Damping at rest means lowering this.
 *
 * Chosen by sweeping smooth-bench.spec.ts, not by looking at a phone — which
 * is how the previous value survived three rounds of "still twitchy". The
 * bench feeds a synthetic detection stream at the real 15Hz inference cadence
 * into a 60Hz render loop and measures the drawn polygon's per-frame step.
 * Against the operator's frame analysis of Scanbot's own Web SDK demo:
 *
 *   minCut  beta | rest med | noisy rest | slow-pan p95 | pan lag
 *      1.2  0.02 |     0.36 |       1.18 |         6.83 |  31.5px   <- was
 *      1.2 0.002 |     0.24 |       0.72 |         4.72 |  23.2px
 *     0.25  0.02 |     0.28 |       1.11 |         6.58 |  31.1px
 *     0.25 0.002 |     0.09 |       0.37 |         4.40 |  18.3px   <- is
 *
 * The pair is better on every column at once, so nothing was traded for this.
 * The old value failed the noisy-rest target outright at 1.18px per frame,
 * which is the twitch, and trailed by 31px, which is twice the lag Scanbot
 * ships while still being less steady.
 */
export const MIN_CUTOFF = 0.25;

/**
 * How much the cutoff opens up with speed.
 *
 * ⚠️ 0.002, DOWN FROM 0.02, AND IT IMPROVED THE LAG RATHER THAN COSTING IT —
 * which is the opposite of what the parameter's name suggests. Less
 * speed-adaptation should mean a slower response, and at a fixed cutoff it
 * would. What actually happened is that `dx` is driven by DETECTOR NOISE as
 * much as by real motion, so a large beta made the cutoff oscillate frame to
 * frame: the filter kept unlocking itself for movement that was not there.
 * Steadier adaptation tracks a real pan better than jumpy adaptation does.
 *
 * ⚠️ IT MUST NOT GO TO ZERO. With no speed term the filter never opens up, and
 * the bench shows lag exploding as the cutoff falls — 46px, 74px, 96px, 173px
 * at minCutoff 0.4 down to 0.15. The overlay would be perfectly still and
 * hopelessly behind.
 */
export const BETA = 0.002;

/** Cutoff for the speed estimate itself. Standard value from the paper. */
export const D_CUTOFF = 1.0;

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

  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;

  /**
   * Overrides exist for the BENCH, not for callers.
   *
   * smooth-bench.spec.ts sweeps these to find the pair that meets the measured
   * targets; the product always takes the module defaults. Every previous pass
   * at this filter was judged by looking at it, which is how it survived three
   * rounds of "still twitchy" — a constructor that can be swept is what turns
   * the argument into numbers.
   */
  constructor(opts: { minCutoff?: number; beta?: number; dCutoff?: number } = {}) {
    this.minCutoff = opts.minCutoff ?? MIN_CUTOFF;
    this.beta = opts.beta ?? BETA;
    this.dCutoff = opts.dCutoff ?? D_CUTOFF;
  }

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
  push(target: Quad, dt: number): Quad {
    // Guard the clock. A backgrounded tab returns with a dt of several
    // seconds, and alpha() at that dt is ~1 — which would snap anyway, but
    // through a divide that is better not to trust.
    const step = Math.min(0.1, Math.max(1 / 240, dt));

    // ⚠️ THERE IS NO SNAP HERE ANY MORE, AND ITS REMOVAL IS THE POINT. A snap
    // is a teleport, and a teleport is the single most visible thing an
    // overlay can do — it is exactly what "the box twitches" describes. It was
    // here to catch a large jump; large jumps now arrive filtered, because the
    // decision about WHICH rectangle we are tracking moved upstream into
    // quad-track.ts, where a newcomer has to be seen twice before it is
    // believed. By the time a new target reaches this filter it has already
    // been vouched for, so the right response is to glide to it over a few
    // frames, not to jump.

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
    this.dx = this.dx + alpha(this.dCutoff, step) * (speed - this.dx);
    const a = alpha(this.minCutoff + this.beta * this.dx, step);

    const out = target.map((p, i) => ({
      x: this.channels[i * 2].filter(p.x, a),
      y: this.channels[i * 2 + 1].filter(p.y, a),
    })) as Quad;
    this.last = out;
    return out;
  }
}
