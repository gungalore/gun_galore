/**
 * THE BENCH — reading a C.I.P. datasheet's table.
 *
 * ⚠️ THIS IS PARSED FROM COORDINATES, NOT FROM FLOWED TEXT, AND THAT IS THE
 * WHOLE POINT OF THIS FILE.
 *
 * A C.I.P. TDCC sheet prints two tables side by side — CARTRIDGE MAXI on the
 * left, CHAMBER MINI on the right — and both use the SAME labels: L1, L2, L3,
 * R, R1, P1, P2, S, H1, H2, G1. A third copy of those same letters appears
 * again as callouts on the technical drawing that fills the left third of the
 * page. So a label on its own identifies nothing; only the label PLUS its
 * column does.
 *
 * Worse, `pdftotext -layout` — the obvious tool, and the one the build spec
 * reaches for first — reflows this page wrongly. On the 6,5 Creedmoor sheet it
 * emits:
 *
 *     L1 1) =  37.84  -0.20   L1 = 37.76
 *              41.52                41.42
 *     L2 1) =  48.77  -0.20   L2 = 48.90
 *     L3 1) =  71.76          L3 1) =
 *
 * which reads as L2 = 48.77 and L3 = 71.76. The glyph coordinates say
 * otherwise: L1, L2 and L3 sit on baselines 681.9, 670.8 and 659.8, and the
 * values on those same three baselines are 37.84, 41.52 and 48.77. The 71.76
 * belongs to L6, four rows further down. Every length is shifted up by one
 * row.
 *
 * Two independent checks confirm the coordinate reading:
 *   • the cartridge reference file records 6,5 Creedmoor as L3 = 48.77 and
 *     L6 = 71.76 — which is what the coordinates give, not what the reflow
 *     gives;
 *   • the design prototype's own placeholder reads "[chamber L2] vs 41.52 mm",
 *     and 41.52 is L2 only under the coordinate reading.
 *
 * Getting this wrong would not have thrown, or looked odd, or failed a build.
 * It would have quietly published a wrong case length for 562 cartridges in
 * the one table a reloader consults to decide whether a round fits a chamber.
 *
 * Nothing here touches the database or the filesystem, so it can be tested
 * against a captured page without a PDF or a box.
 */

/** One glyph run, as pdfjs reports it: text plus the baseline it sits on. */
export interface TextItem {
  s: string;
  x: number;
  y: number;
}

export interface ParsedField {
  /** The label as printed, e.g. "L1", "e min", "Pmax", "α". */
  label: string;
  /** The value as printed, units stripped, e.g. "37.84", "4350", "60°". */
  value: string;
  /** The tolerance printed beside it, e.g. "-0.20". */
  tolerance: string | null;
  /** Footnote markers attached to the label, e.g. "1)", "*", "1)3)". */
  footnotes: string | null;
}

export interface ParsedSheet {
  cartridge: ParsedField[];
  chamber: ParsedField[];
  tab: string | null;
  sheetDate: string | null;
  revision: string | null;
}

/**
 * Baselines within this many points are one row.
 *
 * A footnote marker is superscripted about 2pt above its label's baseline, so
 * the window has to be wider than that. The tightest real row spacing on these
 * sheets is ~7.8pt (the Pmax/PK/PE block), so 3 separates rows without
 * splitting a label from its own footnote.
 */
export const ROW_TOLERANCE_PT = 3;

/** Rows are keyed off the "=" glyph, which every data row has exactly one of per column. */
const EQUALS = '=';

/**
 * How far left of its "=" a label may sit.
 *
 * On the sample sheet the widest gap is "e min" at 42pt. The nearest drawing
 * callout is 85pt out. 55 admits every label and excludes the drawing — which
 * matters, because the drawing's callouts are the same letters as the table's.
 */
const LABEL_REACH_PT = 55;

export function clusterRows(items: TextItem[]): TextItem[][] {
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= ROW_TOLERANCE_PT);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x));
}

/**
 * The x of each column's "=" glyphs.
 *
 * Derived per sheet rather than hardcoded: the sheets on the box are US
 * Letter, while the copies this service hands out are rescaled to A4, so every
 * absolute coordinate differs between them. What does not differ is that the
 * equals signs form two tight vertical stacks.
 */
export function findColumns(rows: TextItem[][]): { maxi: number; chamber: number } | null {
  const xs = rows.flat().filter((i) => i.s === EQUALS).map((i) => i.x);
  if (xs.length < 4) return null;

  const buckets = new Map<number, number[]>();
  for (const x of xs) {
    const key = [...buckets.keys()].find((k) => Math.abs(k - x) <= 5);
    if (key === undefined) buckets.set(x, [x]);
    else buckets.get(key)!.push(x);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.length - a.length).slice(0, 2);
  if (ranked.length < 2) return null;

  const centres = ranked
    .map((b) => b.reduce((s, v) => s + v, 0) / b.length)
    .sort((a, b) => a - b);
  return { maxi: centres[0], chamber: centres[1] };
}

const FOOTNOTE = /^(?:\d\))+\*?$|^\*$/;
/** "4350 bar", "3400 Joule", "34.66 mm²" — the unit rides along with the number. */
const UNITS = /\s*(bar|joule|mm²|mm2|mm|j)\s*$/i;

function isNumeric(s: string): boolean {
  return /^[-+]?\d+(?:[.,]\d+)?$/.test(s.replace(UNITS, '').trim());
}

/** A field is read out of ONE column of ONE row: label left of "=", values right. */
function readField(row: TextItem[], eqX: number, rightBound: number): ParsedField | null {
  const eq = row.find((i) => i.s === EQUALS && Math.abs(i.x - eqX) <= 5);
  if (!eq) return null;

  const left = row.filter((i) => i.x < eq.x && i.x >= eq.x - LABEL_REACH_PT);
  const labelParts = left.filter((i) => !FOOTNOTE.test(i.s));
  if (!labelParts.length) return null;

  const notes = left.filter((i) => FOOTNOTE.test(i.s)).map((i) => i.s).join('');
  const right = row.filter((i) => i.x > eq.x && i.x < rightBound);

  // The first number after "=" is the value. A signed number after that is the
  // tolerance — it is printed in its own column, and it is never the value.
  const value = right.find((i) => isNumeric(i.s) || /°|'/.test(i.s));
  const tolerance = right.find((i) => i !== value && /^[-+]/.test(i.s));

  return {
    label: labelParts.map((i) => i.s).join(' ').trim(),
    value: value ? value.s.replace(UNITS, '').trim() : '',
    tolerance: tolerance ? tolerance.s : null,
    footnotes: notes || null,
  };
}

export function parseSheet(items: TextItem[]): ParsedSheet | null {
  const rows = clusterRows(items);
  const cols = findColumns(rows);
  if (!cols) return null;

  const header = (label: string): string | null => {
    const row = rows.find((r) => r.some((i) => i.s.replace(/\.$/, '') === label));
    if (!row) return null;
    const idx = row.findIndex((i) => i.s.replace(/\.$/, '') === label);
    return row[idx + 1]?.s ?? null;
  };

  const cartridge: ParsedField[] = [];
  const chamber: ParsedField[] = [];
  for (const row of rows) {
    // The MAXI column ends where the CHAMBER column's labels begin, so its
    // tolerance column is included and the neighbouring table is not.
    const maxi = readField(row, cols.maxi, cols.chamber - LABEL_REACH_PT);
    if (maxi) cartridge.push(maxi);
    const cham = readField(row, cols.chamber, Number.POSITIVE_INFINITY);
    if (cham) chamber.push(cham);
  }

  return {
    cartridge,
    chamber,
    tab: header('TAB'),
    sheetDate: header('Date'),
    revision: header('Revision'),
  };
}

/* ── Label → column ────────────────────────────────────────────────────
 *
 * Deliberately a SUBSET. The sheets carry rows the panel does not show
 * (breech radii, the δ and L3+G lines, the miscellaneous block). Those are not
 * dropped — the page's whole text block is kept in `rawText`, and the import
 * reports every label it saw with no column here, so a decision to surface one
 * later is a schema change made on purpose rather than a guess made now.
 *
 * ⚠️ THE TWO MAPS MUST STAY SEPARATE. "L1" means the cartridge's length in one
 * and the chamber's in the other; a single shared map would silently write a
 * chamber figure into a cartridge column.
 */
export const CARTRIDGE_FIELDS: Record<string, string> = {
  L1: 'L1', L2: 'L2', L3: 'L3', L4: 'L4', L5: 'L5', L6: 'L6',
  R: 'R', R1: 'R1', R3: 'R3',
  E: 'E', E1: 'E1', 'e min': 'eMin', f: 'f',
  β: 'beta', α: 'alpha',
  P1: 'P1', P2: 'P2',
  S: 'S', 'r1 min': 'r1Min', r2: 'r2',
  H1: 'H1', H2: 'H2', G1: 'G1', G2: 'G2', F: 'F',
  Pmax: 'pmaxBar', PK: 'pkBar', PE: 'peBar',
  M: 'M', EE: 'EE',
};

export const CHAMBER_FIELDS: Record<string, string> = {
  L1: 'cL1', L2: 'cL2', L3: 'cL3',
  P1: 'cP1', P2: 'cP2',
  H1: 'cH1', H2: 'cH2',
  G: 'cG', α1: 'cAlpha1',
  h: 'cH', s: 'cS', i: 'cI', w: 'cW',
  // Barrel block, which prints under the chamber column.
  F: 'bF', Z: 'bZ', b: 'bB', N: 'bN', u: 'bU', Q: 'bQ',
};

/** Columns that hold text as printed (angles), not a number. */
export const TEXT_FIELDS = new Set(['beta', 'alpha', 'cAlpha1', 'cI']);
/** Columns typed Int in the schema. */
export const INT_FIELDS = new Set(['pmaxBar', 'pkBar', 'peBar', 'bN']);
