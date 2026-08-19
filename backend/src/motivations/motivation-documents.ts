import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// WHICH DOCUMENTS AN APPLICATION ACTUALLY NEEDS.
//
// Operator, 2026-08-19: check the uploads against the required minimum — if
// they supply them, good; if not, ask for the specific ones missing. And make
// room for extra documents somebody wants to attach as further evidence,
// which are not required for the application at all.
//
// So three tiers, and the distinction between them is the whole design:
//
//   REQUIRED    — SAPS will not process the application without it. Naming
//                 these is the single most useful thing we do, because the
//                 alternative is a wasted trip to a police station.
//   STRENGTHENS — not demanded by SAPS, but it is what makes a motivation land:
//                 photographs of the safe, an incident report, an association
//                 endorsement. Absence is not a blocker.
//   EXTRA       — anything else the applicant wants to attach. Never asked
//                 for, never chased, always accepted and lettered as an
//                 annexure like the rest.
//
// ⚠️ REQUIRED HERE MEANS "SAPS REQUIRES IT", NOT "WE REFUSE TO PROCEED". We
// never block someone from producing their own motivation — a person who has
// applied for competency but not received the certificate yet is exactly who
// should be drafting one. We say plainly what is missing and let them decide.
//
// ⚠️ The list is drawn from the official SAPS 271 checklist. Items marked
// verifyBeforeUse in the checklist module carry the same caveat here: station
// practice differs, and a confident list that is wrong is worse than none.
//
// PURE — no Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

export type DocumentTier = 'required' | 'strengthens' | 'extra';

export interface DocumentNeed {
  kind: MotivationUploadKind;
  label: string;
  tier: DocumentTier;
  /** Why it matters, in the applicant's terms. */
  why: string;
  /** True once at least one file of this kind is attached. */
  have: boolean;
}

/**
 * What SAPS will not process the application without.
 *
 * Deliberately short. Everything on it appears on the official checklist, and
 * anything we are unsure of belongs in `strengthens` instead — being wrong
 * about a requirement sends someone to a counter to be turned away.
 */
const REQUIRED: Record<MotivationLicenceType, MotivationUploadKind[]> = {
  S13_SELF_DEFENCE: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
  ],
  S15_OCCASIONAL_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
  ],
  // Dedicated status IS the basis of a section 16 application, so proof of
  // membership stops being a nicety and becomes part of the case.
  S16_DEDICATED_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'ASSOCIATION_CARD',
  ],
  S16_DEDICATED_SPORT: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'ASSOCIATION_CARD',
  ],
  // A renewal is a different form (SAPS 518a) and a different pack; the one
  // thing it always needs is the licence being renewed.
  S24_RENEWAL: [
    'IDENTITY_DOCUMENT',
    'CURRENT_LICENCE',
    'ADDRESS_CONFIRMATION',
  ],
};

/** Not demanded, but this is what makes a motivation land. */
const STRENGTHENS: Record<MotivationLicenceType, MotivationUploadKind[]> = {
  S13_SELF_DEFENCE: ['SAFE_PHOTO', 'SAFE_INSTALLATION', 'INCIDENT_REPORT'],
  S15_OCCASIONAL_HUNTER: [
    'SAFE_PHOTO',
    'SAFE_INSTALLATION',
    'PROFICIENCY_CERTIFICATE',
    'CURRENT_LICENCE',
  ],
  S16_DEDICATED_HUNTER: [
    'SAFE_PHOTO',
    'SAFE_INSTALLATION',
    'PROFICIENCY_CERTIFICATE',
    'CURRENT_LICENCE',
  ],
  S16_DEDICATED_SPORT: [
    'SAFE_PHOTO',
    'SAFE_INSTALLATION',
    'PROFICIENCY_CERTIFICATE',
    'CURRENT_LICENCE',
  ],
  S24_RENEWAL: ['SAFE_PHOTO', 'SAFE_INSTALLATION'],
};

const LABELS: Record<MotivationUploadKind, string> = {
  IDENTITY_DOCUMENT: 'A copy of your ID',
  COMPETENCY_CERTIFICATE: 'Your SAPS competency certificate',
  PROFICIENCY_CERTIFICATE: 'Your proficiency or training certificate',
  CURRENT_LICENCE: 'A firearm licence you already hold',
  ASSOCIATION_CARD: 'Proof of your association membership',
  ADDRESS_CONFIRMATION: 'Proof of your address',
  EMPLOYMENT_CONFIRMATION: 'Confirmation of employment',
  SAFE_PHOTO: 'Photographs of your safe',
  SAFE_INSTALLATION: 'The safe bolted to the wall or floor',
  CHARACTER_REFERENCE: 'A character reference',
  INCIDENT_REPORT: 'An incident report or SAPS case number',
  PREVIOUS_MOTIVATION: 'A previous motivation',
  OTHER: 'Something else you would like to attach',
};

const WHY: Partial<Record<MotivationUploadKind, string>> = {
  IDENTITY_DOCUMENT:
    'SAPS wants a certified copy, not older than three months. We also read your name and ID number off it so you do not have to type them.',
  COMPETENCY_CERTIFICATE:
    'Without competency for this type of firearm, SAPS cannot process the application at all.',
  ADDRESS_CONFIRMATION:
    'Certified, not older than three months. We read the address off it.',
  ASSOCIATION_CARD:
    'Dedicated status is the basis of a section 16 application, so this is part of the case rather than an extra.',
  CURRENT_LICENCE:
    'We read the make, calibre and serial off it — which is also what tells us whether this application overlaps something you already own.',
  SAFE_PHOTO:
    'Three shots: locked with no key in it, half open with the key in the lock, and the bolts fixing it to the wall. A DFO looks for all three.',
  SAFE_INSTALLATION: 'Shows the safe is actually anchored, not just present.',
  INCIDENT_REPORT:
    'Something that actually happened to you carries far more weight than general crime figures.',
  PROFICIENCY_CERTIFICATE:
    'Shows you shoot or hunt in practice, not only on paper.',
  CHARACTER_REFERENCE:
    'SAPS asks for two, from people who have known you two years or more. Most DFOs prefer someone who is not family.',
};

export interface DocumentStatus {
  needs: DocumentNeed[];
  /** Required kinds with nothing attached. Empty means the pack is complete. */
  missingRequired: MotivationUploadKind[];
  /** Uploaded kinds that were never asked for — extra evidence. */
  extras: MotivationUploadKind[];
  requiredTotal: number;
  requiredHave: number;
}

/**
 * Weigh what has been uploaded against what the application needs.
 *
 * `have` counts KINDS, not files — three photographs of one safe are one
 * satisfied need, which is also how the annexure lettering treats them.
 */
export function documentStatus(
  licenceType: MotivationLicenceType,
  uploaded: MotivationUploadKind[],
): DocumentStatus {
  const have = new Set(uploaded);
  const required = REQUIRED[licenceType] ?? [];
  const strengthens = STRENGTHENS[licenceType] ?? [];

  const needs: DocumentNeed[] = [
    ...required.map((kind) => ({
      kind,
      label: LABELS[kind],
      tier: 'required' as const,
      why: WHY[kind] ?? '',
      have: have.has(kind),
    })),
    ...strengthens.map((kind) => ({
      kind,
      label: LABELS[kind],
      tier: 'strengthens' as const,
      why: WHY[kind] ?? '',
      have: have.has(kind),
    })),
  ];

  // Anything uploaded that we never asked for. Accepted and lettered like the
  // rest — an applicant who wants to attach a range record or a letter from
  // their farm manager should never be told it does not belong.
  const asked = new Set<MotivationUploadKind>([...required, ...strengthens]);
  const extras = uploaded.filter((k) => !asked.has(k));

  return {
    needs,
    missingRequired: required.filter((k) => !have.has(k)),
    extras: [...new Set(extras)],
    requiredTotal: required.length,
    requiredHave: required.filter((k) => have.has(k)).length,
  };
}

/** Human label for any kind, including the ones nobody asked for. */
export function documentLabel(kind: MotivationUploadKind): string {
  return LABELS[kind] ?? 'Supporting document';
}
