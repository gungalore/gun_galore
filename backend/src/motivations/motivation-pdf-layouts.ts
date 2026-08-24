// ────────────────────────────────────────────────────────────────────
// FIVE WAYS TO SET THE SAME DOCUMENT.
//
// Operator, item 11 of twelve, 2026-08-24: "we need more than just one style
// of document, we need at least 5 styles that looks vastly different from each
// other but still have all the same information in. each style can be chosen
// in the color we already offer."
//
// ⚠️ THIS IS NOT THE OLD FORMAT AXIS COMING BACK. `concise` and `standard`
// were retired on 2026-08-21 — "get rid of the concise and standard templates.
// Only comprehensive stays" — and they varied the CONTENT: which sections were
// written, how long the document ran. That question is settled and stays
// settled. This axis varies only the SETTING: the cover, the section headings,
// the running furniture and the body face. Every layout carries every section.
// A member choosing one is choosing how their pack looks, never how much of a
// case it makes.
//
// ⚠️ AND IT IS ORTHOGONAL TO COLOUR. Ten schemes times five layouts is fifty
// combinations, and none of them is a special case: a layout says WHERE the
// ink goes and the scheme says WHICH ink. A layout that hard-coded a colour
// would be right in one scheme and wrong in nine.
// ────────────────────────────────────────────────────────────────────

export type TemplateLayout =
  | 'banner'
  | 'plate'
  | 'rule'
  | 'ledger'
  | 'classic';

/** How the first page announces the document. */
export type CoverStyle = TemplateLayout;

/** How a section announces itself in the body. */
export type HeadingStyle =
  /** Numbered node and a filled band. The original. */
  | 'band'
  /** Centred small caps over a hairline that runs the column. */
  | 'underline'
  /** A large numeral hanging in the margin, title set beside it. */
  | 'numeral'
  /** A short heavy bar, then the title on the same line. */
  | 'bar'
  /** Letterspaced small caps, generous air, no rule and no fill. */
  | 'caps';

export interface LayoutSpec {
  key: TemplateLayout;
  /** What the picker calls it. */
  name: string;
  /** One line, describing the LOOK and never the strength of the case. */
  blurb: string;
  cover: CoverStyle;
  heading: HeadingStyle;
  /**
   * The body face.
   *
   * ⚠️ THE SERIF IS THE DEFAULT FOR A REASON — long prose read off paper by
   * somebody working through a pile of applications. A sans body is offered
   * once, for the layout whose whole character is that it looks like a report
   * rather than a letter.
   */
  bodyFace: 'serif' | 'sans';
  /** The hanging hairline down the left of a section's body. */
  hangingRule: boolean;
  /**
   * The 16 mm gradient banner across the top of every body page.
   *
   * Off for the quieter layouts, where the running head moves into the footer
   * instead — which is why the footer already carries the reference and the
   * applicant on every page.
   */
  runningBanner: boolean;
  /**
   * A colour bar down the left edge of every page.
   *
   * ⚠️ LEDGER'S BLURB HAS PROMISED THIS SINCE THE AXIS SHIPPED and nothing
   * drew it. 9 mm wide, which is inside the 14 mm side margin, so turning it
   * on moves no text anywhere — see EDGE_BAR_W.
   */
  edgeBar: boolean;
}

export const LAYOUTS: Record<TemplateLayout, LayoutSpec> = {
  banner: {
    key: 'banner',
    name: 'Banner',
    blurb:
      'A deep colour banner across the cover and the top of every page, with numbered section tabs.',
    cover: 'banner',
    heading: 'band',
    bodyFace: 'serif',
    hangingRule: true,
    runningBanner: true,
    edgeBar: false,
  },
  plate: {
    key: 'plate',
    name: 'Plate',
    blurb:
      'A centred title plate on a tinted field, and section titles centred over a full-width rule.',
    cover: 'plate',
    heading: 'underline',
    bodyFace: 'serif',
    hangingRule: false,
    runningBanner: false,
    edgeBar: false,
  },
  rule: {
    key: 'rule',
    name: 'Report',
    blurb:
      'Set like a report: a single heavy rule under the title, large section numerals in the margin, sans-serif throughout.',
    cover: 'rule',
    heading: 'numeral',
    bodyFace: 'sans',
    hangingRule: false,
    runningBanner: false,
    edgeBar: false,
  },
  ledger: {
    key: 'ledger',
    name: 'Ledger',
    blurb:
      'A colour bar down the edge of every page, with section titles behind a short heavy mark.',
    cover: 'ledger',
    heading: 'bar',
    bodyFace: 'serif',
    hangingRule: true,
    runningBanner: false,
    edgeBar: true,
  },
  classic: {
    key: 'classic',
    name: 'Classic',
    blurb:
      'Plain and formal, in the manner of a letter to an official: centred title, letterspaced headings, no colour blocks.',
    cover: 'classic',
    heading: 'caps',
    bodyFace: 'serif',
    hangingRule: false,
    runningBanner: false,
    edgeBar: false,
  },
};

export const LAYOUT_KEYS = Object.keys(LAYOUTS) as TemplateLayout[];

/**
 * The one an applicant gets if they never choose.
 *
 * The existing document, so nobody's pack changes shape because a new axis was
 * added underneath them.
 */
export const DEFAULT_LAYOUT: TemplateLayout = 'banner';

/**
 * Validate a value arriving from a client or read back off the row.
 *
 * ⚠️ FALLS BACK RATHER THAN THROWS, for the same reason asScheme does: the
 * column is a plain VarChar so a stale client, a hand-edited row or a layout
 * retired in a later deploy must degrade to the default. A download that 500s
 * because somebody's stored preference no longer exists is the worst possible
 * failure for a document they have already paid for.
 */
export function asLayout(v: unknown): TemplateLayout {
  return typeof v === 'string' && v in LAYOUTS
    ? (v as TemplateLayout)
    : DEFAULT_LAYOUT;
}
