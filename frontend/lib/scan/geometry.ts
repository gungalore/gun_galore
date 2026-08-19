// ────────────────────────────────────────────────────────────────────
// THE MATHS UNDER THE SCANNER.
//
// Pure: numbers in, numbers out. No DOM, no canvas, no imports. That is what
// makes the whole scanner testable without a phone — the geometry is where the
// bugs that ruin a scan live, and they are all reachable from a unit test.
// ────────────────────────────────────────────────────────────────────

/** A point in image space. Pixels, origin top-left. */
export interface Pt {
  x: number;
  y: number;
}

/** Four corners, ALWAYS ordered top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

/**
 * A 3x3 homography, row-major, with h[8] normalised to 1.
 *
 * Maps DESTINATION to SOURCE — the inverse direction — because a warp iterates
 * over destination pixels and samples the source. Going the other way leaves
 * holes wherever two destination pixels fail to claim a source pixel.
 */
export type Homography = Float64Array;

// ── ordering ────────────────────────────────────────────────────────

/**
 * Put four points into TL, TR, BR, BL order.
 *
 * By angle about the centroid rather than by sums and differences of the
 * coordinates. The sum/difference trick is everywhere on the internet and it
 * breaks on a strongly rotated document — where the "top-left" by x+y is
 * actually the top-right corner — which is exactly the case a scanner has to
 * handle.
 */
export function orderQuad(pts: Pt[]): Quad {
  if (pts.length !== 4) throw new Error('orderQuad needs exactly four points');
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;

  // Sort clockwise starting from the -y axis (screen up).
  const withAngle = pts.map((p) => ({
    p,
    a: Math.atan2(p.x - cx, -(p.y - cy)),
  }));
  withAngle.sort((m, n) => m.a - n.a);
  const ring = withAngle.map((w) => w.p);

  // The ring starts somewhere on the top edge; rotate so the FIRST point is
  // the one closest to the top-left of the bounding box.
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = (ring[i].x - minX) ** 2 + (ring[i].y - minY) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return [
    ring[best],
    ring[(best + 1) % 4],
    ring[(best + 2) % 4],
    ring[(best + 3) % 4],
  ];
}

/** Signed area. Positive is clockwise in screen coordinates (y down). */
export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return a / 2;
}

/** A quad with a reflex corner is not a photograph of a rectangle. */
export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/** Smallest interior angle, in degrees. A sane document is well above 50°. */
export function minInteriorAngle(q: Quad): number {
  let min = 180;
  for (let i = 0; i < 4; i++) {
    const prev = q[(i + 3) % 4];
    const cur = q[i];
    const next = q[(i + 1) % 4];
    const ax = prev.x - cur.x;
    const ay = prev.y - cur.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const dot = ax * bx + ay * by;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return 0;
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot / (la * lb)))) * 180) / Math.PI;
    if (ang < min) min = ang;
  }
  return min;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── the homography ──────────────────────────────────────────────────

/**
 * Solve an 8x8 linear system by Gaussian elimination with partial pivoting.
 *
 * Partial pivoting is not optional here: without it a document photographed
 * square-on produces a near-zero pivot on the perspective rows and the whole
 * transform comes out as noise.
 *
 * Returns null when the system is singular — four points that are collinear,
 * or two corners in the same place.
 */
export function solve8(
  a: number[][],
  b: number[],
): Float64Array | null {
  const n = 8;
  const m = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    if (piv !== col) {
      const t = m[piv];
      m[piv] = m[col];
      m[col] = t;
    }
    const p = m[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }

  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i])) return null;
  }
  return x;
}

/**
 * The DESTINATION-to-SOURCE homography for warping `quad` onto a `w` x `h`
 * rectangle.
 *
 * Each corner correspondence (u,v) -> (x,y) contributes two rows:
 *   [ u v 1 0 0 0  -ux -vx ] . h = x
 *   [ 0 0 0 u v 1  -uy -vy ] . h = y
 */
export function homographyToRect(
  quad: Quad,
  w: number,
  h: number,
): Homography | null {
  const dst: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i];
    const { x, y } = quad[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    B.push(y);
  }
  const s = solve8(A, B);
  if (!s) return null;
  const out = new Float64Array(9);
  out.set(s, 0);
  out[8] = 1;
  return out;
}

/** Apply a homography to one point. */
export function applyH(hm: Homography, u: number, v: number): Pt {
  const d = hm[6] * u + hm[7] * v + hm[8];
  if (Math.abs(d) < 1e-12) return { x: NaN, y: NaN };
  return {
    x: (hm[0] * u + hm[1] * v + hm[2]) / d,
    y: (hm[3] * u + hm[4] * v + hm[5]) / d,
  };
}

// ── output size ─────────────────────────────────────────────────────

/**
 * Aspect ratios worth snapping to, longest edge over shortest.
 *
 * ISO ID-1 is 85.60 x 53.98 mm — a South African firearm licence card, a
 * competency card and an ID card are all ID-1, and they are most of what the
 * vault holds.
 */
export const KNOWN_ASPECTS = [
  { name: 'ID-1 card', ratio: 85.6 / 53.98 },
  { name: 'A-series page', ratio: Math.SQRT2 },
] as const;

/** How close the naive aspect has to be before we trust the table over it. */
export const SNAP_TOLERANCE = 0.06;

/**
 * The output rectangle for a quad.
 *
 * ⚠️ THE NAIVE MEASUREMENT IS BIASED. Taking max(top, bottom) for the width
 * overstates it under perspective, because the near edge is longer than the
 * far one — by up to about 15% on a strongly tilted shot. Recovering the true
 * aspect from vanishing points is the rigorous answer and is numerically
 * unstable exactly when the quad is near-rectangular, which is the common
 * case.
 *
 * So: measure naively, then snap to a known aspect when we are within a few
 * per cent of one. It is a guess, it is bounded, and the member reviews the
 * result before it is used.
 */
export function outputSize(
  quad: Quad,
  maxEdge: number,
): { w: number; h: number; snapped: string | null } {
  const top = dist(quad[0], quad[1]);
  const bottom = dist(quad[3], quad[2]);
  const left = dist(quad[0], quad[3]);
  const right = dist(quad[1], quad[2]);

  let w = Math.max(top, bottom);
  let h = Math.max(left, right);
  if (w < 1 || h < 1) return { w: 1, h: 1, snapped: null };

  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const ratio = long / short;

  let snapped: string | null = null;
  for (const k of KNOWN_ASPECTS) {
    if (Math.abs(ratio - k.ratio) / k.ratio <= SNAP_TOLERANCE) {
      const target = k.ratio;
      if (w >= h) h = w / target;
      else w = h / target;
      snapped = k.name;
      break;
    }
  }

  // Cap the long edge. The crop has already thrown the desk away, so the
  // document itself gets more pixels here than a full-frame photo gives it.
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
    snapped,
  };
}

/**
 * A quad covering the whole frame, inset by a fraction.
 *
 * The fallback when detection finds nothing: better to hand the member a
 * sensible starting rectangle they can drag than an empty editor.
 */
export function frameQuad(w: number, h: number, inset = 0.06): Quad {
  const dx = w * inset;
  const dy = h * inset;
  return [
    { x: dx, y: dy },
    { x: w - dx, y: dy },
    { x: w - dx, y: h - dy },
    { x: dx, y: h - dy },
  ];
}

/** Move every corner towards or away from the quad's own centre. */
export function scaleQuad(q: Quad, factor: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  })) as Quad;
}

/** Largest corner movement between two quads, in pixels. */
export function quadDrift(a: Quad, b: Quad): number {
  let max = 0;
  for (let i = 0; i < 4; i++) max = Math.max(max, dist(a[i], b[i]));
  return max;
}

/**
 * Exponential smoothing, corner by corner.
 *
 * The markers are redrawn far more often than detection runs, and a quad that
 * jumps to each new detection reads as broken. alpha 0.35 settles in about
 * three detections, which is what "it locked on" looks like.
 */
export function smoothQuad(prev: Quad | null, next: Quad, alpha = 0.35): Quad {
  if (!prev) return next;
  return next.map((p, i) => ({
    x: prev[i].x + (p.x - prev[i].x) * alpha,
    y: prev[i].y + (p.y - prev[i].y) * alpha,
  })) as Quad;
}
