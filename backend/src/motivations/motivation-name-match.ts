/**
 * IS THIS THE SAME FIREARM NAME, SPELLED SLIGHTLY DIFFERENTLY?
 *
 * ⚠️ MO000063, AND IT IS A CLASS OF FAILURE RATHER THAN ONE BAD DAY. The
 * applicant typed `mosberg` and `12 gayge`. The writer corrected both — the
 * right thing to do — and two validators refused the corrected prose because
 * they asked `text.includes(rawAnswer)` and `tokens.includes('mossberg')`
 * against the misspelling. A member who spells a make badly gets a document
 * that fails to generate, and the failure blames the model for being right.
 *
 * Corrections at capture (intake-reply.ts) are the real fix; this is the
 * defence behind it, for the answers that arrive misspelled and are never
 * corrected — an imported card, a profile carried across, an old draft.
 *
 * ⚠️ THE TOLERANCE IS SMALL AND BOUNDED. Two edits on a name of five letters
 * or more, one on a shorter one, and exact containment always wins. A
 * genuinely different make is many edits away and stays refused: "Sako" is
 * not "Mossberg" by any distance this accepts.
 */

/** Letters and digits only, lower-cased — case and punctuation are noise. */
export function normaliseName(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Levenshtein distance, iterative and allocation-light. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * How many edits a name of this length may absorb.
 *
 * ⚠️ SHORT NAMES GET ONE. "CZ" is two characters and one edit away from
 * plenty of other two-letter runs; a tolerance of two would turn every
 * two-letter make into a match.
 */
function tolerance(name: string): number {
  if (name.length <= 2) return 0;
  if (name.length <= 4) return 1;
  return 2;
}

/**
 * Does `haystack` (a question, a paragraph, a list of held firearms) name
 * `needle`, allowing a small misspelling?
 */
export function namesMatch(haystack: string, needle: string): boolean {
  const h = normaliseName(haystack);
  const n = normaliseName(needle);
  if (!h || !n) return false;
  if (h.includes(n)) return true;

  const max = tolerance(n);
  if (max === 0) return false;

  const minRun = Math.max(1, n.length - max);
  const maxRun = n.length + max;
  for (let length = minRun; length <= maxRun; length++) {
    for (let start = 0; start + length <= h.length; start++) {
      const run = h.slice(start, start + length);
      if (editDistance(run, n) <= max) return true;
    }
  }
  return false;
}
