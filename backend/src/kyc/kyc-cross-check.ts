// Claude-KYC server-side identity cross-checks — PURE functions, no I/O.
//
// The cheap KYC flow's anti-forgery core: the reference face comes from the
// seller's OWN uploaded document (forgeable), so what makes the check honest
// is that the document + the seller's typed inputs must agree with the REAL
// Home Affairs record and with the SA ID number's self-describing structure
// (digits 1-6 are the holder's date of birth as YYMMDD; digit 13 is a Luhn
// check digit).
//
// THE SILENT CATCH-OUT: the seller types their date of birth at the Details
// step with NO client-side validation against the ID number. A genuine
// holder can't get it wrong; someone using a borrowed/stolen ID number
// frequently will. The mismatch is only evaluated here, at verdict time, and
// the user-facing rejection copy NEVER names DOB as the reason — otherwise
// we'd be coaching the faker on what to fix.
//
// HARD fails are deterministic lies (typed data vs typed data / vs Home
// Affairs) → REJECT. SOFT fails involve OCR or missing data → the best the
// verdict can then be is UNDER_REVIEW (human decides).

export interface CrossCheckInput {
  /** The 13-digit SA ID number the seller entered (decrypted at verdict). */
  enteredIdNumber: string;
  /** DOB exactly as the seller typed it, 'YYYY-MM-DD'. */
  enteredDob: string;
  /** Claude's OCR of the uploaded document (nullable per field). */
  doc: {
    idNumber: string | null;
    surname: string | null;
    names: string | null;
    dob: string | null; // Claude is instructed to normalise to YYYY-MM-DD
    /** Claude's 0-100 legibility score — gates OCR-mismatch escalation. */
    legibility: number;
  };
  /** Home Affairs record from the SA ID (Basic) check. */
  ha: {
    firstName: string;
    surname: string;
    /** May be '' — the Basic product might not return DOB. */
    dob: string;
  };
}

export interface CrossCheckResult {
  pass: boolean;
  /** Deterministic identity lies — verdict must be REJECTED. */
  hardFails: string[];
  /** OCR/missing-data mismatches — verdict capped at UNDER_REVIEW. */
  softFails: string[];
}

/** Luhn check over the 13-digit SA ID number (last digit is the checksum). */
export function saIdLuhnValid(idNumber: string): boolean {
  if (!/^\d{13}$/.test(idNumber)) return false;
  let sum = 0;
  // Standard Luhn right-to-left: double every second digit.
  for (let i = 0; i < 13; i++) {
    let d = idNumber.charCodeAt(12 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Does 'YYYY-MM-DD' dob agree with the ID number's YYMMDD prefix? */
export function dobMatchesIdDigits(idNumber: string, dob: string): boolean {
  if (!/^\d{13}$/.test(idNumber)) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return false;
  // Compare YY directly — both values are user-supplied so no century
  // inference is needed (a 1990 birth must type 1990; the ID says 90).
  return `${m[1].slice(2)}${m[2]}${m[3]}` === idNumber.slice(0, 6);
}

/**
 * Normalise assorted DOB spellings to 'YYYY-MM-DD' for comparison.
 * Accepts 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYYMMDD', 'DD MMM YYYY' is NOT
 * attempted (Claude + VerifyNow both emit numeric forms). Returns '' when
 * unparseable so callers treat it as absent rather than mismatched.
 */
export function normaliseDob(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.trim();
  let m = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

/** Uppercase, strip diacritics/spaces/hyphens/apostrophes for surname compare. */
function canonName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/** Tiny Levenshtein — surnames are short; no dependency needed. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Count differing digit positions between two equal-length digit strings. */
function digitDiffs(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

export function crossCheckIdentity(input: CrossCheckInput): CrossCheckResult {
  const hardFails: string[] = [];
  const softFails: string[] = [];
  const { enteredIdNumber, doc, ha } = input;
  const enteredDob = normaliseDob(input.enteredDob);

  // 1. HARD — typed DOB vs the ID number's own YYMMDD prefix. Both values
  //    were typed by the seller; a mismatch is a lie, not an OCR slip.
  if (!enteredDob || !dobMatchesIdDigits(enteredIdNumber, enteredDob)) {
    hardFails.push('dob-id-digit-mismatch');
  }

  // 2. HARD — Home Affairs DOB (when the Basic product returns one) vs the
  //    typed DOB. HA is authoritative and no OCR is involved.
  const haDob = normaliseDob(ha.dob);
  if (haDob && enteredDob && haDob !== enteredDob) {
    hardFails.push('dob-ha-mismatch');
  }

  // 3. Document OCR ID number vs entered. OCR can misread → soft by
  //    default; but a clearly-legible document differing in >2 digit
  //    positions is not a misread — escalate to hard.
  const docId = doc.idNumber ? doc.idNumber.replace(/\D/g, '') : '';
  if (docId) {
    if (docId !== enteredIdNumber) {
      if (doc.legibility >= 80 && digitDiffs(docId, enteredIdNumber) > 2) {
        hardFails.push('doc-id-mismatch-legible');
      } else {
        softFails.push('doc-id-mismatch');
      }
    }
  }

  // 4. SOFT — document OCR DOB vs entered DOB.
  const docDob = normaliseDob(doc.dob);
  if (docDob && enteredDob && docDob !== enteredDob) {
    softFails.push('doc-dob-mismatch');
  }

  // 5. SOFT — document surname vs Home Affairs surname (fuzzy: case,
  //    diacritics, spacing; OCR slips up to Levenshtein 2 pass).
  if (doc.surname && ha.surname) {
    const a = canonName(doc.surname);
    const b = canonName(ha.surname);
    if (a && b && a !== b && levenshtein(a, b) > 2) {
      softFails.push('doc-surname-ha-mismatch');
    }
  }

  // 6. SOFT — document effectively unreadable: neither the ID number nor
  //    the DOB could be extracted. Nothing anchors the document to the
  //    identity → a human must look at it.
  if (!docId && !docDob) {
    softFails.push('doc-unreadable');
  }

  return { pass: hardFails.length === 0 && softFails.length === 0, hardFails, softFails };
}
