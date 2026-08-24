import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  SAPS271_COORDS,
  Saps271Field,
  Saps271FieldName,
} from './saps271-coords';
import { buildSaps271, Saps271Input } from './saps271-map';

// ────────────────────────────────────────────────────────────────────
// FILLING THE SAPS 271 — BY DRAWING, not by setting form fields.
//
// WHY NOT THE FILLABLE TEMPLATE. The operator supplied a 271 with form fields
// added, and using them was the obvious plan. It cannot be done: a PDF field
// may own MANY WIDGETS, and setting its value paints into EVERY one of them.
// That template has 205 fields spread over 1136 widgets, 157 of them shared —
// `text_13` alone covers twelve boxes on different pages. Filling the
// applicant's calibre would have printed it in eleven other places, and the
// form would have looked deranged.
//
// This is not a defect in what the operator prepared; it is how the preparation
// tool names things. The measuring script now REFUSES to bind a shared name, so
// the failure is loud rather than a corrupted document.
//
// So: draw onto the ORIGINAL flat form, exactly as saps534.service.ts has done
// in production since June. The coordinates are not guesses — saps271-coords.ts
// derives them from the form's own ruling lines (a table's rules ARE its
// boxes), so each value lands in a cell the form itself drew.
//
// ⚠️ WHAT IS NEVER TOUCHED, and cannot be: signatures, dates of signing,
// sections A/B/C (police and CFR use), section F (the CURRENT OWNER's — the
// dealer fills and stamps it) and section K (the DFO's report). None of them
// appear in the coordinate map, so no code path here can reach them.
//
// ⚠️ WinAnsi CANNOT ENCODE A CHECKMARK and pdf-lib throws rather than
// substituting, so a tick is the letter X — which is what the form asks for
// anyway, in as many words: "(Indicate with an X)". It also cannot encode a
// newline, and it throws on MEASUREMENT, not on drawing, so whitespace is
// flattened before anything is measured.
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// THE FORM THE COORDINATES WERE MEASURED AGAINST.
//
// Every value on this form is placed by ABSOLUTE COORDINATE — page number, x,
// y — because the distributed SAPS 271 is a 12-page AcroForm whose 1,072 field
// names are randomised ("ZImnfo8UO" style), carry no meaning, and differ
// between copies of the form. Mapping by name is not an option, so the map is
// positional and every position is measured against ONE specific PDF.
//
// ⚠️ WHICH MAKES THE PDF ITSELF PART OF THE MAP. Replace it with a newer SAPS
// revision — a reflowed page, one extra line of preamble, a box moved 4 mm —
// and every coordinate still resolves, still draws, and lands somewhere
// slightly or entirely wrong. Nothing throws. The applicant gets a form that
// looks filled in, signs it, and hands it to a DFO with their ID number in the
// box beside the one it belongs in.
//
// That is the failure this guard exists to make impossible. The bytes are
// hashed on load and compared with the hash the map was built against; a
// mismatch REFUSES to fill. Never fill against an unverified map.
//
// ── WHEN THE FORM IS LEGITIMATELY REPLACED ─────────────────────────
//
// The refusal is the start of the correct procedure, not an obstacle to it:
//
//   1. Drop the new PDF in backend/assets/saps271-blank.pdf
//   2. Run: npm run saps271:checksum
//   3. RE-MEASURE the coordinate map against the new form — this is the real
//      work, and the checksum bump alone does NOT do it. Bumping the constant
//      without re-measuring silences the guard and reinstates exactly the
//      failure it was added to prevent.
//   4. Paste the new hash below, with the date and the SAPS revision.
// ────────────────────────────────────────────────────────────────────

/**
 * sha256 of backend/assets/saps271-blank.pdf, as the map was measured.
 *
 * Pinned 2026-08-24. Do not change without step 3 above.
 */
const TEMPLATE_SHA256 =
  '0d1a74484ab5831db8ebf4b0d11bf8b18e6c9e26b3e4c38631bfec6959e82bdd';

/** Below this the text is unreadable; the box is left blank instead. */
const MIN_FONT = 5.5;
const DEFAULT_FONT = 9;
const TICK_FONT = 10;

@Injectable()
export class Saps271Service {
  private readonly logger = new Logger(Saps271Service.name);
  private cached: Buffer | null = null;

  /**
   * Find the blank form across dev and production layouts.
   *
   * nest-cli.json does NOT copy non-TS assets into dist/, so a `__dirname` path
   * works locally and 404s in production. Same candidate list as
   * saps534.service.ts, for the same reason.
   */
  private loadTemplate(): Buffer {
    if (this.cached) return this.cached;
    const candidates = [
      path.join(process.cwd(), 'assets', 'saps271-blank.pdf'),
      path.join(process.cwd(), 'backend', 'assets', 'saps271-blank.pdf'),
      path.join(__dirname, '..', '..', 'assets', 'saps271-blank.pdf'),
      path.join(__dirname, '..', '..', '..', 'assets', 'saps271-blank.pdf'),
    ];
    for (const c of candidates) {
      let buf: Buffer;
      try {
        buf = fs.readFileSync(c);
      } catch {
        continue; // try the next candidate
      }

      // ⚠️ VERIFIED BEFORE IT IS CACHED, AND BEFORE A SINGLE VALUE IS DRAWN.
      // See the note on TEMPLATE_SHA256: the coordinates ARE the map, and the
      // map is only valid for this exact PDF.
      const sha = createHash('sha256').update(buf).digest('hex');
      if (sha !== TEMPLATE_SHA256) {
        this.logger.error(
          `SAPS 271 template at ${c} does not match the coordinate map ` +
            `(expected ${TEMPLATE_SHA256.slice(0, 12)}…, found ${sha.slice(0, 12)}…). ` +
            'Refusing to fill: every value is placed by absolute coordinate, so a ' +
            'different revision of the form would print into the wrong boxes. ' +
            're-measure the map, then update TEMPLATE_SHA256.',
        );
        throw new Error(
          'We cannot fill in your SAPS 271 at the moment — our copy of the form ' +
            'does not match the one we lay it out against, and filling it anyway ' +
            'could put your answers in the wrong boxes. Your motivation is ' +
            'unaffected and you can still download it. Please let us know so we ' +
            'can update the form.',
        );
      }

      this.cached = buf;
      return buf;
    }
    throw new Error(
      `saps271-blank.pdf not found. Tried: ${candidates.join(' | ')}`,
    );
  }

  /**
   * Produce a filled SAPS 271.
   *
   * Returns the bytes AND what was left blank, so the applicant is told which
   * boxes they still have to complete themselves rather than finding out at the
   * counter.
   */
  async build(
    input: Saps271Input,
  ): Promise<{ pdf: Buffer; leftBlank: { field: string; because: string }[] }> {
    const values = buildSaps271(input);
    const pdf = await PDFDocument.load(this.loadTemplate(), {
      ignoreEncryption: true,
    });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();

    for (const [key, value] of Object.entries(values.text)) {
      const spec = SAPS271_COORDS[key as Saps271FieldName] as Saps271Field;
      if (spec && value) this.write(spec, value, pages, font, key);
    }

    for (const key of values.ticks) {
      const spec = SAPS271_COORDS[key] as Saps271Field;
      if (spec?.kind === 'tick') this.tick(spec, pages, font);
    }

    const bytes = await pdf.save();
    return { pdf: Buffer.from(bytes), leftBlank: values.leftBlank };
  }

  /** One value: a run of character cells, or a line of text in a box. */
  private write(
    spec: Saps271Field,
    value: string,
    pages: PDFPage[],
    font: PDFFont,
    key: string,
  ): void {
    const page = pages[spec.page - 1];
    if (!page) return;

    if (spec.kind === 'chars') {
      // One character per cell, centred. Cells the form already prints a
      // separator into are skipped rather than stamped over.
      const chars = value.replace(/\s/g, '').split('');
      const cells = spec.cells.filter((c) => !c.sep);
      chars.forEach((ch, i) => {
        const cell = cells[i];
        if (!cell) return;
        page.drawText(ch, {
          x: cell.x - font.widthOfTextAtSize(ch, DEFAULT_FONT) / 2,
          y: spec.y + spec.h / 2 - DEFAULT_FONT / 2 + 1,
          size: DEFAULT_FONT,
          font,
          color: rgb(0, 0, 0),
        });
      });
      if (chars.length > cells.length) {
        this.logger.warn(
          `SAPS 271: "${key}" is ${chars.length} characters but the form gives ${cells.length} cells; the remainder was not written`,
        );
      }
      return;
    }

    if (spec.kind !== 'text') return;

    // Flattened BEFORE measuring: WinAnsi cannot encode a newline and pdf-lib
    // throws on widthOfTextAtSize, not on drawText.
    const flat = value.replace(/\s+/g, ' ').trim();
    let size = DEFAULT_FONT;
    while (size > MIN_FONT && font.widthOfTextAtSize(flat, size) > spec.w) {
      size -= 0.25;
    }
    if (font.widthOfTextAtSize(flat, size) > spec.w) {
      // Still too wide at the floor. An empty box the applicant completes is a
      // nuisance; text running past its box into the printed label beside it
      // reads as an answer to a different question.
      this.logger.warn(
        `SAPS 271: "${key}" does not fit its box even at ${MIN_FONT}pt; left blank`,
      );
      return;
    }
    page.drawText(flat, {
      x: spec.x,
      y: spec.y + spec.h / 2 - size / 2 + 1,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  }

  /** One mark. */
  private tick(
    spec: Extract<Saps271Field, { kind: 'tick' }>,
    pages: PDFPage[],
    font: PDFFont,
  ): void {
    const page = pages[spec.page - 1];
    if (!page) return;

    if (spec.overLabel) {
      // THE TARGET IS THE PRINTED WORD ITSELF. Gender is the case: the form
      // prints "Male" and "Female" in adjacent cells with no empty box between
      // them, so there is nowhere to put an X without stamping across a word
      // and making both unreadable.
      //
      // So it is RINGED instead — which is what a person does on a form with no
      // tick box, and leaves the word legible underneath. Inset slightly so the
      // ring sits inside the cell and not on the rule.
      const inset = 1.5;
      page.drawEllipse({
        x: spec.x,
        y: spec.y,
        xScale: Math.max(6, spec.w / 2 - inset),
        yScale: Math.max(4, spec.h / 2 - inset),
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
        opacity: 0,
      });
      return;
    }

    page.drawText('X', {
      x: spec.x - font.widthOfTextAtSize('X', TICK_FONT) / 2,
      y: spec.y - TICK_FONT / 2 + 1,
      size: TICK_FONT,
      font,
      color: rgb(0, 0, 0),
    });
  }
}
