// ────────────────────────────────────────────────────────────────────
// "from your account address" — the provenance string as it reads after
// the word "from".
//
// ⚠️ IT LOWER-CASES A SENTENCE, NEVER A NAME. This shipped as
// `t[0].toLowerCase() + t.slice(1)`, which is right for "Your account address"
// and wrong for every value read off a licence card. One live application
// showed it five times over: "from mAUSER .30-06 SPRINGFIELD", "from hOWA
// 6.5MM CREEDMOOR", "from nORDISKE PRECISION 223 REM", "from cZ 6.35MM
// BROWNING". A member reading that sees their own rifle misspelled by us.
//
// So the test is the WHOLE STRING, not its first letter: anything carrying a
// capital of its own past the opening character is a name — a make, a model, a
// calibre, an "ID number" — and is left exactly as the server gave it. Only a
// plain sentence-case string gets folded down, which is the case the transform
// was written for.
// ────────────────────────────────────────────────────────────────────

export function sourceLine(from: string): string {
  const t = from.trim();
  if (!t) return '';
  // MAUSER, CZ, Creedmoor, "the ID number …" — a capital past position 0 means
  // the string is carrying a name, and folding its first letter misspells it.
  if (/[A-Z]/.test(t.slice(1))) return t;
  return t[0].toLowerCase() + t.slice(1);
}
