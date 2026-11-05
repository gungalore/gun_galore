import type { MotivationLicenceType } from '@prisma/client';
import { fieldsFor } from '../motivation-fields';
import type { IntakeTopicId } from './intake.types';

/**
 * THE INTERVIEW'S CATEGORIES.
 *
 * ⚠️ IDENTITY BEFORE FIREARM. The ID number is how an existing licence is
 * proven to be this applicant's, and the firearm is what selects the
 * competency and proficiency. The old order put the firearm first and the
 * certificate rows appeared before either was known.
 *
 * ⚠️ ONE LIST, THREE USES. The same order drives the document drawer, the
 * interview's groups and the progress counter. They used to be derived
 * separately and drifted; this is the single source.
 */
export const TOPIC_ORDER: readonly IntakeTopicId[] = [
  'identity',
  'firearm',
  'credentials',
  'existing',
  'address',
  'association',
  'activities',
  'safe',
  'declarations',
  'other',
];

export const TOPIC_TITLES: Record<IntakeTopicId, string> = {
  identity: 'About you',
  firearm: 'The firearm you are applying for',
  credentials: 'Competency and proficiency',
  existing: 'Firearms you already hold',
  address: 'Your address',
  association: 'Association and dedicated status',
  activities: 'Your hunting and shooting',
  safe: 'Safe and storage',
  declarations: 'Declarations',
  other: 'Other details',
};

export const TOPIC_DOCUMENTS: Partial<Record<IntakeTopicId, string[]>> = {
  identity: ['IDENTITY_DOCUMENT'],
  firearm: ['FIREARM_SOURCE_PROOF', 'SELLER_LICENCE'],
  credentials: ['COMPETENCY_CERTIFICATE', 'PROFICIENCY_CERTIFICATE'],
  existing: ['CURRENT_LICENCE'],
  address: ['ADDRESS_CONFIRMATION'],
  association: [
    'ASSOCIATION_CARD',
    'GOOD_STANDING_LETTER',
    'ASSOCIATION_ENDORSEMENT',
  ],
  safe: ['SAFE_PHOTOGRAPHS'],
};

export function topicForField(key: string): IntakeTopicId {
  if (/^history_/.test(key)) return 'declarations';
  if (/^existing_firearm_|^existing_licence_|^licence_expiry$|^continued_use$/.test(key)) {
    return 'existing';
  }
  if (/^firearm_/.test(key)) return 'firearm';
  if (/^competency_|^proficiency_/.test(key)) return 'credentials';
  if (/^residential_|^postal_|^residence_type$/.test(key)) return 'address';
  if (
    /^association_|^dedicated_since$|^discipline_|^hunting_|^competition_record$|^activity_record$|^intended_quarry$|^sport_/.test(
      key,
    )
  ) {
    return 'association';
  }
  if (
    /^safe_|^premises_|^alarm_|^armed_response$|^burglar_bars$|^security_gates$/.test(
      key,
    )
  ) {
    return 'safe';
  }
  if (
    /^full_name$|^id_number$|^licence_holder_type$|^occupation$|^date_of_birth$|^marital_status$|^spouse_|^cellphone$|^home_telephone$|^work_telephone$/.test(
      key,
    )
  ) {
    return 'identity';
  }
  return 'other';
}

export function topicsFor(
  type: MotivationLicenceType,
  answers: Record<string, string>,
  documentKinds: readonly string[],
): IntakeTopicId[] {
  const fieldTopics = new Set(
    fieldsFor(type).map((field) => topicForField(field.key)),
  );
  const hasExisting =
    Object.keys(answers).some((key) => key.startsWith('existing_firearm_')) ||
    documentKinds.includes('CURRENT_LICENCE');
  return TOPIC_ORDER.filter((topic) => {
    if (topic === 'existing') return hasExisting;
    if (topic === 'association' || topic === 'activities') {
      return fieldTopics.has(topic);
    }
    if (topic === 'other') return fieldTopics.has('other');
    return true;
  });
}
