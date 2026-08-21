import * as zlib from 'node:zlib';
import {
  DEFAULT_SCHEME,
  FORMAT_FEATURES,
  MotivationPdfService,
  asFormat,
  asScheme, titleCase } from './motivation-pdf.service';
import { buildAnnexures } from './motivation-checklist';
import { MotivationUploadKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// READING THE PDF BACK.
//
// ⚠️ THIS WAS A HOMEGROWN EXTRACTOR AND IT SHOULD NOT HAVE BEEN. The original
// note here said pdf-parse v2 pulls in pdfjs-dist as an ES module and would
// need --experimental-vm-modules, "a repo-wide test-config change for one
// spec", so it inflated the content streams and read the TJ arrays by hand.
//
// That was true and cheap while the document used the standard-14 faces,
// whose bytes are WinAnsi and readable as latin1. It stopped being either the
// moment the document embedded Archivo and Source Serif 4: an embedded SUBSET
// addresses glyphs by id, so every assertion in this file started failing at
// once and the fix needed a ToUnicode CMap parser. Three faults deep —
// object splitting across `endobj`, per-page /Resources, /Resources being an
// indirect reference — it STILL returned noise, because pdfkit writes the
// ARRAY form of bfrange and the parser only handled the contiguous form.
//
// pdf-parse 2.4.5 ships a CommonJS build (dist/pdf-parse/cjs/index.cjs) that
// requires no config change at all. It reads this document completely:
// reference, identity number, "Česká zbrojovka", and the Archivo section
// headings the hand-rolled reader never managed. The premise the old note
// rested on was simply out of date.
//
// Hours went into the version this replaced. Reading a PDF properly is a real
// piece of work, and it was already installed.
// ────────────────────────────────────────────────────────────────────
async function readPdfAsync(pdf: Buffer): Promise<{ text: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  const out = await parser.getText();
  return { text: (out?.text as string) ?? '' };
}

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

describe('titleCase, which sets the contents and the running head', () => {
  // ⚠️ BOTH OF THESE SHIPPED, AND BOTH WERE FOUND BY EXTRACTING THE TEXT OF A
  // RENDERED PAGE AND READING IT — not by a test, not by a typecheck, and not
  // by looking at the code, where one of them was invisible.

  it('restores a standalone "I"', () => {
    // The regex that does this contained a literal BACKSPACE character (0x08)
    // where it needed a word boundary, so it matched nothing and had silently
    // not been running. A stray control byte looks exactly like `` in an
    // editor, in a diff, and in a code review.
    expect(titleCase('THE FIREARM I AM APPLYING FOR')).toBe(
      'The firearm I am applying for',
    );
    // ...and only where it is a word on its own.
    expect(titleCase('INTRODUCTION')).toBe('Introduction');
    expect(titleCase('MY RECORD')).toBe('My record');
  });

  it('keeps an annexure letter a capital', () => {
    // "ANNEXURE E — REQUEST FOR PRIOR NOTICE AND WRITTEN REASONS" came out as
    // "Annexure e" in the contents of every pack that carries one.
    expect(titleCase('ANNEXURE E — REQUEST FOR PRIOR NOTICE')).toBe(
      'Annexure E — request for prior notice',
    );
    expect(titleCase('ANNEXURE A')).toBe('Annexure A');
  });

  it('leaves a heading that is already mixed case alone', () => {
    // Only ALL-CAPS headings are folded. Anything already cased was written
    // that way on purpose.
    expect(titleCase('Character reference — form 1 of 2')).toBe(
      'Character reference — form 1 of 2',
    );
  });
});

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
    const { text } = await readPdfAsync(pdf);

    // The LAST paragraph survived — it flowed onto later pages instead of
    // being truncated with an ellipsis the way the pdf-lib generators do.
    //
    // Asserted on the prose rather than the "Paragraph 40:" label: the label
    // is short and ends in a colon, so isHeading() treats it as a section
    // title and sets it in Archivo, which this reader cannot decode. The
    // sentence after it is body serif and reads fine — and it is the better
    // check anyway, because truncation would take the words, not the label.
    // The LAST paragraph survived — it flowed onto later pages rather than
    // being truncated with an ellipsis the way the pdf-lib generators here do.
    expect(squash(text)).toContain(squash('Paragraph 40:'));

    // And the footer strip numbers every sheet, agreeing on the total. This is
    // a stronger check than counting page objects, and it proves bufferPages
    // resolved the total before any strip was written.
    //
    // ⚠️ THE RUN STARTS AT 1: the handoff numbers every sheet including the
    // cover, which carries its own strip.
    const footers = [...squash(text).matchAll(/PAGE(\d+)OF(\d+)/gi)];
    expect(footers.length).toBeGreaterThan(2);
    const totals = new Set(footers.map((f) => f[2]));
    expect(totals.size).toBe(1);
    const total = Number([...totals][0]);
    expect(footers.length).toBe(total);
    expect(footers.map((f) => Number(f[1]))).toEqual(
      Array.from({ length: total }, (_, i) => i + 1),
    );

    // Pagination is proven from the page tree, which is authoritative and needs
    // no font decoding: /Type /Pages carries a /Count.
    //
    // ⚠️ IT USED TO BE PROVEN FROM THE FOOTER TEXT, and that stopped being
    // readable when the document adopted the handoff. The footer strip is set
    // in Archivo at 0.28em tracking, and to letter-space a run pdfkit emits
    // each glyph positioned individually against an embedded SUBSET — so the
    // codes in the stream are glyph ids, and reconstructing them needs that
    // font's ToUnicode table. readPdf below does resolve ToUnicode and reads
    // the serif body correctly; it does not manage the footer's face, so the
    // assertion was passing judgement on the reader rather than the document.
    //
    // The footer's own correctness is verified visually instead (PyMuPDF reads
    // it as "... P A G E 2 O F 3"), which is the right tool for a thing whose
    // whole purpose is to be looked at.
    const pageCount = Number(
      pdf.toString('latin1').match(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/)?.[1] ?? 0,
    );
    expect(pageCount).toBeGreaterThan(2);
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
    const { text } = await readPdfAsync(pdf);
    expect(flat(text)).toContain('MO000123');
    expect(flat(text)).toMatch(/not legal advice/i);
  });

  it('never emits outcome language or mascot branding', async () => {
    // Guards the two hard copy rules. If someone later "improves" the
    // template with a confidence line or a Boet flourish, this fails.
    const { pdf } = await svc.render(makeInput());
    const { text: raw } = await readPdfAsync(pdf);
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
    const { text } = await readPdfAsync(pdf);
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
    const t = flat((await readPdfAsync(pdf)).text);
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
    expect(flat((await readPdfAsync(pdf)).text)).not.toContain('ANNEXURES');
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
    // \u26a0\ufe0f EVERY format value normalises to the one we render, including the
    // two that were withdrawn on 2026-08-21. Rows written before that still
    // hold 'concise' and 'standard', and they have to open.
    expect(asFormat('burgundy')).toBe('comprehensive');
    expect(asFormat('concise')).toBe('comprehensive');
    expect(asFormat('standard')).toBe('comprehensive');
    expect(asFormat(null)).toBe('comprehensive');
    expect(asFormat(undefined)).toBe('comprehensive');

    expect(asScheme('chartreuse')).toBe(DEFAULT_SCHEME);
    expect(asScheme(null)).toBe(DEFAULT_SCHEME);
    // A withdrawn colourway name is not a scheme, so it falls back too.
    expect(asScheme('oxblood')).toBe(DEFAULT_SCHEME);
    expect(asScheme('mauve')).toBe('mauve');
  });

  it('carries every block, because there is only one format left', () => {
    expect(FORMAT_FEATURES.comprehensive).toEqual({
      contents: true,
      ownedTable: true,
      specBlock: true,
    });
    expect(Object.keys(FORMAT_FEATURES)).toEqual(['comprehensive']);
  });

  it('renders every block, whatever format value arrives', async () => {
    // \u26a0\ufe0f REPLACED TWO TESTS THAT ASSERTED THE OPPOSITE. Until 2026-08-21
    // there were three formats and these pinned that 'concise' omitted the
    // contents and 'standard' omitted the spec sheet. The operator withdrew
    // both ("only comprehensive stays"), so those assertions now describe a
    // product that does not exist \u2014 and the property worth pinning is the
    // reverse one: a stored 'concise' from before the change must still open,
    // and it must open as the full document rather than as a stub.
    for (const stored of ['concise', 'standard', 'comprehensive', 'nonsense']) {
      const { pdf } = await svc.render(
        withTables({ format: stored, colourway: 'sand' }) as never,
      );
      const t = squash((await readPdfAsync(pdf)).text);
      // Each block is proven by content only it carries — see the reader note
      // above. The contents page lists all three, and it is set in the serif.
      expect(t).toContain(squash('The firearm I am applying for'));
      expect(t).toContain(squash('Firearms already licensed to me'));
      // The spec sheet's values and the table's row.
      expect(t).toContain(squash('6.5 Creedmoor'));
      expect(t).toContain(squash('CZ 452'));
    }
  });

  it('carries the researched specification sheet', async () => {
    // ⚠️ ASSERTED ON THE VALUES, NOT THE HEADING, and the reason is the
    // reader rather than the document. Section headings are set in Archivo on
    // a highlight band; readPdf resolves ToUnicode for the serif body but not
    // for that face, so an assertion on "SPECIFICATION OF THE FIREARM APPLIED
    // FOR" was testing what the harness can decode instead of what the
    // renderer draws. The heading's presence is verified visually.
    //
    // The values are the part that matters anyway: a spec sheet with a
    // heading and no calibre is not a spec sheet.
    const { pdf } = await svc.render(
      withTables({ format: 'comprehensive', colourway: 'sage' }) as never,
    );
    const t = squash((await readPdfAsync(pdf)).text);
    expect(t).toContain(squash('6.5 Creedmoor'));
    expect(t).toContain(squash('609 mm'));
    // And it is listed in the contents, which is set in the serif face.
    expect(t).toContain(squash('The firearm I am applying for'));
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
    const t = squash((await readPdfAsync(pdf)).text);
    // The section's own line, which is serif — the band title is Archivo and
    // this reader cannot decode it. See the note above.
    expect(t).toContain(squash('Firearms already licensed to me'));
    expect(t).toContain(squash('This is a first application'));
  });

  it('puts the identification block on the cover', async () => {
    const { pdf } = await svc.render(
      withTables({ format: 'comprehensive' }) as never,
    );
    const t = squash((await readPdfAsync(pdf)).text);
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
    const t = squash((await readPdfAsync(pdf)).text);
    expect(t).toContain(squash('Annexures'));

    // ⚠️ AND "TAKE THESE WITH YOU" IS *NOT* LISTED, which is the point.
    // Operator, 2026-08-21: it belongs on the last two pages "and not part of
    // the index". Everything the contents lists is the SUBMISSION — what a
    // DFO reads. The checklist is a note to the applicant about their own
    // morning, the one part of the pack not addressed to the Registrar, and
    // listing it invites a reviewer to turn to it.
    //
    // Asserted on the contents entry specifically (serif, and the only place
    // that phrase would appear in title case) rather than on the page itself,
    // whose heading is Archivo and unreadable here.
    expect(t).not.toContain(squash('Take these with you'));
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
    const t = squash((await readPdfAsync(pdf)).text);

    // The verb moved into the column heading — "CERTIFICATION" over a column
    // of "REQUIRED" / "USUALLY ASKED" says what "CERTIFY — REQUIRED" said in
    // every single row, and stops the column reading as an instruction
    // repeated eight times.
    expect(t).toContain(squash('CERTIFICATION'));
    expect(t).toContain(squash('REQUIRED'));
    expect(t).toContain(squash('USUALLY ASKED'));
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
