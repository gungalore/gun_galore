import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

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
}

/** A short line ending in a colon reads as a section heading. */
function isHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 80 && t.endsWith(':');
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

    // ── Footers on every page ─────────────────────────────────────────
    // bufferPages lets us number pages only once the total is known.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const footerY = PAGE_HEIGHT - MARGIN + 26;
      doc
        .font(FONT)
        .fontSize(7.5)
        .fillColor(GREY)
        .text(
          `${input.referenceNumber} · page ${i + 1} of ${range.count} · prepared with All Outdoor (${input.templateVersion})`,
          MARGIN,
          footerY,
          { width: contentWidth, align: 'center', lineBreak: false },
        );
    }

    doc.end();
    const pdf = await done;
    return { pdf, filename: `motivation-${input.referenceNumber}.pdf` };
  }
}
