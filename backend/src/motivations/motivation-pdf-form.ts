import * as K from './motivation-pdf-chrome';
import type { Chrome } from './motivation-pdf-chrome';
import type {
  CharacterStatementForm,
  StatementBlock,
} from './motivation-character-statement';

// ────────────────────────────────────────────────────────────────────
// THE SIGNED STATEMENT, ON ONE SHEET.
//
// Operator, 2026-08-21: "the generated page needs to be just one A4 page with
// everything on it."
//
// ⚠️ A REQUIREMENT, NOT A PREFERENCE, and the layout is built around it rather
// than hoping. A character statement is handed across a counter and read in
// one go; a Designated Firearms Officer working through a folder should not
// have to turn a page to find out whether the answer to question three was
// yes. One sheet also means one signature governing everything above it, with
// nothing overleaf that the signature does not obviously cover.
//
// Three things make it fit where the first version needed two:
//
//   · THE WITNESS'S DETAILS ARE A TWO-COLUMN GRID. Seven full-width rows was
//     seven lines of white space to the right of a phone number.
//   · THE ANSWER SITS ON THE QUESTION'S LINE. A pill on its own row below each
//     question cost a centimetre three times over, to say "Yes".
//   · AND IF IT STILL DOES NOT FIT, THE WHOLE SHEET SCALES. A witness who
//     writes six paragraphs gets slightly tighter setting — never a second
//     page, and never their words truncated. What they wrote is what they
//     signed.
//
// ⚠️ THIS FILE NO LONGER RENDERS BLANK FORMS. It used to lay out two printable
// sheets of ruled lines and tick boxes; operator: "Only use the link." Those
// block kinds went with them, which is most of why the arithmetic below is
// legible.
// ────────────────────────────────────────────────────────────────────

/** Vertical metrics, scaled together so the whole sheet shrinks as one. */
interface Metrics {
  scale: number;
  mm: (n: number) => number;
  px: (n: number) => number;
}

function metrics(scale: number): Metrics {
  return {
    scale,
    mm: (n) => K.mm(n) * scale,
    px: (n) => K.px(n) * scale,
  };
}

/**
 * How far the sheet may be squeezed before a second page is the lesser evil.
 *
 * ⚠️ NOT ZERO. Below about 0.78 the serif stops being comfortable at arm's
 * length, and this is read by somebody deciding whether a person may hold a
 * firearm. A statement needing more compression than this is one where the
 * witness wrote a great deal — and a second page is then the honest answer,
 * better than an unreadable one.
 */
const MIN_SCALE = 0.78;

/** Draw a hairline. */
function rule({ doc, c }: Chrome, x: number, y: number, w: number): void {
  doc
    .moveTo(x, y)
    .lineTo(x + w, y)
    .lineWidth(0.5)
    .strokeColor(c.hair)
    .stroke();
}

/** The pill an answer sits in — measured, because the question wraps to it. */
function answerPillWidth(
  { doc, f }: Chrome,
  M: Metrics,
  answer: string,
): number {
  return (
    doc.font(f.sansBold).fontSize(M.px(9.5)).widthOfString(answer) + M.px(20)
  );
}

// ── THE PAIRED-PHOTOGRAPH BLOCK ─────────────────────────────────────
//
// Operator, 2026-08-23: "set the two images right next to each other scaling
// them to almost reach the edge of the A4 leaving a 10mm gap each side for
// print margins."
//
// A4 is 210mm. Ten each side leaves 190mm; a 5mm gutter gives each photograph
// 92.5mm, which on an ID-1 card (85.6 x 54mm) is about 108% of life size. That
// is the difference between a DFO reading a serial number off the page and
// squinting at a thumbnail.
//
// ⚠️ IT BREAKS THE BODY MARGIN DELIBERATELY. PAD_X is 14mm, so these sit 4mm
// outside the text column on each side. Everything else on the sheet stays in
// the column; only the photographs reach out, which is what makes them read as
// exhibits rather than as part of the prose.
const IMG_MARGIN_MM = 10;
const IMG_GUTTER_MM = 5;
/** ID-1: 85.6 x 54mm. The box is fixed; pdfkit fits each photo inside it. */
const IMG_ASPECT = 85.6 / 54;

function imageBox(M: Metrics): { w: number; h: number; x: number } {
  const full = K.PAGE_W - M.mm(IMG_MARGIN_MM) * 2;
  const w = (full - M.mm(IMG_GUTTER_MM)) / 2;
  return { w, h: w / IMG_ASPECT, x: M.mm(IMG_MARGIN_MM) };
}

/** How tall a block is at this scale. */
function heightOf(
  chrome: Chrome,
  M: Metrics,
  b: StatementBlock,
  w: number,
): number {
  const { doc, f } = chrome;
  switch (b.kind) {
    case 'note':
      return (
        doc
          .font(f.sans)
          .fontSize(M.px(9.5))
          .heightOfString(b.text, {
            width: w - M.mm(6),
            lineGap: M.px(2.5),
          }) + M.mm(3.5)
      );

    case 'part':
      return M.px(10) * 1.2 + M.px(11) + M.mm(3);

    case 'text':
      return (
        doc
          .font(f.serif)
          .fontSize(M.px(12))
          .heightOfString(b.text, { width: w, lineGap: M.px(2) }) + M.mm(2.5)
      );

    // Two per row — the pair costs one row. See the pairing in the loop.
    case 'value':
      return M.mm(8.4);

    case 'answered': {
      const pillW = answerPillWidth(chrome, M, b.answer);
      const textH = doc
        .font(f.serif)
        .fontSize(M.px(11.5))
        .heightOfString(`${b.number}.  ${b.text}`, {
          width: w - M.mm(6) - pillW - M.mm(4),
          lineGap: M.px(2),
        });
      // ⚠️ THE PILL COUNTS TOO, and it was not counted. A one-line question is
      // about 10 pt of text beside a 15 pt pill, so the row is the PILL's
      // height — the draw takes max(text, pill) and the measure took only the
      // text. Five points undercounted three times over is most of a
      // centimetre, which is exactly enough to push a sheet measured as
      // fitting onto a second page.
      const pillH = M.px(9.5) * 1.2 + M.px(9);
      return Math.max(textH, pillH) + M.mm(3.2);
    }

    case 'images':
      // ⚠️ A FIXED HEIGHT, WHATEVER THE PHOTOGRAPHS ARE. Measuring the real
      // aspect would mean decoding both images here and again when drawing,
      // and a page that lays itself out differently depending on how somebody
      // held their phone is a page that sometimes spills to two.
      return (
        (b.label ? M.px(8) * 1.2 + M.mm(1.5) : 0) +
        imageBox(M).h +
        M.mm(4)
      );

    case 'quote':
      return (
        (b.label ? M.px(8) * 1.2 + M.mm(1.5) : 0) +
        doc
          .font(f.serifItalic)
          .fontSize(M.px(11.5))
          .heightOfString(b.text, {
            width: w - M.mm(5),
            lineGap: M.px(2.5),
          }) + M.mm(3)
      );

    case 'signed':
      return M.mm(30);
  }
}

/** The masthead's height at this scale. */
function mastheadHeight(
  { doc, f }: Chrome,
  M: Metrics,
  form: CharacterStatementForm,
  w: number,
): number {
  return (
    M.px(8) * 1.2 +
    M.mm(2) +
    doc.font(f.sans).fontSize(M.px(19)).heightOfString(form.title, { width: w }) +
    M.mm(1) +
    doc
      .font(f.serifItalic)
      .fontSize(M.px(11))
      .heightOfString(form.subtitle, { width: w }) +
    M.mm(3.5)
  );
}

/**
 * Everything, measured before anything is drawn.
 *
 * ⚠️ THE ESTIMATE IS DELIBERATELY CONSERVATIVE. Scaling type down puts MORE
 * characters on a line, so a block's real height shrinks faster than the scale
 * factor does — measuring at 1.0 and dividing therefore over-estimates, which
 * is the direction that keeps the sheet to one page.
 */
export function totalHeight(
  chrome: Chrome,
  M: Metrics,
  form: CharacterStatementForm,
  w: number,
): number {
  let h = mastheadHeight(chrome, M, form, w);
  let half = false;
  for (const b of form.blocks) {
    if (b.kind === 'value') {
      // The first of a pair reserves the row; the second rides along free.
      if (half) {
        half = false;
        continue;
      }
      half = true;
      h += M.mm(8.4);
      continue;
    }
    half = false;
    h += heightOf(chrome, M, b, w);
  }
  return h + M.mm(6);
}

/**
 * Render one signed statement, starting on a fresh page.
 *
 * Returns the page number it started on, for the contents.
 */
export function renderStatementForm(
  chrome: Chrome,
  form: CharacterStatementForm,
): number {
  const { doc, c, f } = chrome;
  const X = K.PAD_X;
  const W = K.CONTENT_W;
  const available = K.BODY_BOTTOM - K.BODY_TOP;

  // ── Fit the sheet ─────────────────────────────────────────────────
  // ⚠️ A MARGIN ON THE ESTIMATE, because measuring and drawing never agree to
  // the point. Every block is measured from heightOfString and drawn by
  // advancing doc.y, and the two differ by fractions that accumulate down a
  // page — 3% costs a millimetre of white space and buys never spilling.
  const at1 = totalHeight(chrome, metrics(1), form, W) * 1.03;
  const M = metrics(
    at1 <= available ? 1 : Math.max(MIN_SCALE, available / at1),
  );

  doc.addPage();
  const startedOn = doc.bufferedPageRange().count;
  doc.x = X;
  doc.y = K.BODY_TOP;

  // ── Masthead ──────────────────────────────────────────────────────
  K.label(chrome, form.eyebrow, X, doc.y, W);
  doc.y += M.px(8) * 1.2 + M.mm(2);
  doc
    .font(f.sans)
    .fontSize(M.px(19))
    .fillColor(c.deep)
    .text(form.title, X, doc.y, {
      width: W,
      characterSpacing: M.px(19) * 0.04,
    });
  doc.y += M.mm(1);
  doc
    .font(f.serifItalic)
    .fontSize(M.px(11))
    .fillColor(c.sub)
    .text(form.subtitle, X, doc.y, { width: W });
  doc.y += M.mm(2);
  doc
    .moveTo(X, doc.y)
    .lineTo(X + W, doc.y)
    .lineWidth(1.6)
    .strokeColor(c.deep)
    .stroke();
  doc.y += M.mm(3.5);

  // ── Blocks ────────────────────────────────────────────────────────
  const colW = (W - M.mm(6)) / 2;
  let pending: { label: string; value: string } | null = null;

  const drawValue = (
    b: { label: string; value: string },
    x: number,
    y: number,
    w: number,
  ) => {
    K.label(chrome, b.label, x, y, w);
    doc
      .font(f.serif)
      .fontSize(M.px(11.5))
      .fillColor(b.value ? c.ink : c.mut)
      .text(b.value || '—', x, y + M.mm(3.4), { width: w, lineBreak: false });
    rule(chrome, x, y + M.mm(7.4), w);
  };

  const flush = () => {
    if (!pending) return;
    drawValue(pending, X, doc.y, colW);
    doc.y += M.mm(8.4);
    pending = null;
  };

  for (const b of form.blocks) {
    if (b.kind === 'value') {
      if (pending) {
        // ⚠️ CAPTURE y FIRST. K.label writes with doc.text(), which advances
        // doc.y — passing doc.y to the second call put the right-hand detail
        // of every pair below its partner.
        const y = doc.y;
        drawValue(pending, X, y, colW);
        drawValue(b, X + colW + M.mm(6), y, colW);
        doc.y = y + M.mm(8.4);
        pending = null;
      } else {
        pending = b;
      }
      continue;
    }
    flush();

    switch (b.kind) {
      case 'note': {
        const top = doc.y;
        doc
          .font(f.sans)
          .fontSize(M.px(9.5))
          .fillColor(c.sub)
          .text(b.text, X + M.mm(6), doc.y, {
            width: W - M.mm(6),
            lineGap: M.px(2.5),
          });
        doc.rect(X, top, M.px(2), doc.y - top).fill(c.band);
        doc.x = X;
        doc.y += M.mm(3.5);
        break;
      }

      case 'part': {
        const size = M.px(10);
        const padX = M.px(12);
        const padY = M.px(5.5);
        const bandH = size * 1.2 + padY * 2;
        doc.font(f.sansBold).fontSize(size);
        const label = `${b.label} · ${b.title}`;
        const tw =
          doc.widthOfString(label, { characterSpacing: size * 0.18 }) +
          padX * 2;
        doc.rect(X, doc.y, Math.min(tw, W), bandH).fill(c.band);
        doc
          .fillColor(c.deep2)
          .text(label, X + padX, doc.y + padY, {
            characterSpacing: size * 0.18,
            lineBreak: false,
          });
        doc.x = X;
        doc.y += bandH + M.mm(3);
        break;
      }

      case 'text':
        doc
          .font(f.serif)
          .fontSize(M.px(12))
          .fillColor(c.ink)
          .text(b.text, X, doc.y, { width: W, lineGap: M.px(2) });
        doc.x = X;
        doc.y += M.mm(2.5);
        break;

      case 'answered': {
        // ⚠️ THE ANSWER ON THE QUESTION'S OWN LINE, right-aligned. A pill on a
        // row of its own read as a button and cost a centimetre three times
        // over to say "Yes".
        //
        // ⚠️ AND A "NO" IS NOT DRESSED UP. Same pill, same ink: the witness's
        // answer is the witness's answer, and a document that styles a
        // negative one as an alarm has editorialised on a page they signed.
        const top = doc.y;
        const pillW = answerPillWidth(chrome, M, b.answer);
        const textW = W - M.mm(6) - pillW - M.mm(4);
        doc
          .font(f.serif)
          .fontSize(M.px(11.5))
          .fillColor(c.ink)
          .text(`${b.number}.  ${b.text}`, X + M.mm(6), top, {
            width: textW,
            lineGap: M.px(2),
          });
        const textBottom = doc.y;

        const ph = M.px(9.5) * 1.2 + M.px(9);
        doc
          .roundedRect(X + W - pillW, top, pillW, ph, ph / 2)
          .lineWidth(0.8)
          .fillAndStroke(c.band, c.deep);
        doc
          .font(f.sansBold)
          .fontSize(M.px(9.5))
          .fillColor(c.deep2)
          .text(b.answer, X + W - pillW, top + M.px(4.5), {
            width: pillW,
            align: 'center',
            lineBreak: false,
          });

        doc.y = Math.max(textBottom, top + ph);
        doc
          .moveTo(X + M.mm(1.5), top)
          .lineTo(X + M.mm(1.5), doc.y)
          .lineWidth(0.7)
          .strokeColor(c.hair)
          .stroke();
        doc.x = X;
        doc.y += M.mm(3.2);
        break;
      }

      case 'images': {
        if (b.label) {
          K.label(chrome, b.label, X, doc.y, W);
          doc.y += M.px(8) * 1.2 + M.mm(1.5);
        }
        const box = imageBox(M);
        const top = doc.y;
        b.images.slice(0, 2).forEach((img, i) => {
          const x = box.x + i * (box.w + M.mm(IMG_GUTTER_MM));
          try {
            // `fit` preserves each photograph's own aspect inside the fixed
            // box, so a slightly off-square crop is letterboxed rather than
            // stretched — a stretched licence card is a card whose serial
            // reads wrong.
            doc.image(img, x, top, { fit: [box.w, box.h], align: 'center' });
          } catch {
            // ⚠️ A PHOTOGRAPH pdfkit WILL NOT EMBED MUST NOT TAKE THE SHEET
            // DOWN. The declaration and the particulars above it are the part
            // that carries legal weight; losing an exhibit is bad, losing the
            // consent is worse. The frame below still shows something was
            // meant to be here.
            doc
              .rect(x, top, box.w, box.h)
              .lineWidth(0.7)
              .strokeColor(c.hair)
              .stroke();
          }
        });
        doc.x = X;
        doc.y = top + box.h + M.mm(4);
        break;
      }

      case 'quote': {
        if (b.label) {
          K.label(chrome, b.label, X, doc.y, W);
          doc.y += M.px(8) * 1.2 + M.mm(1.5);
        }
        const top = doc.y;
        doc
          .font(f.serifItalic)
          .fontSize(M.px(11.5))
          .fillColor(c.ink)
          .text(b.text, X + M.mm(5), doc.y, {
            width: W - M.mm(5),
            lineGap: M.px(2.5),
          });
        doc.rect(X, top, M.px(2), doc.y - top).fill(c.band);
        doc.x = X;
        doc.y += M.mm(3);
        break;
      }

      case 'signed': {
        const y = doc.y;
        const sigW = M.mm(64);
        const sigH = M.mm(15);
        if (b.signature) {
          try {
            doc.image(b.signature, X, y, {
              fit: [sigW, sigH],
              valign: 'bottom',
            });
          } catch {
            // A signature pdfkit will not embed must not take the statement
            // down — the rule and the name below still identify who signed.
          }
        }
        const ruleY = y + sigH + M.mm(1);
        doc
          .moveTo(X, ruleY)
          .lineTo(X + sigW, ruleY)
          .lineWidth(0.7)
          .strokeColor(c.hair)
          .stroke();
        doc
          .font(f.serif)
          .fontSize(M.px(11.5))
          .fillColor(c.ink)
          .text(b.name || '', X, ruleY + M.mm(1.6), { width: sigW });
        const detail = [
          b.place ? `Signed at ${b.place}` : '',
          b.date
            ? b.date.toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })
            : '',
        ]
          .filter(Boolean)
          .join(' · ');
        K.label(chrome, detail || 'Signed electronically', X, doc.y + 1, W);
        doc.x = X;
        doc.y = ruleY + M.mm(10);
        break;
      }
    }
  }
  flush();

  // Which wording this copy carries, small, at the foot.
  doc
    .font(f.sans)
    .fontSize(M.px(7.5))
    .fillColor(c.mut)
    .text(form.version, X, Math.min(doc.y + M.mm(2), K.BODY_BOTTOM - K.mm(4)), {
      width: W,
      lineBreak: false,
    });
  doc.x = X;

  return startedOn;
}
