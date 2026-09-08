import { Endorsement, endorsementDisplay } from '../common/sa-competency';
import type { MandatoryKnowledge } from '../common/sa-proficiency-cover';

// ────────────────────────────────────────────────────────────────────
// COMPETENCY AND PROFICIENCY, AS ONE PAIR.
//
// Operator, 2026-09-08: "the proficiency needs to be added with the competency
// from the same category. One can't be without the other."
//
// ⚠️ THEY ARE TWO DOCUMENTS AND ONE FACT, and every surface that has treated
// them as two independent rows has been wrong about the same thing. The SAPS
// competency certificate is the OUTCOME; the training provider's statement of
// results is the EVIDENCE that produced it, and a DFO asks for both. A member
// who attaches only the certificate is not half done — they are going to be
// turned away — and a member who attaches only the statement has attached
// something SAPS does not accept on its own.
//
// ⚠️ AND THEY MUST BE THE SAME CLASS. H10: auto-link grouped competency
// candidates by KIND and nothing else, so a handgun-only competency was
// attached, unasked, to a rifle application. `motivation-autolink.ts` fixed
// the ATTACHING. This module is what makes the pair VISIBLE — the operator
// asked for a proficiency section twice and got a server-side rule both
// times, which is a fix nobody can see.
//
// ⚠️ WHAT THIS IS NOT: it is not a second opinion on whether the competency
// covers the firearm. `requiredEndorsement()` decides that, upstream, and its
// answer arrives here as `needed`. Recomputing it would give the sheet a rule
// that could disagree with the one that gates generation.
//
// PURE — no Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

/** The two kinds this section is about. Nothing else may appear in it. */
export type CredentialSlotKind =
  | 'COMPETENCY_CERTIFICATE'
  | 'PROFICIENCY_CERTIFICATE';

/** One page of this kind, already attached to this application. */
export interface CredentialHeld {
  /** Annexure letter, or null before the pack is lettered. */
  letter: string | null;
  /**
   * Where the page came from.
   *
   * ⚠️ THE SAME `origin` THE SHELF SHOWS, derived from `sourceCredentialId`.
   * The member is told once, in one vocabulary, wherever a document appears.
   */
  origin: 'vault' | 'member';
  /** True when we could not read it. Gold, never red — see SheetDocument. */
  unread: boolean;
}

export interface CredentialSlot {
  kind: CredentialSlotKind;
  /** The document's name, in the member's words. */
  label: string;
  /** One line, saying what this document is for. */
  blurb: string;
  held: CredentialHeld[];
  /**
   * How many documents of this kind the Document Centre holds that are NOT
   * already on this application.
   *
   * ⚠️ A COUNT, NOT A LIST, AND DELIBERATELY. The list is `GET :id/library`,
   * which folds a two-page proficiency into one entry and hides what is
   * already here — machinery this endpoint has no business duplicating. The
   * count decides whether the "Add from your Licence Centre" door is offered
   * at all; opening it fetches the real list.
   */
  inCentre: number;
}

export interface SheetCredentials {
  /**
   * The class this application needs — "Handgun", "Manual Rifle" — or null
   * when the firearm has not been described well enough to say.
   *
   * ⚠️ THE `display` WORDING, NOT `label`, AND THE CHOICE IS LOAD-BEARING.
   * `label` for a bolt-action rifle is "Rifle or carbine - manually operated";
   * `display` is "Competency - Manual Rifle", and it is what
   * derivedCredentialTitle names the member's own vault rows with. Two
   * vocabularies for one class means the screen calling it one thing while the
   * document list beside it calls it another — and a caller trying to rank the
   * matching certificate to the top of that list matches nothing.
   */
  neededLabel: string | null;
  competency: CredentialSlot;
  proficiency: CredentialSlot;
  /**
   * Unit standard 117705, read across everything the member has ever given us.
   *
   * ⚠️ 'UNREAD' IS NOT 'MISSING'. See sa-proficiency-cover: a photograph at an
   * angle and a course somebody never did look identical to a per-document
   * check, and only one of them is an accusation.
   */
  knowledge: { state: MandatoryKnowledge; alert: string | null };
  /**
   * The pair rule, in one sentence, or null when there is nothing to say.
   *
   * ⚠️ IT IS THE POINT OF THE SECTION. Everything else here a member could
   * work out from the shelf; this is the sentence that tells them the half
   * they have is not enough.
   */
  pairNote: string | null;
}

const LABELS: Record<CredentialSlotKind, string> = {
  COMPETENCY_CERTIFICATE: 'SAPS competency certificate',
  PROFICIENCY_CERTIFICATE: 'Proficiency — statement of results',
};

const BLURBS: Record<CredentialSlotKind, string> = {
  COMPETENCY_CERTIFICATE:
    'The certificate SAPS issued you, for the class of firearm you are applying for.',
  PROFICIENCY_CERTIFICATE:
    'The training provider’s statement of results behind that competency. A DFO asks for both.',
};

export interface CredentialSlotsInput {
  /** From requiredEndorsement(answers). Null when the firearm is unclear. */
  needed: Endorsement | null;
  /** Everything on this application, of any kind. Filtered here. */
  attached: {
    kind: string;
    letter: string | null;
    origin: 'vault' | 'member';
    unread: boolean;
  }[];
  /** Document Centre holdings of each kind, already folded and de-duplicated. */
  inCentre: Record<CredentialSlotKind, number>;
  knowledge: { state: MandatoryKnowledge; alert: string | null };
}

/**
 * The pair sentence.
 *
 * ⚠️ FOUR STATES, AND ONLY TWO OF THEM SAY ANYTHING. Both present is a
 * finished job and needs no line — the slots already show two annexures.
 * Neither present is not a pair problem, it is an empty section, and the two
 * slots each say so in their own words; a third voice repeating it is the
 * "argues with itself" failure the Competency blurb was rewritten for.
 */
function pairNoteFor(
  comp: number,
  prof: number,
  neededLabel: string | null,
): string | null {
  const cls = neededLabel ? `${neededLabel.toLowerCase()} ` : '';
  if (comp > 0 && prof === 0) {
    return `Your ${cls}competency is here. SAPS will want the statement of results that goes with it — one is not accepted without the other.`;
  }
  if (prof > 0 && comp === 0) {
    return `Your ${cls}statement of results is here. On its own it is not a competency — SAPS wants the certificate they issued you as well.`;
  }
  return null;
}

export function credentialSlots(
  input: CredentialSlotsInput,
): SheetCredentials {
  // The class alone: the vault prints "Competency - Handgun" / "Proficiency -
  // Handgun", and the prefix is the document kind, which the slot already says.
  const neededLabel = input.needed
    ? (endorsementDisplay(input.needed)?.replace(/^Competency - /, '') ?? null)
    : null;

  const slot = (kind: CredentialSlotKind): CredentialSlot => ({
    kind,
    label: LABELS[kind],
    blurb: BLURBS[kind],
    held: input.attached
      .filter((a) => a.kind === kind)
      .map((a) => ({ letter: a.letter, origin: a.origin, unread: a.unread })),
    // ⚠️ NEVER NEGATIVE. The count is supplied by a query that knows nothing
    // about this application; a member who attached their only certificate
    // must read "nothing else saved", not "-1".
    inCentre: Math.max(0, input.inCentre[kind] ?? 0),
  });

  const competency = slot('COMPETENCY_CERTIFICATE');
  const proficiency = slot('PROFICIENCY_CERTIFICATE');

  return {
    neededLabel,
    competency,
    proficiency,
    knowledge: input.knowledge,
    pairNote: pairNoteFor(
      competency.held.length,
      proficiency.held.length,
      neededLabel,
    ),
  };
}
