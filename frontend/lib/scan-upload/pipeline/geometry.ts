export interface Point {
  x: number;
  y: number;
}

/** Four corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Shoelace area; always positive. */
export function quadArea(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function quadCentroid(q: Quad): Point {
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
}

/**
 * Put four arbitrary corners into TL, TR, BR, BL order.
 * TL has the smallest x+y, BR the largest; TR has the smallest y-x, BL the largest.
 */
export function orderQuad(pts: Point[]): Quad {
  if (pts.length !== 4) throw new Error('orderQuad needs exactly four points');
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = bySum[0];
  const br = bySum[3];
  const rest = pts.filter((p) => p !== tl && p !== br);
  const byDiff = rest.sort((a, b) => a.y - a.x - (b.y - b.x));
  const tr = byDiff[0];
  const bl = byDiff[1];
  return [tl, tr, br, bl];
}

/**
 * How alike two quads are, 0..1. 1 means identical. Based on mean corner
 * distance relative to the frame diagonal, so it is cheap and monotonic,
 * which is all the stability latch needs.
 */
export function quadSimilarity(a: Quad, b: Quad, frameW: number, frameH: number): number {
  const diag = Math.hypot(frameW, frameH);
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += dist(a[i], b[i]);
  return Math.max(0, 1 - sum / 4 / diag / 0.05);
}

/**
 * Linear fill: the larger of the quad's width over the frame width and its
 * height over the frame height. A landscape card in a portrait viewfinder
 * can never reach 60% of the AREA, so fill is linear, not area.
 */
export function linearFill(q: Quad, frameW: number, frameH: number): number {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return Math.max(w / frameW, h / frameH);
}

/**
 * Perspective score 0..1: 1 is a fronto-parallel rectangle. Uses the ratio
 * of opposite sides and the deviation of corner angles from 90 degrees.
 */
export function perspectiveScore(q: Quad): number {
  const top = dist(q[0], q[1]);
  const bottom = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  const sideRatio = Math.min(top, bottom) / Math.max(top, bottom);
  const vertRatio = Math.min(left, right) / Math.max(left, right);
  let angleScore = 1;
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4];
    const c = q[i];
    const n = q[(i + 1) % 4];
    const v1 = { x: p.x - c.x, y: p.y - c.y };
    const v2 = { x: n.x - c.x, y: n.y - c.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    const dev = Math.abs(Math.acos(Math.max(-1, Math.min(1, cos))) - Math.PI / 2);
    angleScore = Math.min(angleScore, 1 - dev / (Math.PI / 4));
  }
  return Math.max(0, Math.min(sideRatio, vertRatio, angleScore));
}

/** True when any corner is outside the frame or within `margin` (fraction) of its edge. */
export function touchesEdge(q: Quad, frameW: number, frameH: number, margin = 0.02): boolean {
  const mx = frameW * margin;
  const my = frameH * margin;
  return q.some((p) => p.x < mx || p.y < my || p.x > frameW - mx || p.y > frameH - my);
}

export function scaleQuad(q: Quad, sx: number, sy: number): Quad {
  return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
}
