import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SchemeColours } from './motivation-pdf.service';
import type { HeadingStyle } from './motivation-pdf-layouts';

// ────────────────────────────────────────────────────────────────────
// THE PAGE FURNITURE — banner, footer strip, section headers, panels.
//
// Split out of motivation-pdf.service.ts when the document was restyled to the
// operator's design handoff (2026-08-21). The service decides WHAT goes on the
// page; this decides what every page looks like. Keeping them together would
// have meant a thousand-line render() where the argument and the chrome are
// interleaved and neither can be read.
//
// ⚠️ EVERY NUMBER HERE COMES FROM THE HANDOFF, and the handoff is in CSS px
// and mm. A4 is 210 x 297 mm; at 96 dpi that is 793.7 x 1122.5 px, and PDF
// points are 72 dpi. So:
//
//     mm -> pt   x 2.8346        (25.4 mm per inch, 72 pt per inch)
//     px -> pt   x 0.75          (96 px per inch, 72 pt per inch)
//
// Both helpers are below and everything is written in the handoff's own units,
// so a value can be checked against the reference without arithmetic. Writing
// the converted numbers into the source instead would have made every one of
// them unverifiable the moment the reference changed.
// ────────────────────────────────────────────────────────────────────

/** Millimetres to PDF points. */
export const mm = (n: number): number => n * 2.8346456693;
/** CSS pixels (96 dpi, as the handoff is authored) to PDF points. */
export const px = (n: number): number => n * 0.75;

export const PAGE_W = mm(210);
export const PAGE_H = mm(297);

/** Banner height: 16 mm on a body page, 80 mm on the cover. */
export const BANNER_H = mm(16);
export const COVER_BANNER_H = mm(80);
/** Footer strip. */
export const FOOTER_H = mm(10);
/** Body padding: 9 mm below the banner, 14 mm at the sides. */
export const PAD_TOP = mm(9);
export const PAD_X = mm(14);
/** The section body's hanging rule. */
export const SECTION_INDENT = mm(7);

export const CONTENT_W = PAGE_W - PAD_X * 2;
/** Where a body page's content starts and must stop. */
export const BODY_TOP = BANNER_H + PAD_TOP;
export const BODY_BOTTOM = PAGE_H - FOOTER_H - mm(6);

// ── type ────────────────────────────────────────────────────────────
export const BODY_SIZE = px(14.5);
/** 1.78 line-height in the handoff; pdfkit's lineGap is ADDITIONAL. */
export const BODY_LEADING = px(14.5) * 1.78 - px(14.5) * 1.15;
export const PARA_GAP = mm(4);

/**
 * Font names as registered on the document.
 *
 * ⚠️ THE FILES ARE RESOLVED DEFENSIVELY, and this is not paranoia. nest-cli.json
 * does not copy non-TS assets into dist/, which is why saps534.service.ts
 * already resolves its blank SAPS form from a candidate list rather than a
 * relative path — the same code works in `nest start` and 404s under pm2 from
 * dist/. Fonts have exactly that shape: registered once at render time, from
 * disk, in a process whose cwd is not the source tree.
 */
export const FONT = {
  sans: 'ao-archivo',
  sansSemi: 'ao-archivo-semi',
  sansBold: 'ao-archivo-bold',
  serif: 'ao-serif',
  serifSemi: 'ao-serif-semi',
  serifItalic: 'ao-serif-italic',
} as const;

const FONT_FILES: Record<string, string> = {
  [FONT.sans]: 'Archivo-Regular.ttf',
  [FONT.sansSemi]: 'Archivo-SemiBold.ttf',
  [FONT.sansBold]: 'Archivo-Bold.ttf',
  [FONT.serif]: 'SourceSerif4-Regular.ttf',
  [FONT.serifSemi]: 'SourceSerif4-SemiBold.ttf',
  [FONT.serifItalic]: 'SourceSerif4-Italic.ttf',
};

/** Where the fonts might be, in the order worth trying. */
function fontDirCandidates(): string[] {
  return [
    // Running from dist/ under pm2 — assets sit beside the app root.
    path.join(process.cwd(), 'assets', 'fonts'),
    // Running from the repo root.
    path.join(process.cwd(), 'backend', 'assets', 'fonts'),
    // Relative to this file, source or compiled.
    path.join(__dirname, '..', '..', 'assets', 'fonts'),
    path.join(__dirname, '..', '..', '..', 'assets', 'fonts'),
  ];
}

let resolvedDir: string | null = null;

/**
 * Find the font directory once per process.
 *
 * Returns null rather than throwing: a missing font must degrade to the
 * standard-14 fallback, not take somebody's download down. The renderer logs
 * it once and carries on in Helvetica/Times, which is ugly and readable —
 * the opposite trade to a 500.
 */
export function fontDir(): string | null {
  if (resolvedDir !== null) return resolvedDir || null;
  for (const dir of fontDirCandidates()) {
    try {
      if (fs.existsSync(path.join(dir, FONT_FILES[FONT.serif]))) {
        resolvedDir = dir;
        return dir;
      }
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  resolvedDir = '';
  return null;
}

/**
 * Register the six faces on a document.
 *
 * @returns true when the real fonts are in use.
 */
export function registerFonts(doc: PDFKit.PDFDocument): boolean {
  const dir = fontDir();
  if (!dir) return false;
  try {
    for (const [name, file] of Object.entries(FONT_FILES)) {
      doc.registerFont(name, path.join(dir, file));
    }
    return true;
  } catch {
    return false;
  }
}

/** What to use when the assets are missing. Ugly, readable, never a 500. */
export const FALLBACK = {
  sans: 'Helvetica',
  sansSemi: 'Helvetica-Bold',
  sansBold: 'Helvetica-Bold',
  serif: 'Times-Roman',
  serifSemi: 'Times-Bold',
  serifItalic: 'Times-Italic',
} as const;

/** Resolves a face name to whatever this document can actually draw. */
export function faces(real: boolean): Record<keyof typeof FONT, string> {
  return real
    ? { ...FONT }
    : {
        sans: FALLBACK.sans,
        sansSemi: FALLBACK.sansSemi,
        sansBold: FALLBACK.sansBold,
        serif: FALLBACK.serif,
        serifSemi: FALLBACK.serifSemi,
        serifItalic: FALLBACK.serifItalic,
      };
}

export interface Chrome {
  doc: PDFKit.PDFDocument;
  c: SchemeColours;
  f: Record<keyof typeof FONT, string>;
}

/**
 * The 16 mm running banner: applicant on the left, section on the right.
 *
 * Drawn at the TOP of every page but the cover, which carries its own 80 mm
 * version.
 */
export function banner(
  { doc, c, f }: Chrome,
  leftLabel: string,
  rightLabel: string,
): void {
  const g = doc.linearGradient(0, 0, PAGE_W, BANNER_H);
  g.stop(0, c.deep).stop(1, c.deep2);
  doc.rect(0, 0, PAGE_W, BANNER_H).fill(g);

  const y = BANNER_H / 2 - px(9) * 0.72;
  const size = px(9);
  const tracking = size * 0.32;

  // ⚠️ THE DIAMOND IS DRAWN, NOT TYPESET. The handoff separates the two
  // halves of the left label with ◇ (WHITE DIAMOND, U+25C7) and Archivo has
  // no such glyph — it came out as a .notdef box in the banner of every page,
  // which is the most-seen element in the document. A rotated 3 pt square is
  // the same mark, in the same place, and cannot go missing.
  const [lead, tail] = splitOnDiamond(leftLabel.toUpperCase());
  doc.font(f.sans).fontSize(size).fillColor('#ffffff');
  doc.text(lead, PAD_X, y, { characterSpacing: tracking, lineBreak: false });

  if (tail !== null) {
    const leadW = doc.widthOfString(lead, { characterSpacing: tracking });
    const gap = size * 0.9;
    const cx = PAD_X + leadW + gap;
    const cy = y + size * 0.42;
    const r = size * 0.26;
    doc.save();
    doc.translate(cx, cy).rotate(45);
    doc.rect(-r, -r, r * 2, r * 2).fillOpacity(0.85).fill('#ffffff');
    doc.fillOpacity(1);
    doc.restore();
    doc
      .fillColor('#ffffff')
      .text(tail, cx + gap, y, { characterSpacing: tracking, lineBreak: false });
  }
  // The right label is set right-aligned in its own half, SHORTENED TO FIT.
  // See ellipsise: a two-line running head hangs below the gradient.
  const rTracking = px(9) * 0.28;
  const rHalf = CONTENT_W / 2;
  doc.font(f.sans).fontSize(size);
  doc
    .fillColor('#ffffff')
    .fillOpacity(0.8)
    .text(
      ellipsise(doc, rightLabel.toUpperCase(), rHalf, rTracking),
      PAD_X + rHalf,
      y,
      {
        width: rHalf,
        align: 'right',
        characterSpacing: rTracking,
        lineBreak: false,
      },
    )
    .fillOpacity(1);
}

/**
 * Trim `text` until it fits `width` at the current font and size.
 *
 * ⚠️ pdfkit's `lineBreak: false` DOES NOT GUARANTEE ONE LINE when a width and
 * an alignment are also given — it wrapped anyway, and both the banner and the
 * footer strip proved it on a real pack. The running head read
 * "ANNEXURE E — REQUEST FOR PRIOR NOTICE AND / WRITTEN REASONS" with the
 * second line hanging below the gradient, and the footer's second line fell
 * halfway out of its wash band on every page of a 26-page document.
 *
 * Measuring is the only reliable answer: a running head that does not fit is
 * shortened, never wrapped.
 */
export function ellipsise(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  characterSpacing: number,
): string {
  const fits = (v: string) => doc.widthOfString(v, { characterSpacing }) <= width;
  if (fits(text)) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(`${text.slice(0, mid).trimEnd()}…`)) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : '';
}

/**
 * Fit a footer line by DROPPING SEGMENTS, least important first.
 *
 * ⚠️ NOT BY ELLIPSISING. The footer exists so that a loose sheet can be filed
 * against the right application — truncating it mid-word would leave
 * "MO000017 · GERHARD J P FOURIE · CEZKA ZBROJ…" and quietly lose the page
 * number, which is the one part that has to survive. Dropping whole segments
 * from the tail keeps every segment that remains readable and complete.
 *
 * `keep` are never dropped: the reference and the page number.
 */
export function fitSegments(
  doc: PDFKit.PDFDocument,
  keep: string[],
  optional: string[],
  width: number,
  characterSpacing: number,
): string {
  const join = (parts: string[]) => parts.filter(Boolean).join(' · ');
  const width_ = (v: string) =>
    doc.widthOfString(v.toUpperCase(), { characterSpacing });
  // Longest first: try every segment, then shed from the end of `optional`.
  for (let n = optional.length; n >= 0; n -= 1) {
    const line = join([keep[0], ...optional.slice(0, n), ...keep.slice(1)]);
    if (width_(line) <= width) return line;
  }
  // Even the mandatory pair is too wide — ellipsise it rather than wrap.
  return ellipsise(doc, join(keep).toUpperCase(), width, characterSpacing);
}

/**
 * "A ◇ B" -> ["A", "B"]. Returns a null tail when there is no diamond.
 */
function splitOnDiamond(text: string): [string, string | null] {
  const i = text.indexOf('◇');
  if (i === -1) return [text, null];
  return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
}

/**
 * The footer strip: one wash band, one line of small caps.
 *
 * ⚠️ THE BOTTOM MARGIN IS ZEROED BY THE CALLER BEFORE THIS RUNS. pdfkit answers
 * text placed below the bottom margin by starting a fresh page and writing
 * there instead — which silently appended a blank page after every footer in
 * an earlier version of this document, and numbered a six-page pack "of 4".
 */
export function footerStrip(
  { doc, c, f }: Chrome,
  /** Never dropped: [reference, "Page 3 of 26"]. */
  keep: string[],
  /** Shed from the tail until the line fits: name, firearm, licence type. */
  optional: string[] = [],
): void {
  doc.rect(0, PAGE_H - FOOTER_H, PAGE_W, FOOTER_H).fill(c.wash);
  const size = px(8);
  const tracking = size * 0.28;

  // ── the brand mark, bottom left ───────────────────────────────────
  //
  // Operator, 2026-08-24: "add ALLOUTDOORS logo on the footer of each page and
  // say Prepared by All Outdoor."
  //
  // ⚠️ THE STRIP'S CENTRED LINE IS MEASURED AGAINST WHAT IS LEFT, not against
  // the full width. fitSegments sheds segments from the tail until the line
  // fits, so handing it the whole content width while a logo occupies the left
  // end would let a long firearm name run underneath the mark. The width the
  // mark and the byline take is subtracted before the line is fitted.
  //
  // ⚠️ AND IT DEGRADES TO WORDS. logoPath() returns null rather than throwing
  // when the asset is missing, and this pass runs AFTER every page has been
  // emitted — a throw here fails the whole download rather than losing a small
  // picture. Same reasoning as the unpaid mark that shares this asset.
  const markH = FOOTER_H * 0.34;
  const markW = markH * LOGO_ASPECT;
  const midY = PAGE_H - FOOTER_H + FOOTER_H / 2;
  const logo = logoPath();
  let leftEdge = PAD_X;
  if (logo) {
    try {
      doc.image(logo, PAD_X, midY - markH / 2, { height: markH });
      leftEdge = PAD_X + markW + px(4);
    } catch {
      /* unreadable asset — the byline alone still says who prepared it */
    }
  }
  // ⚠️ THE TRACKING HAS TO BE ADDED BY HAND. widthOfString does not include
  // characterSpacing, so measuring with it and then drawing into exactly that
  // width wraps the last word — this line rendered as "PREPARED BY ALL" over
  // "OUTDOOR" on every page of the pack until the per-character allowance was
  // added. lineBreak:false does not save it: pdfkit still breaks when the
  // string cannot fit the box at all.
  const byline = 'PREPARED BY ALL OUTDOOR';
  doc.font(f.sansSemi).fontSize(size);
  const bylineW =
    doc.widthOfString(byline) + tracking * byline.length + px(3);
  doc
    .fillColor(c.mut)
    .text(byline, leftEdge, midY - size * 0.7, {
      width: bylineW,
      align: 'left',
      characterSpacing: tracking,
      lineBreak: false,
    });

  // What is left for the application's own line, centred in the remainder.
  const used = leftEdge - PAD_X + bylineW + px(6);
  const room = Math.max(px(40), CONTENT_W - used);
  const line = fitSegments(doc, keep, optional, room, tracking);
  doc
    .fillColor(c.mut)
    .text(line.toUpperCase(), PAD_X + used, midY - size * 0.7, {
      width: room,
      align: 'right',
      characterSpacing: tracking,
      lineBreak: false,
    });
}

// ── the unpaid mark ─────────────────────────────────────────────────
//
// Operator, 2026-08-22: "remember to add a watermark as this is not been paid
// yet. Add NOT FOR USE around the All Outdoor logo as the watermark."
//
// ⚠️ THIS IS THE ONE PLACE THE BRAND APPEARS ON THE DOCUMENT, and it is a
// deliberate exception to the "no branding beyond one discreet footer line"
// rule at the top of motivation-pdf.service. It is only ever drawn on a pack
// nobody has paid for — a sheet that must never reach a DFO's desk — so the
// mark being unmistakably ours is the point rather than a lapse.

/**
 * The brand mark, as a raster.
 *
 * ⚠️ PNG, NOT ONE OF THE SVGs. frontend/public carries logo-mark.svg and
 * logo-mark-dark.svg, and they are the better artwork — real traced paths that
 * scale. doc.image() reads JPEG and PNG only and throws "Unknown image format"
 * on anything else, and that throw would land in the buffered-page pass, AFTER
 * every page of the document has been emitted: the download fails outright
 * rather than degrading. So the raster lockup it is.
 *
 * ⚠️ A COPY IN backend/assets, NOT A PATH INTO frontend/public. Same reasoning
 * motivation-firearm-image sets out for the stock photographs: this process
 * runs from dist/ under pm2, nest-cli.json copies no non-TS assets, and the
 * frontend tree is not reliably anywhere relative to it. Source file is
 * frontend/public/email-logo.png (600 x 392, RGBA).
 */
const LOGO_FILE = 'all-outdoor-logo.png';

/** Its intrinsic proportions, so laying it out costs no image decode. */
const LOGO_ASPECT = 600 / 392;

/** What the mark says, in one place so the renderer and its spec agree. */
export const WATERMARK_TEXT = 'NOT FOR USE';

/**
 * ⚠️ LIGHT ENOUGH TO READ THROUGH, HEAVY ENOUGH TO SEE. The whole reason an
 * unpaid pack is shown at all is so somebody can decide whether it is worth
 * paying for, which it cannot do if the body text is unreadable. 0.07 is what
 * the "PREVIEW" mark this replaced used, and the logo is a far larger solid
 * mass than seven letterforms, so it reads harder at the same value.
 */
const WATERMARK_OPACITY = 0.07;

/** Pure black, like the body — the mark is a shadow of the page, not a colour. */
const WATERMARK_INK = '#000000';

let resolvedLogo: string | null = null;

/**
 * Find the brand mark on disk once per process.
 *
 * Returns null rather than throwing, exactly as fontDir() does: a missing
 * asset degrades the mark to its words alone. An unpaid pack that loses its
 * logo is still stamped; an unpaid pack that 500s is a support ticket.
 */
export function logoPath(): string | null {
  if (resolvedLogo !== null) return resolvedLogo || null;
  const candidates = [
    // Running from dist/ under pm2 — assets sit beside the app root.
    path.join(process.cwd(), 'assets', LOGO_FILE),
    // Running from the repo root.
    path.join(process.cwd(), 'backend', 'assets', LOGO_FILE),
    // Relative to this file, source or compiled.
    path.join(__dirname, '..', '..', 'assets', LOGO_FILE),
    path.join(__dirname, '..', '..', '..', 'assets', LOGO_FILE),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        resolvedLogo = candidate;
        return candidate;
      }
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  resolvedLogo = '';
  return null;
}

/**
 * Stamp the current page as unpaid: the logo on the page's own diagonal, with
 * NOT FOR USE set above and below it.
 *
 * ⚠️ NOTHING HERE MAY MOVE THE TEXT OR ADD A PAGE. It is drawn in the
 * buffered-page pass, onto pages whose prose is already laid out, so the two
 * ways pdfkit could ruin that are both closed off deliberately:
 *
 *  - the words are set WITHOUT a `width`. Given one, pdfkit routes the run
 *    through LineWrapper, and LineWrapper's first act is to compare `doc.y`
 *    against the bottom margin and call addPage() if it is past it. No width,
 *    no wrapper, no page.
 *  - the logo is placed at an EXPLICIT NUMERIC y. Handed anything else,
 *    doc.image() decides it is in the document flow and advances doc.y by the
 *    height of the image.
 *
 * The caller still zeroes the margins around this, as it does around
 * footerStrip — see the note there.
 */
export function watermark({ doc, f }: Chrome): void {
  const cx = PAGE_W / 2;
  const cy = PAGE_H / 2;

  const size = px(46);
  const tracking = size * 0.26;
  const logoW = mm(74);
  const logoH = logoW / LOGO_ASPECT;
  const gap = mm(8);
  const logo = logoPath();

  doc.save();
  // ⚠️ -55° IS A4's OWN DIAGONAL, not a taste. atan(297/210) is 54.7°, so the
  // mark lies along the sheet and is the same distance from both corners it
  // points at; any other angle crowds one corner and leaves the other empty.
  doc.rotate(-55, { origin: [cx, cy] });

  doc.font(f.sansBold).fontSize(size);
  const lineH = doc.currentLineHeight();
  const stackH = logo ? lineH * 2 + gap * 2 + logoH : lineH;

  // ⚠️ PLACED BY MEASUREMENT, NOT BY align: 'center'. A centred run is centred
  // on a box that includes the trailing character-spacing of its last glyph,
  // so at this tracking the words sit several points left of the logo they are
  // meant to sit over — visible the moment the two are stacked. widthOfString
  // already excludes that trailing gap (it multiplies by length - 1), so
  // measuring is what puts both halves of the mark on one axis.
  const textW = doc.widthOfString(WATERMARK_TEXT, {
    characterSpacing: tracking,
  });
  const words = (atY: number) => {
    doc
      .fillColor(WATERMARK_INK)
      .fillOpacity(WATERMARK_OPACITY)
      .text(WATERMARK_TEXT, cx - textW / 2, atY, {
        characterSpacing: tracking,
        lineBreak: false,
      })
      .fillOpacity(1);
  };

  let y = cy - stackH / 2;
  words(y);

  if (logo) {
    y += lineH + gap;
    // ⚠️ THE PATH, NOT THE BYTES. doc.image() keys _imageRegistry on a string
    // src, so passing the path embeds ONE image XObject that every page then
    // references. Reading the file ourselves and passing a Buffer defeats that
    // cache and re-embeds 55 kB per page — a megabyte and a half onto a
    // twenty-six page pack, for one mark.
    doc.fillOpacity(WATERMARK_OPACITY);
    doc.image(logo, cx - logoW / 2, y, { width: logoW });
    doc.fillOpacity(1);
    y += logoH + gap;
    words(y);
  }

  // ⚠️ RESTORE THE GRAPHICS STATE. rotate() and the fill opacity are
  // document-wide in pdfkit, and leaving either set bleeds into the banner and
  // the footer strip drawn immediately after — which is how a first attempt
  // put the running title on a 55-degree angle in pale grey.
  doc.restore();
}

/**
 * A numbered section header: a ring node, then a label on a highlight band.
 *
 * @returns the y the section's body should start at.
 */
/**
 * The four headings that are not the original band.
 *
 * ⚠️ EACH ONE RETURNS THE Y THE BODY STARTS AT, exactly as the band does, and
 * that contract is what keeps the rest of the renderer ignorant of layout. A
 * heading that returned the wrong baseline would not look wrong — it would
 * overlap the first paragraph, on one layout, somewhere down page four.
 *
 * ⚠️ AND NONE OF THEM HARD-CODES A COLOUR. Every value comes from the scheme,
 * so all five layouts work in all ten colourways. A heading that reached for
 * a literal would be right in one scheme and wrong in nine.
 */
function alternateHeader(
  { doc, c, f }: Chrome,
  number: string,
  title: string,
  y: number,
  style: HeadingStyle,
  drawMark?: (x: number, y: number, size: number) => void,
): number {
  const upper = title.toUpperCase();

  if (style === 'underline') {
    // Centred small caps over a hairline the full width of the column.
    const size = px(12);
    const tracking = size * 0.26;
    doc.font(f.sansSemi).fontSize(size).fillColor(c.deep);
    doc.text(upper, PAD_X, y, {
      width: CONTENT_W,
      align: 'center',
      characterSpacing: tracking,
      lineBreak: false,
    });
    const ruleY = y + size * 1.5;
    doc
      .moveTo(PAD_X, ruleY)
      .lineTo(PAD_X + CONTENT_W, ruleY)
      .lineWidth(0.9)
      .strokeColor(c.hair)
      .stroke();
    return ruleY + mm(5);
  }

  if (style === 'numeral') {
    // A large numeral hanging in the margin, the title set beside it.
    const numSize = px(30);
    const titleSize = px(13);
    doc.font(f.sansBold).fontSize(numSize).fillColor(c.band);
    doc.text(number, PAD_X, y, { lineBreak: false });
    const numW = doc.widthOfString(number);
    const tx = PAD_X + numW + px(10);
    doc
      .font(f.sansBold)
      .fontSize(titleSize)
      .fillColor(c.deep)
      .text(upper, tx, y + numSize * 0.45, {
        width: CONTENT_W - (tx - PAD_X),
        characterSpacing: titleSize * 0.2,
        lineBreak: false,
      });
    if (drawMark) {
      const markSize = mm(5.8);
      const mx = PAD_X + CONTENT_W - markSize;
      drawMark(mx, y + numSize * 0.35, markSize);
    }
    return y + numSize * 1.15 + mm(4);
  }

  if (style === 'bar') {
    // A short heavy bar, then the title on the same line.
    const size = px(12.5);
    const barW = mm(9);
    const barH = size * 0.9;
    doc.rect(PAD_X, y + size * 0.15, barW, barH).fill(c.deep);
    const tx = PAD_X + barW + px(9);
    doc
      .font(f.sansBold)
      .fontSize(size)
      .fillColor(c.deep)
      .text(`${number}  ${upper}`, tx, y, {
        width: CONTENT_W - (tx - PAD_X),
        characterSpacing: size * 0.2,
        lineBreak: false,
      });
    if (drawMark) {
      const markSize = mm(5.8);
      const mx = PAD_X + CONTENT_W - markSize;
      if (mx > tx + mm(30)) drawMark(mx, y - px(1), markSize);
    }
    return y + size * 1.6 + mm(3.5);
  }

  // 'caps' — letterspaced small caps, generous air, no rule and no fill. The
  // quietest of the five: nothing on the page but type.
  const size = px(11.5);
  const tracking = size * 0.42;
  doc
    .font(f.sansSemi)
    .fontSize(size)
    .fillColor(c.mut)
    .text(`${number} — ${upper}`, PAD_X, y, {
      width: CONTENT_W,
      characterSpacing: tracking,
      lineBreak: false,
    });
  return y + size * 1.4 + mm(6);
}

export function sectionHeader(
  chrome: Chrome,
  number: string,
  title: string,
  y: number,
  /**
   * Draws a subject mark to the right of the band, if the section has one.
   *
   * ⚠️ A CALLBACK RATHER THAN AN IMPORT. motivation-pdf-marks imports THIS
   * module for its units; importing it back would be a cycle, and the symptom
   * of a cycle in a module that runs at import time is an undefined constant
   * a long way from the file that caused it.
   */
  drawMark?: (x: number, y: number, size: number) => void,
  /**
   * How this layout announces a section.
   *
   * ⚠️ LAST, AND AFTER drawMark, DELIBERATELY. Inserting it before an existing
   * optional parameter silently rebinds every positional call — the renderer's
   * own drawMark callback started arriving here as `style`, which tsc caught
   * only because the types happened to be incompatible. A parameter that had
   * been `string` would have compiled and drawn the wrong heading.
   *
   * ⚠️ AND IT IS THE HEADING THAT MAKES TWO LAYOUTS LOOK LIKE DIFFERENT
   * DOCUMENTS. The cover is seen once; this is seen on every section of every
   * page. Defaults to the original band, so every stored preference and every
   * caller that has not been updated is unaffected.
   */
  style: HeadingStyle = 'band',
): number {
  const { doc, c, f } = chrome;
  if (style !== 'band') {
    return alternateHeader(chrome, number, title, y, style, drawMark);
  }
  const label = `${number} · ${title.toUpperCase()}`;
  const size = px(11);
  const padX = px(15);
  const padY = px(7);

  // The node: a 9 px circle with a 2 px ring in `deep`.
  const r = px(9) / 2;
  const nodeX = PAD_X + r;
  const bandH = size * 1.2 + padY * 2;
  const nodeY = y + bandH / 2;
  doc
    .circle(nodeX, nodeY, r)
    .lineWidth(px(2))
    .fillAndStroke('#ffffff', c.deep);

  const bandX = PAD_X + px(9) + px(10);
  doc.font(f.sansBold).fontSize(size);
  const textW =
    doc.widthOfString(label, { characterSpacing: size * 0.22 }) + padX * 2;
  const bandW = Math.min(textW, CONTENT_W - (bandX - PAD_X));
  doc.rect(bandX, y, bandW, bandH).fill(c.band);
  doc
    .fillColor(c.deep2)
    .text(label, bandX + padX, y + padY, {
      characterSpacing: size * 0.22,
      lineBreak: false,
    });

  // The subject mark, in the clear space the band leaves. Skipped when the
  // band already runs the full column — a mark crushed against the margin
  // reads as a stray glyph rather than as part of the header.
  if (drawMark) {
    // ⚠️ SIZED FOR THE ICONS, NOT FOR THE GAP. The pack is drawn on a 24-unit
    // grid at a 1.5 stroke — at 13 pt the rifle's barrel, receiver and stock
    // merged into one grey smudge, because the drawing was being asked to
    // work well below the size it was designed at. 16 pt still clears the
    // band's 20 pt with room either side.
    const markSize = mm(5.8);
    const markX = bandX + bandW + px(12);
    if (markX + markSize <= PAD_X + CONTENT_W) {
      drawMark(markX, y + (bandH - markSize) / 2, markSize);
    }
  }

  return y + bandH + mm(5);
}

/**
 * Opens the hanging rule that runs down the left of a section's body.
 *
 * Returned as a closure because the rule's LENGTH is not known until the body
 * has been laid out — and on a page break it has to stop at the bottom of one
 * page and restart on the next.
 */
export function sectionRule({ doc, c }: Chrome) {
  let from = 0;
  return {
    start(y: number) {
      from = y;
    },
    /** Draw what has accumulated, and forget it. */
    close(toY: number) {
      if (toY > from + 1) {
        doc
          .moveTo(PAD_X, from)
          .lineTo(PAD_X, toY)
          .lineWidth(0.7)
          .strokeColor(c.hair)
          .stroke();
      }
      from = toY;
    },
  };
}

/** A small-caps label, as used above every value in the dossier grid. */
export function label({ doc, c, f }: Chrome, text: string, x: number, y: number, w: number): void {
  doc
    .font(f.sansSemi)
    .fontSize(px(8.5))
    .fillColor(c.mut)
    .text(text.toUpperCase(), x, y, {
      width: w,
      characterSpacing: px(8.5) * 0.14,
      lineBreak: false,
    });
}
