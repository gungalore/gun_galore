// ────────────────────────────────────────────────────────────────────
// THE MOTIVATION, AS A SELF-CONTAINED HTML DOCUMENT.
//
// This is the first half of the renderer swap: a pure function that turns the
// printed-content model into HTML + CSS. A separate Chromium printer service
// (`chromium-pdf.service.ts`) turns the result into a PDF. Nothing here touches
// a PDF directly, nothing reads the clock, and nothing reaches the network: the
// same MotivationPdfInput always produces the same bytes.
//
// ⚠️ FLOW, NOT FIXED SHEETS. The pages flow continuously and Chromium breaks
// them; the running footer repeats on every printed sheet via `position: fixed`
// (Chromium repeats fixed elements, and the bottom band is reserved by the
// @page bottom margin so it never collides with the body). A fixed top header
// is NOT used: Chromium places a fixed top element at the content edge on
// continuation pages and it collides with the first line, so the running head
// is set once as a masthead at the top of the body instead.
//
// ⚠️ NO PAGE NUMBERS ARE FABRICATED. HTML cannot know how many printed pages
// the document will run to, so the contents carries no page numbers and the
// footer carries no "page N of M". A per-page section label and page numbering
// need the CDP/Playwright header-footer templates, which is the next slice.
//
// ⚠️ WHAT IS NOT HERE YET. Anything graphical or raster is still drawn by the
// existing pdfkit renderer, because this function cannot lay out a raster and
// HTML cannot merge a member's own PDF. Those parts are:
//
//   - the firearm photograph on the cover (firearmPhoto)
//   - the cartridge drawing and its dimension callouts (cartridgeDrawing)
//   - the C.I.P. datasheet page (cipSheet)
//   - the press-clipping pictures (pressClippings) and the activity
//     photographs (evidencePages)
//   - the generated witness and seller-consent forms (characterStatements,
//     sellerConsent) and the SAPS 271 form
//   - the scanned annexure sheets (annexureImages) and the merged annexure
//     PDFs (annexurePdfs)
//   - the subject marks (sectionMarks), which are drawn glyphs
//
// Those stay in motivation-pdf.service.ts until the printer lands.
// ────────────────────────────────────────────────────────────────────

import {
  SCHEMES,
  type MotivationPdfInput,
  asScheme,
} from './motivation-pdf.service';
import { LAYOUTS, asLayout } from './motivation-pdf-layouts';

const SERIF = 'Georgia, "Source Serif 4", "Times New Roman", serif';
const SANS = '"Helvetica Neue", Arial, sans-serif';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * A long date, in UTC.
 *
 * ⚠️ NEVER toLocaleDateString. A locale-formatted date can differ between the
 * developer's machine and the box, on a document somebody signs; UTC and a
 * hand-rolled month table make the output byte-identical everywhere.
 */
function longDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * HTML-escape one piece of model text.
 *
 * ⚠️ EVERY DYNAMIC VALUE GOES THROUGH THIS. The body is plain prose today, but
 * it is generated and it is the applicant's, so it is untrusted markup-wise.
 */
type Cell = string | number | null | undefined;

function esc(value: Cell): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface BodySection {
  /** The book's number, e.g. "1", "5.1", or "" for an unnumbered heading. */
  number: string;
  title: string;
  paragraphs: string[];
}

/**
 * Is this line a heading?
 *
 * ⚠️ MIRRORS motivation-pdf.service.ts `isHeading` EXACTLY, and the trailing
 * colon is NOT the test any more. Headings are numbered and colon-free since
 * the skeleton was fixed (MOTIVATION-GUIDE-BOOK Part 7.1): "1. Application".
 * The old colon form is still accepted because stored documents generated
 * before the change are re-rendered on every download.
 */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 80) return false;
  return /^\d{1,2}\.\s/.test(t) || t.endsWith(':');
}

/**
 * Split a heading into the book's number and its title.
 *
 * ⚠️ MIRRORS `splitHeading` in motivation-pdf.service.ts. The number is the
 * book's, never a running count, so an application that omits a section keeps
 * its gaps (1, 3, 5, 6 …) and the contents agrees with every other pack.
 */
function splitHeading(heading: string): { number: string; title: string } {
  const m = /^(\d{1,2}(?:\.\d+)?)\.?\s+(.*)$/.exec(heading.trim());
  if (m) return { number: m[1], title: m[2] };
  return { number: '', title: heading.trim().replace(/:\s*$/, '') };
}

/** Headings and paragraphs from the plain-text body. */
function parseBody(body: string): BodySection[] {
  const sections: BodySection[] = [];
  let current: BodySection | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    buffer = [];
    if (!text) return;
    if (current) current.paragraphs.push(text);
    else sections.push({ number: '', title: '', paragraphs: [text] });
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (isHeading(line)) {
      flush();
      const { number, title } = splitHeading(line);
      current = { number, title, paragraphs: [] };
      sections.push(current);
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections.filter((s) => s.title || s.paragraphs.length);
}

function table(headers: string[], rows: Cell[][]): string {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function list(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

function toc(items: string[]): string {
  return `<div class="toc">${items
    .map((i) => `<div><span>${esc(i)}</span></div>`)
    .join('')}</div>`;
}

/** A section heading, with its book number when it has one. */
function heading(text: string, cls: string): string {
  const { number, title } = splitHeading(text);
  const n = number ? `<span class="n">${esc(number)}</span>` : '';
  return `<h2 class="${cls}">${n}${esc(title)}</h2>`;
}

export function renderMotivationHtml(input: MotivationPdfInput): string {
  const scheme = asScheme(input.colourway);
  const colours = SCHEMES[scheme];
  const layoutKey = asLayout(input.layout);
  const layout = LAYOUTS[layoutKey];
  const bodyFont = layout.bodyFace === 'sans' ? SANS : SERIF;
  const headingClass = `h h--${layout.heading}`;

  const applicantLine = [input.applicantName, input.idNumber?.trim()]
    .filter(Boolean)
    .join(' · ');

  // ── The running footer ─────────────────────────────────────────────
  //
  // ⚠️ NO SERVICE NAME AND NO MO REFERENCE. MOTIVATION-GUIDE-BOOK Part 1 rule
  // 2 and motivation-pdf-footer.spec.ts: the footer names the applicant, carries
  // the ID number and the initial line. The reference lives only in the PDF
  // Title metadata and the download filename.
  const runningFooter = `<footer class="ftr">
      <span>${esc(applicantLine)}</span>
      <span>Initial: ________</span>
    </footer>`;

  // ── The body, parsed once ──────────────────────────────────────────
  const sections = parseBody(input.body);
  const contentsItems = sections
    .filter((s) => s.title)
    .map((s) => `${s.number ? `${s.number}. ` : ''}${s.title}`);

  const owned = input.ownedFirearms ?? [];
  const showPurpose = owned.some((f) => (f.status ?? '').trim() !== '');
  if (owned.length) {
    contentsItems.push(
      input.batteryHeading ?? 'Firearms already licensed to the applicant',
    );
  }
  if ((input.firearmSpec ?? []).length) {
    contentsItems.push(input.firearmHeading ?? 'Firearm specification');
  }
  if ((input.takeWithYou ?? []).length) {
    contentsItems.push('Before you go: what to take to the DFO');
  }
  if ((input.annexures ?? []).length || (input.missingDocuments ?? []).length) {
    contentsItems.push('Annexures');
  }
  contentsItems.push('Declaration');

  // ── Cover particulars ──────────────────────────────────────────────
  const coverRows: Cell[][] = [['Applicant', input.applicantName]];
  if (input.idNumber?.trim()) {
    coverRows.push(['Identity number', input.idNumber.trim()]);
  }
  if (input.firearmLine?.trim()) {
    coverRows.push(['Firearm', input.firearmLine.trim()]);
  }
  for (const [label, value] of input.coverParticulars ?? []) {
    coverRows.push([label, value]);
  }
  if (owned.length) {
    const letters = (input.annexures ?? []).map((a) => a.letter).filter(Boolean);
    if (letters.length) {
      coverRows.push([
        'Annexures',
        `${letters[0]} to ${letters[letters.length - 1]}, ${letters.length} attached`,
      ]);
    }
  }

  // ── Cover page ─────────────────────────────────────────────────────
  const cover = `<section class="cover" data-section="cover">
      <div class="cover-top">
        <div class="eyebrow">APPLICATION FOR A LICENCE TO POSSESS A FIREARM</div>
      </div>
      <h1>Motivation</h1>
      <div class="subtitle">${esc(input.licenceTypeLabel)}</div>
      <div class="rule"></div>
      <table class="kv"><tbody>${coverRows
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join('')}</tbody></table>
      ${
        contentsItems.length
          ? `<div class="inpack"><div class="inpack-label">IN THIS PACK</div>${toc(
              contentsItems,
            )}</div>`
          : ''
      }
    </section>`;

  const contents = `<section class="toc-page" data-section="contents">
      <h1 class="page-title">Contents</h1>
      ${toc(contentsItems)}
    </section>`;

  // ── Flowing body ───────────────────────────────────────────────────
  const flow: string[] = [];

  // The running head, set once. See the file header: a fixed top header is
  // unreliable in Chromium print, so the head lives in the flow instead.
  flow.push(`<div class="masthead">
      <span>Motivation · ${esc(input.licenceTypeLabel)}</span>
      ${input.firearmLine ? `<span>${esc(input.firearmLine)}</span>` : ''}
    </div>`);

  for (const section of sections) {
    if (!section.title) {
      flow.push(
        `<section class="body-section" data-section="body">${section.paragraphs
          .map((p) => `<p>${esc(p)}</p>`)
          .join('')}</section>`,
      );
      continue;
    }
    const n = section.number ? `<span class="n">${esc(section.number)}</span>` : '';
    flow.push(`<section class="body-section" data-section="body">
      <h2 class="${headingClass}">${n}${esc(section.title)}</h2>
      ${section.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
    </section>`);
  }

  // Firearms already held.
  if (owned.length) {
    const headers = [
      'Make and model',
      'Calibre',
      'Serial',
      'Expires',
      'Type',
      'Section',
    ];
    if (showPurpose) headers.push('Purpose');
    const rows = owned.map((f) => {
      const cells: Cell[] = [
        f.make,
        f.calibre,
        f.serial,
        f.expiry,
        f.type ?? '',
        f.section ?? '',
      ];
      if (showPurpose) cells.push(f.status ?? '');
      return cells;
    });
    flow.push(`<section class="body-section" data-section="owned">
      ${heading(
        input.batteryHeading ?? 'Firearms already licensed to the applicant',
        headingClass,
      )}
      ${table(headers, rows)}
    </section>`);
  }

  // Firearm specification.
  if ((input.firearmSpec ?? []).length) {
    flow.push(`<section class="body-section" data-section="spec">
      ${heading(input.firearmHeading ?? 'Firearm specification', headingClass)}
      ${table(
        ['Specification', 'Detail'],
        (input.firearmSpec ?? []).map((s) => [s.label, s.value]),
      )}
    </section>`);
  }

  // Take with you.
  if ((input.takeWithYou ?? []).length) {
    flow.push(`<section class="body-section" data-section="take">
      ${heading('Before you go: what to take to the DFO', headingClass)}
      ${list(
        (input.takeWithYou ?? []).map(
          (i) => `${esc(i.label)}${i.note ? ` — ${esc(i.note)}` : ''}`,
        ),
      )}
    </section>`);
  }

  // Annexure index.
  const annexures = input.annexures ?? [];
  const missing = input.missingDocuments ?? [];
  const notPrinted = input.annexuresNotPrinted ?? [];
  const pdfCount = (input.annexurePdfs ?? []).length;
  if (annexures.length || missing.length || notPrinted.length || pdfCount) {
    const blocks: string[] = [];
    if (annexures.length) {
      blocks.push(
        table(
          ['Item', 'Description', 'Pages', 'Certification'],
          annexures.map((a) => [a.letter, a.label, a.count, a.certification]),
        ),
      );
    }
    if (missing.length) {
      blocks.push(`<h3>Not attached</h3>${list(missing.map((m) => esc(m)))}`);
    }
    if (notPrinted.length) {
      blocks.push(
        `<h3>Uploaded but not reprinted</h3>${list(
          notPrinted.map(
            (a) => `${esc(a.letter)}: ${esc(a.label)} — ${esc(a.why)}`,
          ),
        )}`,
      );
    }
    if (pdfCount) {
      blocks.push(
        `<p class="small">${pdfCount} annexure PDF${
          pdfCount === 1 ? '' : 's'
        } merged into the finished pack after this template is printed.</p>`,
      );
    }
    flow.push(`<section class="body-section" data-section="annexures">
      ${heading('Annexures', headingClass)}
      ${blocks.join('')}
    </section>`);
  }

  // Declaration / signature.
  flow.push(`<section class="body-section declaration" data-section="declaration">
      ${heading('Declaration', headingClass)}
      <p>I confirm that the facts in this motivation are true and correct,
      that I prepared it from information I supplied, and that I submit it as
      my own. I undertake to store and use the firearm as the Act requires.</p>
      <p>Signed at ____________ on ______/______/20______.</p>
      <div class="sig">
        <div>Signature</div>
        <div>Date</div>
        <div>Place</div>
      </div>
      <p class="signer">${esc(input.applicantName)}${
        input.idNumber?.trim() ? `<br>${esc(input.idNumber.trim())}` : ''
      }</p>
      <p class="small">${esc(input.disclaimer)}</p>
      <p class="small">Template ${esc(input.templateVersion)} · ${esc(
        longDate(input.generatedAt),
      )}</p>
    </section>`);

  // Warnings, if any. Removed at the counter and never lodged.
  if ((input.warnings ?? []).length) {
    flow.push(`<section class="body-section warnings" data-section="warnings">
      ${heading('Please check before you lodge', headingClass)}
      <p class="small">This page is not part of the pack that is filed.</p>
      ${list(
        (input.warnings ?? []).map(
          (w) => `<b>${esc(w.authority)}:</b> ${esc(w.message)}`,
        ),
      )}
    </section>`);
  }

  const css = `
@page { size: A4; margin: 18mm 20mm 20mm 20mm; }
* { box-sizing: border-box; }
:root {
  --accent: ${colours.accent};
  --ink: ${colours.ink};
  --sub: ${colours.sub};
  --mut: ${colours.mut};
  --band: ${colours.band};
  --hair: ${colours.hair};
  --wash: ${colours.wash};
  --deep: ${colours.deep};
  --banner-from: ${colours.bannerFrom};
  --banner-to: ${colours.bannerTo};
  --body-font: ${bodyFont};
}
body { margin: 0; font-family: var(--body-font); color: var(--ink);
  background: #fff; font-size: 10.5pt; line-height: 1.5; }
.cover, .toc-page { page-break-after: always; break-after: page; }
.declaration, .warnings { page-break-before: always; break-before: page; }
h1 { font: 700 26pt ${SANS}; margin: 0 0 3mm 0; letter-spacing: -.01em; }
h1.page-title { margin-bottom: 7mm; }
h2 { font: 700 11.5pt ${SANS}; margin: 7mm 0 3mm 0; text-transform: uppercase;
  letter-spacing: .06em; color: var(--ink); page-break-after: avoid;
  break-after: avoid; }
.body-section:first-child h2 { margin-top: 0; }
h2 .n { color: var(--accent); margin-right: 2mm; }
h2.h--underline { text-align: center; border-bottom: 1pt solid var(--ink);
  padding-bottom: 2mm; }
h2.h--numeral { font-size: 18pt; }
h2.h--bar { border-left: 4mm solid var(--accent); padding-left: 3mm; }
h2.h--caps { letter-spacing: .18em; margin-bottom: 5mm; }
h3 { font: 700 9.5pt ${SANS}; text-transform: uppercase; letter-spacing: .06em;
  color: var(--sub); margin: 6mm 0 2mm 0; page-break-after: avoid; }
p { font-size: 10.5pt; line-height: 1.5; margin: 0 0 3mm 0; text-align: justify; }
p.small, .small { font-size: 8.5pt; color: var(--mut); line-height: 1.4; }
p.signer { margin-top: 6mm; font-weight: 700; }
ul { margin: 0 0 3mm 0; padding-left: 5mm; font-size: 10.5pt; line-height: 1.5; }
li { margin-bottom: 1.5mm; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
tr { page-break-inside: avoid; break-inside: avoid; }
th { text-align: left; font: 700 8pt ${SANS}; letter-spacing: .06em;
  text-transform: uppercase; color: var(--sub);
  border-bottom: 1pt solid var(--ink); padding: 2mm 2mm 2mm 0; }
td { padding: 2.2mm 2mm 2.2mm 0; border-bottom: .5pt solid var(--hair);
  vertical-align: top; }
.kv td:first-child { font: 8pt ${SANS}; letter-spacing: .06em;
  text-transform: uppercase; color: var(--sub); width: 38mm; }
.rule { height: 1.2pt; background: var(--accent); width: 28mm; margin: 4mm 0 8mm 0; }
.cover-top { display: flex; justify-content: space-between; align-items: flex-start; }
.eyebrow { font: 700 9pt ${SANS}; letter-spacing: .14em; color: var(--accent); }
.subtitle { font: 12pt ${SANS}; color: var(--sub); margin-bottom: 2mm; }
.inpack { margin-top: 10mm; }
.inpack-label { font: 700 8pt ${SANS}; letter-spacing: .1em; color: var(--sub);
  margin-bottom: 2mm; }
.toc { font-size: 10.5pt; }
.toc div { display: flex; justify-content: space-between;
  border-bottom: .5pt dotted var(--hair); padding: 1.6mm 0; }
.sig { margin-top: 12mm; display: flex; gap: 12mm; }
.sig div { flex: 1; border-top: .6pt solid var(--ink); padding-top: 2mm;
  font: 8pt ${SANS}; letter-spacing: .06em; text-transform: uppercase;
  color: var(--sub); }
.masthead { display: flex; justify-content: space-between; font: 8.5pt ${SANS};
  color: var(--mut); letter-spacing: .04em; border-bottom: .5pt solid var(--hair);
  padding-bottom: 2mm; margin-bottom: 6mm; }
.ftr { position: fixed; left: 0; right: 0; bottom: 0; display: flex;
  justify-content: space-between; font: 8.5pt ${SANS}; color: var(--mut);
  letter-spacing: .04em; padding: 2mm 20mm 0; border-top: .5pt solid var(--hair); }
[data-layout="banner"] .masthead { border-bottom-color: var(--accent); }
`;

  // ⚠️ NO WATERMARK. Operator, 2026-10-15: "remove the watermark." The
  // on-screen "NOT FOR USE · PREVIEW" mark is gone; `input.watermark` is no
  // longer read.
  return [
    '<!doctype html>',
    `<html lang="en" data-layout="${layoutKey}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<title>Motivation ${esc(input.referenceNumber)}</title>`,
    `<style>${css}</style>`,
    '</head>',
    '<body>',
    runningFooter,
    cover,
    contents,
    ...flow,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
