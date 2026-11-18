/**
 * Facts that belong to the person, not to one application.
 *
 * ⚠️ THIS IS THE WHOLE PROFILE NOW, NOT A TOP-UP TO `scope: 'profile'`.
 * The page had grown into a second SAPS 271: postal address, home and work
 * dialling codes, employer address, marital status, spouse ID and passport,
 * reloading, secondary associations, the licence-holder role and fourteen
 * existing-firearm rows. None of it is needed to start a motivation; the
 * licences, competencies and training live in the Document Centre, and the
 * 271-only facts are asked on the application that needs them. The old
 * registry `scope: 'profile'` flag is deliberately no longer sufficient on
 * its own — see profileKeys().
 *
 * Keep this list small and factual. A purpose answer, a quotation, a threat
 * description or anything that describes THIS firearm belongs on the
 * application and must not follow the member to the next one.
 */
const PROFILE_KEYS = new Set([
  // Identity and contact
  'full_name',
  'id_number',
  'residential_address',
  'cellphone',
  'email',
  // Household and employment
  'residence_type',
  'occupation',
  'employer_name',
  // Premises and security
  'premises_enclosure',
  'premises_access_control',
  'alarm_present',
  'alarm_company',
  'armed_response',
  'security_measures',
  // Safe custody
  'safe_present',
  'safe_type',
  'safe_mounted',
  'safe_mounted_to',
  'safe_key_holder',
  'safe_storage_detail',
  // Association and dedicated status
  'association_name',
  'association_number',
  'association_joined',
  'association_expiry',
  'dedicated_since',
]);

export function isProfileKey(key: string): boolean {
  return PROFILE_KEYS.has(key);
}

export function pickProfileAnswers(
  answers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (isProfileKey(key) && value.trim()) out[key] = value;
  }
  return out;
}
