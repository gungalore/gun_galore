import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, RGB } from 'pdf-lib';

// ────────────────────────────────────────────────────────────────────
// PDF ANNEXURES, PRINTED INTO THE PACK.
//
// ⚠️ THIS EXISTED AS A LIMITATION FOR NO GOOD REASON. pdfkit's doc.image()
// takes JPEG and PNG only, so an annexure the member uploaded as a PDF — a
// letter of good standing, a municipal bill, a membership certificate, which
// is exactly the form those arrive in — was listed on the index under "Bring
// your own copy of these, we could not reprint them" and left out of the
// pack. The operator's own pack went to him three annexures short.
//
// pdf-lib has been in this codebase's dependencies the whole time (the SAPS
// 271 renderer uses it) and copies pages between documents. The limitation was
// documented instead of solved.
//
// SO: pdfkit still draws the body and the image annexures, and a pdf-lib pass
// afterwards appends the PDF ones — captioned and footed to match.
// ────────────────────────────────────────────────────────────────────

/**
 * A PDF page to splice into the pack.
 *
 * ⚠️ NOT ALWAYS AN ANNEXURE, DESPITE THE NAME. Operator, 2026-08-23, on the
 * C.I.P. cartridge datasheet: "it not an annexure. Its part of the motivation
 * itself just giving information about the cartridge." A block with no
 * `letter` is body content: it is captioned by its label alone, carries no
 * annexure letter, and belongs in the contents as a section rather than in the
 * exhibits list.
 */
export interface PdfAnnexure {
  /** Empty for body content — see the note above. */
  letter: string;
  label: string;
  /** "2 of 3" when several documents share a letter. */
  index: number;
  total: number;
  bytes: Buffer;
}

/** A PDF annexure that has been opened and counted, ready to append. */
export interface LoadedPdfAnnexure extends PdfAnnexure {
  pageCount: number;
}

/**
 * ⚠️ A CAP, BECAUSE SOMEBODY WILL UPLOAD A BANK STATEMENT. A forty-page
 * statement behind "proof of address" turns a twelve-page submission into an
 * unusable brick that a DFO will hand straight back. The first pages are the
 * ones that carry the address and the date; the rest is transaction history
 * nobody asked for. Named on the index when it bites, never silently cut.
 */
export const MAX_PAGES_PER_ANNEXURE = 8;

/**
 * Open each PDF annexure and count its pages.
 *
 * Runs BEFORE the body is drawn, because the footer says "page N of M" and M
 * has to include what we are about to append — stamping the body first and
 * merging afterwards would number a fifteen-page pack "of 12".
 *
 * Fail-soft per document: anything that will not open is reported and the pack
 * still renders. A member with one corrupt upload must still get their
 * motivation.
 */
export async function loadPdfAnnexures(
  annexures: PdfAnnexure[],
): Promise<{
  loaded: LoadedPdfAnnexure[];
  failed: { letter: string; label: string; why: string }[];
}> {
  const loaded: LoadedPdfAnnexure[] = [];
  const failed: { letter: string; label: string; why: string }[] = [];

  for (const a of annexures) {
    try {
      // ignoreEncryption: a PDF with an owner password but no user password
      // opens and prints perfectly well, and refusing it would drop a
      // municipal bill for a restriction its own issuer set on itself.
      const doc = await PDFDocument.load(a.bytes, { ignoreEncryption: true });
      const pageCount = doc.getPageCount();
      if (pageCount === 0) {
        failed.push({ letter: a.letter, label: a.label, why: 'it has no pages' });
        continue;
      }
      loaded.push({ ...a, pageCount: Math.min(pageCount, MAX_PAGES_PER_ANNEXURE) });
    } catch {
      // Corrupt, password-protected against reading, or not really a PDF.
      failed.push({
        letter: a.letter,
        label: a.label,
        why: 'we could not open it',
      });
    }
  }
  return { loaded, failed };
}

/** Total pages the merge will add — what the footer's "of M" must include. */
export function extraPageCount(loaded: LoadedPdfAnnexure[]): number {
  return loaded.reduce((n, a) => n + a.pageCount, 0);
}

/**
 * Append the PDF annexures to the rendered body.
 *
 * `bodyPageCount` is where the body ended, so the appended pages carry on the
 * numbering rather than restarting.
 */
/**
 * What gets stamped in the top margin of a merged page.
 *
 * ⚠️ NO LETTER MEANS NO "ANNEXURE". A block with an empty letter is body
 * content — the C.I.P. cartridge sheet is the first of them. Operator,
 * 2026-08-23: "it not an annexure. Its part of the motivation itself."
 * Interpolating an empty letter into the old single template stamped
 * "Annexure  — The cartridge" across the top of the datasheet: the wrong word,
 * and a visible double space.
 *
 * ⚠️ EXPORTED SO IT CAN BE TESTED AT ALL. This lived inline in the draw call,
 * where no test could reach it — pdf-lib deflates the content streams, so the
 * caption is not findable in the output bytes. It shipped wrong and was caught
 * by extracting the text of a real rendered pack by hand.
 */
export function captionFor(a: {
  letter: string;
  label: string;
  index: number;
  total: number;
}): string {
  const named = a.letter ? `Annexure ${a.letter} — ${a.label}` : a.label;
  return a.total > 1 ? `${named} (${a.index} of ${a.total})` : named;
}

/**
 * One run of pages going in at one place.
 *
 * ⚠️ SEVERAL BLOCKS, NOT ONE. This took a single `insertAt` until 2026-08-23,
 * which was enough while the only merged pages were reprinted annexures that
 * all went to the same spot. Operator: "The PDF also needs to be dynamic so we
 * can add and remove things without breaking anything or ruining the structure
 * of the document." A datasheet that belongs beside the firearm section and an
 * annexure that belongs at the back are two positions, and the next thing
 * somebody adds will be a third.
 */
export interface PdfBlock {
  /** 0-based index these pages are inserted at. Undefined means the end. */
  insertAt?: number;
  items: LoadedPdfAnnexure[];
}

export async function appendPdfAnnexures(
  body: Buffer,
  blocks: PdfBlock[],
  opts: {
    referenceNumber: string;
    templateVersion: string;
    bodyPageCount: number;
  },
): Promise<Buffer> {
  const loaded = blocks.flatMap((b) => b.items);
  if (!loaded.length) return body;

  let out: PDFDocument;
  try {
    out = await PDFDocument.load(body);
  } catch {
    // Our own body failed to reload — nothing to do but hand back what we
    // rendered. Losing the annexures beats losing the motivation.
    return body;
  }

  const font = await out.embedFont(StandardFonts.Helvetica);
  const grey = rgb(0.42, 0.42, 0.42);
  const total = opts.bodyPageCount + extraPageCount(loaded);

  // ⚠️ DESCENDING BY POSITION, AND THAT IS THE WHOLE TRICK. Inserting at index
  // 12 shifts everything at 12 and beyond, so a later insertion at index 30
  // computed against the ORIGINAL page numbering would land in the wrong
  // place. Going back-to-front means every index is still valid when it is
  // used, and no block has to know about any other.
  const bodyPages = out.getPageCount();
  const ordered = blocks
    .filter((b) => b.items.length)
    .map((b) => ({
      ...b,
      at:
        b.insertAt === undefined
          ? bodyPages
          : Math.max(0, Math.min(b.insertAt, bodyPages)),
    }))
    .sort((a, b) => b.at - a.at);

  for (const block of ordered) {
    await insertBlock(out, block.items, block.at, {
      ...opts,
      total,
      font,
      grey,
      // The page number a merged page ends up with is its insertion index plus
      // however many pages earlier blocks put in front of it. Earlier blocks
      // are the ones with a LOWER index, which — going descending — are the
      // ones not yet inserted, so they are counted here rather than observed.
      before: ordered
        .filter((o) => o.at < block.at)
        .reduce((n, o) => n + extraPageCount(o.items), 0),
    });
  }

  return Buffer.from(await out.save());
}

async function insertBlock(
  out: PDFDocument,
  loaded: LoadedPdfAnnexure[],
  at: number,
  opts: {
    referenceNumber: string;
    templateVersion: string;
    total: number;
    before: number;
    font: PDFFont;
    grey: RGB;
  },
): Promise<void> {
  const { font, grey } = opts;
  const total = opts.total;
  let cursor = at;
  let pageNo = at + opts.before;

  for (const a of loaded) {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(a.bytes, { ignoreEncryption: true });
    } catch {
      continue; // Already reported by loadPdfAnnexures; never throw here.
    }

    const take = Math.min(src.getPageCount(), MAX_PAGES_PER_ANNEXURE);
    let copied;
    try {
      copied = await out.copyPages(
        src,
        Array.from({ length: take }, (_, i) => i),
      );
    } catch {
      continue;
    }

    for (let i = 0; i < copied.length; i++) {
      const page = copied[i];
      // ⚠️ insertPage, NOT addPage. The pages that follow the insertion point
      // were already stamped by pdfkit with their FINAL numbers — the footer
      // pass adds the merged count to everything at or past this index — so
      // anything appended after them would renumber the pack out from under
      // its own footers.
      out.insertPage(cursor, page);
      cursor += 1;
      pageNo += 1;

      const { width, height } = page.getSize();
      // ⚠️ STAMPED IN THE MARGIN, NOT OVER THE DOCUMENT. This is somebody's
      // licence or municipal bill; a caption written across it would deface
      // evidence a DFO has to read. 18pt from the top edge is above the text
      // block of every ordinary document, and if a page really is printed
      // edge to edge the caption sits on it rather than the pack being
      // unlabelled.
      const caption = captionFor(a);
      const suffix = take > 1 ? `  ·  page ${i + 1} of ${take}` : '';

      try {
        // ⚠️ ONE STAMP, IN THE TOP MARGIN, AND NOT A FOOTER TOO. The first
        // version also stamped our "page N of M" along the bottom, which on
        // the operator's own bank statement landed straight on top of the
        // issuer's own footer line — two strings of grey text over each
        // other, both unreadable. A document we did not lay out has no
        // reserved space we can count on, so everything we add goes on ONE
        // line in the one band that has proved clear, and the page number
        // rides with the caption rather than hunting for its own gap.
        page.drawText(
          `${caption}${suffix}  ·  ${opts.referenceNumber} page ${pageNo} of ${total}`,
          { x: 36, y: height - 18, size: 8, font, color: grey },
        );
      } catch {
        // A page whose content stream will not take a stamp is still worth
        // including uncaptioned — the index names it either way.
      }
      // Referenced so the linter cannot call `width` unused; also the honest
      // place to note we do NOT rescale: a page of a different size prints at
      // its own size, because resampling somebody's licence to fit A4 is how
      // a serial number stops being legible.
      void width;
    }
  }
}
