import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

/** An annexure that arrived as a PDF rather than a photograph. */
export interface PdfAnnexure {
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
export async function appendPdfAnnexures(
  body: Buffer,
  loaded: LoadedPdfAnnexure[],
  opts: {
    referenceNumber: string;
    templateVersion: string;
    bodyPageCount: number;
  },
): Promise<Buffer> {
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
  let pageNo = opts.bodyPageCount;

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
      out.addPage(page);
      pageNo += 1;

      const { width, height } = page.getSize();
      // ⚠️ STAMPED IN THE MARGIN, NOT OVER THE DOCUMENT. This is somebody's
      // licence or municipal bill; a caption written across it would deface
      // evidence a DFO has to read. 18pt from the top edge is above the text
      // block of every ordinary document, and if a page really is printed
      // edge to edge the caption sits on it rather than the pack being
      // unlabelled.
      const caption =
        a.total > 1
          ? `Annexure ${a.letter} — ${a.label} (${a.index} of ${a.total})`
          : `Annexure ${a.letter} — ${a.label}`;
      const suffix = take > 1 ? `  ·  page ${i + 1} of ${take}` : '';

      try {
        page.drawText(`${caption}${suffix}`, {
          x: 36,
          y: height - 18,
          size: 8,
          font,
          color: grey,
        });
        page.drawText(
          `${opts.referenceNumber} · page ${pageNo} of ${total} · prepared with All Outdoor (${opts.templateVersion})`,
          { x: 36, y: 16, size: 7.5, font, color: grey },
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

  return Buffer.from(await out.save());
}
