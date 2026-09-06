import { MotivationUploadKind } from '@prisma/client';
import type { Endorsement } from '../common/sa-competency';
import { competencyCovers } from './motivation-upload-row';

// ────────────────────────────────────────────────────────────────────
// ATTACHING WHAT THE MEMBER ALREADY HAS, WITHOUT ASKING.
//
// Operator, 2026-08-24: "When I have all my documents already in the Document
// Centre, why can't the server add the relevant documents in place and mark
// them green for me?" — and the routing spec §6.2, which says vault slots are
// auto-filled at generator open, showing which document was picked and why.
//
// The suggestion machinery already existed and stopped one step short. It also
// only ever fired for section 16 and only for two kinds, so a self-defence
// applicant with a full Document Centre was offered nothing at all. That was
// not a considered rule — only the S16 list was ever written.
//
// ⚠️ WHAT MAKES THIS SAFE IS THE LIST OF THINGS IT REFUSES TO DO. Attaching a
// document to somebody's licence application is a decision about what a DFO
// will see, and the one time it is wrong they find out at the counter. So:
//
//   NEVER a document that describes a FIREARM or a TRANSACTION. An association
//   endorsement names ONE firearm, so a previous application's endorsement
//   describes the wrong gun. A licence, a source proof, a consent — all name a
//   specific firearm or deal. Only documents about the PERSON qualify, because
//   the person has not changed since last time.
//
//   NEVER when there is more than one candidate. Three competency
//   certificates, and picking one is a choice we are not entitled to make
//   silently. Ambiguity goes back to the member as a suggestion.
//
//   NEVER a document that is about to expire. Ninety days, the operator's
//   number: SAPS takes months, so a letter of good standing with three weeks
//   left is one the DFO rejects long before a decision.
//
//   NEVER without consent. Attaching from the vault is new automatic
//   processing and needs a yes, not an absence of no.
//
// Everything that fails a rule still appears in the library for the member to
// attach deliberately, having seen the date. Nothing is hidden — it is only
// not done ON THEIR BEHALF.
// ────────────────────────────────────────────────────────────────────

/**
 * Documents that describe the PERSON, and are therefore safe to attach unasked.
 *
 * ⚠️ THE TEST IS "WOULD A DIFFERENT FIREARM CHANGE THIS DOCUMENT?" If yes it
 * is not on this list, whatever else is true of it. An ID is the same ID for
 * every application; an endorsement is not.
 *
 * ⚠️ SAFE PHOTOGRAPHS ARE DELIBERATELY ABSENT, AND I NEARLY GOT THIS WRONG.
 * A safe looks like a person-document — a fixed installation, nothing to do
 * with which firearm is applied for. But addFromLibrary already REQUIRES an
 * explicit "these are the safe at the address on this application" for exactly
 * these kinds (see asksPlace), because a member who has moved house and reuses
 * last year's shots ships a pack showing the wrong premises. That is a
 * question only they can answer, so it cannot be answered on their behalf,
 * which is what auto-attaching would do. They stay a suggestion.
 *
 * ⚠️ M6 — THE QUESTION IS NOW ASKED RATHER THAN ASSUMED. `placeConfirmed`
 * admits them, and the answer must come from the member on this application:
 * see AutolinkOptions. Nothing about the rule has softened — the default is
 * unchanged, and without the tick they are still only a suggestion.
 */
export const AUTOLINK_KINDS: readonly MotivationUploadKind[] = [
  MotivationUploadKind.IDENTITY_DOCUMENT,
  MotivationUploadKind.ADDRESS_CONFIRMATION,
  MotivationUploadKind.COMPETENCY_CERTIFICATE,
  MotivationUploadKind.PROFICIENCY_CERTIFICATE,
  MotivationUploadKind.ASSOCIATION_CARD,
  MotivationUploadKind.GOOD_STANDING_LETTER,
  MotivationUploadKind.EMPLOYMENT_CONFIRMATION,
];

/**
 * Documents that must NEVER be attached unasked, with the reason.
 *
 * Kept as an explicit list rather than "everything not above", so adding a new
 * upload kind forces a decision instead of defaulting into either behaviour.
 */
export const NEVER_AUTOLINK: Partial<Record<MotivationUploadKind, string>> = {
  ASSOCIATION_ENDORSEMENT:
    'names one specific firearm, so an older one describes the wrong gun',
  CURRENT_LICENCE:
    'names one specific firearm, and which licences are relevant is the applicant’s to say',
  FIREARM_SOURCE_PROOF: 'is about this purchase, not about the applicant',
  SELLER_LICENCE: 'belongs to the seller of this particular firearm',
  EXECUTOR_APPOINTMENT: 'is about one estate and one deceased person',
  INCIDENT_REPORT:
    'is evidence the applicant chose to raise; attaching it unasked decides for them what their case is',
  CHARACTER_REFERENCE:
    'is written for one application by somebody who agreed to write it',
  SHOOTING_ACTIVITY_LOG:
    'must be current and specific to this application (routing spec §5.1: DIRECT)',
  PREVIOUS_MOTIVATION: 'is a past document, not evidence for this one',
  OTHER: 'is whatever the member decided it was; we cannot know where it goes',
  // ⚠️ M6 — THE ONE ENTRY THAT IS A QUESTION RATHER THAN A REFUSAL. Pass
  // placeConfirmed and it is attachable; the skip reason says so, so the member
  // is told what to do instead of being told there is nothing they can do.
  SAFE_PHOTOGRAPHS:
    'needs the member to confirm it is the safe at THIS application’s address — see asksPlace; somebody who has moved would otherwise ship a pack showing the wrong premises',
};

/** How much validity a document needs before it is attached unasked. */
export const AUTOLINK_MIN_DAYS = 90;

export interface AutolinkCandidate {
  /** Library item id — a credential or an upload on another application. */
  sourceId: string;
  source: 'credential' | 'upload';
  kind: MotivationUploadKind;
  /** Printed on the document, where we hold it. */
  expiresOn: string | null;
  /** What the member calls it, for the "we attached this" line. */
  title: string;
  /**
   * A competency certificate's own "covers" wording, as read off it.
   *
   * ⚠️ H10. Grouping by KIND alone meant a handgun-only competency was
   * attached, unasked, to a rifle application — and a licence application in a
   * firearm type the competency does not cover is refused before it is
   * considered. The endorsements were readable the whole time; nothing asked.
   */
  covers?: string;
}

export type SkipReason =
  | 'not-a-person-document'
  | 'expiring-too-soon'
  | 'several-candidates'
  | 'already-attached'
  /** The competency does not cover the firearm this application is for. */
  | 'endorsement-mismatch'
  /** Photographs of a safe, and nobody has confirmed it is THIS address. */
  | 'needs-place-confirm';

export interface AutolinkDecision {
  attach: AutolinkCandidate[];
  /** Everything considered and not attached, with why — never silent. */
  skipped: { candidate: AutolinkCandidate; why: SkipReason }[];
  /**
   * Photographs of the safe are sitting in the vault, wanted by this
   * application, and were not attached because nobody has said they are the
   * safe at THIS address.
   *
   * ⚠️ IT IS A QUESTION FOR THE MEMBER, NOT A FAILURE. M6. Answering it is one
   * tick and a second call with placeConfirmed — see the note on
   * SAFE_PHOTOGRAPHS in NEVER_AUTOLINK for why it cannot be answered for them.
   */
  needsPlaceConfirm: boolean;
}

export interface AutolinkOptions {
  /**
   * The endorsement this application's firearm needs, or null when the
   * applicant has not described the firearm yet.
   *
   * ⚠️ NULL DISABLES THE TEST RATHER THAN FAILING IT. We refuse a certificate
   * only when we have read its endorsements AND they demonstrably exclude what
   * is needed — see competencyCovers.
   */
  needed?: Endorsement | null;
  /**
   * "These are the safe at the address on this application."
   *
   * ⚠️ THE ONLY THING THAT LETS A SAFE PHOTOGRAPH THROUGH, and it must come
   * from the member. A member who has moved house and reuses last year's shots
   * ships a pack showing the wrong premises, and nothing on the file says so.
   */
  placeConfirmed?: boolean;
}

function daysLeft(expiresOn: string | null, today: Date): number | null {
  if (!expiresOn) return null;
  const end = Date.parse(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(end)) return null;
  return (end - today.getTime()) / 86_400_000;
}

/**
 * Decide what to attach, from what the member holds and what this application
 * still wants.
 *
 * Pure: no clock, no database, no consent lookup. The caller establishes
 * consent and supplies `today`, which is what makes every rule here testable
 * against a fixed date.
 *
 * @param wanted  kinds this licence type actually asks for. A document we do
 *                not need is never attached, however valid — a pack padded
 *                with documents nobody asked for is a pack a DFO has to read
 *                through to find the ones that matter.
 */
export function decideAutolink(
  candidates: readonly AutolinkCandidate[],
  wanted: readonly MotivationUploadKind[],
  alreadyHave: readonly MotivationUploadKind[],
  today: Date,
  opts: AutolinkOptions = {},
): AutolinkDecision {
  const attach: AutolinkCandidate[] = [];
  const skipped: { candidate: AutolinkCandidate; why: SkipReason }[] = [];
  let needsPlaceConfirm = false;

  const wantedSet = new Set(wanted);
  const haveSet = new Set(alreadyHave);

  /**
   * The kinds this run may attach.
   *
   * ⚠️ SAFE PHOTOGRAPHS JOIN THE LIST ONLY ON AN EXPLICIT YES. M6, and it is
   * the same tick addFromLibrary has always required — see asksPlace. The
   * default is unchanged: without the tick they stay a suggestion, exactly as
   * the note above AUTOLINK_KINDS describes.
   */
  const allowed = new Set<MotivationUploadKind>(AUTOLINK_KINDS);
  if (opts.placeConfirmed) allowed.add(MotivationUploadKind.SAFE_PHOTOGRAPHS);

  // Group by kind FIRST: the several-candidates rule is about the kind, not
  // about any one document, and can only be seen from the whole set.
  const byKind = new Map<MotivationUploadKind, AutolinkCandidate[]>();
  for (const c of candidates) {
    if (!wantedSet.has(c.kind)) continue;
    (byKind.get(c.kind) ?? byKind.set(c.kind, []).get(c.kind)!).push(c);
  }

  for (const [kind, group] of byKind) {
    if (haveSet.has(kind)) {
      for (const c of group) skipped.push({ candidate: c, why: 'already-attached' });
      continue;
    }
    if (!allowed.has(kind)) {
      // ⚠️ SAID AS A QUESTION, NOT AS A REFUSAL. A safe photograph is not
      // "not a person document" — it is one tick away from being attachable,
      // and reporting it under the same reason as an association endorsement
      // would tell the member there is nothing they can do about it.
      const asksPlace = kind === MotivationUploadKind.SAFE_PHOTOGRAPHS;
      if (asksPlace) needsPlaceConfirm = true;
      for (const c of group) {
        skipped.push({
          candidate: c,
          why: asksPlace ? 'needs-place-confirm' : 'not-a-person-document',
        });
      }
      continue;
    }

    // ⚠️ THE ENDORSEMENT TEST RUNS BEFORE THE COUNT, AND THAT IS THE POINT.
    // H10. A member holding a handgun certificate and a rifle certificate has
    // TWO competency candidates, which the several-candidates rule below would
    // refuse as an ambiguity — when in fact only one of them can lawfully back
    // this application, so there is no ambiguity to protect them from.
    // Filtering first turns an unanswerable question into an answer.
    const covered = group.filter((c) =>
      c.kind === MotivationUploadKind.COMPETENCY_CERTIFICATE
        ? competencyCovers(c.covers ?? '', opts.needed ?? null)
        : true,
    );
    for (const c of group) {
      if (!covered.includes(c)) {
        skipped.push({ candidate: c, why: 'endorsement-mismatch' });
      }
    }
    if (!covered.length) continue;

    const fresh = covered.filter((c) => {
      const left = daysLeft(c.expiresOn, today);
      // No expiry is not staleness — an ID copy has none.
      return left === null || left >= AUTOLINK_MIN_DAYS;
    });
    for (const c of covered) {
      if (!fresh.includes(c)) skipped.push({ candidate: c, why: 'expiring-too-soon' });
    }
    if (!fresh.length) continue;

    // ⚠️ ONE OR NOTHING. Two valid competency certificates is a question for
    // the member, not a coin toss — and the wrong one in front of a DFO is
    // exactly the failure that makes automation untrustworthy.
    if (fresh.length > 1) {
      for (const c of fresh) skipped.push({ candidate: c, why: 'several-candidates' });
      continue;
    }
    attach.push(fresh[0]);
  }

  return { attach, skipped, needsPlaceConfirm };
}
