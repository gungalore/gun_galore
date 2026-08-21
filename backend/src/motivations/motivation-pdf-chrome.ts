import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SchemeColours } from './motivation-pdf.service';

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
  doc.font(f.sansSemi).fontSize(size);
  const line = fitSegments(doc, keep, optional, CONTENT_W, tracking);
  doc
    .fillColor(c.mut)
    .text(line.toUpperCase(), PAD_X, PAGE_H - FOOTER_H + FOOTER_H / 2 - size * 0.7, {
      width: CONTENT_W,
      align: 'center',
      characterSpacing: tracking,
      lineBreak: false,
    });
}

/**
 * A numbered section header: a ring node, then a label on a highlight band.
 *
 * @returns the y the section's body should start at.
 */
export function sectionHeader(
  { doc, c, f }: Chrome,
  number: string,
  title: string,
  y: number,
): number {
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
  doc.rect(bandX, y, Math.min(textW, CONTENT_W - (bandX - PAD_X)), bandH).fill(c.band);
  doc
    .fillColor(c.deep2)
    .text(label, bandX + padX, y + padY, {
      characterSpacing: size * 0.22,
      lineBreak: false,
    });

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
