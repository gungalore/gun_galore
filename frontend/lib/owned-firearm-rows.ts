// ────────────────────────────────────────────────────────────────────
// WHICH OF THE SIX "FIREARMS YOU ALREADY OWN" ROWS TO SHOW.
//
// The registry gives 42 flat fields — six rows of seven columns, keyed
// `existing_firearm_<n>_<column>`. The screen has to turn that back into rows
// and decide how many to put in front of somebody.
//
// ⚠️ PURE, AND HERE RATHER THAN IN THE COMPONENT, BECAUSE IT IS A RULE.
// "Show every row in use, plus one to type into" reads as obvious and has two
// edges that are not: a member who owns all six must not be shown a seventh
// that does not exist, and a member who owns none must still be shown one.
// Both are off-by-ones in JSX otherwise, and neither is visible without a
// logged-in session — which Clerk's domain lock makes impossible on a dev
// machine. So the rule is tested instead.
// ────────────────────────────────────────────────────────────────────

/**
 * The only thing these rules need from a field.
 *
 * ⚠️ NO INDEX SIGNATURE. An `[k: string]: unknown` here looks harmless and
 * stops `MotivationField` satisfying the constraint at all — its properties
 * are typed, not unknown — which forces every caller to cast and throws away
 * the type safety the generic exists for.
 */
export interface RowField {
  key: string;
}

/** `existing_firearm_3_make` → 3. Null for anything that is not a row field. */
export function rowIndex(key: string): number | null {
  const m = /^existing_firearm_(\d+)_/.exec(key);
  if (!m) return null;
  const n = Number(m[1]);
  // A row number that is not a positive integer is a malformed key, not row 0.
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Group flat registry fields into rows, in row order.
 *
 * Fields that are not row fields are dropped: the caller renders those
 * separately, and silently folding them into row 1 would put a section-level
 * question inside somebody's first firearm.
 */
export function groupRows<T extends RowField>(fields: T[]): [number, T[]][] {
  const byRow = new Map<number, T[]>();
  for (const f of fields) {
    const n = rowIndex(f.key);
    if (n === null) continue;
    const list = byRow.get(n) ?? [];
    list.push(f);
    byRow.set(n, list);
  }
  return [...byRow.entries()].sort((a, b) => a[0] - b[0]);
}

/** A row is in use the moment ANY of its columns carries a value. */
export function rowInUse<T extends RowField>(
  row: T[],
  answers: Record<string, string>,
): boolean {
  return row.some((f) => (answers[f.key] ?? '').trim() !== '');
}

/**
 * How many rows to render: every row in use, plus one empty one to type into,
 * plus however many the member has explicitly asked for — and never more rows
 * than the form actually has.
 *
 * ⚠️ AT LEAST ONE, ALWAYS. A member who owns nothing yet still needs somewhere
 * to put their first firearm; returning 0 gives them a heading and no form.
 */
export function rowsToShow<T extends RowField>(
  rows: [number, T[]][],
  answers: Record<string, string>,
  extra = 0,
): [number, T[]][] {
  if (!rows.length) return [];
  // ⚠️ COUNTED AS "THE LAST ROW IN USE", NOT "HOW MANY ARE IN USE". A member
  // whose vault filled rows 1 and 3 has two rows in use and needs three shown,
  // or row 3 — which has their data in it — silently disappears.
  let lastUsed = 0;
  rows.forEach(([, fs], i) => {
    if (rowInUse(fs, answers)) lastUsed = i + 1;
  });
  const want = Math.max(1, lastUsed + 1 + Math.max(0, extra));
  return rows.slice(0, Math.min(rows.length, want));
}
