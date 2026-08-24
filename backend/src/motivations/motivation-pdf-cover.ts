import * as K from './motivation-pdf-chrome';
import type { CoverStyle } from './motivation-pdf-layouts';

// ────────────────────────────────────────────────────────────────────
// THE COVER, FIVE WAYS — AND UNTIL NOW, ONE WAY FIVE TIMES.
//
// `LayoutSpec.cover` has existed since the layout axis was added and NOTHING
// EVER READ IT. The renderer drew the same 80 mm gradient masthead whichever
// layout was chosen, so Banner, Plate, Report, Ledger and Classic opened on a
// byte-identical page — proven by rasterising all five and hashing them: one
// checksum, five files. The picker meanwhile advertised "a centred title plate
// on a tinted field" and "sans-serif throughout" to members who would receive
// neither.
//
// ⚠️ SO THE BLURBS ARE THE SPECIFICATION HERE, not decoration. Each function
// below is named for the promise it has to keep, and if a blurb changes this
// file changes with it. A style axis whose options look the same is worse than
// no style axis: it asks somebody to choose and then ignores the answer.
//
// ⚠️ WHAT NEVER VARIES IS THE INFORMATION. Every cover carries the reference,
// the wordmark, what the application is for and the licence type, and every
// one hands the dossier grid back to the renderer unchanged. A cover style
// decides where the ink goes; it may not decide what a DFO gets told.
// ────────────────────────────────────────────────────────────────────

const TITLE = 'MOTIVATION';
const SUBTITLE = 'APPLICATION FOR A FIREARM LICENCE';

/**
 * The vertical brand bar Ledger runs down every page.
 *
 * ⚠️ 9 mm, WHICH IS NARROWER THAN THE 14 mm SIDE MARGIN ON PURPOSE. Drawing it
 * any wider would mean reflowing the entire document — every page's text box,
 * every table, the footer strip — for one decorative rule. At 9 mm it sits
 * entirely inside the existing margin and no measurement anywhere else moves.
 */
export const EDGE_BAR_W = K.mm(9);

export function edgeBar({ doc, c }: K.Chrome): void {
  doc.rect(0, 0, EDGE_BAR_W, K.PAGE_H).fill(c.deep);
}

/** Reference line, in the small caps every cover opens with. */
function reference(
  { doc, f }: K.Chrome,
  text: string,
  x: number,
  y: number,
  opts: { width: number; align: 'left' | 'center' | 'right'; colour: string },
): void {
  const size = K.px(9.5);
  doc
    .font(f.sansSemi)
    .fontSize(size)
    .fillColor(opts.colour)
    .text(`REFERENCE ${text}`.toUpperCase(), x, y, {
      width: opts.width,
      align: opts.align,
      characterSpacing: size * 0.3,
      lineBreak: false,
    });
}

/**
 * Place the lockup or the monogram at a given height.
 *
 * Returns the width it occupied, or 0 — a missing asset must cost the cover
 * its mark and nothing else, exactly as the footer's does.
 */
function placeMark(
  { doc }: K.Chrome,
  opts: {
    monogram?: boolean;
    light?: boolean;
    x: number;
    y: number;
    height: number;
    /** Centre the mark inside a box of this width, starting at x. */
    centreIn?: number;
  },
): number {
  const mark = K.brandMark({ monogram: opts.monogram, light: opts.light });
  if (!mark) return 0;
  const w = opts.height * mark.aspect;
  const x = opts.centreIn ? opts.x + (opts.centreIn - w) / 2 : opts.x;
  try {
    doc.image(mark.path, x, opts.y, { height: opts.height });
    return w;
  } catch {
    return 0;
  }
}

export interface CoverInput {
  referenceNumber: string;
  licenceTypeLabel: string;
}

/**
 * Draw the masthead in the given style.
 *
 * @returns the y at which the rest of the cover — the photograph frame and the
 *   dossier grid — resumes. Every style returns one, so the shared blocks below
 *   it need to know nothing about which was drawn.
 */
export function coverMasthead(
  chrome: K.Chrome,
  style: CoverStyle,
  input: CoverInput,
): number {
  switch (style) {
    case 'plate':
      return plateCover(chrome, input);
    case 'rule':
      return reportCover(chrome, input);
    case 'ledger':
      return ledgerCover(chrome, input);
    case 'classic':
      return classicCover(chrome, input);
    case 'banner':
    default:
      return bannerCover(chrome, input);
  }
}

// ── 1. Banner ───────────────────────────────────────────────────────
//
// "A deep colour banner across the cover and the top of every page."
//
// The original, rebranded: the mark is knocked out white in the field rather
// than absent, the wordmark is set once at a sane tracking instead of twice
// (it was space-joined AND letterspaced, which is why it ran the full width of
// the page), and the rule under it is an accent rather than another white line.
function bannerCover(chrome: K.Chrome, input: CoverInput): number {
  const { doc, c, f } = chrome;
  const g = doc.linearGradient(0, 0, K.PAGE_W, K.COVER_BANNER_H);
  g.stop(0, c.deep).stop(0.6, c.deep2).stop(1, c.deep2);
  doc.rect(0, 0, K.PAGE_W, K.COVER_BANNER_H).fill(g);

  placeMark(chrome, {
    light: true,
    x: K.PAD_X,
    y: K.mm(11),
    height: K.mm(13),
  });
  reference(chrome, input.referenceNumber, K.PAD_X, K.mm(15), {
    width: K.CONTENT_W,
    align: 'right',
    colour: '#ffffff',
  });

  let cy = K.mm(34);
  const size = K.px(37);
  doc
    .font(f.sansBold)
    .fontSize(size)
    .fillColor('#ffffff')
    .text(TITLE, 0, cy, {
      width: K.PAGE_W,
      align: 'center',
      characterSpacing: size * 0.11,
      lineBreak: false,
    });

  cy += K.mm(15);
  accentRule(chrome, K.PAGE_W / 2 - K.mm(19), cy, K.mm(38), K.px(3));

  cy += K.mm(6);
  const sub = K.px(11);
  doc.font(f.sansSemi).fontSize(sub);
  const boxW =
    doc.widthOfString(SUBTITLE, { characterSpacing: sub * 0.3 }) + K.mm(14);
  const boxH = sub * 1.2 + K.px(16);
  doc
    .rect((K.PAGE_W - boxW) / 2, cy, boxW, boxH)
    .lineWidth(0.8)
    .strokeOpacity(0.55)
    .strokeColor('#ffffff')
    .stroke()
    .strokeOpacity(1);
  doc.fillColor('#ffffff').text(SUBTITLE, 0, cy + K.px(8), {
    width: K.PAGE_W,
    align: 'center',
    characterSpacing: sub * 0.3,
    lineBreak: false,
  });

  cy += boxH + K.mm(6);
  sectionLine(chrome, input.licenceTypeLabel, 0, cy, {
    width: K.PAGE_W,
    align: 'center',
    colour: '#ffffff',
    opacity: 0.82,
  });

  return K.COVER_BANNER_H + K.mm(12);
}

// ── 2. Plate ────────────────────────────────────────────────────────
//
// "A centred title plate on a tinted field."
//
// No flood fill anywhere: the page is white paper with one bordered plate on
// it. The mark sits above the plate in its full black lockup, which is what a
// letterhead does and what the deep banner made impossible.
function plateCover(chrome: K.Chrome, input: CoverInput): number {
  const { doc, c, f } = chrome;

  placeMark(chrome, {
    x: K.PAD_X,
    y: K.mm(16),
    height: K.mm(15),
    centreIn: K.CONTENT_W,
  });

  // ⚠️ TIGHTER THAN IT WAS DRAWN. The plate first sat at 42 mm and stood
  // 56 mm tall, which put the resume-y at 118 mm against Banner's 92 mm — and
  // on a cover carrying a photograph that 26 mm was the difference between a
  // dossier that fits and one that does not. The grid below is guarded now, so
  // this is no longer a correctness matter, but a cover that pushes its own
  // dossier overleaf for decoration is still the wrong trade.
  const plateX = K.PAD_X + K.mm(14);
  const plateW = K.CONTENT_W - K.mm(28);
  const plateY = K.mm(34);
  const plateH = K.mm(52);

  doc.rect(plateX, plateY, plateW, plateH).fill(c.wash);
  doc
    .rect(plateX, plateY, plateW, plateH)
    .lineWidth(1.2)
    .strokeColor(c.deep)
    .stroke();
  // The inset hairline is what makes it read as a plate rather than a box.
  doc
    .rect(plateX + K.mm(2), plateY + K.mm(2), plateW - K.mm(4), plateH - K.mm(4))
    .lineWidth(0.4)
    .strokeColor(c.hair)
    .stroke();

  let cy = plateY + K.mm(11);
  reference(chrome, input.referenceNumber, plateX, cy, {
    width: plateW,
    align: 'center',
    colour: c.mut,
  });

  cy += K.mm(9);
  const size = K.px(28);
  doc
    .font(f.sansBold)
    .fontSize(size)
    .fillColor(c.deep2)
    .text(TITLE, plateX, cy, {
      width: plateW,
      align: 'center',
      characterSpacing: size * 0.14,
      lineBreak: false,
    });

  cy += K.mm(12);
  accentRule(chrome, plateX + (plateW - K.mm(24)) / 2, cy, K.mm(24), K.px(2.5));

  cy += K.mm(5);
  const sub = K.px(10);
  doc
    .font(f.sansSemi)
    .fontSize(sub)
    .fillColor(c.sub)
    .text(SUBTITLE, plateX, cy, {
      width: plateW,
      align: 'center',
      characterSpacing: sub * 0.3,
      lineBreak: false,
    });

  sectionLine(
    chrome,
    input.licenceTypeLabel,
    K.PAD_X,
    plateY + plateH + K.mm(7),
    { width: K.CONTENT_W, align: 'center', colour: c.mut },
  );

  return plateY + plateH + K.mm(14);
}

// ── 3. Report ───────────────────────────────────────────────────────
//
// "Set like a report: a single heavy rule under the title."
//
// Everything flush left, nothing centred, one heavy rule running the full
// column. The only cover with no field, no plate and no bar — its whole
// character is the type and that rule.
function reportCover(chrome: K.Chrome, input: CoverInput): number {
  const { doc, c, f } = chrome;

  placeMark(chrome, { x: K.PAD_X, y: K.mm(16), height: K.mm(12) });
  reference(chrome, input.referenceNumber, K.PAD_X, K.mm(20), {
    width: K.CONTENT_W,
    align: 'right',
    colour: c.mut,
  });

  doc
    .moveTo(K.PAD_X, K.mm(34))
    .lineTo(K.PAD_X + K.CONTENT_W, K.mm(34))
    .lineWidth(0.6)
    .strokeColor(c.hair)
    .stroke();

  const size = K.px(46);
  doc
    .font(f.sansBold)
    .fontSize(size)
    .fillColor(c.ink)
    // ⚠️ NEGATIVE TRACKING, WHICH IS THE OPPOSITE OF EVERY OTHER COVER HERE.
    // A grotesque at 46 pt needs the letters pulled together to read as one
    // word — the same rule globals.css applies to the site's own h1.
    .text(TITLE, K.PAD_X, K.mm(42), {
      width: K.CONTENT_W,
      align: 'left',
      characterSpacing: size * -0.02,
      lineBreak: false,
    });

  accentRule(chrome, K.PAD_X, K.mm(62), K.CONTENT_W, K.px(4));

  const sub = K.px(11);
  doc
    .font(f.sansSemi)
    .fontSize(sub)
    .fillColor(c.sub)
    .text(SUBTITLE, K.PAD_X, K.mm(67), {
      width: K.CONTENT_W,
      align: 'left',
      characterSpacing: sub * 0.28,
      lineBreak: false,
    });

  sectionLine(chrome, input.licenceTypeLabel, K.PAD_X, K.mm(74), {
    width: K.CONTENT_W,
    align: 'left',
    colour: c.mut,
  });

  return K.mm(90);
}

// ── 4. Ledger ───────────────────────────────────────────────────────
//
// "A colour bar down the edge of every page."
//
// The bar is drawn on every page in the buffered pass; here it carries the
// monogram at the top of the cover. The title sits against it, flush left,
// with a short heavy mark beneath — the same short mark the Ledger heading
// style puts in front of every section title.
function ledgerCover(chrome: K.Chrome, input: CoverInput): number {
  const { doc, c, f } = chrome;
  edgeBar(chrome);

  // Inside the 9 mm bar, with 0.9 mm of air either side.
  //
  // ⚠️ SIZED FROM THE WIDTH, NOT THE HEIGHT. The bar constrains one axis and
  // the monogram is wider than it is tall, so asking for a height and hoping
  // is how a mark ends up touching both edges. 7.2 mm wide divided by the
  // mark's own aspect is the tallest it can be and still clear the bar.
  placeMark(chrome, {
    monogram: true,
    light: true,
    x: K.mm(0.9),
    y: K.mm(11),
    height: K.mm(7.2) / K.MARK_ASPECT,
    centreIn: EDGE_BAR_W - K.mm(1.8),
  });

  reference(chrome, input.referenceNumber, K.PAD_X, K.mm(24), {
    width: K.CONTENT_W,
    align: 'left',
    colour: c.mut,
  });

  const size = K.px(38);
  doc
    .font(f.sansBold)
    .fontSize(size)
    .fillColor(c.ink)
    .text(TITLE, K.PAD_X, K.mm(31), {
      width: K.CONTENT_W,
      align: 'left',
      characterSpacing: size * 0.04,
      lineBreak: false,
    });

  accentRule(chrome, K.PAD_X, K.mm(48), K.mm(22), K.px(4.5));

  const sub = K.px(11);
  doc
    .font(f.sansSemi)
    .fontSize(sub)
    .fillColor(c.sub)
    .text(SUBTITLE, K.PAD_X, K.mm(53), {
      width: K.CONTENT_W,
      align: 'left',
      characterSpacing: sub * 0.28,
      lineBreak: false,
    });

  sectionLine(chrome, input.licenceTypeLabel, K.PAD_X, K.mm(60), {
    width: K.CONTENT_W,
    align: 'left',
    colour: c.mut,
  });

  return K.mm(76);
}

// ── 5. Classic ──────────────────────────────────────────────────────
//
// "Plain and formal, in the manner of a letter to an official."
//
// No fill, no plate, no bar, and the ONLY cover where the wordmark is not set
// bold: wide-letterspaced regular between two double rules is the engraved
// look, and setting it heavy would make it shout in the one style whose point
// is that it does not.
function classicCover(chrome: K.Chrome, input: CoverInput): number {
  const { doc, c, f } = chrome;

  placeMark(chrome, {
    x: K.PAD_X,
    y: K.mm(18),
    height: K.mm(14),
    centreIn: K.CONTENT_W,
  });

  doubleRule(chrome, K.mm(40));

  const size = K.px(25);
  doc
    .font(f.sans)
    .fontSize(size)
    .fillColor(c.ink)
    .text(TITLE, 0, K.mm(46), {
      width: K.PAGE_W,
      align: 'center',
      characterSpacing: size * 0.42,
      lineBreak: false,
    });

  const sub = K.px(10.5);
  doc
    .font(f.sansSemi)
    .fontSize(sub)
    .fillColor(c.sub)
    .text(SUBTITLE, 0, K.mm(58), {
      width: K.PAGE_W,
      align: 'center',
      characterSpacing: sub * 0.32,
      lineBreak: false,
    });

  doubleRule(chrome, K.mm(66));

  reference(chrome, input.referenceNumber, 0, K.mm(72), {
    width: K.PAGE_W,
    align: 'center',
    colour: c.mut,
  });
  sectionLine(chrome, input.licenceTypeLabel, 0, K.mm(78), {
    width: K.PAGE_W,
    align: 'center',
    colour: c.mut,
  });

  return K.mm(94);
}

// ── shared marks ────────────────────────────────────────────────────

/**
 * The accent rule under a title.
 *
 * ⚠️ THE SCHEME'S ACCENT, NOT THE BRAND RED FLAT. On the All Outdoor scheme
 * they are the same value and the rule is unmistakably ours; on the ten muted
 * colourways a flat #E01B24 would fight a mauve or an olive page, and a member
 * who chose Sage did not choose a red document. The brand stays constant where
 * it belongs — in the mark itself, which is on every page.
 */
function accentRule(
  { doc, c }: K.Chrome,
  x: number,
  y: number,
  w: number,
  weight: number,
): void {
  doc.rect(x, y, w, weight).fill(c.accent);
}

function doubleRule({ doc, c }: K.Chrome, y: number): void {
  doc
    .moveTo(K.PAD_X, y)
    .lineTo(K.PAD_X + K.CONTENT_W, y)
    .lineWidth(1)
    .strokeColor(c.ink)
    .stroke();
  doc
    .moveTo(K.PAD_X, y + K.mm(1.4))
    .lineTo(K.PAD_X + K.CONTENT_W, y + K.mm(1.4))
    .lineWidth(0.4)
    .strokeColor(c.ink)
    .stroke();
}

function sectionLine(
  { doc, f }: K.Chrome,
  text: string,
  x: number,
  y: number,
  opts: {
    width: number;
    align: 'left' | 'center' | 'right';
    colour: string;
    opacity?: number;
  },
): void {
  const size = K.px(10);
  doc
    .font(f.sansSemi)
    .fontSize(size)
    .fillColor(opts.colour)
    .fillOpacity(opts.opacity ?? 1)
    .text(text.toUpperCase(), x, y, {
      width: opts.width,
      align: opts.align,
      characterSpacing: size * 0.28,
      lineBreak: false,
    })
    .fillOpacity(1);
}
