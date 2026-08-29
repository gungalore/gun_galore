import type { Suggestion } from './motivations-api';

// ────────────────────────────────────────────────────────────────────
// WHAT A DOCUMENT READING IS ALLOWED TO DO WITHOUT ASKING.
//
// Three small decisions, out here rather than inside the panel, because they
// are the whole safety argument for reading somebody's documents at all and
// the panel is not a place a test can reach (the frontend suite runs in node,
// with no DOM).
//
// The rebuilt wizard shipped with none of this: `addFiles` discarded what the
// upload returned, so a member photographed their ID, we paid Vision and
// Claude to read it, and they typed every answer by hand anyway. Restoring the
// panel is M1; these are the rules it runs on.
//
// ⚠️ THE SERVER WILL NOT WRITE A READING ITSELF, AND THAT IS DELIBERATE — its
// own comment says a misread digit in an ID number would otherwise become a
// false statement on a form they sign, under s120(9)(f). Everything below
// exists to keep that true on the client too.
// ────────────────────────────────────────────────────────────────────

/**
 * Which lines arrive already ticked.
 *
 * ⚠️ A DOUBTED VALUE ARRIVES UNTICKED, AND THE OLD PANEL GOT THIS WRONG.
 * `trusted: false` is not "we are slightly less sure" — it means OUR OWN
 * checks disagree with what was read: a serial that fails its pattern, a date
 * that cannot be right. The old page rendered those identically to confident
 * ones and accepted the lot on one button, so the cheapest possible gesture
 * wrote a value we had already flagged as wrong onto a signed form.
 *
 * Making it opt-in costs a deliberate tap. That is the entire point.
 */
export function defaultTicks(
  suggestions: readonly Suggestion[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of suggestions) out[s.key] = s.trusted === true;
  return out;
}

/**
 * What actually gets written.
 *
 * ⚠️ ONLY WHAT WAS TICKED. The old panel was all-or-nothing: a member who
 * spotted one wrong digit could reject the whole reading and retype six
 * correct values, or accept the one they had just seen was wrong. Nobody
 * retypes six values.
 *
 * A key missing from `ticked` counts as unticked — a suggestion that arrived
 * after the state was built must never be written by default.
 */
export function acceptedFrom(
  suggestions: readonly Suggestion[],
  ticked: Record<string, boolean>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of suggestions) {
    if (ticked[s.key] === true) out[s.key] = s.value;
  }
  return out;
}

/**
 * Fold a fresh reading into whatever is already on offer.
 *
 * ⚠️ ONE LINE PER FIELD, LAST READ WINS. Two photographs of the same card —
 * the ordinary way somebody deals with glare — must offer one line, not two
 * contradictory ones with no way to tell which is current. Order is otherwise
 * preserved so the panel does not reshuffle under a member mid-review.
 */
export function mergeReads(
  existing: readonly Suggestion[],
  incoming: readonly Suggestion[],
): Suggestion[] {
  const out = [...existing];
  for (const sg of incoming) {
    const at = out.findIndex((x) => x.key === sg.key);
    if (at >= 0) out[at] = sg;
    else out.push(sg);
  }
  return out;
}
