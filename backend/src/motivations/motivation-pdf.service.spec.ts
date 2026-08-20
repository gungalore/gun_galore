import * as zlib from 'node:zlib';
import {
  FORMAT_FEATURES,
  MotivationPdfService,
  asColourway,
  asFormat,
} from './motivation-pdf.service';
import { buildAnnexures } from './motivation-checklist';
import { MotivationUploadKind } from '@prisma/client';

// pdfkit compresses its content streams (FlateDecode), so grepping the raw
// bytes for text finds nothing — the first draft of this spec failed for
// exactly that reason.
//
// We inflate the streams and pull the text-showing operators out ourselves.
// pdf-parse (a dependency, used by the reloading importer) would be the
// obvious tool, but its v2 pulls in pdfjs-dist as an ES module and Jest needs
// --experimental-vm-modules to load it; that is a repo-wide test-config change
// for one spec, so we do the small thing instead. This also keeps the
// assertions honest: we read what the renderer actually EMITTED under its real
// production settings, with no compression flag flipped for the test's benefit.
//
// It returns TEXT ONLY. An earlier version also reported a page count taken
// from `/Type /Page` (and later `/Count`) in the raw bytes; both over-counted,
// reading a 6-page document as 12, because pdfkit rewrites the page tree when
// bufferPages stamps the footers. The footers themselves are the authoritative
// record, so the pagination test reads those instead of trusting a number this
// helper cannot derive honestly.
function readPdf(pdf: Buffer): { text: string } {
  const raw = pdf.toString('latin1');
  let text = '';
  // Each `stream ... endstream` body is deflated. Inflate what we can; skip
  // anything that isn't a content stream (fonts, metadata) without failing.
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      const inflated = zlib
        .inflateSync(Buffer.from(m[1], 'latin1'))
        .toString('latin1');
      // pdfkit does NOT write `(literal) Tj`. It kerns, so each run comes out
      // as a TJ array of HEX strings with numeric adjustments between them:
      //   [<554e4951> 10 <55454d41524b45...> 0] TJ
      // Concatenating the hex chunks reassembles the line.
      for (const tj of inflated.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        for (const hex of tj[1].matchAll(/<([0-9A-Fa-f]+)>/g)) {
          text += Buffer.from(hex[1], 'hex').toString('latin1');
        }
        text += '\n';
      }
    } catch {
      /* not a deflated content stream — ignore */
    }
  }
  return { text: decodeWinAnsi(text) };
}

/**
 * WinAnsi bytes 0x80-0x9F, decoded back to the characters they mean.
 *
 * ⚠️ WITHOUT THIS, AN ASSERTION ON AN EM-DASH FAILS AGAINST A DOCUMENT THAT
 * IS CORRECT, and the failure is unreadable. pdfkit writes the standard-14
 * fonts in WinAnsiEncoding, where an em-dash is the single byte 0x97. The
 * loop above reassembles runs as latin1, and in latin1 0x97 is a C1 control
 * character: invisible in a terminal, not whitespace, so squash leaves it
 * sitting between the words. Jest then reports "expected CERTIFY — REQUIRED,
 * received ..." against a string that looks character-for-character identical
 * when printed, and the real difference only shows up in charCodeAt.
 *
 * That cost a real debugging session. Only the punctuation our own copy
 * actually emits is mapped; anything else in the range is left alone, so a
 * future surprise stays visible rather than being silently rewritten.
 */
const WIN_ANSI: Record<number, string> = {
  0x85: '\u2026',
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201C',
  0x94: '\u201D',
  0x96: '\u2013',
  0x97: '\u2014',
};
const decodeWinAnsi = (s: string) =>
  s.replace(/[\u0080-\u009F]/g, (c) => WIN_ANSI[c.charCodeAt(0)] ?? c);

// Collapse whitespace before asserting on phrases.
const flat = (s: string) => s.replace(/\s+/g, ' ');

// JUSTIFIED paragraphs need this instead. To justify a line pdfkit positions
// every word separately, so the inter-word spaces are POSITIONING, not
// characters — they never appear in the text stream at all and "Paragraph 40:"
// extracts as "Paragraph40:". The rendered page is correct; only extraction
// loses them. Ragged text (headings, the footer, the applicant block) keeps
// its spaces, so those assertions use flat().
const squash = (s: string) => s.replace(/\s+/g, '');

// The point of this spec is to prove the thing the blueprint flagged as the
// single biggest unknown: pdfkit renders MULTI-PAGE flowing prose on this
// stack, resolving its standard-font metrics out of node_modules at runtime.
// pdf-lib could not do this without a hand-written layout engine.

const DISCLAIMER =
  'This document was prepared from information supplied by the applicant. ' +
  'It is not legal advice. The applicant confirms the facts stated are true ' +
  'and correct and submits this motivation as their own.';

function makeInput(bodyOverride?: string) {
  return {
    referenceNumber: 'MO000123',
    applicantName: 'Gerhard Johan Petrus Fourie',
    licenceTypeLabel: 'Section 16 — Dedicated Hunter',
    body:
      bodyOverride ??
      [
        'Introduction:',
        'I am applying for a licence in terms of section 16 of the Firearms Control Act, 2000. ' +
          'I have been a member of a recognised hunting association since 2019 and hunt plains game ' +
          'in the Free State and Northern Cape between four and six times a year.',
        'Experience and training:',
        'I completed my competency training in 2018 and have since logged twenty-eight hunts. ' +
          'The rifle I am applying for is a bolt-action chambered in .308 Winchester, which suits ' +
          'the species and ranges described above.',
        'Safe storage:',
        'The firearm will be stored in a SABS-approved safe bolted to a brick wall in a locked ' +
          'room at my residence. No other person has the combination.',
      ].join('\n\n'),
    disclaimer: DISCLAIMER,
    templateVersion: 'tpl-2026-08-a',
    generatedAt: new Date('2026-08-18T08:00:00Z'),
  };
}

describe('MotivationPdfService', () => {
  const svc = new MotivationPdfService();

  it('renders a real PDF and names the file after the document number', async () => {
    const { pdf, filename } = await svc.render(makeInput());
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(filename).toBe('motivation-MO000123.pdf');
  });

  it('paginates long prose instead of truncating it', async () => {
    // ~40 substantial paragraphs — several pages. The pdf-lib generators in
    // this repo would slice this to one page and append an ellipsis.
    const long = Array.from(
      { length: 40 },
      (_, i) =>
        `Paragraph ${i + 1}: ` +
        'I have hunted this property for several seasons and know the terrain well. '.repeat(6),
    ).join('\n\n');
    const { pdf } = await svc.render(makeInput(long));
    const { text } = readPdf(pdf);

    // The LAST paragraph survived — it flowed onto later pages instead of
    // being truncated with an ellipsis the way the pdf-lib generators do.
    expect(squash(text)).toContain(squash('Paragraph 40:'));

    // Pagination is proven from the footers we stamp: they must all agree on
    // the total, and the page numbers must be a complete run with no gaps or
    // repeats. That is a stronger check than counting page objects in the
    // bytes, and it also proves bufferPages resolved the total before any
    // footer was written.
    //
    // ⚠️ THE RUN STARTS AT 2, NOT 1, AND THAT IS THE POINT OF THE COVER. The
    // cover IS page 1 of the pack — it is a sheet, it counts toward the total
    // a DFO checks against — but it carries no footer, because "Page 1 of 8"
    // printed under a title is what a word processor does and not what a
    // bound submission does. So the assertion is: N-1 footers, numbered 2..N,
    // all claiming a total of N. A footer appearing on the cover, or the run
    // starting anywhere but 2, is a regression.
    //
    // Case-insensitive: the footer reads "Page N of M" since the layout was
    // measured off Safari Outdoor, whose footer capitalises it.
    const footers = [...flat(text).matchAll(/page (\d+) of (\d+)/gi)];
    expect(footers.length).toBeGreaterThan(2);
    const totals = new Set(footers.map((f) => f[2]));
    expect(totals.size).toBe(1);
    const total = Number([...totals][0]);
    expect(footers.length).toBe(total - 1);
    expect(footers.map((f) => Number(f[1]))).toEqual(
      Array.from({ length: total - 1 }, (_, i) => i + 2),
    );
  });

  it('is deterministic — same input, same bytes', async () => {
    // generatedAt is injected rather than read from the clock precisely so a
    // re-render of a stored document is reproducible. Nothing is stored, so
    // every download re-renders; a wobbling document would be a bug.
    const a = await svc.render(makeInput());
    const b = await svc.render(makeInput());
    expect(a.pdf.length).toBe(b.pdf.length);
  });

  it('carries the disclaimer and the document reference', async () => {
    const { pdf } = await svc.render(makeInput());
    const { text } = readPdf(pdf);
    expect(flat(text)).toContain('MO000123');
    expect(flat(text)).toMatch(/not legal advice/i);
  });

  it('never emits outcome language or mascot branding', async () => {
    // Guards the two hard copy rules. If someone later "improves" the
    // template with a confidence line or a Boet flourish, this fails.
    const { pdf } = await svc.render(makeInput());
    const { text: raw } = readPdf(pdf);
    const text = flat(raw).toLowerCase();
    for (const banned of [
      'boet',
      'improves your chance',
      'approval likely',
      'success rate',
      'guarantee',
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it('renders the applicant real name (documented exception to username-only)', async () => {
    const { pdf } = await svc.render(makeInput());
    const { text } = readPdf(pdf);
    expect(flat(text)).toContain('Gerhard Johan Petrus Fourie');
  });
});

describe('the annexure index', () => {
  const svc = new MotivationPdfService();

  it('lists the annexures at the end of the printed document', async () => {
    // The INDEX belongs in the paper — a reviewer holding it needs to find what
    // the body cross-references. The CHECKLIST does not: it lives on the
    // platform and in the PWA, because the pack stays digital until printed.
    const kinds = [
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.SAFE_PHOTO_AJAR,
      MotivationUploadKind.SAFE_PHOTO_BOLTS,
    ];
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures(kinds),
    });
    const t = flat(readPdf(pdf).text);
    expect(t).toContain('ANNEXURES');
    expect(t).toContain('Annexure A');
    // Several files of one kind still fold under one letter with a count.
    expect(t).toMatch(/Copy of your ID \(2 items\)/i);
    // The safe folds too, as of 2026-08-20: one letter, a count, and the
    // individual shots captioned "(1 of 3)" on the printed copies. It used to
    // spend a letter per shot, which pushed every later annexure down and put
    // our index out of step with the one a DFO reads every day.
    expect(t).toMatch(/Annexure B\s*Photographs of your safe \(3 items\)/i);
    // The index stops at B: nothing after the safe, because the safe no
    // longer eats C and D.
    expect(t).not.toMatch(/Annexure C/i);
    // And no checklist page.
    expect(t).not.toContain('SUBMISSION CHECKLIST');
  });

  it('renders a bare document when there are no annexures', async () => {
    const { pdf } = await svc.render(makeInput());
    expect(flat(readPdf(pdf).text)).not.toContain('ANNEXURES');
  });
});

// ────────────────────────────────────────────────────────────────────
// THE TEMPLATE THE APPLICANT PICKED.
//
// Five colourways x three formats. The formats are not skins — they are
// different SECTION SETS over the same argument, so what is proven here is
// which sections appear, not which colours were used. Colour is proven only at
// the boundary (an unknown value must never fail a download), because
// asserting on a fill operator inside a compressed content stream would be a
// test of pdfkit rather than of us.
// ────────────────────────────────────────────────────────────────────

describe('template choice', () => {
  const svc = new MotivationPdfService();

  const withTables = (extra: Record<string, unknown>) => ({
    ...makeInput(),
    idNumber: '8203155041083',
    ownedFirearms: [
      {
        make: 'CZ 452',
        calibre: '.22 LR',
        type: 'Bolt-action rifle',
        section: 'Licence 4000112233',
      },
    ],
    firearmSpec: [
      { label: 'Calibre', value: '6.5 Creedmoor' },
      { label: 'Barrel length', value: '609 mm' },
    ],
    ...extra,
  });

  it('falls back rather than failing on a value the column should not hold', () => {
    // ⚠️ THE COLUMNS ARE PLAIN VARCHARs so that adding a template costs no
    // migration — which means they can hold a typo, or a colourway we later
    // withdrew. Neither may take a download down: somebody clicking "get my
    // PDF" gets a PDF.
    expect(asFormat('burgundy')).toBe('standard');
    expect(asFormat(null)).toBe('standard');
    expect(asFormat(undefined)).toBe('standard');
    expect(asFormat('comprehensive')).toBe('comprehensive');

    expect(asColourway('chartreuse')).toBe('slate');
    expect(asColourway(null)).toBe('slate');
    expect(asColourway('oxblood')).toBe('oxblood');
  });

  it('gives the three formats three different section sets', () => {
    // The contract the renderer reads. Stated here so a future edit that makes
    // all three identical fails loudly rather than shipping one document under
    // three names.
    expect(FORMAT_FEATURES.concise).toEqual({
      contents: false,
      ownedTable: false,
      specBlock: false,
    });
    expect(FORMAT_FEATURES.comprehensive).toEqual({
      contents: true,
      ownedTable: true,
      specBlock: true,
    });
    expect(FORMAT_FEATURES.standard.ownedTable).toBe(true);
    expect(FORMAT_FEATURES.standard.specBlock).toBe(false);
  });

  it('concise omits the contents, the owned table and the spec block', async () => {
    const { pdf } = await svc.render(
      withTables({ format: 'concise', colourway: 'ochre' }) as never,
    );
    const t = squash(readPdf(pdf).text);
    expect(t).not.toContain(squash('CONTENTS'));
    expect(t).not.toContain(squash('FIREARMS ALREADY LICENSED'));
    expect(t).not.toContain(squash('SPECIFICATION OF THE FIREARM'));
    // The argument itself is untouched — a shorter pack is not a weaker one.
    expect(t).toContain(squash('INTRODUCTION'));
  });

  it('standard adds the contents and the owned table but not the spec sheet', async () => {
    const { pdf } = await svc.render(
      withTables({ format: 'standard', colourway: 'navy' }) as never,
    );
    const t = squash(readPdf(pdf).text);
    expect(t).toContain(squash('CONTENTS'));
    expect(t).toContain(squash('FIREARMS ALREADY LICENSED'));
    expect(t).toContain(squash('CZ 452'));
    expect(t).not.toContain(squash('SPECIFICATION OF THE FIREARM'));
  });

  it('comprehensive adds the researched specification sheet', async () => {
    const { pdf } = await svc.render(
      withTables({ format: 'comprehensive', colourway: 'forest' }) as never,
    );
    const t = squash(readPdf(pdf).text);
    expect(t).toContain(squash('SPECIFICATION OF THE FIREARM APPLIED FOR'));
    expect(t).toContain(squash('6.5 Creedmoor'));
    expect(t).toContain(squash('609 mm'));
  });

  it('prints the first-application line rather than dropping the section', async () => {
    // ⚠️ AN EMPTY TABLE IS EVIDENCE. Section 13(3) caps a self-defence
    // applicant at one firearm; "this applicant holds none" is a material fact
    // on a first application, and omitting the section because there is
    // nothing to list would read to a DFO as an omission rather than a nil
    // return.
    const { pdf } = await svc.render(
      withTables({ format: 'standard', ownedFirearms: [] }) as never,
    );
    const t = squash(readPdf(pdf).text);
    expect(t).toContain(squash('FIREARMS ALREADY LICENSED TO THE APPLICANT'));
    expect(t).toContain(squash('This is a first application'));
  });

  it('puts the identification block on the cover', async () => {
    const { pdf } = await svc.render(
      withTables({ format: 'comprehensive' }) as never,
    );
    const t = squash(readPdf(pdf).text);
    expect(t).toContain(squash('8203155041083'));
    expect(t).toContain(squash('MOTIVATION'));
  });

  it('lists the back matter in the contents, not only the body sections', async () => {
    // A reviewer looking for the annexure index should find it from the
    // contents page rather than thumbing to the end.
    const { pdf } = await svc.render(
      withTables({
        format: 'comprehensive',
        annexures: buildAnnexures([MotivationUploadKind.IDENTITY_DOCUMENT]),
        takeWithYou: [{ label: 'Two passport photographs' }],
      }) as never,
    );
    const t = squash(readPdf(pdf).text);
    expect(t).toContain(squash('Annexures'));
    expect(t).toContain(squash('Take these with you'));
  });
});

describe('the certification column on the annexure index', () => {
  const svc = new MotivationPdfService();

  it('separates what the Regulations require from what stations ask for', async () => {
    // ⚠️ THIS DISTINCTION IS THE WHOLE POINT. Regulation 13(4)(b) requires a
    // certified copy of the IDENTITY DOCUMENT. Telling an applicant that six
    // documents are legally required to be certified would be the same
    // confident-sounding wrongness the firearms-law discipline exists to
    // prevent — and it sends people to a commissioner of oaths to get
    // photographs of their own safe stamped.
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures([
        MotivationUploadKind.IDENTITY_DOCUMENT,
        MotivationUploadKind.COMPETENCY_CERTIFICATE,
        MotivationUploadKind.SAFE_PHOTO_CLOSED,
      ]),
    } as never);
    const t = squash(readPdf(pdf).text);

    expect(t).toContain(squash('CERTIFY — REQUIRED'));
    expect(t).toContain(squash('Certify — usually asked'));
    expect(t).toContain(squash('Regulation 13(4)(b)'));
  });

  it('marks the ID as required and the safe photographs as neither', () => {
    const entries = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.GOOD_STANDING_LETTER,
    ]);
    const by = (k: MotivationUploadKind) =>
      entries.find((e) => e.kind === k)?.certification;

    // The one the Regulations name.
    expect(by(MotivationUploadKind.IDENTITY_DOCUMENT)).toBe('required');
    // A copy of an original: practice, not law.
    expect(by(MotivationUploadKind.COMPETENCY_CERTIFICATE)).toBe('expected');
    // Nobody certifies a photograph of their own safe against an original
    // photograph, and a letter of good standing IS the original.
    expect(by(MotivationUploadKind.SAFE_PHOTO_CLOSED)).toBe('none');
    expect(by(MotivationUploadKind.GOOD_STANDING_LETTER)).toBe('none');
  });
});
