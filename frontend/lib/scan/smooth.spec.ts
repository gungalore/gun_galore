import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import { QuadSmoother, SNAP_DISTANCE } from './smooth';

const FRAME = 1000;
const DT = 1 / 60;

function quad(x: number, y: number, w = 300, h = 400): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Feed the same target for n frames, as the draw loop does between detections. */
function settle(s: QuadSmoother, target: Quad, n: number): Quad {
  let out = target;
  for (let i = 0; i < n; i++) out = s.push(target, DT, FRAME);
  return out;
}

function worstCorner(a: Quad, b: Quad): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    worst = Math.max(worst, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  }
  return worst;
}

describe('QuadSmoother', () => {
  it('shows the first quad exactly, with no glide in from nowhere', () => {
    const s = new QuadSmoother();
    const q = quad(100, 100);
    expect(s.push(q, DT, FRAME)).toEqual(q);
  });

  it('⚠️ KILLS THE JITTER THAT MADE A STATIONARY BOX TWITCH', () => {
    // Consecutive detections of a document lying still disagree by a pixel or
    // two. Drawn raw, that is the twitch. The filter must swallow it.
    const s = new QuadSmoother();
    const base = quad(300, 400);
    settle(s, base, 30);

    let worstShown = 0;
    for (let i = 0; i < 60; i++) {
      // ±1.5px of detector noise, deterministic so the test cannot flake.
      const noise = ((i * 7919) % 31) / 10 - 1.5;
      const noisy = base.map((p) => ({ x: p.x + noise, y: p.y - noise })) as Quad;
      const shown = s.push(noisy, DT, FRAME);
      worstShown = Math.max(worstShown, worstCorner(shown, base));
    }
    // The input swings ~2.1px corner-to-corner; the output must be far tighter.
    expect(worstShown).toBeLessThan(0.8);
  });

  it('⚠️ STILL FOLLOWS A DELIBERATE MOVE, or it reads as a lost document', () => {
    // The failure mode of plain exponential smoothing: enough filtering to
    // kill jitter is enough lag to trail visibly behind the page.
    const s = new QuadSmoother();
    settle(s, quad(100, 100), 30);

    // Pan the document steadily for a third of a second.
    let shown = quad(100, 100);
    for (let i = 1; i <= 20; i++) shown = s.push(quad(100 + i * 4, 100), DT, FRAME);

    // After 20 frames of movement it must be close behind, not stuck at the
    // start. Total travel is 80px.
    const target = quad(180, 100);
    expect(worstCorner(shown, target)).toBeLessThan(16);
  });

  it('advances between detections, which is what turns 10Hz into 60Hz', () => {
    // The draw loop feeds the SAME target repeatedly while waiting for the
    // next inference. Each of those frames must still move the box.
    const s = new QuadSmoother();
    settle(s, quad(100, 100), 30);
    const target = quad(160, 100);

    const a = s.push(target, DT, FRAME);
    const b = s.push(target, DT, FRAME);
    const c = s.push(target, DT, FRAME);
    expect(worstCorner(b, target)).toBeLessThan(worstCorner(a, target));
    expect(worstCorner(c, target)).toBeLessThan(worstCorner(b, target));
  });

  it('⚠️ SNAPS ON RE-ACQUISITION RATHER THAN SLIDING ACROSS THE SCREEN', () => {
    // Moving to a new document must not draw the box travelling over the desk
    // in between — that is a picture of something that was never detected.
    const s = new QuadSmoother();
    settle(s, quad(50, 50, 200, 260), 30);
    const elsewhere = quad(700, 1200, 200, 260);
    expect(s.push(elsewhere, DT, FRAME)).toEqual(elsewhere);
  });

  it('eases rather than snaps for movement below the threshold', () => {
    const s = new QuadSmoother();
    const start = quad(400, 400);
    settle(s, start, 30);
    // Just under the snap distance, so it must NOT jump.
    const near = quad(400 + SNAP_DISTANCE * FRAME * 0.9, 400);
    const shown = s.push(near, DT, FRAME);
    expect(shown).not.toEqual(near);
    expect(worstCorner(shown, start)).toBeGreaterThan(0);
  });

  it('survives a backgrounded tab returning with a huge dt', () => {
    const s = new QuadSmoother();
    settle(s, quad(100, 100), 10);
    const q = quad(120, 120);
    const shown = s.push(q, 8.5, FRAME);
    for (const p of shown) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('forgets everything on reset, for the next document', () => {
    const s = new QuadSmoother();
    settle(s, quad(100, 100), 30);
    s.reset();
    expect(s.current).toBeNull();
    const q = quad(600, 700);
    expect(s.push(q, DT, FRAME)).toEqual(q);
  });
});

describe('⚠️ the quad stays RIGID while it tracks', () => {
  // The defect this guards: eight independent filters, each deriving its own
  // speed and therefore its own cutoff, let one corner ease while its
  // neighbour snapped. The rectangle sheared between them — "swimming" — which
  // reads as a worse bug than the jitter the filter exists to remove.
  it('moves all four corners by the same amount under pure translation', () => {
    const s = new QuadSmoother();
    settle(s, quad(200, 200), 30);
    // Translate rigidly. Every corner moves by exactly (30, 20).
    const shown = s.push(quad(230, 220), DT, FRAME);
    const before = quad(200, 200);
    const moves = shown.map((p, i) =>
      Math.hypot(p.x - before[i].x, p.y - before[i].y),
    );
    const spread = Math.max(...moves) - Math.min(...moves);
    expect(spread, `corners moved by different amounts: ${moves}`).toBeLessThan(1e-9);
  });

  it('does not let one noisy corner unlock the damping for the other three', () => {
    // The MEAN speed, not the max. A single corner jittering must not make the
    // whole box responsive — that is how one bad corner used to twitch it.
    const s = new QuadSmoother();
    const base = quad(300, 300);
    settle(s, base, 30);

    let worst = 0;
    for (let i = 0; i < 40; i++) {
      const noisy = base.map((p) => ({ x: p.x, y: p.y })) as Quad;
      noisy[1].x += ((i * 7919) % 13) - 6; // one corner only
      const shown = s.push(noisy, DT, FRAME);
      // The three quiet corners must stay put.
      for (const k of [0, 2, 3]) {
        worst = Math.max(worst, Math.hypot(shown[k].x - base[k].x, shown[k].y - base[k].y));
      }
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('preserves shape through a settled move — no shear', () => {
    const s = new QuadSmoother();
    settle(s, quad(100, 100, 300, 400), 30);
    let shown = quad(100, 100, 300, 400);
    for (let i = 1; i <= 40; i++) shown = s.push(quad(100 + i * 2, 100, 300, 400), DT, FRAME);
    // Opposite edges must remain equal length, as they are in the target.
    const top = Math.hypot(shown[1].x - shown[0].x, shown[1].y - shown[0].y);
    const bottom = Math.hypot(shown[2].x - shown[3].x, shown[2].y - shown[3].y);
    expect(Math.abs(top - bottom)).toBeLessThan(0.01);
  });
});
