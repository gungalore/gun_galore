// ────────────────────────────────────────────────────────────────────
// THE VISUAL HALF OF THE ANTI-TEMPLATE WORK.
//
// motivation-structure.ts already varies what the document SAYS and in what
// order. This varies what it LOOKS LIKE, because the two failure modes are
// different: a reviewer who reads two documents notices the same argument in
// the same order, but a reviewer with a stack of paper on a desk notices the
// same TYPEFACE first, without reading anything at all.
//
// Operator, 2026-08-18: at least 10 colours, 10 fonts, 3 line spacings and 5
// formats, mixed and matched. This carries 11 embedded families plus the two
// standard ones (13), 10 palettes, 4 leadings and 6 formats — every axis at or
// above the floor.
//
// EVERY FACE READS AS AN ORDINARY BUSINESS DOCUMENT. That constraint does more
// work than the count does. A motivation set in something distinctive stands
// out exactly as badly as one that is obviously mass-produced — both make the
// document memorable as an ARTEFACT rather than as an argument. Several of
// these are metric-compatible substitutes for the fonts people genuinely have
// in Word, so the output looks like what it claims to be: a document somebody
// typed at home.
//
// COLOUR IS NEARLY ABSENT, ON PURPOSE. The body is always near-black. A palette
// moves the heading and the hairline rule only, and every one of them is a dark,
// sober ink. There is no bright colour here and there must never be: this is a
// document handed to the Registrar, not a brochure.
//
// DETERMINISTIC FROM THE SEED. Motivation.variantSeed is stored, so the same
// document re-rendered next year comes out identical — the same rule the rest of
// the pipeline follows. Each axis is drawn from an INDEPENDENTLY MIXED seed, not
// from `seed % n` on the same number, or the axes would move in lockstep and
// choosing 13 fonts would only ever produce 13 documents.
//
// PURE — no Nest, no Prisma, no filesystem, no clock. It decides; the PDF
// service applies. That is what makes 2,000-odd combinations testable.
// ────────────────────────────────────────────────────────────────────

/** A font the document can be set in. */
export interface StyleFont {
  key: string;
  /** Display name, for the audit trail. */
  name: string;
  /**
   * File stem in assets/fonts, or null for one of pdfkit's built-in faces,
   * which need no file and no path resolution at all.
   */
  file: string | null;
  builtin?: { regular: string; bold: string; italic: string };
  serif: boolean;
}

/**
 * Thirteen faces: eleven vendored plus the two standard families pdfkit reads
 * from its own metrics. Courier is deliberately absent — a monospaced
 * motivation looks like a printout, not a letter.
 */
export const STYLE_FONTS: readonly StyleFont[] = [
  { key: 'carlito', name: 'Carlito', file: 'Carlito', serif: false },
  { key: 'caladea', name: 'Caladea', file: 'Caladea', serif: true },
  { key: 'ptserif', name: 'PT Serif', file: 'PT_Serif-Web', serif: true },
  { key: 'ptsans', name: 'PT Sans', file: 'PT_Sans-Web', serif: false },
  { key: 'lato', name: 'Lato', file: 'Lato', serif: false },
  { key: 'crimson', name: 'Crimson Text', file: 'CrimsonText', serif: true },
  { key: 'spectral', name: 'Spectral', file: 'Spectral', serif: true },
  { key: 'cardo', name: 'Cardo', file: 'Cardo', serif: true },
  { key: 'gentium', name: 'Gentium Plus', file: 'GentiumPlus', serif: true },
  { key: 'neuton', name: 'Neuton', file: 'Neuton', serif: true },
  { key: 'oldstandard', name: 'Old Standard', file: 'OldStandard', serif: true },
  {
    key: 'times',
    name: 'Times',
    file: null,
    builtin: { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic' },
    serif: true,
  },
  {
    key: 'helvetica',
    name: 'Helvetica',
    file: null,
    builtin: {
      regular: 'Helvetica',
      bold: 'Helvetica-Bold',
      italic: 'Helvetica-Oblique',
    },
    serif: false,
  },
];

export interface StylePalette {
  key: string;
  /** Headings. Always a dark ink — never a brand colour, never bright. */
  heading: string;
  /** Body text. Near-black in every palette; the variation is barely there. */
  body: string;
  /** Hairline rules and the footer. */
  rule: string;
  /** Secondary text — the subtitle line and the disclaimer. */
  muted: string;
}

/**
 * Ten palettes, all of them sober.
 *
 * The widest gap between any two of these is the difference between black ink
 * and dark blue ink — which is exactly the range you would find across a stack
 * of documents typed by different people, and no wider.
 */
export const STYLE_PALETTES: readonly StylePalette[] = [
  { key: 'ink', heading: '#111111', body: '#111111', rule: '#999999', muted: '#555555' },
  { key: 'navy', heading: '#1B2A41', body: '#14181F', rule: '#8B93A1', muted: '#4A5468' },
  { key: 'charcoal', heading: '#2B2B2B', body: '#1A1A1A', rule: '#A0A0A0', muted: '#5C5C5C' },
  { key: 'forest', heading: '#1E3A2F', body: '#15201B', rule: '#8FA398', muted: '#4A5D53' },
  { key: 'burgundy', heading: '#4A1F27', body: '#1C1416', rule: '#A38E92', muted: '#6B4A51' },
  { key: 'slate', heading: '#25313B', body: '#161C22', rule: '#93A1AB', muted: '#4E5D69' },
  { key: 'sepia', heading: '#3B2C1E', body: '#1F1811', rule: '#A8938A', muted: '#5F4C39' },
  { key: 'indigo', heading: '#232145', body: '#15141F', rule: '#918FA8', muted: '#4C4A6B' },
  { key: 'graphite', heading: '#1F2223', body: '#121415', rule: '#969A9C', muted: '#4F5455' },
  { key: 'teal', heading: '#123A3D', body: '#0F1E1F', rule: '#8AA3A5', muted: '#3F6467' },
];

export interface StyleLeading {
  key: string;
  /** Extra gap between lines, in points. pdfkit calls this lineGap. */
  lineGap: number;
  /** Body size in points. Moves with the leading so the page stays balanced. */
  bodySize: number;
}

/** Four spacings, from a tight page to an airy one. */
export const STYLE_LEADINGS: readonly StyleLeading[] = [
  { key: 'tight', lineGap: 3, bodySize: 11 },
  { key: 'normal', lineGap: 5, bodySize: 11.5 },
  { key: 'relaxed', lineGap: 7, bodySize: 11.5 },
  { key: 'airy', lineGap: 9, bodySize: 12 },
];

export interface StyleFormat {
  key: string;
  /** Page margin in points. 71pt ≈ 25 mm. */
  margin: number;
  titleAlign: 'left' | 'center';
  /** A hairline under the title block. */
  titleRule: boolean;
  headingStyle: 'bold' | 'bold-rule' | 'numbered' | 'caps';
  /** Justified prose, or left-ragged as a word processor leaves it. */
  justify: boolean;
  /** Separate paragraphs by a blank line, or by indenting the first line. */
  paragraphs: 'spaced' | 'indented';
}

/**
 * Six formats. Each is a coherent house style rather than a random pile of
 * switches — a document with numbered headings AND an indented first line reads
 * as a considered choice, where mixing every axis freely would eventually
 * produce something that looks wrong.
 */
export const STYLE_FORMATS: readonly StyleFormat[] = [
  {
    key: 'plain-letter',
    margin: 71,
    titleAlign: 'left',
    titleRule: false,
    headingStyle: 'bold',
    justify: false,
    paragraphs: 'spaced',
  },
  {
    key: 'formal-centred',
    margin: 71,
    titleAlign: 'center',
    titleRule: true,
    headingStyle: 'bold',
    justify: true,
    paragraphs: 'spaced',
  },
  {
    key: 'numbered-report',
    margin: 64,
    titleAlign: 'left',
    titleRule: true,
    headingStyle: 'numbered',
    justify: true,
    paragraphs: 'spaced',
  },
  {
    key: 'book-indent',
    margin: 79,
    titleAlign: 'center',
    titleRule: false,
    headingStyle: 'caps',
    justify: true,
    paragraphs: 'indented',
  },
  {
    key: 'ruled-heads',
    margin: 68,
    titleAlign: 'left',
    titleRule: false,
    headingStyle: 'bold-rule',
    justify: false,
    paragraphs: 'spaced',
  },
  {
    key: 'wide-margin',
    margin: 85,
    titleAlign: 'left',
    titleRule: true,
    headingStyle: 'bold',
    justify: false,
    paragraphs: 'indented',
  },
];

export interface MotivationStyle {
  font: StyleFont;
  palette: StylePalette;
  leading: StyleLeading;
  format: StyleFormat;
  /** For the audit trail — "cardo/navy/relaxed/numbered-report". */
  signature: string;
}

/**
 * Mix the seed for one axis.
 *
 * Without this every axis would be `seed % n` on the same number, so font,
 * palette, leading and format would advance together — thirteen documents, not
 * thousands. A cheap integer hash decorrelates them; it does not need to be
 * cryptographic, it needs to be stable forever, which is why it is written out
 * rather than pulled from a library that might change.
 */
function mix(seed: number, axis: number): number {
  let h = (seed >>> 0) ^ ((axis + 1) * 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const pick = <T>(xs: readonly T[], seed: number, axis: number): T =>
  xs[mix(seed, axis) % xs.length];

/**
 * The look of one document, decided once from its stored seed.
 *
 * 13 × 10 × 4 × 6 = 3,120 combinations, and the seed also drives the structural
 * plan, so two documents that happen to share a look will not share an order.
 */
export function styleFor(variantSeed: number): MotivationStyle {
  const font = pick(STYLE_FONTS, variantSeed, 0);
  const palette = pick(STYLE_PALETTES, variantSeed, 1);
  const leading = pick(STYLE_LEADINGS, variantSeed, 2);
  const format = pick(STYLE_FORMATS, variantSeed, 3);
  return {
    font,
    palette,
    leading,
    format,
    signature: `${font.key}/${palette.key}/${leading.key}/${format.key}`,
  };
}

/** Total distinct looks. Exported so a test fails if an axis is ever emptied. */
export const STYLE_COMBINATIONS =
  STYLE_FONTS.length *
  STYLE_PALETTES.length *
  STYLE_LEADINGS.length *
  STYLE_FORMATS.length;
