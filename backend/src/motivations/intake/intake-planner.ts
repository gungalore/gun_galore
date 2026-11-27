import type { MotivationLicenceType } from '@prisma/client';
import {
  CASE_NOTE_KEYS,
  fieldByKey,
  fieldsFor,
  isSelfDefence,
  isVisible,
  type MotivationField,
} from '../motivation-fields';
import { resolveSportingPurpose } from '../motivation-purpose';
import { MIN_HISTORY_WORDS, missingDetail } from '../motivation-completeness';
import { huntGameClassOptions } from '../motivation-hunt-classes';
import { cartridgeSource } from '../motivation-cartridge';
import type { SheetItem, SheetResponse } from '../motivation-sheet.service';
import {
  sportingFields,
  CASE_KEYS,
  SELF_DEFENCE_ONLY_KEYS,
  strategyFor,
} from './intake-strategies';
import { DRAFTED_KEYS } from './intake-draft';
import type { InterviewBrief } from './intake-brief';
import { chipsFor, rankCardOptions, type ChipContext } from './interview-chips';
import type {
  IntakeChoice,
  IntakeDetailField,
  IntakeQuestion,
  IntakeStrategy,
  IntakeTopicId,
} from './intake.types';
import { TOPIC_ORDER, TOPIC_TITLES, topicForField } from './intake-topics';

/**
 * A topic is one field. The strategy groups fields into a coverage order;
 * the planner always asks the first visible, unanswered one. This is the
 * whole of the "ask what fills the most" rule â€” the model never chooses it.
 */
function choicesFor(
  field: MotivationField,
  item: SheetItem | undefined,
  suggestions: readonly string[],
  answers?: Record<string, string>,
  ctx?: ChipContext,
): IntakeChoice[] {
  if (field.kind === 'cards') {
    /**
     * ⚠️ THE RANKING IS THE POINT. `rankBy` on a card says how to order it for
     * this applicant (their precinct, their trade, their calibre, their
     * association). Until now nothing read it and every member saw registry
     * order. Ranking only moves options forward; nothing is hidden.
     */
    const source = item?.options ?? field.options ?? [];
    const options = ctx ? rankCardOptions(source, ctx) : source;
    const huntClassOptions =
      field.key === 'hunt_game_class' && answers
        ? // ⚠️ THE CHOSEN CARTRIDGE, NOT THE TYPED FAMILY. A member who typed
          // "6.5" and then chose "6,5 Creedmoor" must see the classes that
          // cartridge supports, not the family's union.
          huntGameClassOptions(cartridgeSource(answers))
        : options;
    return huntClassOptions.map((o) => ({ value: o.key, label: o.sentence }));
  }
  if (field.kind === 'choice' || field.kind === 'yesno') {
    const values =
      item?.choices ??
      field.choices ??
      (field.kind === 'yesno' ? ['Yes', 'No'] : []);
    return values.map((v) => ({ value: v, label: v }));
  }
  if (field.kind === 'multi') {
    const groups = item?.optionGroups ?? [];
    const fromGroups = groups.flatMap((g) =>
      g.options.map((o) => ({ value: o.value, label: o.label })),
    );
    const values = item?.choices ?? field.choices ?? [];
    return [
      ...fromGroups,
      ...values.map((v) => ({ value: v, label: v })),
    ];
  }
  /**
   * ⚠️ A SHORT FIELD CAN STILL CARRY CHOICES. The cartridge question is the
   * first one: the sheet serves the candidate rounds as buttons, and the text
   * box stays open for anything not held. Without this branch the buttons
   * would arrive as the field's (empty) research suggestions.
   */
  if (field.kind === 'short' && item?.choices?.length) {
    return item.choices.map((v) => ({ value: v, label: v }));
  }
  return suggestions.map((s) => ({ value: s, label: s }));
}

/**
 * ⚠️ THE BRIEF'S CHIPS ARE ONLY FOR OPEN QUESTIONS. A closed field's choices
 * are the values the validator accepts; a researched chip outside that set
 * would be refused on save. For a `short`/`long` question the chips are
 * suggestions, so the researched ones lead and the field's own list fills the
 * rest.
 */
function mergeBriefChoices(
  field: MotivationField,
  base: IntakeChoice[],
  chips: { value: string; label: string }[] | undefined,
): IntakeChoice[] {
  if (!chips?.length) return base;
  if (field.kind !== 'short' && field.kind !== 'long') return base;
  const seen = new Set<string>();
  const out: IntakeChoice[] = [];
  for (const chip of [...chips, ...base]) {
    const value = chip.value.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push({ value, label: chip.label.trim() || value });
    if (out.length >= 6) break;
  }
  return out;
}

function valueOf(
  key: string,
  answers: Record<string, string>,
  items: Map<string, SheetItem>,
): string {
  /**
   * ⚠️ THE STORED ANSWER IS THE FALLBACK WHEN THE SHEET BLANKS A PLACEHOLDER.
   * The sheet runs member-typed values through answerValue(), which turns the
   * word "None" into '' — correct for a licence card, wrong for an optional
   * question the member answered in words. `item.value ?? answer` stopped at
   * the empty item, so the planner saw "needs_you" forever and re-asked a
   * question that was already answered (operator, 2026-11-23). Prefer what is
   * on screen, then what was saved; only when neither carries a value is the
   * question pending.
   */
  const fromSheet = (items.get(key)?.value ?? '').trim();
  return fromSheet || (answers[key] ?? '').trim();
}

/**
 * The follow-ups on a declaration. They are the showIf children of the answer:
 * a Yes opens station, case number, charge, outcome (or whichever the field
 * owns). The UI shows them in a small sheet over the question, which is what
 * "details popping up when Yes is selected" means in practice.
 */
function detailsFor(
  type: MotivationLicenceType,
  key: string,
  answers: Record<string, string>,
): IntakeDetailField[] {
  const withYes = { ...answers, [key]: 'Yes' };
  return fieldsFor(type)
    .filter(
      (f) =>
        f.showIf?.key === key &&
        isVisible({ ...f, internal: undefined }, withYes),
    )
    .map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      help: f.help ?? '',
      choices: choicesFor(f, undefined, []),
      multi: f.kind === 'multi' || f.kind === 'cards',
      customPlaceholder:
        f.kind === 'date' ? 'Choose a date' : 'Type your answer…',
    }));
}

function visibleFields(
  type: MotivationLicenceType,
  strategy: IntakeStrategy,
  answers: Record<string, string>,
  brief?: InterviewBrief | null,
): { key: string; field: MotivationField }[] {
  const purpose =
    (answers.firearm_use_kind ?? '').trim() ||
    resolveSportingPurpose(answers);
  const keys = [...sportingFields(strategy, purpose)];
  /**
   * ⚠️ THE BRIEF'S FOLLOW-UP SLOTS JOIN THE LIST ONLY WHEN IT WROTE THEM.
   * They belong to no strategy — they are the researcher's own questions — so
   * they are appended here when the brief names them, and never otherwise.
   */
  const briefKeys = new Set(
    (brief?.questions ?? []).map((q) => q.fieldKey),
  );
  for (const key of CASE_NOTE_KEYS) {
    if (briefKeys.has(key) && !keys.includes(key)) keys.push(key);
  }
  const out: { key: string; field: MotivationField }[] = [];
  /**
   * ⚠️ A KEY LISTED TWICE IS STILL ONE QUESTION.
   *
   * `residence_type` was in the common block and again in the self-defence
   * block, so the raw plan carried it twice; the card deduped it at the last
   * moment and the progress counter still counted two. Dedupe where the list is
   * built, so every reader agrees.
   */
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    /**
     * ⚠️ NARRATIVE FIELDS ARE FILLED BY IntakeDraftService, NEVER ASKED.
     *
     * Operator decision 2026-11-26: intake asks only facts no document can
     * supply. The shooting history, the threat circumstances, the hunting and
     * sport record and the renewal's continued use are paragraphs the writer
     * composes from the application and the member reviews — asking for them
     * was what left the interview serving the same card twice. This exclusion
     * is why `shooting_history` can never appear in a plan for ANY licence
     * type.
     */
    if (DRAFTED_KEYS.has(key)) continue;
    const field = fieldByKey(type, key);
    if (!field) continue;
    /**
     * ⚠️ FORM-ONLY FIELDS AND THE DECLARATION HISTORY ARE NEVER ASKED, IN EITHER
     * MODE. They existed to fill boxes on a SAPS 271 we no longer produce, and
     * the six history questions were the applicant's disclosure, which now
     * surfaces only when a document raises one. They stay in the registry so
     * documents and extraction can still read them; nobody is asked for them.
     */
    if (field.formOnly || key.startsWith('history_')) continue;
    /**
     * ⚠️ THE SECURITY PARAGRAPH BELONGS TO SELF-DEFENCE ONLY. The premises block
     * and the travelled-areas box write the section 13/14 "what I already do and
     * where it stops" argument; a hunting, sport or renewal application does not
     * carry it. The operator's live S16 test was asked about burglar bars and
     * security gates — see SELF_DEFENCE_ONLY_KEYS in intake-strategies.ts.
     */
    if (SELF_DEFENCE_ONLY_KEYS.has(key) && !isSelfDefence(type)) continue;
    /**
     * âš ï¸ INTERNAL IS A SHEET DECISION, NOT AN INTERVIEW DECISION. The purpose
     * cards and long answers were hidden from the sheet in 2026-10-17 but kept
     * in the registry and in the writer's fact pack. The interview is the door
     * they were kept for, so test their showIf clause without the hide flag.
     */
    if (!isVisible({ ...field, internal: undefined }, answers)) continue;
    out.push({ key, field });
  }

  /**
   * âš ï¸ THE STRATEGY IS A MENU, NOT THE WHOLE FORM. A required field added to
   * the registry after this list was written was never asked, and the
   * interview declared itself finished while the sheet still showed "1 thing
   * left" â€” MO000022's `licence_holder_type`. Anything required, visible and
   * not already in the strategy is appended at the end, so the interview
   * cannot finish while a required answer is still missing. Internal fields
   * stay out: those are writer-only context, not DFO questions.
   */
  const covered = new Set(out.map((entry) => entry.key));
  for (const field of fieldsFor(type)) {
    if (covered.has(field.key)) continue;
    // Narrative fields are drafted, never asked — including from this
    // catch-all required loop, which otherwise puts a required history back.
    if (DRAFTED_KEYS.has(field.key)) continue;
    if (!field.required || field.internal) continue;
    if (field.formOnly || field.key.startsWith('history_')) continue;
    if (SELF_DEFENCE_ONLY_KEYS.has(field.key) && !isSelfDefence(type)) continue;
    if (!isVisible({ ...field, internal: undefined }, answers)) continue;
    out.push({ key: field.key, field });
    covered.add(field.key);
  }

  /**
   * ⚠️ THE OWNED-FIREARMS TABLE IS ASKED ONLY WHEN THE GATE SAYS YES.
   *
   * The registry has fourteen rows × eight columns for the SAPS 271, and none
   * of them is required. Asking all of them would put a hundred questions on a
   * first-time applicant who owns nothing. The gate and the count turn it into
   * a short table: one row per firearm, six facts each, and only the rows the
   * member said they have. The old review sheet still owns the rest.
   */
  if ((answers.has_existing_firearms ?? '').trim() === 'Yes') {
    const count = Number.parseInt(
      (answers.existing_firearm_count ?? '').trim(),
      10,
    );
    if (Number.isFinite(count) && count > 0) {
      for (let n = 1; n <= Math.min(count, 14); n++) {
        for (const column of OWNED_ASKED_COLUMNS) {
          const key = `existing_firearm_${n}_${column}`;
          if (covered.has(key)) continue;
          const field = fieldByKey(type, key);
          if (!field) continue;
          out.push({ key, field });
          covered.add(key);
        }
      }
    }
  }
  return out;
}

/** The six facts that make the owned table useful to the DFO and the writer. */
const OWNED_ASKED_COLUMNS = [
  'type',
  'make',
  'model',
  'calibre',
  'serial',
  'section_held',
] as const;

export interface PlannerInput {
  type: MotivationLicenceType;
  answers: Record<string, string>;
  sheet: SheetResponse;
  provenance?: Record<string, { source?: string }>;
  /**
   * The research brief, when one has landed.
   *
   * ⚠️ ADVISORY ONLY. It reorders the questions within a topic, phrases them,
   * says why each is needed and supplies chips. It cannot remove a pending
   * field: the caller still appends every required and detail-gated question
   * that the brief did not mention.
   */
  brief?: InterviewBrief | null;
}

/** The brief's entry for one field, if it covers it. */
function briefFor(
  brief: InterviewBrief | null | undefined,
  key: string,
): { question: string; why: string; priority: number } | undefined {
  return brief?.questions.find((entry) => entry.fieldKey === key);
}

/**
 * ⚠️ REQUIRED FIRST, THEN THE BRIEF'S ORDER. A card must never open with an
 * optional question while a fact the gate refuses to do without is still
 * pending on the same card. Inside that rule, the brief decides: it wrote its
 * questions in the order an interviewer would ask them.
 */
function orderPending(
  entries: { key: string; field: MotivationField }[],
  required: (entry: { key: string; field: MotivationField }) => boolean,
  brief: InterviewBrief | null | undefined,
): { key: string; field: MotivationField }[] {
  const rank = (entry: { key: string; field: MotivationField }): number => {
    const weight = required(entry) ? 0 : 1000;
    const order = briefFor(brief, entry.key)?.priority ?? 999;
    return weight + order;
  };
  // Stable sort: fields the brief does not mention keep registry order.
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

/**
 * Every visible field the interview still needs, in strategy order.
 *
 * âš ï¸ THE EXTRACTOR'S CANDIDATE LIST. A single sentence can answer the make,
 * model, calibre and quarry at once; without this list the model has no
 * allow-list to write those extra facts into and the interview asks them one
 * at a time anyway. Same visibility and value rules as planQuestion.
 */
export function pendingFields(
  input: PlannerInput,
): { key: string; field: MotivationField }[] {
  /**
   * ⚠️ ONE MERGE RULE, NOT TWO. This used to re-implement `plannerContext`'s
   * merge and overwrite a stored answer with the sheet's blank projection,
   * which is exactly how an answered optional question ("None") stayed
   * pending in the extractor's candidate list. Use the shared context so the
   * three planners cannot disagree about what is answered.
   */
  const { strategy, items, merged } = plannerContext(input);
  return visibleFields(input.type, strategy, merged).filter(({ key }) =>
    isPending(key, merged, items, input.provenance),
  );
}
/**
 * Build one question from one field.
 *
 * ⚠️ ONE BUILDER, TWO CALLERS. The single-question path and the grouped path
 * must produce the identical object — same chips, same details, same sensitive
 * rule — or a member would see one shape when a group is served and another
 * when it is not. The body below is the body the loop always had.
 */
function buildQuestion(args: {
  input: PlannerInput;
  key: string;
  field: MotivationField;
  strategy: IntakeStrategy;
  merged: Record<string, string>;
  items: Map<string, SheetItem>;
  answered: number;
  total: number;
}): IntakeQuestion {
  const { input, key, field, strategy, merged, items, answered, total } = args;

  /**
   * ⚠️ SENSITIVE ANSWERS ARE NOT SENT TO THE MODEL, and the UI renders the
   * same form control the review sheet uses. The question here is a plain
   * label, never a model-phrased one.
   */
  const sensitive =
    key === 'threat_circumstances'
      ? false
      : Boolean(field.sensitive || field.formOnly);
  const suggestions = strategy.suggestions[key] ?? [];
  const details =
    field.kind === 'yesno' ? detailsFor(input.type, key, merged) : [];
  const multi =
    key === 'firearm_use_kind'
      ? false
      : field.kind === 'cards' ||
        field.kind === 'multi' ||
        key === 'threat_circumstances' ||
        (suggestions.length > 1 &&
          (key === 'intended_quarry' ||
            key === 'hunting_locations' ||
            key === 'competition_record'));

  /**
   * ⚠️ THE EXACT CARTRIDGE WHEN ONE WAS CHOSEN, NOT THE TYPED FAMILY. A member
   * who typed "6.5" and answered the cartridge question with "6,5 Creedmoor"
   * must see "What you hunt with your 6,5 Creedmoor?" and the hunt classes that
   * round supports — `cartridgeSource` is the one resolver the fact pack, the
   * drawing and the sheet already use. Legacy rows that hold both fields are
   * covered without a migration.
   */
  const calibre = cartridgeSource(merged).trim();
  const huntClasses = key === 'hunt_game_class' && calibre;
  const isPrimaryThreat = key === 'threat_circumstances';
  const isPrimaryQuarry = key === 'intended_quarry';
  const briefEntry = briefFor(input.brief, key);
  const chipContext: ChipContext = {
    type: input.type,
    answers: merged,
    brief: input.brief,
  };
  const baseChoices =
    sensitive &&
    field.kind !== 'choice' &&
    field.kind !== 'yesno' &&
    field.kind !== 'cards'
      ? []
      : choicesFor(field, items.get(key), suggestions, merged, chipContext);
  /**
   * ⚠️ THE BRIEF'S WORDING WINS OVER THE REGISTRY LABEL, AND THE CALIBRE
   * OVERRIDES WIN OVER NOTHING. The brief wrote its question knowing the
   * cartridge and the research; the deterministic overrides exist for the
   * first card and for an outage. A sensitive field never takes model wording.
   */
  const plainLabel = huntClasses
    ? `What you hunt with your ${calibre}`
    : isPrimaryThreat
      ? 'What is your primary reason or situation that requires a firearm for self-defence?'
      : isPrimaryQuarry
        ? `What game or species do you intend to hunt with this ${calibre || 'firearm'}?`
        : field.label;
  const choices = mergeBriefChoices(
    field,
    baseChoices,
    // Research first, catalogue second; a closed field ignores both because
    // its allowed values are fixed.
    sensitive ? undefined : chipsFor(field, chipContext),
  );
  /**
   * ⚠️ A CARD SERVED FOR EDITING ARRIVES PREFILLED WITH WHAT WAS SAVED.
   *
   * Back navigation re-opens an earlier topic's card (IntakeState.navigation ->
   * GET :id/intake/card), and the member must see their own answers in the
   * controls rather than a blank form that looks like the answer was lost. The
   * frontend seeds its per-question state from `value` / `values`; a new card
   * is a new group object, so nothing leaks between turns.
   *
   * For a multi/cards question the stored value is a comma list of option KEYS;
   * only the values the current choices actually offer become `values` (a
   * retired option is kept as free text in `value` rather than silently
   * dropped). A single-choice answer is just `value`.
   */
  const stored = valueOf(key, merged, items);
  const multiChoice = field.kind === 'cards' || field.kind === 'multi';
  let value: string | undefined;
  let values: string[] | undefined;
  if (stored) {
    if (multiChoice) {
      const matched: string[] = [];
      const unmatched: string[] = [];
      for (const part of stored
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        const hit = choices.find(
          (choice) =>
            choice.value.toLowerCase() === part.toLowerCase() ||
            choice.label.toLowerCase() === part.toLowerCase(),
        );
        if (hit) {
          if (!matched.includes(hit.value)) matched.push(hit.value);
        } else {
          unmatched.push(part);
        }
      }
      if (matched.length) values = matched;
      if (unmatched.length) value = unmatched.join(', ');
      if (!values && !value) value = stored;
    } else {
      value = stored;
    }
  }
  return {
    id: key,
    fieldKey: key,
    label: !sensitive && briefEntry?.question
      ? briefEntry.question
      : plainLabel,
    why: briefEntry?.why ?? '',
    help:
      (huntClasses
        ? `Tap every class that is true of this ${calibre}.`
        : isPrimaryThreat
          ? 'Select any options that fit your situation, or type your own.'
          : isPrimaryQuarry
            ? 'Select the game you intend to hunt, or type your own.'
            : field.help) ??
      (sensitive
        ? 'This is typed here and never sent to the writing assistant.'
        : ''),
    kind: field.kind,
    choices,
    ...(details.length ? { details } : {}),
    multi,
    sensitive,
    customPlaceholder:
      field.kind === 'date' ? 'Choose a date' : 'Or type your own answer…',
    progress: { answered, total },
    optional: field.required !== true,
    ...(value !== undefined ? { value } : {}),
    ...(values !== undefined ? { values } : {}),
  };
}

/**
 * Is this field still to be asked?
 *
 * ⚠️ THE ROUTER AND THE QUARRY ARE CONFIRMED FOR THIS APPLICATION.
 *
 * A value carried over from the profile or the previous application is a
 * starting point, not this applicant's statement about this firearm. Ask it
 * once in the interview; the answer is stamped MEMBER and never asked again.
 * Every other prefilled field is left alone.
 */
function isPending(
  key: string,
  merged: Record<string, string>,
  items: Map<string, SheetItem>,
  provenance: PlannerInput['provenance'],
): boolean {
  /**
   * ⚠️ A VAULT LICENCE IS THE ANSWER TO THE GATE. When the table already holds
   * a firearm, asking "do you already own any?" would make the member say yes
   * to facts we just read off their own card. The rows speak for themselves.
   */
  if (
    key === 'has_existing_firearms' &&
    Object.keys(merged).some((k) => k.startsWith('existing_firearm_'))
  ) {
    return false;
  }
  /**
   * ⚠️ THE CARTRIDGE IS ASKED ONLY WHEN THE SHEET SAID IT IS OUTSTANDING.
   * The sheet builds that item only for an unresolved calibre, and drops it
   * once the answer resolves — so a resolved "9mm Luger" never sees a second
   * question, and an ambiguous "9mm" sees exactly one.
   */
  if (key === 'firearm_cartridge') {
    // A deliberate Skip settles it, exactly like every other optional field.
    if (provenance?.[key]?.source === 'SKIPPED') return false;
    return items.get(key)?.state === 'needs_you';
  }
  const existing = valueOf(key, merged, items);
  /**
   * ⚠️ A SKIP IS AN ANSWER TO "DO YOU WANT TO ANSWER THIS".
   *
   * Optional case questions are offered once. Without this line the planner
   * sees an empty value, keeps the field pending and puts the same question
   * back on the next card — which is how an "optional" question becomes
   * permanent. See ProvenanceSource 'SKIPPED'.
   */
  if (!existing && provenance?.[key]?.source === 'SKIPPED') return false;
  if (!existing) return true;
  /**
   * ⚠️ ANSWERED IS NOT THE SAME AS ENOUGH. The shooting history is the one
   * field whose gate demands substance, so a one-word answer used to satisfy
   * the planner, end the interview and then fail at write time. An answer below
   * the floor stays pending, which keeps the interview open and re-asks it —
   * the alternative is telling somebody they are finished and then refusing to
   * write.
   *
   * The floor is low (a sentence or two, ticks included) because the section is
   * written from these facts rather than from their length.
   */
  if (key === 'shooting_history' && wordCount(existing) < MIN_HISTORY_WORDS) {
    return true;
  }
  const confirmThisApplication =
    key === 'intended_quarry' || key === 'firearm_use_kind';
  const source = provenance?.[key]?.source;
  return Boolean(
    confirmThisApplication && source !== undefined && source !== 'MEMBER',
  );
}

/** Same counting rule the completeness gate uses for the history floor. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function plannerContext(input: PlannerInput) {
  const strategy = strategyFor(input.type);
  const items = new Map(input.sheet.items.map((i) => [i.key, i]));
  const merged = { ...input.answers };
  /**
   * ⚠️ A BLANK SHEET VALUE IS A DISPLAY PROJECTION, NOT AN ERASER.
   * The sheet runs member-typed answers through answerValue(), which blanks the
   * word "None" — correct for a licence card, wrong for an optional question
   * the member answered in words. Overwriting the stored answer with that ''
   * made the comparison ("what else did you consider") pending forever, so
   * typing None re-asked it (operator, 2026-11-23). Keep the saved answer when
   * the sheet has nothing to show; a real sheet value still wins.
   */
  for (const item of input.sheet.items) {
    if ((item.value ?? '').trim()) merged[item.key] = item.value;
  }
  const fields = visibleFields(input.type, strategy, merged, input.brief).filter(
    // ⚠️ THE CARTRIDGE COUNTS ONLY WHEN THE SHEET SAID IT APPLIES. A resolved
    // calibre has no cartridge item, and leaving the field in the total would
    // park the progress bar one question short of 100% forever.
    (f) => f.key !== 'firearm_cartridge' || items.has('firearm_cartridge'),
  );
  /**
   * ⚠️ A SKIPPED OPTIONAL QUESTION IS SETTLED, NOT OUTSTANDING. Counting only
   * values would leave the progress bar permanently short of 100% on a member
   * who exercised the Skip the interview offered them.
   */
  const answered = fields.filter(
    (f) =>
      valueOf(f.key, merged, items) !== '' ||
      input.provenance?.[f.key]?.source === 'SKIPPED',
  ).length;
  /**
   * ⚠️ REQUIRED = THE REGISTRY SAYS SO, OR THE GATE DOES. Computed from the
   * stored answers, which is what the gate itself reads. Used for the "required
   * before optional" ordering and for the single-question path.
   */
  const detailKeys = new Set(
    missingDetail(input.answers, input.type).map((gap) =>
      gap.code.slice(gap.code.indexOf(':') + 1),
    ),
  );
  const required = (entry: { key: string; field: MotivationField }): boolean =>
    entry.field.required === true || detailKeys.has(entry.key);
  return {
    strategy,
    items,
    merged,
    fields,
    answered,
    total: fields.length,
    detailKeys,
    required,
  };
}

export function planQuestion(input: PlannerInput): IntakeQuestion | null {
  const { strategy, items, merged, fields, answered, total, required } =
    plannerContext(input);
  const pending = orderPending(
    fields.filter(({ key }) =>
      isPending(key, merged, items, input.provenance),
    ),
    required,
    input.brief,
  );
  const next = pending[0];
  if (!next) return null;
  return buildQuestion({
    input,
    key: next.key,
    field: next.field,
    strategy,
    merged,
    items,
    answered,
    total,
  });
}

/**
 * THE INTERVIEW, ONE CATEGORY AT A TIME.
 *
 * A cold applicant has fifty-odd facts to give. Asked one at a time that is
 * fifty screens; asked in the category they belong to it is eight, and the
 * member can see what a group is about before they start typing.
 *
 * ⚠️ THE FIRST GROUP WITH WORK LEFT, ALWAYS. The order comes from
 * TOPIC_ORDER — identity before firearm, because the ID number is what proves
 * an existing licence is theirs, and the firearm is what selects the competency
 * they need. A group is capped so a long category cannot become one endless
 * form; its remainder comes back on the next turn.
 */
/**
 * The question object for one specific field, built exactly as planQuestion
 * would build it. The grouped path needs this: the group decides WHICH fields
 * are asked in one turn, and each still has to carry its own chips, details
 * and flags.
 */
export function questionForField(
  input: PlannerInput,
  key: string,
): IntakeQuestion | null {
  const { strategy, items, merged, fields, answered, total } =
    plannerContext(input);
  const entry = fields.find((f) => f.key === key);
  if (!entry) return null;
  return buildQuestion({
    input,
    key,
    field: entry.field,
    strategy,
    merged,
    items,
    answered,
    total,
  });
}

export interface PlannedGroup {
  id: IntakeTopicId;
  title: string;
  /** 1-based position among the groups that still have work. */
  index: number;
  /** How many groups still have work. */
  total: number;
  /** Answered fields in this category. */
  answered: number;
  /** Every visible field in this category, answered or not. */
  totalInGroup: number;
  questions: { key: string; field: MotivationField }[];
}

/**
 * How many questions one card may carry.
 *
 * ⚠️ SEVEN, NOT SIX, BECAUSE SIX LEFT A ONE-QUESTION CARD. The firearm block is
 * seven facts (type, action, make, model, calibre, serial, what else was
 * considered); at six the seventh fell onto a card of its own, which was an
 * extra screen and two taps to answer one question. Seven still fits a phone,
 * because every question on the card is a chip or one short box.
 */
export const GROUP_CAP = 7;

/**
 * The fields the interview is allowed to ask, plus the two key sets its order
 * consults.
 *
 * ⚠️ ONE RULE, THREE CALLERS. `planGroup` (the next card), `planCard` (an
 * earlier topic re-opened for editing) and `navigationFor` (where Back goes)
 * must agree exactly about what is askable, or Back can point at a topic the
 * walk never serves. The `asked()` predicate below lived inline in planGroup
 * and is lifted out for that reason, not for tidiness.
 */
interface AskablePlan {
  detailKeys: Set<string>;
  briefKeys: Set<string>;
  askable: { key: string; field: MotivationField }[];
}

function askablePlan(
  input: PlannerInput,
  fields: { key: string; field: MotivationField }[],
): AskablePlan {
  /**
   * ⚠️ THE DOCUMENT'S OWN GATE DECIDES WHAT THE CONVERSATION ASKS.
   *
   * This filtered on `required === true` alone, and the registry does not mark
   * `firearm_use_kind` or `intended_quarry` required — the sheet never printed
   * them, so nobody had to tick them. `missingDetail()` refuses generation
   * without both, which meant the interview could walk every required box, end
   * itself, and then tell the member "a few more details before I can write it"
   * about two questions it had never asked. Operator, 2026-11-06: "It never
   * asked these questions."
   *
   * Anything the detail gate names is asked, whether or not the registry calls
   * it required. Computed from the stored answers rather than the merged view,
   * because that is what the gate itself reads.
   */
  const detailKeys = new Set(
    missingDetail(input.answers, input.type).map((gap) =>
      gap.code.slice(gap.code.indexOf(':') + 1),
    ),
  );
  /**
   * The brief's own question list. Only the follow-up slots consult it — the
   * fixed registry questions are asked because the gate needs them, not
   * because a model chose them.
   */
  const briefKeys = new Set(
    (input.brief?.questions ?? []).map((q) => q.fieldKey),
  );
  const asked = (entry: { key: string; field: MotivationField }): boolean => {
    /**
     * ⚠️ THE BRIEF'S OWN FOLLOW-UPS ARE ASKED ONLY WHEN IT WROTE THEM. Every
     * other question is bound to the registry; these three slots exist so the
     * researcher can ask something no fixed field covers. An omitted slot is
     * not a skipped question — it was never needed.
     */
    if ((CASE_NOTE_KEYS as readonly string[]).includes(entry.key)) {
      return briefKeys.has(entry.key);
    }
    return (
      entry.field.required === true ||
      detailKeys.has(entry.key) ||
      /**
       * ⚠️ THE CASE QUESTIONS ARE OFFERED, ONCE. These are optional in the
       * registry (the sheet may still show them), but a document written without
       * them is the thin one: the security paragraph, the routine, the ground and
       * the discipline. `CASE_KEYS` is the list of fields the interview puts on
       * screen even though nobody is forced to answer; Skip records the decision
       * so the question is not repeated. See intake-strategies.ts.
       */
      CASE_KEYS.has(entry.key)
    );
  };
  return { detailKeys, briefKeys, askable: fields.filter(asked) };
}

/**
 * The fields in one topic that its progress counter is built from.
 *
 * ⚠️ THE COUNTER MUST NOT SHRINK WHEN A DETAIL QUESTION IS ANSWERED.
 * `detailKeys` is what is missing right now, so counting the group's total
 * from it turned "Question 3 of 3" into "Question 3 of 2" the moment the last
 * detail question landed. This set is the same gate with every value blanked
 * — what this type and this purpose could ask — so the total is stable and
 * still never counts a question the walk will not put.
 */
function countedInTopic(
  input: PlannerInput,
  merged: Record<string, string>,
  fields: { key: string; field: MotivationField }[],
  id: IntakeTopicId,
  briefKeys: ReadonlySet<string>,
): { key: string; field: MotivationField }[] {
  const purpose =
    (merged.firearm_use_kind ?? '').trim() ||
    resolveSportingPurpose(merged);
  const countedDetail = new Set(
    missingDetail({ firearm_use_kind: purpose }, input.type).map((gap) =>
      gap.code.slice(gap.code.indexOf(':') + 1),
    ),
  );
  return fields.filter(
    (f) =>
      topicForField(f.key) === id &&
      (f.field.required === true ||
        countedDetail.has(f.key) ||
        CASE_KEYS.has(f.key) ||
        ((CASE_NOTE_KEYS as readonly string[]).includes(f.key) &&
          briefKeys.has(f.key))),
  );
}

function requiredEntry(
  detailKeys: ReadonlySet<string>,
): (entry: { key: string; field: MotivationField }) => boolean {
  return (entry) => entry.field.required === true || detailKeys.has(entry.key);
}

export function planGroup(
  input: PlannerInput,
  cap: number = GROUP_CAP,
): PlannedGroup | null {
  const { merged, items, fields } = plannerContext(input);
  const { detailKeys, briefKeys, askable } = askablePlan(input, fields);

  /**
   * ⚠️ OPTIONAL QUESTIONS ARE NOT ASKED — EXCEPT THE CASE ONES.
   *
   * An optional question holds the member hostage when the card cannot move on
   * without it, so the walk skips optional values that the sheet and the profile
   * already expose. Operator, 2026-11-05: "It should keep things minimal."
   *
   * The exception is `CASE_KEYS`: the case facts that make the document
   * specific. They are offered once, marked Optional on the card, and Skip
   * settles them for good. Everything else optional stays on the sheet.
   */
  const pending = orderPending(
    askable.filter((entry) =>
      isPending(entry.key, merged, items, input.provenance),
    ),
    requiredEntry(detailKeys),
    input.brief,
  );
  if (!pending.length) return null;

  const byTopic = new Map<
    IntakeTopicId,
    { key: string; field: MotivationField }[]
  >();
  for (const entry of pending) {
    const id = topicForField(entry.key);
    const list = byTopic.get(id) ?? [];
    list.push(entry);
    byTopic.set(id, list);
  }

  const order = TOPIC_ORDER.filter((id) => byTopic.has(id));
  const id = order[0];
  const groupPending = byTopic.get(id) ?? [];
  const inTopic = countedInTopic(input, merged, fields, id, briefKeys);
  return {
    id,
    title: TOPIC_TITLES[id],
    index: order.indexOf(id) + 1,
    total: order.length,
    answered: Math.max(0, inTopic.length - groupPending.length),
    totalInGroup: inTopic.length,
    questions: groupPending.slice(0, Math.max(1, cap)),
  };
}

/**
 * ONE TOPIC'S CARD, ANSWERED OR NOT — the Back button's destination.
 *
 * ⚠️ IT IS THE SAME `asked()` SET THE WALK USES, WITH NOTHING FILTERED FOR
 * BEING ANSWERED. Back re-opens the previous topic so the member can correct a
 * fact; the answers arrive prefilled on each question (buildQuestion), and the
 * card is built through the same phrased/enriched path as the forward one, so
 * the labels and chips match what they saw the first time.
 *
 * `index`/`total` count the topics that HAVE askable fields, not the topics
 * still pending: editing the first topic of an almost-finished application
 * must not show "Step 0 of 1".
 */
export function planCard(
  input: PlannerInput,
  topicId: IntakeTopicId,
  cap: number = GROUP_CAP,
): PlannedGroup | null {
  const { merged, items, fields } = plannerContext(input);
  const { detailKeys, briefKeys, askable } = askablePlan(input, fields);
  const inTopic = askable.filter(
    (entry) => topicForField(entry.key) === topicId,
  );
  if (!inTopic.length) return null;

  const ordered = orderPending(inTopic, requiredEntry(detailKeys), input.brief);
  const pendingInTopic = ordered.filter((entry) =>
    isPending(entry.key, merged, items, input.provenance),
  );
  const counted = countedInTopic(input, merged, fields, topicId, briefKeys);
  const askableTopics = TOPIC_ORDER.filter((id) =>
    askable.some((entry) => topicForField(entry.key) === id),
  );
  return {
    id: topicId,
    title: TOPIC_TITLES[topicId],
    index: Math.max(1, askableTopics.indexOf(topicId) + 1),
    total: askableTopics.length,
    answered: Math.max(0, counted.length - pendingInTopic.length),
    totalInGroup: counted.length,
    questions: ordered.slice(0, Math.max(1, cap)),
  };
}

/**
 * Where the Back button goes: the askable topic immediately before the first
 * topic with pending work.
 *
 * ⚠️ STATELESS ON PURPOSE. The browser holds no history and the server holds no
 * cursor: the same answers always produce the same back target, so a refresh,
 * a new tab or a stale page cannot disagree about where Back goes. Null when
 * the current topic is the first one with work left, and null when the
 * interview has nothing left to ask.
 */
export function navigationFor(input: PlannerInput): {
  back: { id: IntakeTopicId; title: string } | null;
} {
  const { fields } = plannerContext(input);
  const { askable } = askablePlan(input, fields);
  const plan = planGroup(input);
  if (!plan) return { back: null };
  const askableTopics = TOPIC_ORDER.filter((id) =>
    askable.some((entry) => topicForField(entry.key) === id),
  );
  const at = askableTopics.indexOf(plan.id);
  if (at <= 0) return { back: null };
  const previous = askableTopics[at - 1];
  return { back: { id: previous, title: TOPIC_TITLES[previous] } };
}

/** The branch the document is going to argue, for the evidence picker. */
export function purposeForAnswers(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): 'self-defence' | 'hunting' | 'sport' | 'continued use' {
  const strategy = strategyFor(type);
  if (strategy.purpose === 'self_defence') return 'self-defence';
  if (strategy.purpose === 'renewal') return 'continued use';
  const purpose =
    (answers.firearm_use_kind ?? '').trim() ||
    resolveSportingPurpose(answers);
  if (purpose === 'sport') return 'sport';
  return 'hunting';
}
