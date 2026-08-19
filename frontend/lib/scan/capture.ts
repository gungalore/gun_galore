'use client';

import { DETECT_WIDTH, Gray, detectQuad, inkiness, toLuma } from './detect';
import { EnhanceReport, enhance, inspect } from './enhance';
import {
  Quad,
  Rect,
  frameQuad,
  outputSize,
  quadBounds,
  scaleQuad,
} from './geometry';
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
 * THE PART OF THE VIDEO THE MEMBER CAN ACTUALLY SEE.
 *
 * ⚠️ THE BUG THIS FUNCTION EXISTS TO KILL. The preview is `object-fit: cover`
 * in a portrait box, so a landscape camera track is cropped hard at the sides
 * before it reaches the screen. Both the detector and the shutter used the
 * WHOLE track — so the member framed a card in a portrait window while we
 * hunted rectangles in a wider scene they had never seen, and captured that
 * scene too. On a real desk it found a tall slice of mousepad and cropped to
 * it, which is exactly what the operator's screenshot showed.
 *
 * Everything downstream now works in THIS rectangle. What you frame is what
 * gets detected, marked, captured and read.
 */
export interface VisibleRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function visibleRect(video: HTMLVideoElement): VisibleRect | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const cw = video.clientWidth || vw;
  const ch = video.clientHeight || vh;
  // object-fit: cover — the larger scale wins and the overflow is trimmed
  // evenly on both sides.
  const scale = Math.max(cw / vw, ch / vh);
  const sw = Math.min(vw, cw / scale);
  const sh = Math.min(vh, ch / scale);
  return {
    sx: (vw - sw) / 2,
    sy: (vh - sh) / 2,
    sw,
    sh,
  };
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
  const vis = visibleRect(video);
  if (!vis) return null;
  const w = scratch.canvas.width;
  const h = scratch.canvas.height;
  scratch.drawImage(video, vis.sx, vis.sy, vis.sw, vis.sh, 0, 0, w, h);
  const img = scratch.getImageData(0, 0, w, h);
  return toLuma(img.data, w, h);
}

/** A scratch context sized for detection, matching the VISIBLE aspect. */
export function makeScratch(vw: number, vh: number): CanvasRenderingContext2D {
  const w = DETECT_WIDTH;
  const h = Math.max(1, Math.round((vh / Math.max(1, vw)) * w));
  return ctx2d(w, h);
}

/**
 * The visible region as a full-resolution JPEG — the shutter.
 *
 * Not the whole track: see visibleRect. Quality 0.95 because this is the
 * image a vision model has to read small print off, and the file is thrown
 * away as soon as it has been rectified.
 */
export async function grabVisible(
  video: HTMLVideoElement,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const vis = visibleRect(video);
  if (!vis) return null;
  const w = Math.round(vis.sw);
  const h = Math.round(vis.sh);
  const g = ctx2d(w, h);
  g.drawImage(video, vis.sx, vis.sy, vis.sw, vis.sh, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) =>
    g.canvas.toBlob(res, 'image/jpeg', 0.95),
  );
  return blob ? { blob, width: w, height: h } : null;
}

/**
 * Does a detection agree with where the member said the document is?
 *
 * ⚠️ NOT INTERSECTION-OVER-UNION, and that was measured rather than assumed.
 * The operator's carpet strip — a tall rectangle holding his licence card and
 * a foot of blue blanket — scores 0.35 IoU against the card box, comfortably
 * above any threshold loose enough to tolerate a handheld shot. IoU cannot
 * separate them because it mixes two different failures into one number.
 *
 * Split apart, they are obvious:
 *
 *   COVERAGE — how much of the box the detection fills. A fragment sitting
 *   inside the card (one printed table, say) covers almost none of it.
 *
 *   SPILL — how much of the detection hangs outside the box. The carpet strip
 *   covers 72% of the box, which sounds fine, but 60% of the strip is
 *   somewhere else entirely. A card lined up in the corners spills nothing.
 *
 * A handheld shot that is 30px adrift passes both comfortably, which is the
 * point: this rejects "you found the carpet", not "your corners are a few
 * pixels out".
 */
const AIM_MIN_COVER = 0.5;
const AIM_MAX_SPILL = 0.35;

export function detectionAgreesWithAim(detected: Quad, box: Rect): boolean {
  const b = quadBounds(detected);
  const ix = Math.max(
    0,
    Math.min(b.x + b.width, box.x + box.width) - Math.max(b.x, box.x),
  );
  const iy = Math.max(
    0,
    Math.min(b.y + b.height, box.y + box.height) - Math.max(b.y, box.y),
  );
  const inter = ix * iy;
  const qa = b.width * b.height;
  const ba = box.width * box.height;
  if (qa <= 0 || ba <= 0) return false;
  const cover = inter / ba;
  const spill = 1 - inter / qa;
  return cover >= AIM_MIN_COVER && spill <= AIM_MAX_SPILL;
}

/** The aim box as a quad, corners in the same order the warp expects. */
function rectToQuad(r: Rect): Quad {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
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
  /**
   * 'aim' means the member's own box was used because detection disagreed
   * with it — see the note in processCapture.
   */
  source: 'detected' | 'frame' | 'manual' | 'aim';
  report: EnhanceReport;
  snapped: string | null;
  /** Long edge of the frame this came from, in pixels. */
  sourceEdge: number;
  /**
   * The UNCROPPED capture, as a data URL, and its size.
   *
   * ⚠️ THE CORNER EDITOR NEEDS THE WHOLE PICTURE. It used to be handed the
   * rectified output — which is the crop, so a corner in the wrong place was
   * invisible in the only image the member could see. `quad` is in these
   * coordinates.
   */
  sourcePreview: string;
  sourceSize: { width: number; height: number };
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
  opts: {
    manualQuad?: Quad;
    name?: string;
    expectAspect?: number;
    /**
     * Where the member was asked to put the document, as FRACTIONS of the
     * image — x, y, width and height all 0 to 1.
     *
     * ⚠️ NORMALISED, NOT PIXELS, and that is the whole point. The first
     * version took pixels of the captured frame, and `decode` below quietly
     * shrinks anything over 3000px on its long edge — so on a 4K phone the
     * box was applied to a raster a third smaller than the one it was
     * measured against. It came out over-scaled and shifted down and right:
     * the operator's card lost its top edge and gained a hand's width of
     * carpet underneath. Fractions cannot drift, whatever anything downstream
     * decides to rescale.
     *
     * ⚠️ IT OVERRULES A DISAGREEING DETECTION. Nothing in the image says
     * which rectangle is the licence. The member does, by putting it in the
     * box, and pressing the shutter while it is there is them saying so.
     */
    aimBox?: Rect;
  } = {},
): Promise<ScanResult> {
  const raster = await decode(source);

  let quad = opts.manualQuad ?? null;
  let from: ScanResult['source'] = opts.manualQuad ? 'manual' : 'frame';

  // Fractions into this raster's own pixels, once, here — so everything below
  // is talking about the same image.
  const aim = opts.aimBox
    ? {
        x: opts.aimBox.x * raster.width,
        y: opts.aimBox.y * raster.height,
        width: opts.aimBox.width * raster.width,
        height: opts.aimBox.height * raster.height,
      }
    : null;

  if (!quad) {
    // Detect on a small copy, then scale the corners back up.
    const small = shrinkForDetect(raster);
    const found = detectQuad(small.gray, { expectAspect: opts.expectAspect });
    if (found) {
      const scaled = found.quad.map((p) => ({
        x: p.x / small.scale,
        y: p.y / small.scale,
      })) as Quad;
      // ⚠️ DOES IT AGREE WITH WHERE THEY PUT IT? A detection that has nothing
      // to do with the aim box is a detection of the desk, and cropping to it
      // throws the document away. The threshold is loose — this rejects "you
      // found the carpet", not "your corners are a few pixels out".
      const agree = !aim || detectionAgreesWithAim(scaled, aim);
      if (agree) {
        quad = scaled;
        from = 'detected';
      } else {
        quad = rectToQuad(aim!);
        from = 'aim';
      }
    } else if (aim) {
      // ⚠️ THE BOX BEATS THE WHOLE FRAME. Falling back to a 5%-inset frame
      // quad means cropping to everything the camera could see, which on a
      // desk is a photograph of the desk. If they lined it up and we simply
      // could not find an edge, the box is still the best answer we have.
      quad = rectToQuad(aim);
      from = 'aim';
    } else {
      quad = frameQuad(raster.width, raster.height, 0.05);
      from = 'frame';
    }
  }

  // ⚠️ A HAIR OF MARGIN, so the crop can never eat the document.
  //
  // Detection lands on the centre of the border ridge, which for a card with a
  // printed edge is a pixel or two INSIDE the paper — and the operator's own
  // scan came back with the top of "Licence To Possess a Firearm" shaved off.
  // A sliver of desk around the edge costs a vision model nothing; a missing
  // line of text costs it the field. Skipped for a manual quad: if somebody
  // has dragged the corners themselves, those are the corners they meant.
  const cropQuad = opts.manualQuad ? quad : scaleQuad(quad, 1.02);


  const { w, h, snapped } = outputSize(cropQuad, OUTPUT_MAX_EDGE);
  const flat = rectify(raster, cropQuad, w, h);
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
    sourceEdge: Math.max(raster.width, raster.height),
    sourcePreview: await previewUrl(raster, 1200),
    sourceSize: { width: raster.width, height: raster.height },
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
  } else if (r.sourceEdge < 1400) {
    // ⚠️ THE CAMERA STREAM IS NOT THE STILL CAMERA. A browser gives us video
    // frames, and on many phones that is 1080p or less against a 48-megapixel
    // stills sensor. It is enough for a licence card filling the frame; it is
    // not enough for a card photographed from across a desk. Saying so is
    // better than handing over something unreadable.
    out.push(
      'The camera gave us a small image, so fine print may not read. Filling more of the frame with the document, or choosing a file taken with your normal camera app, will be sharper.',
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
