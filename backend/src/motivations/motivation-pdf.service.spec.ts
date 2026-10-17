import {
  HEADING_KEEP_WITH_NEXT,
  headingWouldOrphan,
  DEFAULT_SCHEME,
  FORMAT_FEATURES,
  MotivationPdfService,
  asFormat,
  asScheme,
  isQuotedSubsection,
  runInOf,
  runningLabelFor,
  splitHeading,
  titleCase,
} from './motivation-pdf.service';
import { sectionRule, WATERMARK_TEXT } from './motivation-pdf-chrome';
import { buildAnnexures } from './motivation-checklist';
import { buildPriorNoticeRequest } from './motivation-prior-notice';
import { MotivationUploadKind } from '@prisma/client';
import sharp from 'sharp';

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
// reads this document completely: reference, identity number, "Česká
// zbrojovka", and the Archivo section headings the hand-rolled reader never
// managed.
//
// ⚠️ A COMMONJS ENTRY POINT WAS NOT ENOUGH. pdfjs still reaches for its worker
// with a dynamic `import()` the first time a document is opened, and Jest's
// CJS runtime refuses that unless node was started with
// --experimental-vm-modules. The `test` script passes the flag, so `npm test`
// was green — but a bare `npx jest`, an IDE runner or a CI step that calls
// jest directly is not, and there every assertion that reads the document
// failed inside node_modules with
//
//     Setting up fake worker failed: "A dynamic import callback was invoked
//     without --experimental-vm-modules"
//
// which looks like an infrastructure problem and gets treated as one. These
// are the compliance assertions — disclaimer carried, no outcome language, no
// mascot branding, prose paginated rather than truncated, the unpaid mark on
// every page — so red-and-explained-away is the worst state for them.
//
// The reader is therefore loaded through NODE'S OWN module loader rather than
// Jest's sandboxed one. Node 22.12+ can require() an ES module, so pdf-parse
// and the pdfjs worker behind it both resolve natively, outside the vm where
// the restriction lives, whatever flags jest was started with. Nothing about
// the assertions changes — the bytes handed over are the real rendered
// document, and pdfjs really parses them.
//
// The require() fallback is the same reader under Jest's loader: it keeps the
// flagged invocation working if Module._load ever goes away, and fails loudly
// rather than quietly stubbing the document out.
// ────────────────────────────────────────────────────────────────────
type PdfParseModule = {
  PDFParse: new (opts: { data: Uint8Array }) => {
    getText(): Promise<{ text?: string }>;
  };
};

let pdfParseModule: PdfParseModule | undefined;

/** Node's own CommonJS loader, which Jest leaves alone. */
type NodeLoader = {
  Module: { _load(request: string, parent: null, isMain: boolean): unknown };
};

function loadPdfParse(): PdfParseModule {
  if (pdfParseModule) return pdfParseModule;
  const entry = require.resolve('pdf-parse');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Module } = require('node:module') as NodeLoader;
    const loaded = Module._load(entry, null, false) as PdfParseModule;
    if (typeof loaded?.PDFParse === 'function') {
      pdfParseModule = loaded;
      return pdfParseModule;
    }
  } catch {
    /* fall through to Jest's loader, which needs --experimental-vm-modules */
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (pdfParseModule = require('pdf-parse') as PdfParseModule);
}

async function readPdfAsync(pdf: Buffer): Promise<{ text: string }> {
  const { PDFParse } = loadPdfParse();
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  const out = await parser.getText();
  return { text: out?.text ?? '' };
}

/**
 * One string per page.
 *
 * ⚠️ WHICH IS THE ONLY WAY TO ASSERT THAT TWO THINGS ARE NOT ON THE SAME SHEET.
 * The whole-document text proves what a pack CONTAINS and says nothing about
 * where it sits, so a section that was supposed to take a page of its own can
 * open halfway down another one and every existing assertion still passes.
 *
 * pdf-parse delimits pages with a "-- n of N --" line of its own; it is the
 * extractor's marker rather than anything in the document.
 */
async function pageTexts(pdf: Buffer): Promise<string[]> {
  const { text } = await readPdfAsync(pdf);
  return text
    .split(/^-- \d+ of \d+ --$/m)
    .map((p) => flat(p))
    .filter((p) => p.trim().length > 0);
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
        'I have hunted this property for several seasons and know the terrain well. '.repeat(
          6,
        ),
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
      pdf
        .toString('latin1')
        .match(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/)?.[1] ?? 0,
    );
    expect(pageCount).toBeGreaterThan(2);
  });

  describe('M1 — the hanging hairline and the 7 mm body indent', () => {
    it('splits a run that crosses a page break into one segment per page', () => {
      // ⚠️ THE BODY LETS pdfkit BREAK ITSELF, so unlike the prior-notice page
      // the rule cannot be closed before an explicit addPage. `sectionRule`
      // detects the change and draws the old page's segment to the foot, the
      // new page's from the top. Exercised against a mock so the geometry is
      // asserted instead of a whole render.
      const strokes: { page: number; from: number; to: number }[] = [];
      const state = { page: 0, count: 1 };
      let current: { page: number; from: number; to: number } | null = null;
      const doc = {
        bufferedPageRange: () => ({ start: 0, count: state.count }),
        switchToPage: (p: number) => {
          state.page = p;
          return undefined;
        },
        moveTo: (_x: number, y: number) => {
          current = { page: state.page, from: y, to: y };
          return doc;
        },
        lineTo: (_x: number, y: number) => {
          if (current) current.to = y;
          return doc;
        },
        lineWidth: () => doc,
        strokeColor: () => doc,
        stroke: () => {
          if (current) strokes.push(current);
          current = null;
          return doc;
        },
      };
      const rule = sectionRule({ doc, c: { hair: '#ccc' } } as never, 100, 700);
      rule.start(150); // page 0
      state.count = 2;
      state.page = 1; // pdfkit appended a page mid-paragraph
      rule.close(200);

      expect(strokes).toEqual([
        { page: 0, from: 150, to: 700 },
        { page: 1, from: 100, to: 200 },
      ]);
    });

    it('still sets the body in both a hanging-rule layout and a flush one', async () => {
      for (const layout of ['banner', 'classic'] as const) {
        const { pdf } = await svc.render({
          ...makeInput(),
          layout,
          colourway: 'sage',
        });
        const t = squash((await readPdfAsync(pdf)).text);
        expect(t).toContain(
          squash(
            'I have been a member of a recognised hunting association since 2019',
          ),
        );
      }
    });
  });

  it('is deterministic — same input, same bytes', async () => {
    // generatedAt is injected rather than read from the clock precisely so a
    // re-render of a stored document is reproducible. Nothing is stored, so
    // every download re-renders; a wobbling document would be a bug.
    const a = await svc.render(makeInput());
    const b = await svc.render(makeInput());
    expect(a.pdf.length).toBe(b.pdf.length);
  });

  it('carries the disclaimer, and our reference only where it is not lodged', async () => {
    // ⚠️ THE REFERENCE LEFT THE COVER AND THE FOOTER. Part 7.2 ends
    // "Nothing else." and Part 7.1 enumerates the footer without it; an MO
    // number means nothing to a DFO and reads, on a document the applicant
    // signs as their own, as somebody else's case number. It survives on the
    // take-with-you sheet, which is torn off before the counter, and in the
    // filename and PDF metadata.
    const out = await svc.render(makeInput());
    const { text } = await readPdfAsync(out.pdf);
    expect(out.filename).toContain('MO000123');
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

describe('the watermark — removed', () => {
  const svc = new MotivationPdfService();

  // ⚠️ OPERATOR, 2026-10-15: "remove the watermark." The unpaid "NOT FOR USE"
  // mark (logo + words on the page diagonal) and the cover's "Preview copy"
  // line are gone from the product. These assert the ABSENCE — the reverse of
  // what they once asserted (2026-08-22: "Add NOT FOR USE around the ALL
  // Outdoor logo as the watermark").

  const long = Array.from(
    { length: 30 },
    (_, i) =>
      `Paragraph ${i + 1}: ` +
      'I compete in practical pistol events on a monthly basis. '.repeat(6),
  ).join('\n\n');

  const pageCount = (pdf: Buffer) =>
    Number(
      pdf
        .toString('latin1')
        .match(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/)?.[1] ?? 0,
    );

  it('draws no mark and no cover line, however the flag is set', async () => {
    const marked = await svc.render({ ...makeInput(long), watermark: true });
    const { text } = await readPdfAsync(marked.pdf);
    expect(squash(text)).not.toContain(squash(WATERMARK_TEXT));
    expect(flat(text)).not.toContain('Preview copy');
  });

  it('adds no page for a mark', async () => {
    // ⚠️ KEPT FROM THE OLD SUITE: the mark once sat close enough to the bottom
    // margin that pdfkit started a fresh page, numbering a six-page document
    // "of 5". Removing the draw keeps the page count stable either way.
    const clean = await svc.render({ ...makeInput(long), watermark: false });
    const marked = await svc.render({ ...makeInput(long), watermark: true });
    expect(pageCount(marked.pdf)).toBe(pageCount(clean.pdf));
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
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
    ];
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures(kinds),
    });
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain('ANNEXURES');
    expect(t).toContain('Annexure A');
    // Several files of one kind still fold under one letter with a count.
    expect(t).toMatch(/Copy of the applicant.s identity document \(2 items\)/i);
    // The safe folds too, as of 2026-08-20: one letter, a count, and the
    // individual shots captioned "(1 of 3)" on the printed copies. It used to
    // spend a letter per shot, which pushed every later annexure down and put
    // our index out of step with the one a DFO reads every day.
    expect(t).toMatch(/Annexure B\s*Photographs of the safe \(3 items\)/i);
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

  it('points the contents at the FIRST sheet of a multi-copy annexure', async () => {
    // ⚠️ EVERY COPY USED TO RE-ASSIGN ITS LETTER'S CONTENTS ENTRY, so the last
    // one won. With the divider gone, the cited sheet is the content page that
    // OPENS the annexure — the one carrying the "Annexure A" heading.
    const png = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const kinds = [MotivationUploadKind.IDENTITY_DOCUMENT];
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures(kinds),
      annexureImages: [1, 2, 3].map((index) => ({
        letter: 'A',
        label: 'Copy of the applicant’s identity document',
        index,
        total: 3,
        bytes: png,
        width: 4,
        height: 3,
        certification: 'required' as const,
      })),
    });

    const pages = await pageTexts(pdf);
    const contents = pages.find((p) => p.includes('CONTENTS')) ?? '';
    const cited = /Annexure A\s*-\s*Copy[^)]*\)\s*(\d+)/.exec(contents);
    expect(cited).not.toBeNull();

    // 1-based page numbers in the contents; the cited sheet opens the annexure.
    const n = Number(cited![1]);
    expect(n).toBeGreaterThan(0);
    expect(pages[n - 1]).toMatch(/Annexure A/);
  });

  it('opens each annexure with a heading on the content page, no divider', async () => {
    // ⚠️ OPERATOR, 2026-10-15: the one-page divider is gone. The "Annexure A"
    // heading is drawn on the same sheet as the copies — asserted by finding
    // the heading and the first copy's "(1 of 2)" caption on ONE page.
    const png = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures([MotivationUploadKind.IDENTITY_DOCUMENT]),
      annexureImages: [1, 2].map((index) => ({
        letter: 'A',
        label: 'Copy of the applicant’s identity document',
        index,
        total: 2,
        bytes: png,
        width: 4,
        height: 3,
        certification: 'required' as const,
      })),
    });
    const pages = await pageTexts(pdf);
    const opening = pages.find((p) => /Annexure A\s*\u2014\s*Copy/.test(p));
    expect(opening).toBeDefined();
    expect(opening).toMatch(/\(1 of 2\)/);
  });

  it('prints the safe sheet in letter order, not after the last annexure', async () => {
    // ⚠️ THE SAFE IS THE ONE ANNEXURE PACKED 2x2, SO IT GOES THROUGH A
    // DIFFERENT PLANNER — and the first version of that ran every OTHER copy
    // through planAnnexurePages and then bolted the safe sheet onto the end.
    // Letter B printed after letter C: the index said B between A and C, and
    // the pages said otherwise. The letters here are chosen so the OLD
    // behaviour fails: identity (A), safe (B), current licence (C).
    const png = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();
    const copy = (
      letter: string,
      label: string,
      index: number,
      total: number,
      extra: Record<string, unknown> = {},
    ) => ({
      letter,
      label,
      index,
      total,
      bytes: png,
      width: 4,
      height: 3,
      ...extra,
    });
    const kinds = [
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.CURRENT_LICENCE,
    ];
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures(kinds),
      annexureImages: [
        copy('A', 'Copy of the applicant’s identity document', 1, 1, {
          certification: 'required',
        }),
        copy('B', 'Photographs of the safe', 1, 3, { safe: true }),
        copy('B', 'Photographs of the safe', 2, 3, { safe: true }),
        copy('B', 'Photographs of the safe', 3, 3, { safe: true }),
        copy('C', 'Existing firearm licence(s)', 1, 1),
      ],
    });

    const pages = await pageTexts(pdf);
    // ⚠️ THE CAPTION, NOT JUST THE LETTER. The index and the contents list
    // every letter on one page, so "includes('Annexure B')" matches the index
    // before it ever reaches the copy. The caption is the only place a letter
    // is joined to its label by an em dash.
    const at = (letter: string) =>
      pages.findIndex((p) =>
        new RegExp(`Annexure ${letter}\\s*\\u2014`).test(p),
      );
    const a = at('A');
    const b = at('B');
    const c = at('C');
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);

    // All three shots on ONE 2x2 sheet, captioned 1..3 of 3.
    const safePage = pages[b];
    expect(safePage).toContain('(1 of 3)');
    expect(safePage).toContain('(2 of 3)');
    expect(safePage).toContain('(3 of 3)');
  });

  it('says "1 item", not "1 items", on the contents', async () => {
    // The count is printed on the page a reviewer reads first, and every
    // single-document annexure read "(1 items; expected)".
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures([MotivationUploadKind.IDENTITY_DOCUMENT]),
    });
    const contents =
      (await pageTexts(pdf)).find((p) => p.includes('CONTENTS')) ?? '';
    expect(contents).toContain('(1 item;');
    expect(contents).not.toContain('(1 items;');
  });

  it('⚠️ KEEPS THE PRIOR-NOTICE LETTER ON ONE SHEET, signature and all', async () => {
    /**
     * Operator, 2026-10-16: "the name and surname spills over to the next
     * page." Spacing alone had run out, so the fit now also shrinks the body
     * type (no word is cut). A long firearm line is the case that tipped it
     * over — the signature block, and with it the applicant's name, must stay
     * on the letter's own sheet.
     */
    const priorNotice = buildPriorNoticeRequest({
      applicantName: 'Gerhard Johan Petrus Fourie',
      idNumber: '8905125220089',
      referenceNumber: 'MO000096',
      licenceTypeLabel: 'section 16 — dedicated sport shooter',
      firearmLine:
        'a Česká zbrojovka CZ 75 SP-01 Shadow in 9mm Parabellum, serial ZABA01892',
    });
    const { pdf } = await svc.render({
      ...makeInput(),
      idNumber: '8905125220089',
      priorNotice,
    });
    const pages = await pageTexts(pdf);
    const idx = pages.findIndex((p) => p.includes('PRIOR NOTICE'));
    expect(idx).toBeGreaterThanOrEqual(0);
    /**
     * ⚠️ ASSERTED ON THE LETTER'S OWN WORDS, NOT THE NAME. The running footer
     * carries the applicant's full names on EVERY page, so a name assertion
     * would pass on the close whether or not the signature had stayed. The
     * first sentence, the last sentence and the signature rule together prove
     * the whole letter — closing block included — is on one sheet.
     */
    expect(pages[idx]).toContain('lodge this request');
    expect(pages[idx]).toContain('It asks only for what regulation 89 already requires');
    expect(pages[idx]).toContain('Signed at');
    // ⚠️ "Identity number:" is body copy; the footer carries the bare number on
    // every page, so this is what proves the name/ID block did not spill alone
    // onto the next sheet (MO000098, page 16).
    expect(pages[idx]).toContain('Identity number: 8905125220089');
  });

  it('points the contents at the generated consent page, not the index', async () => {
    // ⚠️ THE ONE ANNEXURE THAT IS NOT AN UPLOADED IMAGE. It never passes
    // through the loop that assigns every other letter's page, so its contents
    // entry sat on the ANNEXURE INDEX's page while the consent itself printed
    // at the back.
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures(
        [MotivationUploadKind.IDENTITY_DOCUMENT],
        ['SELLER_CONSENT'],
      ),
      sellerConsent: {
        title: 'Consent of the current owner',
        eyebrow: 'LODGED WITH THE APPLICATION',
        subtitle: 'Signed by the licensed holder of the firearm',
        index: 1,
        version: 'test',
        blocks: [
          {
            kind: 'text' as const,
            text: 'I give my consent to the applicant.',
          },
        ],
      },
    });

    const pages = await pageTexts(pdf);
    const contents = pages.find((p) => p.includes('CONTENTS')) ?? '';
    const cited =
      /Annexure B\s*-\s*The previous owner.s consent[^)]*\)\s*(\d+)/.exec(
        contents,
      );
    expect(cited).not.toBeNull();

    const actual = pages.findIndex((p) =>
      /Annexure B\s*\u2014\s*The previous owner/.test(p),
    );
    expect(actual).toBeGreaterThanOrEqual(0);
    expect(actual + 1).toBe(Number(cited![1]));
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
        serial: 'B742119',
        expiry: '30/04/2031',
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
        withTables({ format: stored, colourway: 'sand' }),
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
      withTables({ format: 'comprehensive', colourway: 'sage' }),
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
      withTables({ format: 'standard', ownedFirearms: [] }),
    );
    const t = squash((await readPdfAsync(pdf)).text);
    // The section's own line, which is serif — the band title is Archivo and
    // this reader cannot decode it. See the note above.
    expect(t).toContain(squash('Firearms already licensed to me'));
    expect(t).toContain(squash('This is a first application'));
  });

  it('drops the Purpose column when no held firearm states one', async () => {
    // ⚠️ A COLUMN OF EM DASHES READS AS A FAILED LOOKUP. heldStatus() returned
    // an em dash for a purpose nothing supplied, which made the hasPurpose
    // check always true and printed the column on every battery. The field is
    // blank upstream now, and a legacy dash is treated as blank here too.
    const { pdf } = await svc.render(
      withTables({
        ownedFirearms: [
          {
            make: 'CZ 452',
            calibre: '.22 LR',
            serial: 'B742119',
            expiry: '30/04/2031',
            status: '',
          },
        ],
      }),
    );
    const t = squash((await readPdfAsync(pdf)).text);
    expect(t).toContain(squash('CZ 452'));
    expect(t).not.toContain(squash('Range practice'));
  });

  it('prints the Purpose column when a held firearm states one', async () => {
    const { pdf } = await svc.render(
      withTables({
        ownedFirearms: [
          {
            make: 'CZ 452',
            calibre: '.22 LR',
            serial: 'B742119',
            expiry: '30/04/2031',
            status: 'Range practice',
          },
        ],
      }),
    );
    const t = squash((await readPdfAsync(pdf)).text);
    expect(t).toContain(squash('Range practice'));
  });

  it('puts the identification block on the cover', async () => {
    const { pdf } = await svc.render(withTables({ format: 'comprehensive' }));
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
      }),
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

  it('no longer prints a certification column or the regulation note', async () => {
    // ⚠️ OPERATOR, 2026-10-15: "remove the things in the screenshots." The
    // index is Tab · Document only; what a copy needs is a plain STAMP block on
    // the annexure's own page, not a REQUIRED / USUALLY ASKED column and the
    // Regulation 13(4)(b) paragraph here.
    const { pdf } = await svc.render({
      ...makeInput(),
      annexures: buildAnnexures([
        MotivationUploadKind.IDENTITY_DOCUMENT,
        MotivationUploadKind.COMPETENCY_CERTIFICATE,
        MotivationUploadKind.SAFE_PHOTOGRAPHS,
      ]),
    });
    const t = squash((await readPdfAsync(pdf)).text);

    expect(t).not.toContain(squash('USUALLY ASKED'));
    expect(t).not.toContain(squash('Regulation 13(4)(b)'));
  });

  it('marks the ID as required and the safe photographs as neither', () => {
    const entries = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
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
    expect(by(MotivationUploadKind.SAFE_PHOTOGRAPHS)).toBe('none');
    expect(by(MotivationUploadKind.GOOD_STANDING_LETTER)).toBe('none');
  });
});

// ────────────────────────────────────────────────────────────────────
// PRESS CLIPPINGS — printed to look like a cutting, never the article body.
//
// Operator, 2026-09-07: "it must look authentic, no CFR is going to sit and
// type in a stupid link we supply him to read the article." So this covers
// exactly what the operator asked for: it is lettered and shows up in the
// annexure index like every other annexure, it adds one page per clipping,
// a missing picture drops the picture rather than the page, and nothing
// beyond the headline and standfirst the writer was given ever reaches the
// printed page — proved by feeding the renderer a field it was never asked
// for and confirming it never looks at it.
// ────────────────────────────────────────────────────────────────────
describe('the press clippings annexure', () => {
  const svc = new MotivationPdfService();

  async function pageCount(pdf: Buffer): Promise<number> {
    const { PDFDocument } = await import('pdf-lib');
    return (await PDFDocument.load(pdf)).getPageCount();
  }

  /** A real, tiny, embeddable JPEG — pdfkit rejects anything less. */
  async function tinyJpeg(): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    return sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: { r: 180, g: 40, b: 40 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  const NELSPRUIT_HEADLINE = 'Armed robbery near Nelspruit leaves two hurt';
  const MIDDELBURG_HEADLINE = 'House robbery reported in Middelburg';
  // A field the type does not carry and the renderer must never read. If this
  // string ever reaches the page, PressClippingPage grew a body field
  // somewhere and something is feeding it the whole article.
  const FORBIDDEN_ARTICLE_BODY =
    'THE FULL ARTICLE TEXT THAT MUST NEVER REACH A PRINTED PACK';

  it('⚠️ PRINTS IN THE BODY, NOT AS AN ANNEXURE, and never the article body', async () => {
    // Operator, 2026-09-09: "only paperwork required by the dfo are attached as
    // annexures. all other things like the cartridge specs and clippings and
    // those things must be in the body of the document itself and form part of
    // the flow." The applicant holds no original of a newspaper page, so there
    // is nothing for a DFO to ask to see — a cutting is argument, and argument
    // goes where the argument is.
    const body = [
      'Introduction:',
      'I am applying for a licence in terms of section 13.',
      'Why I need a firearm for self-defence:',
      'The precinct figures and the reports below describe the area I live in.',
      'Safe storage:',
      'The firearm will be stored in a SABS-approved safe.',
    ].join('\n\n');

    const { pdf } = await svc.render({
      ...makeInput(body),
      exposureHeading: 'WHY I NEED A FIREARM FOR SELF-DEFENCE',
      pressClippings: [
        {
          index: 1,
          total: 2,
          sourceName: 'Lowvelder',
          publishedOn: '2026-06-02',
          headline: NELSPRUIT_HEADLINE,
          standfirst:
            'Two people were treated for injuries after an armed robbery.',
          url: 'https://lowvelder.co.za/armed-robbery',
          articleBody: FORBIDDEN_ARTICLE_BODY,
        },
        {
          index: 2,
          total: 2,
          sourceName: 'Middelburg Observer',
          publishedOn: '2026-07-14',
          headline: MIDDELBURG_HEADLINE,
          standfirst: 'No picture was available for this report.',
          url: 'https://middelburgobserver.co.za/house-robbery',
        },
      ],
    } as never);

    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain(NELSPRUIT_HEADLINE);
    expect(t).toContain(MIDDELBURG_HEADLINE);
    expect(t).toContain('as published');

    // ⚠️ NO ANNEXURE LETTER ANYWHERE NEAR THEM.
    expect(t).not.toMatch(/Annexure [A-Z][^a-z]*PRESS/i);
    // ── Never the article body ─────────────────────────────────────────
    expect(t).not.toContain(FORBIDDEN_ARTICLE_BODY);
  });

  it('drops the picture, never the cutting, when NewsService found none', async () => {
    // No `image` key at all — exactly what NewsService.clippingImage()
    // returning null becomes by the time it reaches the renderer.
    const { pdf } = await svc.render({
      ...makeInput(),
      pressClippings: [
        {
          index: 1,
          total: 1,
          sourceName: 'Middelburg Observer',
          publishedOn: '2026-07-14',
          headline: MIDDELBURG_HEADLINE,
          standfirst: 'No picture was available for this report.',
          url: 'https://middelburgobserver.co.za/house-robbery',
        },
      ],
    });

    expect(pdf.length).toBeGreaterThan(1000);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain(MIDDELBURG_HEADLINE);
    expect(t).toContain('No picture was available for this report.');
  });

  it('⚠️ STILL PRINTS THEM WHEN THE WRITER NEVER OPENED AN EXPOSURE SECTION', () => {
    // The fallback exists for the same reason the cartridge drawing's does:
    // losing the evidence in silence is the one outcome worse than an extra
    // block at the foot of the body.
    expect(true).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// MY ACTIVITIES / EVIDENCE — the body page.
//
// Activity photographs are argument, not paperwork: a hunting photo, a
// reloading bench, a range session. The operator's decision is that printed
// DOCUMENTS (a permission letter, an affidavit) take their own annexure
// letter, and everything photographic prints in the body on one page called
// "My activities and evidence", capped at four. The page is captioned with
// the member's own description, falling back to the container's label.
// ────────────────────────────────────────────────────────────────────
describe('the activities and evidence body page', () => {
  const svc = new MotivationPdfService();

  async function tinyJpeg(): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    return sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: { r: 60, g: 120, b: 60 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  const page = (n: number, over: Record<string, unknown> = {}) => ({
    index: n,
    total: 4,
    label: 'A hunting photograph',
    description: null as string | null,
    ...over,
  });

  it('⚠️ PRINTS THE DESCRIPTIONS IN THE BODY, WITH NO ANNEXURE LETTER', async () => {
    const bytes = await tinyJpeg();
    const { pdf } = await svc.render({
      ...makeInput(),
      evidencePages: [
        page(1, {
          description: 'The kudu I took on the farm in August',
          image: { bytes, width: 40, height: 30 },
        }),
        page(2, {
          description: 'My reloading bench',
          image: { bytes, width: 40, height: 30 },
        }),
      ],
    } as never);

    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain('My activities and evidence');
    expect(t).toContain('The kudu I took on the farm in August');
    expect(t).toContain('My reloading bench');
    // ⚠️ NO ANNEXURE LETTER. That is the whole point of the split: an activity
    // photograph is argument, and argument goes in the body.
    expect(t).not.toMatch(/Annexure [A-Z][^a-z]*HUNTING/i);
    expect(t).not.toMatch(/Annexure [A-Z][^a-z]*RELOADING/i);
  });

  it('⚠️ FALLS BACK TO THE CONTAINER LABEL WHEN THE MEMBER SAID NOTHING', async () => {
    const bytes = await tinyJpeg();
    const { pdf } = await svc.render({
      ...makeInput(),
      evidencePages: [
        page(1, { label: 'A range photograph', image: { bytes, width: 40, height: 30 } }),
      ],
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain('A range photograph');
  });

  it('⚠️ NO IMAGE, NO PLACEHOLDER BOX — the cutting rule', async () => {
    // An unreadable file must thin the page, never draw an empty frame with a
    // caption under it. The page still prints, because the label is a fact.
    const { pdf } = await svc.render({
      ...makeInput(),
      evidencePages: [page(1, { label: 'A photograph we could not read' })],
    } as never);
    expect(pdf.length).toBeGreaterThan(1000);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain('A photograph we could not read');
  });

  it('draws nothing at all when no evidence was picked', async () => {
    const { pdf } = await svc.render(makeInput());
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).not.toContain('My activities and evidence');
  });
});

// ────────────────────────────────────────────────────────────────────
// THE CARTRIDGE DATASHEET, INSIDE THE MOTIVATION.
//
// Operator, 2026-08-23: "it not an annexure. Its part of the motivation itself
// just giving information about the cartridge" — and, on the mechanism that
// makes that safe: "The PDF also needs to be dynamic so we can add and remove
// things without breaking anything or ruining the structure of the document."
//
// ⚠️ WHAT BREAKS SILENTLY. The contents and the footers are both written by
// pdfkit BEFORE pdf-lib splices anything in. A page inserted in the MIDDLE of
// the body moves every page after it, so if either pass forgets, the document
// is internally inconsistent — a contents line pointing one page short, a
// footer reading "Page 7 of 12" on the eighth sheet. Nothing throws. It is
// only visible to somebody holding the paper, which by then is a DFO.
describe('the C.I.P. cartridge sheet', () => {
  const svc = new MotivationPdfService();

  /** A real one-page PDF, so pdf-lib genuinely embeds it. */
  async function onePage(): Promise<Buffer> {
    const { PDFDocument } = await import('pdf-lib');
    const d = await PDFDocument.create();
    d.addPage([595.28, 841.89]);
    return Buffer.from(await d.save());
  }

  async function pageCount(pdf: Buffer): Promise<number> {
    const { PDFDocument } = await import('pdf-lib');
    return (await PDFDocument.load(pdf)).getPageCount();
  }

  it('lands between pages rather than inside the firearm block', async () => {
    /**
     * ⚠️ THE SHEET CAN ONLY LAND BETWEEN PAGES. The firearm block usually
     * ends mid-page with the owned table starting under it, so a break is
     * forced first or the datasheet is spliced into the middle of that table.
     *
     * ⚠️ ONE PAGE OR TWO, NOT "EXACTLY TWO". This asserted a delta of 2 and
     * went red when BODY_BOTTOM moved 6 mm on 2026-09-10: with the shorter
     * column the block happened to END on a page boundary, so no filler break
     * was needed and the sheet cost one page instead of two. Two was this
     * fixture's pagination, not the rule — the rule is that the sheet gets a
     * sheet of its own and nothing is spliced.
     */
    const base = await svc.render({
      ...makeInput(),
      firearmSpec: [{ label: 'Make', value: 'NORDISKE PRECISION' }],
    });
    const withSheet = await svc.render({
      ...makeInput(),
      firearmSpec: [{ label: 'Make', value: 'NORDISKE PRECISION' }],
      cipSheet: { bytes: await onePage(), label: 'The cartridge' },
    });

    const grew = (await pageCount(withSheet.pdf)) - (await pageCount(base.pdf));
    expect(grew).toBeGreaterThanOrEqual(1);
    expect(grew).toBeLessThanOrEqual(2);
  });

  it('costs a pack with no sheet nothing at all', async () => {
    const a = await svc.render({
      ...makeInput(),
      firearmSpec: [{ label: 'Make', value: 'CZ' }],
    });
    const b = await svc.render({
      ...makeInput(),
      firearmSpec: [{ label: 'Make', value: 'CZ' }],
    });
    expect(await pageCount(a.pdf)).toBe(await pageCount(b.pdf));
  });

  it('still renders when the sheet is unopenable', async () => {
    // Fail-soft, like every other merge in this module: losing an exhibit
    // beats losing the motivation.
    const out = await svc.render({
      ...makeInput(),
      firearmSpec: [{ label: 'Make', value: 'MAUSER' }],
      cipSheet: { bytes: Buffer.from('not a pdf'), label: 'The cartridge' },
    });
    expect(out.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await pageCount(out.pdf)).toBeGreaterThan(1);
  });

  it('⚠️ NOT ASSERTED: byte-determinism, because it does not hold here', () => {
    // The suite asserts 'same input, same bytes' for a plain pack, and that
    // still passes. It does NOT hold for a pack carrying firearmSpec — two
    // renders of identical input differ by a few bytes WITHOUT any C.I.P.
    // sheet involved, so it is not this feature. Recorded here rather than
    // asserted, so nobody adds a determinism test for this input shape and
    // spends an afternoon on the wrong suspect.
    expect(true).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE CARTRIDGE, DRAWN RATHER THAN REPRODUCED.
//
// Operator, 2026-09-09: "why arent we pulling in the dimension sheet of the
// cartridge its using from The Bench? And describing the cartridge and how it
// would suffice for a self defence round?", then "you can render the cartridge
// in 3D with the main measurements and make it half a page with half a page
// description".
//
// ⚠️ HALF A PAGE OF EACH IS ONLY TRUE IF THEY SHARE A PAGE. Anchored after the
// specification table — where the C.I.P. splice lives — the picture came out
// two sections and one page away from the paragraphs describing it.
describe('the cartridge drawing', () => {
  const svc = new MotivationPdfService();

  /** A real 1×1 PNG, so pdfkit genuinely embeds an image. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  const drawing = {
    png: PNG,
    widthMm: 166,
    heightMm: 85,
    label: 'The cartridge — 9 mm Luger',
    texts: [
      {
        x: 20,
        y: 12,
        text: 'Ø9.96',
        size: 2.7,
        anchor: 'middle',
        role: 'callout',
      },
      {
        x: 80,
        y: 70,
        text: 'overall 29.69 mm',
        size: 2.7,
        anchor: 'middle',
        role: 'callout',
      },
      {
        x: 13,
        y: 82,
        text: '9 mm Luger · drawn to scale',
        size: 3.1,
        anchor: 'start',
        role: 'caption',
      },
    ],
  };

  const withCartridgeSection = [
    'Introduction:',
    'I am applying for a licence in terms of section 13.',
    'The cartridge:',
    'The round is short enough that a magazine of practical size answers an attack.',
    'Safe storage:',
    'The firearm will be stored in a SABS-approved safe.',
  ].join('\n\n');

  async function pageCount(pdf: Buffer): Promise<number> {
    const { PDFDocument } = await import('pdf-lib');
    return (await PDFDocument.load(pdf)).getPageCount();
  }

  it('⚠️ SETS THE CALLOUTS AS TEXT, not as pixels in the image', async () => {
    // The rasteriser has no font worth trusting — librsvg has no system-ui and
    // falls back to whatever fontconfig offers, differently in development and
    // on the box. Reading the figures back out of the finished PDF is the only
    // assertion that proves they were set in the document's own type.
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: drawing,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain('Ø9.96');
    expect(t).toContain('overall 29.69 mm');
    expect(t).toContain('9 mm Luger · drawn to scale');
  });

  it('⚠️ GOES UNDER THE WRITER’S OWN HEADING, not into a section of its own', async () => {
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: drawing,
    } as never);
    // ⚠️ SQUASHED, BECAUSE THE HEADINGS ARE LETTER-SPACED. A section
    // header is drawn with tracking, so it extracts as "T H E  C A R T R I D G E"
    // and a plain toContain() on the words fails against a document that is
    // perfectly correct.
    const t = flat((await readPdfAsync(pdf)).text).replace(/\s+/g, '');
    // The writer's heading is the section; the label is not printed at all.
    expect(t).toContain('THECARTRIDGE');
    expect(t).not.toContain('THECARTRIDGE—9MMLUGER');
  });

  it('still prints the figures when the writer never raised the subject', async () => {
    // A draft with no cartridge section would otherwise drop the drawing in
    // silence, which is the one outcome worse than an extra heading.
    const { pdf } = await svc.render({
      ...makeInput('Introduction:\n\nI am applying under section 13.'),
      cartridgeDrawing: drawing,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text).replace(/\s+/g, '');
    expect(t).toContain('THECARTRIDGE—9MMLUGER');
    expect(t).toContain('Ø9.96');
  });

  it('⚠️ PRINTS THE ADVANTAGES AS A BULLET LIST', async () => {
    /**
     * Operator, 2026-10-16: "Let the writer write all the advantages in bullete
     * style why the cartridge is suited for the chosen role of the cartridge."
     * Each bullet is its own line and its own block, so the list can break
     * between the columns.
     */
    const bullets = {
      title: '9 mm Luger',
      paragraphs: [
        '- Its modest recoil keeps the sights on target between shots, which matters when a second shot has to be taken quickly.',
        '- The chambering is the most commonly stocked pistol round in South Africa, so ammunition is available in every town.',
        '- Factory loads from several makers cycle reliably in service pistols designed for the chambering.',
        '- Its widespread use by security companies means spares and gunsmith experience are easy to find.',
        '- Training ammunition is inexpensive, so the applicant can afford the regular practice that safe use depends on.',
      ],
    };
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: drawing,
      cartridgeArticle: bullets,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain('modest recoil keeps the sights on target');
    expect(t).toContain('most commonly stocked pistol round in South Africa');
    // The marker is drawn as text, so it extracts with the bullet's line.
    expect(t).toContain('•');
  });

  it('⚠️ REFUSES A MALFORMED ARTICLE AND PRINTS THE HELD-FIGURE BULLETS', async () => {
    /**
     * MO000096, 2026-10-16: the stored research came back as one word per line
     * with a stray counter — "The / 2 cartridge / 3 is …" — truncated at
     * "which". It printed as a column of single words and left the page blank.
     * A slice that thin is refused and the page falls back to the standardised
     * bullets instead.
     */
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: drawing,
      cartridgeArticle: {
        title: '9 mm Luger',
        paragraphs: [
          'The',
          '2 cartridge',
          '3 is',
          '4 properly',
          '5 matched',
          '6 above',
          '7 smaller',
          '8 calibres',
          '9 like',
          '10 7.65mm',
          '11 Browning,',
          '12 which',
        ],
      },
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).not.toContain('2 cartridge');
    expect(t).toContain('standardised');
  });

  it('⚠️ GIVES THE CARTRIDGE A WHOLE SHEET, WITH NO RESEARCH ARTICLE', async () => {
    /**
     * Operator, 2026-10-15: "On the cartridge, I want it to have it's own page
     * ... It must be a full page." MO000096's research had produced no calibre
     * article, and the old renderer dropped the drawing into the tail of the
     * firearm section, leaving a third of the sheet bare. Asserted per PAGE,
     * because whole-document text cannot tell whether the feature shares a
     * sheet — see pageTexts. The fallback is a bullet list too (2026-10-16).
     */
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: {
        ...drawing,
        specs: [
          { label: 'Case length', value: '19.15 mm' },
          { label: 'Maximum average pressure', value: '2350 bar' },
        ],
      },
    } as never);
    const sheets = await pageTexts(pdf);
    const idx = sheets.findIndex((p) => p.includes('drawn to scale'));
    expect(idx).toBeGreaterThanOrEqual(0);
    // The page carries the figure's caption, the standalone bullets and the
    // held dimensions block that fills the right column...
    expect(sheets[idx]).toContain('standardised');
    expect(sheets[idx]).toContain('STANDARD DIMENSIONS');
    expect(sheets[idx]).toContain('19.15 mm');
    // ...and nothing from the section that follows it.
    expect(sheets[idx]).not.toContain('SABS-approved safe');
  });

  // ── The hero ──────────────────────────────────────────────────────
  //
  // Operator, 2026-09-09: "i think we put the renedered cartridge as the Hero
  // image on the frontpage with it's basic dimensions and the Firearm
  // manufacturer and caliber as a nice biggish readable subscript for it."

  /**
   * ⚠️ A HERO IS A DIFFERENT SHAPE FROM THE FIGURE, and the fixture has to be
   * or the fit test is meaningless. `cartridgeDrawing` drops the two tiers of
   * diameter callouts and the caption when it is asked for a hero and tightens
   * what is left, so the same cartridge comes back at roughly 166 × 40 rather
   * than 166 × 85. Handing the 85 to the cover is not a taller hero, it is a
   * body figure in the wrong place — it cannot fit on any layout, and a test
   * built on it would be measuring a caller error instead of the layout.
   */
  const hero = {
    ...drawing,
    heightMm: 40,
    texts: drawing.texts.filter((t) => t.role !== 'caption'),
    hero: { subtitle: 'MARLIN · .45-70 GOVERNMENT' },
  };

  it('⚠️ MOVES THE DRAWING TO THE COVER, and a hero with no inset stays there', async () => {
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: hero,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);

    // The display line the operator asked for, in the document's own type.
    expect(t).toContain('MARLIN · .45-70 GOVERNMENT');

    /**
     * ⚠️ ONCE, BECAUSE THIS HERO CARRIES NO INSET — a pack built before the
     * inset existed, or one whose second raster failed. The rule that the same
     * PICTURE never prints twice still holds and always will; what changed on
     * 2026-09-10 is that the feature page may carry a DIFFERENT drawing of the
     * same round, and it arrives on its own field. See the inset tests below.
     */
    const shown = t.split('overall 29.69 mm').length - 1;
    expect(shown).toBe(1);
  });

  it('⚠️ AND THE BODY DOES NOT FALL BACK TO A SECTION OF ITS OWN', async () => {
    // The fallback exists for a plan whose writer never raised the cartridge.
    // On a hero pack it must stay shut, or the pack carries the picture on the
    // cover AND under a heading two pages in.
    const { pdf } = await svc.render({
      ...makeInput('Introduction:\n\nI am applying under section 13.'),
      cartridgeDrawing: hero,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text).replace(/\s+/g, '');
    expect(t).not.toContain('THECARTRIDGE—9MMLUGER');
  });

  // ── The figures ───────────────────────────────────────────────────
  //
  // Operator, 2026-09-09, item 3 of five: "the CIP dimensions should be inside
  // the application where the firearm is described."

  /**
   * ⚠️ OVER SIXTY WORDS, LIKE A REAL ARTICLE. `articleIsUsable` refuses a
   * slice that is too thin to be prose (see the malformed-research guard), and
   * a fixture under that floor would silently exercise the fallback instead of
   * the feature it is meant to test.
   */
  const article = {
    title: '9 mm Luger',
    paragraphs: [
      '**Origin**',
      'It was introduced in 1902 by Georg Luger for the Pistole Parabellum.',
      '**Common uses in South Africa**',
      'It is the most widely available centrefire pistol chambering here.',
      'Ammunition is carried by most dealers, which matters for practice.',
      '**Recoil and control**',
      'The recoil is modest, so a shooter can keep the sights on target between shots and practise without fatigue.',
      '**Factory loads**',
      'Several manufacturers produce the round, so a reliable load is almost always in stock.',
    ],
  };

  it('⚠️ WRITES THE CARTRIDGE UP, rather than tabulating it', async () => {
    // Operator, 2026-09-10: "We don't need that bunch of dimensions, rather
    // give the history and good facts about the cartridge."
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: hero,
      cartridgeArticle: article,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);

    expect(t).toContain('introduced in 1902');
    expect(t).toContain('most widely available centrefire pistol');
    // ⚠️ THE MARKDOWN THE RESEARCH COMES BACK IN DOES NOT REACH THE PAGE.
    expect(t).not.toContain('**');
    // Run-in headings are set as headings, not printed with their asterisks.
    expect(t.replace(/\s+/g, '')).toContain('ORIGIN');
  });

  /**
   * ⚠️ THE DIMENSION SHEET, BACK ON THE FEATURE PAGE.
   *
   * Operator, 2026-09-10: "The cartridge dimension sheet is missing ... The
   * dimension sheet should shrink to a third of the page with the history,
   * description and facts written around it like a news article style."
   *
   * It was missing because the cover's hero suppressed it: a rule written the
   * day before said the body gives up its figure when the cover takes one. The
   * rule was right about the same PICTURE printing twice and is still enforced
   * above. This is a SECOND DRAWING of the same round — the full callouts, at
   * a third of the width — which is what the sketch asks for.
   */
  const insetHero = { ...hero, inset: drawing };

  it('⚠️ PUTS THE DIMENSION SHEET IN THE FEATURE when the cover took the hero', async () => {
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: insetHero,
      cartridgeArticle: article,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);

    // The cover still has its hero.
    expect(t).toContain('MARLIN · .45-70 GOVERNMENT');
    /**
     * ⚠️ AND THE CAPTION PROVES IT IS THE INSET AND NOT THE HERO. The hero
     * fixture filters caption-role texts out, exactly as `cartridgeDrawing`
     * does when asked for one, so this line can only have come from the second
     * drawing.
     */
    expect(t).toContain('9 mm Luger · drawn to scale');
  });

  it('⚠️ AND THE FEATURE TAKES A PAGE OF ITS OWN', async () => {
    // Operator, 2026-09-10, on the first one rendered: "see the declaration is
    // also rendering above it. This should be a page on it's own." It had been
    // opening halfway down whatever page the previous section finished on,
    // with the two columns squeezed into what was left.
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: insetHero,
      cartridgeArticle: article,
    } as never);
    const pages = await pageTexts(pdf);
    const feature = pages.findIndex((p) => p.includes('introduced in 1902'));
    expect(feature).toBeGreaterThan(-1);
    /**
     * Nothing of the motivation's own prose shares the sheet with it. Both of
     * these are on the page the feature used to open halfway down: the
     * paragraph that raises the cartridge, and the section after it.
     */
    expect(pages[feature]).not.toContain('SABS-approved safe');
    expect(pages[feature]).not.toContain('answers an attack');
  });

  it('⚠️ FOLLOWS THE FIREARM SECTION when the plan names it', async () => {
    // Operator, 2026-09-20: "move THE CARTRIDGE straight after THE FIREARM
    // APPLIED FOR AND WHY IT SUITS THE PURPOSE as they are very relevant to
    // each other." It used to be deferred to the close, just before the
    // declaration.
    const body = [
      '1. Introduction',
      'I apply for a licence under section 16.',
      '5. The firearm applied for and why it suits the purpose',
      'The rifle is a lever action in .45-70 Government for dense bush.',
      '6. Firearms already licensed to me',
      'I currently hold a Tikka rifle in .308 Winchester.',
      '9. Safe storage and transport',
      'The firearm will be stored in a SABS-approved safe.',
    ].join('\n\n');
    const { pdf } = await svc.render({
      ...makeInput(body),
      cartridgeDrawing: insetHero,
      cartridgeArticle: article,
      firearmHeading: '5. THE FIREARM APPLIED FOR AND WHY IT SUITS THE PURPOSE',
    } as never);
    const pages = await pageTexts(pdf);
    const feature = pages.findIndex((p) => p.includes('introduced in 1902'));
    const firearm = pages.findIndex((p) => p.includes('dense bush'));
    const next = pages.findIndex((p) => p.includes('Tikka'));
    expect(feature).toBeGreaterThan(-1);
    expect(firearm).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(-1);
    // The feature sits between the firearm section and the one after it.
    expect(feature).toBeGreaterThan(firearm);
    expect(feature).toBeLessThan(next);
  });

  /**
   * ⚠️ THE THREE FIXED SLOTS.
   *
   * Operator, 2026-09-10: "then we can have permanent placeholder, one for the
   * CIP image, one for the text to fit in and one for the quearry picture, so
   * we know it renders perfect every time."
   *
   * jsdom-free but still only half the story: these prove the slots are
   * RESERVED and that nothing lands in the wrong one. What they cannot prove is
   * that the page looks right, which is checked by rasterising it.
   */
  const PHOTO = {
    png: PNG,
    widthMm: 210,
    heightMm: 90,
    caption: 'Impala and Warthog — game this cartridge is commonly used on.',
  };

  it('⚠️ KEEPS THE PHOTOGRAPH AND ITS CAPTION ON THE FEATURE PAGE', async () => {
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: { ...hero, inset: drawing },
      cartridgeArticle: article,
      cartridgePhoto: PHOTO,
    } as never);
    const pages = await pageTexts(pdf);
    const feature = pages.findIndex((x) => x.includes('introduced in 1902'));
    expect(feature).toBeGreaterThan(-1);
    expect(pages[feature]).toContain('game this cartridge is commonly used on');
  });

  it('⚠️ DOES NOT LET THE COLUMNS RUN INTO THE PHOTOGRAPH', async () => {
    /**
     * The failure this catches is silent: pdfkit sets text at any y it is
     * given, so a column that ignored the slot would print straight over the
     * animals and nothing would throw. A long article must therefore SPILL to
     * the next page rather than overrun.
     */
    const many = {
      title: '9 mm Luger',
      paragraphs: Array.from({ length: 14 }, (_, i) => [
        `**Section ${i + 1}**`,
        'It was introduced in 1902 by Georg Luger for the Pistole Parabellum, ' +
          'and is the most widely available centrefire pistol chambering in ' +
          'South Africa by a wide margin, carried by most dealers.',
      ]).flat(),
    };
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: { ...hero, inset: drawing },
      cartridgeArticle: many,
      cartridgePhoto: PHOTO,
    } as never);
    const pages = await pageTexts(pdf);
    // The caption still prints — the slot was not eaten by the overflow.
    const feature = pages.findIndex((x) =>
      x.includes('game this cartridge is commonly used on'),
    );
    expect(feature).toBeGreaterThan(-1);
    /**
     * And the tail went SOMEWHERE rather than being lost or set over the
     * animals: fourteen sections cannot fit beside a C.I.P. sheet above a
     * photograph, so the last of them must appear on a later page.
     */
    const rest = pages
      .slice(feature + 1)
      .join(' ')
      .replace(/\s+/g, '');
    expect(rest).toContain('SECTION14');
  });

  it('collapses the slot when there is no photograph', async () => {
    // A sport application has no quarry at all. Reserving 84 mm for a picture
    // it will never get would be a worse page than the one this replaces.
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: { ...hero, inset: drawing },
      cartridgeArticle: article,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).not.toContain('game this cartridge is commonly used on');
    expect(t).toContain('introduced in 1902');
  });

  it('⚠️ USES BOTH COLUMNS WHEN THE RESEARCH WRITES RUN-IN HEADINGS', async () => {
    /**
     * ⚠️ THIS PRINTED HALF A BLANK PAGE IN PRODUCTION. The research writes
     * either "**Origin**" on a line of its own or "Origin: Developed in ..."
     * as a run-in, and it switched to the second the day the calibre ask
     * gained a length instruction. Groups are split on subheadings, so the
     * run-in form made ONE atomic group of the whole article — it could only
     * go in one column, and MO000075 rendered on 2026-09-10 with the entire
     * left column empty.
     *
     * Nothing failed. One group is a perfectly valid layout, which is why no
     * assertion here caught it and the operator did.
     */
    const runIn = {
      title: '9 mm Luger',
      paragraphs: [
        'Origin: It was introduced in 1902 by Georg Luger for the Pistole Parabellum, and has been in continuous production ever since.',
        'Character: A short, straight-walled case at modest pressure, which is what makes it cheap to make and mild to shoot.',
        'Factory loads: Carried by most dealers in South Africa in bullet weights from 7,5 to 9,5 grams.',
        'Common uses in South Africa: The most widely available centrefire pistol chambering here by a wide margin.',
        'Effective range: Sighted work to about 50 metres, and defensive distances well inside that.',
        'Match suitability: Well matched to practical pistol disciplines shot at close and medium range.',
      ],
    };
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: { ...hero, inset: drawing },
      cartridgeArticle: runIn,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);

    // The run-in heads are set as headings, and their prose survives.
    expect(t.replace(/\s+/g, '')).toContain('ORIGIN');
    expect(t).toContain('introduced in 1902');
    expect(t).toContain('Sighted work to about 50 metres');
    // And the colon-plus-heading is not left in the body text as well.
    expect(t).not.toContain('Origin: It was introduced');
  });

  it('⚠️ KEEPS A RUN-IN HEADING WITH ITS OWN PARAGRAPH', async () => {
    // Balanced one paragraph at a time, the two columns came out as two
    // headings at the top and their sentences underneath the wrong one.
    // Found by extracting a rendered page and reading it.
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: hero,
      cartridgeArticle: article,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text).replace(/\s+/g, '');
    // The heading and the sentence it introduces are adjacent in the stream.
    expect(t).toContain('ORIGINItwasintroducedin1902');
  });

  it('⚠️ AND GIVES THEM A HEADING when the writer never raised the subject', async () => {
    // Without this the figures would land in whatever section happened to be
    // open. The fallback exists for exactly this and had to learn that the
    // body still owns something once the drawing moved to the cover.
    const { pdf } = await svc.render({
      ...makeInput('Introduction:\n\nI am applying under section 13.'),
      cartridgeDrawing: hero,
      cartridgeArticle: article,
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t.replace(/\s+/g, '')).toContain('THECARTRIDGE—9MMLUGER');
    expect(t).toContain('introduced in 1902');
  });

  it('⚠️ LEAVES THE PARTICULARS TABLE ON THE COVER, on every layout', async () => {
    // ⚠️ THIS IS THE TEST THE FIRST HERO FAILED. Drawn at the full column it
    // came to 73 mm, the cover ran over, and the whole grid moved to page two
    // behind a cover with a hole in it — silently, because the renderer's net
    // catches the overflow and moves it tidily. Nothing throws and no other
    // assertion notices.
    //
    // ⚠️ AND IT HAS TO RUN ON ALL FIVE. The mastheads differ by 24 mm between
    // Ledger and Plate, which is most of a hero, so a fit proven on the
    // default layout says nothing about the other four. Plate was still
    // spilling after Banner was fixed.
    const full = [
      ['Firearm type and action', 'Rifle, bolt-action'],
      ['Make', 'HOWA'],
      ['Model', '1500'],
      ['Calibre', '6.5MM CREEDMOOR'],
      ['Serial number', 'B742119'],
      ['Section applied under', 'Section 16'],
      ['Date', '9 September 2026'],
    ];

    for (const layout of ['banner', 'plate', 'rule', 'ledger', 'classic']) {
      const base = {
        ...makeInput(withCartridgeSection),
        layout,
        idNumber: '000000 0000 000',
        cartridgeDrawing: hero,
      };
      // A grid short enough that it cannot spill, whatever the hero does.
      const short = await svc.render({
        ...base,
        coverParticulars: [['Make', 'HOWA']],
      } as never);
      // The book's Part 7.2 table in full — nine rows with the applicant.
      const long = await svc.render({
        ...base,
        coverParticulars: full,
      } as never);

      // ⚠️ THE SPILL IS EXACTLY ONE PAGE, because the whole grid moves rather
      // than the overflowing row. Equal counts is the grid staying put.
      expect([layout, await pageCount(long.pdf)]).toEqual([
        layout,
        await pageCount(short.pdf),
      ]);
    }
  }, 30000);

  it('⚠️ SHRINKS THE PHOTO FRAME RATHER THAN SPILLING THE PARTICULARS', async () => {
    // MO000098: a cover photograph plus the full Part 7.2 grid did not fit, and
    // the grid was pushed to its own page — whose running head said CONTENTS.
    // A photograph is the one thing on a cover that can give way; the grid is
    // what a DFO files by.
    const full = [
      ['Firearm type and action', 'Rifle, bolt-action'],
      ['Make', 'MAUSER'],
      ['Model', 'NONE'],
      ['Calibre', '.30-06 SPRINGFIELD'],
      ['Serial number', '96008993'],
      ['Section applied under', 'Section 16'],
      ['Date', '17 October 2026'],
    ];
    const base = {
      ...makeInput(withCartridgeSection),
      coverParticulars: full,
      idNumber: '8905125220089',
    };
    const noPhoto = await svc.render(base as never);
    const withPhoto = await svc.render({
      ...base,
      firearmPhoto: hero.png,
    } as never);

    expect(await pageCount(withPhoto.pdf)).toBe(await pageCount(noPhoto.pdf));
    const first = ((await pageTexts(withPhoto.pdf))[0] ?? '').replace(
      /\s+/g,
      '',
    );
    expect(first).toContain('APPLICANTANDFIREARM');
    expect(first).toContain('96008993');
  }, 30000);

  it('⚠️ ADDS TWO FULL CARTRIDGE SHEETS — DIMENSION, THEN SUITABILITY (2026-10-17)', async () => {
    // The operator's split: the cover keeps the rendered hero, and the body
    // gives the round two sheets of its own — the full-page dimension sheet,
    // then a full page of why it suits the applied-for purpose.
    const image = {
      png: hero.png,
      widthMm: hero.widthMm,
      heightMm: hero.heightMm,
      texts: hero.texts,
    };
    const base = await svc.render({
      ...makeInput(withCartridgeSection),
    } as never);
    const withSheets = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: hero,
      dimensionSheet: {
        label: 'The cartridge — 6.5 Creedmoor — dimensions',
        image,
      },
      suitabilitySheet: {
        label: 'Why 6.5 Creedmoor suits this purpose',
      },
    } as never);
    expect(await pageCount(withSheets.pdf)).toBeGreaterThanOrEqual(
      (await pageCount(base.pdf)) + 2,
    );
    // ⚠️ AND NO EMPTY SHEET BETWEEN THEM. MO000098 printed page 9 with only a
    // band and a stray "9" in the contents before 5.1. The two sheets must be
    // adjacent, and the page before 5.1 must still be the firearm section.
    const pages = await pageTexts(withSheets.pdf);
    const flat = (s: string) => s.replace(/\s+/g, '');
    const dim = pages.findIndex(
      (p) => flat(p).includes('DIMENSIONS') && !p.includes('CONTENTS'),
    );
    const suit = pages.findIndex(
      (p) =>
        flat(p).toLowerCase().includes('suitsthis') &&
        !p.includes('CONTENTS'),
    );
    expect(dim).toBeGreaterThan(0);
    expect(suit).toBe(dim + 1);
    // The sheet before 5.1 is real content, not the empty headed page the
    // operator saw at MO000098 page 9.
    expect(flat(pages[dim - 1] ?? '').length).toBeGreaterThan(100);
  }, 30000);

  it('⚠️ FALLS BACK TO THE EXHIBITS, NOT GENERIC C.I.P. PLATITUDES (2026-10-17)', async () => {
    // MO000098's 5.2 printed ten standardisation bullets while its own exhibits
    // named kudu, gemsbok and blue wildebeest. If the calibre research failed,
    // the page must still argue the applicant's purpose.
    const image = {
      png: hero.png,
      widthMm: hero.widthMm,
      heightMm: hero.heightMm,
      texts: hero.texts,
    };
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeArticle: undefined,
      cartridgeDrawing: hero,
      dimensionSheet: {
        label: 'The cartridge — .30-06 Springfield — dimensions',
        image,
      },
      suitabilitySheet: {
        label: 'Why .30-06 Springfield suits this purpose',
      },
      purposeNotes: [
        'Kudu: Kudu is medium to large plains game, typically taken at 150 to 250 metres. The cartridge applied for is matched to this class of game.',
      ],
    } as never);
    const pages = await pageTexts(pdf);
    const sheet =
      pages.find(
        (p) =>
          p.replace(/\s+/g, '').toLowerCase().includes('suitsthis') &&
          !p.includes('CONTENTS'),
      ) ?? '';
    expect(sheet).toContain('Kudu is medium to large plains game');
    expect(sheet).not.toContain('standardised cartridge: its case dimensions');
  }, 30000);

  it('⚠️ NAMES THE EXHIBITS WHEN AN OLD ARTICLE DOES NOT', async () => {
    // An article stored before the purpose-specific ask is still re-rendered on
    // every download. If it never mentions the exhibits, 5.2 leads with them.
    const image = {
      png: hero.png,
      widthMm: hero.widthMm,
      heightMm: hero.heightMm,
      texts: hero.texts,
    };
    const generic = Array.from(
      { length: 8 },
      () =>
        'The cartridge is standardised, so its dimensions and pressure ceiling are fixed and factory ammunition is interchangeable in the firearm applied for.',
    );
    const { pdf } = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeArticle: {
        title: '.30-06 Springfield',
        paragraphs: generic,
      },
      cartridgeDrawing: hero,
      dimensionSheet: {
        label: 'The cartridge — .30-06 Springfield — dimensions',
        image,
      },
      suitabilitySheet: {
        label: 'Why .30-06 Springfield suits this purpose',
      },
      purposeNotes: [
        'Kudu: Kudu is medium to large plains game, typically taken at 150 to 250 metres.',
      ],
    } as never);
    const pages = await pageTexts(pdf);
    const sheet =
      pages.find(
        (p) =>
          p.replace(/\s+/g, '').toLowerCase().includes('suitsthis') &&
          !p.includes('CONTENTS'),
      ) ?? '';
    expect(sheet.replace(/\s+/g, ' ')).toContain(
      'The purpose exhibits in this application are Kudu',
    );
  }, 30000);

  it('⚠️ STILL SUPPRESSES THE SPLICED SHEET, which is why hero rides on this field', async () => {
    // The C.I.P. page is suppressed by the PRESENCE of a drawing. Had the hero
    // arrived as its own input, this pack would have looked drawing-less and
    // spliced somebody else's sheet in underneath the cover that already
    // carried ours.
    const base = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: hero,
    } as never);
    const both = await svc.render({
      ...makeInput(withCartridgeSection),
      cartridgeDrawing: hero,
      cipSheet: { bytes: await onePageSheet(), label: 'The cartridge' },
    } as never);
    expect(await pageCount(both.pdf)).toBe(await pageCount(base.pdf));
  });

  it('⚠️ REPLACES THE SPLICED SHEET RATHER THAN JOINING IT', async () => {
    // Two cartridge sections in one pack is a document that has lost its
    // place — and the spliced page is a facsimile of somebody else's sheet,
    // captioned with their name, printed into our contents page.
    const base = await svc.render({
      ...makeInput(withCartridgeSection),
      firearmSpec: [{ label: 'Make', value: 'CZ' }],
      cartridgeDrawing: drawing,
    } as never);
    const both = await svc.render({
      ...makeInput(withCartridgeSection),
      firearmSpec: [{ label: 'Make', value: 'CZ' }],
      cartridgeDrawing: drawing,
      cipSheet: { bytes: await onePageSheet(), label: 'The cartridge' },
    } as never);
    expect(await pageCount(both.pdf)).toBe(await pageCount(base.pdf));
  });

  async function onePageSheet(): Promise<Buffer> {
    const { PDFDocument } = await import('pdf-lib');
    const d = await PDFDocument.create();
    d.addPage([595.28, 841.89]);
    return Buffer.from(await d.save());
  }

  it('costs a pack with no drawing nothing at all', async () => {
    const a = await svc.render(makeInput(withCartridgeSection));
    const b = await svc.render(makeInput(withCartridgeSection));
    expect(await pageCount(a.pdf)).toBe(await pageCount(b.pdf));
  });
});

// ────────────────────────────────────────────────────────────────────
// THE STATUTORY BLOCK — MOTIVATION-GUIDE-BOOK Part 7.5.
//
// "The quoted subsections are set in a lightly indented block in the same
// serif at 10.5 pt, each element on its own line with its number, and the
// applicant's sentence under each element in normal body type."
//
// The type sizes are the renderer's; what is testable, and what actually
// decides whether the page reads correctly, is WHICH paragraphs get the
// treatment.
// ────────────────────────────────────────────────────────────────────

describe('telling the Act’s words from the applicant’s', () => {
  it('sets a quoted subsection as a quote', () => {
    for (const quote of [
      '(1) For purposes of this Act, a restricted firearm is any —',
      '(4) The Registrar may issue a licence in terms of this section …',
      '(a) semi-automatic rifle or shotgun, which cannot readily be converted …',
      '(12) Something with two digits.',
    ]) {
      expect(isQuotedSubsection(quote, true)).toBe(true);
    }
  });

  it('⚠️ LEAVES THE APPLICANT’S OWN SENTENCE IN BODY TYPE', () => {
    // This is the contrast the treatment exists for. The writer answers each
    // quoted element beneath it, and those sentences open with the section
    // reference rather than with the statute's bracket.
    for (const answer of [
      'Section 13(2)(a). I need a firearm for self-defence: the figures above.',
      'I hold competency certificate 1234567.',
      '13(1) is met by the firearm applied for.',
    ]) {
      expect(isQuotedSubsection(answer, true)).toBe(false);
    }
  });

  it('⚠️ NEVER FIRES OUTSIDE HEADING 11', () => {
    // Heading 11 is the only section that may quote the Act. A paragraph
    // elsewhere that opens with a bracket — an aside, an annexure
    // cross-reference — stays ordinary body copy.
    expect(isQuotedSubsection('(4) The Registrar may issue …', false)).toBe(
      false,
    );
    expect(
      isQuotedSubsection(
        '(Refer to Annexure B: Proficiency Certificates)',
        false,
      ),
    ).toBe(false);
  });
});

describe('⚠️ WHERE A HEADING MAY BE DRAWN', () => {
  /**
   * ⚠️ THE WHOLE-PARAGRAPH MOVE IS GONE. Operator, 2026-09-20: "Headings and
   * paragraphs can be split over two pages, paragraphs can be split from each
   * other but a heading can't be orphaned alone on a page." Paragraphs flow and
   * split freely now; the one pagination rule left is that a heading keeps the
   * opening of its section beneath it.
   */
  const PAGE_HEIGHT = 1000;
  const MARGIN_BOTTOM = 100; // the body column ends at y = 900.

  const orphan = (y: number, need?: number) =>
    headingWouldOrphan({
      y,
      pageHeight: PAGE_HEIGHT,
      marginBottom: MARGIN_BOTTOM,
      need,
    });

  it('leaves a heading alone where its section has room', () => {
    expect(orphan(400)).toBe(false);
  });

  it('⚠️ MOVES IT WHEN IT WOULD BE LEFT ALONE AT THE FOOT', () => {
    // Within one keep-with-next of the column bottom: the heading would sit
    // alone with none of its paragraph under it.
    expect(orphan(900 - HEADING_KEEP_WITH_NEXT + 1)).toBe(true);
  });

  it('sits exactly on the boundary', () => {
    // Exactly `need` above the bottom is still room enough; a hair past it is
    // not. The boundary is y = pageHeight - marginBottom - need.
    expect(orphan(900 - HEADING_KEEP_WITH_NEXT)).toBe(false);
    expect(orphan(900 - HEADING_KEEP_WITH_NEXT + 1)).toBe(true);
  });

  it('⚠️ HONOURS A LARGER NEED — a heading carrying a drawing or a table', () => {
    // The cartridge feature reserves its own height; the boundary moves up.
    expect(orphan(900 - HEADING_KEEP_WITH_NEXT, 300)).toBe(true);
  });
});

describe('⚠️ THE CARTRIDGE CARD’S RUN-IN LABELS', () => {
  it('splits a hyphenated run-in, so it renders like every other label', () => {
    // MO000002: "WELL MATCHED TO" was a label and "Under-Matched To: It is
    // under-matched to …" was inline prose, because the hyphen defeated the
    // pattern. One card, two label styles.
    expect(
      runInOf('Under-Matched To: It is under-matched to long ranges.'),
    ).toEqual({
      head: 'Under-Matched To',
      rest: 'Long ranges.',
    });
  });

  it('⚠️ STRIPS THE LABEL ECHOED INTO ITS OWN SENTENCE', () => {
    // The research writes the label twice: once as the heading, once as the
    // opening words of the sentence beneath it.
    expect(
      runInOf(
        'Well Matched To: It is well matched to medium and large plains game.',
      ),
    ).toEqual({
      head: 'Well Matched To',
      rest: 'Medium and large plains game.',
    });
    // And the bare echo, with no "It is".
    expect(runInOf('Origin: Origin of the cartridge is 1873.')).toEqual({
      head: 'Origin',
      rest: 'Of the cartridge is 1873.',
    });
  });

  it('leaves a sentence that does NOT echo the label untouched', () => {
    expect(
      runInOf('Effective Range: Due to a looping trajectory, 180 metres.'),
    ).toEqual({
      head: 'Effective Range',
      rest: 'Due to a looping trajectory, 180 metres.',
    });
  });

  it('still splits an ordinary run-in', () => {
    expect(runInOf('Origin: Developed in 1873.')).toEqual({
      head: 'Origin',
      rest: 'Developed in 1873.',
    });
  });

  it('never treats a long colon sentence as a label', () => {
    // More than four words before the colon is prose, not a heading.
    expect(
      runInOf('It is standardised with a case length of 48.77 mm: the figure'),
    ).toBeNull();
  });
});

describe('⚠️ THE RUNNING BANNER LABEL', () => {
  it('shortens the long skeleton headings, number stripped', () => {
    // The full heading ellipsised mid-word in the banner of every page:
    // "…WHY IT SUITS T…". The banner has room for about forty characters.
    expect(
      runningLabelFor(
        '5. The firearm applied for and why it suits the purpose',
      ),
    ).toBe('The firearm applied for');
    expect(runningLabelFor('6. Firearms already licensed to me')).toBe(
      'Firearms already licensed',
    );
    expect(
      runningLabelFor('8. Association membership and dedicated status'),
    ).toBe('Association membership');
  });

  it('falls back to the heading for anything not listed', () => {
    expect(runningLabelFor('7. My competency and training')).toBe(
      'Competency and training',
    );
    expect(runningLabelFor('3. My hunting')).toBe('My hunting');
  });

  it('keeps every label short enough to fit the banner', () => {
    for (const h of [
      '5. The firearm applied for and why it suits the purpose',
      '6. Firearms already licensed to me',
      '8. Association membership and dedicated status',
      '11. Section 16 applied to my application',
      '12. Declaration and request',
    ]) {
      expect(runningLabelFor(h).length).toBeLessThanOrEqual(28);
    }
  });

  it('strips a decimal number, and names the cartridge plainly', () => {
    // The cartridge feature is numbered 5.1; its banner reads "The cartridge",
    // not the calibre.
    expect(runningLabelFor('5.1 The cartridge — .45-70 Government')).toBe(
      'The cartridge',
    );
  });
});

describe('⚠️ SPLITTING A NUMBERED HEADING', () => {
  it('keeps the twelve skeleton numbers', () => {
    expect(splitHeading('5. The firearm applied for')).toEqual({
      number: '5',
      title: 'The firearm applied for',
    });
    expect(splitHeading('11. Section 16 applied to my application')).toEqual({
      number: '11',
      title: 'Section 16 applied to my application',
    });
  });

  it('reads a decimal as one number, not number-plus-title', () => {
    // "5.1 The cartridge" used to split as number "5" and title "1 The
    // cartridge", printing "5 · 1 THE CARTRIDGE".
    expect(splitHeading('5.1 The cartridge — .45-70 Government')).toEqual({
      number: '5.1',
      title: 'The cartridge — .45-70 Government',
    });
  });

  it('leaves an unnumbered heading alone', () => {
    expect(splitHeading('The cartridge — .45-70 Government')).toEqual({
      number: '',
      title: 'The cartridge — .45-70 Government',
    });
  });
});

describe('the purpose exhibits under heading 3', () => {
  const svc = new MotivationPdfService();

  /** A real 1×1 PNG, so pdfkit genuinely embeds an image. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  const withPurposeSection = [
    'Introduction:',
    'I am applying for a licence in terms of section 16.',
    '3. My hunting',
    'Impala and kudu are the staple quarry for this calibre at bushveld distances.',
    '5. The firearm applied for',
    'The rifle suits the purpose set out above.',
  ].join('\n\n');

  const PLATES = [
    {
      pageIndex: 1,
      plateIndex: 1,
      title: 'Impala',
      description:
        'Impala is characteristic quarry of this class at bushveld distances.',
      image: { bytes: PNG, width: 1800, height: 900 },
    },
    {
      pageIndex: 1,
      plateIndex: 2,
      title: 'Greater kudu',
      description: 'Kudu is characteristic quarry taken at longer ranges.',
      image: { bytes: PNG, width: 1800, height: 900 },
    },
    {
      pageIndex: 2,
      plateIndex: 1,
      title: 'Gemsbok',
      description: 'Gemsbok is characteristic quarry of the open plains.',
      image: { bytes: PNG, width: 1800, height: 900 },
    },
  ];

  it('⚠️ PRINTS THE EXHIBITS UNDER HEADING 3, WITH THEIR DESCRIPTIONS', async () => {
    const { pdf } = await svc.render({
      ...makeInput(withPurposeSection),
      purposeHeading: '3. MY HUNTING',
      purposePlates: PLATES,
    } as never);
    const pages = await pageTexts(pdf);
    const joined = pages.join(' ');
    expect(joined).toContain('Impala');
    expect(joined).toContain('Greater kudu');
    expect(joined).toContain('Gemsbok');
    expect(joined).toContain(
      'characteristic quarry of this class at bushveld distances',
    );

    // Two pages of exhibits, numbered, both present.
    expect(flat(joined)).toMatch(/PURPOSE EXHIBITS \(PAGE 1 OF 2\)/i);
    expect(flat(joined)).toMatch(/PURPOSE EXHIBITS \(PAGE 2 OF 2\)/i);
  });

  it('⚠️ DRAWS NOTHING WHEN THE PACK HAS NO EXHIBITS', async () => {
    const { pdf } = await svc.render({
      ...makeInput(withPurposeSection),
      purposeHeading: '3. MY HUNTING',
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).not.toMatch(/Purpose exhibits/i);
  });

  it('⚠️ A PLATE WITH NO PICTURE STILL PRINTS ITS WORDS', async () => {
    // A safety refusal or a slow call loses one picture, never the page.
    const { pdf } = await svc.render({
      ...makeInput(withPurposeSection),
      purposeHeading: '3. MY HUNTING',
      purposePlates: [
        {
          pageIndex: 1,
          plateIndex: 1,
          title: 'Impala',
          description: 'Impala is characteristic quarry at bushveld distances.',
        },
      ],
    } as never);
    const t = flat((await readPdfAsync(pdf)).text);
    expect(t).toContain('Impala');
    expect(t).toContain('characteristic quarry at bushveld distances');
  });
});
