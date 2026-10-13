import type { DocShape } from '@/lib/scan/shapes';
import { shapeForKind } from '@/lib/scan/shapes';
import { autoPolish } from './auto';
import { composeSides } from './compose';

// ────────────────────────────────────────────────────────────────────
// THE APPLIED-FOR FIREARM'S PAPERWORK, TREATED AND PAIRED.
//
// ⚠️ THE OWNER'S TWO PHOTOS BECOME ONE PAGE (2026-10-13). Operator: "If its two
// images that the owner just sent me and I need to upload them, they must get
// the scanner treatment in the background ... and put onto one fucking page."
//
// The flow, once the files are picked:
//   identify (server) -> autoPolish (warp, straighten, colour, crop, scale)
//   -> a front + a back composed onto one page -> upload
//
// ⚠️ THE SCANNER SHAPE COMES FROM THE FACE, NOT THE KIND. A licence front can be
// classified as the catch-all source proof, whose kind maps to A4 — and warping
// a card to A4 stretches it. When the classifier says "this is a licence card
// side", the shape is the card.
//
// ⚠️ PDFs AND UNDECODABLE FILES PASS THROUGH. A 271 or a consent letter is a
// PDF or an A4 photograph; nothing is composed and nothing is lost.
// ────────────────────────────────────────────────────────────────────

/** The fields this pipeline uses from the server's identify verdict. */
export interface SourceVerdict {
  id: string;
  kind?: string | null;
  rotate?: 0 | 90 | 180 | 270;
  side?: 'front' | 'back' | null;
  /** The page is a SAPS 271 form: read, never annexed. */
  saps271?: boolean;
}

export interface PreparedUpload {
  file: File;
  /** The verdict id, so the server reuses its own classification. */
  identifyId: string;
  /** The page is a SAPS 271 form: read, never annexed. */
  saps271?: boolean;
}

function isPdf(file: File): boolean {
  return (file.type || '') === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/**
 * Turn the picked files into the pages to upload, pairing a licence front with
 * its back. Verdicts are matched to files by POSITION, as the server answers.
 *
 * Never throws: a file the browser cannot decode is handed straight through by
 * `autoPolish`, and a pair that cannot be composed is uploaded as two pages
 * rather than dropped.
 */
export async function prepareSourceBatch(
  files: File[],
  verdicts: SourceVerdict[],
): Promise<PreparedUpload[]> {
  const out: PreparedUpload[] = [];
  let front: PreparedUpload | null = null;

  const flushFront = () => {
    if (front) {
      out.push(front);
      front = null;
    }
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const v = verdicts[i];
    const identifyId = v?.id ?? '';
    const saps271 = v?.saps271 === true;

    const shape: DocShape = v?.side ? 'card' : shapeForKind(v?.kind ?? '');
    const prepared = isPdf(file) ? file : await autoPolish(file, shape, v?.rotate);

    if (v?.side === 'front') {
      // A second front with no back between them: the first is its own page.
      flushFront();
      front = { file: prepared, identifyId, saps271 };
      continue;
    }

    if (v?.side === 'back' && front) {
      try {
        const composed = await composeSides(front.file, prepared);
        // A composed card page is never a 271 form.
        out.push({ file: composed, identifyId: front.identifyId });
      } catch {
        // The pair could not be composed — keep both pages rather than lose one.
        out.push(front, { file: prepared, identifyId, saps271 });
      }
      front = null;
      continue;
    }

    flushFront();
    out.push({ file: prepared, identifyId, saps271 });
  }

  flushFront();
  return out;
}
