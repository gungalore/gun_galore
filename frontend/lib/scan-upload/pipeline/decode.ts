/**
 * Decode a picked or captured file into pixels. Respects the EXIF orientation
 * (phones store photos sideways), caps the size so iOS Safari does not run
 * out of canvas memory, and passes PDFs through untouched.
 */
export type Decoded =
  | { kind: 'image'; image: ImageData; width: number; height: number }
  | { kind: 'pdf' }
  | { kind: 'unsupported' };

/** Longest edge we keep after decoding. 4096 px is about 12 MP for 3:4, safe on iOS. */
export const DECODE_MAX_EDGE = 4096;

export async function decodeFile(file: File | Blob, maxEdge = DECODE_MAX_EDGE): Promise<Decoded> {
  const type = file.type || '';
  if (type === 'application/pdf' || (file instanceof File && /\.pdf$/i.test(file.name))) return { kind: 'pdf' };
  if (type && !type.startsWith('image/')) return { kind: 'unsupported' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers refuse the option or the format (HEIC on Android Chrome).
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return { kind: 'unsupported' };
    }
  }
  try {
    return { kind: 'image', ...bitmapToImageData(bitmap, maxEdge) };
  } finally {
    bitmap.close();
  }
}

export function bitmapToImageData(bitmap: ImageBitmap, maxEdge: number): { image: ImageData; width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = scratchCanvas(0, width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { image: ctx.getImageData(0, 0, width, height), width, height };
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Scratch canvases, reused. iOS Safari caps total canvas memory (a few hundred
 * MB) and blanks canvases and video when it is exceeded; a fresh canvas per
 * resize or encode piles up faster than it is collected. Two scratch surfaces
 * are enough for a draw-from-one-into-the-other resize. Callers must finish
 * with the pixels before the next call.
 */
const scratch: (HTMLCanvasElement | OffscreenCanvas)[] = [];
export function scratchCanvas(slot: 0 | 1, width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  let c = scratch[slot];
  if (!c) {
    c = makeCanvas(width, height);
    scratch[slot] = c;
  } else if (c.width !== width || c.height !== height) {
    c.width = width;
    c.height = height;
  }
  return c;
}

/** Drop the scratch canvases (e.g. when the scanner closes). */
export function releaseScratch(): void {
  for (const c of scratch) {
    if (c) {
      c.width = 1;
      c.height = 1;
    }
  }
  scratch.length = 0;
}

/** Draw ImageData onto scratch slot 0 (for previews and encoding). Valid until the next scratch use. */
export function imageDataToCanvas(img: ImageData): HTMLCanvasElement | OffscreenCanvas {
  const canvas = scratchCanvas(0, img.width, img.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Downscale ImageData by drawing through a canvas (fast, browser-native). */
export function resizeImageData(img: ImageData, maxEdge: number): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  if (scale === 1) return img;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const src = imageDataToCanvas(img);
  const dst = scratchCanvas(1, width, height);
  const ctx = dst.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(src as CanvasImageSource, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** Decode an encoded image (e.g. a sealed page's JPEG) back to pixels for display. */
export async function decodeBlob(blob: Blob, maxEdge: number): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  try {
    return bitmapToImageData(bmp, maxEdge).image;
  } finally {
    bmp.close();
  }
}
