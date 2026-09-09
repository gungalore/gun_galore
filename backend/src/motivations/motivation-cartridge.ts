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

  /**
   * ⚠️ AND THE CONTRACTION, BECAUSE THE EXPANSION RUNS THE WRONG WAY HALF THE
   * TIME. The sheets are filed under ".357 Mag." and "308 Winchester" — one
   * abbreviated, one not — so expanding only ever fixed the second kind. An
   * applicant typing ".357 Magnum", which is how the round is actually
   * written, matched nothing at all.
   */
  const contracted = text
    .replace(/\bParabellum\b/gi, 'Luger')
    .replace(/\bMagnum\b/gi, 'Mag')
    .replace(/\bAutomatic\b/gi, 'Auto')
    .replace(/\bSpecial\b/gi, 'Spec');
  push(contracted);

  /**
   * ⚠️ PARABELLUM IS LUGER — THAT IS A STANDARDS FACT, NOT A GUESS. The same
   * round carries two names in different markets and a member writes whichever
   * one is stamped on their box. Everything in this list is one cartridge under
   * two published names; nothing here narrows an ambiguous name to a likely one.
   */
  for (const v of [text, expanded]) {
    push(v.replace(/\bParabellum\b/gi, 'Luger'));
    push(v.replace(/\bACP\b/gi, 'Auto'));
  }
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
/** Every name one row answers to, reduced. */
function keysOf(c: NameableCartridge): string[] {
  const out = [calibreKey(c.name)];
  if (c.slug) out.push(calibreKey(c.slug));
  for (const a of c.aliases ?? []) out.push(calibreKey(a.printed));
  return out.filter(Boolean);
}

/**
 * The rows matching a reduced key under `test`, deduplicated BY ROW.
 *
 * ⚠️ COUNTED IN CARTRIDGES, NOT IN STRINGS. "9MM" prefixes four stored names
 * that belong to three different rounds; counting the strings would say four
 * and counting them wrong — as one — is how a .380 gets the dimensions of a
 * 9 mm Luger printed against it.
 */
function matching<T extends NameableCartridge>(
  rows: readonly T[],
  test: (key: string) => boolean,
): T[] {
  return rows.filter((c) => keysOf(c).some(test));
}

export function findCartridge<T extends NameableCartridge>(
  rows: readonly T[],
  printed: string,
): T | null {
  const wanted = calibreCandidates(printed);

  // 1. An exact name, slug or alias. Nothing beats this and nothing follows it.
  for (const want of wanted) {
    const hit = rows.find((c) => keysOf(c).includes(want));
    if (hit) return hit;
  }

  /**
   * 2 and 3. A UNIQUE prefix, then a UNIQUE substring.
   *
   * ⚠️ UNIQUENESS IS THE WHOLE SAFETY ARGUMENT, and it is why this is not
   * fuzzy matching. ".357 Magnum" prefixes exactly one round and resolves;
   * "9x19" appears inside exactly one stored name and resolves; a bare "9mm"
   * touches 9 mm Luger, 9 mm Makarov and 9 mm Browning court, so it resolves
   * to NOTHING and the pack goes out with no drawing rather than with the
   * wrong cartridge's dimensions printed under the applicant's signature.
   *
   * ⚠️ AND THE FLOOR IS FOUR CHARACTERS. Below that a candidate is a calibre
   * family rather than a cartridge — "9MM", "308", "45" — and a family that
   * happens to have one sheet on file would resolve by accident.
   */
  for (const want of wanted) {
    if (want.length < 4) continue;
    for (const test of [
      (k: string) => k.startsWith(want),
      (k: string) => k.includes(want),
    ]) {
      const hits = matching(rows, test);
      if (hits.length === 1) return hits[0];
    }
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
    '',
    // ⚠️ THE PACK MAY OR MAY NOT CARRY THE DRAWING, AND THE WRITER CANNOT
    // KNOW WHICH. It only appears where we hold figures for the calibre, and
    // where it goes on the page is the renderer's decision, taken long after
    // the prose is written. A sentence pointing at it is a sentence that comes
    // out wrong — pointing at a picture that is not there, or is underneath.
    'The pack may carry a scale drawing of this cartridge. You do not know',
    'whether it does, and you do not decide where it goes, so never refer to',
    'it: no "the drawing above", no "as illustrated", no "see the diagram".',
    'Write the paragraph so it stands on its own with no picture beside it.',
  ].join('\n');
}
