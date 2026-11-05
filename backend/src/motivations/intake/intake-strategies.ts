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
  // Then the firearm being applied for.
  'firearm_type',
  'firearm_action',
  'firearm_make',
  'firearm_model',
  'firearm_calibre',
  'firearm_serial',
  // Only now can the correct competency/proficiency be chosen.
  'competency_number',
  'competency_for',
  'competency_issued',
  // Address and the rest follow.
  'residential_address',
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
