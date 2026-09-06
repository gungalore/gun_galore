import type { DocShape, EnhanceMode, QualityVerdict } from '../types';
import { classifyShape, estimateAspect, SHAPE_RATIOS } from './aspect';
import type { Detector } from './detector';
import { locateDocument, type LiveOutline, type LocateStage } from './locate';
import { resizeImageData } from './decode';
import { imageDataToJpeg } from './output';
import { applyMode, chooseMode, normalizeIllumination } from './enhance';
import type { Quad } from './geometry';
import { gradePage } from './quality';
import { refineQuad, shrinkQuad } from './refine';
import { chooseRotation, rotateImageData, type Rotation } from './orientation';
import { outputSizeFor, warpQuad } from './warp';

/** One scanned page, ready for review. Variants are rendered lazily and cached. */
export interface ScanPage {
  id: string;
  /** The rectified (or, with no outline, the whole) image before enhancement. */
  base: ImageData;
  /** Illumination-normalised base; the input to every look. */
  normalized: ImageData;
  quad: Quad | null;
  shape: DocShape;
  aspect: number | null;
  /** The look Auto chose. */
  autoMode: Exclude<EnhanceMode, 'auto'>;
  quality: QualityVerdict;
  /** Pass-through file (PDF) that skipped the pipeline. */
  passthrough?: File;
  /** The working image the outline refers to. Kept until the page is sealed, for "Fix corners". */
  source?: ImageData;
  /**
   * Set once the member keeps the page: the chosen look encoded as JPEG plus a
   * small preview. The full-size buffers are released at that point, so a
   * phone can hold many pages without running out of memory.
   */
  sealed?: { blob: Blob; mode: Exclude<EnhanceMode, 'auto'> | 'original'; preview: ImageData; width: number; height: number };
  /** A turn the member asked for on top of the automatic one; re-applied after a re-crop. */
  turn?: Rotation;
  variants: Partial<Record<Exclude<EnhanceMode, 'auto'>, ImageData>>;
  /** What the detector saw, for the diagnostics panel. */
  diag: {
    detectMs: number | null;
    confidence: number | null;
    source: 'camera' | 'file';
    stillSource: 'photo' | 'frame' | 'file';
    stillWidth: number;
    stillHeight: number;
    refineShift: number | null;
    refinedEdges: number | null;
    /** True when detection on the still failed and the live outline was used instead. */
    usedLiveQuad: boolean;
    /** Which look found the document (whole still, zoomed window, ...). */
    detectStage: LocateStage;
    /** Detector runs spent on this still. */
    detectPasses: number;
    /** Outline from the detector, before refinement, in `work` pixels. */
    coarseQuad: Quad | null;
    /** Size of the working image the quads refer to. */
    workWidth: number;
    workHeight: number;
  };
}

export interface ProcessOptions {
  detector: Detector;
  source: 'camera' | 'file';
  /** Hint from the caller; the recovered shape wins when they disagree. */
  shapeHint?: DocShape;
  /** Longest edge of the working image. */
  workEdge?: number;
  /** Outline from the live view, in video pixels. Seeds a zoomed look when the whole still shows nothing. */
  live?: LiveOutline | null;
  /** Where the still came from, for diagnostics. */
  stillSource?: 'photo' | 'frame' | 'file';
}

let counter = 0;

/**
 * Turn a still (captured or picked) into a review-ready page:
 * detect the outline on a small copy, rectify the full still, normalise the
 * lighting, choose a look, grade it.
 */
export async function processStill(still: ImageData, opts: ProcessOptions): Promise<ScanPage> {
  const workEdge = opts.workEdge ?? 3600;
  const work = resizeImageData(still, workEdge);

  // Always detect on the still itself: it is sharper than the live frame and, on
  // phones with a native photo pipeline, has a different field of view from the
  // video the live outline was measured on. The live outline only seeds a zoomed
  // look, and stands in as a last resort when the still is the video frame.
  const located = await locateDocument(work, { detector: opts.detector, resize: resizeImageData, live: opts.live });
  let quad: Quad | null = located.quad;
  const usedLiveQuad = located.stage === 'live-outline';
  const detectMs = located.ms;
  const confidence = located.confidence;

  let refineShift: number | null = null;
  let refinedEdges: number | null = null;
  const coarseQuad: Quad | null = quad ? (quad.map((p) => ({ ...p })) as Quad) : null;
  if (quad) {
    // The detector answered on a 256 px view; pull the corners onto the real edges.
    const refined = refineQuad({ data: work.data, width: work.width, height: work.height, channels: 4 }, quad);
    // A hairline inward trim (0.3% of the short side) so no sliver of table survives at the border.
    quad = shrinkQuad(refined.quad, 0.003 * Math.min(work.width, work.height));
    refineShift = refined.shift;
    refinedEdges = refined.edges.filter((e) => e.refined).length;
  }

  const finished = finishPage(work, quad, opts.shapeHint, workEdge);
  return {
    id: `p${Date.now().toString(36)}${(counter++).toString(36)}`,
    ...finished,
    source: work,
    variants: {},
    diag: {
      detectMs,
      confidence,
      source: opts.source,
      stillSource: opts.stillSource ?? (opts.source === 'file' ? 'file' : 'frame'),
      stillWidth: still.width,
      stillHeight: still.height,
      refineShift,
      refinedEdges,
      usedLiveQuad,
      detectStage: located.stage,
      detectPasses: located.passes,
      coarseQuad,
      workWidth: work.width,
      workHeight: work.height,
    },
  };
}

/** Crop, normalise, choose a look and grade, from a working image and an outline (or none). */
function finishPage(work: ImageData, quad: Quad | null, shapeHint: DocShape | undefined, workEdge: number): Pick<ScanPage, 'base' | 'normalized' | 'quad' | 'shape' | 'aspect' | 'autoMode' | 'quality'> {
  let base = work;
  let shape: DocShape = shapeHint ?? 'other';
  let aspect: number | null = null;
  if (quad) {
    const est = estimateAspect(quad, work.width, work.height);
    aspect = est.ratio;
    const found = classifyShape(est.ratio);
    shape = found === 'other' ? (shapeHint ?? 'other') : found;
    // Snap to the known physical ratio only when the estimate is close to it. A4
    // (1.414) and a card (1.586) are 12% apart; snapping a 7%-off estimate to the
    // wrong one squashes the page, so beyond 3% the estimate itself is used.
    const landscape = est.ratio >= 1;
    const known = shape === 'other' ? null : shape;
    const snap = known !== null && classifyShape(est.ratio, 0.03) === known;
    const target = !snap || known === null ? est.ratio : landscape ? SHAPE_RATIOS[known] : 1 / SHAPE_RATIOS[known];
    const { width, height } = outputSizeFor(quad, target, workEdge);
    base = warpQuad(work, quad, width, height);
    // Cards read landscape; anything the text shows to be upside down is turned over.
    const rot = chooseRotation(base, shape);
    if (rot !== 0) base = rotateImageData(base, rot);
  }
  const normalized = normalizeIllumination(base);
  const autoMode = chooseMode(normalized, shape === 'card');
  const quality = gradePage(normalized, base);
  return { base, normalized, quad, shape, aspect, autoMode, quality };
}

/**
 * Re-crop an unsealed page from an outline the member corrected by hand
 * (in `page.source` pixels). The page keeps its id; looks are re-rendered.
 */
export function recropPage(page: ScanPage, quad: Quad, workEdge = 3600): ScanPage {
  if (!page.source) throw new Error('page has no source image');
  const finished = finishPage(page.source, quad, page.shape === 'other' ? undefined : page.shape, workEdge);
  const turned = page.turn ? turnFinished(finished, page.turn) : finished;
  return { ...page, ...turned, variants: {}, diag: { ...page.diag, usedLiveQuad: false, detectStage: 'none', detectPasses: 0 } };
}

function turnFinished<T extends { base: ImageData; normalized: ImageData }>(p: T, rot: Rotation): T {
  return { ...p, base: rotateImageData(p.base, rot), normalized: rotateImageData(p.normalized, rot) };
}

/** Turn an unsealed page a quarter turn clockwise, when the automatic orientation got it wrong. */
export function rotatePage(page: ScanPage): ScanPage {
  if (page.sealed || page.passthrough) return page;
  const turn = (((page.turn ?? 0) + 90) % 360) as Rotation;
  return { ...turnFinished(page, 90), turn, variants: {} };
}

const EMPTY = (): ImageData => new ImageData(1, 1);

/**
 * Encode the chosen look and let go of the full-size buffers. After this,
 * `renderVariant` returns the small preview; the JPEG is what gets sent.
 */
export async function sealPage(page: ScanPage, mode: EnhanceMode | 'original', previewEdge = 640): Promise<void> {
  if (page.sealed || page.passthrough) return;
  const chosen = mode === 'auto' ? page.autoMode : mode;
  const image = renderVariant(page, chosen);
  const blob = await imageDataToJpeg(image);
  const preview = resizeImageData(image, previewEdge);
  page.sealed = { blob, mode: chosen, preview, width: image.width, height: image.height };
  page.base = EMPTY();
  page.normalized = EMPTY();
  page.variants = {};
  page.source = undefined;
}

/** Render (and cache) a page in a given look. `original` is the un-normalised base. */
export function renderVariant(page: ScanPage, mode: EnhanceMode | 'original'): ImageData {
  if (page.sealed) return page.sealed.preview;
  if (mode === 'original') return page.base;
  const m = mode === 'auto' ? page.autoMode : mode;
  const cached = page.variants[m];
  if (cached) return cached;
  const out = applyMode(page.normalized, m);
  page.variants[m] = out;
  return out;
}
