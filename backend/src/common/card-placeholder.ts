// ────────────────────────────────────────────────────────────────────
// "NONE" ON A LICENCE CARD IS THE CARD SAYING THERE IS NOTHING HERE.
//
// A South African firearm licence prints the word NONE in a row that does
// not apply to that firearm. The operator's own Glock card reads
// "Model NONE", and a rifle with no separate frame serial reads
// "Frame Serial No NONE". That is the card being complete, not the firearm
// having a model called NONE.
//
// ⚠️ EVERY GUARD BETWEEN A READING AND AN ANSWER TESTED ONLY FOR EMPTINESS.
// `if (!value.trim())` lets NONE straight through, so it was stored, offered
// in the prefill panel and written into the form — and an applicant would
// have signed a SAPS 271 declaring a frame serial number of NONE. Seen on
// 2026-09-07 on the operator's own application: "Firearm 6 — frame serial
// NONE · barrel serial NONE".
//
// ⚠️ THE READERS AND THE VAULT KEEP THE CARD VERBATIM, AND MUST. The printed
// seller-consent declaration reproduces what the card says, NONE included —
// that is a true statement about the document and it is the operator's
// explicit instruction (see motivation-seller-consent.service.ts). This rule
// belongs at the ANSWER boundary only: the moment a card reading becomes a
// box on a form the applicant signs.
//
// The same rule already existed, correct and tested, inside
// motivation-seller-consent.service.ts and again as NOT_A_SERIAL in
// motivation-credentials.ts and in credential-duplicates.ts. Three copies,
// one of them reachable. This is the one.
// ────────────────────────────────────────────────────────────────────

/**
 * The placeholders a SAPS card, a dealer's invoice or a clerk prints to mean
 * "nothing here". Anchored, so a real value that merely CONTAINS one of these
 * words is untouched: a rifle whose model is genuinely "None Series" keeps it,
 * and so does the serial "NA1234".
 */
const PLACEHOLDER =
  /^(?:none|n\.?\/?a\.?|nil|null|not\s*applicable|geen|unknown|onbekend|[-–—.]+)$/i;

/** True when this reading is the document saying there is nothing to record. */
export function isCardPlaceholder(value: string | null | undefined): boolean {
  const s = (value ?? '').trim();
  return s === '' || PLACEHOLDER.test(s);
}

/**
 * The value as it should reach an answer, or '' where the card said nothing.
 *
 * Callers treat '' as absent — which is what every offer/prefill path already
 * does — so a placeholder simply stops being offered rather than being
 * offered as a value.
 */
export function answerValue(value: string | null | undefined): string {
  return isCardPlaceholder(value) ? '' : (value ?? '').trim();
}
