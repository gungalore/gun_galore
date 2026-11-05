import type { MotivationLicenceType } from '@prisma/client';
import {
  fieldByKey,
  fieldsFor,
  isVisible,
  type MotivationField,
} from '../motivation-fields';
import { resolveSportingPurpose } from '../motivation-purpose';
import { huntGameClassOptions } from '../motivation-hunt-classes';
import type { MotivationOutputMode } from '../motivation-output';
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
} from './intake.types';

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
  motivationOnly = false,
): { key: string; field: MotivationField }[] {
  const purpose =
    (answers.firearm_use_kind ?? '').trim() ||
    resolveSportingPurpose(answers);
  const keys = sportingFields(strategy, purpose);
  const out: { key: string; field: MotivationField }[] = [];
  for (const key of keys) {
    const field = fieldByKey(type, key);
    if (!field) continue;
    if (motivationOnly && (field.formOnly || key.startsWith('history_'))) {
      continue;
    }
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
    if (
      motivationOnly &&
      (field.formOnly || field.key.startsWith('history_'))
    ) {
      continue;
    }
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
  /** MOTIVATION_ONLY skips the SAPS 271 form-only questions. */
  outputMode?: MotivationOutputMode;
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
  return visibleFields(
    input.type,
    strategy,
    merged,
    input.outputMode === 'MOTIVATION_ONLY',
  ).filter(({ key }) => valueOf(key, merged, items) === '');
}
export function planQuestion(
  input: PlannerInput,
): IntakeQuestion | null {
  const strategy = strategyFor(input.type);
  const items = new Map(input.sheet.items.map((i) => [i.key, i]));
  const merged = { ...input.answers };
  for (const item of input.sheet.items) merged[item.key] = item.value;

  const fields = visibleFields(
    input.type,
    strategy,
    merged,
    input.outputMode === 'MOTIVATION_ONLY',
  );
  const total = fields.length;
  const answered = fields.filter(
    (f) => valueOf(f.key, merged, items) !== '',
  ).length;

  for (const { key, field } of fields) {
    const existing = valueOf(key, merged, items);
    const source = input.provenance?.[key]?.source;
    /**
     * âš ï¸ THE ROUTER AND THE QUARRY ARE CONFIRMED FOR THIS APPLICATION.
     *
     * A value carried over from the profile or the previous application is a
     * starting point, not this applicant's statement about this firearm. Ask
     * it once in the interview; the answer is stamped MEMBER and never asked
     * again. Every other prefilled field is left alone.
     */
    const confirmThisApplication =
      key === 'intended_quarry' || key === 'firearm_use_kind';
    if (
      existing &&
      !(
        confirmThisApplication &&
        source !== undefined &&
        source !== 'MEMBER'
      )
    ) {
      continue;
    }

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
        field.kind === 'date'
          ? 'Choose a date'
          : 'Or type your own answer…',
      progress: { answered, total },
      optional: field.required !== true,
    };
  }

  return null;
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


