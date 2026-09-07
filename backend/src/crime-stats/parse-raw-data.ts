// ────────────────────────────────────────────────────────────────────
// THE SAPS "RAW Data" SHEET, TURNED INTO QUARTERS.
//
// Pure: cells in, figures out. No DOM, no exceljs, no Prisma — the workbook
// reader hands this a plain array of rows so the hard part can be tested in
// node against a small fixture instead of a 10 MB download.
//
// ⚠️ THE COLUMNS MOVE EVERY QUARTER, WHICH IS WHY NOTHING HERE IS POSITIONAL.
// Each release compares ONE calendar quarter across five years, and it is a
// different quarter each time: the 2025-2026 Q4 workbook carries January to
// March for 2022..2026, the next one carries April to June. So the month
// columns, the quarter-total columns and the years they cover all shift. We
// find columns by what their header SAYS, never by where it sits.
//
// ⚠️ SAPS COUNTS ITS OWN YEAR FROM APRIL. Their "4th quarter" is January to
// March, which is calendar Q1. Everything stored here is a CALENDAR quarter
// ("2026-Q1"), derived from the Excel serial date in the month header, so a
// period key means the same thing in every release. The release KEY keeps
// SAPS's own numbering ("2025-2026-Q4") because that is what names the file.
// ────────────────────────────────────────────────────────────────────

/** What a spreadsheet cell can arrive as. */
export type RawCell = string | number | boolean | Date | null | undefined;

/** One row of the sheet, column A at index 0. */
export type RawRow = readonly RawCell[];

export interface ParsedQuarter {
  /** Calendar quarter, e.g. "2026-Q1". */
  period: string;
  /** e.g. "January to March 2026". */
  label: string;
  /** The column the quarter total was read from, or -1 when we summed months. */
  totalColumn: number;
  /** The month columns that make it up, ascending. May be empty. */
  monthColumns: number[];
}

export interface ParsedCount {
  period: string;
  count: number;
}

export interface ParsedStationRow {
  station: string;
  district: string;
  province: string;
  category: string;
  /** SAPS's numeric category code, when the row carries one. */
  code: number | null;
  /** Ascending by period. A quarter with no readable number is ABSENT, not 0. */
  counts: ParsedCount[];
}

export interface ParsedStation {
  name: string;
  district: string;
  province: string;
}

export interface ParseRawDataResult {
  /** Ascending. */
  quarters: ParsedQuarter[];
  /** The newest quarter, e.g. "2026-Q1". */
  latestPeriod: string;
  /** The newest quarter's wording, e.g. "January to March 2026". */
  latestLabel: string;
  /** One per distinct station, in first-seen order. */
  stations: ParsedStation[];
  rows: ParsedStationRow[];
  /** Everything we chose not to load, so a load can report what it dropped. */
  skipped: {
    /** Comp level was District / Province / National — an aggregate, not a precinct. */
    aggregateRows: number;
    /** Comp level said "Station" but a naming column was blank. */
    unusableRows: number;
    /** The same station + category twice. The FIRST is kept. */
    duplicateRows: number;
    /** Quarters whose three months did not add up to the printed total. */
    monthSumMismatches: number;
  };
}

export class RawDataShapeError extends Error {}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Whitespace-collapsed, lower-cased. SAPS headers carry hard line breaks. */
function norm(cell: RawCell): string {
  if (cell === null || cell === undefined) return '';
  const s = cell instanceof Date ? cell.toISOString() : String(cell);
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Trimmed, line breaks collapsed, original case. */
function text(cell: RawCell): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).replace(/\s+/g, ' ').trim();
}

/**
 * Excel serial day -> { year, month }. The epoch is 1899-12-30, not
 * 1900-01-01, which absorbs Lotus's phantom 1900 leap day for every serial we
 * will ever see here (44562 = 2022-01-01). Computed in UTC so the box's
 * timezone cannot roll a 1 January header back into December.
 */
export function excelSerialToYearMonth(serial: number): {
  year: number;
  month: number;
} {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function quarterOfMonth(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

export function quarterLabel(year: number, quarter: number): string {
  const start = (quarter - 1) * 3;
  return `${MONTHS[start]} to ${MONTHS[start + 2]} ${year}`;
}

/**
 * A month column header. SAPS writes these as real dates, so exceljs hands
 * back either the serial number or a Date depending on the cell's number
 * format — a difference we must not care about.
 *
 * ⚠️ The serial floor of 20 000 (1954) is not fussiness. The sheet's trailing
 * columns are placements and counts — small integers — and a bare
 * `typeof number` test would read a "National contribution placement" value
 * as a month.
 */
function monthHeader(cell: RawCell): { year: number; month: number } | null {
  if (cell instanceof Date) {
    return { year: cell.getUTCFullYear(), month: cell.getUTCMonth() + 1 };
  }
  if (typeof cell === 'number' && cell >= 20_000 && cell <= 80_000) {
    return excelSerialToYearMonth(cell);
  }
  return null;
}

/**
 * A quarter-total column header: "January 2022 to March 2022". The quarter is
 * taken from the START month, so a workbook that ever spans a year boundary
 * (October to December is the only one that could) still lands in the right
 * calendar quarter.
 */
function totalHeader(cell: RawCell): { year: number; quarter: number } | null {
  const s = norm(cell);
  const m = /^([a-z]+)\s+(\d{4})\s+to\s+([a-z]+)\s+(\d{4})$/.exec(s);
  if (!m) return null;
  const monthIndex = MONTHS.findIndex((x) => x.toLowerCase() === m[1]);
  if (monthIndex < 0) return null;
  const year = Number(m[2]);
  return { year, quarter: quarterOfMonth(monthIndex + 1) };
}

/** The named columns every release has, whatever else moves. */
const REQUIRED = [
  'comp level',
  'station',
  'district',
  'province',
  'crime_category',
] as const;

interface HeaderMap {
  rowIndex: number;
  columns: Record<string, number>;
}

function findHeader(rows: readonly RawRow[]): HeaderMap {
  // Row 1 is a banner and row 2 a sub-banner; the headers are row 3 today.
  // Scanning the first 20 rows rather than trusting that costs nothing and
  // survives SAPS adding another banner line, which they have done before.
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const cells = rows[r].map(norm);
    if (!REQUIRED.every((k) => cells.includes(k))) continue;
    const columns: Record<string, number> = {};
    cells.forEach((c, i) => {
      // FIRST wins. "Station" also appears inside "Station Crime_Category",
      // but that normalises to a different string, so the only real risk is a
      // repeated header — and the leftmost is the data column.
      if (c && !(c in columns)) columns[c] = i;
    });
    return { rowIndex: r, columns };
  }
  throw new RawDataShapeError(
    `No header row found in the first ${limit} rows of "RAW Data" - looked for ${REQUIRED.join(', ')}.`,
  );
}

function readQuarters(header: RawRow, firstColumn: number): ParsedQuarter[] {
  const months = new Map<string, number[]>();
  const totals = new Map<string, number>();
  const meta = new Map<string, { year: number; quarter: number }>();

  for (let c = firstColumn; c < header.length; c++) {
    const cell = header[c];
    const mh = monthHeader(cell);
    if (mh) {
      const quarter = quarterOfMonth(mh.month);
      const key = `${mh.year}-Q${quarter}`;
      meta.set(key, { year: mh.year, quarter });
      const list = months.get(key) ?? [];
      list.push(c);
      months.set(key, list);
      continue;
    }
    const th = totalHeader(cell);
    if (th) {
      const key = `${th.year}-Q${th.quarter}`;
      meta.set(key, th);
      // First total column wins: the comparison block at the right-hand end
      // repeats the wording, and the leftmost is the one inside the year block.
      if (!totals.has(key)) totals.set(key, c);
    }
  }

  const quarters = [...meta.keys()]
    .sort()
    .map((key) => {
      const m = meta.get(key)!;
      return {
        period: key,
        label: quarterLabel(m.year, m.quarter),
        totalColumn: totals.get(key) ?? -1,
        monthColumns: (months.get(key) ?? []).slice().sort((a, b) => a - b),
      };
    })
    // A quarter with neither a printed total nor a single month is a header we
    // misread, not a quarter. Drop it rather than emit a column of blanks.
    .filter((q) => q.totalColumn >= 0 || q.monthColumns.length > 0);

  if (quarters.length === 0) {
    throw new RawDataShapeError(
      'No month or quarter-total columns found to the right of "Code".',
    );
  }
  return quarters;
}

function num(cell: RawCell): number | null {
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  if (typeof cell === 'string') {
    const t = cell.trim();
    // SAPS leaves a genuinely unreported cell blank or dashed. A blank is not
    // a zero: a station that did not report is a different fact from a station
    // that reported none, and a motivation must not turn one into the other.
    // Absent stays absent.
    if (t === '' || t === '-') return null;
    const n = Number(t.replace(/\s/g, '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseRawData(rows: readonly RawRow[]): ParseRawDataResult {
  const { rowIndex, columns } = findHeader(rows);
  const header = rows[rowIndex];

  const cComp = columns['comp level'];
  const cStation = columns['station'];
  const cDistrict = columns['district'];
  const cProvince = columns['province'];
  const cCategory = columns['crime_category'];
  const cCode = columns['code'];

  // Quarter columns start after the last of the naming columns. "Code" is
  // optional — it has always been there, but a release without it must still
  // load — so we fall back to the category column when it is missing.
  const quarters = readQuarters(header, (cCode ?? cCategory) + 1);

  const stations: ParsedStation[] = [];
  const stationSeen = new Set<string>();
  const pairSeen = new Set<string>();
  const out: ParsedStationRow[] = [];
  const skipped = {
    aggregateRows: 0,
    unusableRows: 0,
    duplicateRows: 0,
    monthSumMismatches: 0,
  };

  for (let r = rowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // ⚠️ "Comp level" IS THE ONLY THING SEPARATING PRECINCTS FROM TOTALS, AND
    // FROM RUBBISH. The 2025-2026 Q4 sheet holds 51 656 Station rows, 2 420
    // District, 396 Province and 44 National — load the aggregates as if they
    // were stations and "Gauteng" becomes a precinct with a murder count two
    // hundred times any real one. Below the table there are also stray cells
    // (bare integers, the word "Increased") left over from the comparison
    // block; requiring the literal word "Station" drops all of it.
    if (norm(row[cComp]) !== 'station') {
      if (text(row[cStation]) || text(row[cCategory])) skipped.aggregateRows++;
      continue;
    }

    const station = text(row[cStation]);
    const district = text(row[cDistrict]);
    const province = text(row[cProvince]);
    const category = text(row[cCategory]);
    if (!station || !province || !category) {
      skipped.unusableRows++;
      continue;
    }

    // ⚠️ De-duplicated on the SAME KEY the database enforces
    // (station + province + category). A release that repeats a row would
    // otherwise reach createMany and take the whole 5 000-row batch down with
    // a unique violation, losing 4 999 good rows to one bad one.
    const pairKey = `${station} ${province} ${category}`;
    if (pairSeen.has(pairKey)) {
      skipped.duplicateRows++;
      continue;
    }
    pairSeen.add(pairKey);

    const stationKey = `${station} ${province}`;
    if (!stationSeen.has(stationKey)) {
      stationSeen.add(stationKey);
      stations.push({ name: station, district, province });
    }

    const counts: ParsedCount[] = [];
    for (const q of quarters) {
      const printed = q.totalColumn >= 0 ? num(row[q.totalColumn]) : null;

      // The months are the CHECK, not the source. Where both exist and
      // disagree we keep SAPS'S PRINTED TOTAL — it is the number their own
      // published PDF and presentation quote — and count the disagreement so
      // a load can report how much of the sheet did not add up.
      let summed: number | null = null;
      if (q.monthColumns.length > 0) {
        let acc = 0;
        let any = false;
        for (const c of q.monthColumns) {
          const v = num(row[c]);
          if (v !== null) {
            acc += v;
            any = true;
          }
        }
        summed = any ? acc : null;
      }
      if (printed !== null && summed !== null && printed !== summed) {
        skipped.monthSumMismatches++;
      }

      const value = printed ?? summed;
      if (value === null) continue;
      counts.push({ period: q.period, count: Math.round(value) });
    }

    const code = cCode === undefined ? null : num(row[cCode]);
    out.push({
      station,
      district,
      province,
      category,
      code: code === null ? null : Math.round(code),
      counts,
    });
  }

  const latest = quarters[quarters.length - 1];
  return {
    quarters,
    latestPeriod: latest.period,
    latestLabel: latest.label,
    stations,
    rows: out,
    skipped,
  };
}
