import { createHash } from 'node:crypto';
import type { MotivationLicenceType } from '@prisma/client';
import {
  CASE_NOTE_KEYS,
  FIELD_REGISTRY_VERSION,
  fieldsFor,
  type MotivationField,
} from '../motivation-fields';
import { missingDetail } from '../motivation-completeness';
import { CASE_KEYS, sportingFields, strategyFor } from './intake-strategies';

// ────────────────────────────────────────────────────────────────────
// THE INTERVIEW BRIEF — the researcher's work, turned into questions.
//
// ⚠️ WHAT THIS IS FOR. The research pass already knows what the document must
// argue: the cartridge, the quarry class, the discipline's rules, the
// applicant's own premises and battery. Until now none of it reached the
// interview; the planner walked the registry in field order and the member
// answered whatever came first. The brief is the join: one look at the file and
// the research, then an ordered question list, a reason for each, and tappable
// answers drawn from what was actually looked up.
//
// ⚠️ IT IS ADVISORY, NEVER AUTHORITATIVE. The planner still appends every
// required and detail-gated field the brief forgot, so a failed or thin brief
// costs polish, never a complete application. Nothing here may skip a fact the
// gate demands.
//
// ⚠️ NOTHING PERSONAL GOES INTO IT. `briefFacts()` is a projection: firearm
// type/action/make/model/calibre, the purpose, the association, the discipline
// and the province. No name, ID number, address, serial, spouse, declaration
// or free-text answer ever enters the prompt, the facts strip or a chip. The
// validator drops anything that echoes a sensitive value back.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ BUMP WHENEVER THE ASK CHANGES.
 *
 * The hash below carries this string, so a wording change re-runs the brief for
 * every application with one answer to its name, instead of serving a stale
 * phrasing until the row is forgotten. Same discipline as
 * RESEARCH_ASK_VERSION.
 */
export const INTERVIEW_BRIEF_VERSION = '2026-11-18a';

/** How long a brief stays good. The answers it depends on rarely move. */
export const INTERVIEW_BRIEF_TTL_DAYS = 14;

/** A hard ceiling so a model cannot turn the brief into a document. */
export const MAX_BRIEF_QUESTIONS = 30;
export const MAX_BRIEF_CHIPS = 6;
export const MAX_CHIP_LENGTH = 90;
export const MAX_QUESTION_LENGTH = 180;
export const MAX_WHY_LENGTH = 240;
export const MAX_BRIEF_FACTS = 8;

export interface BriefFact {
  label: string;
  value: string;
}

export interface BriefChip {
  value: string;
  label: string;
}

export interface BriefQuestion {
  fieldKey: string;
  /** The interviewer's wording, or empty when the caller should use the label. */
  question: string;
  /** Why the DFO needs this fact. */
  why: string;
  /** Lower sorts first among questions of the same weight. */
  priority: number;
}

export interface BriefSource {
  uri: string;
  title?: string;
}

export interface InterviewBrief {
  version: string;
  hash: string;
  at: string;
  facts: BriefFact[];
  questions: BriefQuestion[];
  chips: Record<string, BriefChip[]>;
  sources: BriefSource[];
  /**
   * ⚠️ FALSE WHEN THE MODEL COULD NOT BE ASKED. The deterministic half of the
   * brief (facts and gate gaps) is still stored and served, so the strip works
   * during an outage; the caller logs it and nothing retries per card.
   */
  researched: boolean;
}

/**
 * Fields the brief may ever ask about, for a licence type.
 *
 * ⚠️ SENSITIVE FIELDS ARE EXCLUDED ON PURPOSE. An ID number, a serial, a home
 * address or a declaration answer is never paraphrased, never given a reason
 * and never turned into a chip by a model. Those questions are served with
 * their registry label and their own form control, exactly as before.
 */
export function askableFields(
  type: MotivationLicenceType,
): readonly MotivationField[] {
  const strategyKeys = new Set(sportingFields(strategyFor(type), 'both'));
  return fieldsFor(type).filter(
    (field) =>
      !field.formOnly &&
      !field.key.startsWith('history_') &&
      !field.sensitive &&
      (strategyKeys.has(field.key) ||
        CASE_KEYS.has(field.key) ||
        (CASE_NOTE_KEYS as readonly string[]).includes(field.key) ||
        field.required === true),
  );
}

/**
 * The non-sensitive projection the brief is built from.
 *
 * ⚠️ THIS IS THE PRIVACY BOUNDARY, NOT A CONVENIENCE. Everything added here is
 * sent to a model and printed on screen; everything left out is somebody's ID
 * number, address, serial or family. Add a key only if it is a fact about the
 * application rather than the person.
 */
export function briefFacts(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): BriefFact[] {
  const value = (key: string): string => (answers[key] ?? '').trim();
  const out: BriefFact[] = [];

  const firearm = [
    value('firearm_type'),
    value('firearm_action'),
    value('firearm_make'),
    value('firearm_model'),
  ]
    .filter(Boolean)
    .join(' ');
  if (firearm) out.push({ label: 'Firearm', value: firearm });

  const calibre = value('firearm_calibre');
  if (calibre) out.push({ label: 'Calibre', value: calibre });

  const useKind = value('firearm_use_kind');
  if (useKind) {
    const field = fieldsFor(type).find((f) => f.key === 'firearm_use_kind');
    const option = field?.options?.find((o) => o.key === useKind);
    out.push({
      label: 'Purpose',
      value: option ? option.sentence : useKind,
    });
  }

  const association = value('association_name');
  if (association) out.push({ label: 'Association', value: association });

  const discipline = value('discipline_exercise');
  if (discipline) out.push({ label: 'Discipline', value: discipline });

  const quarry = value('intended_quarry');
  if (quarry) out.push({ label: 'Quarry', value: quarry.slice(0, 120) });

  const residence = value('residence_type');
  if (residence) out.push({ label: 'Home', value: residence });

  const province = value('police_station_province');
  if (province) out.push({ label: 'Province', value: province });

  return out.slice(0, MAX_BRIEF_FACTS);
}

/**
 * Every value the brief must never echo, lower-cased.
 *
 * Built from the fields marked `sensitive` or `formOnly` for this type: an ID
 * number, a serial, an address, a spouse's name, a declaration detail. The
 * validator rejects a fact, a question or a chip that contains one.
 */
export function forbiddenValues(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): string[] {
  const out = new Set<string>();
  for (const field of fieldsFor(type)) {
    if (!field.sensitive && !field.formOnly) continue;
    const raw = (answers[field.key] ?? '').trim();
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const clean = part.trim();
      // Short words are answers like "Yes", not identifiers worth guarding.
      if (clean.length >= 3) out.add(clean.toLowerCase());
    }
  }
  return [...out];
}

/**
 * The key a brief is built against.
 *
 * ⚠️ ONLY THE FACTS THAT CHANGE THE QUESTIONS. Answering "marital status"
 * must not rebuild the brief; changing the calibre, the purpose, the
 * association or the section must. Lower-cased and whitespace-collapsed so
 * "Beretta 1301" and "BERETTA  1301" are one brief.
 */
export function briefHash(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): string {
  const norm = (key: string): string =>
    (answers[key] ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const parts = [
    INTERVIEW_BRIEF_VERSION,
    FIELD_REGISTRY_VERSION,
    type,
    norm('firearm_type'),
    norm('firearm_action'),
    norm('firearm_make'),
    norm('firearm_model'),
    norm('firearm_calibre'),
    norm('firearm_use_kind'),
    norm('association_name'),
    norm('discipline_exercise'),
    norm('police_station_province'),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * ⚠️ A CHIP IS A FACT ABOUT THE APPLICANT, NOT AN ARGUMENT.
 *
 * "I live in a precinct with a documented housebreaking problem" is a claim
 * they can stand behind. "Therefore I need a firearm" is the writer's job and a
 * chip that makes it puts the conclusion in the applicant's mouth before the
 * document has earned it. Anything that argues, predicts or asks is refused.
 */
const CHIP_ARGUING = [
  /\btherefore\b/i,
  /\bso that\b/i,
  /\bapproval\b/i,
  /\b(?:will be|would be|should be|is|are|was|were) approved\b/i,
  /\bguarantee/i,
  /\bwill be granted\b/i,
  /\bmust be issued\b/i,
  /\bentitled to\b/i,
  /\bproof that\b/i,
];

/**
 * The hard bans — a prediction, a legal conclusion or a promise.
 *
 * ⚠️ "SABS-APPROVED" IS NOT A LEGAL CONCLUSION. The first draft banned the
 * bare word `approved`, which dropped the model's perfectly ordinary "Do you
 * have a SABS-approved safe?" question. The ban is about the OUTCOME ("this
 * will be approved"), so it is anchored to a verb.
 */
const CONCLUSION_BANS = [
  /\b(?:will be|would be|should be|is|are|was|were) approved\b/i,
  /\bwill be granted\b/i,
  /\bmust be issued\b/i,
  /\bguarantee/i,
  /\bentitled to\b/i,
];

export function isSafeChip(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  // A question is not an answer somebody can tap.
  if (clean.endsWith('?')) return false;
  return !CHIP_ARGUING.some((pattern) => pattern.test(clean));
}

/**
 * ⚠️ A QUESTION MAY END IN A QUESTION MARK; A CHIP MAY NOT. Sharing one guard
 * for both would have dropped every question in the brief — the first draft of
 * this module did exactly that and the validator returned an empty interview.
 * Questions are only barred from making a legal claim.
 */
export function isSafeQuestion(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  return !CONCLUSION_BANS.some((pattern) => pattern.test(clean));
}

/**
 * A reason may say "so that" or "therefore" — that is what a reason is. It may
 * not promise an outcome either.
 */
export function isSafeReason(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  return !CONCLUSION_BANS.some((pattern) => pattern.test(clean));
}

export interface BriefValidationInput {
  type: MotivationLicenceType;
  raw: unknown;
  /** The local, authoritative facts — the model may add to these, never replace them. */
  facts: BriefFact[];
  hash: string;
  forbidden: readonly string[];
  now?: Date;
  /** False when the deterministic half is all we have. */
  researched?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function leaks(text: string, forbidden: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return forbidden.some((secret) => secret && lower.includes(secret));
}

function normaliseChipChoices(
  raw: unknown,
  field: MotivationField,
  forbidden: readonly string[],
): BriefChip[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const fieldLabel = field.label.trim().toLowerCase();
  const out: BriefChip[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    const value = cleanText(record?.value, MAX_CHIP_LENGTH);
    const label = cleanText(record?.label, MAX_CHIP_LENGTH) || value;
    if (!value || !label) continue;
    if (value.toLowerCase() === fieldLabel) continue;
    if (!isSafeChip(value) || !isSafeChip(label)) continue;
    if (leaks(value, forbidden) || leaks(label, forbidden)) continue;
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push({ value, label });
    if (out.length >= MAX_BRIEF_CHIPS) break;
  }
  return out;
}

/**
 * Turn whatever the model returned into a brief this application can trust.
 *
 * ⚠️ EVERY DROP IS DELIBERATE. An unknown field key would produce a question
 * with nowhere to store its answer; a question that repeats a known fact wastes
 * the member's time; a chip that echoes a serial is a privacy breach; a
 * question longer than a sentence is a paragraph in a tap's clothing. The
 * caller logs the counts, never the contents.
 */
export function validateBrief(input: BriefValidationInput): InterviewBrief {
  const allowed = new Map(
    askableFields(input.type).map((field) => [field.key, field] as const),
  );
  const raw = asRecord(input.raw) ?? {};

  const questions: BriefQuestion[] = [];
  const seenQuestions = new Set<string>();
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
  for (const item of rawQuestions) {
    const record = asRecord(item);
    const fieldKey = cleanText(record?.fieldKey, 80);
    const field = allowed.get(fieldKey);
    if (!field || seenQuestions.has(fieldKey)) continue;
    const question = cleanText(record?.question, MAX_QUESTION_LENGTH);
    const why = cleanText(record?.why, MAX_WHY_LENGTH);
    if (!question || !why) continue;
    if (!isSafeQuestion(question) || !isSafeReason(why)) continue;
    if (leaks(question, input.forbidden) || leaks(why, input.forbidden)) {
      continue;
    }
    seenQuestions.add(fieldKey);
    questions.push({
      fieldKey,
      question,
      why,
      priority: questions.length,
    });
    if (questions.length >= MAX_BRIEF_QUESTIONS) break;
  }

  const chips: Record<string, BriefChip[]> = {};
  const rawChips = Array.isArray(raw.chips) ? raw.chips : [];
  for (const item of rawChips) {
    const record = asRecord(item);
    const fieldKey = cleanText(record?.fieldKey, 80);
    const field = allowed.get(fieldKey);
    if (!field) continue;
    const choices = normaliseChipChoices(record?.choices, field, input.forbidden);
    if (choices.length) chips[fieldKey] = choices;
  }

  /**
   * ⚠️ THE LOCAL FACTS WIN, AND THE MODEL MAY ONLY ADD. The projection above is
   * what privacy was checked against; a model-supplied fact is accepted only
   * when it does not duplicate a label and does not carry a sensitive value.
   */
  const facts: BriefFact[] = [...input.facts];
  const factLabels = new Set(facts.map((fact) => fact.label.toLowerCase()));
  const rawFacts = Array.isArray(raw.facts) ? raw.facts : [];
  for (const item of rawFacts) {
    const record = asRecord(item);
    const label = cleanText(record?.label, 40);
    const value = cleanText(record?.value, 120);
    if (!label || !value) continue;
    if (factLabels.has(label.toLowerCase())) continue;
    if (leaks(`${label} ${value}`, input.forbidden)) continue;
    if (!isSafeChip(value)) continue;
    factLabels.add(label.toLowerCase());
    facts.push({ label, value });
    if (facts.length >= MAX_BRIEF_FACTS) break;
  }

  const sources: BriefSource[] = [];
  const rawSources = Array.isArray(raw.sources) ? raw.sources : [];
  for (const item of rawSources) {
    const record = asRecord(item);
    const uri = cleanText(record?.uri, 300);
    if (!/^https?:\/\//i.test(uri)) continue;
    sources.push({ uri, title: cleanText(record?.title, 120) || undefined });
    if (sources.length >= 6) break;
  }

  return {
    version: INTERVIEW_BRIEF_VERSION,
    hash: input.hash,
    at: (input.now ?? new Date()).toISOString(),
    facts: facts.slice(0, MAX_BRIEF_FACTS),
    questions,
    chips,
    sources,
    researched: input.researched ?? true,
  };
}

/**
 * A brief built without a model: the facts we hold and the gate's own gaps.
 *
 * ⚠️ IT EXISTS SO AN OUTAGE IS NOT A BLANK SCREEN. The questions are the gate's
 * labels with the gate's hints as the reason; no chips, no phrased text. The
 * planner treats it exactly like a researched brief.
 */
export function deterministicBrief(input: {
  type: MotivationLicenceType;
  answers: Record<string, string>;
  hash: string;
  now?: Date;
}): InterviewBrief {
  const gaps = missingDetail(input.answers, input.type);
  const byKey = new Map(
    fieldsFor(input.type).map((field) => [field.key, field] as const),
  );
  const questions: BriefQuestion[] = [];
  for (const gap of gaps) {
    const fieldKey = gap.code.slice(gap.code.indexOf(':') + 1);
    const field = byKey.get(fieldKey);
    if (!field) continue;
    questions.push({
      fieldKey,
      question: '',
      why: gap.hint,
      priority: questions.length,
    });
  }
  return {
    version: INTERVIEW_BRIEF_VERSION,
    hash: input.hash,
    at: (input.now ?? new Date()).toISOString(),
    facts: briefFacts(input.type, input.answers),
    questions,
    chips: {},
    sources: [],
    researched: false,
  };
}

/**
 * The one-sentence acknowledgement of the answer just given.
 *
 * ⚠️ DETERMINISTIC, BECAUSE THE MODEL INVENTED A FATHER. A live member was
 * thanked for "keeping up the tradition of hunting you learned from your
 * father" — a father they never mentioned. This composes from the answer the
 * member actually gave: a closed choice is echoed with its own label, a card,
 * a long answer or a sensitive one gets a bare "Noted." and never a
 * paraphrase. Nothing here can add a fact because nothing here writes one.
 */
export function composeAcknowledgement(
  field: MotivationField | undefined,
  answer: string,
): string | undefined {
  const clean = (answer ?? '').trim();
  if (!clean) return undefined;
  if (!field || field.kind === 'long' || field.sensitive) return 'Noted.';
  if (field.kind !== 'choice' && field.kind !== 'yesno' && field.kind !== 'multi') {
    return 'Noted.';
  }
  /**
   * ⚠️ NEVER ECHO A PARAGRAPH. The caller may hand this a joined answer from a
   * whole card; a "Got it — …" that recites six facts is worse than a plain
   * acknowledgement, and an echoed free text can carry something the model
   * should never have seen.
   */
  if (clean.length > 120) return 'Noted.';
  const labels = clean
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((value) => {
      const option =
        field.choices?.find((choice) => choice === value) ??
        field.options?.find((choice) => choice.key === value)?.sentence;
      return option ?? '';
    })
    .filter(Boolean)
    .slice(0, 3);
  // A value that is not one of the field's own answers is not a closed answer.
  if (!labels.length) return 'Noted.';
  const text = labels.join(', ');
  if (text.length > 90) return 'Noted.';
  return `Got it — ${text.replace(/[.?!]+$/, '')}.`;
}
