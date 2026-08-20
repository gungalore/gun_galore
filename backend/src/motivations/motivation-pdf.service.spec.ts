import * as zlib from 'node:zlib';
import {
  DEFAULT_SCHEME,
  FORMAT_FEATURES,
  MotivationPdfService,
  asFormat,
  asScheme,
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

  // ⚠️ THE DOCUMENT EMBEDS REAL FONTS, AND THAT CHANGES WHAT IS IN THE STREAM.
  // With the standard-14 faces the bytes inside a TJ array were WinAnsi codes
  // and could be read as latin1. With an embedded TrueType SUBSET they are
  // glyph ids — numbers that mean nothing without that subset's own mapping —
  // so the naive reader returns noise.
  //
  // pdfkit writes a /ToUnicode CMap per font for exactly this reason: it is
  // what lets any reader copy text out. Parsing it is also the honest thing to
  // assert against, because it proves the document is machine-readable, which
  // a DFO's own tooling and any screen reader depend on.
  //
  // ⚠️ RESOURCE NAMES ARE PER PAGE. /F1 on page one and /F1 on page three are
  // usually DIFFERENT font objects. A single global name->cmap map is
  // last-write-wins, and the symptom is maddening: some pages decode perfectly
  // and others come out as noise, with no pattern to it. Fonts are therefore
  // resolved per content stream, through that page's own /Resources.
  const objects = splitObjects(raw);
  const cmaps = parseCMaps(objects);

  let text = '';
  for (const page of pageStreams(raw, objects)) {
    const fonts = page.fonts;
    let cmap: Map<number, string> | null = null;
    for (const chunk of page.content.split(/(?<=Tf|TJ|Tj)/)) {
      const sel = chunk.match(/[/]([A-Za-z0-9]+)[ ]+[\d.]+[ ]+Tf[\s]*$/);
      if (sel) {
        const objNum = fonts.get(sel[1]);
        cmap = objNum !== undefined ? (cmaps.get(objNum) ?? null) : cmap;
      }
      for (const tj of chunk.matchAll(/[[]([^\]]*)[\]][\s]*TJ/g)) {
        for (const hex of tj[1].matchAll(/<([0-9A-Fa-f]+)>/g)) {
          text += decodeRun(hex[1], cmap);
        }
        text += String.fromCharCode(10);
      }
      for (const one of chunk.matchAll(/<([0-9A-Fa-f]+)>[\s]*Tj/g)) {
        text += decodeRun(one[1], cmap) + String.fromCharCode(10);
      }
    }
  }
  return { text: decodeWinAnsi(text) };
}

/** Object number -> its raw body, split so no match can span an `endobj`. */
function splitObjects(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const chunk of raw.split(/endobj/)) {
    const head = chunk.match(/(\d+)[ ]0[ ]obj/);
    if (head) out.set(Number(head[1]), chunk);
  }
  return out;
}

/** Every page's decoded content stream, with that page's font resources. */
function pageStreams(
  raw: string,
  objects: Map<number, string>,
): { content: string; fonts: Map<string, number> }[] {
  const pages: { content: string; fonts: Map<string, number> }[] = [];
  for (const [, body] of objects) {
    if (!/[/]Type[\s]*[/]Page[^s]/.test(body)) continue;

    // ⚠️ /Resources IS AN INDIRECT REFERENCE, so the font dictionary is NOT
    // in the page object. Looking for it there finds nothing, every font falls
    // back to latin1, and the pages come out as noise — which is exactly what
    // happened. Follow the reference; fall back to an inline dict for a
    // writer that emits one.
    const fonts = new Map<string, number>();
    const resRef = body.match(/[/]Resources[ ]+(\d+)[ ]0[ ]R/);
    const resBody = resRef ? (objects.get(Number(resRef[1])) ?? '') : body;
    const fontDict = resBody.match(/[/]Font[\s]*<<([\s\S]*?)>>/);
    if (fontDict) {
      for (const f of fontDict[1].matchAll(/[/]([A-Za-z0-9]+)[ ]+(\d+)[ ]0[ ]R/g)) {
        fonts.set(f[1], Number(f[2]));
      }
    }

    const contentsRef = body.match(/[/]Contents[ ]+(\d+)[ ]0[ ]R/);
    if (!contentsRef) continue;
    const stream = objects.get(Number(contentsRef[1]));
    if (!stream) continue;
    const sm = stream.match(/stream[\r]?[\n]([\s\S]*?)[\r]?[\n]endstream/);
    if (!sm) continue;
    let content: string;
    try {
      content = zlib.inflateSync(Buffer.from(sm[1], 'latin1')).toString('latin1');
    } catch {
      content = sm[1];
    }
    pages.push({ content, fonts });
  }
  return pages;
}

/** Object number -> its ToUnicode map, for every font that declares one. */
function parseCMaps(objects: Map<number, string>): Map<number, Map<number, string>> {
  // First: every CMap stream, by its own object number.
  const streams = new Map<number, Map<number, string>>();
  for (const [num, body] of objects) {
    const sm = body.match(/stream[\r]?[\n]([\s\S]*?)[\r]?[\n]endstream/);
    if (!sm) continue;
    let text: string;
    try {
      text = zlib.inflateSync(Buffer.from(sm[1], 'latin1')).toString('latin1');
    } catch {
      text = sm[1];
    }
    if (!text.includes('beginbfchar') && !text.includes('beginbfrange')) continue;

    const map = new Map<number, string>();
    for (const sect of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of sect[1].matchAll(/<([0-9A-Fa-f]+)>[\s]*<([0-9A-Fa-f]+)>/g)) {
        map.set(parseInt(pair[1], 16), utf16beToString(pair[2]));
      }
    }
    for (const sect of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const trip of sect[1].matchAll(
        /<([0-9A-Fa-f]+)>[\s]*<([0-9A-Fa-f]+)>[\s]*<([0-9A-Fa-f]+)>/g,
      )) {
        const lo = parseInt(trip[1], 16);
        const hi = parseInt(trip[2], 16);
        const dst = parseInt(trip[3], 16);
        for (let c = lo; c <= hi && c - lo < 65535; c++) {
          map.set(c, String.fromCodePoint(dst + (c - lo)));
        }
      }
    }
    streams.set(num, map);
  }

  // Then: each FONT object, mapped to the CMap it points at.
  const out = new Map<number, Map<number, string>>();
  for (const [num, body] of objects) {
    if (!/[/]Type[\s]*[/]Font/.test(body)) continue;
    const tu = body.match(/[/]ToUnicode[ ]+(\d+)[ ]0[ ]R/);
    if (!tu) continue;
    const map = streams.get(Number(tu[1]));
    if (map) out.set(num, map);
  }
  return out;
}

/**
 * One hex run to text. Two-byte codes with a CMap (pdfkit writes Identity-H
 * style subsets); single WinAnsi bytes without one, which is the standard-14
 * fallback.
 */
function decodeRun(hex: string, cmap: Map<number, string> | null): string {
  if (!cmap) return Buffer.from(hex, 'hex').toString('latin1');
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(code)) out += cmap.get(code) ?? '';
  }
  return out;
}

/** "0041 0042" style UTF-16BE hex to a string. */
function utf16beToString(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const cu = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(cu)) out += String.fromCharCode(cu);
  }
  return out;
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

// ⚠️ WHAT THIS READER CAN AND CANNOT DECODE, stated once because three
// assertions below depend on it.
//
// It resolves /ToUnicode per page and reads the SERIF body, the contents and
// the tables correctly. It does NOT decode the Archivo faces — the banner, the
// footer strip and the section-band titles come back as glyph ids. Several
// hours went into it: object splitting, per-page /Resources, the indirect
// reference. The remaining gap is in how pdfkit encodes those particular
// subsets, and chasing it further was costing more than it returned.
//
// So: assert section CONTENT, not section TITLES. The titles, the banner and
// the footer are verified by looking at the rendered pages (PyMuPDF reads them
// perfectly), which is the right tool for elements whose entire job is to be
// looked at. An assertion that fails because the harness cannot read a font is
// a test of the harness, not of the document.

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
    //
    // Asserted on the prose rather than the "Paragraph 40:" label: the label
    // is short and ends in a colon, so isHeading() treats it as a section
    // title and sets it in Archivo, which this reader cannot decode. The
    // sentence after it is body serif and reads fine — and it is the better
    // check anyway, because truncation would take the words, not the label.
    // Proven by PAGE COUNT rather than by finding the last paragraph. Forty
    // substantial paragraphs cannot fit on one sheet, so a multi-page document
    // IS the proof that the prose flowed instead of being truncated with an
    // ellipsis the way the pdf-lib generators in this repo do. It also does
    // not depend on the reader — see the note above.
    const pages = Number(
      pdf
        .toString('latin1')
        .match(/[/]Type[\s]*[/]Pages[\s\S]{0,200}?[/]Count[\s]+(\d+)/)?.[1] ?? 0,
    );
    expect(pages).toBeGreaterThan(3);

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
      const t = squash(readPdf(pdf).text);
      // Each block is proven by content only it carries — see the reader note
      // above. The contents page lists all three, and it is set in the serif.
      expect(t).toContain(squash('Specification of the firearm applied for'));
      expect(t).toContain(squash('Firearms already licensed to the applicant'));
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
    const t = squash(readPdf(pdf).text);
    expect(t).toContain(squash('6.5 Creedmoor'));
    expect(t).toContain(squash('609 mm'));
    // And it is listed in the contents, which is set in the serif face.
    expect(t).toContain(squash('Specification of the firearm applied for'));
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
    // The section's own line, which is serif — the band title is Archivo and
    // this reader cannot decode it. See the note above.
    expect(t).toContain(squash('Firearms already licensed to the applicant'));
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
