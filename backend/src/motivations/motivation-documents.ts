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
    'SAFE_PHOTO_CLOSED',
    'SAFE_PHOTO_AJAR',
    'SAFE_PHOTO_BOLTS',
  ],
  S15_OCCASIONAL_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTO_CLOSED',
    'SAFE_PHOTO_AJAR',
    'SAFE_PHOTO_BOLTS',
  ],
  // Dedicated status IS the basis of a section 16 application, so proof of
  // membership stops being a nicety and becomes part of the case.
  S16_DEDICATED_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTO_CLOSED',
    'SAFE_PHOTO_AJAR',
    'SAFE_PHOTO_BOLTS',
    'ASSOCIATION_CARD',
  ],
  S16_DEDICATED_SPORT: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTO_CLOSED',
    'SAFE_PHOTO_AJAR',
    'SAFE_PHOTO_BOLTS',
    'ASSOCIATION_CARD',
  ],
  // A renewal is a different form (SAPS 518a) and a different pack; the one
  // thing it always needs is the licence being renewed.
  S24_RENEWAL: [
    'IDENTITY_DOCUMENT',
    'CURRENT_LICENCE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTO_CLOSED',
    'SAFE_PHOTO_AJAR',
    'SAFE_PHOTO_BOLTS',
  ],
};

/** Not demanded, but this is what makes a motivation land. */
const STRENGTHENS: Record<MotivationLicenceType, MotivationUploadKind[]> = {
  S13_SELF_DEFENCE: ['INCIDENT_REPORT', 'CHARACTER_REFERENCE'],
  S15_OCCASIONAL_HUNTER: ['PROFICIENCY_CERTIFICATE', 'CHARACTER_REFERENCE'],
  S16_DEDICATED_HUNTER: ['PROFICIENCY_CERTIFICATE', 'CHARACTER_REFERENCE'],
  S16_DEDICATED_SPORT: ['PROFICIENCY_CERTIFICATE', 'CHARACTER_REFERENCE'],
  S24_RENEWAL: ['PROFICIENCY_CERTIFICATE'],
};

const LABELS: Record<MotivationUploadKind, string> = {
  IDENTITY_DOCUMENT: 'A copy of your ID',
  COMPETENCY_CERTIFICATE: 'Your SAPS competency certificate',
  PROFICIENCY_CERTIFICATE: 'Your proficiency or training certificate',
  CURRENT_LICENCE: 'A firearm licence you already hold',
  ASSOCIATION_CARD: 'Proof of your association membership',
  ADDRESS_CONFIRMATION: 'Proof of your address',
  EMPLOYMENT_CONFIRMATION: 'Confirmation of employment',
  SAFE_PHOTO_CLOSED: 'Your safe, closed',
  SAFE_PHOTO_AJAR: 'Your safe, half open with the key in the door',
  SAFE_PHOTO_BOLTS: 'Your safe, fully open showing the roll bolts',
  // Retired. Kept so a row written before the split still has a name.
  SAFE_PHOTO: 'Photographs of your safe (added before the split)',
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
    'A licence for every firearm you already own. We read the make, calibre and serial off it — which is also what tells us whether this application overlaps something you already hold.',
  // THREE SEPARATE SHOTS, each its own line, because each shows something the
  // others cannot. Written as three needs rather than one instruction: an
  // applicant who reads "three photographs" and sends one has satisfied the
  // sentence, and the pack is short two photographs nobody noticed.
  SAFE_PHOTO_CLOSED:
    'The safe as it stands in the room, shut, with the key out of it. This is the shot that shows the unit itself.',
  SAFE_PHOTO_AJAR:
    'Half open with the key in the door. It shows the lock belongs to this safe and that the key turns it — a closed door on its own shows neither.',
  SAFE_PHOTO_BOLTS:
    'Door fully open so the roll bolts are visible. The bolts are what make it a safe rather than a cupboard, and a DFO looks for them.',
  SAFE_PHOTO:
    'Added before we split this into three separate shots. It stays in your pack as supporting evidence.',
  SAFE_INSTALLATION:
    'How the safe is anchored to the wall or floor. Not one of the three shots, but worth attaching if you have it.',
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
 * `have` is a set-membership test on the KIND, so one file satisfies one need.
 * That is exactly why the three safe photographs are three separate kinds: as
 * a single SAFE_PHOTO kind, one shot of a closed door ticked the whole
 * requirement, and counting files instead would not have helped — nothing on
 * MotivationUpload records WHICH shot a file is, so three photographs of the
 * same closed door would have counted as three.
 */
export function documentStatus(
  licenceType: MotivationLicenceType,
  uploaded: MotivationUploadKind[],
  answers: Record<string, string> = {},
): DocumentStatus {
  const have = new Set(uploaded);
  const required = [...(REQUIRED[licenceType] ?? [])];
  const strengthens = [...(STRENGTHENS[licenceType] ?? [])];

  // THE LICENCES FOR FIREARMS THEY ALREADY OWN.
  //
  // Operator, 2026-08-19: "all current licences — not optional. (If
  // applicable, might be a first time application.)" So it is required
  // CONDITIONALLY, and the condition is something we already know: if they
  // have told us they own a firearm, its licence has to be in the pack.
  //
  // A first-time applicant owns nothing and is never asked for one. Asking
  // everybody would be the same false demand as never asking anybody.
  const ownsFirearms = Object.keys(answers).some(
    (k) => /^existing_firearm_\d+_calibre$/.test(k) && (answers[k] ?? '').trim(),
  );
  if (ownsFirearms && !required.includes('CURRENT_LICENCE')) {
    required.push('CURRENT_LICENCE');
  }

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

/**
 * Kinds RETIRED from the picker: they exist only so rows written before
 * 2026-08-19 keep a label and an annexure letter. Postgres cannot drop an enum
 * value, so "retired" has to mean "never offered" rather than "gone".
 *
 * ONLY SAFE_PHOTO. SAFE_INSTALLATION was in this list for an afternoon and it
 * was wrong twice over: the checklist still recommended it, which would have
 * shown a row nobody could ever tick, and the three shots the operator asked
 * for are all of the safe's DOOR — none of them shows the safe anchored to the
 * wall, which is the thing a DFO inspects in person. It is not one of the
 * three and it is not required, but it is worth attaching, so it stays on
 * offer.
 */
export const RETIRED: MotivationUploadKind[] = ['SAFE_PHOTO'];

/**
 * What the upload picker should offer, in the order it should offer it.
 *
 * SERVER-DRIVEN ON PURPOSE. The wizard used to carry its own hard-coded list
 * of kinds and labels, and it had already drifted: it omitted two kinds
 * entirely and described the safe photograph in the singular while the backend
 * described three. A list maintained in two places is a list maintained in
 * neither.
 *
 * Required first, in the order they are asked for, so the next thing to
 * photograph is the next thing in the menu.
 */
export function pickableKinds(
  licenceType: MotivationLicenceType,
  answers: Record<string, string> = {},
  uploaded: MotivationUploadKind[] = [],
): {
  kind: MotivationUploadKind;
  label: string;
  tier: DocumentTier;
  have: boolean;
}[] {
  // WHAT IS ALREADY ATTACHED HAS TO BE PASSED IN. The picker labels its
  // required entries "needed", and computing that against an empty list would
  // have meant the tag never cleared: the applicant photographs all three
  // shots and the menu goes on calling every one of them needed.
  const status = documentStatus(licenceType, uploaded, answers);
  const ranked = new Map<MotivationUploadKind, DocumentTier>(
    status.needs.map((n) => [n.kind, n.tier]),
  );

  const rest = (Object.keys(LABELS) as MotivationUploadKind[]).filter(
    (k) => !ranked.has(k) && !RETIRED.includes(k),
  );

  const have = new Set(uploaded);

  return [
    ...status.needs.map((n) => ({
      kind: n.kind,
      label: n.label,
      tier: n.tier,
      have: n.have,
    })),
    ...rest.map((kind) => ({
      kind,
      label: LABELS[kind],
      tier: 'extra' as DocumentTier,
      have: have.has(kind),
    })),
  ];
}
