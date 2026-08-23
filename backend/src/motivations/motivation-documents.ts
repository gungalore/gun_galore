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
   * How many FILES this line wants before it counts as done. Absent means one.
   *
   * ⚠️ THE SAFE IS ONE THING AND SEVERAL PHOTOGRAPHS, and this is what stops
   * one of them ticking the box. It used to be enforced by making each shot
   * its own KIND — which enforced it exactly, and cost more than it was worth:
   * nothing could reliably tell the shots apart, so the classifier was pinned
   * to low confidence on all four and a wrong tap filed the bolts shot under
   * the closed-door annexure.
   *
   * ⚠️ AND BE HONEST ABOUT WHAT COUNTING PROVES: nothing on a stored row says
   * which shot a photograph is, so three pictures of the same shut door count
   * as three. It is a prompt, not a proof. The four-kind scheme was not a proof
   * either — a member could file any photograph under any of the four — so this
   * gives up an appearance of rigour rather than the thing itself, and it gives
   * up nothing at all on the guidance, which still names every shot.
   */
  minFiles?: number;
  /**
   * One short line naming what a multi-file row still wants.
   *
   * ⚠️ IT EXISTS BECAUSE `why` IS ONLY RENDERED ON THE SELECTED ROW. The shots
   * the safe wants have to be readable without selecting anything — which is
   * the one thing the four separate menu entries did for free, and the thing
   * most easily lost by collapsing them.
   */
  minFilesNote?: string;
}

/**
 * How many photographs of the safe the row wants before it goes green.
 *
 * THREE, because that is what the operator's own list asks for and what a DFO
 * looks for: closed, half open with the key in the door, open with the roll
 * bolts visible. The anchoring shot is a fourth and is not counted against
 * this — it is asked for in the help text and welcomed, never demanded.
 */
export const SAFE_PHOTO_MIN = 3;

/**
 * What SAPS will not process the application without.
 *
 * Deliberately short. Everything on it appears on the official checklist, and
 * anything we are unsure of belongs in `strengthens` instead — being wrong
 * about a requirement sends someone to a counter to be turned away.
 */
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
    'SAFE_PHOTOGRAPHS',
  ],
  S15_OCCASIONAL_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTOGRAPHS',
  ],
  // Dedicated status IS the basis of a section 16 application, so proof of
  // membership stops being a nicety and becomes part of the case.
  S16_DEDICATED_HUNTER: [
    'IDENTITY_DOCUMENT',
    'COMPETENCY_CERTIFICATE',
    'ADDRESS_CONFIRMATION',
    'SAFE_PHOTOGRAPHS',
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
    'SAFE_PHOTOGRAPHS',
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
    'SAFE_PHOTOGRAPHS',
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
  SAFE_PHOTOGRAPHS: 'Photographs of your safe',
  // ── retired 2026-08-23, never offered ────────────────────────────────
  // Kept so a row written before the collapse still has a name in the file
  // list and the annexure index. Postgres cannot drop an enum value.
  SAFE_PHOTO_CLOSED: 'Your safe, closed',
  SAFE_PHOTO_AJAR: 'Your safe, half open with the key in the door',
  SAFE_PHOTO_BOLTS: 'Your safe, fully open showing the roll bolts',
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
 * ⚠️ IT STILL NAMES EVERY SHOT, AND THAT IS THE POINT OF IT. The kinds
 * collapsed on 2026-08-23; the instruction did not. Each shot shows something
 * the others cannot, and an applicant who reads "photographs of your safe" and
 * sends one has satisfied the phrase while the pack is short two photographs
 * nobody noticed — so the text does the work the four menu entries used to
 * pretend to do, and does it in the one place the member is actually reading.
 *
 * ⚠️ DO NOT TRIM THE BOLTS SENTENCE. Losing "photograph the bolts" would be a
 * real regression dressed up as tidying: it is the shot that shows the thing is
 * a safe rather than a cupboard, and it is what a DFO goes looking for.
 */
const SAFE_SHOTS_NOTE =
  'Closed, half open with the key in the door, and open showing the roll bolts.';

const SAFE_WHY =
  'Take three, and add them all on this line: the safe closed with the key out of it, half open with the key in the door, and fully open so the roll bolts are visible. The closed shot shows the unit, the half-open shot shows the lock belongs to it, and the bolts are what make it a safe rather than a cupboard — a DFO looks for all three. A fourth is worth adding if you can: how the safe is bolted to the wall or floor, which no photograph of the door shows. The safe is checked twice over — the photographs go in the pack, and regulation 13(12) makes compliant storage a condition of the licence being ISSUED, so the DFO also inspects your premises before it comes through.';

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
  // ⚠️ THE SAFE'S OWN TEXT IS SAFE_WHY, NOT AN ENTRY HERE. needOf() reaches
  // for it directly, because it is the one line that stands for several
  // photographs and has to name each of them.
  //
  // ── retired 2026-08-23, kept for rows written before the collapse ─────
  SAFE_PHOTO_CLOSED:
    'The safe as it stands in the room, shut, with the key out of it. This is the shot that shows the unit itself.',
  SAFE_PHOTO_AJAR:
    'Half open with the key in the door. It shows the lock belongs to this safe and that the key turns it — a closed door on its own shows neither.',
  SAFE_PHOTO_BOLTS:
    'Door fully open so the roll bolts are visible. The bolts are what make it a safe rather than a cupboard, and a DFO looks for them.',
  SAFE_PHOTO:
    'Added before the safe photographs became one line. It stays in your pack as supporting evidence.',
  SAFE_INSTALLATION:
    'How the safe is anchored to the wall or floor. Added before the safe photographs became one line; it stays in your pack.',
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
  // ⚠️ AND SINCE 2026-08-21 THERE IS NOTHING TO UPLOAD HERE AT ALL. Witnesses
  // complete and sign on their own phones from a link the applicant sends —
  // operator: "Only use the link" — so the statement arrives signed and prints
  // itself into the pack. Telling somebody to chase a paper form they will
  // never be handed is worse than saying nothing.
  CHARACTER_REFERENCE:
    'You do not need to upload these. Two people who know you complete a statement from a link we SMS them, and it prints into your pack signed — set that up here.',
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
 * ⚠️ `uploaded` IS ONE ENTRY PER FILE, NOT A SET OF KINDS, and since
 * 2026-08-23 that matters. Most needs are satisfied by set membership — one ID
 * copy is an ID copy — but the safe is one kind holding several photographs,
 * and it is satisfied by COUNT. Both callers already pass a per-row list
 * (`row.uploads.flatMap(u => [u.kind, ...u.coversKinds])`), so nothing had to
 * change to make the count available; deduplicating it here would silently
 * break the safe row.
 */
export function documentStatus(
  licenceType: MotivationLicenceType,
  uploaded: MotivationUploadKind[],
  answers: Record<string, string> = {},
): DocumentStatus {
  const counts = new Map<MotivationUploadKind, number>();
  for (const k of uploaded) counts.set(k, (counts.get(k) ?? 0) + 1);
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

  // ── the safe: one line, several photographs ───────────────────────
  //
  // ⚠️ ALL THREE, OR IT IS NOT DONE. One photograph of a closed door shows
  // neither the lock nor the bolts, and a line that went green on it would be
  // telling somebody their pack is complete when a DFO will send them back for
  // the other two. Before 2026-08-23 that was enforced by three separate KINDS;
  // it is now enforced by counting files, which is weaker in theory and no
  // weaker in practice — see minFiles on DocumentNeed.
  const minFilesFor = (kind: MotivationUploadKind): number =>
    kind === 'SAFE_PHOTOGRAPHS' ? SAFE_PHOTO_MIN : 1;
  const satisfied = (kind: MotivationUploadKind): boolean =>
    (counts.get(kind) ?? 0) >= minFilesFor(kind);

  const needOf = (
    kind: MotivationUploadKind,
    tier: DocumentTier,
  ): DocumentNeed => {
    const min = minFilesFor(kind);
    return {
      kind,
      label: LABELS[kind],
      tier,
      // The safe's text has to name every shot, so it lives apart from WHY.
      why: kind === 'SAFE_PHOTOGRAPHS' ? SAFE_WHY : (WHY[kind] ?? ''),
      have: satisfied(kind),
      ...(min > 1
        ? { minFiles: min, minFilesNote: SAFE_SHOTS_NOTE }
        : {}),
    };
  };

  const needs: DocumentNeed[] = [
    ...required.map((k) => needOf(k, 'required')),
    ...expected.map((k) => needOf(k, 'expected')),
    ...strengthens.map((k) => needOf(k, 'strengthens')),
  ];

  // Anything uploaded that we never asked for. Accepted and lettered like the
  // rest — an applicant who wants to attach a range record or a letter from
  // their farm manager should never be told it does not belong.
  const asked = new Set<MotivationUploadKind>([
    'SAFE_PHOTOGRAPHS',
    ...required,
    ...expected,
    ...strengthens,
  ]);
  const extras = uploaded.filter((k) => !asked.has(k));

  return {
    needs,
    // ⚠️ THE SAME RULE AS THE ROW, not a bare set test. With two of the three
    // safe photographs in, `have.has` is true while the row is still amber —
    // and the frontend prints "You have everything SAPS asks for" the moment
    // this list empties, directly above a counter reading 4 of 5.
    missingRequired: required.filter((k) => !satisfied(k)),
    extras: [...new Set(extras)],
    // ⚠️ THE COUNTER STAYS ABOUT REQUIRED ONLY. "6 of 7" has to mean the
    // things SAPS will not process without — folding the endorsement in would
    // make a complete pack read as incomplete, and folding it in silently
    // would make the number mean something different from what it says.
    requiredTotal: required.length,
    requiredHave: required.filter((k) => satisfied(k)).length,
  };
}

/** Human label for any kind, including the ones nobody asked for. */
export function documentLabel(kind: MotivationUploadKind): string {
  return LABELS[kind] ?? 'Supporting document';
}

/**
 * Kinds RETIRED from the picker: they exist only so a row written before the
 * kind was retired keeps a label and an annexure letter. Postgres cannot drop
 * an enum value, so "retired" has to mean "never offered" rather than "gone".
 *
 * ⚠️ ALL FIVE SAFE KINDS, as of 2026-08-23. SAFE_INSTALLATION was on this list
 * for an afternoon in August and taken off again, correctly at the time: the
 * three shots the operator asked for were all of the safe's DOOR, so the
 * anchoring shot had nowhere else to go. It has somewhere now —
 * SAFE_PHOTOGRAPHS takes every photograph of the safe, and SAFE_WHY asks for
 * the anchoring one by name. Retiring the kind does not retire the shot.
 */
export const RETIRED: MotivationUploadKind[] = [
  'SAFE_PHOTO',
  'SAFE_PHOTO_CLOSED',
  'SAFE_PHOTO_AJAR',
  'SAFE_PHOTO_BOLTS',
  'SAFE_INSTALLATION',
];

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
 *
 * ⚠️ ONE ENTRY FOR THE SAFE. It used to expand back out into the three shots
 * here, because a file had to be filed as one of them specifically; there is
 * nothing left to expand into. Operator, 2026-08-23: "I dont like the safe
 * picture being seperate four uploads, looks shit."
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
