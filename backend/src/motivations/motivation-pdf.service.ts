import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  GAP,
  STAMP_H,
  captionFor,
  planAnnexurePages,
  imageSize,
} from './motivation-annexure-layout';
import {
  appendPdfAnnexures,
  extraPageCount,
  loadPdfAnnexures,
  type PdfAnnexure,
} from './motivation-pdf-merge';
import type { AnnexureEntry, CertificationLevel } from './motivation-checklist';
import { COVER_FRAME_MM } from './motivation-cover-photo';
import { coverMasthead, edgeBar, EDGE_BAR_W } from './motivation-pdf-cover';
import { closingRule, drawMark, type MarkName } from './motivation-pdf-marks';
import * as K from './motivation-pdf-chrome';
import { renderStatementForm } from './motivation-pdf-form';
import type { CharacterStatementForm } from './motivation-character-statement';
import {
  LAYOUTS,
  asLayout,
  type TemplateLayout,
} from './motivation-pdf-layouts';

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
// No red, no branding beyond one discreet footer line — with ONE exception,
// added 2026-08-22: the unpaid pack carries the All Outdoor logo as its
// watermark, because a mark that says whose product this is is exactly what an
// unpaid pack needs. It never appears on a document somebody has paid for.
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
  | 'alloutdoor'
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
  /**
   * The one saturated colour on the page: the rule under a cover title, and
   * the short mark in front of a Ledger heading.
   *
   * ⚠️ A NINTH VARIABLE, ADDED 2026-08-24, BECAUSE EIGHT MUTED VALUES CANNOT
   * MAKE AN ACCENT. Every colour in a scheme was a tint or a shade of one
   * desaturated hue, so nothing on the page could carry emphasis and the whole
   * document read as a single grey wash — which is most of why it looked like
   * a word-processor template rather than something prepared for a member.
   *
   * ⚠️ AND IT IS NOT THE BRAND RED ON EVERY SCHEME. The brand is constant and
   * lives in the mark, which prints on every page. This is each colourway's
   * own harmonious answer to it: somebody who chose Sage did not choose a red
   * document, and a flat #E01B24 rule on a mauve page is a clash rather than a
   * signature. On the All Outdoor scheme the two are the same value.
   */
  accent: string;
}

export const SCHEMES: Record<Scheme, SchemeColours> = {
  // ⚠️ THE HOUSE SCHEME, AND THE DEFAULT SINCE 2026-08-24. Operator: "make
  // them match the website branding." The site is a #0f0f0f ground, a #C8102E
  // brand and Archivo display — so deep/deep2 are the site's own near-blacks
  // and the accent is its red.
  //
  // ⚠️ `band` IS NEUTRAL AND WAS BRIEFLY NOT. A pale red wash seemed like the
  // obvious way to brand it, and on a rendered body page it is five pink chips
  // down the sheet — a highlighter, not a submission. The same value also
  // colours Report's big margin numerals, so it was five pink numerals as
  // well. The brand belongs in the accent, which appears ONCE per section (the
  // node ring) and once per cover (the rule); a tint repeated eight times is
  // not an accent, it is a background.
  //
  // ⚠️ THE PAGE IS STILL WHITE, AND THAT IS NOT A COMPROMISE. This document
  // is read off paper, photocopied at a police station and filed. Flooding A4
  // with #0f0f0f would drink a cartridge, band on any office laser and
  // photocopy as a black rectangle. Matching a dark-mode site on paper means
  // carrying its INK and its TYPE across, never its background.
  alloutdoor: { deep: '#1f1f1f', deep2: '#0f0f0f', ink: '#141414', sub: '#3f3f3f', mut: '#7d7d7d', band: '#f0f0f0', hair: '#e0e0e0', wash: '#f7f7f7', accent: '#C8102E' },
  eucalyptus: { deep: '#587068', deep2: '#40524c', ink: '#29342f', sub: '#475650', mut: '#869590', band: '#dfe9e5', hair: '#dbe4e0', wash: '#f2f7f5', accent: '#2f6b56' },
  slate:      { deep: '#565e6e', deep2: '#3f4654', ink: '#2a2f38', sub: '#4c5460', mut: '#8a8f99', band: '#e3e2ec', hair: '#e2e0da', wash: '#f6f5f2', accent: '#3b5b8a' },
  stone:      { deep: '#6b645c', deep2: '#4e4841', ink: '#33302b', sub: '#57524b', mut: '#948e85', band: '#e9e4dc', hair: '#e4dfd7', wash: '#f7f5f1', accent: '#8a6a3d' },
  sage:       { deep: '#5f6b5e', deep2: '#454f45', ink: '#2c332c', sub: '#4d574d', mut: '#8a938a', band: '#e2e8df', hair: '#dfe3da', wash: '#f4f6f2', accent: '#44753f' },
  fogblue:    { deep: '#58687a', deep2: '#3f4c5b', ink: '#29323c', sub: '#485664', mut: '#8795a3', band: '#e0e7ed', hair: '#dde3e8', wash: '#f3f6f8', accent: '#2f6f8f' },
  clay:       { deep: '#7a615a', deep2: '#594641', ink: '#362c29', sub: '#5c4f4a', mut: '#998a81', band: '#ece2dd', hair: '#e6ddd6', wash: '#f8f4f1', accent: '#a0522d' },
  olive:      { deep: '#6a6a52', deep2: '#4d4d3b', ink: '#30302a', sub: '#55554a', mut: '#90907f', band: '#e7e7d9', hair: '#e2e2d5', wash: '#f6f6ef', accent: '#69762c' },
  sand:       { deep: '#8a7c62', deep2: '#665b47', ink: '#38332a', sub: '#5d5648', mut: '#9c9484', band: '#eee7d8', hair: '#e8e1d2', wash: '#f9f6ee', accent: '#a5762f' },
  graphite:   { deep: '#4a4a4e', deep2: '#333336', ink: '#26262a', sub: '#46464b', mut: '#8b8b90', band: '#e4e4e7', hair: '#e0e0e2', wash: '#f4f4f5', accent: '#5c5c66' },
  mauve:      { deep: '#6e5f6a', deep2: '#50454d', ink: '#322c31', sub: '#544a51', mut: '#93878f', band: '#e9e1e7', hair: '#e3dce1', wash: '#f7f3f6', accent: '#7a4a70' },
};

/** Eucalyptus first \u2014 the handoff's default, and the picker opens on it. */
export const SCHEME_KEYS: Scheme[] = [
  'alloutdoor',
  'eucalyptus', 'slate', 'stone', 'sage', 'fogblue',
  'clay', 'olive', 'sand', 'graphite', 'mauve',
];

/**
 * ⚠️ CHANGED FROM 'eucalyptus' ON 2026-08-24, and it is safe only because
 * asScheme() validates on READ rather than on write. A row that stored
 * 'eucalyptus' still renders eucalyptus; only a motivation with no stored
 * preference — which is what a new one has — picks this up. No existing pack
 * changes colour underneath anybody.
 */
export const DEFAULT_SCHEME: Scheme = 'alloutdoor';

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
   * How the document is SET - cover, headings, furniture, body face.
   *
   * WARNING: NOT THE OLD FORMAT AXIS. `format` decided how much document; that
   * question was settled in favour of `comprehensive` on 2026-08-21 and stays
   * settled. This decides only how the same content looks. Every layout
   * carries every section. See motivation-pdf-layouts.
   */
  layout?: TemplateLayout;
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
  /**
   * The photograph of the firearm, for the cover.
   *
   * A PATH OR BYTES, NEVER A URL. See motivation-firearm-image: the pack is
   * re-rendered on every download, so a hotlink would silently drop the
   * photograph from every future copy the day somebody else renames a file.
   *
   * A string is a path to a shared stock photograph on disk. A Buffer is the
   * APPLICANT'S OWN photograph, decrypted for this render only — it never
   * touches the filesystem in the clear, which is the whole point of holding
   * their documents encrypted.
   */
  firearmPhoto?: string | Buffer;
  priorNotice?: { title: string; body: string; version: string };
  /**
   * The SIGNED character witness statements, one page-set per witness.
   *
   * ⚠️ ONLY THE ONES ACTUALLY SIGNED. A witness who was invited and has not
   * completed does not appear at all — not as a blank, not as a placeholder,
   * not as "awaiting". A pack going to the police must contain what exists.
   *
   * ⚠️ NOT LETTERED AS ANNEXURES, still. An annexure in this pack is a
   * REPRINT of a document the applicant gathered; this is a document generated
   * from evidence the witness gave us directly. Mixing the two would put a
   * page in the annexure index that has no original anywhere.
   */
  characterStatements?: CharacterStatementForm[];
  /**
   * The previous owner's signed consent, when one has been given.
   *
   * ⚠️ IT IS THE SAME SHAPE AS A WITNESS STATEMENT ON PURPOSE, and for a while
   * that was the only thing about it that worked: consentFormFor() built this
   * form and NOTHING EVER CALLED IT. The module had zero callers while the
   * applicant's screen said "their signed consent and a copy of their licence
   * are in your pack". Only the two licence photographs reached the pack, as
   * SELLER_LICENCE annexures — the signed declaration itself, the thing a DFO
   * actually needs, was never rendered.
   *
   * Rendered next to the character statements because it is the same kind of
   * thing: evidence somebody signed, not a reprint of a card.
   */
  sellerConsent?: CharacterStatementForm;
  /**
   * Subject marks, keyed by the heading exactly as it is printed.
   *
   * ⚠️ BUILT FROM THE STORED STRUCTURE PLAN, not inferred from the words. The
   * headings are drawn from per-section alternates — "The quarry and the
   * ground I hunt" one time, "What I hunt, and where" the next — so keying on
   * the text would work until a seed picked a phrasing nobody had thought of,
   * and then a section would quietly lose its mark. The plan carries the id.
   */
  sectionMarks?: Record<string, MarkName>;
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
   *
   * The mark itself is the All Outdoor logo with NOT FOR USE above and below
   * it — see K.watermark. ⚠️ IT MEANS UNPAID, NOT UNSEATED: a free beta seat
   * is not a payment, so a beta pack carries it too. The caller decides; see
   * isPaidFor in motivations.service.
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
   * The C.I.P. datasheet for the cartridge applied for.
   *
   * ⚠️ BODY CONTENT, NOT AN ANNEXURE. Operator, 2026-08-23: "it not an
   * annexure. Its part of the motivation itself just giving information about
   * the cartridge." It lands immediately after the firearm section, carries no
   * annexure letter, and appears in the contents as a section.
   */
  cipSheet?: { bytes: Buffer; label: string };
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

/**
 * A heading as it should read in the contents.
 *
 * ⚠️ IT USED TO LOWERCASE EVERYTHING AND RECAPITALISE THE FIRST LETTER, which
 * was right while every heading was ALL CAPS and became wrong the moment the
 * document moved to first person and sentence case: "The firearm I am
 * applying for" came out as "The firearm i am applying for". A lone lowercase
 * "i" in the contents of a document somebody is handing to the Registrar is
 * exactly the kind of detail that makes a pack look homemade.
 *
 * So it only folds a heading that is SHOUTING. Anything already in sentence
 * case is left alone, because it was written the way it should read.
 */
export function titleCase(heading: string): string {
  const trimmed = heading.trim();
  const isShouting = trimmed === trimmed.toUpperCase();
  if (!isShouting) return trimmed;
  const lower = trimmed.toLowerCase();
  // Restore a standalone "i" — the one word that must never be lowercase.
  // ⚠️ THIS REGEX CONTAINED A LITERAL BACKSPACE (0x08) INSTEAD OF \\b, so it
  // matched nothing and the fix it documents had silently not been running.
  // A stray control character is invisible in an editor and in a diff; it
  // was found by extracting the text of a rendered page and reading it.
  const restored = lower.replace(/\bi\b/g, 'I');
  const sentence = restored.charAt(0).toUpperCase() + restored.slice(1);
  // ⚠️ AND THE ANNEXURE LETTER IS A LETTER, NOT A WORD. Sentence-casing
  // "ANNEXURE E — REQUEST FOR PRIOR NOTICE" produced "Annexure e" in the
  // contents of every pack that carries one. Restored by name rather than by
  // a general single-letter rule, because "a" is usually an article.
  return sentence.replace(
    /\b(annexure|tab)\s+([a-z])\b/gi,
    (_m, word: string, letter: string) => `${word} ${letter.toUpperCase()}`,
  );
}

/** Millimetres, for the section spacing. Same unit the handoff is written in. */
const mmGap = (n: number): number => K.mm(n);

/**
 * "Gerhard Johan Petrus Fourie" -> "Gerhard J P Fourie".
 *
 * First name in full, middle names as initials, surname in full — how the
 * handoff sets the banner and the footer, and how a South African legal
 * document conventionally shortens a name without losing which person it is.
 */
function shortenName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return full.trim();
  const [first, ...rest] = parts;
  const surname = rest.pop() as string;
  return [first, ...rest.map((n) => n[0].toUpperCase()), surname].join(' ');
}

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
    const L = LAYOUTS[asLayout(input.layout)];

    // \u26a0\ufe0f A MISSING FONT MUST NOT FAIL A DOWNLOAD. registerFonts returns
    // false when the assets did not ship \u2014 see the path-resolution note in
    // motivation-pdf-chrome \u2014 and the document then renders in the standard
    // faces. Ugly and readable beats a 500 on a licence application.
    const realFonts = K.registerFonts(doc);
    const F = K.faces(realFonts);
    const chrome: K.Chrome = { doc, c: C, f: F };

    // ── the running face ────────────────────────────────────────
    //
    // ⚠️ `bodyFace` WAS DECLARED ON EVERY LAYOUT AND READ BY NOTHING. The
    // picker has been telling members that Report is "sans-serif throughout"
    // while the renderer set every one of its paragraphs in Source Serif, the
    // same as the other four. B is what makes the promise true: on the four
    // serif layouts these ARE B.body*, so nothing about them moves.
    //
    // ⚠️ ARCHIVO HAS NO ITALIC IN THE REGISTERED SET, so the sans document's
    // italic maps to its regular. That is deliberate rather than a gap: the
    // alternative is falling back to a serif italic, which would put two
    // typefaces on a page whose entire character is that it uses one.
    const B = {
      body: L.bodyFace === 'sans' ? F.sans : F.serif,
      bodySemi: L.bodyFace === 'sans' ? F.sansSemi : F.serifSemi,
      bodyItalic: L.bodyFace === 'sans' ? F.sans : F.serifItalic,
    };
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
    // The 80 mm gradient block, as the handoff opens: reference, the spaced
    // MOTIVATION wordmark, a boxed subtitle, a rule and the section line.
    // ⚠️ FIVE MASTHEADS, NOT ONE. Until 2026-08-24 this block drew the same
    // 80 mm gradient whichever layout was chosen — `LayoutSpec.cover` was set
    // on all five and read by nothing, so rasterising the five and hashing
    // them returned ONE checksum. See motivation-pdf-cover for what each
    // style now owes its blurb.
    //
    // The photograph frame and the dossier grid below are deliberately NOT
    // part of the style: they are the information a DFO opens the folder for,
    // and every cover hands back the y at which they resume.
    let coverY = coverMasthead(chrome, L.cover, {
      referenceNumber: input.referenceNumber,
      licenceTypeLabel: input.licenceTypeLabel,
    });
    if (input.firearmPhoto) {
      // ── The frame is fixed; the photograph is FITTED INSIDE IT ─────
      //
      // ⚠️ `fit`, NOT `cover`, AND THAT IS THE WHOLE FIX. It was `cover` on the
      // reasoning that everything arriving here had already been trimmed to
      // COVER_ASPECT by the browser's tool, so filling the frame clipped
      // nothing. Two things were wrong with that. The frame was 86 mm — 47% of
      // the content column, a leftover from a two-column cover — so the tool
      // was forcing every photograph into a narrow letterbox before it ever
      // got here; and a stock photograph off Commons never goes through the
      // tool at all and could be any shape, so `cover` guillotined it.
      //
      // The operator sent a screenshot of a lever-action rifle cut off at both
      // ends: "the box cuts the picture off... we need to make a plan so we can
      // fit almost any shape picture and that it does not screw up the
      // documents formatting."
      //
      // ⚠️ THE BOX STAYS FIXED, WHICH IS WHAT KEEPS THE FORMATTING SAFE. The
      // page reserves the same rectangle whatever the photograph is, so the
      // dossier below never moves and no cover is a different length from any
      // other — the reason the fixed frame was introduced in the first place.
      // What changed is that the IMAGE is now fitted within that rectangle
      // rather than cropped to it: a rifle fills the width, an upright
      // photograph sits centred with wash either side, and nothing is cut.
      const frameW = K.mm(COVER_FRAME_MM.w);
      const frameH = K.mm(COVER_FRAME_MM.h);

      doc
        .rect(MARGIN, coverY, frameW, frameH)
        .lineWidth(0.7)
        .fillAndStroke(C.wash, C.hair);
      try {
        const pad = K.mm(2.5);
        doc.save();
        doc
          .rect(MARGIN + pad, coverY + pad, frameW - pad * 2, frameH - pad * 2)
          .clip();
        doc.image(input.firearmPhoto, MARGIN + pad, coverY + pad, {
          fit: [frameW - pad * 2, frameH - pad * 2],
          align: 'center',
          valign: 'center',
        });
        doc.restore();
      } catch {
        // A stored file pdfkit will not embed must not take the cover down.
        try {
          doc.restore();
        } catch {
          /* the save may not have happened */
        }
      }
      if (input.firearmLine) {
        K.label(
          chrome,
          input.firearmLine,
          MARGIN,
          coverY + frameH + K.mm(2.5),
          frameW,
        );
      }
      coverY += frameH + K.mm(12);
    }
    // ── The dossier ───────────────────────────────────────────────────
    //
    // ⚠️ THE BIG "APPLICATION FOR A FIREARM LICENCE" TITLE IS GONE FROM HERE.
    // The 80 mm banner above already says it, in a box, at 38 pt. Printing it
    // again in 34 pt black immediately underneath was the old cover showing
    // through the new one — two titles, one page.
    //
    // ⚠️ AND EVERY ROW IS SET IN THE EMBEDDED FACES. They were still in
    // Helvetica, which is WinAnsi: "Česká zbrojovka" came out as "ÆW6¾ ¦'
    // ojovka" in the Firearm row of a document naming the applicant's own
    // firearm. The caption under the photograph, already in Archivo, rendered
    // it correctly two centimetres above — which is how the fault was
    // visible at all.
    doc.x = MARGIN;
    doc.y = coverY;

    // Right of the photograph: who it is addressed to.
    const dossierX = input.firearmPhoto ? MARGIN : MARGIN;
    doc
      .font(B.body)
      .fontSize(K.px(13.5))
      .fillColor(C.sub)
      .text('To:', dossierX, doc.y, { width: contentWidth, lineBreak: false });
    doc.y += K.px(13.5) * 1.5;
    doc
      .font(B.bodySemi)
      .fillColor(C.ink)
      .text('The Registrar of Firearms', dossierX, doc.y, {
        width: contentWidth,
        lineBreak: false,
      });
    doc.y += K.px(13.5) * 1.5;
    doc
      .font(B.body)
      .fillColor(C.sub)
      .text(
        'through the Designated Firearms Officer, South African Police Service',
        dossierX,
        doc.y,
        { width: contentWidth },
      );

    doc.y += K.mm(7);
    // The band label, as the handoff heads the dossier grid.
    {
      const label = 'APPLICANT AND FIREARM';
      const size = K.px(11);
      doc.font(F.sansBold).fontSize(size);
      const w =
        doc.widthOfString(label, { characterSpacing: size * 0.22 }) + K.px(30);
      const h = size * 1.2 + K.px(14);
      doc.rect(MARGIN, doc.y, w, h).fill(C.band);
      doc
        .fillColor(C.deep2)
        .text(label, MARGIN + K.px(15), doc.y + K.px(7), {
          characterSpacing: size * 0.22,
          lineBreak: false,
        });
      doc.y += h + K.mm(5);
      doc.x = MARGIN;
    }

    // The grid: a 42 mm label column, hairline between rows.
    const rows: [string, string][] = [
      ['Applicant', input.applicantName],
      ...(input.idNumber
        ? ([['Identity number', input.idNumber]] as [string, string][])
        : []),
      ['Reference', input.referenceNumber],
      ...(input.firearmLine
        ? ([['Firearm', input.firearmLine]] as [string, string][])
        : []),
      [
        'Prepared',
        input.generatedAt.toLocaleDateString('en-ZA', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      ],
      ...(input.annexures?.length
        ? ([
            ['Annexures', `${input.annexures.length} attached`],
          ] as [string, string][])
        : []),
    ];

    const labelW = K.mm(42);

    // ── THE GRID HAS TO BE ASKED WHETHER IT FITS ─────────────────────────
    //
    // ⚠️ WITHOUT THIS THE COVER SPRAYS ORPHAN PAGES, and it did. Every row is
    // drawn with `.text(v, x, y, { width })`, and a width is precisely what
    // routes a pdfkit draw through LineWrapper — whose FIRST act is to compare
    // doc.y against the bottom margin and call addPage(). So a grid that does
    // not fit does not overflow tidily; it emits one nearly-blank page per row
    // that did not fit, each carrying a single value like "24 August 2026".
    //
    // Measured on the real renderer with a cover photograph and six rows:
    // Banner produced SEVEN pages where the same pack without a photograph
    // produced four. That is the DEFAULT layout, and it was already reaching
    // members before the layout work — the taller Plate and Classic covers
    // added on 2026-08-24 only made an existing fault easy to see (Plate hit
    // twelve). Fixing the cause here fixes all five.
    //
    // ⚠️ THE WHOLE GRID MOVES, NOT THE OVERFLOWING ROW. Splitting a six-row
    // identification block across a page break is worse than starting it
    // cleanly overleaf: a DFO reading "Firearm" on one sheet and its serial on
    // the next has to hold the pack open at two places.
    const rowGap = K.mm(2.4) * 2;
    doc.font(B.body).fontSize(K.px(13));
    const gridHeight =
      K.mm(3) +
      rows.reduce((sum, [, v]) => {
        const h = Math.max(
          doc.heightOfString(v, { width: contentWidth - labelW }),
          K.px(13) * 1.2,
        );
        return sum + h + rowGap;
      }, 0);

    if (doc.y + gridHeight > K.BODY_BOTTOM) {
      doc.addPage();
      doc.x = MARGIN;
      doc.y = K.BODY_TOP;
    }

    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + contentWidth, doc.y)
      .lineWidth(0.8)
      .strokeColor(C.ink)
      .stroke();
    doc.y += K.mm(3);

    for (const [k, v] of rows) {
      // A backstop for the pathological single row — a firearm line long
      // enough to wrap several times can still outgrow what the measurement
      // above reserved for it once the grid has started.
      doc.font(B.body).fontSize(K.px(13));
      const need =
        Math.max(
          doc.heightOfString(v, { width: contentWidth - labelW }),
          K.px(13) * 1.2,
        ) + rowGap;
      if (doc.y + need > K.BODY_BOTTOM) {
        doc.addPage();
        doc.x = MARGIN;
        doc.y = K.BODY_TOP;
      }

      const y = doc.y;
      K.label(chrome, k, MARGIN, y + 1, labelW - K.mm(3));
      doc
        .font(B.body)
        .fontSize(K.px(13))
        .fillColor(C.ink)
        .text(v, MARGIN + labelW, y, { width: contentWidth - labelW });
      const bottom = Math.max(doc.y, y + K.px(13) * 1.2) + K.mm(2.4);
      doc
        .moveTo(MARGIN, bottom)
        .lineTo(MARGIN + contentWidth, bottom)
        .lineWidth(0.5)
        .strokeColor(C.hair)
        .stroke();
      doc.x = MARGIN;
      doc.y = bottom + K.mm(2.4);
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

    /**
     * ⚠️ `final` MARKS A PAGE THAT IS ITSELF SPLICED IN. Ordinary entries are
     * recorded with the number pdfkit drew them at and shifted below by
     * whatever lands in front of them. A merged page has no pdfkit number at
     * all — its entry is written with the number it will end up with — so
     * shifting it again would count its own block twice.
     */
    const toc: { heading: string; page: number; final?: true }[] = [];

    /**
     * Pages that need a running head but must NOT appear in the contents.
     *
     * ⚠️ THE TAKE-WITH-YOU PAGES WERE LABELLED "ANNEXURES". The banner's
     * label is filled forward from `toc`, and the operator's instruction is
     * that the take-with-you sheets are the last two pages and are not in the
     * index - so they inherited the label of the last thing that WAS, and the
     * page telling an applicant what to carry to the police station announced
     * itself as an annexure.
     */
    const runningOnly: { heading: string; page: number }[] = [];

    /**
     * 1-based number of the first take-with-you sheet, once it exists.
     *
     * ⚠️ THE MERGED PDF ANNEXURES ARE INSERTED HERE, not appended. Operator:
     * the take-with-you sheets are the last two pages. pdfkit renders them
     * last, but pdf-lib then added the applicant's PDF annexures after them —
     * so the checklist ended up in the middle of the pack with annexures on
     * both sides. Everything at or past this point is numbered as though the
     * merged pages were already in front of it.
     */
    let takeWithYouAt: number | null = null;
    /** Where the C.I.P. datasheet is spliced in, once the body knows. */
    let cipInsertAt: number | null = null;

    /**
     * Every run of merged pages, and where it goes.
     *
     * ⚠️ THE CONTENTS AND THE FOOTERS ARE BOTH WRITTEN BEFORE THESE PAGES
     * EXIST. pdfkit lays the body out and stamps it; pd-lib splices the PDF
     * pages in afterwards. So every page number this file writes has to be the
     * number the page will END UP with, which means knowing about every
     * insertion in advance. One hard-coded point was enough while the only
     * merged pages were reprinted annexures; it is not now.
     */
    const insertions: { at: number; count: number }[] = [];

    /**
     * How far a page moves, given everything spliced in ahead of it.
     *
     * `strict` is for a page that IS one of the insertions: it must count the
     * blocks in front of it and NOT itself.
     */
    const shiftFor = (zeroBased: number, strict = false): number =>
      insertions
        .filter((ins) => (strict ? zeroBased > ins.at : zeroBased >= ins.at))
        .reduce((n, ins) => n + ins.count, 0);

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
      const mark = input.sectionMarks?.[heading];
      doc.y = K.sectionHeader(
        chrome,
        num,
        heading,
        doc.y,
        mark
          ? (mx, my, ms) => drawMark(chrome, mark, mx, my, ms, C.deep, 0.55)
          : undefined,
        L.heading,
      );

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
          .font(isRef ? B.bodyItalic : B.body)
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
      renderHeading('The firearm I am applying for');

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

      // ── The cartridge's own datasheet ───────────────────────────
      //
      // ⚠️ A DELIBERATE PAGE BREAK, AND ONLY WHEN THERE IS A SHEET. The page
      // is spliced in whole, so it can only land BETWEEN pages — and the
      // firearm spec block usually ends mid-page with the owned-firearms
      // table starting underneath it. Without the break the datasheet would
      // be inserted into the middle of that table. Packs with no sheet gain
      // nothing.
      if (input.cipSheet) {
        const at = doc.bufferedPageRange().count;
        doc.addPage();
        insertions.push({ at, count: 1 });
        cipInsertAt = at;
        // Its final number counts the blocks IN FRONT of it, never itself.
        toc.push({
          heading: input.cipSheet.label,
          page: at + 1 + shiftFor(at, true),
          final: true,
        });
      }
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
      renderHeading('Firearms already licensed to me');

      const owned = input.ownedFirearms ?? [];
      if (!owned.length) {
        // Set like the body it stands in for — this sentence IS the section's
        // content on a first application, and it was the one line of prose in
        // the document still in the old italic sans.
        doc
          .font(B.bodyItalic)
          .fontSize(K.BODY_SIZE)
          .fillColor(C.ink)
          .text(
            'No firearm is currently licensed to me. This is a first application.',
            MARGIN + K.SECTION_INDENT,
            doc.y,
            {
              width: contentWidth - K.SECTION_INDENT,
              lineGap: K.BODY_LEADING,
            },
          );
        doc.x = MARGIN;
        doc.y += K.PARA_GAP;
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
    //
    // ⚠️ IN THE HANDOFF'S FACES, like everything above it. This block and the
    // disclaimer below were the last two pieces of the body still set in the
    // old sans at the old greys — and they sit at the FOOT of the argument,
    // directly under the serif they were meant to close. On the page they
    // read as a different document's footer glued to the bottom.
    if (doc.y > K.BODY_BOTTOM - K.mm(46)) doc.addPage();
    doc.x = MARGIN;
    doc.y += K.mm(10);
    const sigW = K.mm(78);
    const sigY = doc.y + K.mm(9);
    doc
      .moveTo(MARGIN, sigY)
      .lineTo(MARGIN + sigW, sigY)
      .lineWidth(0.7)
      .strokeColor(C.hair)
      .stroke();
    doc.y = sigY + K.mm(2);
    doc
      .font(B.body)
      .fontSize(K.px(13))
      .fillColor(C.ink)
      .text(input.applicantName, MARGIN, doc.y, { width: sigW });
    K.label(chrome, 'Signature and date', MARGIN, doc.y + 1, sigW);
    doc.x = MARGIN;

    // ── Disclaimer ────────────────────────────────────────────────────
    if (doc.y > K.BODY_BOTTOM - K.mm(30)) doc.addPage();
    doc.y += K.mm(8);
    const discY = doc.y;
    doc
      .moveTo(MARGIN, discY)
      .lineTo(MARGIN + contentWidth, discY)
      .lineWidth(0.7)
      .strokeColor(C.hair)
      .stroke();
    doc.y = discY + K.mm(3);
    doc
      .font(F.sans)
      .fontSize(K.px(9.5))
      .fillColor(C.mut)
      .text(input.disclaimer, MARGIN, doc.y, {
        width: contentWidth,
        lineGap: K.px(2),
      });
    doc.x = MARGIN;

    // ── The closing vignette ──────────────────────────────────────────
    //
    // A hairline, a mark, a hairline. The one piece of pure character in the
    // document: it says "the argument ends here" where the page would
    // otherwise just run out, which is what a professional submission does and
    // a word-processed one does not.
    //
    // Skipped rather than pushed to a page of its own — an ornament that costs
    // a sheet of paper has stopped being an ornament.
    if (doc.y + K.mm(14) < K.BODY_BOTTOM) {
      doc.x = MARGIN;
      doc.y += K.mm(7);
      closingRule(chrome, doc.y, 'ammo', contentWidth, MARGIN);
      doc.y += K.mm(7);
    }

    // ── What to take to the station ───────────────────────────────────
    //
    // Last page but one, before the annexures, because it is the page the
    // applicant reads on the morning they go.
    // ── Request for prior notice ─────────────────────────────────
    if (input.priorNotice) {
      // Its own page and its own signature block. This is a separate request
      // to the Registrar, not a paragraph of the motivation, and it is signed
      // separately because that is what makes it a request from the applicant
      // rather than a note from us.
      doc.addPage();
      doc.x = MARGIN;
      doc.y = K.BODY_TOP;
      const pnLetter = input.annexures?.find(
        (a2) => a2.kind === 'PRIOR_NOTICE_REQUEST',
      )?.letter;
      toc.push({
        heading: pnLetter
          ? `ANNEXURE ${pnLetter} — ${input.priorNotice.title}`
          : input.priorNotice.title,
        page: doc.bufferedPageRange().count,
      });

      // ── The masthead ──────────────────────────────────────────────
      //
      // ⚠️ THIS PAGE WAS THE ODD ONE OUT IN THE WHOLE PACK. Every word of it
      // was set in the sans at body size and justified, so a page addressed to
      // the Registrar — arguably the most formal page in the document — read
      // like a web layout wedged between serif ones. It now takes the same
      // treatment as a section: the annexure letter in small caps, the title,
      // a rule, and the body in the serif with the hanging hairline.
      if (pnLetter) {
        K.label(chrome, `ANNEXURE ${pnLetter}`, MARGIN, doc.y, contentWidth);
        doc.y += K.px(8.5) * 1.2 + K.mm(3);
      }
      doc
        .font(F.sans)
        .fontSize(K.px(19))
        .fillColor(C.deep)
        .text(input.priorNotice.title, MARGIN, doc.y, {
          width: contentWidth,
          characterSpacing: K.px(19) * 0.04,
        });
      doc.y += K.mm(3);
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(MARGIN + contentWidth, doc.y)
        .lineWidth(2)
        .strokeColor(C.deep)
        .stroke();
      doc.y += K.mm(4);
      doc
        .font(F.sansSemi)
        .fontSize(K.px(10))
        .fillColor(C.mut)
        .text(
          'TO THE DESIGNATED FIREARMS OFFICER, FOR THE ATTENTION OF THE REGISTRAR OF FIREARMS',
          MARGIN,
          doc.y,
          { width: contentWidth, characterSpacing: K.px(10) * 0.1 },
        );
      doc.y += K.mm(6);

      // The hanging hairline down the left of the body, as the sections use.
      const pnRule = K.sectionRule(chrome);
      pnRule.start(doc.y);
      const bodyX = MARGIN + K.SECTION_INDENT;
      const bodyW = contentWidth - K.SECTION_INDENT;

      for (const block of input.priorNotice.body
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter(Boolean)) {
        // A numbered ask is a hanging indent, not a justified paragraph — the
        // three of them have to be countable at a glance.
        const numbered = /^\d\.\s/.test(block);
        const isLabel = /:$/.test(block) && block.length < 40;

        doc
          .font(isLabel ? F.sansSemi : B.body)
          .fontSize(isLabel ? K.px(10) : K.BODY_SIZE);
        const need = doc.heightOfString(block, {
          width: bodyW - (numbered ? K.mm(6) : 0),
          lineGap: isLabel ? 0 : K.BODY_LEADING,
        });
        if (doc.y + need > K.BODY_BOTTOM) {
          pnRule.close(K.BODY_BOTTOM);
          doc.addPage();
          doc.y = K.BODY_TOP;
          pnRule.start(doc.y);
        }

        if (isLabel) {
          doc
            .fillColor(C.mut)
            .text(block.replace(/:$/, '').toUpperCase(), bodyX, doc.y, {
              width: bodyW,
              characterSpacing: K.px(10) * 0.1,
            });
          doc.y += K.mm(2);
        } else {
          doc
            .fillColor(C.ink)
            .text(block, bodyX + (numbered ? K.mm(6) : 0), doc.y, {
              width: bodyW - (numbered ? K.mm(6) : 0),
              align: numbered ? 'left' : 'justify',
              lineGap: K.BODY_LEADING,
            });
          doc.y += numbered ? K.mm(2.5) : K.PARA_GAP;
        }
        doc.x = MARGIN;
      }

      // ⚠️ RESERVE WHAT THE BLOCK ACTUALLY NEEDS, NOT A ROUND NUMBER. A guess
      // of 90 threw the signature onto a page of its own with seventy points
      // of clear space above it — a one-line page seven that reads as a
      // printing accident on a document somebody is handing to an official.
      const sigNeed = K.mm(4) + K.mm(9) + K.px(13) * 2.4;
      if (doc.y + sigNeed > K.BODY_BOTTOM) {
        pnRule.close(K.BODY_BOTTOM);
        doc.addPage();
        doc.y = K.BODY_TOP;
        pnRule.start(doc.y);
      }
      pnRule.close(doc.y);

      doc.x = MARGIN;
      doc.y += K.mm(4);
      const pnSigY = doc.y + K.mm(9);
      doc
        .moveTo(MARGIN, pnSigY)
        .lineTo(MARGIN + K.mm(72), pnSigY)
        .lineWidth(0.7)
        .strokeColor(C.hair)
        .stroke();
      doc.y = pnSigY + K.mm(2);
      doc
        .font(B.body)
        .fontSize(K.px(13))
        .fillColor(C.ink)
        .text(input.applicantName, MARGIN, doc.y, { width: K.mm(72) });
      K.label(chrome, 'Signature and date', MARGIN, doc.y + 1, K.mm(72));
      doc.x = MARGIN;
    }

    // ── The character witness statements ──────────────────────────────
    //
    // ⚠️ SIGNED STATEMENTS, NOT BLANK FORMS. The pack used to carry two ruled
    // sheets for the applicant to print and hand out; operator, 2026-08-21:
    // "Only use the link." A witness now completes and signs on their own
    // phone and what prints here is what they actually said — which is a
    // document a Designated Firearms Officer can read, rather than two pages
    // of hope.
    //
    // Placed here, before the copies of what has already been gathered,
    // because a statement is evidence in its own right rather than a reprint
    // of somebody's card. They ARE in the contents.
    for (const form of input.characterStatements ?? []) {
      const startedOn = renderStatementForm(chrome, form);
      toc.push({
        heading:
          (input.characterStatements?.length ?? 1) > 1
            ? `CHARACTER WITNESS STATEMENT ${form.index} OF ${input.characterStatements?.length}`
            : 'CHARACTER WITNESS STATEMENT',
        page: startedOn,
      });
    }

    // The previous owner's consent, on its own sheet and in the contents.
    // Same renderer as a witness statement, so it inherits the scale-to-one-A4-
    // page behaviour the operator asked for ("Everything on one page").
    if (input.sellerConsent) {
      const startedOn = renderStatementForm(chrome, input.sellerConsent);
      toc.push({
        heading: "THE PREVIOUS OWNER'S CONSENT",
        page: startedOn,
      });
    }

    // ── Annexure index ────────────────────────────────────────────────
    if (input.annexures?.length) {
      doc.addPage();
      doc.x = MARGIN;
      doc.y = K.BODY_TOP;
      toc.push({ heading: 'ANNEXURES', page: doc.bufferedPageRange().count });

      K.label(chrome, 'WHAT IS ATTACHED', MARGIN, doc.y, contentWidth);
      doc.y += K.px(8.5) * 1.2 + K.mm(3);
      doc
        .font(F.sans)
        .fontSize(K.px(22))
        .fillColor(C.deep)
        .text('ANNEXURES', MARGIN, doc.y, {
          width: contentWidth,
          characterSpacing: K.px(22) * 0.06,
        });
      doc.y += K.mm(3);
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(MARGIN + contentWidth, doc.y)
        .lineWidth(2)
        .strokeColor(C.deep)
        .stroke();
      doc.y += K.mm(4);
      doc
        .font(B.bodyItalic)
        .fontSize(K.px(12))
        .fillColor(C.sub)
        .text(
          'Attached in this order, and referred to by letter in the motivation.',
          MARGIN,
          doc.y,
          { width: contentWidth },
        );
      doc.y += K.mm(7);

      // ── The table ─────────────────────────────────────────────────
      //
      // ⚠️ ROWS ON HAIRLINES, AND DELIBERATELY TALLER THAN THEY NEED TO BE.
      // The old list packed eight rows into the top fifth of the sheet and
      // left the rest blank, which reads as a page that ran out of content.
      // This is a reference table a DFO reads down while checking a folder,
      // so the room is not decoration — it is what makes a row scannable.
      const certW = K.mm(34);
      const letterW = K.mm(30);
      const labelW = contentWidth - letterW - certW - K.mm(6);

      // Column captions, so the certification marks are not read as a claim
      // that six documents are legally required to be certified.
      K.label(chrome, 'Tab', MARGIN, doc.y, letterW);
      K.label(chrome, 'Document', MARGIN + letterW, doc.y, labelW);
      K.label(
        chrome,
        'Certification',
        MARGIN + contentWidth - certW,
        doc.y,
        certW,
      );
      doc.y += K.px(8.5) * 1.2 + K.mm(2);
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(MARGIN + contentWidth, doc.y)
        .lineWidth(0.8)
        .strokeColor(C.ink)
        .stroke();
      doc.y += K.mm(3.5);

      for (const a of input.annexures) {
        const label = a.count > 1 ? `${a.label} (${a.count} items)` : a.label;
        doc.font(B.body).fontSize(K.px(13));
        const need =
          doc.heightOfString(label, { width: labelW, lineGap: K.px(2) }) +
          K.mm(6);
        if (doc.y + need > K.BODY_BOTTOM) {
          doc.addPage();
          doc.y = K.BODY_TOP;
        }

        const y = doc.y;
        doc
          .font(F.sansBold)
          .fontSize(K.px(11))
          .fillColor(C.deep)
          .text(`Annexure ${a.letter}`, MARGIN, y + 1, {
            width: letterW,
            lineBreak: false,
          });
        doc
          .font(B.body)
          .fontSize(K.px(13))
          .fillColor(C.ink)
          .text(label, MARGIN + letterW, y, { width: labelW, lineGap: K.px(2) });
        const rowBottom = Math.max(doc.y, y + K.px(13) * 1.3);

        if (a.certification !== 'none') {
          // ⚠️ A PILL, NOT A DASHED BOX. The old marks were dashed rectangles
          // whose borders nearly touched between rows, so the column read as
          // one grey block instead of a mark against each annexure — and a
          // dashed border is the visual language of "cut here", which is the
          // opposite of what this says.
          const required = a.certification === 'required';
          const cx = MARGIN + contentWidth - certW;
          const h = K.mm(5.4);
          doc
            .roundedRect(cx, y, certW, h, h / 2)
            .lineWidth(0.8)
            .fillAndStroke(required ? C.band : C.wash, required ? C.deep : C.hair);
          doc
            .font(required ? F.sansBold : F.sans)
            .fontSize(K.px(8))
            .fillColor(required ? C.deep2 : C.mut)
            .text(required ? 'REQUIRED' : 'USUALLY ASKED', cx, y + K.mm(1.5), {
              width: certW,
              align: 'center',
              characterSpacing: K.px(8) * 0.12,
              lineBreak: false,
            });
        }

        doc.x = MARGIN;
        doc.y = rowBottom + K.mm(3);
        doc
          .moveTo(MARGIN, doc.y)
          .lineTo(MARGIN + contentWidth, doc.y)
          .lineWidth(0.5)
          .strokeColor(C.hair)
          .stroke();
        doc.y += K.mm(3.5);
      }

      // The distinction, stated once.
      if (input.annexures.some((a) => a.certification !== 'none')) {
        doc.y += K.mm(2);
        const top = doc.y;
        doc
          .font(F.sans)
          .fontSize(K.px(10))
          .fillColor(C.sub)
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
            MARGIN + K.mm(6),
            doc.y,
            { width: contentWidth - K.mm(6), lineGap: K.px(3) },
          );
        doc.rect(MARGIN, top, K.px(2), doc.y - top).fill(C.band);
        doc.x = MARGIN;
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
          // ⚠️ BODY_TOP AND BODY_BOTTOM, NOT MARGIN. MARGIN is mm(14); the
          // running banner is mm(16) tall and the footer strip mm(10). Laid
          // out from MARGIN, every annexure caption was drawn UNDER the banner
          // and painted over by it — "Annexure B — SAPS competency
          // certificate" sliced in half on eight pages of a real 26-page pack,
          // on precisely the line that tells the reader which annexure they
          // are looking at. The banner is stamped last, in the bufferPages
          // pass, so nothing here could see the collision coming.
          y: K.BODY_TOP,
          width: contentWidth,
          height: K.BODY_BOTTOM - K.BODY_TOP,
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

    // ── Take these with you ────────────────────────────────────
    //
    // ⚠️ THE LAST PAGES, AND DELIBERATELY NOT IN THE CONTENTS. Operator,
    // 2026-08-21: "The TAKE THESE WITH YOU two documents should be the last
    // two pages of the document and not part of the index."
    //
    // The reasoning holds up: everything above this point is the SUBMISSION —
    // the motivation, the request, the annexures a DFO reads. This is a note
    // to the applicant about their own morning, and it is the one part of the
    // pack that is not addressed to the Registrar at all. Listing it in the
    // contents invites a reviewer to turn to it; putting it at the back means
    // the applicant can tear it off and leave it in the car.
    if (input.takeWithYou?.length) {
      doc.addPage();
      doc.x = MARGIN;
      doc.y = K.BODY_TOP;

      // ⚠️ IN THE RUNNING HEAD, NOT IN THE CONTENTS. The two are separate
      // lists for exactly this page: the banner label is filled forward from
      // `toc`, so a page kept out of the contents inherits the label of the
      // last page that was in it — and these sheets announced themselves as
      // "ANNEXURES" while telling the applicant what to carry to the station.
      takeWithYouAt = doc.bufferedPageRange().count;
      runningOnly.push({
        heading: 'Take these with you',
        page: takeWithYouAt,
      });

      // ── The worksheet masthead ────────────────────────────────────
      //
      // ⚠️ DELIBERATELY NOT A NUMBERED SECTION BAND. The bands mark pages
      // addressed to the Registrar; this page and the character reference
      // forms are addressed to the applicant and to their referees. Giving
      // the two kinds of page two different mastheads is the cheapest way to
      // show a reader which of them they are holding.
      K.label(chrome, 'BEFORE YOU GO', MARGIN, doc.y, contentWidth);
      doc.y += K.px(8.5) * 1.2 + K.mm(3);
      doc
        .font(F.sans)
        .fontSize(K.px(22))
        .fillColor(C.deep)
        .text('TAKE THESE WITH YOU', MARGIN, doc.y, {
          width: contentWidth,
          characterSpacing: K.px(22) * 0.06,
        });
      doc.y += K.mm(3);
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(MARGIN + contentWidth, doc.y)
        .lineWidth(2)
        .strokeColor(C.deep)
        .stroke();
      doc.y += K.mm(5);

      {
        // The preamble, in the margin-bar treatment the forms use for
        // anything addressed to the person holding the page.
        const text =
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
          'confirm it with your own DFO.';
        const top = doc.y;
        doc
          .font(F.sans)
          .fontSize(K.px(10.5))
          .fillColor(C.sub)
          .text(text, MARGIN + K.mm(6), doc.y, {
            width: contentWidth - K.mm(6),
            lineGap: K.px(3),
          });
        doc.rect(MARGIN, top, K.px(2), doc.y - top).fill(C.band);
        doc.x = MARGIN;
        doc.y += K.mm(5);
      }

      const boxSize = K.mm(3.4);
      const itemX = MARGIN + boxSize + K.mm(3);
      const itemW = contentWidth - (boxSize + K.mm(3));

      for (const item of input.takeWithYou) {
        // ⚠️ MEASURE THE WHOLE ITEM BEFORE DRAWING ANY OF IT. The tick box was
        // drawn first and the text afterwards, so when the text tripped
        // pdfkit's automatic page break the BOX STAYED BEHIND — a real pack
        // ended its take-with-you page with an empty square and no line
        // beside it, which reads as a checklist entry somebody forgot to
        // write. A box without its line is worse than a page break.
        doc.font(B.body).fontSize(K.BODY_SIZE);
        let need = doc.heightOfString(item.label, {
          width: itemW,
          lineGap: K.px(2),
        });
        if (item.note) {
          doc.font(F.sans).fontSize(K.px(9.5));
          need += doc.heightOfString(item.note, {
            width: itemW,
            lineGap: K.px(2),
          });
        }
        need += K.mm(3);
        if (doc.y + need > K.BODY_BOTTOM) {
          doc.addPage();
          doc.y = K.BODY_TOP;
        }

        // An empty box to tick with a pen. The applicant is standing at a
        // kitchen table with a pile of paper, not looking at a screen.
        const y = doc.y;
        doc
          .rect(MARGIN, y + K.px(2), boxSize, boxSize)
          .lineWidth(0.8)
          .strokeColor(C.mut)
          .stroke();
        doc
          .font(B.body)
          .fontSize(K.BODY_SIZE)
          .fillColor(C.ink)
          .text(item.label, itemX, y, { width: itemW, lineGap: K.px(2) });
        if (item.note) {
          doc
            .font(F.sans)
            .fontSize(K.px(9.5))
            .fillColor(C.sub)
            .text(item.note, itemX, doc.y, { width: itemW, lineGap: K.px(2) });
        }
        doc.x = MARGIN;
        doc.y += K.mm(3);
      }
    }


    // ── Contents, written now that the pages are known ────────────────
    if (tocPageIndex !== null && toc.length) {
      doc.switchToPage(tocPageIndex);
      // ⚠️ BODY_TOP, NOT MARGIN. MARGIN is mm(14) and the running banner is
      // mm(16) tall, so the CONTENTS heading was drawn six points UNDER the
      // banner and had its ascenders shaved off — on page two of every pack.
      // It survived because this page is written last, in the bufferPages
      // pass, long after the code that established where a page begins.
      doc.y = K.BODY_TOP;
      doc.x = MARGIN;

      K.label(chrome, 'IN THIS PACK', MARGIN, doc.y, contentWidth);
      doc.y += K.px(8.5) * 1.2 + K.mm(3);
      doc
        .font(F.sans)
        .fontSize(K.px(22))
        .fillColor(C.deep)
        .text('CONTENTS', MARGIN, doc.y, {
          width: contentWidth,
          characterSpacing: K.px(22) * 0.06,
        });
      doc.y += K.mm(3);
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(MARGIN + contentWidth, doc.y)
        .lineWidth(2)
        .strokeColor(C.deep)
        .stroke();
      doc.y += K.mm(7);

      const numColW = K.mm(12);
      for (const entry of toc) {
        const y = doc.y;
        // ⚠️ THE NUMBER THE PAGE ENDS UP WITH. Same rule as the footers: this
        // is written before the merged pages exist, so an entry pointing at a
        // page behind an insertion has to account for it. A `final` entry is
        // a merged page and already carries its answer.
        const num = String(
          entry.final ? entry.page : entry.page + shiftFor(entry.page - 1),
        );
        const title = titleCase(entry.heading);

        doc.font(B.body).fontSize(K.px(13.5)).fillColor(C.ink);
        // ⚠️ ELLIPSISED, NOT WRAPPED. A contents line that wraps puts its page
        // number level with the first line and its tail under the leaders,
        // which reads as two entries. "Annexure E — Request for prior notice
        // and written reasons" is long enough to do it.
        const shown = K.ellipsise(
          doc,
          title,
          contentWidth - numColW - K.mm(10),
          0,
        );
        doc.text(shown, MARGIN, y, { lineBreak: false });
        const titleW = doc.widthOfString(shown);

        doc
          .font(F.sansSemi)
          .fontSize(K.px(12))
          .fillColor(C.deep)
          .text(num, MARGIN + contentWidth - numColW, y + 1, {
            width: numColW,
            align: 'right',
            lineBreak: false,
          });

        // Dot leaders, drawn rather than typed so they land on one baseline
        // whatever the entry length.
        const from = MARGIN + titleW + K.mm(2.5);
        const to = MARGIN + contentWidth - numColW - K.mm(2.5);
        if (to > from) {
          doc
            .moveTo(from, y + K.px(13.5) * 0.72)
            .lineTo(to, y + K.px(13.5) * 0.72)
            .lineWidth(0.7)
            .dash(0.7, { space: 2.6 })
            .strokeColor(C.hair)
            .stroke()
            .undash();
        }
        doc.x = MARGIN;
        doc.y = y + K.px(13.5) * 1.15 + K.mm(3);
      }

      // ⚠️ THE BACK MATTER IS NAMED HERE, NOT LISTED. The take-with-you sheets
      // are deliberately outside the index, and a contents page that simply
      // stops implies there is nothing after the last line.
      doc.y += K.mm(4);
      doc
        .font(B.bodyItalic)
        .fontSize(K.px(11.5))
        .fillColor(C.sub)
        .text(
          'The last sheets are yours rather than the Registrar’s: a checklist ' +
            'of what to take with you to the police station.',
          MARGIN,
          doc.y,
          { width: contentWidth, lineGap: K.px(2) },
        );
      doc.x = MARGIN;
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
      const labelSources = [...toc, ...runningOnly];
      for (let i = 0; i < range.count; i++) {
        const startedHere = labelSources.filter((t) => t.page === i + 1);
        if (startedHere.length) {
          current = titleCase(startedHere[startedHere.length - 1].heading);
        }
        pageLabels[i] = current;
      }
    }
    // ⚠️ REGISTERED HERE, AFTER THE BODY IS LAID OUT, because takeWithYouAt is
    // only known once those sheets have been rendered. Everything else pushed
    // to `insertions` during the render; this one joins them at the end so the
    // footer and contents passes below see a single complete list.
    const annexurePages = extraPageCount(merged.loaded);
    if (annexurePages > 0) {
      insertions.push({
        at: takeWithYouAt === null ? range.count : takeWithYouAt - 1,
        count: annexurePages,
      });
    }
    const totalPages =
      range.count + insertions.reduce((n, ins) => n + ins.count, 0);
    for (let i = 0; i < range.count; i++) {
      // ── The unpaid mark ────────────────────────────────────
      //
      // Stamped in the footer pass because that is the one place we already
      // walk every page with bufferPages, and because it has to land on the
      // COVER too — the page the footer loop deliberately skips. Drawn before
      // the banner for that reason.
      //
      // ⚠️ IT USED TO SAY "PREVIEW" IN 90 PT HELVETICA. Operator, 2026-08-22:
      // "Add NOT FOR USE around the All Outdoor logo as the watermark." The
      // composition — logo, words above and below, the whole thing on the
      // sheet's own diagonal — is page furniture, so it lives with the banner
      // and the footer strip in motivation-pdf-chrome rather than here.
      if (input.watermark) {
        doc.switchToPage(range.start + i);
        // ⚠️ ZERO THE BOTTOM MARGIN FIRST, for the same reason the footer pass
        // does it twenty lines below. Text placed outside the printable box
        // makes pdfkit start a FRESH PAGE and write there instead, and the
        // cover line below sits under the body's bottom margin on purpose.
        // The first version of this added a silent extra page to every
        // watermarked pack and numbered a six-page document "of 5".
        const keepBottom = doc.page.margins.bottom;
        const keepTop = doc.page.margins.top;
        doc.page.margins.bottom = 0;
        doc.page.margins.top = 0;

        K.watermark(chrome);

        // A second line, small and legible, at the foot of the cover: a
        // 7%-opacity diagonal reads as a print artefact on a photocopy, and
        // somebody has to be able to tell what they are holding and that a
        // clean copy exists.
        //
        // ⚠️ ABOVE THE FOOTER STRIP, NOT INSIDE IT. This line sat at
        // MARGIN_BOTTOM + 26 — which was clear air under the old two-line
        // footer, and is inside the 10 mm wash band the 2026-08-21 restyle put
        // there. footerStrip() fills that band opaquely a few lines below, so
        // the line was drawn and then painted out: INVISIBLE on every
        // watermarked cover since the restyle, and invisible in the source
        // too, because nothing about `PAGE_HEIGHT - MARGIN_BOTTOM + 26` says
        // "under the footer". Found by rendering a fixture and looking at it.
        if (i === 0) {
          doc
            .font(FONT_ITALIC)
            .fontSize(9)
            .fillColor(GREY)
            .text(
              'Preview copy — not for use and not for filing. ' +
                'The final document is issued without this mark.',
              MARGIN,
              PAGE_HEIGHT - MARGIN_BOTTOM - mmGap(5),
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
        // WARNING: NOT EVERY LAYOUT CARRIES A RUNNING BANNER. The quieter ones
        // put nothing across the top of a body page at all, which is the
        // single biggest difference between reading a Banner pack and a
        // Classic one. The footer already names the reference, the applicant
        // and the page on every page, so nothing identifying is lost when the
        // banner goes.
        if (L.runningBanner) {
          K.banner(chrome, `${shortName} \u25c7 Motivation`, pageLabels[i] ?? '');
        }
        // ⚠️ DRAWN BEFORE THE FOOTER, WHICH IS WHY THE FOOTER TAKES AN INSET.
        // The bar runs the full height of the page; the footer's wash band is
        // full width, so painting it afterwards would cut the last 10 mm off
        // the bar on every page. The cover draws its own — it has the monogram
        // sitting on top of it, which a redraw here would cover.
        if (L.edgeBar) edgeBar(chrome);
      }

      // The footer strip: one wash band, one line of small caps naming the
      // application. A DFO works through a pile of loose sheets, and a page
      // that names its own application cannot be filed against the wrong one.
      //
      // ⚠️ SPLIT INTO "NEVER DROP" AND "DROP IF IT DOES NOT FIT". Joined into
      // one string this line ran past the strip and WRAPPED - the second row
      // fell halfway out of the wash band on every page of a 26-page pack,
      // because "Cezka Zbrojovka (CZ) Handgun, serial 81815 - Section 16 -
      // Dedicated sport shooter" is simply longer than a page is wide at 8 pt.
      // The reference and the page number are what make a loose sheet filable,
      // so they stay; the rest sheds from the tail.
      // ⚠️ THE NUMBER A PAGE ENDS UP WITH, not the one it is drawn at. Pages
      // are spliced in after this pass runs, so every page at or past an
      // insertion moves — and they are stamped here, minutes before that
      // happens. This was one hard-coded point until 2026-08-23; it is now
      // whatever the render recorded, so adding a block anywhere numbers
      // correctly without touching this line.
      const shifted = i + 1 + shiftFor(i);
      K.footerStrip(
        chrome,
        [input.referenceNumber, `Page ${shifted} of ${totalPages}`],
        [shortName, input.firearmLine ?? '', input.licenceTypeLabel],
        L.edgeBar ? EDGE_BAR_W : 0,
      );

      doc.page.margins.bottom = keep;
      doc.page.margins.top = keepTop;
    }

    doc.end();
    const body = await done;

    // The PDF annexures, printed into the pack rather than listed as missing.
    // ⚠️ BLOCKS, NOT ONE POSITION. Reprinted annexures go in front of the
    // take-with-you sheets; anything else — the C.I.P. datasheet belongs
    // beside the firearm section — goes at its own index. The merge inserts
    // back-to-front so the indices stay valid, and the footer pass below
    // already accounts for every block.
    // The datasheet is its own block at its own index — see PdfBlock. It has
    // no annexure letter, which is what makes it read as body content.
    const cipLoaded = input.cipSheet
      ? await loadPdfAnnexures([
          {
            letter: '',
            label: input.cipSheet.label,
            index: 1,
            total: 1,
            bytes: input.cipSheet.bytes,
          },
        ])
      : null;
    const pdfBlocks = [
      {
        items: merged.loaded,
        insertAt: takeWithYouAt === null ? undefined : takeWithYouAt - 1,
      },
      ...(cipLoaded?.loaded.length
        ? [{ items: cipLoaded.loaded, insertAt: cipInsertAt ?? undefined }]
        : []),
    ];
    const pdf = await appendPdfAnnexures(body, pdfBlocks, {
      referenceNumber: input.referenceNumber,
      templateVersion: input.templateVersion,
      bodyPageCount: range.count,
      // 0-based: the take-with-you sheets step aside for these.
    });
    return { pdf, filename: `motivation-${input.referenceNumber}.pdf` };
  }
}
