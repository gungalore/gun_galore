// ────────────────────────────────────────────────────────────────────
// "WE LOOKED AT THIS ONE AND TOOK NOTHING FROM IT."
//
// The Document Centre offer carries a reason for every document it read and
// could not use, and the panel prints them under the values it CAN fill in.
//
// ⚠️ IT PRINTED ONE SENTENCE PER DOCUMENT, JOINED BY MIDDOTS. Three firearms
// that would not fit on the form produced the identical sentence three times in
// one run-on line. Operator, 2026-09-07.
//
// ⚠️ AND IT WAS NEVER FILTERED BY SECTION, THOUGH THE VALUES BESIDE IT WERE.
// The panel is mounted once per step and handed that step's key prefixes; it
// filters `items` by them and did not filter `skipped` at all — so a sentence
// about a firearm licence appeared under Competency and under Dedicated status,
// sections it says nothing about.
//
// ⚠️ A NOTE THAT NAMES NO KEY BELONGS TO NO SECTION — AND IS STILL SHOWN,
// ONCE. This was written to drop such a note entirely, on the reasoning that
// printing it on every panel is the bug above and picking one panel would be a
// guess. Both halves of that are true and the conclusion was wrong: the server
// carries NO key on any skipped entry today (`skipped: { title, why }[]`), so
// every one of these sentences rendered nowhere at all. They are the only place
// a member is told a document they handed us was read and discarded — "it does
// not cover the firearm this application is for", "we could not read a
// certificate number off it" — and the operator's complaint was repetition, not
// concealment. A note nobody sees is worse than one under the wrong heading.
//
// So the unplaceable ones come out of `reasonsFor` and go through
// `unplacedReasons`, which the page renders on exactly ONE panel — the first
// one the member walks past — under its own lead-in that does not claim they
// belong to that section. When the server grows `key`/`keys`, each note lands
// on its own panel and this list empties itself.
// ────────────────────────────────────────────────────────────────────

/**
 * What the server sends today, plus the keys it is growing.
 *
 * Optional on purpose: this must render correctly against the server as it is
 * and as it will be, rather than making the build the thing that decides which.
 */
export interface SkippedNote {
  title: string;
  why: string;
  key?: string;
  keys?: string[];
}

export interface OfferReason {
  /** The sentence, once. */
  why: string;
  /** Every document it was given for, in the order they arrived. */
  titles: string[];
}

/**
 * The reasons belonging to this section, one line per distinct reason.
 *
 * A note naming no key is not this section's — see `unplacedReasons`, which is
 * where it goes instead of nowhere.
 */
export function reasonsFor(
  skipped: readonly SkippedNote[],
  keyPrefixes: readonly string[],
): OfferReason[] {
  const byReason = new Map<string, string[]>();
  for (const note of skipped) {
    const keys = note.keys ?? (note.key ? [note.key] : []);
    if (!keys.length) continue;
    if (!keys.some((k) => keyPrefixes.some((p) => k.startsWith(p)))) continue;
    const titles = byReason.get(note.why);
    if (titles) titles.push(note.title);
    else byReason.set(note.why, [note.title]);
  }
  return Array.from(byReason, ([why, titles]) => ({ why, titles }));
}

/**
 * The reasons that name no key at all, one line per distinct reason.
 *
 * ⚠️ SHOWN ONCE, BY THE CALLER, NOT ONCE PER PANEL. The offer panel is mounted
 * per step and every mount is handed the same `skipped` array, so a component
 * that rendered these itself would print them three or four times over — which
 * is the run-on repetition the operator photographed, wearing a different
 * costume. The page decides which single mount shows them.
 */
export function unplacedReasons(
  skipped: readonly SkippedNote[],
): OfferReason[] {
  const byReason = new Map<string, string[]>();
  for (const note of skipped) {
    const keys = note.keys ?? (note.key ? [note.key] : []);
    if (keys.length) continue;
    const titles = byReason.get(note.why);
    if (titles) titles.push(note.title);
    else byReason.set(note.why, [note.title]);
  }
  return Array.from(byReason, ([why, titles]) => ({ why, titles }));
}

/** How a reason is introduced: the one document, or how many there were. */
export function reasonSubject(reason: OfferReason): string {
  return reason.titles.length === 1
    ? reason.titles[0]
    : `${reason.titles.length} documents`;
}
