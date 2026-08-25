import { describe, expect, it } from 'vitest';
import {
  FINGER,
  LOUPE_MAX,
  containFit,
  loupeCrosshair,
  loupeSize,
  loupeSource,
  magnifierSpot,
  noGoTop,
} from './magnifier';

const FRAME = { width: 390, height: 700 };
const LOUPE = { width: 140, height: 140 };

/** Do two rectangles overlap at all? */
function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('magnifierSpot', () => {
  it('⚠️ NEVER ENTERS THE BOTTOM HALF, wherever the dot is', () => {
    // That half belongs to the hand. A loupe under the finger cannot be seen
    // without lifting the finger, and lifting the finger ends the drag.
    //
    // ⚠️ THE LIMIT IS WRITTEN OUT LONGHAND. Asserting against noGoTop() would
    // be asserting that a function equals itself: move the line to the bottom
    // third and the test would follow it there and still pass. It caught
    // exactly that when the mutation was tried.
    for (let x = 0; x <= FRAME.width; x += 13) {
      for (let y = 0; y <= FRAME.height; y += 17) {
        const p = magnifierSpot({ x, y }, FRAME, LOUPE);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y + LOUPE.height).toBeLessThanOrEqual(FRAME.height / 2);
      }
    }
    expect(noGoTop(FRAME)).toBe(FRAME.height / 2);
  });

  it('⚠️ NEVER SITS UNDER THE DOT ITSELF, at any loupe size', () => {
    // The loupe must not cover the corner it is showing.
    //
    // Swept across loupe sizes, not just the one the editor happens to use
    // today: the placement rule has to hold when somebody makes the loupe
    // bigger, and a rule that only works at 140px is a coincidence.
    for (const loupe of [
      { width: 140, height: 140 },
      { width: 180, height: 120 },
      { width: 96, height: 96 },
      { width: 300, height: 100 },
    ]) {
      for (let x = 0; x <= FRAME.width; x += 11) {
        for (let y = 0; y <= FRAME.height; y += 11) {
          const p = magnifierSpot({ x, y }, FRAME, loupe);
          const box = { x: p.x, y: p.y, w: loupe.width, h: loupe.height };
          // A dot is a finger-sized target; keep the whole target clear.
          const dot = { x: x - 22, y: y - 22, w: 44, h: 44 };
          expect(overlaps(box, dot)).toBe(false);
        }
      }
    }
  });

  it('moves to the other side when the dot is near a top corner', () => {
    const left = magnifierSpot({ x: 10, y: 10 }, FRAME, LOUPE);
    const right = magnifierSpot({ x: 380, y: 10 }, FRAME, LOUPE);
    // A dot top-left sends it right, and vice versa.
    expect(left.x).toBeGreaterThan(FRAME.width / 2 - LOUPE.width / 2);
    expect(right.x).toBeLessThan(FRAME.width / 2);
  });

  it('stays inside the frame', () => {
    for (const dot of [
      { x: -50, y: -50 },
      { x: 900, y: 900 },
      { x: 195, y: 350 },
    ]) {
      const p = magnifierSpot(dot, FRAME, LOUPE);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + LOUPE.width).toBeLessThanOrEqual(FRAME.width);
    }
  });

  it('parks, rather than skating, as the dot moves a little', () => {
    // A loupe that slides continuously with the finger is its own kind of
    // unreadable. Small movements must not move it at all.
    const a = magnifierSpot({ x: 100, y: 400 }, FRAME, LOUPE);
    const b = magnifierSpot({ x: 108, y: 406 }, FRAME, LOUPE);
    expect(b).toEqual(a);
  });

  it('copes with a frame too short to hold it above the midline', () => {
    // A landscape phone, or a very short container. It must still return
    // something on-screen rather than a negative offset.
    const tiny = { width: 300, height: 200 };
    const p = magnifierSpot({ x: 150, y: 100 }, tiny, LOUPE);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeGreaterThanOrEqual(0);
  });
});

describe('loupeSize', () => {
  // ⚠️ THE SPEC ONLY EVER SWEPT 390 WIDE, WHICH IS WHY THIS SHIPPED.
  // At 390 even a fixed 148px loupe clears the dot by 42px, so every
  // assertion passed while the narrow phones nobody tested were the ones
  // parking the magnifier under the finger.
  const WIDTHS = [280, 320, 360, 375, 390, 414];

  it('keeps a fingertip of clearance at every width, for every dot position', () => {
    for (const width of WIDTHS) {
      const frame = { width, height: Math.round(width * 1.7) };
      const loupe = loupeSize(frame);
      let worst = Infinity;
      for (let x = 0; x <= frame.width; x += 5) {
        for (let y = 0; y <= frame.height; y += 5) {
          const at = magnifierSpot({ x, y }, frame, loupe);
          const dx = Math.max(at.x - x, 0, x - (at.x + loupe.width));
          const dy = Math.max(at.y - y, 0, y - (at.y + loupe.height));
          worst = Math.min(worst, Math.hypot(dx, dy));
        }
      }
      expect(
        worst,
        `at ${width}px wide the loupe came within ${worst.toFixed(1)}px of the dot`,
      ).toBeGreaterThanOrEqual(FINGER);
    }
  });

  it('still fits inside the frame and stays out of the hand at every width', () => {
    for (const width of WIDTHS) {
      const frame = { width, height: Math.round(width * 1.7) };
      const loupe = loupeSize(frame);
      for (let x = 0; x <= frame.width; x += 5) {
        for (let y = 0; y <= frame.height; y += 5) {
          const at = magnifierSpot({ x, y }, frame, loupe);
          expect(at.x).toBeGreaterThanOrEqual(0);
          expect(at.y).toBeGreaterThanOrEqual(0);
          expect(at.x + loupe.width).toBeLessThanOrEqual(frame.width);
          expect(at.y + loupe.height).toBeLessThanOrEqual(noGoTop(frame));
        }
      }
    }
  });

  it('does not shrink the loupe on phones that can carry a full one', () => {
    // 375 is the narrowest common iPhone; it and everything above keep today's
    // size, so the fix costs the majority nothing.
    for (const width of [375, 390, 414, 430]) {
      expect(loupeSize({ width, height: 700 }).width).toBe(LOUPE_MAX);
    }
  });
});

describe('loupeSource', () => {
  const IMAGE = { width: 1000, height: 800 };

  it('centres on the dot away from the edges', () => {
    const s = loupeSource({ x: 500, y: 400 }, IMAGE, LOUPE, 3);
    expect(s.sx + s.sw / 2).toBeCloseTo(500, 6);
    expect(s.sy + s.sh / 2).toBeCloseTo(400, 6);
    expect(s.sw).toBeCloseTo(140 / 3, 6);
  });

  it('⚠️ CLAMPS AT THE EDGES, because that is where corners live', () => {
    const s = loupeSource({ x: 2, y: 3 }, IMAGE, LOUPE, 3);
    expect(s.sx).toBe(0);
    expect(s.sy).toBe(0);
    const t = loupeSource({ x: 999, y: 799 }, IMAGE, LOUPE, 3);
    expect(t.sx + t.sw).toBeLessThanOrEqual(IMAGE.width + 1e-9);
    expect(t.sy + t.sh).toBeLessThanOrEqual(IMAGE.height + 1e-9);
  });

  it('never asks for more than the image has', () => {
    const small = { width: 20, height: 15 };
    const s = loupeSource({ x: 10, y: 7 }, small, LOUPE, 3);
    expect(s.sw).toBeLessThanOrEqual(small.width);
    expect(s.sh).toBeLessThanOrEqual(small.height);
  });
});

describe('loupeCrosshair', () => {
  const IMAGE = { width: 1000, height: 800 };

  it('sits in the middle when the window is not clamped', () => {
    const c = loupeCrosshair({ x: 500, y: 400 }, IMAGE, LOUPE, 3);
    expect(c.x).toBeCloseTo(LOUPE.width / 2, 6);
    expect(c.y).toBeCloseTo(LOUPE.height / 2, 6);
  });

  it('⚠️ FOLLOWS THE DOT OFF-CENTRE at an image edge', () => {
    // A crosshair nailed to the middle would point at the wrong pixel exactly
    // when the member is placing a corner in the corner of the photograph —
    // which is most of the time.
    const c = loupeCrosshair({ x: 2, y: 3 }, IMAGE, LOUPE, 3);
    expect(c.x).toBeCloseTo(2 * 3, 6);
    expect(c.y).toBeCloseTo(3 * 3, 6);
    expect(c.x).toBeLessThan(LOUPE.width / 2);
  });

  it('stays inside the loupe', () => {
    for (const dot of [
      { x: 0, y: 0 },
      { x: 1000, y: 800 },
      { x: 500, y: 0 },
      { x: 0, y: 800 },
    ]) {
      const c = loupeCrosshair(dot, IMAGE, LOUPE, 3);
      expect(c.x).toBeGreaterThanOrEqual(-1e-9);
      expect(c.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.x).toBeLessThanOrEqual(LOUPE.width + 1e-9);
      expect(c.y).toBeLessThanOrEqual(LOUPE.height + 1e-9);
    }
  });
});

describe('containFit', () => {
  it('letterboxes top and bottom for a landscape image in a portrait box', () => {
    const f = containFit({ width: 1000, height: 500 }, { width: 400, height: 800 });
    expect(f.scale).toBeCloseTo(0.4, 6);
    expect(f.ox).toBeCloseTo(0, 6);
    expect(f.oy).toBeCloseTo((800 - 200) / 2, 6);
  });

  it('⚠️ LETTERBOXES LEFT AND RIGHT the other way round', () => {
    // The case a width-only mapping gets wrong. A portrait photograph in a
    // landscape box: fitting by width would overflow the box vertically and
    // put every corner off by the whole letterbox.
    const f = containFit({ width: 500, height: 1000 }, { width: 800, height: 400 });
    expect(f.scale).toBeCloseTo(0.4, 6);
    expect(f.oy).toBeCloseTo(0, 6);
    expect(f.ox).toBeCloseTo((800 - 200) / 2, 6);
  });

  it('round-trips a point through view and back', () => {
    const image = { width: 4032, height: 3024 };
    const box = { width: 390, height: 700 };
    const f = containFit(image, box);
    for (const p of [
      { x: 0, y: 0 },
      { x: 4032, y: 3024 },
      { x: 1234, y: 2000 },
    ]) {
      const vx = p.x * f.scale + f.ox;
      const vy = p.y * f.scale + f.oy;
      expect((vx - f.ox) / f.scale).toBeCloseTo(p.x, 6);
      expect((vy - f.oy) / f.scale).toBeCloseTo(p.y, 6);
    }
  });

  it('does not divide by zero before the box has been measured', () => {
    const f = containFit({ width: 100, height: 100 }, { width: 0, height: 0 });
    expect(Number.isFinite(f.scale)).toBe(true);
    expect(f.scale).toBeGreaterThan(0);
  });
});
