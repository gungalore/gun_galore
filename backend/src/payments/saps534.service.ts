import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────
// SAP 534 "Transfer of Firearm Ownership" PDF prefill (Phase 3).
//
// We do NOT have an AcroForm to fill — the official e534 form is a FLAT
// PDF. So we load it with pdf-lib and OVERLAY the data we hold onto the
// blank boxes by absolute coordinate. The seller still prints it, signs
// it, gets it dealer-stamped, and uploads it back; this just saves them
// re-typing the particulars we already store.
//
// We ONLY prefill the bits we legitimately hold:
//   • Section C "PARTICULARS OF CURRENT OWNER" (the seller) — surname,
//     initials, SA ID number, residential + postal address, phone(s),
//     e-mail.
//   • Section D "DETAILS OF FIREARM(S)" — calibre, make, model, and the
//     firearm serial (placed on the Frame serial line, or the Barrel
//     serial line when the listing is a barrel category). Type is LEFT
//     BLANK on purpose (the SAPS "type" taxonomy doesn't map cleanly to
//     our category; the seller/dealer ticks/writes it).
//
// We DELIBERATELY leave blank: Section A/B (police use only), Section E
// (dealer), and every signature/date block (pages 3–4).
//
// COORDINATES were derived from the blank PDF's word bounding boxes
// using pdfplumber (page size 596 x 842 pt, ~A4). pdfplumber reports
// `top` from the TOP edge; pdf-lib's origin is BOTTOM-left, so for a
// label at pdfplumber-top T we draw at y = PAGE_HEIGHT - T - <nudge>.
// The map below stores the already-converted bottom-left (x, y) so it
// reads naturally and is easy to tune. If the official form is ever
// re-issued, re-run the pdfplumber extract and re-tune these numbers.
// ────────────────────────────────────────────────────────────────────

const PAGE_HEIGHT = 842;

// Convert a pdfplumber "top" (distance from top edge of the page) into
// a pdf-lib bottom-left y. The small subtraction nudges the text down
// onto the writing line of the box rather than sitting on the label.
const fromTop = (top: number, nudgeDown = 11) => PAGE_HEIGHT - top - nudgeDown;

interface FieldPos {
  x: number;
  y: number;
  size?: number;
  /** Max width before we shrink the font to fit (rough char-fit). */
  maxWidth?: number;
}

// ─── Section C — page 1 (index 0). Coordinates are bottom-left (pt). ──
const SECTION_C: Record<string, FieldPos> = {
  // Row 3 "Identity number of natural person" (label top 505.8). The
  // form has dashed digit groups; we just write the full ID across the
  // data area to the right of the label.
  idNumber: { x: 200, y: fromTop(505.8, 9), size: 11, maxWidth: 330 },
  // Row 5 "Surname" (label top 542, x 51) — value to the right.
  surname: { x: 112, y: fromTop(542, 10), size: 11, maxWidth: 300 },
  // Row 6 "Initials" (label top 542, x 442) — value to the right.
  initials: { x: 492, y: fromTop(542, 10), size: 11, maxWidth: 90 },
  // Row 7 "Residential address" (label top 560) — value to the right.
  residentialAddress: { x: 150, y: fromTop(560, 8), size: 9, maxWidth: 260 },
  // Row 8 "Postal Code" for residential (label top 578, x 432).
  residentialPostalCode: { x: 498, y: fromTop(578, 8), size: 10, maxWidth: 80 },
  // Row 9 "Postal address" (label top 596).
  postalAddress: { x: 150, y: fromTop(596, 8), size: 9, maxWidth: 260 },
  // Row 10 "Postal Code" for postal (label top 614, x 433).
  postalPostalCode: { x: 498, y: fromTop(614, 8), size: 10, maxWidth: 80 },
  // Row 11.1 "Home" telephone — between the ( ) at x 215 / 245.
  homePhone: { x: 222, y: fromTop(632.6, 8), size: 9, maxWidth: 110 },
  // Row 11.3 "Cellphone number" (label top 650.7).
  cellPhone: { x: 150, y: fromTop(650.7, 8), size: 10, maxWidth: 170 },
  // Row 13 "E-mail address" (label top 668.8).
  email: { x: 150, y: fromTop(668.8, 8), size: 9, maxWidth: 380 },
};

// ─── Section D — page 2 (index 1). Coordinates are bottom-left (pt). ──
// The firearm-detail grid has data columns (1)..(4); we only fill the
// FIRST firearm, whose column (1) starts at pdfplumber-x ≈ 210.
const FIREARM_COL1_X = 212;
const SECTION_D: Record<string, FieldPos> = {
  // Row 2 "Type" (top 517.8) — LEFT BLANK on purpose. Kept here so the
  // coordinate is documented if we ever decide to map it.
  // type:   { x: FIREARM_COL1_X, y: fromTop(517.8, 6), size: 9 },
  calibre: { x: FIREARM_COL1_X, y: fromTop(536.2, 6), size: 9, maxWidth: 90 },
  make: { x: FIREARM_COL1_X, y: fromTop(554.7, 6), size: 9, maxWidth: 90 },
  model: { x: FIREARM_COL1_X, y: fromTop(573.4, 6), size: 9, maxWidth: 90 },
  // Row 6 "Barrel serial number" (top 610.2).
  barrelSerial: { x: FIREARM_COL1_X, y: fromTop(610.2, 6), size: 9, maxWidth: 90 },
  // Row 7 "Frame serial number" (top 647.1) — default home for the serial.
  frameSerial: { x: FIREARM_COL1_X, y: fromTop(647.1, 6), size: 9, maxWidth: 90 },
};

export interface Saps534Data {
  // ─── Section C (seller / current owner) ───
  surname?: string | null;
  /** First name(s) — used to DERIVE initials when `initials` not given. */
  firstNames?: string | null;
  /** Pre-derived initials; falls back to deriving from firstNames. */
  initials?: string | null;
  /** Plaintext 13-digit SA ID. Left blank on the form if absent. */
  idNumber?: string | null;
  residentialAddress?: string | null;
  residentialPostalCode?: string | null;
  postalAddress?: string | null;
  postalPostalCode?: string | null;
  homePhone?: string | null;
  cellPhone?: string | null;
  email?: string | null;

  // ─── Section D (firearm) ───
  calibre?: string | null;
  make?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  /** When true, the serial goes on the Barrel line instead of Frame. */
  isBarrel?: boolean;
}

@Injectable()
export class Saps534Service {
  private readonly logger = new Logger(Saps534Service.name);
  private blankCache: Buffer | null = null;

  /**
   * Locate the blank form at runtime. Nest builds to dist/ and our
   * nest-cli.json does NOT copy non-TS assets, so we resolve from a set
   * of candidate roots rather than relying on __dirname/dist layout.
   * process.cwd() is the backend dir for both `nest start` (dev) and
   * `node dist/src/main` (prod), so assets/ resolves there first.
   */
  private loadBlank(): Buffer {
    if (this.blankCache) return this.blankCache;
    const candidates = [
      path.join(process.cwd(), 'assets', 'saps534-blank.pdf'),
      // dist-relative fallback (in case a future build DOES copy assets):
      path.join(__dirname, '..', '..', 'assets', 'saps534-blank.pdf'),
      path.join(__dirname, '..', '..', '..', 'assets', 'saps534-blank.pdf'),
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) {
          this.blankCache = fs.readFileSync(c);
          return this.blankCache;
        }
      } catch {
        /* try next candidate */
      }
    }
    throw new Error(
      `saps534-blank.pdf not found. Tried: ${candidates.join(' | ')}`,
    );
  }

  /**
   * Build a prefilled SAP 534 as a PDF Buffer. Never throws on missing
   * field values — absent fields are simply left blank on the form so
   * the seller can complete them by hand. Throws only if the blank
   * template can't be loaded or the PDF can't be rendered (caller must
   * wrap this in try/catch — it sits on a non-critical path).
   */
  async build(data: Saps534Data): Promise<Buffer> {
    const blank = this.loadBlank();
    const pdf = await PDFDocument.load(blank);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    const page1 = pages[0];
    const page2 = pages[1];

    // ─── Section C (page 1) ───
    if (page1) {
      this.put(page1, font, SECTION_C.surname, data.surname);
      this.put(
        page1,
        font,
        SECTION_C.initials,
        data.initials || deriveInitials(data.firstNames),
      );
      this.put(page1, font, SECTION_C.idNumber, spreadId(data.idNumber));
      this.put(
        page1,
        font,
        SECTION_C.residentialAddress,
        data.residentialAddress,
      );
      this.put(
        page1,
        font,
        SECTION_C.residentialPostalCode,
        data.residentialPostalCode,
      );
      this.put(page1, font, SECTION_C.postalAddress, data.postalAddress);
      this.put(page1, font, SECTION_C.postalPostalCode, data.postalPostalCode);
      this.put(page1, font, SECTION_C.homePhone, data.homePhone);
      this.put(page1, font, SECTION_C.cellPhone, data.cellPhone);
      this.put(page1, font, SECTION_C.email, data.email);
    }

    // ─── Section D (page 2) ───
    if (page2) {
      this.put(page2, font, SECTION_D.calibre, data.calibre);
      this.put(page2, font, SECTION_D.make, data.make);
      this.put(page2, font, SECTION_D.model, data.model);
      // Serial goes on the Barrel line for barrel categories, else Frame.
      const serialPos = data.isBarrel
        ? SECTION_D.barrelSerial
        : SECTION_D.frameSerial;
      this.put(page2, font, serialPos, data.serialNumber);
    }

    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }

  /**
   * Draw one value at a mapped position. No-op when the value is empty
   * (we leave the form box blank for the seller to fill). Shrinks the
   * font down to a floor so long values don't overrun their box.
   */
  private put(
    page: PDFPage,
    font: PDFFont,
    pos: FieldPos | undefined,
    value: string | null | undefined,
  ) {
    if (!pos) return;
    const text = (value ?? '').toString().trim();
    if (!text) return;

    let size = pos.size ?? 10;
    if (pos.maxWidth) {
      // Shrink to fit, floor at 6pt so it stays legible.
      while (size > 6 && font.widthOfTextAtSize(text, size) > pos.maxWidth) {
        size -= 0.5;
      }
    }
    page.drawText(text, {
      x: pos.x,
      y: pos.y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Derive initials from first name(s): "John Michael" → "J.M.".
 * Returns '' when we have nothing to work with.
 */
export function deriveInitials(firstNames?: string | null): string {
  const s = (firstNames ?? '').trim();
  if (!s) return '';
  return (
    s
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + '.')
      .join('')
  );
}

/**
 * Space out a 13-digit SA ID a little so the digits land roughly in the
 * dashed digit-group cells on the form. Non-13-digit values are passed
 * through unchanged (e.g. a passport number). Empty → ''.
 */
function spreadId(id?: string | null): string {
  const raw = (id ?? '').trim();
  if (!raw) return '';
  if (/^\d{13}$/.test(raw)) {
    // SA ID groups: YYMMDD G SSS C A Z  → space them lightly.
    return `${raw.slice(0, 6)}  ${raw.slice(6, 10)}  ${raw.slice(10, 13)}`;
  }
  return raw;
}
