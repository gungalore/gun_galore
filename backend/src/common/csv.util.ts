// RFC-4180 CSV field escape: wrap in double quotes + double any internal
// quotes when the value contains a comma, quote, or newline. Shared so the
// seller statement, admin export, and payout CSV all escape identically.
export function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Join a 2-D array of cells into a CSV document (CRLF line endings, the
// RFC-4180 default that Excel/Sheets expect).
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
