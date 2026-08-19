'use client';

import { DETECT_WIDTH, Gray, detectQuad, inkiness, toLuma } from './detect';
import { EnhanceReport, enhance, inspect } from './enhance';
import { Quad, frameQuad, outputSize } from './geometry';
import { Raster, rectify } from './warp';

// ────────────────────────────────────────────────────────────────────
// THE BROWSER HALF.
//
// Everything impure lives here: canvases, video frames, blobs. The modules
// beside it are pure and tested; this file is the thin, boring glue that feeds
// them, and it is kept thin ON PURPOSE — anything with logic in it belongs
// next door where a test can reach it.
// ────────────────────────────────────────────────────────────────────

/** Longest edge of the rectified output. */
export const OUTPUT_MAX_EDGE = 2000;

/** JPEG quality. High enough that the model is not reading our artefacts. */
const JPEG_QUALITY = 0.88;

function ctx2d(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('This browser will not give us a canvas.');
  return g;
}

/**
 * One video frame as a small luma buffer, for the live detector.
 *
 * ⚠️ THE READBACK IS THE EXPENSIVE PART, not the detection. getImageData is
 * 2-5ms on a mid-range phone whatever size you ask for, which is why the frame
 * is drawn small rather than drawn full and shrunk afterwards.
 */
export function frameToGray(
  video: HTMLVideoElement,
  scratch: CanvasRenderingContext2D,
): Gray | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const w = scratch.canvas.width;
  const h = scratch.canvas.height;
  scratch.drawImage(video, 0, 0, w, h);
  const img = scratch.getImageData(0, 0, w, h);
  return toLuma(img.data, w, h);
}

/** A scratch context sized for detection, given the video's aspect. */
export function makeScratch(vw: number, vh: number): CanvasRenderingContext2D {
  const w = DETECT_WIDTH;
  const h = Math.max(1, Math.round((vh / Math.max(1, vw)) * w));
  return ctx2d(w, h);
}

/** Decode a blob or file into raw pixels, capped so a 108MP phone cannot OOM us. */
export async function decode(
  source: Blob,
  maxEdge = 3000,
): Promise<Raster> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const g = ctx2d(w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const img = g.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}

/**
 * Put a raster onto a context.
 *
 * Via createImageData rather than `new ImageData(data, w, h)`: the constructor
 * insists on an ArrayBuffer-backed array, and a Uint8ClampedArray that has
 * been passed around is typed as backed by ArrayBufferLike. Copying into a
 * context-owned buffer sidesteps the whole question.
 */
function paint(g: CanvasRenderingContext2D, r: Raster): void {
  const img = g.createImageData(r.width, r.height);
  img.data.set(r.data);
  g.putImageData(img, 0, 0);
}

/** Raster back to a JPEG File, ready for the existing upload paths. */
export async function toFile(r: Raster, name: string): Promise<File> {
  const g = ctx2d(r.width, r.height);
  paint(g, r);
  const blob = await new Promise<Blob | null>((res) =>
    g.canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('We could not save that photo.');
  return new File([blob], name, { type: 'image/jpeg' });
}

/** A JPEG data URL for the review step, at a size a phone can paint cheaply. */
export async function previewUrl(r: Raster, maxEdge = 900): Promise<string> {
  const scale = Math.min(1, maxEdge / Math.max(r.width, r.height));
  const w = Math.max(1, Math.round(r.width * scale));
  const h = Math.max(1, Math.round(r.height * scale));
  const src = ctx2d(r.width, r.height);
  paint(src, r);
  const dst = ctx2d(w, h);
  dst.drawImage(src.canvas, 0, 0, w, h);
  return dst.canvas.toDataURL('image/jpeg', 0.82);
}

export interface ScanResult {
  file: File;
  preview: string;
  quad: Quad;
  /** Did we find the edges, or fall back to the frame? */
  source: 'detected' | 'frame' | 'manual';
  report: EnhanceReport;
  snapped: string | null;
  /**
   * Fraction of the crop carrying print.
   *
   * ⚠️ LOW MEANS WE MAY HAVE CROPPED THE WRONG THING. A document lying on a
   * mat or a folder gives that surface a stronger border than the document
   * has, and the detector can take the mat instead. We cannot reliably tell
   * the two apart yet — but we CAN notice that what we cropped has almost no
   * print on it, and say so.
   */
  ink: number;
}

/**
 * The whole capture pipeline: find the document, square it up, even out the
 * light, and hand back a file.
 *
 * `manualQuad` skips detection entirely — that is the re-run after somebody
 * drags a corner, and re-detecting there would silently undo their correction.
 */
export async function processCapture(
  source: Blob,
  opts: { manualQuad?: Quad; name?: string; expectAspect?: number } = {},
): Promise<ScanResult> {
  const raster = await decode(source);

  let quad = opts.manualQuad ?? null;
  let from: ScanResult['source'] = opts.manualQuad ? 'manual' : 'frame';

  if (!quad) {
    // Detect on a small copy, then scale the corners back up.
    const small = shrinkForDetect(raster);
    const found = detectQuad(small.gray, { expectAspect: opts.expectAspect });
    if (found) {
      quad = found.quad.map((p) => ({
        x: p.x / small.scale,
        y: p.y / small.scale,
      })) as Quad;
      from = 'detected';
    } else {
      quad = frameQuad(raster.width, raster.height, 0.05);
      from = 'frame';
    }
  }

  const { w, h, snapped } = outputSize(quad, OUTPUT_MAX_EDGE);
  const flat = rectify(raster, quad, w, h);
  if (!flat) throw new Error('We could not straighten that one.');

  const better = enhance(flat);
  const report = inspect(better);
  const ink = inkiness(
    toLuma(better.data, better.width, better.height),
    frameQuad(better.width, better.height, 0),
  );

  return {
    file: await toFile(better, opts.name ?? `scan-${Date.now()}.jpg`),
    preview: await previewUrl(better),
    quad,
    source: from,
    report,
    snapped,
    ink,
  };
}

function shrinkForDetect(r: Raster): { gray: Gray; scale: number } {
  const scale = Math.min(1, DETECT_WIDTH / Math.max(1, r.width));
  if (scale === 1) {
    return { gray: toLuma(r.data, r.width, r.height), scale: 1 };
  }
  const w = Math.max(1, Math.round(r.width * scale));
  const h = Math.max(1, Math.round(r.height * scale));
  const src = ctx2d(r.width, r.height);
  paint(src, r);
  const dst = ctx2d(w, h);
  dst.drawImage(src.canvas, 0, 0, w, h);
  const img = dst.getImageData(0, 0, w, h);
  return { gray: toLuma(img.data, w, h), scale };
}

/**
 * What is worth saying about a capture, in the member's words.
 *
 * ⚠️ THIS IS THE HONEST HALF OF THE FEATURE. We cannot recover a blown
 * highlight or a photograph taken while the lens was still hunting. What we
 * can do is notice, and say so, and let them take it again — which fixes it
 * completely and costs three seconds.
 */
export function verdicts(r: ScanResult): string[] {
  const out: string[] = [];
  if (r.report.glare > 0.015) {
    out.push(
      'There is a glare on it. Tilting the phone a little, or moving out from under the light, will clear it.',
    );
  }
  if (r.report.sharpness < 3.5) {
    out.push(
      'This one came out soft. Holding still for a moment before you tap will read better.',
    );
  }
  if (r.report.meanLuma < 55) {
    out.push('It is quite dark. More light on the document will help.');
  }
  if (r.source === 'frame') {
    out.push(
      'We could not find the edges, so we used the frame. Check the corners and drag them if they are wrong.',
    );
  } else if (r.ink < 0.06) {
    // Almost no print in what we cropped — most often the mat or folder the
    // document was lying on, whose edge is stronger than the document's own.
    out.push(
      'There is very little writing in this crop, so we may have caught the mat or folder underneath instead of the document. Worth a look before you use it.',
    );
  }
  return out;
}
