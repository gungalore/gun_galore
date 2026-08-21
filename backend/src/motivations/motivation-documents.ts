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
// never block someone from producing their own motivation on the strength of a
// missing UPLOAD — someone whose copies are at the police station being
// certified should still be drafting. We say plainly what is missing and
// let them decide.
//
// ⚠️ COMPETENCY IS THE ONE EXCEPTION, and it is not enforced here. Operator,
// 2026-08-19: a competency cannot be pending; the certificate must already be
// in hand. That is enforced as a REQUIRED ANSWER (the certificate number, in
// motivation-fields.ts), because the number exists nowhere but on the
// certificate. This module still only reports the upload as missing.
//
// ⚠️ The list is drawn from the official SAPS 271 checklist. Items marked
// verifyBeforeUse in the checklist module carry the same caveat here: station
// practice differs, and a confident list that is wrong is worse than none.
//
// PURE — no Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

/**
 * How hard a document is to do without.
 *
 * ⚠️ 'expected' EXISTS BECAUSE TWO TIERS COULD NOT TELL THE TRUTH about the
 * association's endorsement. It is not in the Firearms Control Act — the
 * document itself cites the Hunters Forum guidelines of 2 September 2005 —
 * so calling it 'required' would tell somebody the law demands it, which is
 * false. But a DFO will insist on it, so calling it 'strengthens' ("optional
 * — but it helps") sends them to a counter to be turned away. The honest
 * answer is a third thing: no statute behind it, and you are not getting in
 * without it.
 */
export type DocumentTier = 'required' | 'expected' | 'strengthens' | 'extra';

export interface DocumentNeed {
  kind: MotivationUploadKind;
  label: string;
  tier: DocumentTier;
  /** Why it matters, in the applicant's terms. */
  why: string;
  /** True once at least one file of this kind is attached. */
  have: boolean;
  /**
   * Kinds this one line stands for, when it stands for several.
   *
   * ⚠️ THE SAFE IS ONE THING AND THREE PHOTOGRAPHS. Splitting it into three
   * checklist lines was right about the evidence and wrong about the list —
   * three of the seven required rows were the same object, which is most of
   * why the operator called the list long. One line now, and it does not go
   * green until all three shots are in.
   */
  parts?: { kind: MotivationUploadKind; label: string; have: boolean }[];
}

/**
 * What SAPS will not process the application without.
 *
 * Deliberately short. Everything on it appears on the official checklist, and
 * anything we are unsure of belongs in `strengthens` instead — being wrong
 * about a requirement sends someone to a counter to be turned away.
 */
/** The three shots, in one place, because five lists want the same three. */
const SAFE_SHOTS: MotivationUploadKind[] = [
  'SAFE_PHOTO_CLOSED',
  'SAFE_PHOTO_AJAR',
  'SAFE_PHOTO_BOLTS',
];

const REQUIRED: Record<MotivationLicenceType, MotivationUploadKind[]> = {
  // ⚠️ THE SAFE PHOTOGRAPHS LEFT THIS LIST ON 2026-08-20 AND CAME BACK ON
  // 2026-08-21. Worth reading before moving them again.
  //
  // They were removed on documentary reasoning, and the reasoning was sound
  // as far as it went: no SAPS document list at either stage mentions a
  // photograph of a safe; regulation 13 does not list one among what
  // accompanies an application; regulation 13(12) conditions the ISSUE of the
  // licence rather than the lodging of it; and SAPS's own published sequence
  // is lodge first, install a safe within 14 days, then a premises
  // inspection. On that reading, telling somebody they cannot apply until
  // they have photographed a safe delays them for nothing.
  //
  // Operator, 2026-08-21, asked directly: "We do need the Safe pictures."
  //
  // That is somebody who has lodged these applications, and it beats an
  // inference drawn from what a web page does not mention — an absence is
  // weak evidence, and a DFO handing a pack back is not. What the documentary
  // work still buys is the 14-day window and the inspection, which are true
  // and which the SAFE_WHY text now explains: take the photographs, and know
  // the safe is also inspected later.
  S13_SELF_DEFENCE: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    ...SAFE_SHOTS,
  ],
  S15_OCCASIONAL_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    ...SAFE_SHOTS,
  ],
  // Dedicated status IS the basis of a section 16 application, so proof of
  // membership stops being a nicety and becomes part of the case.
  S16_DEDICATED_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    ...SAFE_SHOTS,
    // THREE SEPARATE PIECES OF PAPER, and the association issues them
    // separately: the status certificate, the sworn letter of good standing,
    // and an endorsement naming the firearm. One slot for all three meant an
    // applicant who attached the certificate looked complete while missing
    // the declaration section 16(2) actually asks for.
    'ASSOCIATION_CARD',
    'GOOD_STANDING_LETTER',
  ],
  S16_DEDICATED_SPORT: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    ...SAFE_SHOTS,
    // THREE SEPARATE PIECES OF PAPER, and the association issues them
    // separately: the status certificate, the sworn letter of good standing,
    // and an endorsement naming the firearm. One slot for all three meant an
    // applicant who attached the certificate looked complete while missing
    // the declaration section 16(2) actually asks for.
    'ASSOCIATION_CARD',
    'GOOD_STANDING_LETTER',
  ],
  // A renewal is a different form (SAPS 518a) and a different pack; the one
  // thing it always needs is the licence being renewed.
  // ⚠️ COMPETENCY WAS MISSING FROM THE RENEWAL PACK ENTIRELY, and the two
  // surfaces disagreed about it: motivation-checklist.ts already listed it
  // under RECOMMENDED.S24_RENEWAL. Absent from all three tiers here,
  // documentStatus() omitted the row and pickableKinds() filed the competency
  // certificate at tier 'extra', next to "Something else you would like to
  // attach" — for an application that cannot be granted without it.
  S24_RENEWAL: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'CURRENT_LICENCE',
    'ADDRESS_CONFIRMATION',
    ...SAFE_SHOTS,
  ],
};

/**
 * No statute behind it, and the DFO will insist anyway.
 *
 * Kept apart from REQUIRED so nothing here can be described to a member as
 * something the Act demands, and apart from STRENGTHENS so nothing here is
 * described as optional. See DocumentTier.
 */
const EXPECTED: Record<MotivationLicenceType, MotivationUploadKind[]> = {
  // ⚠️ WHERE THE FIREARM IS COMING FROM, ON EVERY APPLICATION BUT A RENEWAL.
  // Annexure M in a professional pack, and it was reaching the picker only as
  // an "extra" — buried under everything else, when it answers a question a
  // DFO has to have an answer to. Either the firearm is coming out of a
  // dealer's stock, or a named licence holder has agreed to transfer it;
  // there is no third possibility, and an application that cannot say which
  // stalls.
  //
  // EXPECTED and not REQUIRED, deliberately: this list is the one that must
  // never be described to a member as something the Act demands. The Act does
  // not name this document. Stations do.
  S13_SELF_DEFENCE: ['FIREARM_SOURCE_PROOF'],
  S15_OCCASIONAL_HUNTER: ['FIREARM_SOURCE_PROOF'],
  S16_DEDICATED_HUNTER: ['ASSOCIATION_ENDORSEMENT', 'FIREARM_SOURCE_PROOF'],
  S16_DEDICATED_SPORT: ['ASSOCIATION_ENDORSEMENT', 'FIREARM_SOURCE_PROOF'],
  // A renewal transfers nothing — the applicant already holds the firearm.
  S24_RENEWAL: [],
};

/** Not demanded, but this is what makes a motivation land. */
const STRENGTHENS: Record<MotivationLicenceType, MotivationUploadKind[]> = {
  S13_SELF_DEFENCE: ['INCIDENT_REPORT', 'CHARACTER_REFERENCE'],
  // The shooting log is the difference between saying you hunt and showing
  // it. Nothing in the Act asks for one; the packs that get taken seriously
  // all carry one.
  S15_OCCASIONAL_HUNTER: [
    'PROFICIENCY_CERTIFICATE',
    'SHOOTING_ACTIVITY_LOG',
    'CHARACTER_REFERENCE',
  ],
  S16_DEDICATED_HUNTER: [
    'PROFICIENCY_CERTIFICATE',
    'SHOOTING_ACTIVITY_LOG',
    'CHARACTER_REFERENCE',
  ],
  S16_DEDICATED_SPORT: [
    'PROFICIENCY_CERTIFICATE',
    'SHOOTING_ACTIVITY_LOG',
    'CHARACTER_REFERENCE',
  ],
  S24_RENEWAL: ['PROFICIENCY_CERTIFICATE', 'SHOOTING_ACTIVITY_LOG'],
};

const LABELS: Record<MotivationUploadKind, string> = {
  IDENTITY_DOCUMENT: 'A copy of your ID',
  COMPETENCY_CERTIFICATE: 'Your SAPS competency certificate',
  PROFICIENCY_CERTIFICATE: 'Your proficiency or training certificate',
  CURRENT_LICENCE: 'A firearm licence you already hold',
  ASSOCIATION_CARD: 'Your dedicated status certificate',
  GOOD_STANDING_LETTER: 'Your letter of good standing',
  ASSOCIATION_ENDORSEMENT: "The association's endorsement for this firearm",
  ADDRESS_CONFIRMATION: 'Proof of your address',
  EMPLOYMENT_CONFIRMATION: 'Confirmation of employment',
  SAFE_PHOTO_CLOSED: 'Your safe, closed',
  SAFE_PHOTO_AJAR: 'Your safe, half open with the key in the door',
  SAFE_PHOTO_BOLTS: 'Your safe, fully open showing the roll bolts',
  // Retired. Kept so a row written before the split still has a name.
  SAFE_PHOTO: 'Photographs of your safe (added before the split)',
  SAFE_INSTALLATION: 'The safe bolted to the wall or floor',
  CHARACTER_REFERENCE: 'A character reference',
  SHOOTING_ACTIVITY_LOG: 'Your record of hunts or competitions',
  FIREARM_SOURCE_PROOF: 'Where this firearm is coming from',
  SELLER_LICENCE: "The current owner's licence",
  EXECUTOR_APPOINTMENT: 'Your letter of appointment as executor',
  INCIDENT_REPORT: 'An incident report or SAPS case number',
  PREVIOUS_MOTIVATION: 'A previous motivation',
  OTHER: 'Something else you would like to attach',
};

/**
 * The safe, as one requirement.
 *
 * ⚠️ IT STILL NAMES ALL THREE SHOTS. The three kinds exist because each shows
 * something the others cannot, and an applicant who reads "photographs of
 * your safe" and sends one has satisfied the phrase while the pack is short
 * two photographs nobody noticed. The line collapses; the instruction does
 * not.
 */
const SAFE_WHY =
  'Three photographs, and a DFO looks for all three: the safe closed with the key out of it, half open with the key in the door, and fully open so the roll bolts are visible. The closed shot shows the unit, the half-open shot shows the lock belongs to it, and the bolts are what make it a safe rather than a cupboard. Take all three: your DFO wants them with the application. The safe is checked twice over — the photographs go in the pack, and regulation 13(12) makes compliant storage a condition of the licence being ISSUED, so the DFO also inspects your premises before it comes through.';

const WHY: Partial<Record<MotivationUploadKind, string>> = {
  SHOOTING_ACTIVITY_LOG:
    'Your log of hunts or competitions \u2014 dates, where, what discipline or species. This is the annexure that shows you actually do the thing you are applying to do, rather than saying you intend to. Nothing in the Act asks for it; the packs that get taken seriously all carry one.',
  FIREARM_SOURCE_PROOF:
    'Either the dealer\u2019s invoice or quote, or a letter from the person who currently owns the firearm saying they agree to you applying for a licence over it. A DFO reads this to answer one question \u2014 whose firearm is this \u2014 and an application that cannot answer it stalls.',
  SELLER_LICENCE:
    'Only for a private transfer, and it goes with the permission letter: the letter says the owner agrees, and this shows they are the person entitled to agree. Ask them for a copy \u2014 it is theirs to give.',
  EXECUTOR_APPOINTMENT:
    'Only where the firearm is inherited. SAPS asks for the letter of appointment as executor by name, and an estate firearm cannot be licensed without it.',
  IDENTITY_DOCUMENT:
    'A photograph or scan of the page with your photo on it is fine here — what you upload to us does not need certifying. We read your name and ID number off it so you do not have to type them. (The copy you hand the DFO is the one that must be certified.)',
  COMPETENCY_CERTIFICATE:
    'Without competency for this type of firearm, SAPS cannot process the application at all.',
  ADDRESS_CONFIRMATION:
    'A photograph or scan is fine — no certification needed for our copy. Use something recent: the DFO will want proof of address from the last three months. We read the address off it.',
  ASSOCIATION_CARD:
    'Dedicated status is the basis of a section 16 application, so this is part of the case rather than an extra. The certificate itself — the one with your dedicated number on it.',
  // ⚠️ THE ONE THE ACT ACTUALLY NAMES. Section 16(2) requires "a sworn
  // statement or solemn declaration from the chairperson of an accredited
  // hunting association or sports-shooting organisation, or someone delegated
  // in writing by him or her, stating that the applicant is a registered
  // member". That is this letter, and without it the application is missing a
  // statutory element rather than a nice-to-have.
  GOOD_STANDING_LETTER:
    'Section 16 asks for a sworn declaration from your association that you are a registered member in good standing. This is that letter — it has its own issue date and expiry, so check it has not run out.',
  // ⚠️ NOT A REQUIREMENT OF THE ACT, and the copy must not imply it is. The
  // endorsement comes from the Hunters Forum guidelines of 2 September 2005;
  // associations issue it and DFOs expect it, which is why we collect it.
  ASSOCIATION_ENDORSEMENT:
    'Your association confirms that this particular firearm — its type, calibre, make, action and serial — suits the discipline you are dedicated in. The Act does not list it, but a DFO will insist on it, so treat it as part of the pack. Ask your association for it once you know which firearm you are applying for. It does not replace your own motivation.',
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
  // ⚠️ "SAPS ASKS FOR TWO" WAS FALSE, AND THIS SURFACE MADE IT WORSE THAN
  // THE CHECKLIST'S VERSION. The frontend renders this group under the
  // heading "Not asked for — but they make the case", so an applicant read
  // "Not asked for" and then, directly beneath it, "SAPS asks for two".
  //
  // Neither SAPS list for a NEW licence mentions references. Two testimonials
  // appear only on the SAPS 517(g) competency RENEWAL. The two-year rule
  // appears nowhere at all. What the Regulations DO prescribe is the content
  // — reg 13(7)(a)-(c) — which is far more use to a referee than a number.
  //
  // ⚠️ AND SINCE 2026-08-21 THE PACK CONTAINS THE FORM ITSELF, so this row no
  // longer tells the applicant to brief the referee on the three points. It
  // tells them where the two blank forms are. A checklist that asks you to
  // explain regulation 13(7) to a friend, in a pack that already asks the
  // three questions on a printed page, sends people off to do work we have
  // already done for them.
  CHARACTER_REFERENCE:
    'Not on SAPS’s list for a new licence, but a strong pack usually carries one or two. Your pack has two blank reference forms near the back — they already ask the three things regulation 13(7) requires a referee to state. Print them and give one each to two people who know you, ideally in different parts of your life, such as an employer and a neighbour. They fill them in and sign them themselves; you must not complete any part of them. Upload the signed forms here when you get them back.',
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
  const expected = [...(EXPECTED[licenceType] ?? [])];
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

  // ── the safe: one line, three photographs ────────────────────────
  const SAFE_SHOTS: MotivationUploadKind[] = [
    'SAFE_PHOTO_CLOSED',
    'SAFE_PHOTO_AJAR',
    'SAFE_PHOTO_BOLTS',
  ];
  const safeParts = SAFE_SHOTS.map((kind) => ({
    kind,
    label: LABELS[kind],
    have: have.has(kind),
  }));
  const collapse = (kinds: MotivationUploadKind[]): MotivationUploadKind[] => {
    const out: MotivationUploadKind[] = [];
    let placed = false;
    for (const k of kinds) {
      if (SAFE_SHOTS.includes(k)) {
        if (!placed) {
          placed = true;
          out.push('SAFE_PHOTO_CLOSED');
        }
        continue;
      }
      out.push(k);
    }
    return out;
  };
  const needOf = (kind: MotivationUploadKind, tier: DocumentTier) => {
    if (kind === 'SAFE_PHOTO_CLOSED') {
      return {
        kind,
        label: 'Photographs of your safe',
        tier,
        why: SAFE_WHY,
        // ⚠️ ALL THREE, OR IT IS NOT DONE. One photograph of a closed door
        // shows neither the lock nor the bolts, and a line that went green on
        // it would be telling somebody their pack is complete when a DFO will
        // send them back for the other two.
        have: safeParts.every((p) => p.have),
        parts: safeParts,
      };
    }
    return {
      kind,
      label: LABELS[kind],
      tier,
      why: WHY[kind] ?? '',
      have: have.has(kind),
    };
  };

  const needs: DocumentNeed[] = [
    ...collapse(required).map((k) => needOf(k, 'required')),
    ...collapse(expected).map((k) => needOf(k, 'expected')),
    ...collapse(strengthens).map((k) => needOf(k, 'strengthens')),
  ];

  // Anything uploaded that we never asked for. Accepted and lettered like the
  // rest — an applicant who wants to attach a range record or a letter from
  // their farm manager should never be told it does not belong.
  const asked = new Set<MotivationUploadKind>([
    ...SAFE_SHOTS,
    ...required,
    ...expected,
    ...strengthens,
  ]);
  const extras = uploaded.filter((k) => !asked.has(k));

  return {
    needs,
    missingRequired: required.filter((k) => !have.has(k)),
    extras: [...new Set(extras)],
    // ⚠️ THE COUNTER STAYS ABOUT REQUIRED ONLY. "6 of 7" has to mean the
    // things SAPS will not process without — folding the endorsement in would
    // make a complete pack read as incomplete, and folding it in silently
    // would make the number mean something different from what it says.
    // ⚠️ COUNTED OFF THE COLLAPSED LIST, so the number matches the rows the
    // member can see. Counting the three safe shots separately while showing
    // one line for them would read as "5 of 7" beside five visible rows.
    requiredTotal: collapse(required).length,
    requiredHave: collapse(required)
      .map((k) => needOf(k, 'required'))
      .filter((n) => n.have).length,
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

  // ⚠️ THE CHECKLIST COLLAPSES THE SAFE; THE PICKER MUST NOT. The checklist
  // shows one row because the safe is one object — but a file still has to be
  // filed as the closed shot, the half-open shot or the bolts shot
  // SPECIFICALLY, because nothing on the stored row records which is which.
  // Collapsing here would leave two of the three unfileable, and the member
  // holding a photograph of open roll bolts with nowhere to put it.
  const expand = status.needs.flatMap((n) =>
    n.parts
      ? n.parts.map((p) => ({ kind: p.kind, label: p.label, tier: n.tier, have: p.have }))
      : [{ kind: n.kind, label: n.label, tier: n.tier, have: n.have }],
  );
  const ranked = new Map<MotivationUploadKind, DocumentTier>(
    expand.map((n) => [n.kind, n.tier]),
  );

  const rest = (Object.keys(LABELS) as MotivationUploadKind[]).filter(
    (k) => !ranked.has(k) && !RETIRED.includes(k),
  );

  const have = new Set(uploaded);

  return [
    ...expand.map((n) => ({
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
