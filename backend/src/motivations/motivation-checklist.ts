import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// THE SUBMISSION CHECKLIST — the page that turns a document into a package.
//
// Operator, 2026-08-18: "List of what needs to go with the motivation. This
// needs to be a complete package."
//
// The applicant walks into the DFO with a stack of paper and no way to know
// whether it is complete. A refusal for a missing certified copy costs weeks
// and is entirely avoidable. So the pack opens with a checklist of real
// tick-boxes, in the order the bundle should be assembled.
//
// THE HONEST SPLIT, and it is the important design decision here:
//
//   PART A — what is IN this pack. We generated or received these, so we can
//            state them with certainty and tick them ourselves.
//   PART B — what the applicant must ADD. SAPS forms, certified copies,
//            photographs, the fee. We do NOT hold these, so every line is an
//            empty box, and the list is marked as one to confirm with their
//            own DFO.
//
// PART B IS DELIBERATELY CAUTIOUS. Requirements differ by province, by station
// and over time, and a checklist that confidently omits something a particular
// DFO wants is worse than no checklist at all — it would give false assurance
// to someone who trusted it. So Part B says what is commonly required, tells
// the applicant to confirm at their station, and never claims to be exhaustive.
//
// ⚠️ ATTORNEY / OPERATOR REVIEW REQUIRED before the flag is flipped: the Part B
// wording and the SAPS form numbers must be checked against current practice.
// They are the most likely thing in this whole build to be quietly out of date.
// ────────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  /** Rendered as a ticked box when true, an empty box when false. */
  present: boolean;
  label: string;
  /** Annexure letter, where this item is one of ours. */
  annexure?: string;
  /** Shown smaller under the label. */
  note?: string;
}

export interface ChecklistSection {
  title: string;
  intro?: string;
  items: ChecklistItem[];
}

/** Human labels, and the order annexures are lettered in. */
export const UPLOAD_KIND_LABELS: Record<MotivationUploadKind, string> = {
  IDENTITY_DOCUMENT: 'Copy of identity document',
  COMPETENCY_CERTIFICATE: 'Competency certificate',
  PROFICIENCY_CERTIFICATE: 'Proficiency / training certificate',
  CURRENT_LICENCE: 'Existing firearm licence(s)',
  ASSOCIATION_CARD: 'Association membership proof',
  ADDRESS_CONFIRMATION: 'Proof of residential address',
  EMPLOYMENT_CONFIRMATION: 'Confirmation of employment',
  SAFE_PHOTO: 'Photograph of the safe',
  SAFE_INSTALLATION: 'Photograph of the safe installation / anchoring',
  CHARACTER_REFERENCE: 'Character reference(s)',
  INCIDENT_REPORT: 'Incident report / SAPS case reference',
  PREVIOUS_MOTIVATION: 'Previous motivation',
  OTHER: 'Supporting document',
};

/**
 * Annexure lettering order. Fixed, not upload order — a reviewer reading the
 * index should find identity first and supporting material last, whatever
 * sequence the applicant happened to scan things in.
 */
const ANNEXURE_ORDER: MotivationUploadKind[] = [
  'IDENTITY_DOCUMENT',
  'PROFICIENCY_CERTIFICATE',
  'COMPETENCY_CERTIFICATE',
  'ADDRESS_CONFIRMATION',
  'EMPLOYMENT_CONFIRMATION',
  'ASSOCIATION_CARD',
  'SAFE_PHOTO',
  'SAFE_INSTALLATION',
  'CURRENT_LICENCE',
  'INCIDENT_REPORT',
  'CHARACTER_REFERENCE',
  'PREVIOUS_MOTIVATION',
  'OTHER',
] as const;

export interface AnnexureEntry {
  letter: string;
  kind: MotivationUploadKind;
  label: string;
  count: number;
}

/**
 * Assign annexure letters to what the applicant actually uploaded.
 *
 * Letters are assigned to KINDS, not to files: three photographs of one safe
 * are all "Annexure G", which is how the sample motivations do it and how a
 * reviewer expects to find them.
 */
export function buildAnnexures(
  kinds: MotivationUploadKind[],
): AnnexureEntry[] {
  const counts = new Map<MotivationUploadKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);

  const out: AnnexureEntry[] = [];
  let i = 0;
  for (const kind of ANNEXURE_ORDER) {
    const count = counts.get(kind);
    if (!count) continue;
    out.push({
      letter: String.fromCharCode(65 + i), // A, B, C…
      kind,
      label: UPLOAD_KIND_LABELS[kind],
      count,
    });
    i++;
  }
  return out;
}

/** Which uploads materially strengthen this licence type. */
const RECOMMENDED: Record<MotivationLicenceType, MotivationUploadKind[]> = {
  S13_SELF_DEFENCE: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTO',
    'SAFE_INSTALLATION',
    'INCIDENT_REPORT',
  ],
  S15_OCCASIONAL_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'PROFICIENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTO',
    'SAFE_INSTALLATION',
    'CURRENT_LICENCE',
  ],
  S16_DEDICATED_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'PROFICIENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'ASSOCIATION_CARD',
    'SAFE_PHOTO',
    'SAFE_INSTALLATION',
    'CURRENT_LICENCE',
  ],
  S16_DEDICATED_SPORT: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'PROFICIENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'ASSOCIATION_CARD',
    'SAFE_PHOTO',
    'SAFE_INSTALLATION',
    'CURRENT_LICENCE',
  ],
  S24_RENEWAL: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTO',
    'CURRENT_LICENCE',
  ],
};

/**
 * Things the applicant must obtain themselves. Commonly required — NOT a
 * guarantee, and the rendered page says so.
 *
 * ⚠️ Verify against current SAPS practice before go-live. Requirements vary by
 * station and change without notice.
 */
const APPLICANT_MUST_ADD: { label: string; note?: string }[] = [
  {
    label: 'The completed SAPS application form for this licence type',
    note: 'Obtained from, and lodged at, your local DFO.',
  },
  {
    label: 'Certified copies where the station requires them',
    note: 'Many stations want certified copies of the ID and competency certificate rather than plain copies. Ask before you go.',
  },
  {
    label: 'Passport-style photographs, if requested',
  },
  {
    label: 'The prescribed application fee',
    note: 'Confirm the current amount and accepted payment method at the station.',
  },
  {
    label: 'Fingerprints',
    note: 'Normally taken at the station when you lodge the application.',
  },
  {
    label: 'Anything else your DFO asks for',
    note: 'Requirements differ between stations and provinces. Phone ahead — it is the cheapest thing you can do.',
  },
];

/**
 * Build the checklist. `haveKinds` is what was actually uploaded, so Part A
 * ticks itself and anything recommended-but-missing shows as an open box the
 * applicant can still act on.
 */
export function buildChecklist(
  licenceType: MotivationLicenceType,
  haveKinds: MotivationUploadKind[],
): ChecklistSection[] {
  const annexures = buildAnnexures(haveKinds);
  const have = new Set(haveKinds);

  const inPack: ChecklistItem[] = [
    { present: true, label: 'This motivation' },
    {
      present: true,
      label: 'Request for prior notice before refusal (PAJA section 3(2))',
      note: 'Lodge this together with the application.',
    },
    ...annexures.map((a) => ({
      present: true,
      label: a.count > 1 ? `${a.label} (${a.count} pages)` : a.label,
      annexure: a.letter,
    })),
  ];

  // Recommended but not supplied — an open box rather than a silent omission.
  const missing: ChecklistItem[] = RECOMMENDED[licenceType]
    .filter((k) => !have.has(k))
    .map((k) => ({
      present: false,
      label: UPLOAD_KIND_LABELS[k],
      note:
        k === 'SAFE_PHOTO' || k === 'SAFE_INSTALLATION'
          ? 'A photograph of the safe and of how it is anchored is strong evidence of safekeeping.'
          : undefined,
    }));

  const sections: ChecklistSection[] = [
    {
      title: 'In this pack',
      intro:
        'These documents are attached behind this page, in the order listed.',
      items: inPack,
    },
  ];

  if (missing.length) {
    sections.push({
      title: 'Worth adding',
      intro:
        'Not required, but each of these supports a claim made in the motivation.',
      items: missing,
    });
  }

  sections.push({
    title: 'You must add these yourself',
    intro:
      'We do not hold these. Confirm the full list with your own Designated Firearms Officer before you lodge — requirements differ between stations and this list is not exhaustive.',
    items: APPLICANT_MUST_ADD.map((i) => ({ present: false, ...i })),
  });

  return sections;
}
