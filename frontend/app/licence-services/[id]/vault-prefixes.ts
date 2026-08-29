/**
 * Which vault values each step may offer.
 *
 * ⚠️ THE STEP OWNS ITS PREFIXES, and that is the whole fix. On the old page
 * this lived at the mount site and drifted from the fields it named: the
 * panel was mounted on "About you" and handed `association_`, while those
 * fields had always lived in their own section — so the offer computed the
 * values, shipped them, and filtered every one out against a section that
 * could not contain them. Silent for months.
 */
export const VAULT_PREFIXES: Record<string, string[] | undefined> = {
  about: ['id_number', 'full_name', 'residential_', 'home_', 'work_'],
  competency: ['competency_'],
  owned: ['existing_firearm_'],
  dedicated: ['association_', 'dedicated_'],
};
