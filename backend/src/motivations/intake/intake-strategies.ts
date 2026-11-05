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
];

const SAFE = [
  'safe_present',
  'safe_type',
  'safe_mounted',
  'safe_mounted_to',
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
  'threat_circumstances',
  'residence_type',
  ...SAFE,
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
];

const SPORT_FIELDS = [
  'competition_record',
];

const S24_FIELDS = [
  'existing_licence_number',
  'licence_expiry',
  'continued_use',
  ...SAFE,
  ...DECLARATIONS,
];

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
    'residence_type',
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
