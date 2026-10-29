// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { heroVideoOpacity, HERO_VIDEO_FADE_IN_S, HERO_VIDEO_FADE_OUT_S } from './hero-video';

/**
 * The loop cut is the whole point of this helper. The clip is a montage that
 * ends on a river and restarts on a rifle bench, so the fade windows are what
 * hide the seam — if these numbers regress the hero visibly snaps once every
 * 13 seconds.
 */
describe('heroVideoOpacity', () => {
  const D = 13.33;

  it('is invisible at the first frame, so the loop starts from the poster', () => {
    expect(heroVideoOpacity(0, D)).toBe(0);
  });

  it('ramps up over the fade-in window', () => {
    const mid = HERO_VIDEO_FADE_IN_S / 2;
    expect(heroVideoOpacity(mid, D)).toBeCloseTo(0.5, 5);
    expect(heroVideoOpacity(HERO_VIDEO_FADE_IN_S, D)).toBe(1);
  });

  it('is fully opaque through the middle', () => {
    expect(heroVideoOpacity(D / 2, D)).toBe(1);
  });

  it('fades out to zero at the last frame', () => {
    const outStart = D - HERO_VIDEO_FADE_OUT_S;
    expect(heroVideoOpacity(outStart + HERO_VIDEO_FADE_OUT_S / 2, D)).toBeCloseTo(0.5, 5);
    expect(heroVideoOpacity(D, D)).toBe(0);
  });

  it('never exceeds 0..1', () => {
    for (let t = 0; t <= D; t += 0.05) {
      const o = heroVideoOpacity(t, D);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });

  it('stays sane before metadata arrives or on a short clip', () => {
    expect(heroVideoOpacity(0, NaN)).toBe(0);
    expect(heroVideoOpacity(0, 0)).toBe(0);
    expect(heroVideoOpacity(0.25, 2)).toBeCloseTo(0.5, 5);
    expect(heroVideoOpacity(2, 2)).toBe(0);
  });

  it('leaves a visible middle on a clip shorter than the fade windows', () => {
    // 4s clip: each fade is capped at a quarter, so 2s is fully opaque.
    expect(heroVideoOpacity(2, 4)).toBe(1);
  });
});
