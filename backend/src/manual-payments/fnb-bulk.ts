// FNB "BInSol - U" bulk-payment file format (Pay Multiple Recipients).
//
// FNB ignores rows 1–4 on import; ROW 4 defines the column order that the
// data rows (row 5+) MUST follow. We reproduce the 4-line header block for
// fidelity with the template the operator exported, then emit one row per
// recipient in the exact 36-column order below.
//
// Pure + unit-tested on purpose: a banking import is strict, so the column
// order, count, escaping, amount format and account-type codes are locked
// down here rather than inline in the service.

// The exact ROW-4 header, verbatim from the operator's FNB template. The
// data rows are built in THIS order — do not reorder without re-checking FNB.
export const FNB_BULK_COLUMNS = [
  'RECIPIENT NAME',
  'RECIPIENT ACCOUNT',
  'RECIPIENT ACCOUNT TYPE',
  'BRANCHCODE',
  'AMOUNT',
  'OWN REFERENCE',
  'RECIPIENT REFERENCE',
  'EMAIL 1 NOTIFY',
  'EMAIL 1 ADDRESS',
  'EMAIL 1 SUBJECT',
  'EMAIL 2 NOTIFY',
  'EMAIL 2 ADDRESS',
  'EMAIL 2 SUBJECT',
  'EMAIL 3 NOTIFY',
  'EMAIL 3 ADDRESS',
  'EMAIL 3 SUBJECT',
  'EMAIL 4 NOTIFY',
  'EMAIL 4 ADDRESS',
  'EMAIL 4 SUBJECT',
  'EMAIL 5 NOTIFY',
  'EMAIL 5 ADDRESS',
  'EMAIL 5 SUBJECT',
  'FAX 1 NOTIFY',
  'FAX 1 CODE',
  'FAX 1 NUMBER',
  'FAX 1 SUBJECT',
  'FAX 2 NOTIFY',
  'FAX 2 CODE',
  'FAX 2 NUMBER',
  'FAX 2 SUBJECT',
  'SMS 1 NOTIFY',
  'SMS 1 CODE',
  'SMS 1 NUMBER',
  'SMS 2 NOTIFY',
  'SMS 2 CODE',
  'SMS 2 NUMBER',
] as const;

export interface FnbRecipient {
  name: string; // RECIPIENT NAME — the bank account holder
  account: string; // RECIPIENT ACCOUNT
  accountType: string | null; // our stored "cheque" | "savings" | "transmission"
  branchCode: string;
  amountCents: number;
  ownReference: string; // shows on GG's statement
  recipientReference: string; // shows on the recipient's statement
  email?: string | null; // when set + notify on → EMAIL 1 columns
  phone?: string | null; // when set + notify on → SMS 1 columns
}

// FNB account-type codes: 1 = cheque/current, 2 = savings, 3 = transmission.
export function accountTypeCode(t: string | null | undefined): string {
  switch ((t ?? '').trim().toLowerCase()) {
    case 'cheque':
    case 'current':
      return '1';
    case 'savings':
    case 'saving':
      return '2';
    case 'transmission':
      return '3';
    default:
      return ''; // unknown → leave blank for the operator to fill before upload
  }
}

// CSV field escape: quote + double interior quotes only when needed (comma,
// quote, CR or LF), matching how FNB exports the template.
function esc(v: unknown): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// FNB references are short — keep them within a safe bound + strip commas
// (which would shift columns) and newlines.
function ref(s: string): string {
  return (s ?? '').replace(/[\r\n,]/g, ' ').trim().slice(0, 20);
}

// Amount in Rands with exactly two decimals, no thousands separators, no "R".
function amount(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

const NOTIFY_YES = 'Yes';
const NOTIFY_NO = 'No';

/**
 * One data row (row 5+), in the exact FNB_BULK_COLUMNS order. When notify is
 * on and a contact exists, EMAIL 1 / SMS 1 are populated; the remaining
 * email/fax/sms slots stay blank.
 */
export function fnbBulkRow(r: FnbRecipient, notify: boolean): string {
  const wantEmail = notify && !!r.email;
  const wantSms = notify && !!r.phone;
  const fields = [
    r.name, // RECIPIENT NAME
    r.account, // RECIPIENT ACCOUNT
    accountTypeCode(r.accountType), // RECIPIENT ACCOUNT TYPE
    r.branchCode, // BRANCHCODE
    amount(r.amountCents), // AMOUNT
    ref(r.ownReference), // OWN REFERENCE
    ref(r.recipientReference), // RECIPIENT REFERENCE
    // EMAIL 1
    wantEmail ? NOTIFY_YES : NOTIFY_NO,
    wantEmail ? r.email : '',
    wantEmail ? 'Gun Galore payment' : '',
    // EMAIL 2..5 (notify/address/subject) — blank
    NOTIFY_NO, '', '',
    NOTIFY_NO, '', '',
    NOTIFY_NO, '', '',
    NOTIFY_NO, '', '',
    // FAX 1..2 (notify/code/number/subject) — blank
    NOTIFY_NO, '', '', '',
    NOTIFY_NO, '', '', '',
    // SMS 1 (notify/code/number)
    wantSms ? NOTIFY_YES : NOTIFY_NO,
    '', // SMS 1 CODE — full number goes in SMS 1 NUMBER
    wantSms ? r.phone : '',
    // SMS 2 (notify/code/number) — blank
    NOTIFY_NO, '', '',
  ];
  return fields.map(esc).join(',');
}

/**
 * Build the full BInSol file: the 4-line header block (ignored by FNB on
 * import, reproduced for fidelity) + the data rows. CRLF line endings, as
 * FNB exports.
 */
export function buildFnbBulkFile(
  recipients: FnbRecipient[],
  opts: { sourceAccount: string; actionDate: string; notify: boolean },
): string {
  const lines = [
    'BInSol - U ver 1.00',
    opts.actionDate, // DD-MM-YYYY
    `${opts.sourceAccount},`, // source account; 2nd field blank (ignored on import)
    FNB_BULK_COLUMNS.join(','),
    ...recipients.map((r) => fnbBulkRow(r, opts.notify)),
  ];
  return lines.join('\r\n');
}

// Action date in SAST (UTC+2), formatted DD-MM-YYYY, from a base instant.
export function sastActionDate(now: Date): string {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const dd = String(sast.getUTCDate()).padStart(2, '0');
  const mm = String(sast.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = sast.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
