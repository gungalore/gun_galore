import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  GAP,
  captionFor,
  planAnnexurePages,
} from './motivation-annexure-layout';
import {
  appendPdfAnnexures,
  extraPageCount,
  loadPdfAnnexures,
  type PdfAnnexure,
} from './motivation-pdf-merge';
import type { AnnexureEntry } from './motivation-checklist';

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
// No red, no branding beyond one discreet footer line.
//
// NOTHING IS STORED. Like ReceiptService, the bytes are built on demand from
// the encrypted document text and streamed. There is no PDF on disk, in the DB
// or on Cloudinary — which also means the POPIA erasure endpoint has no assets
// to chase.
// ────────────────────────────────────────────────────────────────────

/** Page geometry, in points. A4 with ~25 mm margins. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 71; // ≈25 mm

const BLACK = '#111111';
const GREY = '#555555';
const RULE = '#999999';

const FONT = 'Times-Roman';
const FONT_BOLD = 'Times-Bold';
const FONT_ITALIC = 'Times-Italic';

const BODY_SIZE = 11.5;
const BODY_LEADING = 5; // extra line gap; pdfkit calls this `lineGap`

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
   * What the applicant physically carries to the DFO.
   *
   * ⚠️ THE TICK BOXES STAY DIGITAL — that decision holds (operator,
   * 2026-08-18). This is the other half of it: once the pack IS printed, the
   * paper needs to say what goes with it, because the person walking into the
   * station is holding paper and not a phone.
   */
  takeWithYou?: { label: string; note?: string }[];
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
}

@Injectable()
export class MotivationPdfService {
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
      margins: {
        top: MARGIN,
        bottom: MARGIN,
        left: MARGIN,
        right: MARGIN,
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

    const contentWidth = PAGE_WIDTH - MARGIN * 2;

    // ── Header ────────────────────────────────────────────────────────
    doc
      .font(FONT_BOLD)
      .fontSize(15)
      .fillColor(BLACK)
      .text('MOTIVATION IN SUPPORT OF AN APPLICATION', {
        width: contentWidth,
        align: 'center',
      });
    doc
      .font(FONT)
      .fontSize(11)
      .fillColor(GREY)
      .text(input.licenceTypeLabel, {
        width: contentWidth,
        align: 'center',
      });
    doc.moveDown(0.8);

    // Thin rule under the header.
    const ruleY = doc.y;
    doc
      .moveTo(MARGIN, ruleY)
      .lineTo(PAGE_WIDTH - MARGIN, ruleY)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.9);

    // ── Applicant + reference block ───────────────────────────────────
    doc.font(FONT).fontSize(BODY_SIZE).fillColor(BLACK);
    doc.text(`Applicant: ${input.applicantName}`, { width: contentWidth });
    doc.text(`Document reference: ${input.referenceNumber}`, {
      width: contentWidth,
    });
    doc.text(
      `Date: ${input.generatedAt.toLocaleDateString('en-ZA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`,
      { width: contentWidth },
    );
    doc.moveDown(1.1);

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
        if (doc.y > PAGE_HEIGHT - MARGIN - 90) doc.addPage();
        doc.moveDown(0.5);
        doc
          .font(FONT_BOLD)
          .fontSize(BODY_SIZE + 0.5)
          .fillColor(BLACK)
          .text(block, { width: contentWidth, lineGap: BODY_LEADING });
        doc.moveDown(0.25);
      } else {
        doc
          .font(FONT)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(block, {
            width: contentWidth,
            align: 'justify',
            lineGap: BODY_LEADING,
          });
        doc.moveDown(0.6);
      }
    }

    // ── Signature block ───────────────────────────────────────────────
    // The applicant signs this as their own motivation — that is what the
    // declaration in the app commits them to, and the document has to carry a
    // place to do it.
    if (doc.y > PAGE_HEIGHT - MARGIN - 140) doc.addPage();
    doc.moveDown(1.5);
    doc.font(FONT).fontSize(BODY_SIZE).fillColor(BLACK);
    const sigY = doc.y + 26;
    doc
      .moveTo(MARGIN, sigY)
      .lineTo(MARGIN + 230, sigY)
      .lineWidth(0.5)
      .strokeColor(BLACK)
      .stroke();
    doc.y = sigY + 5;
    doc.text(input.applicantName, { width: 230 });
    doc.font(FONT_ITALIC).fillColor(GREY).text('Signature and date', {
      width: 230,
    });

    // ── Disclaimer ────────────────────────────────────────────────────
    if (doc.y > PAGE_HEIGHT - MARGIN - 120) doc.addPage();
    doc.moveDown(1.2);
    const discY = doc.y;
    doc
      .moveTo(MARGIN, discY)
      .lineTo(PAGE_WIDTH - MARGIN, discY)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.5);
    doc
      .font(FONT_ITALIC)
      .fontSize(8.5)
      .fillColor(GREY)
      .text(input.disclaimer, { width: contentWidth, lineGap: 1.5 });

    // ── What to take to the station ───────────────────────────────────
    //
    // Last page but one, before the annexures, because it is the page the
    // applicant reads on the morning they go.
    if (input.takeWithYou?.length) {
      doc.addPage();
      doc
        .font(FONT_BOLD)
        .fontSize(13)
        .fillColor(BLACK)
        .text('TAKE THESE WITH YOU', { width: contentWidth });
      doc.moveDown(0.4);
      doc
        .font(FONT)
        .fontSize(9.5)
        .fillColor(GREY)
        .text(
          'This motivation and its annexures are only part of the application. ' +
            'A Designated Firearms Officer does not have to accept an incomplete ' +
            'application and will not issue the acknowledgement of receipt until it ' +
            'is complete, so it is worth checking every line before you travel. ' +
            'Requirements differ between stations and this list is not exhaustive — ' +
            'confirm it with your own DFO.',
          { width: contentWidth, lineGap: 1.5 },
        );
      doc.moveDown(0.8);

      for (const item of input.takeWithYou) {
        // An empty box to tick with a pen. The applicant is standing at a
        // kitchen table with a pile of paper, not looking at a screen.
        const y = doc.y;
        doc
          .rect(MARGIN + 1, y + 1.5, 8, 8)
          .lineWidth(0.7)
          .strokeColor(GREY)
          .stroke();
        doc
          .font(FONT)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(item.label, MARGIN + 16, y, { width: contentWidth - 16 });
        if (item.note) {
          doc
            .font(FONT_ITALIC)
            .fontSize(8.5)
            .fillColor(GREY)
            .text(item.note, MARGIN + 16, doc.y, { width: contentWidth - 16 });
        }
        doc.moveDown(0.45);
      }
    }

    // ── Annexure index ────────────────────────────────────────────────
    if (input.annexures?.length) {
      doc.addPage();
      doc
        .font(FONT_BOLD)
        .fontSize(13)
        .fillColor(BLACK)
        .text('ANNEXURES', { width: contentWidth });
      doc.moveDown(0.4);
      doc
        .font(FONT)
        .fontSize(9.5)
        .fillColor(GREY)
        .text(
          'The documents listed below are attached in this order and are referred to in the motivation.',
          { width: contentWidth },
        );
      doc.moveDown(0.8);

      for (const a of input.annexures) {
        const y = doc.y;
        doc
          .font(FONT_BOLD)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(`Annexure ${a.letter}`, MARGIN, y, { width: 90 });
        doc
          .font(FONT)
          .fontSize(BODY_SIZE)
          .fillColor(BLACK)
          .text(
            a.count > 1 ? `${a.label} (${a.count} items)` : a.label,
            MARGIN + 95,
            y,
            { width: contentWidth - 95 },
          );
        doc.moveDown(0.45);
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
        })),
        {
          x: MARGIN,
          y: MARGIN,
          width: contentWidth,
          height: PAGE_HEIGHT - MARGIN * 2,
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
    const range = doc.bufferedPageRange();
    const totalPages = range.count + extraPageCount(merged.loaded);
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = PAGE_HEIGHT - MARGIN + 26;
      doc
        .font(FONT)
        .fontSize(7.5)
        .fillColor(GREY)
        .text(
          `${input.referenceNumber} · page ${i + 1} of ${totalPages} · prepared with All Outdoor (${input.templateVersion})`,
          MARGIN,
          footerY,
          { width: contentWidth, align: 'center', lineBreak: false },
        );
      doc.page.margins.bottom = keep;
    }

    doc.end();
    const body = await done;

    // The PDF annexures, printed into the pack rather than listed as missing.
    const pdf = await appendPdfAnnexures(body, merged.loaded, {
      referenceNumber: input.referenceNumber,
      templateVersion: input.templateVersion,
      bodyPageCount: range.count,
    });
    return { pdf, filename: `motivation-${input.referenceNumber}.pdf` };
  }
}
