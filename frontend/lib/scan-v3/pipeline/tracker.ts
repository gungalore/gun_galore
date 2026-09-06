import type { Quad } from './geometry';
import { quadSimilarity } from './geometry';

/**
 * 1 euro filter (Casiez, Roche, Vogel; CHI 2012). Adaptive low-pass: no
 * jitter when the hand is still, no lag when it moves fast.
 * `minCutoff` lower = less jitter, more lag. `beta` higher = less lag at speed.
 */
export class OneEuro {
  private xPrev: number | undefined;
  private dxPrev = 0;
  private tPrev: number | undefined;

  constructor(
    private readonly minCutoff = 1.0,
    private readonly beta = 0.01,
    private readonly dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** `t` in milliseconds. */
  filter(x: number, t: number): number {
    if (this.xPrev === undefined || this.tPrev === undefined) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-3, (t - this.tPrev) / 1000);
    const dx = (x - this.xPrev) / dt;
    const ad = this.alpha(this.dCutoff, dt);
    const dxHat = ad * dx + (1 - ad) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }

  reset(): void {
    this.xPrev = undefined;
    this.tPrev = undefined;
    this.dxPrev = 0;
  }
}

/**
 * Smooths a quad over time and holds it through a few missed frames, so a
 * single dropped detection does not make the outline blink.
 */
export class QuadSmoother {
  private filters = Array.from({ length: 8 }, () => new OneEuro(1.0, 0.01));
  private last: Quad | null = null;
  private misses = 0;

  constructor(private readonly maxMisses = 4) {}

  push(q: Quad, t: number): Quad {
    this.misses = 0;
    const out = q.map((p, i) => ({
      x: this.filters[i * 2].filter(p.x, t),
      y: this.filters[i * 2 + 1].filter(p.y, t),
    })) as Quad;
    this.last = out;
    return out;
  }

  /** Called when the detector saw nothing. Returns the held quad or null once patience runs out. */
  miss(): Quad | null {
    this.misses += 1;
    if (this.misses > this.maxMisses) {
      this.reset();
      return null;
    }
    return this.last;
  }

  current(): Quad | null {
    return this.last;
  }

  reset(): void {
    for (const f of this.filters) f.reset();
    this.last = null;
    this.misses = 0;
  }
}

export interface LatchState {
  locked: boolean;
  /** 0..1 while the ring fills; 1 means capture now. */
  progress: number;
}

/**
 * The "hold still" latch. Enters the stable state when consecutive smoothed
 * quads are alike (similarity above `enter`) and every gate passes; leaves
 * when similarity drops under `exit` or a gate fails. Hysteresis stops the
 * ring flickering at the boundary. Progress reaches 1 after `dwellMs`.
 *
 * Similarity is 1 - meanCornerMotion / (5% of the frame diagonal), so
 * `enter` 0.8 means the corners moved under 1% of the diagonal between
 * frames (about 3 px on a 256 px live frame, where the model itself
 * jitters by 1-2 px) and `exit` 0.6 means 2%.
 */
export class StabilityLatch {
  private prev: Quad | null = null;
  private stableSince: number | null = null;

  constructor(
    private readonly opts = { enter: 0.8, exit: 0.6, dwellMs: 700 },
  ) {}

  update(q: Quad | null, gatesPass: boolean, t: number, frameW: number, frameH: number): LatchState {
    if (!q || !gatesPass) {
      this.prev = q;
      this.stableSince = null;
      return { locked: false, progress: 0 };
    }
    const sim = this.prev ? quadSimilarity(this.prev, q, frameW, frameH) : 0;
    this.prev = q;
    if (this.stableSince === null) {
      if (sim >= this.opts.enter) this.stableSince = t;
      return { locked: false, progress: 0 };
    }
    if (sim < this.opts.exit) {
      this.stableSince = null;
      return { locked: false, progress: 0 };
    }
    const progress = Math.min(1, (t - this.stableSince) / this.opts.dwellMs);
    return { locked: true, progress };
  }

  reset(): void {
    this.prev = null;
    this.stableSince = null;
  }
}
