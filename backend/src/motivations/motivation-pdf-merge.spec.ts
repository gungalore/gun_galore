import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  MAX_PAGES_PER_ANNEXURE,
  appendPdfAnnexures,
  extraPageCount,
  loadPdfAnnexures,
} from './motivation-pdf-merge';

// ────────────────────────────────────────────────────────────────────
// PDF ANNEXURES GO IN THE PACK.
//
// They used to be listed under "bring your own copy — we could not reprint
// them" because pdfkit embeds only JPEG and PNG. pdf-lib was already a
// dependency and copies pages between documents; the limitation was
// documented rather than solved, and the operator's own pack went to him
// three annexures short.
//
// Everything here is fail-soft: a member with one corrupt upload must still
// get their motivation.
// ────────────────────────────────────────────────────────────────────

/** A real PDF of `pages` pages, built with the same library we merge with. */
async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`sheet ${i + 1}`, { x: 50, y: 400, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

const annexure = (bytes: Buffer, over: Record<string, unknown> = {}) => ({
  letter: 'E',
  label: 'Your letter of good standing',
  index: 1,
  total: 1,
  bytes,
  ...over,
});

describe('loading PDF annexures', () => {
  it('opens a real PDF and counts its pages', async () => {
    const { loaded, failed } = await loadPdfAnnexures([
      annexure(await makePdf(3)),
    ]);
    expect(failed).toEqual([]);
    expect(loaded[0].pageCount).toBe(3);
  });

  it('⚠️ CAPS a document somebody uploaded by mistake', async () => {
    // A forty-page bank statement behind "proof of address" turns a twelve
    // page submission into a brick a DFO hands straight back.
    const { loaded } = await loadPdfAnnexures([annexure(await makePdf(40))]);
    expect(loaded[0].pageCount).toBe(MAX_PAGES_PER_ANNEXURE);
  });

  it('reports a corrupt file instead of throwing', async () => {
    const { loaded, failed } = await loadPdfAnnexures([
      annexure(Buffer.from('this is not a pdf at all')),
    ]);
    expect(loaded).toEqual([]);
    expect(failed[0].why).toMatch(/could not open/i);
  });

  it('keeps the good ones when one is bad', async () => {
    // The whole point of fail-soft: one broken upload must not cost the
    // applicant the rest of their annexures.
    const { loaded, failed } = await loadPdfAnnexures([
      annexure(Buffer.from('broken'), { letter: 'C' }),
      annexure(await makePdf(1), { letter: 'E' }),
    ]);
    expect(loaded.map((l) => l.letter)).toEqual(['E']);
    expect(failed.map((f) => f.letter)).toEqual(['C']);
  });

  it('counts the pages the footer total has to include', async () => {
    const { loaded } = await loadPdfAnnexures([
      annexure(await makePdf(2), { letter: 'C' }),
      annexure(await makePdf(3), { letter: 'E' }),
    ]);
    expect(extraPageCount(loaded)).toBe(5);
  });
});

describe('appending them to the pack', () => {
  const opts = {
    referenceNumber: 'MO000017',
    templateVersion: 'tpl-test',
    bodyPageCount: 4,
  };

  it('adds every annexure page to the body', async () => {
    const body = await makePdf(4);
    const { loaded } = await loadPdfAnnexures([
      annexure(await makePdf(2), { letter: 'C' }),
      annexure(await makePdf(1), { letter: 'E' }),
    ]);
    const out = await appendPdfAnnexures(body, loaded, opts);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(7); // 4 body + 2 + 1
  });

  it('returns the body untouched when there is nothing to merge', async () => {
    const body = await makePdf(4);
    const out = await appendPdfAnnexures(body, [], opts);
    expect(out).toBe(body);
  });

  it('⚠️ NEVER LOSES THE MOTIVATION over a bad annexure', async () => {
    // If the merge cannot proceed the applicant still gets their document.
    const body = await makePdf(4);
    const out = await appendPdfAnnexures(
      body,
      [{ ...annexure(Buffer.from('junk')), pageCount: 1 }],
      opts,
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
  });

  it('keeps a page at its own size rather than resampling it', async () => {
    // Rescaling somebody's licence to fit A4 is how a serial number stops
    // being legible.
    const odd = await PDFDocument.create();
    odd.addPage([300, 500]);
    const { loaded } = await loadPdfAnnexures([
      annexure(Buffer.from(await odd.save())),
    ]);
    const out = await appendPdfAnnexures(await makePdf(1), loaded, opts);
    const doc = await PDFDocument.load(out);
    const last = doc.getPage(doc.getPageCount() - 1);
    expect(Math.round(last.getSize().width)).toBe(300);
    expect(Math.round(last.getSize().height)).toBe(500);
  });
});
