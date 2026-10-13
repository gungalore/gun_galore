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
  // ── 1. Polish each page, one at a time ────────────────────────────
  //
  // ⚠️ SEQUENTIALLY. The detector is a single shared worker; firing every
  // image at it at once makes the later ones contend for it. The vault's own
  // batch does the same for the same reason.
  const items: (PreparedUpload & {
    side: 'front' | 'back' | null;
    isImage: boolean;
  })[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const v = verdicts[i];
    const side = v?.side ?? null;
    const pdf = isPdf(file);
    const shape: DocShape = side ? 'card' : shapeForKind(v?.kind ?? '');
    const prepared = pdf ? file : await autoPolish(file, shape, v?.rotate);
    items.push({
      file: prepared,
      identifyId: v?.id ?? '',
      saps271: v?.saps271 === true,
      side,
      isImage: !pdf,
    });
  }

  // ── 2. Compose the two sides of the card ──────────────────────────
  //
  // ⚠️ ORDER-INDEPENDENT (2026-10-14). The pairing used to require the front to
  // arrive BEFORE the back, so a member who picked the back first got two
  // separate pages. Find the front and the back wherever they are.
  const frontIdx = items.findIndex((x) => x.side === 'front');
  const backIdx = items.findIndex((x) => x.side === 'back');
  if (frontIdx !== -1 && backIdx !== -1) {
    try {
      const composed = await composeSides(
        items[frontIdx].file,
        items[backIdx].file,
      );
      const out: PreparedUpload[] = [];
      for (let i = 0; i < items.length; i++) {
        if (i === frontIdx) {
          // The composed page takes the front's verdict id; it is the page the
          // server reads the firearm off.
          out.push({ file: composed, identifyId: items[i].identifyId });
          continue;
        }
        if (i === backIdx) continue;
        out.push({
          file: items[i].file,
          identifyId: items[i].identifyId,
          saps271: items[i].saps271,
        });
      }
      return out;
    } catch {
      // The pair could not be composed — keep both pages rather than lose one.
    }
  }

  // ── 3. Two photographs, one page ──────────────────────────────────
  //
  // ⚠️ EVEN WHEN THE SIDE COULD NOT BE NAMED (2026-10-14). Operator: "If its two
  // images that the owner just sent me ... put onto one fucking page." The side
  // is a nicety for ORDERING (front on top); it must not be the thing that
  // decides WHETHER the two photographs become one page. When two images are
  // picked and the sides were not both named, compose them anyway — a card
  // whose front was read fine and whose back was not still becomes one page.
  if (items.length === 2 && items.every((x) => x.isImage)) {
    const [a, b] = items;
    const top = a.side === 'front' ? a : b.side === 'front' ? b : a;
    const bottom = top === a ? b : a;
    try {
      const composed = await composeSides(top.file, bottom.file);
      return [{ file: composed, identifyId: top.identifyId }];
    } catch {
      // Fall through to two pages rather than lose one.
    }
  }

  return items.map((x) => ({
    file: x.file,
    identifyId: x.identifyId,
    saps271: x.saps271,
  }));
}
