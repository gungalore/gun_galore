import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { cartridgeKey } from '../common/cartridge-key';
import CIP_INDEX from './cip-index.json';

// ────────────────────────────────────────────────────────────────────
// THE C.I.P. CARTRIDGE DATASHEET, AS A PAGE IN THE PACK.
//
// Operator, 2026-08-23: "i want to insert the full cartridge page into the
// motivation. Showing the dimensions and everything on the page."
//
// C.I.P. is the Commission Internationale Permanente — the European proof
// body — and its Tables of Dimensions of Cartridges and Chambers are the
// standard the chamber and pressure figures come from. One sheet per
// cartridge: case and chamber geometry, maximum and proof pressures, bore and
// groove diameters, rifling twist.
//
// ⚠️ LICENSING IS AN OPEN QUESTION AND IT IS NOT MINE TO CLOSE. Extracting the
// factual numbers into our own tables is one thing; reproducing C.I.P.'s own
// typeset page inside a document we generate for a paying member is
// republication of somebody else's work. It was flagged to the operator when
// this was built. If the answer comes back no, the switch is
// `cip_sheet_enabled` — the data extraction survives, only the page goes.
//
// ⚠️ EXACT KEY MATCH ONLY. NEVER FUZZY. The cartridge panel has already been
// through this once: a 43-agent audit caught twelve DANGEROUS fuzzy
// mismatches, fixed with a curated overrides map. A near-miss here is not a
// cosmetic error — it puts a datasheet in front of a DFO asserting chamber
// dimensions and a maximum pressure for the WRONG cartridge, inside a document
// the applicant signs. When the digit sequences alone are compared, "22 BR
// Rem" matches "22 Long Rifle"; that is the whole argument. No match means no
// annexure, which costs nothing.
// ────────────────────────────────────────────────────────────────────

/**
 * Where the split sheets live.
 *
 * ⚠️ OUTSIDE THE REPOSITORY ON PURPOSE. 552 sheets is 40MB; committing that
 * would put a binary blob the size of the entire source tree into every clone,
 * and a deploy that does `git pull` would rewrite it every time. The INDEX is
 * in the repo (61KB of JSON, reviewable in a diff); the pages sit in a data
 * directory the deploy never touches.
 */
const SHEETS_DIR =
  process.env.CIP_SHEETS_DIR ?? '/home/alloutdoor/data/cip';

/** A4 in points, which is what the pack is. */
const A4_W = 595.28;
const A4_H = 841.89;

interface IndexEntry {
  name: string;
  pmaxBar: number | null;
  twistMm: number | null;
  file: string;
}

const INDEX: Record<string, IndexEntry> = CIP_INDEX as Record<
  string,
  IndexEntry
>;

/**
 * C.I.P.'s own abbreviations, mapped into the vocabulary our stored keys use.
 *
 * ⚠️ THIS MUST NEVER MOVE INTO CART_ALIASES. cartridgeKey() computed
 * ManualLoad.cartridgeKey at seed time for 50 789 rows and is CartridgeSpec's
 * PRIMARY KEY. Adding a word to the shared alias map would re-key every new
 * lookup away from every row already stored — the joins would not error, they
 * would simply stop finding anything. Normalising on the C.I.P. side only
 * leaves the database untouched.
 */
const CIP_WORDS: Record<string, string> = {
  govt: 'government',
  auto: 'automatic',
};

function cipKey(name: string): string {
  return cartridgeKey(
    name
      // C.I.P. writes European decimals: "5,6 x 50". A notation difference,
      // not a semantic guess.
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/[A-Za-z]+/g, (w) => CIP_WORDS[w.toLowerCase()] ?? w),
  );
}

export interface CipSheet {
  /** C.I.P.'s own name for the cartridge, e.g. "6,5 Creedmoor". */
  name: string;
  pmaxBar: number | null;
  /** Rifling twist, in millimetres per turn. */
  twistMm: number | null;
  /** One-page PDF, already scaled to A4. */
  bytes: Buffer;
}

@Injectable()
export class CipSheetService {
  private readonly logger = new Logger(CipSheetService.name);

  /** What C.I.P. holds for a cartridge, without reading the page off disk. */
  lookup(cartridgeName: string): (IndexEntry & { key: string }) | null {
    const key = cartridgeKey(cartridgeName);
    const direct = INDEX[key];
    if (direct) return { ...direct, key };
    // The C.I.P.-side normalisation, tried second so a key that already
    // matches exactly is never rewritten.
    const alt = cipKey(cartridgeName);
    return INDEX[alt] ? { ...INDEX[alt], key: alt } : null;
  }

  /**
   * The datasheet for a cartridge, as a one-page A4 PDF.
   *
   * ⚠️ SCALED, AND THIS IS THE ONE PLACE RESCALING IS RIGHT. The merge pass
   * refuses to rescale and says why: "resampling somebody's licence to fit A4
   * is how a serial number stops being legible." That is true of a
   * PHOTOGRAPH. A C.I.P. sheet is vector line art on US Letter, where scaling
   * is arithmetic and lossless — and leaving it unscaled puts one 216x279mm
   * page in the middle of an A4 pack, which prints wrong and reads as a
   * mistake.
   *
   * Returns null for anything it cannot serve. A missing sheet is a missing
   * annexure and nothing more.
   */
  async sheetFor(cartridgeName: string): Promise<CipSheet | null> {
    const hit = this.lookup(cartridgeName);
    if (!hit) return null;

    const file = path.join(SHEETS_DIR, path.basename(hit.file));
    let raw: Buffer;
    try {
      raw = await fs.promises.readFile(file);
    } catch {
      // The data directory is not deployed with the code, so a box that has
      // never had it rsynced answers this way. Worth one line, not a throw.
      this.logger.warn(`C.I.P. sheet missing on disk: ${hit.file}`);
      return null;
    }

    try {
      const src = await PDFDocument.load(raw, { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const [embedded] = await out.embedPages([src.getPage(0)]);
      const page = out.addPage([A4_W, A4_H]);
      // Fit inside A4 and centre. Uniform scale: a datasheet stretched on one
      // axis is a drawing whose stated dimensions no longer match its own
      // scale bar.
      const s = Math.min(A4_W / embedded.width, A4_H / embedded.height);
      page.drawPage(embedded, {
        xScale: s,
        yScale: s,
        x: (A4_W - embedded.width * s) / 2,
        y: (A4_H - embedded.height * s) / 2,
      });
      return {
        name: hit.name,
        pmaxBar: hit.pmaxBar,
        twistMm: hit.twistMm,
        bytes: Buffer.from(await out.save()),
      };
    } catch (err) {
      this.logger.warn(
        `C.I.P. sheet ${hit.file} would not render: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
