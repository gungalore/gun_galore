// ────────────────────────────────────────────────────────────────────
// THE CARTRIDGE, FROM THE DIMENSION SHEET WE ALREADY HOLD.
//
// Operator, 2026-09-09: "why arent we pulling in the dimension sheet of the
// cartridge its using from The Bench? And describing the cartridge and how it
// would suffice for a self defence round?"
//
// ⚠️ IT IS THE ANSWER TO THE PRODUCT COPY, NOT MORE OF IT. MO000071 spent two
// sections reciting "115 to 147 grains", "3 to 5 foot-pounds", "terminal
// ballistics" — none of it supplied, all of it recalled, and every figure a
// Registrar could correct the applicant on. The Bench holds 215 dimension
// sheets: case length, overall length, bore, groove, bullet diameter and the
// pressure ceiling, measured and stored. Supplying those turns an invented
// paragraph into a cited one, and lets the prompt ban recall outright.
//
// ⚠️ DIMENSIONS AND PRESSURE ONLY — NEVER VELOCITY, ENERGY OR TERMINAL EFFECT.
// The sheet does not carry them, and they are the figures that read worst on a
// self-defence application. What the sheet DOES support is the argument that
// actually matters: this is a standardised cartridge, so factory ammunition is
// interchangeable and available, which is what "I can practise with it and buy
// it" rests on.
//
// ⚠️ AND IT NAMES NO SOURCE. CLAUDE.md's Bench rule is absolute — "nothing on
// any Bench surface may name where a figure comes from — no manual, no CIP, no
// SAAMI, no published, no source counts. This is a COPYRIGHT boundary, not
// tidiness." `bench.service.ts` enforces it with a FORBIDDEN_WORDS list. A
// motivation is not a Bench surface, but the boundary is about the data and
// not about the screen, so the block below carries figures and no provenance.
// ⚠️ IF THAT IS WRONG FOR A LEGAL DOCUMENT, IT IS THE OPERATOR'S CALL — an
// uncited measurement is weaker before a DFO than a cited one, and the rule
// was written for a load-data screen rather than for a signed submission.
//
// PURE — no Nest, no Prisma. The row is read by the caller.
// ────────────────────────────────────────────────────────────────────

/** The columns of a dimension sheet this module reads. */
export interface CartridgeDims {
  /** L3 — case length, mm. */
  L3?: number | null;
  /** L6 — maximum overall length, mm. */
  L6?: number | null;
  /** Bore diameter, mm. */
  bF?: number | null;
  /** Groove diameter, mm. */
  bZ?: number | null;
  /** Number of grooves. */
  bN?: number | null;
  /** Maximum average pressure, bar. */
  pmaxBar?: number | null;
}

export interface CartridgeRow {
  name: string;
  type?: string | null;
  origin?: string | null;
  year?: number | null;
  caseLengthMm?: number | null;
  maxLengthMm?: number | null;
  pmaxBar?: number | null;
  pmaxPsi?: number | null;
  dims?: CartridgeDims | null;
}

/**
 * The key a printed calibre reduces to.
 *
 * ⚠️ A LICENCE CARD DOES NOT SPELL A CARTRIDGE THE WAY A REFERENCE FILE DOES.
 * The card prints "9MM PAR ( 9X19MM )"; the sheet is filed under "9 mm Luger".
 * Case, spaces, punctuation and the bracketed second name are all noise, so
 * both sides are reduced to letters and digits before they are compared.
 */
export function calibreKey(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Every form of a printed calibre worth looking up, longest first.
 *
 * ⚠️ THE BRACKETED NAME IS A SECOND CANDIDATE, NOT NOISE TO STRIP. "9MM PAR
 * ( 9X19MM )" carries the cartridge's two names, and the reference file may be
 * filed under either — 9x19 is the one a dimension sheet is likelier to use.
 * Both are offered, and the caller takes the first that resolves.
 */
export function calibreCandidates(raw: string): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  const out: string[] = [];
  const push = (v: string) => {
    const k = calibreKey(v);
    if (k.length >= 2 && !out.includes(k)) out.push(k);
  };

  push(text);
  // The bracketed alternative, and the text with the bracket removed.
  for (const m of text.matchAll(/\(([^)]+)\)/g)) push(m[1]);
  push(text.replace(/\([^)]*\)/g, ''));

  /**
   * ⚠️ "PAR" IS "PARABELLUM" AND A REFERENCE FILE WRITES NEITHER. The card's
   * abbreviations are not the trade's; expanding the common ones costs nothing
   * and a cartridge we cannot place simply arrives without a block.
   */
  const expanded = text
    .replace(/\bPAR\b/gi, 'Parabellum')
    .replace(/\bREM\b/gi, 'Remington')
    .replace(/\bWIN\b/gi, 'Winchester')
    .replace(/\bSPRG?\b/gi, 'Springfield')
    .replace(/\bGOVT?\b/gi, 'Government')
    .replace(/\bMAG\b/gi, 'Magnum');
  push(expanded);
  push(expanded.replace(/\([^)]*\)/g, ''));
  return out;
}

/**
 * The cartridge block for the fact pack, or null when we hold no sheet.
 *
 * ⚠️ EVERY LINE IS A MEASUREMENT WE HOLD. A field the sheet does not carry is
 * omitted rather than estimated — the whole reason this block exists is that
 * the writer was recalling figures, and a gap it can see is a gap it can write
 * around. An empty block is better than a padded one.
 */
/** The shape any cartridge lookup needs, whatever else it selected. */
export interface NameableCartridge {
  name: string;
  slug?: string | null;
  aliases?: { printed: string }[];
}

/**
 * The cartridge a printed calibre names, or null.
 *
 * ⚠️ MATCHED IN MEMORY, NOT IN SQL, AND THAT IS NOT LAZINESS. The key is a
 * reduction — case, spaces and punctuation removed on BOTH sides — and there
 * is no index on a reduction. Two hundred-odd cartridges and their aliases is
 * a page, not a scan, and the alternative is a LIKE that cannot express
 * "9 mm Luger" matching "9MMLUGER".
 *
 * ⚠️ AND IT IS THE ONLY MATCHER. The fact pack and the drawing must resolve
 * the same calibre to the same cartridge, or a pack argues about one round and
 * prints the dimensions of another.
 */
export function findCartridge<T extends NameableCartridge>(
  rows: readonly T[],
  printed: string,
): T | null {
  for (const want of calibreCandidates(printed)) {
    const hit = rows.find(
      (c) =>
        calibreKey(c.name) === want ||
        (c.slug ? calibreKey(c.slug) === want : false) ||
        (c.aliases ?? []).some((a) => calibreKey(a.printed) === want),
    );
    if (hit) return hit;
  }
  return null;
}

export function cartridgeFacts(row: CartridgeRow | null): string | null {
  if (!row) return null;
  const d = row.dims ?? {};
  const lines: string[] = [];
  const add = (label: string, v: unknown, unit = '') => {
    if (v === null || v === undefined || v === '') return;
    lines.push(`  ${label}: ${v}${unit}`);
  };

  add('Standardised name', row.name);
  add('Type', row.type);
  add('Origin', row.origin);
  add('Introduced', row.year);
  add('Case length', d.L3 ?? row.caseLengthMm, ' mm');
  add('Maximum overall length', d.L6 ?? row.maxLengthMm, ' mm');
  add('Bore diameter', d.bF, ' mm');
  add('Groove diameter', d.bZ, ' mm');
  add('Grooves', d.bN);
  add('Maximum average pressure', d.pmaxBar ?? row.pmaxBar, ' bar');

  // A name on its own is not a dimension sheet, and a block with one line
  // invites the model to fill the rest from memory.
  if (lines.length < 3) return null;

  return [
    'THE CARTRIDGE — supplied measurements, not web research and not recall:',
    ...lines,
    '',
    'These are the cartridge’s standardised dimensions and its pressure',
    'ceiling. Because they are standardised, ammunition from any manufacturer',
    'is interchangeable in a firearm chambered for it, which is what makes it',
    'available and affordable to practise with. Use these figures and nothing',
    'else about the cartridge: do NOT add velocity, energy, stopping power,',
    'expansion, penetration, grain weights or any comparison with another',
    'cartridge. Do not name where these figures come from.',
  ].join('\n');
}
