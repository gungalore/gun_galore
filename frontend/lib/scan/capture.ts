'use client';

import { DETECT_WIDTH, Gray, detectQuad, inkiness, toLuma } from './detect';
import { EnhanceReport, enhance, inspect } from './enhance';
import { Quad, Rect, frameQuad, outputSize, scaleQuad } from './geometry';
import { Raster, rectify } from './warp';
import { blur3, seededCorners } from './edges';
import { DETECT_ACCEPT } from './detect-client';
import { letterboxFor } from './letterbox';
import { analyseMask } from './mask-quad';
import { bestCandidate } from './quad-score';
import { refineEdges } from './refine-edges';

/**
 * How sure the seeded detector must be before its corners replace the box.
 *
 * ⚠️ DELIBERATELY HIGH. Being wrong here costs the member the thing the aim
 * box guaranteed — a starting position that never moves and never has to be
 * checked. Declining costs them nothing they were not already paying.
 */
const SEED_CONFIDENCE = 0.55;

/**
 * How much edge support a MASK-derived quad must show before it may crop.
 *
 * Measured against the synthetic scenes in quad-score.spec.ts: a quad sitting
 * on real document edges scores above 0.9 on its worst side, a quad with one
 * side running through open page scores below 0.3, and a quad over empty desk
 * below 0.15. 0.5 sits in the gap with room either way.
 *
 * ⚠️ STILL NOT MEASURED ON REAL CAPTURES. This is a reasoned floor placed in a
 * gap that synthetic fixtures showed, not a threshold earned the way
 * DETECT_ACCEPT was. It is deliberately conservative: too high costs the mask
 * rung some wins and falls back to the behaviour that shipped before it, which
 * is a known-good outcome rather than a new failure.
 */
const MASK_MIN_SUPPORT = 0.5;

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
  // ⚠️ NO imageSmoothingQuality:'high' HERE, AND IT WAS TRIED. A 6.75:1
  // downscale on the default 'low' filter aliases badly, so asking the canvas
  // for a real resample looked like the fix. Measured on the operator's
  // Samsung S23 it did two things: it did not reduce the aliasing at all
  // (WebKit and Blink honour the hint very differently), and it pushed the
  // frame budget from 52ms on his iPhone to 172ms on the Samsung — past the
  // 90ms mark where the loop drops the detector, which is why his aim frame
  // never locked and the corner markers never appeared on that phone.
  //
  // The aliasing is dealt with where it can be done in our own arithmetic
  // instead: frame-stats' `coarsen` box-averages the aim box down before the
  // motion measure compares anything. The same panel that showed the frame
  // cost also showed that working — motion 3.86 against 14.05 before
  // coarsening — so the browser hint was paying nothing for a third of the
  // frame rate.
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
  // ⚠️ COVER MATHS, AND THE ELEMENT MUST ACTUALLY BE object-fit: cover.
  // The larger scale wins and the overflow is trimmed evenly on both sides.
  //
  // This is not a preference, it is a contract. Everything downstream maps
  // through this function — the detection buffer, the tracked quad, the
  // occupancy the on-screen guidance is derived from, and the capture crop —
  // so pointing it at a `contain` element does not merely misreport the
  // region, it corrupts every coordinate in the scanner at once, without
  // throwing. That happened: the preview was switched to contain for one
  // deploy and the live box vanished while every number in the diagnostics
  // panel still looked healthy.
  //
  // If the preview ever needs `contain`, this function takes a mode argument
  // — it does not get inferred.
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

/**
 * Which cleanup ran. Named for what the member sees, not for the code path.
 *
 * ⚠️ 'shadow' IS enhance()'s `flatten`, WHICH HAS ALWAYS BEEN ON. Illumination
 * division was built here long before anyone asked for a filter menu — what
 * was missing was never the algorithm, only the choice. Exposing it costs an
 * option and no new maths.
 *
 * The choice matters because flattening is not always wanted: it decides what
 * counts as paper and lifts everything towards it, which is right for a
 * shadowed page and wrong when somebody needs the original tones — a
 * photograph on an ID, a coloured security print, anything where the question
 * later is "what did this actually look like".
 */
export type ScanFilter = 'shadow' | 'none';

export interface ScanResult {
  file: File;
  preview: string;
  /**
   * The rectified page BEFORE any cleanup, kept so the filter can be changed
   * without photographing it again.
   *
   * ⚠️ FULL RESOLUTION, SO RELEASE IT. An A4 at scanning resolution is tens of
   * megabytes as RGBA; holding several is how a phone browser gets killed. The
   * scanner drops it when the page leaves review.
   */
  flat: Raster;
  /** Which cleanup produced `file` and `preview`. */
  filter: ScanFilter;
  /**
   * The rectified page's pixel size.
   *
   * ⚠️ NEEDED TO MEASURE dpi AFTER THE FACT. The live readout computes dpi off
   * the tracked quad, but a page that arrived from the gallery never had a
   * tracked quad — the only way to know its resolution is the output size
   * against the document's known millimetres.
   */
  outputWidth: number;
  outputHeight: number;
  /** What the mask rung made of the frame. Absent when no mask was supplied. */
  maskFit?: {
    coverage: number;
    aspect: number;
    residual: number;
    rectangularity: number;
    reject?: string;
  };
  /** Which candidate the arbitration chose, and on what score. */
  pickedBy?: 'corners' | 'mask';
  arbitration?: { worstSide: number; support: number };
  /** How far sub-pixel refinement moved the worst corner, and sides skipped. */
  refined?: { moved: number; skipped: number };
  quad: Quad;
  /** Did we find the edges, or fall back to the frame? */
  /**
   * 'aim' means the member's own box was used because detection disagreed
   * with it — see the note in processCapture.
   */
  source: 'detected' | 'frame' | 'manual' | 'aim';
  /**
   * What the seeded corner search made of it, when there was an aim box to
   * seed from. Present even when it declined — that is the interesting case.
   */
  seed?: {
    confidence: number;
    /** top, bottom, left, right. */
    hits: number[];
    residuals: number[];
  };
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
    /**
     * What the server's model found, as FRACTIONS of the image, plus how sure
     * it was. Optional and always safe to omit — offline, timed out, model
     * unavailable, low confidence: all of them arrive here as `undefined` and
     * the aim box takes over exactly as it did before this existed.
     *
     * ⚠️ FRACTIONS, for the same reason aimBox is. The server answers in the
     * pixels of the image it was handed; `decode` below shrinks anything over
     * 3000px on its long edge, so those two pixel counts are different numbers
     * for the same corner on a 4K phone. detect-client normalises at the
     * boundary; this multiplies back up against the raster we actually got.
     */
    detected?: { quad: Quad; minConfidence: number };
    name?: string;
    expectAspect?: number;
    /**
     * The model's 64x64 mask plane, when the detector returned one.
     *
     * Feeds the mask rung below. Absent on an older server, which simply means
     * the ladder behaves exactly as it did before.
     */
    mask?: Float32Array;
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
  // ⚠️ REPORTED EVEN WHEN IT DECLINES — ESPECIALLY WHEN IT DECLINES. Both of
  // the operator's phones came back "last crop: aim", meaning the detector
  // refused every time, and a refusal with no numbers beside it is
  // indistinguishable from a detector that never ran.
  let seedReport: ScanResult['seed'] = undefined;
  let maskReport: ScanResult['maskFit'] = undefined;
  let pickedBy: 'corners' | 'mask' | undefined;
  let arbitration: { worstSide: number; support: number } | undefined;
  let refineReport: ScanResult['refined'] = undefined;

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

  // ⚠️ A CONFIDENT MODEL OUTRANKS THE BOX. NOTHING ELSE DOES.
  //
  // The note below records why the box won every argument before this: every
  // detector tried produced guesses that were nearly right, and a nearly-right
  // guess still has to be checked on all four sides, which costs more than
  // dragging from a position that never moves. That objection was exactly
  // right, and it was about detectors that could not say how sure they were.
  //
  // This one can, and it was measured on fifteen photographs of the operator's
  // own licence card: on the four it genuinely cannot do — a white card on
  // white paper — its weakest corner scores 0.06 to 0.43, and on all eleven it
  // gets right, 0.83 to 0.95. Nothing lands in between. So above the threshold
  // the corners open already on the document; below it, and on every failure
  // of the network or the model, the member gets precisely what they got
  // before. The box did not lose its argument; it became the fallback for a
  // detector that knows when to shut up.
  // ── THE MODEL'S TWO ANSWERS, JUDGED AGAINST THE PHOTOGRAPH ─────────
  //
  // ⚠️ THE CORNER HEADS AND THE MASK ARE DIFFERENT CLAIMS, AND NEITHER IS
  // AUTOMATICALLY RIGHT. The heads always emit four peaks — four planes, each
  // with a maximum — so a confident quad is not evidence that a document is
  // there, only that the argmax landed somewhere. The mask can be empty, and
  // fitting lines to its boundary finds the corner of a ROUNDED document,
  // which no peak ever sits on.
  //
  // So both are offered as CANDIDATES and arbitration picks on evidence in the
  // source image: does a real intensity step actually run along each side. The
  // worst side decides — three good edges and one running through open page is
  // the spine-straddling failure, and it averages to a respectable score.
  //
  // This is why adding the mask rung is safe to ship before its own gates are
  // measured: it can only WIN by out-scoring the corner path on the
  // photograph, never by asserting itself.
  if (!quad) {
    const candidates: { quad: Quad; from: 'corners' | 'mask' }[] = [];
    if (opts.detected && opts.detected.minConfidence >= DETECT_ACCEPT) {
      candidates.push({
        quad: opts.detected.quad.map((p) => ({
          x: p.x * raster.width,
          y: p.y * raster.height,
        })) as unknown as Quad,
        from: 'corners',
      });
    }
    if (opts.mask) {
      const lb = letterboxFor(raster.width, raster.height);
      const m = analyseMask(opts.mask, lb);
      maskReport = {
        coverage: Math.round(m.coverage * 100) / 100,
        aspect: Math.round(m.aspect * 100) / 100,
        residual: Number.isFinite(m.residual) ? Math.round(m.residual * 10) / 10 : -1,
        rectangularity: Math.round(m.rectangularity * 100) / 100,
        reject: m.reject,
      };
      if (m.quad) candidates.push({ quad: m.quad, from: 'mask' });
    }

    // ⚠️ EVERY CANDIDATE IS SCORED, INCLUDING A LONE ONE. The first version of
    // this took `candidates.length === 1` straight through with no scoring at
    // all, and that is a regression the operator found within an hour: when the
    // corner heads DECLINE — below DETECT_ACCEPT — the mask became the only
    // candidate and won unvalidated, bypassing the aim-box path that used to
    // handle exactly that case.
    //
    // It broke by document type, which is what made it confusing: a licence
    // card's corners score 0.83-0.95 so there were always two candidates and
    // arbitration ran, while an A4 and an ID book decline more often and got
    // the unchecked mask. "Auto capture fucked on ID and A4" is that sentence
    // in the operator's words.
    //
    // The arbitration built to make the mask rung safe only ran when there was
    // something to arbitrate. Scoring is not a tie-break; it is the admission
    // test.
    if (candidates.length > 0) {
      const small = shrinkForDetect(raster);
      const pick = bestCandidate(
        small.gray,
        candidates.map((c) => ({
          ...c,
          quad: c.quad.map((p) => ({
            x: p.x * small.scale,
            y: p.y * small.scale,
          })) as Quad,
        })),
        undefined,
        { x0: 0, y0: 0, x1: small.gray.width, y1: small.gray.height },
      );
      const chosen = pick ? candidates.find((c) => c.from === pick.pick.from) : null;
      if (pick && chosen) {
        arbitration = {
          worstSide: Math.round(pick.score.worstSide * 100) / 100,
          support: Math.round(pick.score.support * 100) / 100,
        };
        // ⚠️ THE FLOOR APPLIES TO THE MASK RUNG ONLY. The corner path has
        // earned its threshold: DETECT_ACCEPT was set from fifteen photographs
        // where the weakest corner scored 0.06-0.43 on failures and 0.83-0.95
        // on successes, with nothing in between. Putting a second, unmeasured
        // gate in front of it would be re-deciding a settled question with
        // worse evidence.
        //
        // The mask rung has no such history, so it must show that a real
        // intensity step runs along its weakest side before it may crop a
        // statutory document. Below the floor, nothing is chosen and the
        // ladder falls through to the aim box exactly as it did before this
        // rung existed.
        const needsProof = chosen.from === 'mask';
        if (!needsProof || pick.score.worstSide >= MASK_MIN_SUPPORT) {
          quad = chosen.quad;
          from = 'detected';
          pickedBy = chosen.from;
        }
      }
    }
  }

  if (!quad) {
    if (aim) {
      // ⚠️ THE BOX. EXACTLY THE BOX. NOTHING ELSE.
      //
      // This branch used to be a ladder: detect, check the detection against
      // the box, refine the box onto nearby edges, fall back. Every rung was
      // built to fix the rung before it, and every rung put the editor's
      // starting corners somewhere the member had to STUDY before they could
      // trust — because a guess that is nearly right still has to be checked
      // on all four sides, and checking costs more than dragging.
      //
      // The operator ended the argument: the flow is manual capture into the
      // corner editor, and the corners must open exactly on the aim box's
      // margins, every time. A starting position that never moves is one the
      // member stops having to check at all — they lined the document up
      // against those very corners a second ago, so the drag distance is
      // already close to zero and, more to the point, it is PREDICTABLE.
      // Detection still runs live for the green corners; it has no say here.
      quad = rectToQuad(aim);
      from = 'aim';

      // ⚠️ THE BOX IS THE FALLBACK NOW, NOT THE ANSWER.
      //
      // "THE BOX. EXACTLY THE BOX. NOTHING ELSE" was settled because every
      // detector tried before it produced guesses that were nearly right, and
      // a nearly-right guess still has to be checked on all four sides — which
      // costs more than dragging from a position that never moves.
      //
      // That objection was about guesses that could not say how sure they
      // were. `seededCorners` searches only a band around each edge OF THIS
      // BOX, fits a line per edge and reports how well each one fitted, so it
      // can decline. Below the threshold the member gets exactly what they got
      // before; above it they get corners already on the document and a single
      // tap instead of four drags.
      //
      // ⚠️ AND IT CAN REACH OUTSIDE THE BOX, which is the other half. The
      // operator's certificate was framed slightly larger than the box and the
      // crop cut about 20mm off each end, permanently, because the crop IS the
      // file. Bands extend past the prior, so an overflowing page is found
      // rather than trimmed.
      const seed = shrinkForDetect(raster);
      const inSmall = quad.map((p) => ({
        x: p.x * seed.scale,
        y: p.y * seed.scale,
      })) as Quad;
      const found = seededCorners(blur3(seed.gray), inSmall);
      seedReport = {
        confidence: Math.round(found.confidence * 100) / 100,
        hits: [found.edges.top, found.edges.bottom, found.edges.left, found.edges.right]
          .map((e) => Math.round(e.hitFrac * 100) / 100),
        residuals: [found.edges.top, found.edges.bottom, found.edges.left, found.edges.right]
          .map((e) => Math.round(e.residual * 10) / 10),
      };
      if (found.corners && found.confidence >= SEED_CONFIDENCE) {
        quad = found.corners.map((p) => ({
          x: p.x / seed.scale,
          y: p.y / seed.scale,
        })) as Quad;
        from = 'detected';
      }
    } else {
      // No box means a caller outside the scanner. Detect, or use the frame.
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
  }

  // ⚠️ A HAIR OF MARGIN, so the crop can never eat the document.
  //
  // Detection lands on the centre of the border ridge, which for a card with a
  // printed edge is a pixel or two INSIDE the paper — and the operator's own
  // scan came back with the top of "Licence To Possess a Firearm" shaved off.
  // A sliver of desk around the edge costs a vision model nothing; a missing
  // line of text costs it the field. Skipped for a manual quad: if somebody
  // has dragged the corners themselves, those are the corners they meant.
  // ⚠️ SUB-PIXEL REFINEMENT AT FULL RESOLUTION, BEFORE THE MARGIN. Every rung
  // above works at reduced scale — the mask on 64x64 cells, the classical
  // detector halved until print blurs away — so a half-cell becomes tens of
  // pixels of misplaced crop once scaled back up. refineEdges walks each edge
  // at full resolution and finds where the step actually is.
  //
  // ⚠️ NOT FOR A MANUAL QUAD. Those corners are where the member put them, and
  // moving them afterwards would silently overrule a person who was looking at
  // the document while they dragged.
  if (!opts.manualQuad) {
    const full = toLuma(raster.data, raster.width, raster.height);
    const r = refineEdges(full, quad as Quad);
    refineReport = {
      moved: Math.round(Math.max(...r.moved) * 10) / 10,
      skipped: r.skipped,
    };
    // A refinement that found nothing returns the input unchanged, so this is
    // safe to take unconditionally.
    quad = r.quad;
  }

  const cropQuad = opts.manualQuad ? quad : scaleQuad(quad, 1.02);


  // ⚠️ THE KNOWN ASPECT DECIDES THE OUTPUT SHAPE. opts.expectAspect has been
  // threaded in here all along and only ever reached the DETECTOR, where it
  // biases which quad is chosen. It never reached the sizing, so a correctly
  // detected quad was then rectified into whatever rectangle its own edge
  // lengths suggested — which under perspective is the wrong one. See the note
  // on outputSize for the worked example off a real capture.
  const { w, h, snapped } = outputSize(
    cropQuad,
    OUTPUT_MAX_EDGE,
    opts.expectAspect,
  );
  const flat = rectify(raster, cropQuad, w, h);
  if (!flat) throw new Error('We could not straighten that one.');

  const better = enhance(flat);
  const report = inspect(better);
  const ink = inkiness(
    toLuma(better.data, better.width, better.height),
    frameQuad(better.width, better.height, 0),
  );

  return {
    seed: seedReport,
    maskFit: maskReport,
    pickedBy,
    arbitration,
    refined: refineReport,
    file: await toFile(better, opts.name ?? `scan-${Date.now()}.jpg`),
    preview: await previewUrl(better),
    flat,
    filter: 'shadow',
    outputWidth: better.width,
    outputHeight: better.height,
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
 * One thing worth saying about a capture.
 *
 * ⚠️ THE LEVEL IS THE POINT. These used to be a flat `string[]`, so "it is
 * quite dark" and "this may be a photograph of the mat instead of your
 * document" arrived as identical grey lines in the same unlabelled list,
 * directly above a red button reading "Use it". They are not the same kind of
 * statement:
 *
 *   note — the scan is usable; it could be better. Cosmetic.
 *   warn — we may have cropped the WRONG OBJECT. Nothing downstream recovers
 *          from that, and the member is the only one who can see it.
 */
export interface Verdict {
  level: 'note' | 'warn';
  text: string;
}

/**
 * What is worth saying about a capture, in the member's words.
 *
 * ⚠️ THIS IS THE HONEST HALF OF THE FEATURE. We cannot recover a blown
 * highlight or a photograph taken while the lens was still hunting. What we
 * can do is notice, and say so, and let them take it again — which fixes it
 * completely and costs three seconds.
 */
export function verdicts(r: ScanResult): Verdict[] {
  const out: Verdict[] = [];
  if (r.report.glare > 0.015) {
    out.push({
      level: 'note',
      text: 'There is a glare on it. Tilting the phone a little, or moving out from under the light, will clear it.',
    });
  }
  if (r.report.sharpness < 3.5) {
    out.push({
      level: 'note',
      text: 'This one came out soft. Holding still for a moment before you tap will read better.',
    });
  }
  if (r.report.meanLuma < 55) {
    out.push({
      level: 'note',
      text: 'It is quite dark. More light on the document will help.',
    });
  }
  if (r.source === 'frame') {
    out.push({
      level: 'warn',
      text: 'We could not find the edges, so we used the frame. Check the corners and drag them if they are wrong.',
    });
  } else if (r.sourceEdge < 1400) {
    // ⚠️ THE CAMERA STREAM IS NOT THE STILL CAMERA. A browser gives us video
    // frames, and on many phones that is 1080p or less against a 48-megapixel
    // stills sensor. It is enough for a licence card filling the frame; it is
    // not enough for a card photographed from across a desk. Saying so is
    // better than handing over something unreadable.
    out.push({
      level: 'note',
      text: 'The camera gave us a small image, so fine print may not read. Filling more of the frame with the document, or choosing a file taken with your normal camera app, will be sharper.',
    });
  } else if (r.ink < 0.06) {
    // Almost no print in what we cropped — most often the mat or folder the
    // document was lying on, whose edge is stronger than the document's own.
    out.push({
      level: 'warn',
      text: 'There is very little writing in this crop, so we may have caught the mat or folder underneath instead of the document. Worth a look before you use it.',
    });
  }
  return out;
}


/**
 * Re-run the cleanup on an already-rectified page.
 *
 * ⚠️ FROM `flat`, NEVER FROM THE ENHANCED OUTPUT. Enhancement is lossy in the
 * direction that matters: flattening has already decided what was paper and
 * pulled it to white, so a second pass over its own output cannot recover the
 * tones it removed, and turning the filter OFF by re-processing the ON result
 * would return something that is neither. The unfiltered page is kept for
 * exactly this.
 */
export async function refilter(
  flat: Raster,
  filter: ScanFilter,
  name: string,
): Promise<{ file: File; preview: string }> {
  const out =
    filter === 'none'
      ? flat
      : enhance(flat, { flatten: true, localContrast: true, sharpen: true });
  return { file: await toFile(out, name), preview: await previewUrl(out) };
}
