import type { FilingOption } from './document-filing.service';

// ────────────────────────────────────────────────────────────────────
// THE MOTIVATION'S DOCUMENT FOLDERS, AS JEV SEES IT.
//
// ⚠️ MIRRORS `CLASSIFIABLE` in motivation-extract.service.ts. Both must name
// the same set of MotivationUploadKind values; a kind in one and not the other
// is a document the writer files as OTHER on every upload, silently.
//
// ⚠️ AT LEAST ONE OF THE HINTS HAS TO CARRY A RULE THE OLD PROMPT LEARNED THE
// HARD WAY: the three association documents share a letterhead, and only the
// ENDORSEMENT names a firearm by serial. Sorting the endorsement as the
// membership card leaves section 16(2)'s declaration missing from a pack that
// otherwise looks complete.
// ────────────────────────────────────────────────────────────────────

export const MOTIVATION_KIND_OPTIONS: readonly FilingOption[] = [
  {
    id: 'GOOD_STANDING_LETTER',
    label: 'Letter of good standing',
    hint: "an association's letter confirming the member is in good standing (section 16)",
  },
  {
    id: 'ASSOCIATION_ENDORSEMENT',
    label: 'Association endorsement',
    hint: 'an association endorsement of ONE SPECIFIC FIREARM: it names that gun by type, calibre, make, action or serial',
  },
  {
    id: 'IDENTITY_DOCUMENT',
    label: 'Identity document',
    hint: 'a South African ID book, ID card, or passport',
  },
  {
    id: 'COMPETENCY_CERTIFICATE',
    label: 'Competency certificate',
    hint: 'a SAPS competency certificate',
  },
  {
    id: 'PROFICIENCY_CERTIFICATE',
    label: 'Proficiency certificate',
    hint: 'a proficiency or firearm training certificate',
  },
  {
    id: 'CURRENT_LICENCE',
    label: 'Firearm licence',
    hint: "a firearm licence card or certificate that is THE APPLICANT'S OWN (one of the firearms they already hold, not someone else's)",
  },
  {
    id: 'ASSOCIATION_CARD',
    label: 'Association card',
    hint: 'hunting or sport-shooting association membership',
  },
  {
    id: 'ADDRESS_CONFIRMATION',
    label: 'Proof of address',
    hint: 'a municipal bill, bank statement, lease or affidavit showing a residential address',
  },
  {
    id: 'EMPLOYMENT_CONFIRMATION',
    label: 'Employment letter',
    hint: 'a letter confirming employment',
  },
  {
    id: 'SAFE_PHOTOGRAPHS',
    label: 'Safe photographs',
    hint: 'a photograph of a gun safe or strongroom in ANY state (door shut, part open, bolts, or how it is bolted down)',
  },
  {
    id: 'CHARACTER_REFERENCE',
    label: 'Character reference',
    hint: 'a personal reference letter about someone',
  },
  {
    id: 'INCIDENT_REPORT',
    label: 'Incident report',
    hint: 'a SAPS case document or armed-response incident report',
  },
  {
    id: 'FIREARM_SOURCE_PROOF',
    label: 'Firearm source proof',
    hint: "paperwork for the firearm being bought: a dealer's invoice or quote, a dealer-prefilled SAPS 271, the CURRENT OWNER'S licence card (front or back), or a letter or signed consent from that owner",
  },
  {
    id: 'PREVIOUS_MOTIVATION',
    label: 'Previous motivation',
    hint: 'a previously written firearm licence motivation',
  },
  {
    id: 'OTHER',
    label: 'Something else',
    hint: 'anything else, or you cannot tell',
  },
];
