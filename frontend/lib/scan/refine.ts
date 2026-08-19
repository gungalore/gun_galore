import { Gray } from './detect';
import { Pt, Quad, Rect, isConvex } from './geometry';

// ────────────────────────────────────────────────────────────────────
// SNAPPING THE AIM BOX ONTO THE DOCUMENT'S REAL EDGES.
//
// The box crop fixed "the detector found the carpet", and immediately exposed
// the next thing: nobody lays a document down at exactly zero degrees. The
// operator's own corner-editor screenshots show it — card, ID book and A4
// form all a few degrees rotated on the carpet, the axis-aligned box clipping
// a title here and a serial row there, its corners resting in carpet wedges.
// "Perfectly inside the box" is a statement about millimetres; the box is a
// statement about pixels; the difference is a rotation.
//
// So the box is treated as WHERE TO LOOK, never as the answer: each of its
// four edges searches a narrow band for the strongest luminance edge running
// roughly parallel to it — two independent windows per edge, so the found
// line can TILT — and the four fitted lines intersect into the document's
// actual corners.
//
// ⚠️ THIS IS NOT THE DETECTOR, ON PURPOSE. detectQuad answers "is there a
// document anywhere in this picture", and on a patterned carpet its honest
// answer is sometimes the carpet. This answers a much smaller question —
// "the member says the edge is within a few percent of HERE; where exactly?"
// — and the band is what keeps it small: the search physically cannot reach
// the mousepad, the ruler, or anything else the detector has been seduced by,
// because it never looks more than BAND_FRAC away from where the member
// aimed. Any edge without a clear ridge in its band keeps the box's own line,
// and if the result is degenerate the caller keeps the whole box. It can
// polish the member's answer; it cannot replace it.
// ────────────────────────────────────────────────────────────────────

/** How far either side of the box an edge may be found, as a fraction. */
const BAND_FRAC = 0.09;
/** Never search fewer than this many pixels, whatever the box size. */
const BAND_MIN = 6;
/**
 * Mean |gradient| below which a window has found nothing.
 *
 * ⚠️ MEASURED, THE SECOND TIME. The first value here was 10, justified by
 * numbers I had not actually taken; measured on the operator's IMG_4947 at
 * refine's own working width, the card's edge responds at 62 and the bare
 * carpet's weave at 11.5-19.5 — so 10 was BELOW the noise floor, and a box
 * over empty carpet happily snapped to fluff. 28 clears the worst carpet row
 * by half again and sits at less than half the weakest true edge.
 */
const MIN_RESP = 28;
/** Samples along each half-edge window. */
const SAMPLES = 21;

/**
 * Fit the document's edges near the aim box.
 *
 * @returns the snapped quad, or null when the picture offers nothing better
 *          than the box itself — the caller should then keep the box.
 */
export function refineAimQuad(g: Gray, box: Rect): Quad | null {
  const corners: Quad = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];

  const lines: { a: Pt; b: Pt }[] = [];
  let snapped = 0;

  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    // Outward unit normal for a clockwise quad.
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    let nx = -ey / len;
    let ny = ex / len;
    // Point it away from the box centre.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (nx * (cx - mx) + ny * (cy - my) > 0) {
      nx = -nx;
      ny = -ny;
    }

    const band = Math.max(
      BAND_MIN,
      Math.round((e % 2 === 0 ? box.height : box.width) * BAND_FRAC),
    );

    // ⚠️ TWO WINDOWS, NOT ONE. A single best-offset for the whole edge can
    // only slide the box's line parallel to itself, and a parallel slide
    // cannot follow a rotated document — which is the entire reason this file
    // exists. Two independently-fitted points let the line tilt.
    const w1 = fitWindow(g, a, b, 0.12, 0.44, nx, ny, band);
    const w2 = fitWindow(g, a, b, 0.56, 0.88, nx, ny, band);

    if (w1 && w2) {
      lines.push({ a: w1, b: w2 });
      snapped++;
    } else {
      // No ridge in the band on this side — the box's own line stands. A
      // document edge lost in shadow on one side must not stop the other
      // three from snapping.
      lines.push({ a, b });
    }
  }

  // Nothing snapped means the picture had no opinion anywhere near the box —
  // the box is already the best available answer, and "refined" corners built
  // purely from its own lines would be the box wearing a costume.
  if (snapped === 0) return null;

  const quad: Quad = [
    intersect(lines[3], lines[0]),
    intersect(lines[0], lines[1]),
    intersect(lines[1], lines[2]),
    intersect(lines[2], lines[3]),
  ];

  // ── sanity, before anything downstream trusts this ────────────────
  if (!quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    return null;
  }
  if (!isConvex(quad)) return null;
  // Every corner must stay near its box corner. A fitted line that latched
  // onto print INSIDE the document intersects at silly angles and lands far
  // away; twice the band is as far as an honest snap can reach.
  const reach = 2 * Math.max(BAND_MIN, Math.max(box.width, box.height) * BAND_FRAC);
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(quad[i].x - corners[i].x, quad[i].y - corners[i].y) > reach) {
      return null;
    }
  }
  return quad;
}

/**
 * The strongest parallel edge inside one window of one side's band.
 *
 * Walks offsets from the OUTSIDE of the band inward and keeps the outermost
 * offset within 80% of the best response — the same reasoning as the
 * detector's growQuad: print near a document's edge (a title, a table rule)
 * is often louder than the paper edge itself, but it is always INSIDE it.
 * Preferring the outermost strong ridge finds paper, not print.
 *
 * @returns the fitted point at the window's centre, or null if nothing in
 *          the band responds like an edge.
 */
function fitWindow(
  g: Gray,
  a: Pt,
  b: Pt,
  t0: number,
  t1: number,
  nx: number,
  ny: number,
  band: number,
): Pt | null {
  const responses: number[] = [];
  let bestResp = 0;
  for (let off = -band; off <= band; off++) {
    let sum = 0;
    for (let k = 0; k < SAMPLES; k++) {
      const t = t0 + ((t1 - t0) * k) / (SAMPLES - 1);
      const px = a.x + (b.x - a.x) * t + nx * off;
      const py = a.y + (b.y - a.y) * t + ny * off;
      sum += Math.abs(lum(g, px + nx, py + ny) - lum(g, px - nx, py - ny));
    }
    const resp = sum / SAMPLES;
    responses.push(resp);
    if (resp > bestResp) bestResp = resp;
  }
  if (bestResp < MIN_RESP) return null;

  // Outermost offset that is a local ridge and near-best.
  for (let i = responses.length - 1; i >= 0; i--) {
    if (responses[i] >= bestResp * 0.8) {
      const off = i - band;
      const tm = (t0 + t1) / 2;
      return {
        x: a.x + (b.x - a.x) * tm + nx * off,
        y: a.y + (b.y - a.y) * tm + ny * off,
      };
    }
  }
  return null;
}

/** Luma at a real-valued point, clamped to the image. */
function lum(g: Gray, x: number, y: number): number {
  const xi = Math.max(0, Math.min(g.width - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(g.height - 1, Math.round(y)));
  return g.data[yi * g.width + xi];
}

/** Where two infinite lines (each through two points) cross. */
function intersect(l1: { a: Pt; b: Pt }, l2: { a: Pt; b: Pt }): Pt {
  const x1 = l1.a.x, y1 = l1.a.y, x2 = l1.b.x, y2 = l1.b.y;
  const x3 = l2.a.x, y3 = l2.a.y, x4 = l2.b.x, y4 = l2.b.y;
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) return { x: NaN, y: NaN };
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}
