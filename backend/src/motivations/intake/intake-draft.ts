import type { MotivationLicenceType } from '@prisma/client';
import {
  LICENCE_TYPE_LABELS,
  OWNED_ROWS,
  fieldByKey,
  fieldsFor,
  isVisible,
  type MotivationField,
} from '../motivation-fields';
import { answerValue } from '../../common/card-placeholder';
import { resolveSportingPurpose } from '../motivation-purpose';
import { southAfricanise } from '../motivation-scope';
import { missingDetail } from '../motivation-completeness';

// ────────────────────────────────────────────────────────────────────
// THE NARRATIVE THE APPLICANT IS NEVER ASKED, COMPOSED FROM THEIR OWN FACTS.
//
// Operator decision, 2026-11-26: intake asks only facts no document can supply.
// The shooting history, the circumstances behind a self-defence need, the
// hunting or sport record and the renewal's continued use are PARAGRAPHS — they
// are what a professional writer composes from the file, and asking a member to
// type them was the bug: a one-tap chip left the shooting-history card pending
// forever and the interview served the identical screen again.
//
// ⚠️ THE APPLICANT STILL OWNS THE WORDS. Every draft is stamped DRAFTED +
// inferred, renders as "Drafted for you — check it" on the review sheet, and is
// editable and confirmable. A paragraph the member has touched is stamped
// MEMBER and is never re-drafted.
//
// ⚠️ AND THE VALIDATOR IS WHAT MAKES "BELIEVABLE" SAFE. The model is allowed to
// write a generic, first-person narrative and nothing else: no digits, no
// measurements, no dates, no names, no claims. A sentence the DFO could check
// against a document and find wrong is refused here, not discovered later.
//
// PURE — no Nest, no Prisma, no model call, no clock.
// ────────────────────────────────────────────────────────────────────

/**
 * The narrative fields that are drafted, never asked.
 *
 * ⚠️ KEYED GLOBALLY, because field keys are shared across licence types. The
 * planner excludes every one of these from every interview plan for all six
 * types (see intake-planner.ts#visibleFields), and `IntakeDraftService` fills
 * the empty ones.
 */
export const DRAFTED_KEYS: ReadonlySet<string> = new Set<string>([
  'shooting_history',
  'training_history',
  'threat_circumstances',
  'daily_movements',
  's13_movements',
  's13_carry_style',
  'hunting_history',
  'hunting_locations',
  'hunt_reasons',
  'hunt_terrain',
  'hunt_where',
  'hunt_game_class',
  'sport_reasons',
  'sport_formats',
  'activity_record',
  'competition_record',
  'continued_use',
]);

/** The word band a drafted long answer must land in. */
export const DRAFT_MIN_WORDS = 60;
export const DRAFT_MAX_WORDS = 190;
/** A renewal's continued-use paragraph is shorter by design. */
export const DRAFT_CONTINUED_USE_MIN_WORDS = 40;

/** Hunting-branch narrative keys (S15/S16 hunting or both). */
const HUNTING_NARRATIVE: ReadonlySet<string> = new Set([
  'hunt_game_class',
  'hunt_terrain',
  'hunt_where',
  'hunt_reasons',
  'hunting_history',
  'hunting_locations',
]);

/** Sport-branch narrative keys (S15/S16 sport or both). */
const SPORT_NARRATIVE: ReadonlySet<string> = new Set([
  'sport_reasons',
  'sport_formats',
  'activity_record',
  'competition_record',
]);

/** One narrative answer the drafter must fill. */
export interface DraftedTarget {
  key: string;
  label: string;
  kind: MotivationField['kind'];
  /** Long answers only: the band the validator enforces. */
  minWords?: number;
  maxWords?: number;
  maxLength?: number;
  /**
   * `cards` targets only: the option keys the model may choose from. Never
   * invented, never expanded — the sentence is display and the key is stored.
   */
  options?: { key: string; label: string }[];
}

/**
 * The answer keys `draftFacts()` actually consumes.
 *
 * ⚠️ THE REVIEW SCREEN RE-DRAFT TRIGGER READS THIS. A debounced autosave fires
 * on every blur, and correcting a typo in a DRAFTED paragraph must not pay for
 * a whole model pass over every other paragraph. Only a change to one of these
 * facts can make a draft stale, so only one of these may queue a re-draft. The
 * narrative fields themselves are deliberately absent.
 */
export const DRAFT_FACT_KEYS: ReadonlySet<string> = new Set<string>([
  // the applied-for firearm
  'firearm_type',
  'firearm_action',
  'firearm_make',
  'firearm_model',
  'firearm_calibre',
  'firearm_cartridge',
  // the purpose and its factual anchors
  'firearm_use_kind',
  'intended_quarry',
  'hunt_game_class',
  'discipline_exercise',
  // the association (no numbers — draftFacts never sends them)
  'association_name',
  'association_joined',
  'dedicated_since',
  // place and person
  'police_station_province',
  'province',
  'residence_type',
  'home_type',
  'occupation',
]);

/**
 * Did any changed answer actually feed the drafted narrative?
 *
 * ⚠️ PREFIXES ARE COVERED TOO. The premises taps and the owned-firearm table are
 * `premises_*` and `existing_firearm_*` keys, and adding a row or changing a
 * tap is exactly the kind of fact a paragraph was written from. `changedKeys`
 * is keys only — values are never passed here.
 */
export function affectsDraftFacts(changedKeys: readonly string[]): boolean {
  return changedKeys.some(
    (key) =>
      DRAFT_FACT_KEYS.has(key) ||
      key.startsWith('premises_') ||
      key.startsWith('existing_firearm_'),
  );
}

/**
 * The detail gaps the narrative drafter itself is responsible for.
 *
 * ⚠️ ONLY THESE TWO FALL BACK DETERMINISTICALLY. Every other gap
 * `missingDetail()` names is a factual question the interview still asks (the
 * firearm, the competency, the safe, the quarry), and a deterministic paragraph
 * can never stand in for a serial or a safe type.
 */
export const NARRATIVE_GAP_CODES: ReadonlySet<string> = new Set([
  'history:shooting_history',
  'renewal:continued_use',
]);

/**
 * Is the only thing still missing from this application a paragraph we write?
 *
 * ⚠️ THIS IS THE DRAFTING TRIGGER, AND WHY IT IS NOT "DOCUMENTS CONFIRMED".
 * The first cut drafted as soon as the documents were attached, from a file
 * with no firearm and no association yet. That paragraph was generic, and a
 * non-forced run never rewrites its own DRAFTED values — so the generic text
 * stayed and the member reviewed a history that was not about their
 * application. Waiting until every factual gap the generation gate names is
 * filled means the draft is specific to the firearm, the purpose and the
 * association, and it costs no model call at all for an abandoned interview.
 *
 * It also drives the review-save path: the member fills the last factual gap
 * there, and the save can start the first draft because this returns true.
 */
export function onlyNarrativeGapsRemain(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): boolean {
  return missingDetail(answers, type).every((gap) =>
    NARRATIVE_GAP_CODES.has(gap.code),
  );
}

/**
 * The non-sensitive projection sent to the model.
 *
 * ⚠️ NO SERIALS, NO LICENCE NUMBERS, NO ID NUMBERS, NO ADDRESS, NO
 * DECLARATIONS. The model does not need them to write a paragraph and a log
 * line must never carry them; the same discipline as briefFacts().
 */
export interface DraftFacts {
  licence_type: string;
  /**
   * The enum value, so a fallback can branch on the DOCUMENT it is writing for.
   *
   * ⚠️ `licence_type` IS A LABEL; THIS IS THE RULE. A section 13 fallback must
   * not say "hunted" (the guide book forbids hunting words in a self-defence
   * document) even though `purpose` resolves to sport for a handgun; a §24
   * renewal has its own paragraph. See fallbackDraft.
   */
  licence_type_key: MotivationLicenceType;
  purpose: string;
  firearm: Record<string, string>;
  intended_quarry?: string;
  hunt_game_class?: string;
  discipline_exercise?: string;
  association: Record<string, string>;
  province?: string;
  residence_type?: string;
  occupation?: string;
  held_firearms: Record<string, string>[];
  premises: Record<string, string>;
  /** Kinds and labels of the documents already attached — never the contents. */
  documents: { kind: string; label: string }[];
  /** Narrative answers already present, so a draft never contradicts them. */
  narrative_so_far: Record<string, string>;
}

/** What validateDraft needs to know beyond the value itself. */
export interface DraftValidationOptions {
  kind: MotivationField['kind'];
  maxLength?: number;
  /** `cards` only: the option keys the answer must come from. */
  optionKeys?: readonly string[];
  /**
   * Every term the applicant supplied (facts and option sentences). A
   * capitalised word inside one of these is not an invented name.
   */
  allowTerms?: readonly string[];
}

/**
 * Which narrative fields this application could draft, in the order the
 * registry lists them.
 *
 * ⚠️ IT USES resolveSportingPurpose(), NOT THE RAW ROUTER ANSWER. The document
 * is argued along the purpose resolved from the firearm, the battery and the
 * applicant's own tick; `firearm_use_kind` is empty on a document-first
 * application and may disagree with a handgun's forced sport route. Drafting a
 * hunting paragraph for a document that will argue sport is the same failure
 * the planner avoids by resolving the purpose once.
 */
export function draftedFields(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): MotivationField[] {
  const purpose = resolveSportingPurpose(answers);
  const out: MotivationField[] = [];
  for (const field of fieldsFor(type)) {
    if (!DRAFTED_KEYS.has(field.key)) continue;
    if (field.formOnly) continue;
    if (!isVisible({ ...field, internal: undefined }, answers)) continue;
    if (HUNTING_NARRATIVE.has(field.key) && purpose === 'sport') continue;
    if (SPORT_NARRATIVE.has(field.key) && purpose === 'hunting') continue;
    out.push(field);
  }
  return out;
}

/** The empty narrative targets for this application. */
export function draftTargets(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): DraftedTarget[] {
  return draftedFields(type, answers)
    .filter((field) => !(answers[field.key] ?? '').trim())
    .map(targetForField);
}

/** One registry field as a drafter target. Used by the service for a re-draft. */
export function targetForField(field: MotivationField): DraftedTarget {
  const target: DraftedTarget = {
    key: field.key,
    label: field.label,
    kind: field.kind,
  };
  if (field.kind === 'long') {
    target.minWords =
      field.key === 'continued_use'
        ? DRAFT_CONTINUED_USE_MIN_WORDS
        : DRAFT_MIN_WORDS;
    target.maxWords = DRAFT_MAX_WORDS;
  }
  if (field.maxLength) target.maxLength = field.maxLength;
  if (field.kind === 'cards' && field.options?.length) {
    target.options = field.options.map((option) => ({
      key: option.key,
      label: option.sentence,
    }));
  }
  return target;
}

/**
 * Every term a draft may legitimately contain: the facts plus the option
 * sentences. Used by the invented-name check, never sent to the model.
 */
export function draftAllowTerms(
  facts: DraftFacts,
  targets: readonly DraftedTarget[],
): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.trim()) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) {
        push(item);
      }
    }
  };
  push(facts as unknown);
  for (const target of targets) {
    for (const option of target.options ?? []) {
      out.push(option.label);
      out.push(option.key);
    }
  }
  return out;
}

/** The stored card keys as the sentences the model can read. */
function cardSentences(
  type: MotivationLicenceType,
  key: string,
  raw: string,
): string {
  const options = fieldByKey(type, key)?.options ?? [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => options.find((option) => option.key === part)?.sentence ?? part)
    .join(' ');
}

/**
 * The facts the drafter may use — non-sensitive only.
 *
 * ⚠️ THE DOCUMENTS ARRIVE AS KINDS AND LABELS. "COMPETENCY_CERTIFICATE" and
 * "My competency certificate" tell the model what the file already proves; the
 * certificate's contents never leave the vault.
 */
export function draftFacts(
  type: MotivationLicenceType,
  answers: Record<string, string>,
  documents: readonly { kind: string; label: string }[] = [],
): DraftFacts {
  const a = (key: string) => answerValue(answers[key] ?? '').trim();
  const purpose = resolveSportingPurpose(answers);

  const firearm: Record<string, string> = {};
  for (const [label, key] of [
    ['type', 'firearm_type'],
    ['action', 'firearm_action'],
    ['make', 'firearm_make'],
    ['model', 'firearm_model'],
    ['calibre', 'firearm_calibre'],
    ['cartridge', 'firearm_cartridge'],
  ] as const) {
    const value = a(key);
    if (value) firearm[label] = value;
  }

  const heldFirearms: Record<string, string>[] = [];
  for (let n = 1; n <= OWNED_ROWS; n += 1) {
    const prefix = `existing_firearm_${n}_`;
    const row: Record<string, string> = {};
    for (const column of ['type', 'make', 'model', 'calibre', 'use']) {
      const value = a(`${prefix}${column}`);
      if (value) row[column] = value;
    }
    // A row with only a serial or a licence number says nothing useful here.
    if (Object.keys(row).length) heldFirearms.push(row);
  }

  const association: Record<string, string> = {};
  const associationName = a('association_name');
  if (associationName) {
    association.name = associationName;
    const joined = a('association_joined');
    const dedicated = a('dedicated_since');
    if (joined) association.joined = joined;
    if (dedicated) association.dedicated_since = dedicated;
  }

  const premises: Record<string, string> = {};
  for (const key of [
    'premises_enclosure',
    'premises_access_control',
    'alarm_present',
    'armed_response',
    'burglar_bars',
    'security_gates',
  ]) {
    const value = a(key);
    if (value) premises[key] = value;
  }

  const narrative: Record<string, string> = {};
  for (const field of draftedFields(type, answers)) {
    // ⚠️ SENSITIVE NARRATIVE IS NOT ECHOED. The S13 routine and threat answers
    // are `sensitive` in the registry; they are not sent to the model, exactly
    // as the interviewer never sends a sensitive answer.
    if (field.sensitive) continue;
    const value = (answers[field.key] ?? '').trim();
    if (value) narrative[field.key] = value.slice(0, 800);
  }

  const facts: DraftFacts = {
    licence_type: LICENCE_TYPE_LABELS[type] ?? String(type),
    licence_type_key: type,
    purpose,
    firearm,
    association,
    held_firearms: heldFirearms,
    premises,
    documents: documents.map((document) => ({
      kind: document.kind,
      label: document.label,
    })),
    narrative_so_far: narrative,
  };
  const quarry = a('intended_quarry');
  if (quarry) facts.intended_quarry = quarry;
  const gameClass = (answers.hunt_game_class ?? '').trim();
  if (gameClass) {
    facts.hunt_game_class = cardSentences(type, 'hunt_game_class', gameClass);
  }
  const exercise = a('discipline_exercise');
  if (exercise) facts.discipline_exercise = exercise;
  const province = a('province') || a('police_station_province');
  if (province) facts.province = province;
  const residenceType = a('residence_type') || a('home_type');
  if (residenceType) facts.residence_type = residenceType;
  const occupation = a('occupation');
  if (occupation) facts.occupation = occupation;
  return facts;
}

/**
 * Refuse a draft that makes a claim the applicant's file cannot support.
 *
 * ⚠️ EVERY RULE IS MECHANICAL, AND THAT IS THE POINT. A model asked to avoid
 * dates writes "in the mid nineties"; a model asked to be specific writes a
 * farm name. This validator is the deterministic half: it runs on every draft,
 * the rejections are fed back for one retry, and a draft that still fails is
 * dropped rather than stored.
 *
 * `southAfricanise()` runs first, so a spelling fold can never be the reason a
 * perfectly good paragraph is refused.
 */
export function validateDraft(
  key: string,
  value: string,
  opts: DraftValidationOptions,
): string[] {
  const text = southAfricanise((value ?? '').trim());
  const issues: string[] = [];
  if (!text) return ['the answer is empty'];

  if (opts.kind === 'cards') {
    const parts = text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    // ⚠️ TRIMMED ON BOTH SIDES. A model that returns " night_travel " must be
    // matched to the registry key, not refused for whitespace.
    const allowed = new Set((opts.optionKeys ?? []).map((key) => key.trim()));
    if (!parts.length) issues.push('choose at least one option');
    if (parts.length > 4) issues.push('choose at most four options');
    const unknown = parts.filter((part) => !allowed.has(part));
    if (unknown.length) {
      issues.push(
        `only option keys may be chosen, and "${unknown.join('", "')}" ${
          unknown.length === 1 ? 'is' : 'are'
        } not one of them`,
      );
    }
    return issues;
  }

  if (opts.kind === 'short') {
    if (opts.maxLength && text.length > opts.maxLength) {
      issues.push(`keep it under ${opts.maxLength} characters`);
    }
    return issues;
  }

  // ── long narrative ──────────────────────────────────────────────────
  const minWords =
    key === 'continued_use'
      ? DRAFT_CONTINUED_USE_MIN_WORDS
      : DRAFT_MIN_WORDS;
  const words = countDraftWords(text);
  if (words < minWords) {
    issues.push(
      `it is ${words} words; write between ${minWords} and ${DRAFT_MAX_WORDS} words`,
    );
  }
  if (words > DRAFT_MAX_WORDS) {
    issues.push(`it is ${words} words; keep it under ${DRAFT_MAX_WORDS}`);
  }
  if (opts.maxLength && text.length > opts.maxLength) {
    issues.push(`keep it under ${opts.maxLength} characters`);
  }

  if (/\d/.test(text)) {
    issues.push('it contains a digit; write no numbers, dates or years at all');
  }

  // ⚠️ SECOND PERSON IS CHECKED OUTSIDE QUOTED MATERIAL. A supplied sentence
  // may itself contain "your"; the applicant's own words are not the drafter's
  // second person.
  const unquoted = text.replace(/["“”'][^"“”']*["“”']/g, ' ');
  if (/\b(?:you|your|yours|yourself|yourselves)\b/i.test(unquoted)) {
    issues.push('it addresses the applicant as "you"; write in the first person');
  }

  if (CAPITALISED_MONTH_OR_DAY.test(text)) {
    issues.push('it names a month or a day');
  }
  if (MEASURE_WORDS.test(text) || text.includes('%')) {
    issues.push(
      'it contains a measurement or a unit; state no distances, weights or percentages',
    );
  }
  if (APPROXIMATE_NUMBER.test(text)) {
    issues.push('it gives an approximate number; remove the quantity altogether');
  }
  for (const phrase of CLAIM_PHRASES) {
    if (text.toLowerCase().includes(phrase)) {
      issues.push(`it makes the claim "${phrase}", which the motivation must not make`);
      break;
    }
  }
  issues.push(...namedWordIssues(text, opts.allowTerms ?? []));
  return issues;
}

/**
 * A deterministic paragraph for the two narrative fields the generation gate
 * refuses without, so a model outage can never dead-end an application.
 *
 * ⚠️ IT BRANCHES ON THE DOCUMENT, NOT ON THE RESOLVED PURPOSE — the guide book
 * forbids hunting words in a self-defence document, and `purpose` resolves a
 * handgun to "sport" whatever section is being applied under. A section 13
 * fallback that said "I have hunted" would be refused by documentScope later,
 * at the writer, after the member had been told they were finished.
 *
 * ⚠️ CHECKABLE-FACT-FREE BY CONSTRUCTION. No digits, no measurements, no
 * places, no counts, no names, no firsts that might be false — only generic
 * first-person statements that are true of any applicant for that document.
 * The specs run every fallback through validateDraft, which is what keeps this
 * claim honest.
 */
export function fallbackDraft(key: string, facts: DraftFacts): string | null {
  if (key === 'shooting_history') {
    return shootingHistoryFallback(facts);
  }
  if (key === 'continued_use') {
    /**
     * ⚠️ A RENEWAL HAS NO ASSOCIATION AND NO HUNTING ASSUMPTION. Most section 24
     * renewals are section 13 handguns; naming a club or a hunt would be a fact
     * nobody supplied. "The purpose it was licensed for" is the one thing the
     * renewal argues.
     */
    return [
      'I have kept using this firearm for the purpose it was licensed for, practising regularly and keeping it in good order.',
      'I have maintained it responsibly, stored it safely and used it within the law.',
      'It remains part of my regular routine, and I still rely on it for the purpose I stated when it was licensed.',
      'My circumstances have not changed in any way that affects why I need it, and I intend to keep using it in the same lawful way.',
    ].join(' ');
  }
  return null;
}

/** The shooting-history fallback, worded for the document it is written for. */
function shootingHistoryFallback(facts: DraftFacts): string {
  const type = facts.licence_type_key;
  const selfDefence =
    type === 'S13_SELF_DEFENCE' || type === 'S14_RESTRICTED_SELF_DEFENCE';
  if (selfDefence) {
    /**
     * ⚠️ NO HUNTING, NO SPORT-DISCIPLINE VOCABULARY. `documentScope` refuses
     * both in a section 13; "shooting", "practice", "training" and "the range"
     * are the words that stay true without saying what the firearm is used for.
     */
    return [
      'I was introduced to shooting through people already involved, and I have practised at a range under their guidance since.',
      'I keep my skills current and have completed the training that responsible firearm ownership requires.',
      'I handle and use my firearms in a safe and lawful way, and I store them as the law requires.',
      'My competence has grown steadily through practice and the guidance of experienced shooters around me, and I intend to keep to the same careful standard.',
    ].join(' ');
  }
  if (facts.purpose === 'sport') {
    return [
      'I was introduced to shooting through people already involved, and I have practised at a range under their guidance since.',
      'I keep my skills current, take part in the shooting my club and association offer, and follow the discipline that goes with the firearm I use.',
      'I handle and use my firearms safely and lawfully, and I store them as the law requires.',
      'My experience has grown steadily through regular practice and the guidance of experienced shooters, and I intend to keep shooting in the same responsible way.',
    ].join(' ');
  }
  return [
    'I was introduced to hunting and shooting through people already involved, and I have hunted under their guidance since.',
    'I practise at a range and in the field, keep my skills current and take part in the hunting that my association and my licence allow.',
    'I hunt within the seasons and the rules that apply to me, always with an emphasis on safe handling, lawful use and safe storage.',
    'My experience has grown steadily through practice and the guidance of experienced hunters around me, and I intend to keep hunting in the same responsible way.',
  ].join(' ');
}

/** Words in a value — the same counting rule as the completeness gate. */
export function countDraftWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).filter(Boolean).length : 0;
}

// ── validator helpers ─────────────────────────────────────────────────

/**
 * A month or day name in prose.
 *
 * ⚠️ "MAY" AND "MARCH" ARE ABSENT ON PURPOSE. "May" is the modal verb and
 * "march" is an ordinary verb; refusing either would reject a legitimate
 * paragraph and send the model back to rewrite a sentence that was never a
 * date. The remaining names are unambiguous.
 */
const CAPITALISED_MONTH_OR_DAY =
  /\b(?:January|February|April|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;

const MEASURE_WORDS =
  /\b(?:metres?|meters?|kilometres?|kilometers?|centimetres?|centimeters?|millimetres?|millimeters?|kilograms?|grams?|percent|percentage|km|kg|feet|foot|inches?|yards?|miles?|grains?)\b/i;

const APPROXIMATE_NUMBER = new RegExp(
  '\\b(?:approximately|about|around|roughly|some)\\s+' +
    '(?:\\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|' +
    'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|' +
    'thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\\b',
  'i',
);

const CLAIM_PHRASES: readonly string[] = [
  'no criminal record',
  'no previous convictions',
  'clean record',
  'guaranteed',
  'will be approved',
  'will be granted',
  'stopping power',
  'self-defence against',
  'as an ai',
];

/**
 * Invented names.
 *
 * ⚠️ PRAGMATIC, NOT A NAMED-ENTITY TAGGER. The model is told a proper noun must
 * come from the facts or start a sentence; this checks exactly that: every
 * capitalised word that is neither "I", nor at a sentence start, nor inside the
 * supplied facts/options is refused. A capitalised word after a full stop or at
 * the start of a line is allowed, because it is just how a sentence begins.
 */
function namedWordIssues(text: string, allowTerms: readonly string[]): string[] {
  const allow = allowTerms.map((term) => term.toLowerCase()).join(' ');
  const issues: string[] = [];
  for (const match of text.matchAll(/\b[A-Z][a-z][A-Za-z'’-]*/g)) {
    const word = match[0];
    if (word === 'I') continue;
    const at = match.index ?? 0;
    const before = text.slice(0, at);
    const trimmed = before.replace(/\s+$/, '');
    const sentenceStart =
      trimmed === '' ||
      /[.!?]$/.test(trimmed) ||
      /["'“‘(]$/.test(trimmed) ||
      /\n$/.test(before);
    if (sentenceStart) continue;
    if (allow.includes(word.toLowerCase())) continue;
    issues.push(
      `it names "${word}", which is not in the supplied facts; name no people, farms, clubs, towns or organisations`,
    );
    break;
  }
  return issues;
}
