import type { MotivationLicenceType } from '@prisma/client';
import {
  fieldByKey,
  fieldsFor,
  isVisible,
  type MotivationField,
} from '../motivation-fields';
import { resolveSportingPurpose } from '../motivation-purpose';
import { huntGameClassOptions } from '../motivation-hunt-classes';
import type { SheetItem, SheetResponse } from '../motivation-sheet.service';
import {
  sportingFields,
  strategyFor,
} from './intake-strategies';
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
): IntakeChoice[] {
  if (field.kind === 'cards') {
    const options =
      field.key === 'hunt_game_class' && answers
        ? huntGameClassOptions(answers.firearm_calibre ?? '')
        : (item?.options ?? field.options ?? []);
    return options.map((o) => ({ value: o.key, label: o.sentence }));
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
  return suggestions.map((s) => ({ value: s, label: s }));
}

function valueOf(
  key: string,
  answers: Record<string, string>,
  items: Map<string, SheetItem>,
): string {
  return (items.get(key)?.value ?? answers[key] ?? '').trim();
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
        f.kind === 'date' ? 'Choose a date' : 'Type your answerâ€¦',
    }));
}

function visibleFields(
  type: MotivationLicenceType,
  strategy: IntakeStrategy,
  answers: Record<string, string>,
): { key: string; field: MotivationField }[] {
  const purpose =
    (answers.firearm_use_kind ?? '').trim() ||
    resolveSportingPurpose(answers);
  const keys = sportingFields(strategy, purpose);
  const out: { key: string; field: MotivationField }[] = [];
  for (const key of keys) {
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
    if (!field.required || field.internal) continue;
    if (field.formOnly || field.key.startsWith('history_')) continue;
    if (!isVisible({ ...field, internal: undefined }, answers)) continue;
    out.push({ key: field.key, field });
  }
  return out;
}

export interface PlannerInput {
  type: MotivationLicenceType;
  answers: Record<string, string>;
  sheet: SheetResponse;
  provenance?: Record<string, { source?: string }>;
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
  const strategy = strategyFor(input.type);
  const items = new Map(input.sheet.items.map((i) => [i.key, i]));
  const merged = { ...input.answers };
  for (const item of input.sheet.items) merged[item.key] = item.value;
  return visibleFields(input.type, strategy, merged).filter(
    ({ key }) => valueOf(key, merged, items) === '',
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

  const calibre = (merged.firearm_calibre ?? '').trim();
  const huntClasses = key === 'hunt_game_class' && calibre;
  const isPrimaryThreat = key === 'threat_circumstances';
  const isPrimaryQuarry = key === 'intended_quarry';
  return {
    id: key,
    fieldKey: key,
    label: huntClasses
      ? `What you hunt with your ${calibre}`
      : isPrimaryThreat
        ? 'What is your primary reason or situation that requires a firearm for self-defence?'
        : isPrimaryQuarry
          ? `What game or species do you intend to hunt with this ${calibre || 'firearm'}?`
          : field.label,
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
    choices:
      sensitive &&
      field.kind !== 'choice' &&
      field.kind !== 'yesno' &&
      field.kind !== 'cards'
        ? []
        : choicesFor(field, items.get(key), suggestions, merged),
    ...(details.length ? { details } : {}),
    multi,
    sensitive,
    customPlaceholder:
      field.kind === 'date' ? 'Choose a date' : 'Or type your own answerâ€¦',
    progress: { answered, total },
    optional: field.required !== true,
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
  const existing = valueOf(key, merged, items);
  if (!existing) return true;
  const confirmThisApplication =
    key === 'intended_quarry' || key === 'firearm_use_kind';
  const source = provenance?.[key]?.source;
  return Boolean(
    confirmThisApplication && source !== undefined && source !== 'MEMBER',
  );
}

function plannerContext(input: PlannerInput) {
  const strategy = strategyFor(input.type);
  const items = new Map(input.sheet.items.map((i) => [i.key, i]));
  const merged = { ...input.answers };
  for (const item of input.sheet.items) merged[item.key] = item.value;
  const fields = visibleFields(input.type, strategy, merged);
  const answered = fields.filter(
    (f) => valueOf(f.key, merged, items) !== '',
  ).length;
  return { strategy, items, merged, fields, answered, total: fields.length };
}

export function planQuestion(input: PlannerInput): IntakeQuestion | null {
  const { strategy, items, merged, fields, answered, total } =
    plannerContext(input);
  const next = fields.find(
    ({ key }) => isPending(key, merged, items, input.provenance),
  );
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

/** How many questions one card may carry. */
export const GROUP_CAP = 6;

export function planGroup(
  input: PlannerInput,
  cap: number = GROUP_CAP,
): PlannedGroup | null {
  const { merged, items, fields } = plannerContext(input);
  /**
   * ⚠️ OPTIONAL QUESTIONS ARE NOT ASKED IN THE CONVERSATION.
   *
   * The card shows one question at a time and Continue needs an answer, so an
   * optional question would hold the member hostage — the server keeps it
   * pending because nothing answers it, and the client would re-serve the same
   * field forever. Optional values stay reachable on the sheet and from the
   * profile; they are simply not part of the walk. Operator, 2026-11-05:
   * "It should keep things minimal."
   */
  const pending = fields.filter(
    ({ key, field }) =>
      field.required === true &&
      isPending(key, merged, items, input.provenance),
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
  const inTopic = fields.filter(
    (f) => topicForField(f.key) === id && f.field.required === true,
  );
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
