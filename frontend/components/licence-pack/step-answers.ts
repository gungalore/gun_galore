// ────────────────────────────────────────────────────────────────────
// ONE COUNT OF A STEP'S ANSWERS, READ BY THE HEADER AND BY THE FOOTER.
//
// ⚠️ THEY COUNTED DIFFERENT THINGS AND CONTRADICTED EACH OTHER ON SCREEN. The
// panel header counted every field in the section, filled or not; the footer
// hint counted only the ones the server still requires. On the operator's live
// section 13, 2026-09-07:
//
//   competency step   header "WE HAVE 3 OF THE 4 ANSWERS THIS SECTION ASKS
//                     FOR", a row pilled "Still needed", and the footer
//                     "Nothing outstanding here."
//   firearm step      header "0 OF THE 9 ANSWERS", footer "7 answers still
//                     needed."
//
// Both were arithmetically true and the pair was unreadable: the fourth
// competency answer and two of the nine firearm answers are optional, and
// nothing said so. A member reading that cannot tell whether they are finished.
//
// So there is one tally, and every caption on the step is derived from it. The
// optional answers are counted separately and named — they are worth having,
// they are not worth blocking on, and the difference is the whole confusion.
// ────────────────────────────────────────────────────────────────────

import { visibleFields, type MotivationField } from '@/lib/motivations-api';

export interface AnswerTally {
  /** Answers this member must give before a pack can be produced. */
  needed: number;
  /** How many of those are in. */
  have: number;
  /**
   * Answers worth having that nothing is blocked on AND THAT ARE STILL EMPTY.
   *
   * ⚠️ STILL EMPTY IS THE WHOLE POINT. Counting every optional field, filled or
   * not, put "· one more is optional" over a step whose optional answer was
   * already in — which reads as one still outstanding, the exact ambiguity this
   * tally exists to remove. Worse, `needed === 0` then read "Nothing here is
   * required — 4 answers you may add" over four answers already added.
   */
  optional: number;
  /** Every field on this step, needed or not, filled or not. */
  total: number;
}

/** A step that asks nothing. Named, so no caller has to spell the shape. */
export const NO_ANSWERS: AnswerTally = {
  needed: 0,
  have: 0,
  optional: 0,
  total: 0,
};

/**
 * The fields a step actually shows, for a given set of registry sections.
 *
 * ⚠️ `visibleFields`, NOT THE RAW REGISTRY. A field behind an unmet showIf is
 * not on the screen, and counting it would put the header and the footer back
 * to describing two different forms. The panel bodies use exactly this call,
 * so the captions count what the member can see and nothing else.
 */
export function stepFieldsFor(
  sections: readonly string[] | undefined,
  fields: MotivationField[],
  answers: Record<string, string>,
): MotivationField[] {
  if (!sections?.length) return [];
  const visible = visibleFields(fields, answers);
  const slots = associationSlotsToShow(answers);
  return sections.flatMap((sec) =>
    visible.filter(
      (f) => f.section === sec && slots.has(associationSlotOf(f.key) ?? 1),
    ),
  );
}

/** `association_2_name` → 2. Slot one is unnumbered, so anything else → null. */
function associationSlotOf(key: string): number | null {
  const m = /^association_([23])_/.exec(key);
  return m ? Number(m[1]) : null;
}

/**
 * Which association slots to put on screen: every one in use, plus one to fill.
 *
 * ⚠️ THE REGISTRY CARRIES THREE AND THE STEP DREW ALL THREE, FLAT. On the
 * operator's live section 16 the association step listed ten rows, seven of
 * them empty, including three byte-identical label pairs — "Another
 * association you belong to" twice, "Membership number there" twice, "Member
 * there since" twice. A member in one association cannot tell those apart and
 * has no reason to read past the first.
 *
 * The registry says this was never the intent: "the wizard hides the empty
 * rows behind 'add another association' — operator, 2026-08-20 — so the
 * single-body applicant never sees them". The old wizard does. This one grew
 * without it, and since "Dedicated status" exists only on the two section 16
 * types, the gap was section 16's alone.
 *
 * The rule is the one the owned-firearm rows already use, and it needs no
 * button: a slot appears once the slot before it is in use. Applying it HERE
 * rather than in the panel means the header count, the footer hint and the
 * rows on screen cannot disagree about how many questions this step asks.
 */
function associationSlotsToShow(answers: Record<string, string>): Set<number> {
  const filled = (key: string) => (answers[key] ?? '').trim() !== '';
  const shown = new Set([1]);
  if (filled('association_name')) shown.add(2);
  if (shown.has(2) && filled('association_2_name')) shown.add(3);
  return shown;
}

/**
 * How this step stands.
 *
 * ⚠️ "NEEDED" IS `required` OR OUTSTANDING, NOT `required` ALONE. `missing` is
 * the page's union of the server's own missingRequired with what the registry
 * currently requires — the server may require something on logic this client
 * does not evaluate, so a key can be outstanding without the served field
 * carrying `required`. Counting it as optional would show "nothing
 * outstanding" over a step that cannot finish.
 */
export function tallyAnswers(
  fields: readonly MotivationField[],
  missing: ReadonlySet<string>,
  answers: Record<string, string> = {},
): AnswerTally {
  const needed = fields.filter((f) => f.required || missing.has(f.key));
  const have = needed.filter((f) => !missing.has(f.key)).length;
  const optional = fields.filter(
    (f) => !(f.required || missing.has(f.key)) && !(answers[f.key] ?? '').trim(),
  );
  return {
    needed: needed.length,
    have,
    optional: optional.length,
    total: fields.length,
  };
}

/**
 * The footer hint. Says what is left, never what has been done.
 *
 * ⚠️ DOCUMENTS COUNT. A step whose required document is not attached cannot
 * finish, the rail's tick knows it, and the hint said "Nothing outstanding
 * here." — the same shape of contradiction as the header, one bar lower.
 */
export function outstandingHint(t: AnswerTally, documentsLeft = 0): string {
  const answers = t.needed - t.have;
  // Built lower-case and capitalised once at the end — "one document" is the
  // whole sentence when no answer is outstanding, and the second half of it
  // when one is.
  const parts: string[] = [];
  if (answers > 0) {
    parts.push(answers === 1 ? 'one answer' : `${answers} answers`);
  }
  if (documentsLeft > 0) {
    parts.push(
      documentsLeft === 1 ? 'one document' : `${documentsLeft} documents`,
    );
  }
  if (!parts.length) return 'Nothing outstanding here.';
  const sentence = `${parts.join(' and ')} still needed.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * The panel header. Counts the SAME answers the footer counts, and names the
 * optional ones rather than quietly folding them into the total.
 */
export function answerHeading(t: AnswerTally): string {
  const optional =
    t.optional === 0
      ? ''
      : t.optional === 1
        ? ' · one more is optional'
        : ` · ${t.optional} more are optional`;
  if (t.needed === 0) {
    // ⚠️ NOTHING ON THE STEP AND EVERYTHING ON IT ANSWERED ARE DIFFERENT
    // SENTENCES. `total` separates them: "Nothing to answer here" over four
    // answers the member has just typed reads as though they had been thrown
    // away.
    if (t.total === 0) return 'Nothing to answer here';
    if (t.optional === 0) return 'Nothing here is required, and it is all in';
    return t.optional === 1
      ? 'Nothing here is required — one answer you may add'
      : `Nothing here is required — ${t.optional} answers you may add`;
  }
  return `We have ${t.have} of the ${t.needed} answers this section needs${optional}`;
}
