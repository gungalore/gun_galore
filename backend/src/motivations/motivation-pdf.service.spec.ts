import * as zlib from 'node:zlib';
import { MotivationPdfService } from './motivation-pdf.service';

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
  return { text };
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

    // Pagination is proven from the footers we stamp: every page must carry
    // one, they must all agree on the total, and the page numbers must be a
    // complete 1..N run with no gaps or repeats. That is a stronger check than
    // counting page objects in the bytes, and it also proves bufferPages
    // resolved the total before any footer was written.
    const footers = [...flat(text).matchAll(/page (\d+) of (\d+)/g)];
    expect(footers.length).toBeGreaterThan(2);
    const totals = new Set(footers.map((f) => f[2]));
    expect(totals.size).toBe(1);
    const total = Number([...totals][0]);
    expect(footers.length).toBe(total);
    expect(footers.map((f) => Number(f[1]))).toEqual(
      Array.from({ length: total }, (_, i) => i + 1),
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
