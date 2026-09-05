// backend/src/common/sa-id-number.ts
//
// Reading a South African ID number off a scanned document.
//
// Lives in common/ because TWO modules need the identical rule and the rule
// is not obvious: KYC reads identity documents for verification, and the
// Licence Centre reads the ID off competency certificates and licence cards.
// The 14-digit repair below was earned from real scans during the KYC work
// and then hit again, unchanged, by the Document Centre extractor on the
// operator's own SAPS 524. Two copies of a rule like that drift apart, and
// the drift is silent — one module would quietly start storing an ID number
// the other rejects, for the same person.

/* ── The ID number ─────────────────────────────────────────────────────── */

/** 13 digits, and the last is a Luhn checksum over the other twelve. */
export function saIdChecksumValid(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = id.charCodeAt(12 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Pull a usable SA ID number out of one candidate string.
 *
 * 🚨 FOURTEEN DIGITS IS THE FAILURE WE ACTUALLY SAW, TWICE, FROM TWO
 * DIFFERENT CAUSES:
 *
 *  · The GREEN BOOK: the page number "1" is printed above the barcode, and
 *    FORMS glued it onto the front of the value — `1 970724 0045 089`. The raw
 *    OCR was perfect; only the key/value pairing was wrong.
 *  · The SAPS 524: that form prints the ID in individual boxes, and on one
 *    scan the left border of the first box read as a digit — `1890512-5220-089`
 *    was in the OCR text itself.
 *
 * Both scored ~94% confidence, within a tenth of a point of a CORRECT read of
 * the same document. Confidence cannot separate them; arithmetic can.
 *
 * So a 14-digit candidate gets its leading digit dropped and re-checked. That
 * is a repair, not a guess: it only stands if the shortened number passes the
 * checksum, and it is always recorded in `notes`.
 */
export function readIdNumber(candidate: string): { id: string | null; note?: string } {
  const digits = candidate.replace(/\D/g, '');
  if (saIdChecksumValid(digits)) return { id: digits };

  if (digits.length === 14) {
    const trimmed = digits.slice(1);
    if (saIdChecksumValid(trimmed)) {
      return {
        id: trimmed,
        note: `dropped a leading "${digits[0]}" — 14 digits became a valid 13 (a box border or an adjacent page number, both seen in testing)`,
      };
    }
  }
  return { id: null, note: `no valid SA ID number in "${candidate}" (${digits.length} digits)` };
}
