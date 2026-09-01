import type { ScanResult } from './capture';
import { previewUrl, toFile } from './capture';
import type { Raster } from './warp';

// ────────────────────────────────────────────────────────────────────
// TURNING A FINISHED PAGE A QUARTER TURN.
//
// ⚠️ THIS RE-ENCODES THE FILE, IT DOES NOT SET A CSS TRANSFORM. The file is
// what gets stored and read from a computer months later; rotating only the
// preview would show the member an upright page and save a sideways one —
// the worst possible split between what was approved and what was kept.
//
// ⚠️ AND IT TURNS `flat` TOO. flat is the un-enhanced rectified page kept so
// the filter can be changed without re-photographing. Leaving it unrotated
// means switching from "remove shadows" to "no filter" silently un-rotates the
// document, which is a bug nobody would think to look for.
// ────────────────────────────────────────────────────────────────────

/** Rotate a raster by a quarter turn. Positive is clockwise. */
export function rotateRaster(r: Raster, quarters: number): Raster {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return r;
  const { width: w, height: h, data } = r;
  const swap = q === 1 || q === 3;
  const nw = swap ? h : w;
  const nh = swap ? w : h;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (q === 1) {
        nx = h - 1 - y;
        ny = x;
      } else if (q === 2) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      const si = (y * w + x) * 4;
      const di = (ny * nw + nx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: nw, height: nh };
}

/**
 * Turn a finished scan, returning the fields that change.
 *
 * Rebuilds the file and preview from the rotated pixels, and carries `flat`
 * round with them so a later filter change stays upright.
 */
export async function rotateResult(
  r: ScanResult,
  degrees: number,
): Promise<{
  file: File;
  preview: string;
  flat: Raster;
  outputWidth: number;
  outputHeight: number;
}> {
  const quarters = Math.round(degrees / 90);
  const flat = rotateRaster(r.flat, quarters);
  // The stored page is the ENHANCED one, so rotate what was actually saved
  // rather than re-running enhancement — re-enhancing on every turn would
  // compound the flattening a little more each time.
  const shown = await decodeFile(r.file);
  const turned = shown ? rotateRaster(shown, quarters) : flat;
  return {
    file: await toFile(turned, r.file.name),
    preview: await previewUrl(turned),
    flat,
    outputWidth: turned.width,
    outputHeight: turned.height,
  };
}

/** Decode a File back to pixels. Null when the browser refuses it. */
async function decodeFile(f: File): Promise<Raster | null> {
  try {
    const bmp = await createImageBitmap(f);
    const c =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(bmp.width, bmp.height)
        : Object.assign(document.createElement('canvas'), {
            width: bmp.width,
            height: bmp.height,
          });
    const g = (c as HTMLCanvasElement).getContext('2d');
    if (!g) return null;
    g.drawImage(bmp as unknown as CanvasImageSource, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close?.();
    return { data: d.data, width: d.width, height: d.height };
  } catch {
    return null;
  }
}
