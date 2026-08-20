import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  GAP,
  STAMP_H,
  captionFor,
  planAnnexurePages,
} from './motivation-annexure-layout';
import {
  appendPdfAnnexures,
  extraPageCount,
  loadPdfAnnexures,
  type PdfAnnexure,
} from './motivation-pdf-merge';
import type { AnnexureEntry, CertificationLevel } from './motivation-checklist';
import * as K from './motivation-pdf-chrome';

// ────────────────────────────────────────────────────────────────────
// The formal motivation document. This is the thing the applicant signs and
// hands to the DFO, so it is deliberately the plainest surface we produce.
//
// WHY pdfkit AND NOT pdf-lib. Every other PDF here uses pdf-lib
// (receipt.service.ts, saps534.service.ts) and that is right for what they do:
// a fixed one-page receipt, and drawing values into the boxes of a static SAPS
// form. pdf-lib has NO layout engine — receipt.service.ts keeps a manual `y`
// cursor and truncates anything long (`title.slice(0, 67) + '…'`). A motivation
// is multi-page flowing prose, so pdf-lib would mean hand-writing word wrap,
// pagination and widow control first. pdfkit does all of that natively, was
// ALREADY a dependency (package.json, with @types/pdfkit) and had zero imports
// — so this costs no new dependency, no lockfile churn, no native modules and
// no headless browser on the box.
//
// STANDARD FONTS ONLY, on purpose. pdfkit reads its .afm metrics from inside
// node_modules at runtime. nest-cli.json does not copy non-TS assets into
// dist/, which is why saps534.service.ts has to resolve its blank form from
// process.cwd()+'assets' with a candidate-path list. Standard fonts sidestep
// that entirely. If a custom TTF is ever wanted, it must live in
// backend/assets/ and be resolved the same defensive way, or it works locally
// and 404s in production.
//
// ⚠️ REAL NAME, DELIBERATELY. Every other surface on this platform shows the
// username only — receipt.service.ts:16-19 says so for receipts, and it is a
// standing house rule. This document is the documented exception: a motivation
// addressed to the Registrar with a username on it is worthless. Do not
// "fix" this to a username.
//
// ⚠️ NO OUTCOME LANGUAGE, ANYWHERE. Not "improves your chances", not "approval
// likely", no success rates — not in this PDF, not in the UI, not in emails.
// We sell structure and completeness, never odds. (CPA/advertising exposure.)
//
// ⚠️ NO MASCOT. Boet runs the interview; Boet appears nowhere on the document.
// No red, no branding beyond one discreet footer line.
//
// NOTHING IS STORED. Like ReceiptService, the bytes are built on demand from
// the encrypted document text and streamed. There is no PDF on disk, in the DB
// or on Cloudinary — which also means the POPIA erasure endpoint has no assets
// to chase.
// ────────────────────────────────────────────────────────────────────

/**
 * Page geometry.
 *
 * \u26a0\ufe0f THESE NOW COME FROM THE HANDOFF, via motivation-pdf-chrome. The old
 * numbers were measured off a Safari Outdoor pack \u2014 72 pt margins, an 11 pt
 * Arial body, a two-line footer \u2014 and that document has been replaced by the
 * operator's own design: a 16 mm gradient banner, a 10 mm footer strip and
 * 14 mm side padding. The measured constants are gone rather than left
 * alongside, because two sets of page geometry in one renderer is how half a
 * document ends up laid out to the wrong one.
 */
const PAGE_WIDTH = K.PAGE_W;
const PAGE_HEIGHT = K.PAGE_H;

// ────────────────────────────────────────────────────────────────────
// MEASURED OFF A SAFARI OUTDOOR MOTIVATION, not chosen.
//
// The operator's verdict on the first version was "it looks like dog shit"
// beside the packs a professional writer charges for, and he is right. Every
// number below was measured from
// "Gerstner G - (Barrett 5.56 x 45 MM NATO Rec 7 FDE 11.5 INCH) Sect 16 DS
// Motivation.pdf" with PyMuPDF span geometry, so this is their layout rather
// than an impression of it.
//
// ⚠️ THE BIGGEST SINGLE CHANGE IS THE TYPEFACE. We set the body in Times, a
// book serif, and they set it in Arial. That one difference is most of why
// ours reads as a letter and theirs reads as a submission — before a word is
// read. Helvetica is the standard-14 metric equivalent of Arial, so it needs
// no embedded font file (see the note above about pdfkit and .afm metrics).
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ SYMMETRIC 72, AND THE FIRST MEASUREMENT OF THIS WAS WRONG.
 *
 * Their LEFT margin is exactly 72.0 on every body line of all three packs —
 * a hard cluster, no spread. The right is not so clean: justified line
 * right-edges cluster at 526.2-526.5, which would read as a 69pt margin, and
 * taking the single furthest glyph (529.5) gives 66 — the number this file
 * shipped with, described as "measured", from one outlier.
 *
 * The 3pt is glyph overshoot: PyMuPDF reports the glyph bbox, which runs past
 * the advance width the justification engine actually aligned to. Word sets
 * margins symmetrically and the left proves 72, so the page setup is 72/72.
 * Measure the ink, infer the box.
 */
const MARGIN = K.PAD_X;
const MARGIN_RIGHT = K.PAD_X;
/**
 * Room for the footer block, which is TWO lines and sits low.
 *
 * Measured: their footer occupies 63-89pt from the bottom edge, so the body
 * must stop above it. 61 (their text bbox) is where the FOOTER ends, not
 * where the body does — using it left eight points of clearance and the body
 * would eventually have collided with the running title.
 */
/** Room for the footer strip, plus air. */
const MARGIN_BOTTOM = K.PAGE_H - K.BODY_BOTTOM;
/** Where the body starts: under the running banner, plus 9 mm. */
const MARGIN_TOP = K.BODY_TOP;

// ⚠️ PURE BLACK, NOT A SOFT BLACK. Every one of the 62,295 coloured body
// characters in their Barrett pack is (0,0,0). #111111 is a screen habit; on
// a printed submission handed across a counter it reads as a photocopy of
// something, rather than as the document itself.
const BLACK = '#000000';
const GREY = '#555555';
const RULE = '#999999';

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_ITALIC = 'Helvetica-Oblique';
const FONT_BOLD_ITALIC = 'Helvetica-BoldOblique';

const BODY_SIZE = K.BODY_SIZE;
/**
 * Their baseline-to-baseline is 12.65pt at 11pt Arial. pdfkit's lineGap is
 * ADDITIONAL to the font's own line height, and Helvetica at 11pt renders
 * ~12.65 unaided — so the gap is zero and the paragraph spacing carries the
 * rhythm instead.
 */
const BODY_LEADING = K.BODY_LEADING;
/** Their paragraph-to-paragraph step is 24.6pt — one clear blank line. */
const PARA_GAP = K.PARA_GAP;
/** Section headings: 49pt of air above, 24.8 below. */
const HEADING_ABOVE = 49;
const HEADING_BELOW = 25;
/** Quoted statute runs italic with a 28pt hanging indent. */
const QUOTE_INDENT = 28;

/**
 * THE TEN COLOUR SCHEMES, from the operator's design handoff (2026-08-21).
 *
 * Eight variables each, in the handoff's own order and under its own names,
 * so a value can be checked against the reference without translating:
 *
 *   deep   banner gradient start, section node ring, annexure cross-refs
 *   deep2  banner gradient end, and the text colour of a highlight band
 *   ink    body text
 *   sub    secondary prose (the "To: the Registrar" block)
 *   mut    labels, footer strip, small caps
 *   band   the highlight band behind a section title
 *   hair   hairlines, table rules, panel borders
 *   wash   panel and footer backgrounds
 *
 * \u26a0\ufe0f THIS REPLACED FIVE COLOURWAYS THAT CARRIED THREE VALUES. ink/tint/rule
 * could describe a heading band and nothing else; this document has a
 * gradient banner, a footer strip, wash panels and two weights of body text,
 * and three variables cannot express that. The old names are gone rather than
 * aliased \u2014 an alias would have let half the renderer keep drawing the old
 * design while the other half drew the new one.
 */
export type Scheme =
  | 'eucalyptus'
  | 'slate'
  | 'stone'
  | 'sage'
  | 'fogblue'
  | 'clay'
  | 'olive'
  | 'sand'
  | 'graphite'
  | 'mauve';

export interface SchemeColours {
  deep: string;
  deep2: string;
  ink: string;
  sub: string;
  mut: string;
  band: string;
  hair: string;
  wash: string;
}

export const SCHEMES: Record<Scheme, SchemeColours> = {
  eucalyptus: { deep: '#587068', deep2: '#40524c', ink: '#29342f', sub: '#475650', mut: '#869590', band: '#dfe9e5', hair: '#dbe4e0', wash: '#f2f7f5' },
  slate:      { deep: '#565e6e', deep2: '#3f4654', ink: '#2a2f38', sub: '#4c5460', mut: '#8a8f99', band: '#e3e2ec', hair: '#e2e0da', wash: '#f6f5f2' },
  stone:      { deep: '#6b645c', deep2: '#4e4841', ink: '#33302b', sub: '#57524b', mut: '#948e85', band: '#e9e4dc', hair: '#e4dfd7', wash: '#f7f5f1' },
  sage:       { deep: '#5f6b5e', deep2: '#454f45', ink: '#2c332c', sub: '#4d574d', mut: '#8a938a', band: '#e2e8df', hair: '#dfe3da', wash: '#f4f6f2' },
  fogblue:    { deep: '#58687a', deep2: '#3f4c5b', ink: '#29323c', sub: '#485664', mut: '#8795a3', band: '#e0e7ed', hair: '#dde3e8', wash: '#f3f6f8' },
  clay:       { deep: '#7a615a', deep2: '#594641', ink: '#362c29', sub: '#5c4f4a', mut: '#998a81', band: '#ece2dd', hair: '#e6ddd6', wash: '#f8f4f1' },
  olive:      { deep: '#6a6a52', deep2: '#4d4d3b', ink: '#30302a', sub: '#55554a', mut: '#90907f', band: '#e7e7d9', hair: '#e2e2d5', wash: '#f6f6ef' },
  sand:       { deep: '#8a7c62', deep2: '#665b47', ink: '#38332a', sub: '#5d5648', mut: '#9c9484', band: '#eee7d8', hair: '#e8e1d2', wash: '#f9f6ee' },
  graphite:   { deep: '#4a4a4e', deep2: '#333336', ink: '#26262a', sub: '#46464b', mut: '#8b8b90', band: '#e4e4e7', hair: '#e0e0e2', wash: '#f4f4f5' },
  mauve:      { deep: '#6e5f6a', deep2: '#50454d', ink: '#322c31', sub: '#544a51', mut: '#93878f', band: '#e9e1e7', hair: '#e3dce1', wash: '#f7f3f6' },
};

/** Eucalyptus first \u2014 the handoff's default, and the picker opens on it. */
export const SCHEME_KEYS: Scheme[] = [
  'eucalyptus', 'slate', 'stone', 'sage', 'fogblue',
  'clay', 'olive', 'sand', 'graphite', 'mauve',
];

export const DEFAULT_SCHEME: Scheme = 'eucalyptus';

/**
 * \u26a0\ufe0f THE REQUIRED-RED IS FIXED ACROSS ALL TEN SCHEMES. It marks the one
 * certification the Regulations actually impose (reg 13(4)(b)); a warning
 * colour that changes with the decorative palette is not a warning colour.
 */
export const REQUIRED_RED = '#8b3a3a';
export const REQUIRED_RED_BORDER = '#cfa9a9';

/**
 * ONE FORMAT. Operator, 2026-08-21: "get rid of the concise and standard
 * templates. Only comprehensive stays."
 *
 * \u26a0\ufe0f A ONE-MEMBER UNION, NOT A DELETED TYPE. Rows written before today
 * hold 'concise' or 'standard' in templateFormat, the API still accepts a
 * `format` field and the picker still sends one \u2014 so the value has to arrive,
 * validate and normalise. asFormat() maps everything to the one format we
 * render, which is what lets those older rows open instead of erroring.
 */
export type TemplateFormat = 'comprehensive';

export const FORMAT_KEYS: TemplateFormat[] = ['comprehensive'];

/**
 * \u26a0\ufe0f VALIDATE ON READ, NEVER TRUST THE COLUMN. templateFormat and
 * templateColourway are plain VARCHARs so that adding a scheme costs no
 * migration \u2014 which also means the database will happily hold 'burgundy' from
 * a typo, or a scheme we later withdrew. Neither may fail a download:
 * somebody clicking "get my PDF" gets a PDF.
 */
export function asFormat(_v: string | null | undefined): TemplateFormat {
  return 'comprehensive';
}

export function asScheme(v: string | null | undefined): Scheme {
  return SCHEME_KEYS.includes(v as Scheme) ? (v as Scheme) : DEFAULT_SCHEME;
}

/**
 * Kept so the one remaining format still declares what it carries, and so a
 * future second format has somewhere to differ.
 */
export const FORMAT_FEATURES: Record<
  TemplateFormat,
  { contents: boolean; ownedTable: boolean; specBlock: boolean }
> = {
  comprehensive: { contents: true, ownedTable: true, specBlock: true },
};

export interface MotivationPdfInput {
  /** MO000123 — printed so the applicant can quote it to support. */
  referenceNumber: string;
  /** The applicant's REAL full name. See the real-name note above. */
  applicantName: string;
  /** Human label for the licence type, e.g. "Section 16 — Dedicated Hunter". */
  licenceTypeLabel: string;
  /**
   * The generated motivation body. Plain text. A line that ends with a colon
   * and is short is treated as a heading; blank lines separate paragraphs.
   * Keeping the contract this dumb means the generator can only produce prose,
   * never markup we would then have to sanitise into a PDF.
   */
  body: string;
  /** Attorney-reviewed disclaimer text, verbatim. */
  disclaimer: string;
  /** Stamped in the footer so reviewed versions are traceable. */
  templateVersion: string;
  /** Only one format remains; accepted so older callers still type-check. */
  format?: TemplateFormat;
  /**
   * Which of the ten schemes. Defaults to eucalyptus, the handoff's own.
   *
   * Still called `colourway` because that is the column name, the API field
   * and what the picker sends. Renaming the wire format to match the internal
   * rename would have been a migration and a client change for no gain.
   */
  colourway?: Scheme;
  /** The applicant's ID number, printed on the cover as the DFO expects. */
  idNumber?: string;
  /** Firearms already held, for the comparison table. */
  ownedFirearms?: { make: string; calibre: string; type: string; section: string }[];
  /** Manufacturer specifications for the firearm applied for. */
  firearmSpec?: { label: string; value: string }[];
  /**
   * "Barrett self-loading rifle, serial BR009252" — the firearm named in the
   * running footer, so a loose sheet can be filed against the right
   * application. Optional: a renewal or a pack with no firearm chosen yet
   * simply omits it rather than printing an empty clause.
   */
  firearmLine?: string;
  /** Generation timestamp. Passed in, never read from the clock here, so the
   *  same input always renders the same bytes (testable, reproducible). */
  generatedAt: Date;
  /**
   * Lettered annexure index, rendered as the last page.
   *
   * The INDEX belongs in the printed document — a reviewer holding the paper
   * needs to find what the body cross-references. The CHECKLIST does not: it is
   * a live, tickable surface on the platform and in the PWA, because the whole
   * point is that the pack stays digital until it is printed. See
   * motivation-checklist.ts.
   */
  annexures?: AnnexureEntry[];
  /**
   * The scanned copies themselves, reprinted after the index.
   *
   * ⚠️ THIS IS WHAT THE APPLICANT WALKS INTO THE DFO'S OFFICE WITH. They take
   * the motivation, these copies, and the originals, and everything is
   * certified in one sitting — which only works if the copies are IN the
   * pack, at a size a commissioner of oaths will stamp.
   *
   * Bytes are JPEG or PNG only (pdfkit embeds nothing else). Anything else
   * the member uploaded is named on the index page as needing its own copy,
   * rather than silently missing from the print.
   */
  annexureImages?: AnnexureImagePage[];
  /**
   * The request for prior notice and written reasons, if one was built.
   *
   * Rendered as its own page and lettered in the annexure index. See
   * motivation-prior-notice.ts — in short, regulation 91(4) makes the
   * regulation 89(c) written notification a precondition for a competent
   * appeal, and regulation 91(1)(a) runs the 90-day clock from the DECISION
   * rather than from the day the applicant heard about it.
   */
  priorNotice?: { title: string; body: string; version: string };
  /**
   * Stamp every page as a preview.
   *
   * ⚠️ THE MARK IS THE ONLY THING STANDING BETWEEN AN UNPAID PACK AND A
   * FILEABLE ONE. Payments are not live, so this endpoint hands back a
   * complete, correct motivation to anyone who finishes the interview. Without
   * the stamp the product is free.
   *
   * It must therefore be a nuisance to remove and impossible to miss, while
   * still leaving the document READABLE — the whole point of letting somebody
   * see it is that they can decide whether it is worth paying for. Diagonal,
   * large, very light, and UNDER the text rather than over it.
   */
  watermark?: boolean;
  /** Uploads that could not be reprinted, named so the gap is visible. */
  annexuresNotPrinted?: { letter: string; label: string; why: string }[];
  /**
   * Annexures that arrived as PDFs. pdfkit cannot embed one, so these are
   * merged into the finished document by pdf-lib afterwards — see
   * motivation-pdf-merge.ts. They still occupy pages, so their count is added
   * to the footer total BEFORE the body is stamped.
   */
  annexurePdfs?: PdfAnnexure[];
  /**
   * What the applicant physically carries to the DFO.
   *
   * ⚠️ THE TICK BOXES STAY DIGITAL — that decision holds (operator,
   * 2026-08-18). This is the other half of it: once the pack IS printed, the
   * paper needs to say what goes with it, because the person walking into the
   * station is holding paper and not a phone.
   */
  takeWithYou?: { label: string; note?: string }[];
}

/** "THE FIREARM APPLIED FOR" -> "The firearm applied for", for the contents. */
function titleCase(heading: string): string {
  const t = heading.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * "Gerhard Johan Petrus Fourie" -> "Gerhard J P Fourie".
 *
 * First name in full, middle names as initials, surname in full — which is
 * how the handoff sets the banner and the footer, and how a South African
 * legal document conventionally shortens a name without losing which person
 * it is.
 */
function shortenName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return full.trim();
  const [first, ...rest] = parts;
  const surname = rest.pop() as string;
  return [first, ...rest.map((n) => n[0].toUpperCase()), surname].join(' ');
}

/** Millimetres, for the section spacing. Same unit the handoff is written in. */
const mmGap = (n: number): number => K.mm(n);

/** A short line ending in a colon reads as a section heading. */
function isHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 80 && t.endsWith(':');
}

/** One scanned copy, ready to draw. */
export interface AnnexureImagePage {
  letter: string;
  label: string;
  index: number;
  total: number;
  bytes: Buffer;
  width: number;
  height: number;
  /** Whether this copy carries a certification block. See CERTIFICATION. */
  certification?: CertificationLevel;
}

@Injectable()
export class MotivationPdfService {
  private readonly logger = new Logger(MotivationPdfService.name);

  // NO constructor dependencies, deliberately — same posture as Saps534Service.
  // It takes a plain object and returns bytes, so it unit-tests without Nest
  // and can be provided anywhere without dragging a dependency graph along.

  /**
   * Render the motivation. Returns the bytes plus the filename the controller
   * puts in Content-Disposition — the `{ pdf, filename }` contract the existing
   * receipt/SAPS-534 controllers already stream.
   */
  async render(
    input: MotivationPdfInput,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const doc = new PDFDocument({
      size: [PAGE_WIDTH, PAGE_HEIGHT],
      // \u26a0\ufe0f THE TOP MARGIN CLEARS THE RUNNING BANNER. pdfkit paginates
      // against these, so leaving them at the old values would have flowed
      // body text underneath the banner on every page after the first.
      margins: {
        top: MARGIN_TOP,
        bottom: MARGIN_BOTTOM,
        left: MARGIN,
        right: MARGIN_RIGHT,
      },
      // Embedded so a reader shows something sensible in its title bar; the
      // document number rather than the applicant's name, so a filename in a
      // shared folder does not leak who applied for what.
      info: {
        Title: `Motivation ${input.referenceNumber}`,
        Creator: 'All Outdoor',
      },
      autoFirstPage: true,
      bufferPages: true, // needed to stamp footers across all pages at the end
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const contentWidth = PAGE_WIDTH - MARGIN - MARGIN_RIGHT;

    // Normalised rather than defaulted: a row still holding 'concise' from
    // before the formats were consolidated renders as comprehensive.
    const feat = FORMAT_FEATURES[asFormat(input.format)];
    const C = SCHEMES[asScheme(input.colourway)];

    // \u26a0\ufe0f A MISSING FONT MUST NOT FAIL A DOWNLOAD. registerFonts returns
    // false when the assets did not ship \u2014 see the path-resolution note in
    // motivation-pdf-chrome \u2014 and the document then renders in the standard
    // faces. Ugly and readable beats a 500 on a licence application.
    const realFonts = K.registerFonts(doc);
    const F = K.faces(realFonts);
    const chrome: K.Chrome = { doc, c: C, f: F };
    if (!realFonts) {
      this.logger.warn(
        'Motivation fonts not found on disk \u2014 rendering in the standard faces',
      );
    }

    // ── Cover ─────────────────────────────────────────────────────────
    //
    // ⚠️ A COVER, NOT A TITLE BLOCK. What we had was a heading and three
    // lines at the top of page one, with the argument starting underneath —
    // which is how a letter opens. Every professional pack opens on a page
    // that does nothing but identify the application: who, what firearm,
    // under which section. A DFO picking one folder off a pile of forty
    // decides what it is without opening it.
    const bandH = 16;
    doc.rect(0, 0, PAGE_WIDTH, bandH).fill(C.ink);
    doc.y = MARGIN + 34;

    doc
      .font(FONT_BOLD)
      .fontSize(8)
      .fillColor(C.ink)
      .text('MOTIVATION', MARGIN, doc.y, {
        width: contentWidth,
        characterSpacing: 2.4,
      });
    doc.moveDown(0.7);
    doc
      .font(FONT_BOLD)
      .fontSize(34)
      .fillColor(BLACK)
      .text('Application\nfor a firearm\nlicence', MARGIN, doc.y, {
        width: contentWidth,
        lineGap: -4,
      });
    doc.moveDown(0.5);
    doc
      .font(FONT)
      .fontSize(12)
      .fillColor('#333333')
      .text(input.licenceTypeLabel, MARGIN, doc.y, { width: contentWidth });

    const cvRuleY = doc.y + 18;
    doc
      .moveTo(MARGIN, cvRuleY)
      .lineTo(MARGIN + 92, cvRuleY)
      .lineWidth(2.4)
      .strokeColor(C.ink)
      .stroke();
    doc.y = cvRuleY + 26;

    // The identification block. Every line a DFO needs to file the folder.
    const rows: [string, string][] = [
      ['Applicant', input.applicantName],
      ...(input.idNumber ? ([['Identity number', input.idNumber]] as [string, string][]) : []),
      ['Reference', input.referenceNumber],
      ...(input.firearmLine ? ([['Firearm', input.firearmLine]] as [string, string][]) : []),
      [
        'Prepared',
        input.generatedAt.toLocaleDateString('en-ZA', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      ],
      ...(input.annexures?.length
        ? ([['Annexures', `${input.annexures.length} attached`]] as [string, string][])
        : []),
    ];
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font(FONT).fontSize(10).fillColor('#666666').text(k, MARGIN, y, { width: 118 });
      doc
        .font(FONT_BOLD)
        .fontSize(10)
        .fillColor(BLACK)
        .text(v, MARGIN + 118, y, { width: contentWidth - 118 });
      doc.y = Math.max(doc.y, y) + 7;
    }

    // ── Contents ──────────────────────────────────────────────────────
    //
    // ⚠️ RESERVED NOW, WRITTEN LAST. The page numbers are not known until the
    // body has been laid out, so this page is claimed here and filled in
    // after — bufferPages lets us switch back to it. Rendering the document
    // twice to learn its own pagination would double every Claude-written
    // word's cost in wall clock for a page of dot leaders.
    let tocPageIndex: number | null = null;
    if (feat.contents) {
      doc.addPage();
      tocPageIndex = doc.bufferedPageRange().count - 1;
    }

    const toc: { heading: string; page: number }[] = [];

    /**
     * A section heading, recorded for the contents and drawn as a band.
     *
     * ⚠️ A BAND, NOT JUST BOLD TYPE. Every H1 in the professional packs sits
     * on a full-column tinted bar with a rule above it. It is the single
     * cheapest thing that makes a document read as typeset rather than typed,
     * and it gives a reviewer working through forty pages somewhere for the
     * eye to land.
     */
    /**
     * A numbered section header, as the handoff draws them: a ring node, then
     * the title on a highlight band.
     *
     * ⚠️ NUMBERED IN SEQUENCE, and the number is assigned HERE rather than
     * carried on the section plan. motivation-structure.ts shuffles the middle
     * sections by seed, so a number baked into the plan would come out
     * "01, 04, 02" on the page. The reader wants to know this is the third
     * thing they are reading, not which slot it occupies in a registry.
     */
    let sectionNo = 0;
    const renderHeading = (heading: string) => {
      sectionNo += 1;

      // Keep a heading with at least a couple of lines of its section: if we
      // are near the foot of the page, start the next one now rather than
      // orphan it above the footer strip.
      if (doc.y > K.BODY_BOTTOM - mmGap(34)) doc.addPage();
      if (doc.y > MARGIN_TOP + 1) doc.y += mmGap(9);

      toc.push({ heading, page: doc.bufferedPageRange().count });

      const num = String(sectionNo).padStart(2, '0');
      doc.y = K.sectionHeader(chrome, num, heading, doc.y);

      // ⚠️ PUT THE CURSOR BACK. pdfkit's text(str, x, y) leaves doc.x AT x, and
      // every later text() that does not name an x inherits it. The tables
      // below are the ones that bite: the SIGNATURE BLOCK three sections later
      // once rendered at x=617 with the disclaimer running off the page.
      doc.x = MARGIN;
    };

    doc.addPage();

    // ── Body ──────────────────────────────────────────────────────────
    // Blank-line-separated blocks. pdfkit handles wrapping and page breaks;
    // we only decide heading vs paragraph.
    const blocks = input.body
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    for (const block of blocks) {
      if (isHeading(block)) {
        // Keep a heading with at least a couple of lines of its paragraph:
        // if we are near the bottom, start the page now rather than orphan it.
        if (doc.y > PAGE_HEIGHT - MARGIN_BOTTOM - 110) doc.addPage();
        // ⚠️ CENTRED, BOLD, ALL CAPS — measured off Safari Outdoor, where
        // "CURRENT COMPETENCY STATUS" sits centred in Arial-Bold 11 with 49pt
        // above it. Ours were left-aligned sentence case with a trailing
        // colon ("The firearm and why it suits the purpose:"), which is how a
        // letter signposts itself, not how a submission does.
        renderHeading(block.replace(/:\s*$/, '').toUpperCase());
      } else {
        // A parenthetical annexure reference is its own line in their
        // documents — "(Refer to Annexure B: Proficiency Certificates)" —
        // never justified into the paragraph above it.
        const isRef = /^\(Refer to Annexure/i.test(block);
        // ⚠️ THE BODY IS SET IN THE SERIF, INDENTED UNDER THE SECTION RULE.
        // The handoff runs a 1 px hairline down the left of every section's
        // body at a 7 mm indent, which is what separates the argument from
        // the furniture. Annexure cross-references are set italic in `deep`,
        // as inline <em> in the reference.
        doc
          .font(isRef ? F.serifItalic : F.serif)
          .fontSize(BODY_SIZE)
          .fillColor(isRef ? C.deep : C.ink)
          .text(block, MARGIN + K.SECTION_INDENT, doc.y, {
            width: contentWidth - K.SECTION_INDENT,
            align: isRef ? 'left' : 'justify',
            lineGap: BODY_LEADING,
          });
        doc.x = MARGIN;
        doc.y += PARA_GAP;
      }
    }

    // ── Specification of the firearm (comprehensive only) ─────────────
    //
    // Researched manufacturer data, set as a spec sheet rather than buried in
    // a sentence. This is the part of the professional packs that makes an
    // applicant read as somebody who chose a firearm rather than picked one:
    // barrel length, action, capacity, overall length, in the manufacturer's
    // own terms. It goes in as data, never as an argument — the prose does
    // the arguing, and a reviewer can check every line of this against a
    // catalogue.
    if (feat.specBlock && input.firearmSpec?.length) {
      if (doc.y > PAGE_HEIGHT - MARGIN_BOTTOM - 170) doc.addPage();
      renderHeading('SPECIFICATION OF THE FIREARM APPLIED FOR');

      const labelW = 190;
      for (const spec of input.firearmSpec) {
        if (doc.y > PAGE_HEIGHT - MARGIN_BOTTOM - 24) doc.addPage();
        const y = doc.y;
        doc
          .font(FONT_BOLD)
          .fontSize(10)
          .fillColor(BLACK)
          .text(spec.label, MARGIN + 6, y, { width: labelW - 12 });
        const afterLabel = doc.y;
        doc
          .font(FONT)
          .fontSize(10)
          .fillColor(BLACK)
          .text(spec.value, MARGIN + labelW, y, {
            width: contentWidth - labelW - 6,
          });
        const rowBottom = Math.max(afterLabel, doc.y) + 5;
        doc
          .moveTo(MARGIN, rowBottom)
          .lineTo(MARGIN + contentWidth, rowBottom)
          .lineWidth(0.5)
          .strokeColor(C.hair)
          .stroke();
        doc.y = rowBottom + 5;
      }
      doc.x = MARGIN;
      doc.y += PARA_GAP;
    }

    // ── Firearms already licensed (standard and comprehensive) ────────
    //
    // ⚠️ THIS TABLE IS EVIDENCE, NOT DECORATION. Section 13 caps a
    // self-defence applicant at one firearm and section 15(3) caps an
    // occasional sport shooter at four, so what a person already holds is a
    // statutory precondition the DFO checks — and a reviewer should be able
    // to check it at a glance instead of mining it out of a paragraph.
    //
    // AN EMPTY TABLE STILL PRINTS. "No firearm is currently licensed to the
    // applicant" is a material fact on a first application; leaving the
    // section out because there is nothing to list would read as an omission.
    if (feat.ownedTable) {
      if (doc.y > PAGE_HEIGHT - MARGIN_BOTTOM - 140) doc.addPage();
      renderHeading('FIREARMS ALREADY LICENSED TO THE APPLICANT');

      const owned = input.ownedFirearms ?? [];
      if (!owned.length) {
        doc
          .font(FONT_ITALIC)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(
            'No firearm is currently licensed to the applicant. This is a first application.',
            { width: contentWidth, lineGap: BODY_LEADING },
          );
        doc.y += PARA_GAP;
      } else {
        // Widths sum to contentWidth (451.28) by construction; a column that
        // overflows would silently overprint its neighbour rather than wrap.
        const cols: { head: string; w: number; key: keyof (typeof owned)[0] }[] = [
          { head: 'Make and model', w: 168, key: 'make' },
          { head: 'Calibre', w: 92, key: 'calibre' },
          { head: 'Type', w: 106, key: 'type' },
          { head: 'Held under', w: contentWidth - 366, key: 'section' },
        ];

        const headTop = doc.y;
        doc.rect(MARGIN, headTop, contentWidth, 20).fill(C.band);
        let x = MARGIN + 6;
        for (const col of cols) {
          doc
            .font(FONT_BOLD)
            .fontSize(9)
            .fillColor(C.ink)
            .text(col.head.toUpperCase(), x, headTop + 6, {
              width: col.w - 10,
              characterSpacing: 0.4,
              lineBreak: false,
            });
          x += col.w;
        }
        doc.y = headTop + 20;

        for (const f of owned) {
          if (doc.y > PAGE_HEIGHT - MARGIN_BOTTOM - 30) doc.addPage();
          const rowTop = doc.y + 5;
          let bottom = rowTop;
          let cx = MARGIN + 6;
          for (const col of cols) {
            doc
              .font(FONT)
              .fontSize(10)
              .fillColor(BLACK)
              .text(String(f[col.key] ?? '—'), cx, rowTop, { width: col.w - 10 });
            bottom = Math.max(bottom, doc.y);
            cx += col.w;
          }
          const ruleY = bottom + 5;
          doc
            .moveTo(MARGIN, ruleY)
            .lineTo(MARGIN + contentWidth, ruleY)
            .lineWidth(0.5)
            .strokeColor(C.hair)
            .stroke();
          doc.y = ruleY;
        }
        doc.x = MARGIN;
        doc.y += PARA_GAP;
      }
    }

    // ── Signature block ───────────────────────────────────────────────
    // The applicant signs this as their own motivation — that is what the
    // declaration in the app commits them to, and the document has to carry a
    // place to do it.
    if (doc.y > PAGE_HEIGHT - MARGIN - 140) doc.addPage();
    doc.x = MARGIN;
    doc.moveDown(1.5);
    doc.font(FONT).fontSize(BODY_SIZE).fillColor(BLACK);
    const sigY = doc.y + 26;
    doc
      .moveTo(MARGIN, sigY)
      .lineTo(MARGIN + 230, sigY)
      .lineWidth(0.5)
      .strokeColor(BLACK)
      .stroke();
    doc.y = sigY + 5;
    doc.text(input.applicantName, { width: 230 });
    doc.font(FONT_ITALIC).fillColor(GREY).text('Signature and date', {
      width: 230,
    });

    // ── Disclaimer ────────────────────────────────────────────────────
    if (doc.y > PAGE_HEIGHT - MARGIN - 120) doc.addPage();
    doc.moveDown(1.2);
    const discY = doc.y;
    doc
      .moveTo(MARGIN, discY)
      .lineTo(PAGE_WIDTH - MARGIN, discY)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.5);
    doc
      .font(FONT_ITALIC)
      .fontSize(8.5)
      .fillColor(GREY)
      .text(input.disclaimer, { width: contentWidth, lineGap: 1.5 });

    // ── What to take to the station ───────────────────────────────────
    //
    // Last page but one, before the annexures, because it is the page the
    // applicant reads on the morning they go.
    if (input.takeWithYou?.length) {
      doc.addPage();
      // Back matter goes in the contents too. A reviewer who wants the
      // annexure index should not have to thumb to the end to find out where
      // it starts, and an applicant checking their own pack is complete uses
      // this page as the manifest.
      toc.push({ heading: 'TAKE THESE WITH YOU', page: doc.bufferedPageRange().count });
      doc.x = MARGIN;
      doc
        .font(FONT_BOLD)
        .fontSize(13)
        .fillColor(C.ink)
        .text('TAKE THESE WITH YOU', MARGIN, doc.y, { width: contentWidth });
      doc.moveDown(0.4);
      doc
        .font(FONT)
        .fontSize(9.5)
        .fillColor(GREY)
        .text(
          // ⚠️ WHICH DFO, AND WHO HANDS IT IN — neither was on this page, and
          // this is the page the applicant reads on the morning they go.
          // Reg 13(4)(a) requires the application to be submitted BY THE
          // APPLICANT IN PERSON to the relevant DFO, and reg 1(xix) defines
          // "relevant" as the officer for the area where they ordinarily
          // reside. Reg 13(9)(a) and 13(10) need them in the flesh anyway:
          // the DFO takes their fingerprints at the counter.
          //
          // Hedged as "normally", because reg 13(4)(a) opens "unless
          // otherwise specifically stated".
          'This motivation and its annexures are only part of the application. ' +
            'It goes to the Designated Firearms Officer for the area where you ' +
            'ordinarily live, and you normally have to hand it in yourself — the ' +
            'DFO takes your fingerprints at the counter and checks them against ' +
            'your identity, so somebody else cannot lodge it for you. ' +
            'A Designated Firearms Officer does not have to accept an incomplete ' +
            'application and will not issue the acknowledgement of receipt until it ' +
            'is complete, so it is worth checking every line before you travel. ' +
            'Requirements differ between stations and this list is not exhaustive — ' +
            'confirm it with your own DFO.',
          { width: contentWidth, lineGap: 1.5 },
        );
      doc.moveDown(0.8);

      for (const item of input.takeWithYou) {
        // An empty box to tick with a pen. The applicant is standing at a
        // kitchen table with a pile of paper, not looking at a screen.
        const y = doc.y;
        doc
          .rect(MARGIN + 1, y + 1.5, 8, 8)
          .lineWidth(0.7)
          .strokeColor(GREY)
          .stroke();
        doc
          .font(FONT)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(item.label, MARGIN + 16, y, { width: contentWidth - 16 });
        if (item.note) {
          doc
            .font(FONT_ITALIC)
            .fontSize(8.5)
            .fillColor(GREY)
            .text(item.note, MARGIN + 16, doc.y, { width: contentWidth - 16 });
        }
        doc.moveDown(0.45);
      }
    }

    // ── Request for prior notice ─────────────────────────────────
    if (input.priorNotice) {
      // Its own page and its own signature block. This is a separate request
      // to the Registrar, not a paragraph of the motivation, and it is signed
      // separately because that is what makes it a request from the applicant
      // rather than a note from us.
      doc.addPage();
      doc.x = MARGIN;
      const pnLetter = input.annexures?.find(
        (a2) => a2.kind === 'PRIOR_NOTICE_REQUEST',
      )?.letter;
      toc.push({
        heading: pnLetter
          ? `ANNEXURE ${pnLetter} — ${input.priorNotice.title}`
          : input.priorNotice.title,
        page: doc.bufferedPageRange().count,
      });

      if (pnLetter) {
        doc
          .font(FONT_BOLD)
          .fontSize(8)
          .fillColor(C.ink)
          .text(`ANNEXURE ${pnLetter}`, MARGIN, doc.y, {
            width: contentWidth,
            characterSpacing: 2.2,
          });
        doc.moveDown(0.5);
      }
      doc
        .font(FONT_BOLD)
        .fontSize(13)
        .fillColor(BLACK)
        .text(input.priorNotice.title, MARGIN, doc.y, { width: contentWidth });

      const pnRule = doc.y + 8;
      doc
        .moveTo(MARGIN, pnRule)
        .lineTo(MARGIN + 74, pnRule)
        .lineWidth(2)
        .strokeColor(C.ink)
        .stroke();
      doc.y = pnRule + 20;

      doc
        .font(FONT)
        .fontSize(10)
        .fillColor(GREY)
        .text(
          'To the Designated Firearms Officer, for the attention of the Registrar of Firearms',
          MARGIN,
          doc.y,
          { width: contentWidth },
        );
      doc.moveDown(1);

      for (const block of input.priorNotice.body
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter(Boolean)) {
        if (doc.y > PAGE_HEIGHT - MARGIN_BOTTOM - 40) doc.addPage();
        // A numbered ask is a hanging indent, not a justified paragraph — the
        // three of them have to be countable at a glance.
        const numbered = /^\d\.\s/.test(block);
        const isLabel = /:$/.test(block) && block.length < 40;
        doc
          .font(isLabel ? FONT_BOLD : FONT)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(block, MARGIN + (numbered ? QUOTE_INDENT : 0), doc.y, {
            width: contentWidth - (numbered ? QUOTE_INDENT : 0),
            align: numbered || isLabel ? 'left' : 'justify',
            lineGap: BODY_LEADING,
          });
        doc.x = MARGIN;
        doc.y += numbered ? 8 : PARA_GAP;
      }

      // ⚠️ RESERVE WHAT THE BLOCK ACTUALLY NEEDS, NOT A ROUND NUMBER. A guess
      // of 90 threw the signature onto a page of its own with seventy points
      // of clear space above it — a one-line page seven that reads as a
      // printing accident on a document somebody is handing to an official.
      //
      // The block is: one blank line (12.65 at 11pt Helvetica), 26 to the
      // rule, 5 below it, then two lines. 69 total, so 70 is the threshold
      // with a point of slack.
      if (doc.y > PAGE_HEIGHT - MARGIN_BOTTOM - 70) doc.addPage();
      doc.x = MARGIN;
      doc.moveDown(1);
      const pnSigY = doc.y + 26;
      doc
        .moveTo(MARGIN, pnSigY)
        .lineTo(MARGIN + 230, pnSigY)
        .lineWidth(0.5)
        .strokeColor(BLACK)
        .stroke();
      doc.y = pnSigY + 5;
      doc
        .font(FONT)
        .fontSize(BODY_SIZE)
        .fillColor(BLACK)
        .text(input.applicantName, MARGIN, doc.y, { width: 230 });
      doc
        .font(FONT_ITALIC)
        .fillColor(GREY)
        .text('Signature and date', MARGIN, doc.y, { width: 230 });
    }

    // ── Annexure index ────────────────────────────────────────────────
    if (input.annexures?.length) {
      doc.addPage();
      toc.push({ heading: 'ANNEXURES', page: doc.bufferedPageRange().count });
      doc.x = MARGIN;
      doc
        .font(FONT_BOLD)
        .fontSize(13)
        .fillColor(C.ink)
        .text('ANNEXURES', MARGIN, doc.y, { width: contentWidth });
      doc.moveDown(0.4);
      doc
        .font(FONT)
        .fontSize(9.5)
        .fillColor(GREY)
        .text(
          'The documents listed below are attached in this order and are referred to in the motivation.',
          { width: contentWidth },
        );
      doc.moveDown(0.8);

      // ⚠️ THE CERTIFICATION COLUMN IS THE POINT OF THIS PAGE. An applicant
      // assembling a folder at a kitchen table needs to know which copies to
      // take to a commissioner BEFORE they drive to the police station, and
      // "certified copies required" as a blanket sentence sends people to get
      // photographs of their own safe certified. So it is per row, and it
      // says which ones are the Regulations and which ones are practice.
      const certW = 118;
      for (const a of input.annexures) {
        const y = doc.y;
        doc
          .font(FONT_BOLD)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(`Annexure ${a.letter}`, MARGIN, y, { width: 90 });
        doc
          .font(FONT)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(
            a.count > 1 ? `${a.label} (${a.count} items)` : a.label,
            MARGIN + 95,
            y,
            { width: contentWidth - 95 - certW },
          );
        const rowBottom = doc.y;

        if (a.certification !== 'none') {
          const required = a.certification === 'required';
          const cx = MARGIN + contentWidth - certW;
          // 12pt, not 15: at 15 the dashed borders of consecutive rows all but
          // touched and the column read as one block rather than as a mark
          // against each annexure.
          doc
            .rect(cx, y - 1, certW, 12)
            .lineWidth(0.6)
            .dash(2, { space: 2 })
            .strokeColor(required ? C.ink : '#BBBBBB')
            .stroke()
            .undash();
          doc
            .font(required ? FONT_BOLD : FONT)
            .fontSize(7)
            .fillColor(required ? C.ink : GREY)
            .text(required ? 'CERTIFY — REQUIRED' : 'Certify — usually asked', cx, y + 2.5, {
              width: certW,
              align: 'center',
              lineBreak: false,
            });
        }

        doc.x = MARGIN;
        doc.y = rowBottom;
        doc.moveDown(0.45);
      }

      // The distinction, stated once, so the column above is not read as a
      // claim that six documents are legally required to be certified.
      if (input.annexures.some((a) => a.certification !== 'none')) {
        doc.moveDown(0.4);
        doc
          .font(FONT_ITALIC)
          .fontSize(8.5)
          .fillColor(GREY)
          .text(
            // ⚠️ NOT "WHEN A COPY STANDS IN FOR AN ORIGINAL". That was false of
            // the competency certificate, where SAPS asks for the original
            // ITSELF and the copy travels alongside it — so the sentence
            // told an applicant they could leave the original at home.
            'Regulation 13(4)(b) of the Firearms Control Regulations, 2004 requires a ' +
              'certified copy of your identity document. The rows marked "usually asked" ' +
              'are not required by the Regulations — they are what most stations want ' +
              'on file alongside the originals you bring, and many DFOs will certify ' +
              'them at the counter. Bring every original. Ask your own station.',
            MARGIN,
            doc.y,
            { width: contentWidth, lineGap: 1.5 },
          );
      }

      // ⚠️ NAME WHAT IS NOT IN THE PACK. A member whose upload could not be
      // reprinted must not discover at the DFO's counter that the pack is one
      // document short — the gap goes on the index, where they will read it
      // while assembling the folder.
      //
      // A PDF IS NO LONGER SUCH A GAP: pdf-lib merges those pages in after
      // this document is closed. What reaches this list now is genuinely
      // unprintable — bytes we cannot read back, a file that will not open,
      // an image we cannot measure. That is a much shorter list, and every
      // line on it is now true.
      if (input.annexuresNotPrinted?.length) {
        doc.moveDown(0.6);
        doc
          .font(FONT_ITALIC)
          .fontSize(9.5)
          .fillColor(GREY)
          .text('Bring your own copy of these — we could not reprint them:', {
            width: contentWidth,
          });
        for (const n of input.annexuresNotPrinted) {
          doc
            .font(FONT)
            .fontSize(9.5)
            .fillColor(GREY)
            .text(`Annexure ${n.letter} — ${n.label} (${n.why})`, {
              width: contentWidth,
              indent: 12,
            });
        }
      }
    }

    // ── The copies themselves ─────────────────────────────────────────
    //
    // Laid out by a pure planner so the packing rules are testable as
    // arithmetic: full content width each, as many per page as genuinely fit,
    // never scaled down to squeeze one more in. See
    // motivation-annexure-layout.ts.
    if (input.annexureImages?.length) {
      const pages = planAnnexurePages(
        input.annexureImages.map((a2) => ({
          letter: a2.letter,
          label: a2.label,
          index: a2.index,
          total: a2.total,
          width: a2.width,
          height: a2.height,
          stamp: (a2.certification ?? 'none') !== 'none',
        })),
        {
          x: MARGIN,
          y: MARGIN,
          width: contentWidth,
          height: PAGE_HEIGHT - MARGIN * 2,
        },
      );
      let n = 0;
      for (const page of pages) {
        doc.addPage();
        for (const place of page) {
          const src = input.annexureImages[n++];
          doc
            .font(FONT_BOLD)
            .fontSize(9.5)
            .fillColor(BLACK)
            .text(captionFor(place), MARGIN, place.captionY, {
              width: contentWidth,
              lineBreak: false,
            });
          try {
            doc.image(src.bytes, place.x, place.y, {
              width: place.w,
              height: place.h,
            });
          } catch {
            // ⚠️ A FILE pdfkit REJECTS MUST NOT KILL THE WHOLE PDF. The
            // header parse said JPEG, so this is a truncated or malformed
            // one — the member gets the rest of their pack and a line saying
            // which copy to bring, instead of a download that 500s.
            doc
              .font(FONT_ITALIC)
              .fontSize(9.5)
              .fillColor(GREY)
              .text(
                'This copy could not be printed — bring your own.',
                MARGIN,
                place.y,
                { width: contentWidth },
              );
          }
          // A hairline BETWEEN two copies on one page, so they read as two
          // documents rather than one long one.
          //
          // ⚠️ ONLY BETWEEN THEM, never after the last. A full-page image
          // ends 6pt above the bottom margin, so a rule drawn under it lands
          // outside the printable area — and pdfkit answers an out-of-bounds
          // draw by starting a new page. That produced a silent blank page
          // after every full-page annexure: ten pages for five pages of
          // content, and nothing in the code that looked like it added one.
          // ── The certification block ──────────────────────────────
          //
          // ⚠️ THIS IS THE PART NOBODY ELSE DOES, and it is worth doing for a
          // dull reason: a commissioner of oaths certifying eight copies at a
          // counter has to write the same four things eight times, and the
          // applicant has to make sure none of them was missed. Printing the
          // frame means the commissioner fills it in rather than composing it,
          // and an applicant checking their own pack can see an empty block
          // from across a table.
          //
          // The wording is the commissioner's to supply — we print the
          // FRAME, never the words "I certify", because a pre-printed
          // certification on an uncertified copy is exactly the document
          // nobody should be able to produce.
          if (place.stampY !== undefined) {
            const bx = MARGIN;
            const bw = contentWidth;
            const bh = STAMP_H - 12;
            doc
              .rect(bx, place.stampY, bw, bh)
              .lineWidth(0.7)
              .dash(3, { space: 2.5 })
              .strokeColor(C.hair)
              .stroke()
              .undash();

            const required = src.certification === 'required';
            doc
              .font(FONT_BOLD)
              .fontSize(7.5)
              .fillColor(C.ink)
              .text(
                required
                  ? 'CERTIFICATION REQUIRED — REGULATION 13(4)(b)'
                  : 'CERTIFICATION',
                bx + 8,
                place.stampY + 7,
                { width: bw - 16, characterSpacing: 1.1, lineBreak: false },
              );

            // The stamp's own landing zone, on the right, sized for a 40 mm
            // round stamp. Named, so nobody stamps the signature rules.
            const zoneW = 128;
            const zoneX = bx + bw - zoneW - 8;
            doc
              .rect(zoneX, place.stampY + 20, zoneW, bh - 28)
              .lineWidth(0.5)
              .dash(2, { space: 2 })
              .strokeColor('#BBBBBB')
              .stroke()
              .undash();
            doc
              .font(FONT_ITALIC)
              .fontSize(7)
              .fillColor('#999999')
              .text('Stamp', zoneX, place.stampY + bh / 2, {
                width: zoneW,
                align: 'center',
                lineBreak: false,
              });

            // Rules for the things a commissioner writes by hand.
            // ⚠️ THE LAST LABEL FITS, AND IT DID NOT AT FIRST. Three rows at
            // a 17pt step from +32 put "Date and designation" on the box's
            // own bottom border — legible on screen, a smudge in print.
            // 24 + 3×16 + the 6.5pt label lands at 74.5 inside an 80pt box.
            const fieldW = bw - zoneW - 30;
            let fy = place.stampY + 24;
            for (const label of [
              'Commissioner of Oaths — full name',
              'Signature',
              'Date and designation',
            ]) {
              doc
                .moveTo(bx + 8, fy + 8)
                .lineTo(bx + 8 + fieldW, fy + 8)
                .lineWidth(0.4)
                .strokeColor('#BBBBBB')
                .stroke();
              doc
                .font(FONT)
                .fontSize(6.5)
                .fillColor('#999999')
                .text(label, bx + 8, fy + 10, {
                  width: fieldW,
                  lineBreak: false,
                });
              fy += 16;
            }
            doc.x = MARGIN;
          }

          const isLast = place === page[page.length - 1];
          if (!isLast) {
            const ruleY = place.y + place.h + GAP / 2;
            doc
              .moveTo(MARGIN, ruleY)
              .lineTo(PAGE_WIDTH - MARGIN, ruleY)
              .lineWidth(0.5)
              .strokeColor(RULE)
              .stroke();
          }
        }
      }
    }

    // ── Contents, written now that the pages are known ────────────────
    if (tocPageIndex !== null && toc.length) {
      doc.switchToPage(tocPageIndex);
      doc.y = MARGIN;
      doc
        .font(FONT_BOLD)
        .fontSize(18)
        .fillColor(C.ink)
        .text('CONTENTS', MARGIN, doc.y, { width: contentWidth, characterSpacing: 0.8 });
      const tRule = doc.y + 8;
      doc
        .moveTo(MARGIN, tRule)
        .lineTo(MARGIN + 74, tRule)
        .lineWidth(2)
        .strokeColor(C.ink)
        .stroke();
      doc.y = tRule + 22;

      for (const entry of toc) {
        const y = doc.y;
        const num = String(entry.page);
        const numW = doc.font(FONT).fontSize(BODY_SIZE).widthOfString(num);
        const title = titleCase(entry.heading);
        const titleW = doc.widthOfString(title);
        doc.fillColor(BLACK).text(title, MARGIN, y, { lineBreak: false });
        doc.text(num, MARGIN + contentWidth - numW, y, { lineBreak: false });
        // Dot leaders, drawn rather than typed so they land on one baseline
        // whatever the entry length.
        const from = MARGIN + titleW + 5;
        const to = MARGIN + contentWidth - numW - 5;
        if (to > from) {
          doc
            .moveTo(from, y + BODY_SIZE - 2.5)
            .lineTo(to, y + BODY_SIZE - 2.5)
            .lineWidth(0.6)
            .dash(1, { space: 2.4 })
            .strokeColor('#999999')
            .stroke()
            .undash();
        }
        doc.y = y + BODY_SIZE + 6.5;
      }
    }

    // ── Footers on every page ─────────────────────────────────────────
    // bufferPages lets us number pages only once the total is known.
    //
    // ⚠️ THE BOTTOM MARGIN IS DROPPED TO ZERO FIRST, and this is not cosmetic.
    // The footer sits 26pt BELOW the bottom margin on purpose — that is what
    // makes it a footer — and pdfkit answers text placed outside the printable
    // box by starting a fresh page for it. So every footer was silently
    // appending a blank page and then writing itself onto that instead: a
    // two-page motivation came out as four pages, half of them empty, and the
    // numbering read "page 1 of 2" on what was actually sheet three.
    //
    // It has been doing that since the file was written. It survived because
    // nothing here counts pages and a trailing blank page reads as a quirk of
    // the printer rather than a bug — it only surfaced when annexure images
    // doubled a five-page pack into ten.
    // ⚠️ COUNT THE MERGED PAGES BEFORE NUMBERING ANYTHING. The PDF annexures
    // are appended after this document is closed, but they are part of the
    // same submission — stamping the body first would number a fifteen-page
    // pack "page 5 of 12", and a DFO counting sheets would think three were
    // missing.
    const merged = await loadPdfAnnexures(input.annexurePdfs ?? []);
    // The running title, as theirs reads: who, what firearm, which section.
    const runningTitle = [
      `Motivation for ${input.applicantName}`,
      input.firearmLine ? `for a ${input.firearmLine}` : '',
      `— ${input.licenceTypeLabel}`,
    ]
      .filter(Boolean)
      .join(' ');
    // "Gerhard Johan Petrus Fourie" -> "Gerhard J P Fourie", as the handoff's
    // banner and footer both set it. A full name at 8 pt with 0.28em tracking
    // does not fit the strip beside the reference and the firearm.
    const shortName = shortenName(input.applicantName);

    // The banner's right-hand label: which section this page belongs to.
    //
    // Derived from `toc` rather than tracked separately, because toc already
    // records exactly this — a heading and the page it started on. Filled
    // FORWARD, so a section running over three pages labels all three, and a
    // page before the first heading (the contents) labels itself.
    const range = doc.bufferedPageRange();
    const pageLabels: string[] = [];
    {
      let current = 'Contents';
      for (let i = 0; i < range.count; i++) {
        const startedHere = toc.filter((t) => t.page === i + 1);
        if (startedHere.length) {
          current = titleCase(startedHere[startedHere.length - 1].heading);
        }
        pageLabels[i] = current;
      }
    }
    const totalPages = range.count + extraPageCount(merged.loaded);
    for (let i = 0; i < range.count; i++) {
      // ── Preview watermark ──────────────────────────────────
      //
      // Stamped in the footer pass because that is the one place we already
      // walk every page with bufferPages, and because it has to land on the
      // COVER too — the page the footer loop deliberately skips. Drawn before
      // the `continue` for that reason.
      //
      // ⚠️ SAVE AND RESTORE THE GRAPHICS STATE. rotate() and the fill colour
      // are document-wide in pdfkit, and leaving either set bleeds into the
      // footer drawn immediately below — which is how a first attempt put the
      // running title on a 55-degree angle in pale grey.
      if (input.watermark) {
        doc.switchToPage(range.start + i);
        // ⚠️ ZERO THE BOTTOM MARGIN FIRST, for the same reason the footer pass
        // does it twenty lines below. Text placed outside the printable box
        // makes pdfkit start a FRESH PAGE and write there instead — a
        // 90pt diagonal through the middle of an A4 overhangs the bottom
        // margin easily, and the cover line below sits under it on purpose.
        // The first version of this added a silent extra page to every
        // watermarked pack and numbered a six-page document "of 5".
        const keepBottom = doc.page.margins.bottom;
        const keepTop = doc.page.margins.top;
        doc.page.margins.bottom = 0;
        doc.page.margins.top = 0;

        doc.save();
        doc.rotate(-55, { origin: [PAGE_WIDTH / 2, PAGE_HEIGHT / 2] });
        // 90pt spans roughly half the page diagonal. Smaller reads as a
        // blemish rather than a mark, and a mark somebody can crop or ignore
        // is not doing the one job it has.
        doc
          .font(FONT_BOLD)
          .fontSize(90)
          .fillColor('#000000')
          .fillOpacity(0.07)
          .text('PREVIEW', 0, PAGE_HEIGHT / 2 - 52, {
            width: PAGE_WIDTH,
            align: 'center',
            characterSpacing: 10,
            lineBreak: false,
          });
        doc.fillOpacity(1);
        doc.restore();

        // A second line, small and legible, at the foot of the cover: a
        // 7%-opacity diagonal reads as a print artefact on a photocopy, and
        // somebody has to be able to tell what they are holding and that a
        // clean copy exists.
        if (i === 0) {
          doc
            .font(FONT_ITALIC)
            .fontSize(9)
            .fillColor(GREY)
            .text(
              'Preview copy — not for filing. The final document is issued without this mark.',
              MARGIN,
              PAGE_HEIGHT - MARGIN_BOTTOM + 26,
              { width: contentWidth, align: 'center', lineBreak: false },
            );
        }

        doc.page.margins.bottom = keepBottom;
        doc.page.margins.top = keepTop;
      }
      // ⚠️ NOT ON THE COVER. "Page 1 of 6" under a title page is what a
      // word-processed document does; a bound submission starts numbering at
      // the first page of content. The cover already carries the reference
      // number in its identification block, so nothing is lost by leaving it
      // clean — and a cover that reads as a cover is most of why the pack
      // looks like it came from somebody who does this for a living.
      doc.switchToPage(range.start + i);
      const keep = doc.page.margins.bottom;
      const keepTop = doc.page.margins.top;
      doc.page.margins.bottom = 0;
      doc.page.margins.top = 0;

      // \u26a0\ufe0f THE COVER CARRIES ITS OWN 80 MM BANNER, so it gets the footer
      // strip and nothing else. Drawing the 16 mm running banner over it would
      // put a second gradient across the title.
      if (i > 0) {
        K.banner(chrome, `${shortName} \u25c7 Motivation`, pageLabels[i] ?? '');
      }

      // The footer strip: one wash band, one line of small caps naming the
      // application. A DFO works through a pile of loose sheets, and a page
      // that names its own application cannot be filed against the wrong one.
      K.footerStrip(
        chrome,
        [
          input.referenceNumber,
          shortName,
          input.firearmLine ?? '',
          input.licenceTypeLabel,
          `Page ${i + 1} of ${totalPages}`,
        ]
          .filter(Boolean)
          .join(' \u00b7 '),
      );

      doc.page.margins.bottom = keep;
      doc.page.margins.top = keepTop;
    }

    doc.end();
    const body = await done;

    // The PDF annexures, printed into the pack rather than listed as missing.
    const pdf = await appendPdfAnnexures(body, merged.loaded, {
      referenceNumber: input.referenceNumber,
      templateVersion: input.templateVersion,
      bodyPageCount: range.count,
    });
    return { pdf, filename: `motivation-${input.referenceNumber}.pdf` };
  }
}
