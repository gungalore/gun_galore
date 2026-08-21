import * as K from './motivation-pdf-chrome';
import type { Chrome } from './motivation-pdf-chrome';
import type {
  CharacterStatementForm,
  StatementBlock,
} from './motivation-character-statement';

// ────────────────────────────────────────────────────────────────────
// LAYING OUT A FORM, WHICH IS NOT LAYING OUT PROSE.
//
// The motivation renderer sets justified paragraphs under numbered section
// headers. A form is ruled lines, tick boxes and captions, and almost nothing
// carries over: the thing that matters is not the text, it is the EMPTY SPACE
// AFTER the text and whether a human being can write in it with a pen.
//
// So the measurements here are ergonomic rather than typographic:
//
//   8.5 mm  the pitch of a ruled writing line. Adult handwriting runs 4–7 mm
//           tall; anything under 8 mm forces people to write small and cramped
//           on a page they are signing under a criminal-offence warning.
//   mm(3.4) a tick box. Big enough for a pen tick, small enough to sit on a
//           text line without looking like a checkbox on a website.
//   10.5 mm a whole labelled field: caption, writing space, rule.
//
// ⚠️ AND THE PAGE-BREAK RULE IS DIFFERENT TOO. Prose can break anywhere. A
// form cannot break between a question and its tick boxes, or between a
// caption and its rule, because the half on the next page is unanswerable —
// so every block measures itself first and moves whole.
// ────────────────────────────────────────────────────────────────────

// ⚠️ THESE WERE TUNED DOWN AFTER LOOKING AT THE FIRST RENDER, which ran to
// three sheets per form and left the third one 60% empty — a page carrying
// nothing but a signature line and a commissioner box. Two sheets is also
// simply a better object: it is what fits in an envelope, what a referee will
// actually print, and what does not get separated on somebody's desk.
//
// The writing space was NOT sacrificed to get there. 8.5 mm still clears adult
// handwriting (4–7 mm) with room above the rule; the space came out of the
// gaps between blocks, the commissioner box, and one line of Part D.
/** Pitch of a ruled writing line. */
const LINE_PITCH = K.mm(8.5);
/** A whole labelled field: caption, writing space, rule. */
const FIELD_H = K.mm(10.5);
/** A tick box. */
const BOX = K.mm(3.4);
/** Row pitch for wrapped tick boxes. */
const TICK_ROW = K.mm(6.6);
/** Lead-in above the signature rule, plus room for the caption below it. */
const SIGN_H = K.mm(8) + K.mm(6);
/** Fewest lines a 'fill' section may collapse to. */
const FILL_MIN = 3;
/** Most it may grow to — beyond this it stops being a section and becomes a page. */
const FILL_MAX = 12;
/**
 * The version stamp at the foot.
 *
 * ⚠️ COUNTED IN THE FILL, because it is drawn after the last block and the
 * fill measures the blocks only. Left out, it was six points too tall for the
 * page and took a whole third sheet for itself — a sheet containing the string
 * "cs-2026-08-a-draft" and nothing else. Anything drawn after the loop has to
 * be in this number.
 */
const STAMP_H = K.mm(7);
/**
 * Taken off the bottom of every part header.
 *
 * The shared sectionHeader leaves mm(5) below its band, which is right in the
 * motivation body where a paragraph follows it. On a form the next thing is a
 * caption in 6 pt small caps, and mm(5) under that reads as a hole.
 */
const PART_TRIM = K.mm(1.5);

/** Draw one ruled writing rule at `y`, `w` wide. */
function rule({ doc, c }: Chrome, x: number, y: number, w: number): void {
  doc
    .moveTo(x, y)
    .lineTo(x + w, y)
    .lineWidth(0.7)
    .strokeColor(c.hair)
    .stroke();
}

/** An empty tick box with its option label, returning the x it ended at. */
function tickBox(
  chrome: Chrome,
  text: string,
  x: number,
  y: number,
): number {
  const { doc, c, f } = chrome;
  const size = K.px(11);
  doc
    .rect(x, y + K.px(1.5), BOX, BOX)
    .lineWidth(0.8)
    .strokeColor(c.mut)
    .stroke();
  doc
    .font(f.sans)
    .fontSize(size)
    .fillColor(c.ink)
    .text(text, x + BOX + K.px(6), y, { lineBreak: false });
  return x + BOX + K.px(6) + doc.widthOfString(text) + K.px(18);
}

/**
 * How tall a block will be, measured before anything is drawn.
 *
 * ⚠️ MEASURED, NOT GUESSED. The prior-notice signature block was reserved with
 * a round 90 and landed alone on a page with seventy points of clear space
 * above it. On a form the same mistake is worse than ugly: a question stranded
 * from its tick boxes cannot be answered at all.
 */
function heightOf(chrome: Chrome, b: StatementBlock, w: number): number {
  const { doc, f } = chrome;
  switch (b.kind) {
    case 'note':
      return (
        doc
          .font(f.sans)
          .fontSize(K.px(10.5))
          .heightOfString(b.text, { width: w - K.mm(6), lineGap: K.px(3) }) +
        K.mm(4)
      );
    case 'part':
      return K.px(11) * 1.2 + K.px(14) + K.mm(5) - PART_TRIM;
    case 'text':
      return (
        doc
          .font(f.serif)
          .fontSize(K.BODY_SIZE)
          .heightOfString(b.text, { width: w, lineGap: K.BODY_LEADING }) +
        K.mm(3)
      );
    case 'field':
      return FIELD_H;
    case 'choice':
      // One caption line, then however many rows the boxes wrap onto.
      return K.px(8.5) * 1.2 + K.mm(2) + rowsFor(chrome, b.options, w) * TICK_ROW;
    case 'declare':
      return (
        doc
          .font(f.serif)
          .fontSize(K.BODY_SIZE)
          .heightOfString(`${b.number}.  ${b.text}`, {
            width: w - K.mm(8),
            lineGap: K.BODY_LEADING,
          }) +
        K.mm(3) +
        rowsFor(chrome, b.options, w - K.mm(8)) * K.mm(7) +
        K.mm(4)
      );
    case 'lines':
      return (
        (b.label
          ? doc
              .font(f.sans)
              .fontSize(K.px(10.5))
              .heightOfString(b.label, { width: w, lineGap: K.px(3) }) + K.mm(3)
          : 0) +
        (b.count === 'fill' ? FILL_MIN : b.count) * LINE_PITCH +
        K.mm(3)
      );
    // ⚠️ THESE TWO MUST AGREE WITH WHAT THE DRAWING ACTUALLY ADVANCES. The
    // signature block reserved mm(15) and advanced mm(18), so three
    // millimetres of every form were unaccounted for — which is how a block
    // ends up half a centimetre past the bottom of a page that measured fine.
    case 'sign':
      return SIGN_H;
    case 'commissioner':
      return K.mm(29) + K.mm(4);
  }
}

/** How many rows a run of tick boxes wraps onto at width `w`. */
function rowsFor(
  { doc, f }: Chrome,
  options: string[],
  w: number,
): number {
  doc.font(f.sans).fontSize(K.px(11));
  let rows = 1;
  let x = 0;
  for (const o of options) {
    const need = BOX + K.px(6) + doc.widthOfString(o) + K.px(18);
    if (x + need > w && x > 0) {
      rows += 1;
      x = 0;
    }
    x += need;
  }
  return rows;
}

/** Draw a run of tick boxes, wrapping. Returns the y below them. */
function tickRow(
  chrome: Chrome,
  options: string[],
  x0: number,
  y: number,
  w: number,
): number {
  const { doc, f } = chrome;
  doc.font(f.sans).fontSize(K.px(11));
  let x = x0;
  let cy = y;
  for (const o of options) {
    const need = BOX + K.px(6) + doc.widthOfString(o) + K.px(18);
    if (x + need > x0 + w && x > x0) {
      x = x0;
      cy += TICK_ROW;
    }
    x = tickBox(chrome, o, x, cy);
  }
  return cy + TICK_ROW;
}

/**
 * Render one character reference form, starting on a fresh page.
 *
 * Returns the page number it started on, for the contents.
 */
export function renderStatementForm(
  chrome: Chrome,
  form: CharacterStatementForm,
  /** Stamped small at the foot of the last block, so a returned form is traceable. */
  stampVersion = true,
): number {
  const { doc, c, f } = chrome;
  const X = K.PAD_X;
  const W = K.CONTENT_W;

  doc.addPage();
  const startedOn = doc.bufferedPageRange().count;
  doc.x = X;
  doc.y = K.BODY_TOP;

  // ── The masthead ──────────────────────────────────────────────────
  //
  // A form that arrives in somebody's inbox has to say what it is in the
  // first line, because unlike the rest of the pack it is read by a stranger
  // who did not ask for it.
  K.label(chrome, `FORM ${form.index} OF 2`, X, doc.y, W);
  doc.y += K.px(8.5) * 1.2 + K.mm(3);

  doc
    .font(f.sans)
    .fontSize(K.px(22))
    .fillColor(c.deep)
    .text(form.title, X, doc.y, {
      width: W,
      characterSpacing: K.px(22) * 0.06,
    });
  doc.y += K.mm(2);
  doc
    .font(f.serifItalic)
    .fontSize(K.px(12.5))
    .fillColor(c.sub)
    .text(form.subtitle, X, doc.y, { width: W });

  doc.y += K.mm(3);
  doc
    .moveTo(X, doc.y)
    .lineTo(X + W, doc.y)
    .lineWidth(2)
    .strokeColor(c.deep)
    .stroke();
  doc.y += K.mm(5);

  // ── The blocks ────────────────────────────────────────────────────
  //
  // `half` fields pair up: the first of a pair sets `pending`, the second
  // draws alongside it. Anything that is not a half field flushes the pair,
  // so a lone half at the end of a group still gets its own row.
  let pending: { label: string; value?: string } | null = null;
  const halfW = (W - K.mm(8)) / 2;

  const flush = () => {
    if (!pending) return;
    const y0 = doc.y;
    drawField(chrome, pending, X, y0, halfW);
    doc.y = y0 + FIELD_H;
    pending = null;
  };

  for (const b of form.blocks) {
    if (b.kind === 'field' && b.span === 'half') {
      if (pending) {
        // Second of the pair — but only if BOTH fit on this page, else the
        // pair splits across the fold and the reader loses the pairing.
        if (doc.y + FIELD_H > K.BODY_BOTTOM) {
          flush();
          doc.addPage();
          doc.y = K.BODY_TOP;
        }
        // ⚠️ CAPTURE y FIRST. K.label() writes with doc.text(), which ADVANCES
        // doc.y — so passing doc.y to the second call put the right-hand field
        // of every pair ten points below its partner. Visible on the first
        // render: "Identity or passport number" and "Contact number" sat on
        // two different rules, on a page whose whole job is to look like a form.
        const y0 = doc.y;
        drawField(chrome, pending, X, y0, halfW);
        drawField(chrome, b, X + halfW + K.mm(8), y0, halfW);
        doc.y = y0 + FIELD_H;
        pending = null;
      } else {
        pending = b;
      }
      continue;
    }

    flush();

    const h = heightOf(chrome, b, W);
    if (doc.y + h > K.BODY_BOTTOM) {
      doc.addPage();
      doc.y = K.BODY_TOP;
    }

    switch (b.kind) {
      case 'note': {
        // A quiet bar in the margin rather than a tinted box: the preamble is
        // three notes long, and three stacked boxes would read as three
        // warnings when it is one piece of context.
        const top = doc.y;
        doc
          .font(f.sans)
          .fontSize(K.px(10.5))
          .fillColor(c.sub)
          .text(b.text, X + K.mm(6), doc.y, {
            width: W - K.mm(6),
            lineGap: K.px(3),
            align: 'left',
          });
        doc
          .rect(X, top, K.px(2), doc.y - top)
          .fill(c.band);
        doc.x = X;
        doc.y += K.mm(4);
        break;
      }

      case 'part':
        doc.y = K.sectionHeader(chrome, b.label, b.title, doc.y) - PART_TRIM;
        doc.x = X;
        break;

      case 'text':
        doc
          .font(f.serif)
          .fontSize(K.BODY_SIZE)
          .fillColor(c.ink)
          .text(b.text, X, doc.y, { width: W, lineGap: K.BODY_LEADING });
        doc.x = X;
        doc.y += K.mm(3);
        break;

      case 'field': {
        const y0 = doc.y;
        drawField(chrome, b, X, y0, W);
        doc.y = y0 + FIELD_H;
        break;
      }

      case 'choice': {
        K.label(chrome, b.label, X, doc.y, W);
        doc.y += K.px(8.5) * 1.2 + K.mm(2);
        doc.y = tickRow(chrome, b.options, X, doc.y, W);
        doc.x = X;
        break;
      }

      case 'declare': {
        const top = doc.y;
        doc
          .font(f.serif)
          .fontSize(K.BODY_SIZE)
          .fillColor(c.ink)
          .text(`${b.number}.  ${b.text}`, X + K.mm(8), doc.y, {
            width: W - K.mm(8),
            lineGap: K.BODY_LEADING,
          });
        doc.y += K.mm(3);
        doc.y = tickRow(chrome, b.options, X + K.mm(8), doc.y, W - K.mm(8));
        // A hairline down the left of the question, tying it to its boxes.
        doc
          .moveTo(X + K.mm(2), top)
          .lineTo(X + K.mm(2), doc.y - K.mm(2))
          .lineWidth(0.7)
          .strokeColor(c.hair)
          .stroke();
        doc.x = X;
        doc.y += K.mm(3);
        break;
      }

      case 'lines': {
        // ⚠️ HOW MANY LINES FIT BEFORE THE BLOCKS THAT FOLLOW. Measured against
        // the REST of the form, not against the bottom of the page: the point
        // is to end the sheet exactly where the declaration ends, so nothing
        // spills onto a third page carrying a signature line and nothing else.
        let count = b.count === 'fill' ? FILL_MIN : b.count;
        if (b.count === 'fill') {
          const tail = form.blocks
            .slice(form.blocks.indexOf(b) + 1)
            .reduce((n, rest) => n + heightOf(chrome, rest, W), 0);
          const labelH = b.label
            ? doc
                .font(f.sans)
                .fontSize(K.px(10.5))
                .heightOfString(b.label, { width: W, lineGap: K.px(3) }) +
              K.mm(3)
            : 0;
          const room =
            K.BODY_BOTTOM - doc.y - labelH - tail - STAMP_H - K.mm(3);
          count = Math.max(
            FILL_MIN,
            Math.min(FILL_MAX, Math.floor(room / LINE_PITCH)),
          );
        }
        if (b.label) {
          doc
            .font(f.sans)
            .fontSize(K.px(10.5))
            .fillColor(c.sub)
            .text(b.label, X, doc.y, { width: W, lineGap: K.px(3) });
          doc.x = X;
          doc.y += K.mm(3);
        }
        for (let i = 0; i < count; i += 1) {
          // Break mid-run rather than shrinking the pitch: a ruled line you
          // cannot write on is worse than one on the next page.
          if (doc.y + LINE_PITCH > K.BODY_BOTTOM) {
            doc.addPage();
            doc.y = K.BODY_TOP;
          }
          doc.y += LINE_PITCH;
          rule(chrome, X, doc.y, W);
        }
        doc.y += K.mm(3);
        break;
      }

      case 'sign': {
        const sigW = W * 0.5 - K.mm(4);
        const dateW = W * 0.22 - K.mm(4);
        const placeW = W * 0.28;
        const y = doc.y + K.mm(8);
        rule(chrome, X, y, sigW);
        rule(chrome, X + sigW + K.mm(8), y, dateW);
        rule(chrome, X + sigW + dateW + K.mm(16), y, placeW);
        K.label(chrome, 'Signature', X, y + K.mm(2), sigW);
        K.label(chrome, 'Date', X + sigW + K.mm(8), y + K.mm(2), dateW);
        K.label(
          chrome,
          'Signed at',
          X + sigW + dateW + K.mm(16),
          y + K.mm(2),
          placeW,
        );
        doc.x = X;
        doc.y = y + K.mm(6);
        break;
      }

      case 'commissioner': {
        const boxH = K.mm(29);
        const top = doc.y;
        doc
          .rect(X, top, W, boxH)
          .lineWidth(0.8)
          .strokeColor(c.hair)
          .stroke();
        doc
          .font(f.sansSemi)
          .fontSize(K.px(9))
          .fillColor(c.mut)
          .text(
            'FOR COMMISSIONER OF OATHS — ONLY IF YOU HAVE BEEN ASKED FOR ONE',
            X + K.mm(5),
            top + K.mm(4),
            { width: W - K.mm(10), characterSpacing: K.px(9) * 0.12 },
          );

        const cW = (W - K.mm(10) - K.mm(8)) / 2;
        const r1 = top + K.mm(13);
        rule(chrome, X + K.mm(5), r1, cW);
        rule(chrome, X + K.mm(5) + cW + K.mm(8), r1, cW);
        K.label(chrome, 'Full names', X + K.mm(5), r1 + K.mm(2), cW);
        K.label(
          chrome,
          'Designation and area',
          X + K.mm(5) + cW + K.mm(8),
          r1 + K.mm(2),
          cW,
        );

        const r2 = top + K.mm(22);
        rule(chrome, X + K.mm(5), r2, cW);
        rule(chrome, X + K.mm(5) + cW + K.mm(8), r2, cW);
        K.label(chrome, 'Signature', X + K.mm(5), r2 + K.mm(2), cW);
        K.label(
          chrome,
          'Date and stamp',
          X + K.mm(5) + cW + K.mm(8),
          r2 + K.mm(2),
          cW,
        );

        doc.x = X;
        doc.y = top + boxH + K.mm(4);
        break;
      }
    }
  }

  flush();

  if (stampVersion) {
    // Small, at the foot: which wording this copy carries. A form that comes
    // back six months from now can be matched to what it actually said.
    //
    // ⚠️ CLAMPED, NEVER BROKEN ONTO A NEW PAGE. The fill above already reserves
    // room for it; this is the backstop for the case where it does not fit
    // anyway — and the right answer there is a stamp a few points higher than
    // planned, not an extra sheet of paper carrying a version string.
    const y = Math.min(doc.y + K.mm(2), K.BODY_BOTTOM - K.mm(4));
    doc
      .font(f.sans)
      .fontSize(K.px(8))
      .fillColor(c.mut)
      .text(form.version, X, y, { width: W, lineBreak: false });
    doc.x = X;
  }

  return startedOn;
}

/** One labelled field: caption in small caps, writing space, rule. */
function drawField(
  chrome: Chrome,
  b: { label: string; value?: string },
  x: number,
  y: number,
  w: number,
): void {
  const { doc, c, f } = chrome;
  if (b.label) K.label(chrome, b.label, x, y, w);
  if (b.value) {
    // Prefilled values are TYPED, in the body face — visibly ours rather than
    // something the referee is expected to write over.
    doc
      .font(f.serif)
      .fontSize(K.px(12))
      .fillColor(c.ink)
      .text(b.value, x, y + K.mm(3.6), { width: w, lineBreak: false });
  }
  rule(chrome, x, y + K.mm(8.5), w);
}
