import { describe, expect, it } from 'vitest';
import { Gray } from './detect';
import { Quad, Rect } from './geometry';
import { refineAimQuad } from './refine';

// A bright document, rotated, on a textured ground — the operator's carpet,
// synthetically. The box is axis-aligned over it, the way the aim box always
// is, and the question is whether refine finds the document's real corners.

function rot(cx: number, cy: number, x: number, y: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * Math.cos(r) - dy * Math.sin(r),
    y: cy + dx * Math.sin(r) + dy * Math.cos(r),
  };
}

/** Is (x,y) inside the rotated rectangle? */
function inside(
  x: number,
  y: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  deg: number,
) {
  const p = rot(cx, cy, x, y, -deg);
  return (
    Math.abs(p.x - cx) <= w / 2 && Math.abs(p.y - cy) <= h / 2
  );
}

function scene(
  W: number,
  H: number,
  doc: { cx: number; cy: number; w: number; h: number; deg: number },
): Gray {
  const g: Gray = { data: new Uint8Array(W * H), width: W, height: H };
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v: number;
      if (inside(x, y, doc.cx, doc.cy, doc.w, doc.h, doc.deg)) {
        // Paper with a little print texture.
        v = 225 + (rnd() - 0.5) * 6;
      } else {
        // Carpet: mid-grey weave with real texture.
        v =
          105 +
          14 * Math.sin(x / 5.3) * Math.sin(y / 4.1) +
          (rnd() - 0.5) * 18;
      }
      g.data[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return g;
}

function trueCorners(doc: {
  cx: number;
  cy: number;
  w: number;
  h: number;
  deg: number;
}): Quad {
  const { cx, cy, w, h, deg } = doc;
  return [
    rot(cx, cy, cx - w / 2, cy - h / 2, deg),
    rot(cx, cy, cx + w / 2, cy - h / 2, deg),
    rot(cx, cy, cx + w / 2, cy + h / 2, deg),
    rot(cx, cy, cx - w / 2, cy + h / 2, deg),
  ];
}

function maxCornerError(got: Quad, want: Quad): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    worst = Math.max(
      worst,
      Math.hypot(got[i].x - want[i].x, got[i].y - want[i].y),
    );
  }
  return worst;
}

const W = 800;
const H = 600;

describe('refineAimQuad', () => {
  it('⚠️ FOLLOWS A ROTATED DOCUMENT THE AXIS-ALIGNED BOX CANNOT', () => {
    // The operator's own corner-editor screenshots, synthetically: card, ID
    // book and A4 form each lay a few degrees rotated, and the box clipped a
    // title here and a serial row there while its corners rested in carpet.
    for (const deg of [-4, -2, 2, 4]) {
      const doc = { cx: 400, cy: 300, w: 420, h: 265, deg };
      const g = scene(W, H, doc);
      // The box the member aimed with: axis-aligned, roughly over the card.
      const box: Rect = { x: 190, y: 168, width: 420, height: 265 };
      const got = refineAimQuad(g, box);
      expect(got).not.toBeNull();
      // Within ~1% of the frame of the true corners — versus the ~15-20px
      // the box's own corners are off by at 4 degrees.
      expect(maxCornerError(got!, trueCorners(doc))).toBeLessThan(8);
    }
  });

  it('absorbs the box being slightly off-centre and off-size too', () => {
    const doc = { cx: 400, cy: 300, w: 420, h: 265, deg: 3 };
    const g = scene(W, H, doc);
    const box: Rect = { x: 205, y: 155, width: 400, height: 280 };
    const got = refineAimQuad(g, box);
    expect(got).not.toBeNull();
    expect(maxCornerError(got!, trueCorners(doc))).toBeLessThan(8);
  });

  it('⚠️ RETURNS NULL ON EMPTY CARPET rather than inventing corners', () => {
    // The member pressed the shutter before putting the document down, or the
    // exposure ate everything. Snapping to noise would hand back a crop of
    // carpet with authority; null hands the decision back to the caller,
    // which keeps the box.
    const g: Gray = { data: new Uint8Array(W * H), width: W, height: H };
    let seed = 3;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < g.data.length; i++) {
      g.data[i] = 100 + (rnd() - 0.5) * 12;
    }
    const box: Rect = { x: 190, y: 168, width: 420, height: 265 };
    expect(refineAimQuad(g, box)).toBeNull();
  });

  it('leaves an aligned document essentially where the box was', () => {
    const doc = { cx: 400, cy: 300, w: 420, h: 265, deg: 0 };
    const g = scene(W, H, doc);
    const box: Rect = { x: 190, y: 167.5, width: 420, height: 265 };
    const got = refineAimQuad(g, box);
    expect(got).not.toBeNull();
    expect(maxCornerError(got!, trueCorners(doc))).toBeLessThan(5);
  });

  it('⚠️ CANNOT BE LURED BEYOND ITS BAND by a louder edge further out', () => {
    // A high-contrast mat edge 25% beyond the document — the mousepad family.
    // The band physically cannot reach it, which is the whole safety story.
    const doc = { cx: 400, cy: 300, w: 420, h: 265, deg: 2 };
    const g = scene(W, H, doc);
    // Paint a hard black frame well outside the box.
    for (let x = 80; x < 720; x++) {
      for (const y of [80, 81, 82, 519, 520, 521]) {
        g.data[y * W + x] = 5;
      }
    }
    for (let y = 80; y < 522; y++) {
      for (const x of [80, 81, 82, 717, 718, 719]) {
        g.data[y * W + x] = 5;
      }
    }
    const box: Rect = { x: 190, y: 168, width: 420, height: 265 };
    const got = refineAimQuad(g, box);
    expect(got).not.toBeNull();
    expect(maxCornerError(got!, trueCorners(doc))).toBeLessThan(8);
  });
});
