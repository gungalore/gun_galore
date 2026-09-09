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
  code: 'section-forbids-firearm'
    | 'competency-missing-endorsement'
    /** Section 6(2): no licence may be issued while the competency has lapsed. */
    | 'competency-expired';
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
    case 'S14_RESTRICTED_SELF_DEFENCE':
      return 'S14';
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

/**
 * What certificate (or certificates) this firearm needs — in the FOUR states
 * the question actually has.
 *
 * ⚠️ `Endorsement | null` COULD NOT SAY THIS, AND THE MISSING STATE COST A
 * MEMBER A WRONG CERTIFICATE ON A SIGNED FORM. `requiredEndorsement` returned
 * null for three different situations and every caller read it as one:
 *
 *   • nothing said yet — leave the boxes exactly as they are;
 *   • a COMBINATION gun — rifle and shotgun barrels, so no single
 *     certificate is "the" one (SAPS 271 §E.1 offers it as a type, and it is
 *     the type nothing here could map);
 *   • a firearm type this registry no longer recognises.
 *
 * Reading the last two as "leave it alone" is fail-open: a member who had a
 * rifle certificate written in and then switched to Combination kept the
 * rifle certificate — including its tick in SAPS 271 item 1.4 — with nothing
 * ever coming back to look. Only the FIRST state means "change nothing"; the
 * other two mean "we cannot choose", and that has to take a certificate we
 * chose OFF the form.
 *
 * ⚠️ AND THE ACTION IS ONLY NEEDED FOR A RIFLE. §2.2 of the competency
 * reference: there is no separate unit standard for a self-loading handgun or
 * a self-loading shotgun — 119649 covers handguns whole, 119652 shotguns
 * whole. So `firearm_type: 'Handgun'` settles the endorsement on its own, and
 * demanding `firearm_action` as well withheld a certificate we already held
 * from every renewal (licence-renewal.ts seeds the type off the licence card
 * and cannot seed an action, because the card does not print one).
 */
export type EndorsementNeed =
  /**
   * They have not said enough yet. Change nothing.
   *
   * ⚠️ A CLEARED `firearm_type` LANDS HERE, AND THAT IS THE RIGHT ANSWER, not
   * a second fail-open. Blanking the type says nothing about the certificate —
   * and the type is REQUIRED, so the member has to answer it again, which
   * re-derives. Wiping four boxes mid-edit would cost them work to buy
   * nothing: a certificate cannot reach a signed SAPS 271 without a firearm
   * type printed beside it.
   */
  | { kind: 'unknown' }
  /** Exactly one certificate answers it. */
  | { kind: 'one'; endorsement: Endorsement }
  /**
   * More than one, and ALL of them — a combination gun has a rifle barrel and
   * a shotgun barrel. No single certificate settles it, so nothing may be
   * written on the strength of matching just one of them without saying so.
   */
  | { kind: 'several'; endorsements: readonly Endorsement[] }
  /**
   * They said, and we cannot map what they said.
   *
   * Only reachable by registry drift — a `firearm_type` choice added or
   * renamed without this function following it, or a legacy value in an old
   * draft. It is NOT "unknown": a certificate chosen for some earlier answer
   * is now attached to a firearm we cannot vouch for, and it has to come off.
   */
  | { kind: 'unmappable' };

/** The rifle endorsement, which is the one place the action decides. */
function rifleEndorsement(action: string): Endorsement | null {
  if (!action) return null;
  return action === 'Semi-automatic (self-loading)' ? 'rifle-sl' : 'rifle-mo';
}

export function endorsementNeed(
  answers: Record<string, string>,
): EndorsementNeed {
  const type = (answers.firearm_type ?? '').trim();
  const action = (answers.firearm_action ?? '').trim();
  if (!type) return { kind: 'unknown' };

  switch (type) {
    // ⚠️ THE ACTION IS NOT CONSULTED. See EndorsementNeed: the v3 collapse
    // left one handgun endorsement and one shotgun endorsement, so the action
    // cannot change the answer and waiting for it only withholds a certificate
    // we already hold.
    case 'Handgun':
      return { kind: 'one', endorsement: 'handgun' };
    case 'Shotgun':
      return { kind: 'one', endorsement: 'shotgun' };
    case 'Rifle': {
      const rifle = rifleEndorsement(action);
      // The one type where the action genuinely selects between two unit
      // standards — 119651 manual against 119650 self-loading.
      return rifle ? { kind: 'one', endorsement: rifle } : { kind: 'unknown' };
    }
    case 'Combination': {
      const rifle = rifleEndorsement(action);
      return rifle
        ? { kind: 'several', endorsements: [rifle, 'shotgun'] }
        : { kind: 'unknown' };
    }
    default:
      return { kind: 'unmappable' };
  }
}

/**
 * The single endorsement a firearm needs, or null where there is not exactly
 * one.
 *
 * ⚠️ THE NARROW VIEW, KEPT BECAUSE `credentialOffer` TAKES ONE ENDORSEMENT.
 * Anything that has to tell "we do not know" apart from "we cannot choose"
 * must call `endorsementNeed` instead — this collapses both to null, which is
 * the shape that let a ruled-out certificate stay on the form.
 *
 * ⚠️ CLASSIFICATION, NOT CALIBRE — spec §3, and the reference calls it out
 * because it is commonly misread: a pistol calibre carbine fires a handgun
 * cartridge and needs the RIFLE endorsement. Our registry asks for the type
 * directly ("Rifle"), so we inherit that correctly for free; the trap only
 * exists for anyone tempted to infer type from the calibre string.
 */
export function requiredEndorsement(
  answers: Record<string, string>,
): Endorsement | null {
  const need = endorsementNeed(answers);
  return need.kind === 'one' ? need.endorsement : null;
}

/** A YYYY-MM-DD answer as a UTC midnight, or null. */
function parseDay(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today at UTC midnight, so a comparison is by day and not by hour. */
function startOfDay(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "26 August 2026" — how the member sees a date everywhere else. */
function prettyDay(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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
  // The clock is injected rather than read, the rule sa-id.ts and the PDF
  // renderer both follow: an application re-checked months later must reach
  // the same verdict it was built on. Optional, so callers are unchanged.
  asAt = new Date(),
): Blocker[] {
  const out: Blocker[] = [];
  const section = sectionOf(licenceType);

  // ── 0. Is the competency still current? ───────────────────────────
  //
  // ⚠️ SECTION 6(2): NO LICENCE MAY BE ISSUED TO SOMEBODY WITHOUT A VALID
  // COMPETENCY. This is not a weak application, it is one that cannot be
  // granted — the same class of fact as a rifle under section 13 — so it
  // belongs here rather than in the quality gate.
  //
  // ⚠️ AND IT SHIPPED. MO000071, section 7: "competency certificate C9882094 …
  // remains valid until 2026-08-26", in a document dated 9 September 2026. The
  // pack was written, graded 94 and rendered, and it told the Registrar in the
  // applicant's own voice that the certificate behind the application had
  // lapsed a fortnight earlier.
  //
  // ⚠️ ONLY ON A DATE WE CAN READ, and only when it is genuinely past. An
  // unparseable or absent expiry means we do not know, and this file's own
  // header forbids refusing somebody for a box they have not reached yet.
  const compExpiry = parseDay(answers.competency_expiry ?? '');
  if (compExpiry && compExpiry.getTime() < startOfDay(asAt).getTime()) {
    out.push({
      code: 'competency-expired',
      field: 'competency_expiry',
      message:
        `Your competency certificate expired on ${prettyDay(compExpiry)}. ` +
        'A licence cannot be issued while it has lapsed, so renew it with SAPS ' +
        'first — your answers and documents are kept, and the motivation will ' +
        'be written the moment the new certificate is on file.',
    });
  }

  // ── 1. Does this section permit this firearm at all? ──────────────
  //
  // ⚠️ NO LONGER BEHIND AN EARLY `return` ON THE ENDORSEMENT. This function
  // used to open with `if (!requiredEndorsement(answers)) return out;`, so a
  // firearm whose endorsement we could not name — a combination gun, a type
  // the registry has since renamed — silently skipped EVERY check below,
  // including the one that has nothing to do with competency. The two
  // questions are independent and are asked independently.
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

  const need = endorsementNeed(answers);
  // 'unknown' — they have not said enough. 'unmappable' — they said something
  // we cannot map, so we do not know what to require either; the upstream fix
  // for that is to CLEAR the certificate we chose, not to refuse them here.
  const wanted: readonly Endorsement[] =
    need.kind === 'one'
      ? [need.endorsement]
      : need.kind === 'several'
        ? need.endorsements
        : [];

  // ⚠️ AND `held.length` IS LOAD-BEARING, NOT A TIDINESS CHECK. This blocker
  // fired on the operator's own section 13 on 2026-09-07 — a member who holds
  // exactly the right handgun competency, told that it does not cover his
  // handgun — because the box had been filled from the WRONG certificate
  // before the application knew which firearm it was for. The fix for that is
  // upstream (the vault offer now re-chooses the certificate the moment
  // `firearm_type` lands); the fix HERE is that an unread, unreadable or
  // cleared `competency_for` can only ever produce silence, never a refusal.
  // A wrong "no" on this screen sends somebody to their DFO over nothing.
  //
  // ⚠️ AND FOR A COMBINATION GUN THE TEST IS "COVERS NONE OF THEM", NOT
  // "COVERS ALL OF THEM" — DELIBERATELY, AND THE REASON IS THAT WE CANNOT
  // SOURCE THE STRICTER RULE. A combination gun has a rifle barrel and a
  // shotgun barrel (competency reference §4.2, `COMB`), and common sense says
  // both endorsements are needed — but neither the Act, the Regulations nor
  // the reference says so anywhere, and the reference is explicit that the
  // whole type-endorsement system is SAPS administrative practice with no
  // statutory basis (§2.2, "[ACT — by absence]"). Refusing an application on a
  // rule we invented is the failure this file's own header forbids: "NEVER
  // SILENT, AND NEVER GUESSED... we do not refuse somebody for a box they have
  // not reached yet." Covering NEITHER barrel is wrong on any reading, so that
  // is where the line sits until a DFO settles the rest — the same standard
  // the derived-expiry rule was held to.
  const covered = wanted.some((e) => held.includes(e));
  if (wanted.length && held.length && !covered) {
    // ⚠️ NAME WHAT IS MISSING, AND NAME IT EVEN IF THE REGISTRY MOVES. An
    // endorsement we can no longer label is still an endorsement they need,
    // and `It needs ""` is a sentence that tells the member nothing at all.
    const labelFor = (e: Endorsement) =>
      ENDORSEMENTS.find((x) => x.value === e)?.label ?? e;
    const needsLabel = wanted.map((e) => `"${labelFor(e)}"`).join(' and ');
    // What the certificate on file DOES cover, in the same words the box uses.
    // Without it the member is told they are wrong and not what we read.
    // Quoted the same way as the half above it, so one sentence does not
    // change register halfway through.
    const heldLabels = ENDORSEMENTS.filter((e) => held.includes(e.value))
      .map((e) => `"${e.label}"`)
      .join(', ');
    // A `multi` answer can legitimately name more than one certificate's
    // endorsements, so the noun has to agree with what is actually ticked.
    const yours =
      held.length > 1
        ? `what is ticked on your application covers ${heldLabels}`
        : `your application says your competency covers ${heldLabels}`;
    out.push({
      code: 'competency-missing-endorsement',
      field: 'competency_for',
      message:
        `Your competency does not cover this firearm. It needs ${needsLabel}, ` +
        `and ${yours}. ` +
        // ⚠️ THIS USED TO INVITE THEM TO TICK THE BOX AND MAKE THE WARNING GO
        // AWAY. `competency_for` is the blocker's only input AND it is SAPS
        // 271 item 1.4 — a declaration the applicant signs — so "tick it
        // above" was, in one sentence, an instruction to silence a compliance
        // warning by declaring something that may not be true. The onward path
        // is a real certificate in the Document Centre, or the DFO. Never the
        // tickbox.
        'If you hold a second certificate that does cover it, add it to your ' +
        'Document Centre and we will read it in. A licence application in a ' +
        'firearm type your competency does not cover is refused before it is ' +
        'considered, so this is worth settling with your DFO first.',
    });
  }

  return out;
}
