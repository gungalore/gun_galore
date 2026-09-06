/**
 * Cells a spreadsheet would EXECUTE rather than read.
 *
 * ⚠️ THIS IS NOT AN ESCAPING PROBLEM, WHICH IS WHY RFC-4180 QUOTING DOES NOT
 * FIX IT. Excel, Sheets and LibreOffice all read a leading `=`, `+`, `-`, `@`
 * (and a leading tab or carriage return) as the start of a FORMULA, quoted or
 * not. A member types `=HYPERLINK("http://…","click")` into a load-log note,
 * downloads their own CSV, and the cell runs when they open it — and the
 * exports this module serves are member-typed text: log notes, primers, case
 * labels, listing titles, seller names.
 *
 * The fix is the one every spreadsheet honours: a leading apostrophe, which
 * they strip on display and never evaluate.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * ⚠️ A NEGATIVE NUMBER IS NOT A FORMULA, AND PREFIXING ONE BREAKS THE FILE THE
 * RULE IS PROTECTING. Every money export this helper serves carries
 * negatives — a refund, a deduction, a payout adjustment — and `-150.00` is a
 * number to a spreadsheet, never a formula. Prefixed, the column stops summing
 * and the member's own statement stops adding up.
 *
 * ⚠️ THE EXEMPTION IS THE MINUS SIGN ALONE, NOT "ANYTHING THAT PARSES AS A
 * NUMBER". `+27821234567` also parses — and a spreadsheet reads it as the
 * formula `+27821234567`, renders it as `27821234567`, and the member's phone
 * column silently loses its leading `+`. So a leading `+`, `=`, `@`, tab or
 * carriage return is always neutralised, and so is `-1+1`.
 */
function isNegativeNumber(s: string): boolean {
  return s.startsWith('-') && s.trim() !== '' && Number.isFinite(Number(s));
}

// RFC-4180 CSV field escape: wrap in double quotes + double any internal
// quotes when the value contains a comma, quote, or newline. Shared so the
// seller statement, admin export, and payout CSV all escape identically.
export function csvCell(v: string | number | null | undefined): string {
  const raw = v == null ? '' : String(v);
  const s = FORMULA_LEAD.test(raw) && !isNegativeNumber(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Join a 2-D array of cells into a CSV document (CRLF line endings, the
// RFC-4180 default that Excel/Sheets expect).
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
