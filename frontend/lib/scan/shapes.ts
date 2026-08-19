// ────────────────────────────────────────────────────────────────────
// THE DOCUMENTS PEOPLE ACTUALLY PHOTOGRAPH, AT THEIR REAL SIZES.
//
// Every millimetre here was measured off the operator's own photographs
// against a 150 mm ruler lying on the same surface as the document — not
// taken from a specification and hoped for. Where a measurement agreed with
// a published format, the format is named; where it did not, the measurement
// won.
//
// The sizes are load-bearing in three places:
//
//   1. THE AIM BOX. The member is shown a frame of the right shape and asked
//      to fit the document into it. A frame at the wrong aspect teaches them
//      to hold the phone wrong, and they will trust it over their own eyes.
//   2. THE DETECTOR'S PRIOR. The same box tells the detector where the
//      document is expected to be. On the operator's own IMG_4947 the
//      detector picked the fabric and the ruler instead of the licence card
//      sitting in the corner of the frame — a stronger rectangle beats the
//      right one, every time, unless something says where to look.
//   3. HOW FAR TO HOLD THE PHONE. Derived, not guessed: see `holdHint`.
//
// ⚠️ ASPECTS ARE STORED AS MILLIMETRES, NOT RATIOS. Ratios are where the
// portrait/landscape mix-ups live. Anything that needs a ratio derives it
// here, once.
// ────────────────────────────────────────────────────────────────────

export type DocShape = 'card' | 'a4' | 'id-book' | 'any';

export interface ShapeSpec {
  key: DocShape;
  /** On the chooser button. */
  label: string;
  /** The documents this covers, in the member's words. */
  examples: string;
  /** Long edge in millimetres, or null when there is no fixed size. */
  longMm: number | null;
  /** Short edge in millimetres. */
  shortMm: number | null;
  /** Is the document usually held with its long edge upright? */
  portrait: boolean;
  /** Can there sensibly be more than one page or side? */
  multi: boolean;
  /**
   * What "more than one" means for this document.
   *
   * ⚠️ IT MEANS OTHER DOCUMENTS TOO, not just more pages of this one. A
   * motivation pack is a competency certificate AND a licence card AND a
   * page of an ID book, and the operator asked for one session to cover the
   * lot. Wording it as "pages" made it read like a per-document setting.
   */
  multiLabel: string;
}

export const SHAPES: Record<DocShape, ShapeSpec> = {
  card: {
    key: 'card',
    label: 'Card',
    examples: 'Firearm licence card, competency card, card ID',
    // ISO/IEC 7810 ID-1. MEASURED: 85.6 x 54.7 mm against the ruler in the
    // operator's IMG_4947, with both card and ruler flat on the same table —
    // which is the only way that measurement means anything.
    longMm: 85.6,
    shortMm: 54,
    portrait: false,
    multi: true,
    multiLabel: 'More than one — front and back, or other documents',
  },
  a4: {
    key: 'a4',
    label: 'A4 page',
    examples: 'Competency certificate, temporary authorisation, a letter',
    longMm: 297,
    shortMm: 210,
    portrait: true,
    multi: true,
    multiLabel: 'More than one — more pages, or other documents',
  },
  'id-book': {
    key: 'id-book',
    label: 'Green ID book',
    examples: 'Open at the page with your photograph',
    // The passport format (ID-3), 125 x 88 mm. MEASURED off IMG_4961 at a
    // width-to-height of about 0.72 once the tilt is allowed for, which is
    // the same page within the error of measuring a curved page held in a
    // hand. ⚠️ NEARLY THE SAME SHAPE AS A4 — 0.704 against 0.707 — so the two
    // aim boxes look alike on purpose. What separates them is the label and
    // what the member is told to open.
    longMm: 125,
    shortMm: 88,
    portrait: true,
    multi: true,
    multiLabel: 'More than one — more pages, or other documents',
  },
  any: {
    key: 'any',
    label: 'Something else',
    examples: 'A safe, a permit, anything without a standard size',
    longMm: null,
    shortMm: null,
    portrait: true,
    multi: true,
    multiLabel: 'More than one — more photos, or other documents',
  },
};

/** In the order they are offered. */
export const SHAPE_ORDER: DocShape[] = ['card', 'a4', 'id-book', 'any'];

/** Width / height of the aim box, or null when the shape is unknown. */
export function guideAspect(shape: DocShape): number | null {
  const s = SHAPES[shape];
  if (s.longMm === null || s.shortMm === null) return null;
  return s.portrait ? s.shortMm / s.longMm : s.longMm / s.shortMm;
}

/** Long edge over short edge — what the detector is told to prefer. */
export function expectAspect(shape: DocShape): number | undefined {
  const s = SHAPES[shape];
  if (s.longMm === null || s.shortMm === null) return undefined;
  return s.longMm / s.shortMm;
}

/**
 * Roughly how far to hold the phone, in centimetres.
 *
 * ⚠️ DERIVED FROM A REAL MEASUREMENT, and bounded by one. The operator
 * photographed a licence card from exactly 158 mm and it filled about 15% of
 * the frame's area, which fixes the scale: distance is about 1.85x the
 * document's width for a full frame. But no phone focuses below roughly
 * 100 mm, so the card is clamped there — telling somebody to hold a card 7 cm
 * away would be telling them to take a blurred photograph.
 */
export function holdHint(shape: DocShape): string | null {
  const s = SHAPES[shape];
  if (s.shortMm === null || s.longMm === null) return null;
  const acrossMm = s.portrait ? s.shortMm : s.longMm;
  const mm = Math.max(110, acrossMm * 1.85);
  return `about ${Math.round(mm / 10)} cm away`;
}

/**
 * The shape a document kind is usually printed on.
 *
 * Used to preselect the chooser when the scanner is opened FOR a particular
 * document. A wrong guess costs one tap; no guess costs the member a think.
 */
export function shapeForKind(kind: string): DocShape {
  const k = (kind ?? '').toUpperCase();
  if (k.includes('IDENTITY') || k.includes('ID_DOCUMENT')) return 'id-book';
  if (
    k.includes('FIREARM_LICENCE') ||
    k.includes('CURRENT_LICENCE') ||
    k.includes('ASSOCIATION_CARD') ||
    k.includes('DEDICATED') ||
    k.includes('PROFESSIONAL_HUNTER')
  ) {
    return 'card';
  }
  if (
    // ⚠️ COMPETENCY COMES BOTH WAYS. SAPS has issued competency as an A4
    // certificate and as an ID-1 card, and members hold whichever they were
    // given. A4 is the preselection because the certificate is the one people
    // photograph badly; the chooser is right there, and detection never
    // depended on the answer.
    k.includes('COMPETENCY') ||
    k.includes('PROFICIENCY') ||
    k.includes('ADDRESS') ||
    k.includes('MOTIVATION') ||
    k.includes('REPORT') ||
    k.includes('REFERENCE') ||
    k.includes('STATEMENT') ||
    k.includes('TEMPORARY')
  ) {
    return 'a4';
  }
  return 'any';
}
