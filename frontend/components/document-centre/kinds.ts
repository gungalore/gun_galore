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

// ────────────────────────────────────────────────────────────────────
// THE SECTIONS THE LIST IS BUILT FROM.
//
// ⚠️ NOT THE SAME TABLE AS KIND_GROUPS ABOVE, AND THE TWO MUST NOT BE MERGED.
// KIND_GROUPS is the ADD MENU — the question "what am I about to photograph?",
// answered in the member's words, with the retired kinds deliberately absent
// so nobody can file into one again. This is the READING order — the question
// "where is my .308?" — and it therefore has to place every kind that exists,
// retired ones included, or a member holding a row filed in 2026-08 could not
// see their own document.
//
// The order is fixed and it is not alphabetical: the firearm is what a member
// came for, the chain of paper behind it follows, and the things nobody
// renews sit at the bottom.
// ────────────────────────────────────────────────────────────────────

export type DocSectionId =
  | 'firearms'
  | 'competency'
  | 'training'
  | 'about-you'
  | 'associations'
  | 'safe'
  | 'other';

/** How a section arranges the rows inside it. */
export type DocGrouping =
  /** By the licence's own firearm category. */
  | 'category'
  /** By what a competency certificate covers — the first one only. */
  | 'covers'
  /** By category, with the unit standard that names no firearm off to itself. */
  | 'training'
  /** One flat list. */
  | null;

export interface DocSection {
  id: DocSectionId;
  title: string;
  /** The kinds that land here. First matching section in this order wins. */
  kinds: CredentialKind[];
  grouping: DocGrouping;
  /** What a row in here is called, singular and plural. */
  noun: [string, string];
  /** One line saying what belongs here, shown when the section is empty. */
  emptyLine: string;
  /** What the section's Add link is for. Null where there is nothing to offer. */
  addKind: CredentialKind | null;
}

export const SECTIONS: readonly DocSection[] = [
  {
    id: 'firearms',
    title: 'Your firearms',
    // ⚠️ ALSO REACHED BY coversKinds — see placeRow in
    // lib/document-centre-sections.ts. One page can be a licence and
    // something else at once, and the licence half is what a member looks
    // for it under.
    kinds: ['FIREARM_LICENCE'],
    grouping: 'category',
    noun: ['licence', 'licences'],
    emptyLine:
      'Your firearm licence cards, so we can tell you before one runs out.',
    addKind: 'FIREARM_LICENCE',
  },
  {
    id: 'competency',
    title: 'Competency',
    kinds: ['COMPETENCY_CERTIFICATE'],
    grouping: 'covers',
    noun: ['certificate', 'certificates'],
    emptyLine:
      'Your SAPS competency certificates, grouped by the firearms they cover.',
    addKind: 'COMPETENCY_CERTIFICATE',
  },
  {
    id: 'training',
    // ⚠️ ITS OWN SECTION, NOT NESTED UNDER COMPETENCY. They are evidence
    // rather than something anyone renews, and burying eight of them inside
    // the section that DOES carry a renewal is how the renewal gets lost.
    title: 'Training certificates',
    kinds: ['PROFICIENCY'],
    grouping: 'training',
    noun: ['certificate', 'certificates'],
    emptyLine:
      'Your proficiency certificates and their statements of results. These do not expire.',
    addKind: 'PROFICIENCY',
  },
  {
    id: 'about-you',
    title: 'About you',
    kinds: [
      'IDENTITY_DOCUMENT',
      'ADDRESS_CONFIRMATION',
      'EMPLOYMENT_CONFIRMATION',
    ],
    grouping: null,
    noun: ['document', 'documents'],
    emptyLine:
      'A copy of your ID, a proof of address, and a confirmation of employment where one is asked for.',
    addKind: 'IDENTITY_DOCUMENT',
  },
  {
    id: 'associations',
    title: 'Dedicated status and associations',
    // The four retired association kinds are here for the reason in the
    // header: rows filed under them still exist and still have to be findable.
    kinds: [
      'DEDICATED_DISCIPLINE',
      /**
       * ⚠️ THE SECTION INVITED THIS AND HAD NOWHERE TO PUT IT. Its empty line
       * has always asked for "the status certificate, a letter of good
       * standing and the endorsement" — and the only kind on offer was
       * DEDICATED_DISCIPLINE, so an endorsement filed here was stored as a
       * status document, then offered into association_name,
       * association_number and dedicated_since, and auto-suggested as an
       * ASSOCIATION_CARD, which S16_AUTO_ATTACH forbids in capitals because an
       * endorsement names ONE firearm and an older one describes the wrong
       * gun. CredentialKind gained the value on 2026-09-09.
       */
      'ASSOCIATION_ENDORSEMENT',
      'DEDICATED_STATUS',
      'DEDICATED_HUNTER',
      'PROFESSIONAL_HUNTER',
      'GOOD_STANDING',
      'SHOOTING_ACTIVITY_LOG',
    ],
    grouping: null,
    noun: ['document', 'documents'],
    emptyLine:
      'A section 16 application needs the status certificate, a letter of good standing and the endorsement.',
    addKind: 'DEDICATED_DISCIPLINE',
  },
  {
    id: 'safe',
    title: 'Safe and storage',
    kinds: [
      'SAFE_PHOTOGRAPHS',
      'SAFE_PHOTO_CLOSED',
      'SAFE_PHOTO_AJAR',
      'SAFE_PHOTO_BOLTS',
      'SAFE_INSTALLATION',
    ],
    grouping: null,
    noun: ['item', 'items'],
    emptyLine:
      'Closed, ajar, bolts, and the installation certificate.',
    addKind: 'SAFE_PHOTOGRAPHS',
  },
  {
    id: 'other',
    title: 'Anything else',
    kinds: ['OTHER'],
    grouping: null,
    noun: ['document', 'documents'],
    emptyLine: 'Anything you want kept with the rest.',
    addKind: 'OTHER',
  },
];

/**
 * The kinds that draw as photographs rather than as rows in the safe section.
 *
 * The installation certificate is a document; the rest are pictures of a box,
 * and a list of four rows called "Photographs of my safe" tells the member
 * nothing a 4-across grid does not tell them at a glance.
 */
export const SAFE_PHOTO_KINDS: CredentialKind[] = [
  'SAFE_PHOTOGRAPHS',
  'SAFE_PHOTO_CLOSED',
  'SAFE_PHOTO_AJAR',
  'SAFE_PHOTO_BOLTS',
];
