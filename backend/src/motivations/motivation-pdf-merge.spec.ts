import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  MAX_PAGES_PER_ANNEXURE,
  appendPdfAnnexures,
  captionFor,
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

/** Same as makePdf, at a distinctive size — so a page's origin is provable. */
async function makeSizedPdf(pages: number, w: number, h: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([w, h]);
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
    const out = await appendPdfAnnexures(body, [{ items: loaded }], opts);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(7); // 4 body + 2 + 1
  });

  it('inserts them where it is told, not at the end', async () => {
    // ⚠️ THE OPERATOR'S INSTRUCTION DEPENDS ON THIS. The take-with-you sheets
    // are rendered last by pdfkit and are meant to BE the last pages; before
    // this, the applicant's PDF annexures were appended after them and the
    // checklist ended up in the middle of the pack with annexures on both
    // sides of it.
    //
    // Proved by PAGE SIZE rather than by text: the merged pages are a
    // different size from the body's, so where each page came from is visible
    // in the output document itself. (Searching the bytes for the caption
    // cannot work — pdf-lib deflates the content streams.)
    const body = await makePdf(6); // 595 x 842
    const { loaded } = await loadPdfAnnexures([
      annexure(await makeSizedPdf(2, 400, 400), { letter: 'C' }),
      annexure(await makeSizedPdf(1, 400, 400), { letter: 'E' }),
    ]);
    const out = await appendPdfAnnexures(body, [{ items: loaded, insertAt: 4 }], {
      ...opts,
      bodyPageCount: 6,
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(9);

    const widths = Array.from({ length: 9 }, (_, i) =>
      Math.round(doc.getPage(i).getSize().width),
    );
    // Four body pages, then the three merged ones, then the two the body
    // ended with — the checklist, still at the back.
    expect(widths).toEqual([595, 595, 595, 595, 400, 400, 400, 595, 595]);
  });

  it('still appends when no insertion point is given', async () => {
    const body = await makePdf(4);
    const { loaded } = await loadPdfAnnexures([
      annexure(await makePdf(1), { letter: 'C' }),
    ]);
    const out = await appendPdfAnnexures(body, [{ items: loaded }], opts);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(5);
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
      [{ items: [{ ...annexure(Buffer.from('junk')), pageCount: 1 }] }],
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
    const out = await appendPdfAnnexures(await makePdf(1), [{ items: loaded }], opts);
    const doc = await PDFDocument.load(out);
    const last = doc.getPage(doc.getPageCount() - 1);
    expect(Math.round(last.getSize().width)).toBe(300);
    expect(Math.round(last.getSize().height)).toBe(500);
  });
});

// ────────────────────────────────────────────────────────────────────
// SEVERAL BLOCKS, AT SEVERAL PLACES.
//
// Operator, 2026-08-23: "The PDF also needs to be dynamic so we can add and
// remove things without breaking anything or ruining the structure of the
// document."
//
// ⚠️ THE FAILURE THIS GUARDS IS SILENT. Inserting at index 2 shifts everything
// from 2 onward, so a second block aimed at index 6 — computed against the
// ORIGINAL numbering, as every caller naturally does — lands at 8 unless the
// merge goes back to front. Nothing throws. The pages are simply in the wrong
// order, in a document somebody files with SAPS.
describe('more than one insertion point', () => {
  const opts = {
    referenceNumber: 'MO000017',
    templateVersion: 'tpl-test',
    bodyPageCount: 4,
  };

  it('puts every block where the CALLER meant, not where the previous one left it', async () => {
    const body = await makePdf(10);
    const early = await loadPdfAnnexures([annexure(await makePdf(2))]);
    const late = await loadPdfAnnexures([annexure(await makePdf(3))]);

    const out = await appendPdfAnnexures(
      body,
      [
        { items: early.loaded, insertAt: 2 },
        { items: late.loaded, insertAt: 6 },
      ],
      { ...opts, bodyPageCount: 10 },
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(15); // 10 + 2 + 3
  });

  it('is order-independent — the caller may list blocks any way round', async () => {
    const sizes = async () => {
      const body = await makePdf(8);
      const a = await loadPdfAnnexures([annexure(await makePdf(1))]);
      const b = await loadPdfAnnexures([annexure(await makePdf(2))]);
      return { body, a: a.loaded, b: b.loaded };
    };
    const one = await sizes();
    const two = await sizes();

    const forwards = await appendPdfAnnexures(
      one.body,
      [{ items: one.a, insertAt: 1 }, { items: one.b, insertAt: 5 }],
      { ...opts, bodyPageCount: 8 },
    );
    const backwards = await appendPdfAnnexures(
      two.body,
      [{ items: two.b, insertAt: 5 }, { items: two.a, insertAt: 1 }],
      { ...opts, bodyPageCount: 8 },
    );
    const f = await PDFDocument.load(forwards);
    const b = await PDFDocument.load(backwards);
    expect(f.getPageCount()).toBe(11);
    expect(b.getPageCount()).toBe(f.getPageCount());
  });

  it('still handles the single-block case the annexures use', async () => {
    const body = await makePdf(6);
    const { loaded } = await loadPdfAnnexures([annexure(await makePdf(2))]);
    const out = await appendPdfAnnexures(body, [{ items: loaded, insertAt: 4 }], {
      ...opts,
      bodyPageCount: 6,
    });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(8);
  });

  it('ignores an empty block rather than counting it', async () => {
    const body = await makePdf(3);
    const { loaded } = await loadPdfAnnexures([annexure(await makePdf(1))]);
    const out = await appendPdfAnnexures(
      body,
      [{ items: [], insertAt: 1 }, { items: loaded, insertAt: 2 }],
      { ...opts, bodyPageCount: 3 },
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(4);
  });
});

// ────────────────────────────────────────────────────────────────────
// WHAT THE STAMP IN THE TOP MARGIN SAYS.
//
// ⚠️ THIS SHIPPED WRONG AND NO TEST COULD HAVE CAUGHT IT. The caption was
// built inline inside the draw call, and pdf-lib deflates content streams —
// so the string is not findable in the output bytes. It was found by
// extracting the text of a real rendered pack and reading it, the same way
// the two titleCase bugs were found. Hence the exported function.
describe('the caption on a merged page', () => {
  const base = { letter: 'C', label: 'Your letter of good standing', index: 1, total: 1 };

  it('names an annexure by its letter', () => {
    expect(captionFor(base)).toBe('Annexure C — Your letter of good standing');
  });

  it('counts the parts when a letter spans several documents', () => {
    expect(captionFor({ ...base, index: 2, total: 3 })).toBe(
      'Annexure C — Your letter of good standing (2 of 3)',
    );
  });

  it('⚠️ says NOTHING about annexures for body content', () => {
    // Operator, 2026-08-23, on the C.I.P. cartridge sheet: "it not an
    // annexure. Its part of the motivation itself just giving information
    // about the cartridge." The old template produced "Annexure  — The
    // cartridge — 308 Win." — wrong word, and a double space where the
    // letter should have been.
    const cip = { letter: '', label: 'The cartridge — 308 Win.', index: 1, total: 1 };
    expect(captionFor(cip)).toBe('The cartridge — 308 Win.');
    expect(captionFor(cip)).not.toMatch(/annexure/i);
    expect(captionFor(cip)).not.toMatch(/ {2}/);
  });

  it('still counts parts for a letterless block spanning pages', () => {
    expect(captionFor({ letter: '', label: 'The cartridge', index: 1, total: 2 })).toBe(
      'The cartridge (1 of 2)',
    );
  });
});
