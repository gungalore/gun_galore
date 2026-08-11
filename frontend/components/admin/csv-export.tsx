'use client';

// Shared CSV export for admin data tables (audit item 39).
//
// WHY this is a module and not three inline `rows.map(r => r.join(','))`
// one-liners: the operator opens these files in Excel and forwards them to
// suppliers and to the accountant. A naive join breaks the moment a value
// contains a comma (make/model names, search terms), silently shifting every
// following column into the wrong header — a spreadsheet that looks fine and
// is wrong is worse than no export. Three correctness rules are baked in here
// so no call site has to remember them:
//
//   1. RFC-4180 quoting  — any field containing , " CR LF or edge whitespace
//      is wrapped in double quotes with embedded quotes doubled.
//   2. Formula-injection guard — a *user-supplied* string starting with
//      = + - @ (tab/CR too) is prefixed with an apostrophe so Excel treats it
//      as text. Search terms are typed by the public and land verbatim in the
//      zero-result export; without this, opening the file can execute a
//      spreadsheet formula (CSV injection / DDE).
//   3. UTF-8 BOM — Excel on Windows otherwise decodes the file as the local
//      ANSI codepage, which mangles the R sign, en-dashes and any accented
//      make/model text.
//
// Everything here is client-side: the data is already in component state, so
// exporting costs no request and works even when the backend is down.

export type CsvValue = string | number | boolean | null | undefined | Date;

/**
 * One output column. `value` pulls the cell out of a row — return a raw
 * number for anything the accountant will sum (Rand amounts, counts) so Excel
 * keeps it numeric; return a string only for genuine text.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

// Excel/Sheets treat a leading one of these as the start of a formula.
// \t and \r are in the set because a leading control char can smuggle one in.
const FORMULA_LEAD = /^[=+\-@\t\r]/;
// Fields needing quotes: the RFC-4180 set, plus edge whitespace (Excel eats
// unquoted leading spaces, which would silently trim a search term).
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local-date stamp (YYYY-MM-DD). Local, not UTC: the filename should match
 *  the operator's day in SA, not a UTC rollover at 02:00 SAST. */
function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function stringify(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // "YYYY-MM-DD HH:mm" in the browser's zone (SAST for the operator) —
    // Excel parses this as a real datetime, unlike a localised string.
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())} ${pad2(v.getHours())}:${pad2(v.getMinutes())}`;
  }
  if (typeof v === 'number') {
    // NaN/Infinity would render as literal "NaN" and poison a SUM — blank is
    // the honest representation of "no number".
    return Number.isFinite(v) ? String(v) : '';
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return v;
}

/**
 * Encode a single field. The formula guard deliberately only applies to
 * values that came in as strings: numbers are produced by our own code (a
 * negative Rand amount legitimately starts with "-") and guarding those would
 * turn them into text and break the accountant's totals.
 */
function encodeField(raw: CsvValue): string {
  let text = stringify(raw);
  let guarded = false;
  if (typeof raw === 'string' && FORMULA_LEAD.test(text)) {
    // Apostrophe = Excel's "this is text" marker. It does show up in the cell,
    // which is the deliberate trade: a visibly odd search term beats a file
    // that runs a formula when the operator double-clicks it.
    text = `'${text}`;
    guarded = true;
  }
  if (guarded || NEEDS_QUOTES.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Rows + column defs → an RFC-4180 CSV string (header row included).
 * Pure — no BOM, no DOM. `downloadCsv` adds the BOM.
 */
export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): string {
  const lines = [columns.map((c) => encodeField(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => encodeField(c.value(row))).join(','));
  }
  // CRLF: what RFC 4180 specifies and what Excel expects.
  return lines.join('\r\n');
}

/**
 * Build a descriptive filename: table name + period + today's date, so a
 * folder of exports stays self-describing after the operator forwards a few
 * of them ("gun-galore-zero-result-searches-last-30d-2026-08-11.csv").
 */
export function csvFilename(table: string, range?: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return (
    ['gun-galore', slug(table), range ? slug(range) : '', todayStamp()]
      .filter(Boolean)
      .join('-') + '.csv'
  );
}

/**
 * Period key ('7d' | '30d' | '90d' | '365d' | 'all' — the same keys the Sales
 * period-switcher and the Insights chips use) → a filename-safe range token,
 * so an export names the window it covers.
 */
export function csvPeriodSlug(period: string): string {
  return period === 'all' ? 'all-time' : `last-${period}`;
}

/**
 * Trigger the browser download. Kept separate from toCsv so the encoder stays
 * pure and DOM-free.
 */
export function downloadCsv(filename: string, csv: string): void {
  // \uFEFF = UTF-8 BOM (see rule 3 at the top of the file). Written as an
  // escape, never a literal, so the character can't be lost by an editor.
  const blob = new Blob([`\uFEFF${csv}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // Must be in the document for the click to count as user-initiated in
  // Firefox; removed immediately after.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download
  // in Safari before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The ghost "Export CSV" button used in table/card headers. Renders nothing
 * when there is no data — an export button that produces a header-only file
 * is just a support ticket.
 */
export function AdminCsvButton<T>({
  rows,
  columns,
  table,
  range,
  label = 'Export CSV',
}: {
  rows: readonly T[] | null | undefined;
  columns: readonly CsvColumn<T>[];
  /** Human table name — becomes part of the filename. */
  table: string;
  /** Optional period token, e.g. csvPeriodSlug(period). */
  range?: string;
  label?: string;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => downloadCsv(csvFilename(table, range), toCsv(rows, columns))}
      title={`Download ${rows.length} row${rows.length === 1 ? '' : 's'} as CSV`}
      className="text-xs px-2.5 py-1 rounded-[6px] shrink-0"
      style={{
        background: 'transparent',
        border: '0.5px solid var(--border)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
