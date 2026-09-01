import { describe, expect, it } from 'vitest';
import {
  ENTER_SCALE,
  FADE_IN_MS,
  FADE_OUT_MS,
  GRACE_MS,
  QuadPresence,
  scaleAboutCentre,
} from './quad-presence';

const F = 1000 / 60;

/** Run n frames with a fixed `has`. */
function run(p: QuadPresence, has: boolean, ms: number) {
  let last = p.step(has, 0);
  for (let t = 0; t < ms; t += F) last = p.step(has, F);
  return last;
}

describe('QuadPresence', () => {
  it('starts hidden and invisible', () => {
    expect(new QuadPresence().state).toMatchObject({ phase: 'hidden', opacity: 0 });
  });

  it('fades in on opacity alone — no scale, no pop', () => {
    // ⚠️ THIS USED TO ASSERT A SCALE-IN AND NOW ASSERTS ITS ABSENCE. A 3%
    // settle-inward reads as polish in a mockup and as a twitch on a phone,
    // because acquisition is not one clean event — the detector finds the
    // page, drops it for a frame, finds it again, and every re-acquisition
    // replayed the pop. Scanbot's overlay does a plain opacity fade.
    const p = new QuadPresence();
    const first = p.step(true, F);
    expect(first.phase).toBe('entering');
    expect(first.opacity).toBeLessThan(1);
    // Never smaller than the document, and now never larger either.
    expect(first.scale).toBeGreaterThanOrEqual(1);
    expect(first.scale).toBeLessThanOrEqual(ENTER_SCALE);
    expect(ENTER_SCALE).toBe(1);
    const done = run(p, true, FADE_IN_MS + 3 * F);
    expect(done).toMatchObject({ phase: 'shown', opacity: 1, scale: 1 });
  });

  it('⚠️ ONE DROPPED INFERENCE DOES NOT BLINK THE BOX', () => {
    // The whole reason this exists. Misses at ~10Hz are routine.
    const p = new QuadPresence();
    run(p, true, FADE_IN_MS + 3 * F);
    // Three dropped frames in a row — well inside the grace window.
    for (let i = 0; i < 3; i++) {
      expect(p.step(false, F).opacity).toBe(1);
    }
    expect(p.step(true, F).phase).toBe('shown');
  });

  it('survives a miss streak shorter than the grace window', () => {
    const p = new QuadPresence();
    run(p, true, FADE_IN_MS + 3 * F);
    const s = run(p, false, GRACE_MS * 0.7);
    expect(s.phase).toBe('shown');
    expect(s.opacity).toBe(1);
  });

  it('leaves once the grace window is past, and fades rather than cutting', () => {
    const p = new QuadPresence();
    run(p, true, FADE_IN_MS + 3 * F);
    const leaving = run(p, false, GRACE_MS + 4 * F);
    expect(leaving.phase).toBe('leaving');
    expect(leaving.opacity).toBeLessThan(1);
    expect(leaving.opacity).toBeGreaterThan(0);
    const gone = run(p, false, FADE_OUT_MS + 4 * F);
    expect(gone.phase).toBe('hidden');
    expect(gone.opacity).toBe(0);
  });

  it('⚠️ RE-ACQUIRING MID-FADE CARRIES THE OPACITY FORWARD, NOT A FLASH', () => {
    const p = new QuadPresence();
    run(p, true, FADE_IN_MS + 3 * F);
    run(p, false, GRACE_MS + 2 * F);
    const mid = run(p, false, FADE_OUT_MS * 0.4);
    expect(mid.phase).toBe('leaving');
    const partial = mid.opacity;
    expect(partial).toBeGreaterThan(0.2);
    expect(partial).toBeLessThan(0.9);

    // The document comes back. Opacity must resume from roughly where it was,
    // never drop to zero and restart.
    const back = p.step(true, F);
    expect(back.phase).toBe('entering');
    expect(back.opacity).toBeGreaterThan(partial - 0.2);
    expect(back.opacity).toBeLessThan(1);
  });

  it('clamps a huge dt so a backgrounded tab cannot skip the animation', () => {
    const p = new QuadPresence();
    p.step(true, F);
    const s = p.step(true, 9000);
    expect(Number.isFinite(s.opacity)).toBe(true);
    expect(s.opacity).toBeLessThanOrEqual(1);
  });

  it('forgets everything on reset', () => {
    const p = new QuadPresence();
    run(p, true, FADE_IN_MS + 3 * F);
    p.reset();
    expect(p.state.phase).toBe('hidden');
  });
});

describe('scaleAboutCentre', () => {
  it('grows about the centre, leaving it fixed', () => {
    const q = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    const s = scaleAboutCentre(q, 1.1);
    const cx = s.reduce((n, p) => n + p.x, 0) / 4;
    const cy = s.reduce((n, p) => n + p.y, 0) / 4;
    expect(cx).toBeCloseTo(5, 9);
    expect(cy).toBeCloseTo(10, 9);
    expect(s[1].x - s[0].x).toBeCloseTo(11, 9);
  });

  it('is identity at 1', () => {
    const q = [
      { x: 3, y: 4 },
      { x: 9, y: 4 },
      { x: 9, y: 8 },
      { x: 3, y: 8 },
    ];
    for (const [i, p] of scaleAboutCentre(q, 1).entries()) {
      expect(p.x).toBeCloseTo(q[i].x, 9);
      expect(p.y).toBeCloseTo(q[i].y, 9);
    }
  });
});
