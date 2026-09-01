import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import { BETA, D_CUTOFF, MIN_CUTOFF, QuadSmoother } from './smooth';

// ────────────────────────────────────────────────────────────────────
// THE OVERLAY'S FEEL, AS NUMBERS.
//
// ⚠️ THIS IS THE BENCH, AND IT COMES BEFORE THE TUNING. Every previous pass at
// the live quad was judged by looking at it, which is how it survived three
// rounds of "still twitchy". tools/quad_bench.py measures the same quantities
// off a real screen recording; this measures them off a synthetic detection
// stream, so the filter can be tuned in seconds without a phone in hand.
//
// Targets, measured by the operator from a frame analysis of Scanbot's own Web
// SDK demo running in iOS Safari (2154 frames at 60fps):
//
//     jitter at rest    median step  < 1px
//     lag during pan    p95 step     < 12px
//
// ⚠️ AND THE PRINCIPLE BEHIND THEM: the live quad is a UI AFFORDANCE, NOT A
// MEASUREMENT. Scanbot's own overlay trails the card by 10-20px during a pan
// and sits visibly inside the leading edge. They trade accuracy for stability,
// hard, and do the precise work at capture. Optimise for "never twitches" and
// accept being wrong by 2%.
//
// The render loop runs at 60fps and inference at 15, so three of every four
// frames re-aim at an unchanged target. That is real — it is what the phone
// does — but it means the median is dominated by settling, not by new
// information, and a low median alone is not proof of a calm overlay. The p95
// under motion is the number that separates candidates.
// ────────────────────────────────────────────────────────────────────

const RENDER_HZ = 60;
const INFER_HZ = 15;
const FRAME_W = 1000;

/** Deterministic noise — a bench that moves between runs cannot be tuned against. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function quadAt(cx: number, cy: number, w: number, h: number, rot: number): Quad {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c })) as Quad;
}

interface Result {
  medianStep: number;
  p95Step: number;
}

/**
 * Run a detection stream through the smoother and measure the drawn steps.
 *
 * `centre(t)` gives the true document centre at time t in seconds; corner
 * noise stands in for the detector's own per-frame wobble.
 */
function bench(
  centre: (t: number) => { x: number; y: number; rot: number },
  seconds: number,
  noisePx: number,
  params?: { minCutoff?: number; beta?: number },
): Result {
  const sm = new QuadSmoother(params);
  const rnd = rng(12345);
  const dt = 1 / RENDER_HZ;
  const inferEvery = RENDER_HZ / INFER_HZ;
  const steps: number[] = [];
  let target: Quad | null = null;
  let prev: Quad | null = null;

  const frames = Math.round(seconds * RENDER_HZ);
  for (let f = 0; f < frames; f++) {
    const t = f * dt;
    if (f % inferEvery === 0) {
      const c = centre(t);
      const clean = quadAt(c.x, c.y, 300, 420, c.rot);
      target = clean.map((p) => ({
        x: p.x + (rnd() - 0.5) * 2 * noisePx,
        y: p.y + (rnd() - 0.5) * 2 * noisePx,
      })) as Quad;
    }
    if (!target) continue;
    const drawn = sm.push(target, dt);
    if (prev) {
      // Step of the drawn polygon: the mean corner movement, which sees
      // rotation and shape change that a centroid alone would miss.
      let sum = 0;
      for (let i = 0; i < 4; i++) sum += Math.hypot(drawn[i].x - prev[i].x, drawn[i].y - prev[i].y);
      steps.push(sum / 4);
    }
    prev = drawn;
  }
  const sorted = [...steps].sort((a, b) => a - b);
  return {
    medianStep: sorted[sorted.length >> 1] ?? 0,
    p95Step: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
  };
}

const REST = () => ({ x: FRAME_W / 2, y: FRAME_W / 2, rot: 0 });
/** A slow pan: the document crosses ~40% of the frame over two seconds. */
const PAN = (t: number) => ({ x: 300 + t * 200, y: 500 + Math.sin(t) * 30, rot: t * 0.05 });

describe('live quad — jitter at rest', () => {
  it('holds under 1px per frame with a realistically noisy detector', () => {
    // 3px of per-corner detector wobble is what a small, textured, slightly
    // blurred document produces. This is the number the member reads as
    // "twitchy" when the filter passes it through.
    const r = bench(REST, 3, 3);
    expect(r.medianStep).toBeLessThan(1);
  });

  it('holds under 1px even when the detector is badly noisy', () => {
    const r = bench(REST, 3, 8);
    expect(r.medianStep).toBeLessThan(1);
  });
});

describe('live quad — motion', () => {
  it('keeps p95 step under 12px during a pan', () => {
    const r = bench(PAN, 3, 3);
    expect(r.p95Step).toBeLessThan(12);
  });

  it('still follows — a filter that never moves would pass the tests above', () => {
    // ⚠️ THE GUARD AGAINST OVER-DAMPING. Every jitter target is trivially met
    // by a filter that ignores its input, so the bench has to prove the quad
    // actually travels. Over three seconds of pan the document moves 600px.
    const sm = new QuadSmoother();
    const dt = 1 / RENDER_HZ;
    let drawn: Quad | null = null;
    for (let f = 0; f < 180; f++) {
      const c = PAN(f * dt);
      drawn = sm.push(quadAt(c.x, c.y, 300, 420, c.rot), dt);
    }
    const end = PAN(179 / RENDER_HZ);
    // Within 2% of frame width of the truth, which is the lag Scanbot ships.
    expect(Math.abs(drawn![0].x - (end.x - 150))).toBeLessThan(FRAME_W * 0.02);
  });
});

describe('the tuning is recorded, not folklore', () => {
  it('names the parameters the bench was satisfied with', () => {
    // If someone changes these, the tests above are the argument for or
    // against — not an opinion about how it looked on one phone.
    expect(MIN_CUTOFF).toBeGreaterThan(0);
    expect(BETA).toBeGreaterThanOrEqual(0);
    expect(D_CUTOFF).toBeGreaterThan(0);
  });
});
