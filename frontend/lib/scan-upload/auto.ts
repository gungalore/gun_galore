import type { DocShape as SiteDocShape } from '@/lib/scan/shapes';
import { decodeFile } from './pipeline/decode';
import { processStill, sealPage } from './pipeline/process';
import { WorkerDetector } from './pipeline/worker-detector';

// ────────────────────────────────────────────────────────────────────
// THE UPLOAD'S TREATMENT, WITHOUT THE SCREEN.
//
// Operator, 2026-09-28: "identified documents gets cropped and all the colour
// and sharpening takes place and the next screen they see is documents sorted
// and evidence sorted." So the cropper is no longer a step the member walks
// through per document — the batch path runs the same pipeline headlessly and
// hands back a JPEG, and the ONE screen that follows is the sorted review.
//
// ⚠️ IT IS THE SAME PIPELINE, NOT A CHEAPER ONE. decode → processStill (find
// the outline, war + straighten, normalise the light, choose a look) → seal to
// JPEG. The interactive `useUploadEnhance` overlay still exists, but only for
// "Fix crop" on a document the member wants to correct from the review screen.
//
// ⚠️ NEVER THROWS AND NEVER LOSES A FILE. A page the detector cannot find, a
// format the browser will not decode, a decoder that is not loaded — every one
// returns the ORIGINAL file, exactly as the flag-off path always did. A polish
// is an improvement, not a gate.
//
// ⚠️ IT DOES NOT READ NEXT_PUBLIC_SCANNER_V3. The member asked for the
// treatment on their uploads; gating it on the scanner flag would silently stop
// cropping in any environment where that flag is off while the flow still
// promised it.
// ────────────────────────────────────────────────────────────────────

/** Where the model and the ONNX runtime live. Shared with the scanner. */
const SCAN_ASSETS = '/scan/v3/';

/**
 * One detector for the whole tab. The model and wasm are ~20 MB and load once,
 * so a folder of ten documents pays for them once — the same singleton the
 * scanner's own door uses.
 */
let shared: WorkerDetector | null = null;
function polishDetector(): WorkerDetector {
  if (!shared) {
    shared = new WorkerDetector({
      modelUrl: SCAN_ASSETS + 'docaligner-lcnet100.onnx',
      wasmPaths: SCAN_ASSETS,
      name: 'docaligner-lcnet100',
    });
  }
  return shared;
}

/**
 * The site's kinds include the green ID book; the cropper reads that one from
 * the outline. Mirrors the mapping in document-enhance-overlay.tsx.
 */
function uploadShape(shape?: SiteDocShape): 'card' | 'a4' | undefined {
  return shape === 'card' ? 'card' : shape === 'a4' ? 'a4' : undefined;
}

/**
 * Rectify one identified document into a JPEG File, or hand back the original
 * untouched when the treatment cannot run.
 */
export async function autoPolish(
  file: File,
  shape?: SiteDocShape,
  /**
   * The classifier's upright rotation, in degrees CLOCKWISE, when it answered.
   * Left undefined, the pipeline falls back to its own ink-axis guess — which
   * finds the quarter turn but cannot choose the direction.
   */
  rotate?: 0 | 90 | 180 | 270,
): Promise<File> {
  try {
    const decoded = await decodeFile(file);
    if (decoded.kind !== 'image') return file;

    const page = await processStill(decoded.image, {
      detector: polishDetector(),
      source: 'file',
      shapeHint: uploadShape(shape),
      stillSource: 'file',
      rotate,
    });

    await sealPage(page, 'auto');
    const blob = page.sealed?.blob;
    if (!blob || blob.size === 0) return file;

    const name = `${file.name.replace(/\.[^.]+$/, '')}.jpg`;
    return new File([blob], name, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
