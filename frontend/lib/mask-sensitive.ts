// ────────────────────────────────────────────────────────────────────
// MASKING A VALUE THAT IS ON SCREEN BUT NOT BEING EDITED.
//
// The artboard's "About you" step shows the identity number as "8905 •••• •••"
// and the cellphone as "082 ••• ••21". Enough to recognise your own record,
// not enough to be worth reading over somebody's shoulder.
//
// ⚠️ GATED ON THE REGISTRY'S `sensitive` FLAG, NOT ON A KEY NAME. The server
// decides which fields qualify — `sensitive: true` has been on the field type
// all along and read by nothing. Guessing from key names here would mean two
// answers to "is this private", and the one on screen would be the wrong one
// the day somebody adds a field.
//
// ⚠️ AND ONLY WHEN COLLAPSED. The edit control shows the real value: the
// member typed it, they already know it, and masking a field somebody is
// trying to correct makes it uncorrectable.
// ────────────────────────────────────────────────────────────────────

const DOT = '•';

/**
 * Mask a value for display, in the artboard's own grouping.
 *
 * ⚠️ THE GROUPING IS THE POINT. A flat run of dots the length of the value
 * tells a member nothing about which of their records they are looking at;
 * "8905 •••• •••" is recognisably their own identity number and reveals four
 * digits of a thirteen-digit number that is on every document they own.
 */
export function maskSensitive(value: string, key = ''): string {
  const v = (value ?? '').trim();
  if (!v) return v;

  const digits = v.replace(/\D/g, '');

  // A South African identity number: 13 digits, and its first six are a date
  // of birth that is printed on everything else in the pack anyway.
  if (digits.length === 13 && /(^|_)id_number$/.test(key)) {
    return `${digits.slice(0, 4)} ${DOT.repeat(4)} ${DOT.repeat(3)}`;
  }

  // A local mobile number: keep the network prefix and the last two, so a
  // member with two numbers on file can tell them apart.
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${DOT.repeat(3)} ${DOT.repeat(2)}${digits.slice(-2)}`;
  }

  // Anything else the registry flagged: show the first two and mask the rest,
  // never revealing more than a quarter of it.
  const keep = Math.min(2, Math.floor(v.length / 4));
  return `${v.slice(0, keep)}${DOT.repeat(Math.max(3, v.length - keep))}`;
}
