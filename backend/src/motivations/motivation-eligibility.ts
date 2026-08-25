import { MotivationLicenceType } from '@prisma/client';
import {
  type CompetencyCategory,
  type Endorsement,
  ENDORSEMENTS,
  endorsementFromLabel,
  type LicenceSection,
  sectionAllows,
} from '../common/sa-competency';

// ────────────────────────────────────────────────────────────────────
// CAN THIS FIREARM BE LICENSED UNDER THIS SECTION, BY THIS APPLICANT?
//
// Operator's document-routing spec §3 and §6.1: enforce the hard constraints
// BEFORE routing starts, and "if the selected firearm violates the selected
// application type, block the generator with a specific message. Do not
// silently continue."
//
// ⚠️ THE RULES WERE ALREADY WRITTEN AND HAD NO CALLERS. sectionAllows() has
// been in common/sa-competency since the competency work, fully tested, and
// nothing ever asked it anything. So an applicant could describe a
// self-loading rifle, pick section 13, and be walked all the way to a finished
// pack for an application that cannot be granted — the Act does not permit a
// rifle under section 13 at all.
//
// ⚠️ AND A BLOCK HERE IS A KINDNESS, NOT AN OBSTRUCTION. The alternative is
// not "they get their licence anyway"; it is a refusal from the Registrar
// months later, after the fee, the fingerprints and the wait. Every message
// below names the section that WOULD work, because being told "no" without
// being told "this instead" is the part that wastes somebody's year.
//
// ⚠️ NEVER SILENT, AND NEVER GUESSED. A blocker fires only on facts the
// applicant has actually stated. An unanswered action or an unanswered
// competency yields NO blocker — we do not refuse somebody for a box they
// have not reached yet.
// ────────────────────────────────────────────────────────────────────

export interface Blocker {
  /** Stable code, for the client to key behaviour off. */
  code: 'section-forbids-firearm' | 'competency-missing-endorsement';
  /** The field the applicant should be sent to. */
  field: string;
  /** Said to the applicant, naming the way forward. */
  message: string;
}

/** Which statutory section a licence type applies under. */
function sectionOf(t: MotivationLicenceType): LicenceSection | null {
  switch (t) {
    case 'S13_SELF_DEFENCE':
      return 'S13';
    case 'S15_OCCASIONAL_HUNTER':
      return 'S15';
    case 'S16_DEDICATED_HUNTER':
    case 'S16_DEDICATED_SPORT':
      return 'S16';
    // ⚠️ A RENEWAL INHERITS THE SECTION OF THE LICENCE BEING RENEWED, which we
    // do not hold as a structured value. Guessing S13 or S16 here would refuse
    // a perfectly good renewal, so a renewal is never blocked on this rule.
    case 'S24_RENEWAL':
    default:
      return null;
  }
}

/**
 * The endorsement a firearm needs, from what the applicant said it is.
 *
 * ⚠️ CLASSIFICATION, NOT CALIBRE — spec §3, and the reference calls it out
 * because it is commonly misread: a pistol calibre carbine fires a handgun
 * cartridge and needs the RIFLE endorsement. Our registry asks for the type
 * directly ("Rifle"), so we inherit that correctly for free; the trap only
 * exists for anyone tempted to infer type from the calibre string.
 *
 * Returns null when the applicant has not said enough yet.
 */
/**
 * What the applicant says the firearm IS, in the two terms the Act turns on.
 *
 * ⚠️ THE ACTION IS NOW CARRIED SEPARATELY, and that is the point. Section
 * eligibility turns on whether a firearm is semi-automatic — s13, s14, s15 and
 * s16 each draw the line differently — but the endorsement no longer records
 * it for a handgun or a shotgun, because there is no separate unit standard
 * for either. Reading it off the endorsement was how sectionAllows came to
 * refuse a lawful semi-automatic pistol under s15.
 */
export function firearmShape(
  answers: Record<string, string>,
): { category: CompetencyCategory; selfLoading: boolean } | null {
  const type = (answers.firearm_type ?? '').trim();
  const action = (answers.firearm_action ?? '').trim();
  if (!type || !action) return null;

  // ⚠️ A COMBINATION GUN IS BOTH, so no single category covers it and we
  // must not pick one. Left unresolved rather than half-answered.
  const category: CompetencyCategory | null =
    type === 'Rifle'
      ? 'rifle-carbine'
      : type === 'Shotgun'
        ? 'shotgun'
        : type === 'Handgun'
          ? 'handgun'
          : null;
  if (!category) return null;

  return { category, selfLoading: action === 'Semi-automatic (self-loading)' };
}

export function requiredEndorsement(
  answers: Record<string, string>,
): Endorsement | null {
  const shape = firearmShape(answers);
  if (!shape) return null;

  return (
    ENDORSEMENTS.find(
      (e) =>
        e.category === shape.category && e.selfLoading === shape.selfLoading,
    )?.value ?? null
  );
}

/**
 * Everything standing between this application and a grantable outcome.
 *
 * Empty means nothing we can check is wrong — never that the application will
 * succeed. We check what the Act settles; the Registrar decides the rest.
 */
export function applicationBlockers(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
): Blocker[] {
  const out: Blocker[] = [];
  const needed = requiredEndorsement(answers);
  if (!needed) return out;

  const section = sectionOf(licenceType);

  // ── 1. Does this section permit this firearm at all? ──────────────
  const shape = firearmShape(answers);
  if (section && shape) {
    // ⚠️ THE SHAPE, NOT THE ENDORSEMENT. See firearmShape: the endorsement
    // cannot answer "is it semi-automatic?" for a handgun or a shotgun, and
    // that question is what every one of these sections turns on.
    //
    // ⚠️ AND NO DEFAULT CATEGORY. An earlier draft of this line fell back to
    // 'handgun' when the shape was unknown, which would have screened a
    // firearm nobody had described against the rules for a different one.
    // Unknown means we check nothing.
    const verdict = sectionAllows(section, shape.category, shape.selfLoading);
    if (!verdict.ok) {
      out.push({
        code: 'section-forbids-firearm',
        // The TYPE is what they would change, or they change the licence type.
        field: 'firearm_type',
        message: `${verdict.why} You would need to apply under a different section for this firearm.`,
      });
    }
  }

  // ── 2. Does their competency cover it? ────────────────────────────
  //
  // ⚠️ ONLY WHEN THEY HAVE ANSWERED. competency_for is filled from the
  // certificate; an empty one means we have not read it yet, not that they
  // lack the endorsement.
  const held = (answers.competency_for ?? '')
    .split(',')
    .map((s) => endorsementFromLabel(s.trim()))
    .filter((e): e is Endorsement => !!e);

  if (held.length && !held.includes(needed)) {
    const label = ENDORSEMENTS.find((e) => e.value === needed)?.label ?? '';
    out.push({
      code: 'competency-missing-endorsement',
      field: 'competency_for',
      message:
        `Your competency does not cover this firearm. It needs "${label}". ` +
        'A licence application in a firearm type your competency does not ' +
        'cover is refused before it is considered, so this is worth settling ' +
        'with your DFO first.',
    });
  }

  return out;
}
