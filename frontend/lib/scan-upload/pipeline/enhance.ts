import type { EnhanceMode } from '../types';
import { toGrey } from './gates';

/**
 * Illumination normalisation: estimate the paper's own brightness as a smooth
 * map (max filter then blur, at quarter resolution), divide it out per
 * channel, and scale so paper becomes near-white. Removes soft shadows and
 * vignetting; keeps ink and colour. The same idea Zhang (Office Lens),
 * Dropbox and Adobe describe, in its cheapest form.
 */
export function normalizeIllumination(img: ImageData, paperWhite = 240): ImageData {
  const { width, height, data } = img;
  const scale = 4;
  const sw = Math.max(1, Math.floor(width / scale));
  const sh = Math.max(1, Math.floor(height / scale));
  // Downsample by averaging.
  const small = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = 0; dy < scale; dy++) {
        const yy = y * scale + dy;
        if (yy >= height) break;
        for (let dx = 0; dx < scale; dx++) {
          const xx = x * scale + dx;
          if (xx >= width) break;
          const i = (yy * width + xx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      const o = (y * sw + x) * 3;
      small[o] = r / n;
      small[o + 1] = g / n;
      small[o + 2] = b / n;
    }
  }
  // Max filter (paper is the brightest local thing), radius ~ 1/40 of the short side.
  const radius = Math.max(2, Math.round(Math.min(sw, sh) / 40));
  const maxed = maxFilter(small, sw, sh, radius);
  // Two box blurs to smooth the map.
  const bg = boxBlur(boxBlur(maxed, sw, sh, radius), sw, sh, radius);
  // Divide at full resolution with bilinear lookup into the small map.
  const out = new ImageData(width, height);
  const d = out.data;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(sh - 1, y / scale);
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(sw - 1, x / scale);
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const b00 = bg[(y0 * sw + x0) * 3 + c];
        const b10 = bg[(y0 * sw + x1) * 3 + c];
        const b01 = bg[(y1 * sw + x0) * 3 + c];
        const b11 = bg[(y1 * sw + x1) * 3 + c];
        const bv = (b00 * (1 - wx) + b10 * wx) * (1 - wy) + (b01 * (1 - wx) + b11 * wx) * wy;
        const v = (data[i + c] * paperWhite) / Math.max(8, bv);
        d[i + c] = v > 255 ? 255 : v;
      }
      d[i + 3] = 255;
    }
  }
  return out;
}

function maxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          const v = src[(y * w + xx) * 3 + c];
          if (v > m) m = v;
        }
        tmp[(y * w + x) * 3 + c] = m;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          const v = tmp[(yy * w + x) * 3 + c];
          if (v > m) m = v;
        }
        out[(y * w + x) * 3 + c] = m;
      }
    }
  }
  return out;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += src[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 3 + c];
        tmp[(y * w + x) * 3 + c] = s / n;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 3 + c];
        out[(y * w + x) * 3 + c] = s / n;
      }
    }
  }
  return out;
}

export function toGreyImage(img: ImageData): ImageData {
  const g = toGrey(img);
  const out = new ImageData(img.width, img.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    out.data[i] = out.data[i + 1] = out.data[i + 2] = g[j];
    out.data[i + 3] = 255;
  }
  return out;
}

/**
 * Sauvola local threshold via integral images: T = m * (1 + k * (s / R - 1)).
 * Run it AFTER normalisation; that removes most of the parameter sensitivity.
 */
export function binarizeSauvola(img: ImageData, window = 31, k = 0.3, R = 128): ImageData {
  const { width: w, height: h } = img;
  const g = toGrey(img);
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sum2 = new Float64Array(W * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rs = 0;
    let rs2 = 0;
    for (let x = 1; x <= w; x++) {
      const v = g[(y - 1) * w + (x - 1)];
      rs += v;
      rs2 += v * v;
      sum[y * W + x] = sum[(y - 1) * W + x] + rs;
      sum2[y * W + x] = sum2[(y - 1) * W + x] + rs2;
    }
  }
  const r = Math.floor(window / 2);
  const out = new ImageData(w, h);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      const s2 = sum2[y1 * W + x1] - sum2[y0 * W + x1] - sum2[y1 * W + x0] + sum2[y0 * W + x0];
      const mean = s / n;
      const sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      const t = mean * (1 + k * (sd / R - 1));
      const v = g[y * w + x] > t ? 255 : 0;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Pick colour, grey or black-and-white for a normalised page. Colour when a
 * meaningful share of pixels carry chroma; black-and-white when the luma
 * histogram is strongly two-peaked (clean print); grey otherwise.
 * Cards always come back colour: security print and the photo matter.
 */
export function chooseMode(img: ImageData, isCard: boolean): Exclude<EnhanceMode, 'auto'> {
  if (isCard) return 'color';
  const { data } = img;
  const n = data.length / 4;
  let chroma = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) > 28) chroma++;
    hist[(r * 77 + g * 151 + b * 28) >> 8]++;
  }
  if (chroma / n > 0.015) return 'color';
  // Otsu between-class variance as a bimodality signal.
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  let near = 0;
  for (let v = 0; v < 256; v++) if (Math.abs(v - bestT) > 25) near += hist[v];
  return near / n > 0.9 ? 'bw' : 'grey';
}

export function applyMode(normalized: ImageData, mode: Exclude<EnhanceMode, 'auto'>): ImageData {
  if (mode === 'color') return normalized;
  if (mode === 'grey') return toGreyImage(normalized);
  return binarizeSauvola(normalized);
}
