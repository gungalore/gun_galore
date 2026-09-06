import type { Detector } from './detector';
import { MIN_CONFIDENCE } from './detector';
import type { Quad } from './geometry';
import { orderQuad, scaleQuad, touchesEdge } from './geometry';

/**
 * Where the document is in a still, found coarse to fine.
 *
 * The detector answers on a 256 px view of whatever it is given. A card held
 * at arm's length is a third of a 12 MP photo, which is a few dozen pixels in
 * that view, and the model simply does not see it. So: look at the whole
 * still first; when the answer is small or missing, look again at a zoomed
 * window, seeded by the live outline (the phone was tracking the card a
 * moment ago) or, failing that, by the middle of the frame.
 */

export type LocateStage = 'full' | 'zoom' | 'live' | 'centre' | 'live-outline' | 'none';

export interface LiveOutline {
  /** Outline from the live view, in video pixels. */
  quad: Quad;
  /** Size of the video the outline was measured on. */
  width: number;
  height: number;
}

export interface LocateOptions {
  detector: Detector;
  /** Downscale to a long edge; the browser uses a canvas, the bench a loop. */
  resize: (img: ImageData, maxEdge: number) => ImageData;
  live?: LiveOutline | null;
  /** Long edge of the copy the detector sees. */
  smallEdge?: number;
}

export interface LocateResult {
  quad: Quad | null;
  confidence: number | null;
  /** Which look found it. */
  stage: LocateStage;
  /** Detector runs spent. */
  passes: number;
  ms: number;
}

/** A document smaller than this share of the frame's long edge gets a zoomed second look. */
export const ZOOM_BELOW_SPAN = 0.55;
/** Margin around a seed box, as a fraction of its size on each side. */
const SEED_MARGIN = 0.6;
/** Centre windows tried when nothing seeds the search, as a share of the frame. */
const CENTRE_WINDOWS = [0.62, 0.42];

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bbox(q: Quad): Box {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function expand(b: Box, margin: number, w: number, h: number): Box {
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  return {
    x0: Math.max(0, Math.floor(b.x0 - bw * margin)),
    y0: Math.max(0, Math.floor(b.y0 - bh * margin)),
    x1: Math.min(w, Math.ceil(b.x1 + bw * margin)),
    y1: Math.min(h, Math.ceil(b.y1 + bh * margin)),
  };
}

function centreBox(share: number, w: number, h: number): Box {
  return { x0: Math.round((w * (1 - share)) / 2), y0: Math.round((h * (1 - share)) / 2), x1: Math.round((w * (1 + share)) / 2), y1: Math.round((h * (1 + share)) / 2) };
}

/**
 * Map an outline measured on the video onto the still. When the two share an
 * aspect it is a plain scale. When they do not (Android's 16:9 preview against
 * its 4:3 photo) the preview is taken to be a centred crop of the photo along
 * the tighter dimension, which is how phone camera pipelines frame it. Only a
 * seed for a zoomed look, so a phone that frames differently still gets found.
 */
export function mapLiveToStill(live: LiveOutline, stillW: number, stillH: number): Quad {
  const s = Math.min(stillW / live.width, stillH / live.height);
  const ox = (stillW - live.width * s) / 2;
  const oy = (stillH - live.height * s) / 2;
  return live.quad.map((p) => ({ x: ox + p.x * s, y: oy + p.y * s })) as Quad;
}

/** True when the outline's long side is a small share of the frame's. */
export function isSmall(q: Quad, w: number, h: number): boolean {
  const b = bbox(q);
  return Math.max(b.x1 - b.x0, b.y1 - b.y0) < ZOOM_BELOW_SPAN * Math.max(w, h);
}

export function cropImageData(img: ImageData, b: Box): ImageData {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const out = new ImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    const s = ((b.y0 + y) * img.width + b.x0) * 4;
    out.data.set(img.data.subarray(s, s + row), y * row);
  }
  return out;
}

export async function locateDocument(work: ImageData, opts: LocateOptions): Promise<LocateResult> {
  const { detector, resize } = opts;
  const smallEdge = opts.smallEdge ?? Math.max(detector.inputSize, 512);
  const t0 = performance.now();
  let passes = 0;

  const look = async (box: Box | null): Promise<{ quad: Quad; confidence: number; clipped: boolean } | null> => {
    const region = box ? cropImageData(work, box) : work;
    if (region.width < 32 || region.height < 32) return null;
    const small = resize(region, smallEdge);
    passes++;
    const det = await detector.detect(small, 'still').catch(() => null);
    if (!det || det.confidence < MIN_CONFIDENCE) return null;
    const sx = region.width / small.width;
    const sy = region.height / small.height;
    // A quad on the window's border means the document runs past it.
    const clipped = !!box && touchesEdge(det.quad, small.width, small.height, 0.015);
    let quad = scaleQuad(orderQuad(det.quad), sx, sy);
    if (box) quad = quad.map((p) => ({ x: p.x + box.x0, y: p.y + box.y0 })) as Quad;
    return { quad, confidence: det.confidence, clipped };
  };

  /** Zoom on a seed box; widen once if the document runs past the window. */
  const zoom = async (seed: Box): Promise<{ quad: Quad; confidence: number } | null> => {
    let box = expand(seed, SEED_MARGIN, work.width, work.height);
    for (let attempt = 0; attempt < 2; attempt++) {
      const hit = await look(box);
      if (hit && !hit.clipped) return hit;
      box = expand(box, SEED_MARGIN, work.width, work.height);
      if (box.x0 === 0 && box.y0 === 0 && box.x1 === work.width && box.y1 === work.height) break;
    }
    return null;
  };

  const done = (quad: Quad | null, confidence: number | null, stage: LocateStage): LocateResult => ({ quad, confidence, stage, passes, ms: performance.now() - t0 });

  // 1. The whole still.
  const full = await look(null);
  if (full && !isSmall(full.quad, work.width, work.height)) return done(full.quad, full.confidence, 'full');

  // 2. Found but small: a zoomed look at the same spot gives the model a document it can see.
  if (full) {
    const z = await zoom(bbox(full.quad));
    if (z && z.confidence >= full.confidence - 0.05) return done(z.quad, z.confidence, 'zoom');
    return done(full.quad, full.confidence, 'full');
  }

  // 3. Nothing at all: zoom where the live view last saw it.
  const live = opts.live;
  if (live) {
    const seed = mapLiveToStill(live, work.width, work.height);
    const z = await zoom(bbox(seed));
    if (z) return done(z.quad, z.confidence, 'live');
  }

  // 4. Then the middle of the frame, where people hold a document.
  for (const share of CENTRE_WINDOWS) {
    const hit = await look(centreBox(share, work.width, work.height));
    if (hit && !hit.clipped) return done(hit.quad, hit.confidence, 'centre');
  }

  // 5. Last resort: the live outline itself, only when the still is the video frame.
  if (live && Math.abs(live.width / live.height - work.width / work.height) < 0.01) {
    return done(mapLiveToStill(live, work.width, work.height), null, 'live-outline');
  }
  return done(null, null, 'none');
}
