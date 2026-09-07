import * as ExcelJS from 'exceljs';
import type { RawCell, RawRow } from './parse-raw-data';

// ────────────────────────────────────────────────────────────────────
// THE ONLY FILE THAT KNOWS WHAT exceljs IS.
//
// ⚠️ STREAMED, NOT `readFile`. The workbook is 10.8 MB zipped and its
// "RAW Data" sheet is A1:AJ55765. `new Workbook().xlsx.readFile()` builds a
// full object model of every sheet — including four TOP30 sheets and a
// summary sheet we never look at — and on the box that is hundreds of
// megabytes of resident memory for a job that runs beside a live API.
// WorkbookReader hands us one row at a time and we keep only "RAW Data".
// ────────────────────────────────────────────────────────────────────

/** The sheet the station-level figures live on. */
export const RAW_DATA_SHEET = 'RAW Data';

/**
 * exceljs hands back an object for a formula cell, a rich-text cell or a
 * hyperlink. The parser wants a scalar, and the difference between "5" typed
 * in and "5" produced by a formula is not a difference it should have to know
 * about.
 */
function scalar(value: unknown): RawCell {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Date) return value;
  const o = value as Record<string, unknown>;
  if ('result' in o) return scalar(o.result);
  if (Array.isArray(o.richText)) {
    return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('');
  }
  if (typeof o.text === 'string') return o.text;
  return null;
}

/**
 * Every row of "RAW Data", column A at index 0.
 *
 * ⚠️ exceljs's `row.values` is 1-INDEXED — index 0 is always a hole so that
 * index 1 can be column A. The parser addresses columns from 0 like every
 * other array in this codebase, so the shift is absorbed here, once, rather
 * than by an off-by-one everybody downstream has to remember.
 */
export async function readRawDataSheet(filePath: string): Promise<RawRow[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: 'cache',
    worksheets: 'emit',
    entries: 'emit',
    styles: 'ignore',
  });

  const wanted = RAW_DATA_SHEET.toLowerCase();
  const rows: RawRow[] = [];
  let found = false;

  for await (const worksheet of reader) {
    // ⚠️ CAST. `WorksheetReader` carries `name` at runtime — the streaming
    // reader reads it out of the workbook relationships before it emits the
    // sheet — but exceljs 4.4.0's own .d.ts omits it from the class. Without
    // the name we would have to guess by sheet ORDER, and "RAW Data" is not
    // the first sheet in the file (it is emitted first, but the workbook also
    // holds "Lookup lists", a summary and four TOP30 sheets).
    const name = (worksheet as unknown as { name?: string }).name ?? '';
    if (name.trim().toLowerCase() !== wanted) continue;
    found = true;
    for await (const row of worksheet) {
      const values = row.values as unknown[];
      rows.push((values ?? []).slice(1).map(scalar));
    }
  }

  if (!found) {
    throw new Error(
      `The workbook has no "${RAW_DATA_SHEET}" sheet - SAPS may have renamed it.`,
    );
  }
  return rows;
}
