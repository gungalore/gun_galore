// ────────────────────────────────────────────────────────────────────
// "NONE" ON A LICENCE CARD IS THE CARD SAYING THERE IS NOTHING HERE.
//
// A South African firearm licence prints NONE in a row that does not apply to
// that firearm. The operator's own Glock card reads "Model NONE"; a rifle with
// no separate frame serial reads "Frame Serial No NONE". That is the card being
// complete, not a firearm whose model is called NONE.
//
// ⚠️ THIS IS A SECOND, DELIBERATE COPY OF backend/src/common/card-placeholder.ts.
// It is not an oversight and it is not laziness. `frontend/tsconfig.json` maps
// only `@/* -> ./*` INSIDE frontend/, so there is no import path from a browser
// module to a NestJS module; adding one would drag the backend's compilation
// into the Next build. The rule itself is four lines and a regex, and the copy
// is pinned character-for-character by card-placeholder.spec.ts, which lists the
// same cases the server's own spec lists.
//
// ⚠️ IF YOU CHANGE THE PATTERN, CHANGE BOTH. The failure mode when they drift
// is silent and one-directional: the server stops writing a value the screen
// still shows, or the screen hides a value the form still prints — the second
// of which is exactly the bug this file was added to close, one layer up.
//
// ⚠️ WHERE IT APPLIES, AND WHERE IT MUST NOT. This is for a value on its way to
// a member as the IDENTITY OF A THING — the owned-firearm line on the "What you
// own" step, and the same line previewed in the Document Centre offer, which is
// a preview of what the server will write through its own `answerValue`. It is
// NOT for readers: the vault keeps the card verbatim, and the printed
// seller-consent declaration reproduces what the card says, NONE included,
// because that is a true statement about the document and the operator asked
// for it explicitly.
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
 * The value as it should be shown, or '' where the card said nothing.
 *
 * Callers treat '' as absent — which is what every offer and summary path here
 * already does — so a placeholder simply drops out of the line rather than
 * being printed as though it were a serial number.
 */
export function answerValue(value: string | null | undefined): string {
  return isCardPlaceholder(value) ? '' : (value ?? '').trim();
}
