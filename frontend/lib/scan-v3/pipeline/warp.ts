import type { Point, Quad } from './geometry';
import { quadArea } from './geometry';

export type Homography = Float64Array; // 9 values, row-major

/** Solve the 3x3 homography mapping `src[i]` to `dst[i]` (4 point DLT, h33 = 1). */
export function solveHomography(src: Point[], dst: Point[]): Homography {
  if (src.length !== 4 || dst.length !== 4) throw new Error('four point pairs needed');
  // 8x8 system A h = b
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = gaussianSolve(A, b);
  return new Float64Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]);
}

function gaussianSolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('degenerate quad');
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function applyHomography(H: Homography, p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/**
 * Output size for a rectified document: the source quad's own pixel count,
 * shaped to `aspect` (width/height), capped at `maxEdge`. Never upsamples
 * beyond 1.2x, following Dropbox and Zhang: no source pixel maps to less than
 * roughly one output pixel.
 */
export function outputSizeFor(quad: Quad, aspect: number, maxEdge = 3600): { width: number; height: number } {
  const area = quadArea(quad) * 1.2;
  let width = Math.sqrt(area * aspect);
  let height = width / aspect;
  const longest = Math.max(width, height);
  if (longest > maxEdge) {
    const s = maxEdge / longest;
    width *= s;
    height *= s;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/**
 * Rectify `quad` (TL, TR, BR, BL in `src` pixels) into a `width x height`
 * image. Inverse mapping with bilinear sampling, so every output pixel is
 * filled and there are no holes.
 */
export function warpQuad(src: ImageData, quad: Quad, width: number, height: number): ImageData {
  const dstRect: Point[] = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
  const H = solveHomography(dstRect, quad); // output -> source
  const out = new ImageData(width, height);
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  const d = out.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / w;
      const sy = (H[3] * x + H[4] * y + H[5]) / w;
      const o = (y * width + x) * 4;
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        d[o] = d[o + 1] = d[o + 2] = 255;
        d[o + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] * (1 - fx) + s[i10 + c] * fx;
        const bot = s[i01 + c] * (1 - fx) + s[i11 + c] * fx;
        d[o + c] = top * (1 - fy) + bot * fy;
      }
      d[o + 3] = 255;
    }
  }
  return out;
}
