/**
 * Facts that belong to the person, not to one application.
 *
 * The registry already marks some fields `scope: 'profile'` (premises, safe,
 * marital status). The list below carries the rest of the reusable answers —
 * identity, contact, employment, association details, reloading and the
 * member's existing battery — so a second application does not ask them again.
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
  'postal_address',
  'postal_postal_code',
  'cellphone',
  'home_phone',
  'home_dialling_code',
  'work_phone',
  'work_dialling_code',
  'email',
  // Household and employment
  'residence_type',
  'occupation',
  'employer_name',
  'employer_address',
  'employer_postal_code',
  'marital_status',
  'spouse_name',
  'spouse_id_type',
  'spouse_id_number',
  'spouse_passport_number',
  // Premises and security
  'premises_enclosure',
  'premises_access_control',
  'alarm_present',
  'alarm_company',
  'armed_response',
  'security_measures',
  // Safe custody (some are already `scope: 'profile'`; kept here so there is
  // one answer to "does this follow the member")
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
  'association_2_name',
  'association_2_number',
  'association_2_joined',
  'association_3_name',
  'association_3_number',
  'association_3_joined',
  // Reloading
  'reloads',
  'reload_calibres',
  'reload_since',
  // Experience that stays true
  'hunting_history',
  // The form's identity question. It is about the person's role in the
  // household, not about the firearm.
  'licence_holder_type',
]);

export function isProfileKey(key: string): boolean {
  if (PROFILE_KEYS.has(key)) return true;
  // The applicant's existing battery. The firearm APPLIED FOR uses
  // `firearm_*` and deliberately does not match this prefix.
  return key.startsWith('existing_firearm_');
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
