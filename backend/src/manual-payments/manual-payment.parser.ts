// Pure parsers for the manual-EFT reconciliation path. No I/O, no deps —
// kept side-effect-free so they're trivially testable against real
// samples. Two inputs feed the same matcher:
//   1. FNB inContact email alerts (fast, provisional)
//   2. FNB statement CSV rows (daily, authoritative)
//
// Both yield an amount (ZAR cents) + a buyer reference, which the
// ManualPaymentsService matches to a Transaction.orderReference.

// ───────────────────────────────────────────────────────────────────
// Order-reference extraction
// ───────────────────────────────────────────────────────────────────
// Our order references look like UM000123 / AU000045 / TS000007 /
// RA000003 / FS000001 — a 2-letter prefix + at least 4 digits. Buyers
// occasionally wrap the reference in other text ("payment um000003"),
// so we normalise (uppercase, strip spaces) and pull the first token
// matching the pattern.
const ORDER_REF_RE = /\b([A-Z]{2}\d{4,})\b/;

export function normaliseReference(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/\s+/g, '');
  return cleaned.length ? cleaned : null;
}

/** Pull a UM/AU/TS/RA/FS order reference out of arbitrary text, or null. */
export function extractOrderRef(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.toUpperCase().replace(/\s+/g, ' ').match(ORDER_REF_RE);
  return m ? m[1] : null;
}

// Parse a "R1,234.56" / "R1 234.56" / "R110.00" money token to integer
// ZAR cents. Tolerates thousands separators (comma, space, nbsp).
export function parseRandToCents(token: string | null | undefined): number | null {
  if (!token) return null;
  const cleaned = token.replace(/[R\s, ]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

// ───────────────────────────────────────────────────────────────────
// FNB inContact email alert
// ───────────────────────────────────────────────────────────────────
// Real sample (2026-06):
//   "FNB :-) R110.00 paid to Current a/c..989191 @ Payshap. Ref.Test. 10Jun 12:50"
// We only act on INCOMING credits ("paid to <our account>"); outgoing
// ("paid from") alerts are ignored.
export interface ParsedInContact {
  isCredit: boolean;
  accountSuffix: string | null; // trailing digits of the credited account
  amountCents: number | null;
  reference: string | null; // normalised buyer reference (uppercased, no spaces)
  orderRef: string | null; // the UM/AU/… token if one is present in the ref/body
  channel: string | null; // "Payshap" | "EFT" | …
}

export function parseInContact(text: string | null | undefined): ParsedInContact | null {
  if (!text) return null;
  const norm = text.replace(/\s+/g, ' ').trim();
  if (!/fnb/i.test(norm)) return null; // not an FNB alert

  const isCredit = /paid\s+to\b/i.test(norm) && !/paid\s+from\b/i.test(norm);

  const amtMatch = norm.match(/R\s?([\d.,  ]+\d)/);
  const amountCents = amtMatch ? parseRandToCents(amtMatch[0]) : null;

  // "a/c..989191" → 989191
  const accMatch = norm.match(/a\/c\.+(\d{3,})/i);
  const accountSuffix = accMatch ? accMatch[1] : null;

  // Reference sits between "Ref." and the next period: "Ref.UM000003. 10Jun"
  const refMatch = norm.match(/Ref\.?\s*([^.]+?)\s*\./i);
  const rawRef = refMatch ? refMatch[1].trim() : null;
  const reference = normaliseReference(rawRef);
  const orderRef = extractOrderRef(rawRef) ?? extractOrderRef(norm);

  const chMatch = norm.match(/@\s*([A-Za-z][A-Za-z ]*?)[.\s]/);
  const channel = chMatch ? chMatch[1].trim() : null;

  return { isCredit, accountSuffix, amountCents, reference, orderRef, channel };
}

// ───────────────────────────────────────────────────────────────────
// FNB statement CSV
// ───────────────────────────────────────────────────────────────────
// Real export quirk (2026-06): the first line jams account metadata in
// front of the real column headers, which end with
//   "…Effective Date,Description,Reference,Service Fee,Amount,Balance,"
// Data rows are well-formed 7-field CSV:
//   2026-06-10,"Test","Test                    ",0.00,110.00,214.67,
// The Reference column is space-padded → trim it. Amount is the credit
// (incoming) value; we only reconcile positive amounts.
export interface ParsedStatementRow {
  index: number; // 0-based data-row index, for the dedupe key
  effectiveDate: string | null;
  description: string | null;
  reference: string | null; // normalised
  orderRef: string | null;
  amountCents: number; // signed; positive = credit
  rawLine: string;
}

// Minimal RFC-4180-ish line splitter — handles double-quoted fields
// (the FNB export quotes Description + Reference) and embedded commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseStatementCsv(content: string): ParsedStatementRow[] {
  if (!content) return [];
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length <= 1) return [];

  // Drop the header/metadata line (line 0). Data rows start at line 1.
  const rows: ParsedStatementRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const fields = splitCsvLine(lines[i]);
    // Expect: [effectiveDate, description, reference, serviceFee, amount, balance, (trailing)]
    if (fields.length < 6) continue;
    const effectiveDate = fields[0]?.trim() || null;
    const description = fields[1]?.trim() || null;
    const refRaw = fields[2]?.trim() || null;
    const amountCents = parseRandToCents(fields[4]) ?? NaN;
    if (Number.isNaN(amountCents)) continue;
    rows.push({
      index: i - 1,
      effectiveDate,
      description,
      reference: normaliseReference(refRaw),
      orderRef: extractOrderRef(refRaw),
      amountCents,
      rawLine: lines[i],
    });
  }
  return rows;
}
