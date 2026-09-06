import { CredentialKind } from '@/lib/licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// THE MENU THE MEMBER READS, and the folders it mirrors.
//
// Lifted out of app/licence-centre/page.tsx unchanged when that file passed
// 3,000 lines. Both lists are shared: the review screen's type sheet, the
// confirm panel's type control and the add panel's grouped picker all read
// them, and a second copy would eventually disagree with the first about
// which kinds are still offered.
// ────────────────────────────────────────────────────────────────────

/**
 * What a member can file a document as.
 *
 * ⚠️ THE FOUR ASSOCIATION KINDS ARE GONE FROM THIS LIST, deliberately. They
 * still exist in the enum — Postgres cannot drop a value — but offering them
 * would put a document outside every query that now looks for
 * DEDICATED_DISCIPLINE, and it would put the member back in front of the
 * choice that made us file a sport-shooter status as a hunter's.
 */
export const KINDS: CredentialKind[] = [
  'FIREARM_LICENCE',
  'COMPETENCY_CERTIFICATE',
  'DEDICATED_DISCIPLINE',
  'PROFICIENCY',
  // ── the paperwork the Centre keeps rather than chases ──────────────
  //
  // ⚠️ ON THE MENU, BECAUSE "ADD AND REMOVE" HAS TO MEAN BOTH HALVES.
  // Operator, 2026-08-22: "give them access to it so they can add/remove
  // documents from it." Without these the classifier is the only way a safe
  // photograph ever gets filed as one.
  //
  // ⚠️ AND THE SAFE IS ONE ENTRY, NOT FOUR. Operator, 2026-08-23: "I dont like
  // the safe picture being seperate four uploads, looks shit. Make it safe
  // pictures. User must be able to upload multiple documents." Four entries
  // asked the member to sort their own photographs by how far the door was
  // open — and the classifier could not do it either, which is why it was
  // pinned to low confidence on all four. Several files go in under this one
  // entry; the file picker below already takes a whole folder at once.
  //
  // They sit BELOW the credentials and above OTHER because the ordering is
  // the menu the member reads, and a licence is what most people are here to
  // file.
  'IDENTITY_DOCUMENT',
  'ADDRESS_CONFIRMATION',
  'EMPLOYMENT_CONFIRMATION',
  'SAFE_PHOTOGRAPHS',
  'SHOOTING_ACTIVITY_LOG',
  'OTHER',
];

/**
 * Where the menu splits.
 *
 * The two halves answer different questions — "what runs out" and "what do I
 * have to hand in" — and a flat list of thirteen makes somebody read all of
 * them to find the one they came for.
 */
export const KIND_GROUPS: { label: string; kinds: CredentialKind[] }[] = [
  {
    label: 'Licences and certificates',
    kinds: [
      'FIREARM_LICENCE',
      'COMPETENCY_CERTIFICATE',
      'DEDICATED_DISCIPLINE',
      'PROFICIENCY',
    ],
  },
  {
    label: 'Supporting paperwork',
    kinds: [
      'IDENTITY_DOCUMENT',
      'ADDRESS_CONFIRMATION',
      'EMPLOYMENT_CONFIRMATION',
      'SAFE_PHOTOGRAPHS',
      'SHOOTING_ACTIVITY_LOG',
    ],
  },
  { label: 'Anything else', kinds: ['OTHER'] },
];
