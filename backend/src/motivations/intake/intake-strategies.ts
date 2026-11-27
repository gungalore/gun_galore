import { MotivationLicenceType } from '@prisma/client';
import type { IntakeStrategy } from './intake.types';

/**
 * The fields the interview works through, in the order that fills the most of
 * the application first. Anything already filled from a document is skipped by
 * the planner, so this is a menu rather than a script.
 *
 * ⚠️ THE LIST CONTAINS INTERNAL KEYS ON PURPOSE. `intended_quarry`,
 * `hunting_locations`, `hunting_history`, `competition_record`, `activity_record`,
 * `threat_circumstances`, `daily_movements` and the S13 cards are hidden from
 * the sheet but still reach the writer through PROMPTED_DESPITE_INTERNAL.
 * The interview is the door they were kept for.
 */
const COMMON_FIRST = [
  // Identity first: the ID number is what proves which held licences belong
  // to this applicant, and everything after it can be matched against a person.
  'full_name',
  'id_number',
  'licence_holder_type',
  'occupation',
  /**
   * ⚠️ THE SHOOTING LIFE COMES BEFORE THE FIREARM. Every professional
   * motivation we analysed opens with a "FIREARM EXPERIENCE" page — who
   * introduced them, what they shoot, how often, the training behind the
   * competency — and a DFO reads it before the hardware. Asking it here also
   * means the writer has it in hand when the purpose section is written.
   */
  'shooting_history',
  /**
   * ⚠️ REQUIRED BY THE REGISTRY, SO THE INTERVIEW MUST ASK IT.
   *
   * `marital_status` is `required: true`, it is not document-sourced and it is
   * not a profile field, so `requiredKeys()` counted it and `missingRequired()`
   * would refuse the pack — but no strategy asked it. A cold applicant could
   * finish the whole interview and then be told answers were missing, with no
   * question left to answer. The parity matrix caught it.
   */
  'marital_status',
  // Then the firearm being applied for.
  'firearm_type',
  'firearm_action',
  'firearm_make',
  'firearm_model',
  'firearm_calibre',
  /**
   * ⚠️ ONLY WHEN THE CALIBRE IS A FAMILY. The sheet decides: an ambiguous
   * "9mm" gets a synthetic item with the candidate cartridges, a resolved
   * "9mm Luger" gets none, and the planner's isPending skips the key entirely
   * unless that item is outstanding. It sits immediately after the calibre so
   * the member answers it while the firearm is still in front of them.
   */
  'firearm_cartridge',
  'firearm_serial',
  /**
   * ⚠️ "WHY THIS ONE RATHER THAN ANOTHER" IS ASKED WITH THE FIREARM. The
   * comparison section is built from this, and on a first application it is
   * the only comparison material there is. See SHOOTING_LIFE_FIELDS.
   */
  'alternative_considered',
  // Only now can the correct competency/proficiency be chosen.
  'competency_number',
  'competency_for',
  'competency_issued',
  // Address and the rest follow.
  'residential_address',
  /**
   * ⚠️ SAME GAP AS `marital_status`. Required, not document-sourced, not a
   * profile field, and never asked — the self-defence briefs reason from the
   * premises ("townhouse or complex"), so an answer that never arrives leaves
   * both the pack gate and the threat argument short.
   */
  'residence_type',
  /**
   * Asked before the owned-firearms table. Without it a cold applicant with no
   * vault and no saved answers was never asked what he already owns, and the
   * motivation read as if the safe were empty. A "No" skips the table; a "Yes"
   * asks for the count and then one row per firearm.
   */
  'has_existing_firearms',
  'existing_firearm_count',
];

const SAFE = [
  'safe_present',
  'safe_type',
  'safe_mounted',
  'safe_mounted_to',
];

/**
 * THE PREMISES BLOCK — the security paragraph every approved motivation carries.
 *
 * ⚠️ PROFILE-SCOPED, BUT ASKED IN THE INTERVIEW. A wall does not move between
 * applications, so these are stored on the member (`scope: 'profile'`) and the
 * second application asks none of them. The first one must still ask: heading
 * 5 ("what I already do and where it stops") is written from these taps, and
 * until they were in a strategy the interview never put one of them on screen.
 * MOTIVATION-INTAKE-PLAN.md §3.6.
 *
 * `alarm_company` is deliberately absent: it is the showIf child of
 * `alarm_present`, so a Yes opens it as a detail field in the same question.
 */
const PREMISES = [
  'premises_enclosure',
  'premises_access_control',
  'alarm_present',
  'armed_response',
  'burglar_bars',
  'security_gates',
];

const DECLARATIONS = [
  'history_conviction',
  'history_conviction_detail',
  'history_pending_case',
  'history_pending_case_detail',
  'history_lost_stolen',
  'history_lost_stolen_detail',
  'history_declared_unfit',
  'history_declared_unfit_detail',
  'history_confiscated',
  'history_confiscated_detail',
];

const SELF_DEFENCE_FIELDS = [
  /**
   * ⚠️ THE CASE, AS BEHAVIOUR RATHER THAN AS A REASON. The reason cards were
   * retired as questions on 2026-10-17 ("the circumstances are argued from the
   * applicant's own premises, routine, station figures, travelled areas and
   * battery — not from a wall of taps", motivation-fields.ts). What the
   * interview must therefore collect is the routine and the carry method, and
   * the premises block above — not `s13_reasons`.
   */
  's13_carry_style',
  's13_movements',
  // Optional, and the one place somebody can say something the taps cannot.
  'threat_circumstances',
  ...PREMISES,
  ...SAFE,
  'safe_key_holder',
  ...DECLARATIONS,
];

const SPORTING_COMMON = [
  'association_name',
  'association_number',
  'association_joined',
  'association_expiry',
  'dedicated_since',
  /**
   * ⚠️ SEVERAL ASSOCIATIONS IS THE NORMAL CASE. The professional motivations we
   * studied each list more than one body ("a member in good standing with X
   * since DATE, membership number Y"), and the registry has carried slots two
   * and three since 2026-08-20 — but no strategy ever asked them, so they were
   * dead questions. Slot three's dedicated date joins them here.
   */
  'association_2_name',
  'association_2_number',
  'association_2_joined',
  'association_3_name',
  'association_3_number',
  'association_3_joined',
  'association_3_dedicated_since',
  /**
   * ⚠️ THE EXERCISE THE FIREARM IS ENTERED IN, AND IT MATTERS MORE THAN THE
   * MEMBERSHIP. The pack appends that exercise's published rulebook verbatim;
   * without the choice there is no rulebook to append and the document is
   * thinner than the one a DFO expects.
   */
  'discipline_exercise',
];

const HUNTING_FIELDS = [
  'intended_quarry',
  'hunt_game_class',
  'hunt_terrain',
  'hunt_where',
  'hunt_reasons',
];

const SPORT_FIELDS = [
  'competition_record',
  'sport_reasons',
  'sport_formats',
];

const S24_FIELDS = [
  'existing_licence_number',
  'licence_expiry',
  'continued_use',
  'has_existing_firearms',
  'existing_firearm_count',
  ...PREMISES,
  ...SAFE,
  ...DECLARATIONS,
];

/**
 * ⚠️ OPTIONAL QUESTIONS THE INTERVIEW STILL PUTS, ONCE.
 *
 * The planner asks a field when it is required or when `missingDetail()` names
 * it. These are neither: they are the case facts the document is thin without,
 * so they are offered once and the member may skip one. Without this list they
 * were in a strategy and never asked — which is how a self-defence pack could
 * be written from a name, a serial and a safe with no security paragraph in it.
 *
 * A skip is recorded as `SKIPPED` provenance (common/answer-provenance.ts) so
 * the same question is not put again. See `isPending` in intake-planner.ts.
 */
export const CASE_KEYS: ReadonlySet<string> = new Set([
  /**
   * ⚠️ THE CARTRIDGE IS ASKED ONCE, WHEN THE SHEET SAYS IT IS OUTSTANDING.
   *
   * It is not in `missingDetail` (the pack does not need it to be writeable)
   * and the registry marks it `internal`, so before this it was filtered out of
   * `planGroup().asked()` entirely — the review sheet showed "Which cartridge
   * is it?" and the interview never put it on a card. On the operator's own
   * MO000158 the calibre was typed as "6.5", the Bench held 12+ 6.5 cartridges,
   * and the member was never asked which one. `isPending` already gates it on
   * the sheet item's `needs_you` state, so a resolved calibre is still never
   * asked, and a member who skips it settles it like every other case key.
   */
  'firearm_cartridge',
  /**
   * ⚠️ OFFERED, NEVER FORCED. "What else did you consider" stays on the card
   * for every type, but a member with nothing to compare must be able to Skip
   * it — it was `required: true` and held the whole card behind a red cross.
   */
  'alternative_considered',
  /**
   * ⚠️ THE OPTIONAL HALF OF THE CLIPPING PICKER. The area's reports are
   * selected automatically; this is where a member names a road or suburb they
   * know. Optional and skippable — the auto selection stands without it.
   */
  'travelled_areas_text',
  'premises_enclosure',
  'premises_access_control',
  'alarm_present',
  'armed_response',
  'burglar_bars',
  'security_gates',
  's13_movements',
  's13_carry_style',
  'hunt_game_class',
  'hunt_terrain',
  'hunt_where',
  'hunt_reasons',
  'sport_reasons',
  'sport_formats',
  'continued_use',
]);

const SELF_DEFENCE_SUGGESTIONS: Record<string, string[]> = {
  threat_circumstances: [
    'Late-night returns when the street is quiet',
    'Cash, stock or tools carried for work',
    'A remote or rural property',
    'Dependants at home',
    'A recent break-in or attempted robbery',
  ],
  daily_movements: [
    'A daily commute after dark',
    'A school or lift run',
    'Farm or smallholding roads',
    'Clients’ homes or building sites',
    'Public transport interchanges',
  ],
  alternatives_considered: [
    'Alarm and armed response are already in place',
    'I have hardened the gates and lighting',
    'The police station is minutes away, the attack is seconds',
  ],
};

const HUNTING_SUGGESTIONS: Record<string, string[]> = {
  intended_quarry: [
    'Kudu',
    'Blue wildebeest',
    'Red hartebeest',
    'Impala',
    'Warthog',
    'Springbok',
    'Bushpig',
  ],
  hunting_locations: [
    'Limpopo bushveld',
    'Eastern Cape thicket',
    'Free State plains',
    'Kalahari thornveld',
    'KwaZulu-Natal riverine bush',
    'Karoo scrub',
  ],
  hunting_history: [
    'I hunt every season with family and friends',
    'I have hunted for years on invited farms',
    'I am building experience under a mentor',
    'I also help with culling and problem animals',
  ],
};

const SPORT_SUGGESTIONS: Record<string, string[]> = {
  competition_record: [
    'IPSC club and league shoots',
    'IDPA matches',
    'Steel Challenge',
    'SA Hunters exercises',
    'Provincial or national competitions',
    'Weekly club practice',
  ],
  activity_record: [
    'Weekly range sessions',
    'Monthly club league',
    'A full competition calendar',
    'Practice ahead of the hunting season',
  ],
};

const RENEWAL_SUGGESTIONS: Record<string, string[]> = {
  continued_use: [
    'I have used it for the same purpose every year',
    'It is still my primary hunting rifle',
    'I still compete with it regularly',
    'It remains part of my regular practice',
  ],
};

const S13: IntakeStrategy = {
  purpose: 'self_defence',
  fields: [...COMMON_FIRST, ...SELF_DEFENCE_FIELDS],
  purposeField: null,
  evidenceGroups: ['incident', 'storage', 'personal'],
  customKeys: {
    threat_circumstances: 'threat_circumstances',
    s13_reasons: 'threat_circumstances',
    s13_movements: 'daily_movements',
    s13_carry_style: 'threat_circumstances',
  },
  suggestions: SELF_DEFENCE_SUGGESTIONS,
  intro:
    'I’ll ask only what your documents and your own circumstances haven’t already answered. The DFO reads this as your account, so every answer is yours.',
};

const S14: IntakeStrategy = {
  ...S13,
  intro:
    'Section 14 uses the same facts as section 13, plus why a restricted firearm is needed. I’ll ask only what the documents have not already settled.',
};

const S15: IntakeStrategy = {
  purpose: 'sporting',
  fields: [
    ...COMMON_FIRST.slice(0, 10),
    'firearm_use_kind',
    ...COMMON_FIRST.slice(10),
    ...SPORTING_COMMON,
    ...HUNTING_FIELDS,
    ...SPORT_FIELDS,
    ...PREMISES,
    ...SAFE,
    ...DECLARATIONS,
  ],
  purposeField: 'firearm_use_kind',
  evidenceGroups: ['hunting', 'sport'],
  customKeys: {
    intended_quarry: 'intended_quarry',
    competition_record: 'competition_record',
    hunt_game_class: 'intended_quarry',
    hunt_terrain: 'hunting_locations',
    hunt_where: 'hunting_locations',
    hunt_reasons: 'hunting_history',
    sport_reasons: 'competition_record',
    sport_formats: 'competition_record',
    hunting_locations: 'hunting_locations',
    hunting_history: 'hunting_history',
    activity_record: 'activity_record',
  },
  suggestions: {
    ...HUNTING_SUGGESTIONS,
    ...SPORT_SUGGESTIONS,
  },
  intro:
    'Section 15 is the occasional hunter or occasional sports person. Tell me which one fits this application and I’ll ask the questions that belong to it.',
};

const S16_HUNT: IntakeStrategy = {
  ...S15,
  intro:
    'This is a section 16 dedicated application. I’ll confirm your dedicated status and then build the motivation from the shooting you actually do.',
};

const S16_SPORT: IntakeStrategy = {
  ...S16_HUNT,
  intro:
    'This is a section 16 dedicated sport application. I’ll confirm your dedicated status and then build the motivation from the discipline and matches you actually shoot.',
};

const S24: IntakeStrategy = {
  purpose: 'renewal',
  fields: [...COMMON_FIRST, ...S24_FIELDS],
  purposeField: null,
  evidenceGroups: ['hunting', 'sport', 'organisational'],
  customKeys: {
    continued_use: 'continued_use',
  },
  suggestions: RENEWAL_SUGGESTIONS,
  intro:
    'A renewal turns on two facts: the purpose has not changed, and you are still active. I’ll ask only what the licence card and the vault have not already answered.',
};

const BY_TYPE: Record<MotivationLicenceType, IntakeStrategy> = {
  S13_SELF_DEFENCE: S13,
  S14_RESTRICTED_SELF_DEFENCE: S14,
  S15_OCCASIONAL_HUNTER: S15,
  S16_DEDICATED_HUNTER: S16_HUNT,
  S16_DEDICATED_SPORT: S16_SPORT,
  S24_RENEWAL: S24,
};

export function strategyFor(type: MotivationLicenceType): IntakeStrategy {
  return BY_TYPE[type];
}

/** Branch the sporting fields on the answer the applicant actually gave. */
export function sportingFields(
  strategy: IntakeStrategy,
  purpose: string,
): string[] {
  if (strategy.purpose !== 'sporting') return strategy.fields;
  const hunting = purpose !== 'sport';
  const sport = purpose !== 'hunting';
  return strategy.fields.filter((key) => {
    if (HUNTING_FIELDS.includes(key)) return hunting;
    if (SPORT_FIELDS.includes(key)) return sport;
    return true;
  });
}
