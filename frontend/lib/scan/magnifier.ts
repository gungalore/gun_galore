import { Pt } from './geometry';

// ────────────────────────────────────────────────────────────────────
// WHERE THE MAGNIFIER GOES.
//
// Pure, so the one piece of this that is easy to get subtly wrong is the one
// piece a test can pin.
//
// TWO CONSTRAINTS, both from the operator, and both about a hand:
//
//   1. AWAY FROM THE DOT. A loupe sitting on top of the corner being dragged
//      hides the thing it is meant to reveal.
//   2. NEVER IN THE BOTTOM HALF. That is where the finger and the hand are.
//      A magnifier under the hand is not merely useless — the member cannot
//      even tell it is there, so they lift their finger to look, and lifting
//      the finger ends the drag.
//
// Together those rule out "just offset it from the dot": an offset large
// enough to clear a hand from a corner near the bottom of the screen puts the
// loupe off-screen. So the loupe PARKS at one of a few fixed spots along the
// top, and picks the one furthest from the dot. Fixed spots also mean it does
// not skate around the screen while the finger moves, which is its own kind
// of unreadable.
// ────────────────────────────────────────────────────────────────────

export interface Box {
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
}

/**
 * How `object-fit: contain` lays an image into a box: the scale, and the
 * letterbox offsets.
 *
 * ⚠️ CONTAIN FITS BY WHICHEVER AXIS RUNS OUT FIRST. A portrait box showing a
 * landscape photograph letterboxes top and bottom; a landscape box showing
 * the same photograph letterboxes left and right. Mapping a touch through
 * width alone is right exactly half the time, and the other half puts every
 * corner somewhere the member did not put it.
 */
export function containFit(
  image: Box,
  box: Box,
): { scale: number; ox: number; oy: number } {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { scale: 1, ox: 0, oy: 0 };
  }
  const scale = Math.min(box.width / image.width, box.height / image.height);
  return {
    scale,
    ox: (box.width - image.width * scale) / 2,
    oy: (box.height - image.height * scale) / 2,
  };
}

/** How far the loupe keeps from the edges of the frame. */
const PAD = 10;

/**
 * ⚠️ THE NO-GO ZONE IS THE BOTTOM HALF OF THE FRAME. The loupe must sit
 * entirely above this line.
 */
export function noGoTop(frame: Box): number {
  return frame.height / 2;
}

/**
 * Park the loupe.
 *
 * @param dot    the corner being dragged, in frame coordinates
 * @param frame  the area the loupe may occupy
 * @param loupe  its size
 */
export function magnifierSpot(dot: Pt, frame: Box, loupe: Box): Placement {
  const low = Math.max(PAD, noGoTop(frame) - loupe.height - PAD);

  // A GRID OF PARKING SPOTS, not a row.
  //
  // Three columns rather than two so a dot in the middle of the top edge
  // still has somewhere genuinely far to send it. And ⚠️ TWO ROWS, because
  // one is not always enough: a loupe wide enough to span most of the frame
  // has no column along the top that clears a dot near the top edge — every
  // spot sits on it. Dropping to just above the no-go line clears it while
  // still keeping out of the hand's half. A single row failed exactly that
  // case, which is why the size sweep in the spec exists.
  const xs = [
    PAD,
    Math.max(PAD, (frame.width - loupe.width) / 2),
    Math.max(PAD, frame.width - loupe.width - PAD),
  ];
  const ys = low > PAD ? [PAD, low] : [PAD];

  let best: Placement = { x: xs[0], y: ys[0] };
  let bestD = -Infinity;
  for (const y of ys) {
    for (const x of xs) {
      // Distance from the dot to the NEAREST point of the loupe, not to its
      // centre: a wide loupe whose centre is far away can still have an edge
      // sitting under the finger.
      const dx = Math.max(x - dot.x, 0, dot.x - (x + loupe.width));
      const dy = Math.max(y - dot.y, 0, dot.y - (y + loupe.height));
      const d = Math.hypot(dx, dy);
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * The source rectangle the loupe shows: a window around the dot, in the
 * coordinates of the image being magnified.
 *
 * Clamped to the image so the loupe never shows blank space at an edge —
 * which matters, because the edges are exactly where corners live.
 */
export function loupeSource(
  dot: Pt,
  image: Box,
  loupe: Box,
  zoom: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sw = Math.min(image.width, loupe.width / zoom);
  const sh = Math.min(image.height, loupe.height / zoom);
  return {
    sx: Math.max(0, Math.min(image.width - sw, dot.x - sw / 2)),
    sy: Math.max(0, Math.min(image.height - sh, dot.y - sh / 2)),
    sw,
    sh,
  };
}

/**
 * Where the dot appears INSIDE the loupe, given the clamping above.
 *
 * ⚠️ NOT ALWAYS THE CENTRE. Clamp the source window at an image edge and the
 * dot slides off-centre — so a crosshair drawn permanently at the middle
 * would lie about where the corner actually is, which is the one thing the
 * crosshair exists not to do.
 */
export function loupeCrosshair(
  dot: Pt,
  image: Box,
  loupe: Box,
  zoom: number,
): Placement {
  const src = loupeSource(dot, image, loupe, zoom);
  return {
    x: (dot.x - src.sx) * zoom,
    y: (dot.y - src.sy) * zoom,
  };
}
