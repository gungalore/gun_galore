import { MotivationLicenceType } from '@prisma/client';
import { OWNED_ROWS, ownedRowTaken } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// WHERE THE ACT IS STRICTER THAN WHAT THE CFR SOMETIMES ACCEPTS.
//
// MOTIVATION-GUIDE-BOOK Part 3.2. These are NOT blocks. The Act caps how many
// licences a person may hold under each section, and the Central Firearms
// Register does grant applications that exceed those caps — so refusing to
// write the motivation would be this product substituting its own reading of
// the Act for the Registrar's, and costing the applicant an application that
// might well have succeeded.
//
// ⚠️ AND THEY ARE NOT SILENT EITHER. An applicant who is over a cap and does
// not know it lodges, pays, gives fingerprints, waits, and is refused on a
// ground nobody mentioned. So the motivation is written and the warning prints
// on the applicant's own checklist page — the sheet that is removed at the
// counter and never lodged — with the section that gives rise to it and the
// alternative route where there is one.
//
// ⚠️ NEVER IN THE MOTIVATION ITSELF. A document that argues against its own
// application is the "advocate, not reviewer" rule broken in public, and a
// Registrar reading "this may exceed the section 15 limit" in an applicant's
// own words has been handed their refusal.
//
// PURE — answers in, warnings out. No Nest, no Prisma; the clock is injected.
// ────────────────────────────────────────────────────────────────────

export interface ApplicationWarning {
  /** Stable code, for the client and for tests. */
  code:
    | 'section-13-cap'
    | 'section-14-cap'
    | 'section-15-cap'
    | 'section-15-handgun-cap'
    | 'section-16-shotgun-capacity'
    | 'renewal-inside-90-days'
    | 'section-15-association-member'
    | 'semi-auto-hunting-not-landowner';
  /** The subsection or policy it comes from, named so the member can check it. */
  authority: string;
  /** Plain words, on the checklist page. Never in the motivation. */
  message: string;
}

/** "section_16" → 16. Anything else, including "unsure", is unknown. */
function heldSectionNumber(raw: string): number | null {
  const m = /^section_(\d{2})$/.exec((raw ?? '').trim());
  return m ? Number(m[1]) : null;
}

interface Held {
  section: number | null;
  isHandgun: boolean;
}

/**
 * Every firearm the applicant says they hold, with its section where a card
 * established one.
 *
 * ⚠️ THE COUNT IS ONLY AS GOOD AS THE SECTION COLUMN, AND THAT IS WHY EVERY
 * WARNING BELOW COUNTS ONLY WHAT IT CAN SEE. A row whose section is unknown is
 * not assumed to be under the section applied for; it is left out. So these
 * warnings can UNDERCOUNT and never overcount, which is the safe direction:
 * telling somebody they are over a cap when they are not is worse than saying
 * nothing, because the answer to a warning is to abandon an application.
 */
function heldFirearms(answers: Record<string, string>): Held[] {
  const out: Held[] = [];
  for (let n = 1; n <= OWNED_ROWS; n++) {
    if (!ownedRowTaken(answers, n)) continue;
    const p = `existing_firearm_${n}_`;
    out.push({
      section: heldSectionNumber(answers[`${p}section_held`] ?? ''),
      isHandgun: /handgun|pistol|revolver/i.test(answers[`${p}type`] ?? ''),
    });
  }
  return out;
}

const isHandgun = (answers: Record<string, string>) =>
  /handgun|pistol|revolver/i.test(answers.firearm_type ?? '');

/** A YYYY-MM-DD answer as a UTC midnight, or null. */
function parseDay(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY = 24 * 60 * 60 * 1000;

export function applicationWarnings(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
  asAt = new Date(),
): ApplicationWarning[] {
  const out: ApplicationWarning[] = [];
  const held = heldFirearms(answers);
  const count = (n: number) => held.filter((h) => h.section === n).length;

  /**
   * ⚠️ SECTION 13(3): ONE AT A TIME. "No person may hold more than one licence
   * issued in terms of this section." A section 16 handgun does NOT count —
   * the cap is on licences under THIS section, which is exactly why holding one
   * is no obstacle to a section 13 application (operator, 2026-09-09).
   */
  if (licenceType === MotivationLicenceType.S13_SELF_DEFENCE && count(13) >= 1) {
    out.push({
      code: 'section-13-cap',
      authority: 'section 13(3)',
      message:
        'The Act allows one section 13 licence at a time, and your answers say you already hold one. ' +
        'If you are keeping that firearm, this application may be refused on that ground. ' +
        'If you are selling it, or re-licensing the same firearm, say so in the motivation before you lodge.',
    });
  }

  /**
   * ⚠️ SECTION 15(3): FOUR, THREE IF A SECTION 13 IS HELD, AND ONLY ONE
   * HANDGUN. The handgun limb is the one most easily tripped and the one the
   * writer had no way of knowing about.
   */
  if (licenceType === MotivationLicenceType.S15_OCCASIONAL_HUNTER) {
    const ceiling = count(13) >= 1 ? 3 : 4;
    const after = count(15) + 1;
    if (after > ceiling) {
      out.push({
        code: 'section-15-cap',
        authority: 'section 15(3)(a) and (b)',
        message:
          `You will hold ${after} section 15 licences after this one; the Act allows ${ceiling}` +
          (ceiling === 3
            ? ' because you also hold a section 13 licence. '
            : '. ') +
          'If you hold dedicated status with an accredited association, section 16 has no numeric cap.',
      });
    }
    if (isHandgun(answers) && held.some((h) => h.section === 15 && h.isHandgun)) {
      out.push({
        code: 'section-15-handgun-cap',
        authority: 'section 15(3)(c)',
        message:
          'The Act allows only ONE handgun under section 15, and your answers say you already hold one. ' +
          'A second handgun needs section 16 with dedicated status, or section 13 if it is for self-defence.',
      });
    }
  }

  /**
   * ⚠️ SECTION 16(1)(c): FIVE SHOTS. The paragraph was substituted by Act 43 of
   * 2003 and is in force; the deletion in Act 28 of 2006 never commenced, so
   * the limit is the law however many larger shotguns the CFR has licensed.
   */
  if (
    (licenceType === MotivationLicenceType.S16_DEDICATED_HUNTER ||
      licenceType === MotivationLicenceType.S16_DEDICATED_SPORT) &&
    /shotgun/i.test(answers.firearm_type ?? '') &&
    /semi|self-?load/i.test(answers.firearm_action ?? '')
  ) {
    const capacity = Number((answers.firearm_capacity ?? '').replace(/\D+/g, ''));
    if (Number.isFinite(capacity) && capacity > 5) {
      out.push({
        code: 'section-16-shotgun-capacity',
        authority: 'section 16(1)(c)',
        message:
          'The Act limits a section 16 semi-automatic shotgun to five shots in succession without reloading, ' +
          `and your answers give ${capacity}. The Central Firearms Register has licensed larger ones under ` +
          'section 16, but a refusal on this ground is possible. Section 14 is the alternative, for self-defence.',
      });
    }
  }

  /**
   * ⚠️ SECTION 24(1) AND (4): THE 90 DAYS ARE WHAT KEEPS THE LICENCE ALIVE.
   * Lodged in time, the licence "remains valid until the application is
   * decided". Lodged late, it does not — and the applicant is in possession of
   * a firearm on an expired licence while they wait.
   */
  if (licenceType === MotivationLicenceType.S24_RENEWAL) {
    const expiry = parseDay(answers.licence_expiry ?? answers.firearm_licence_expiry ?? '');
    if (expiry) {
      const daysLeft = Math.floor((expiry.getTime() - asAt.getTime()) / DAY);
      if (daysLeft < 90) {
        out.push({
          code: 'renewal-inside-90-days',
          authority: 'section 24(1) and 24(4)',
          message:
            daysLeft < 0
              ? 'This licence has already expired. Section 24(4) only keeps a licence valid while a renewal is decided if the renewal was lodged at least 90 days before expiry. Speak to your DFO before you go.'
              : `There are ${daysLeft} days to expiry and the Act asks for at least 90. ` +
                'Your licence will NOT automatically stay valid while the renewal is decided. ' +
                'Lodge immediately and keep the acknowledgement of receipt.',
        });
      }
    }
  }

  /**
   * ⚠️ THE SECTION 15 DEFINITION STILL SAYS "NOT A MEMBER". The 2006 amendment
   * that would have removed those words never commenced. Associations issue
   * section 15 endorsements to members and DFOs accept them, so the motivation
   * is written — describing the applicant as a MEMBER and never as dedicated —
   * and the applicant is told the definition has not caught up.
   */
  if (
    licenceType === MotivationLicenceType.S15_OCCASIONAL_HUNTER &&
    (answers.association_name ?? '').trim()
  ) {
    out.push({
      code: 'section-15-association-member',
      authority: 'section 1, definitions of "occasional hunter" and "occasional sports person"',
      message:
        'You belong to an accredited association and are applying under section 15. The Act still defines an ' +
        '"occasional" hunter or sports person as somebody who is NOT a member of one — the 2006 amendment that ' +
        'would have removed those words never came into force. Associations endorse section 15 applications for ' +
        'members and DFOs accept them. Your motivation says you are a member and never claims dedicated status. ' +
        'If you do hold dedicated status, section 16 is the stronger route.',
    });
  }

  /**
   * ⚠️ ASSOCIATION POLICY, NOT THE ACT, AND IT IS LABELLED AS SUCH. SAHGCA
   * endorses a semi-automatic firearm for hunting only for landowners and their
   * immediate family. Without the endorsement a section 16 hunting application
   * for one has no s16(2) support.
   */
  if (
    licenceType === MotivationLicenceType.S16_DEDICATED_HUNTER &&
    /semi|self-?load/i.test(answers.firearm_action ?? '')
  ) {
    out.push({
      code: 'semi-auto-hunting-not-landowner',
      authority: 'association policy, not the Act',
      message:
        'Associations generally endorse a semi-automatic firearm for HUNTING only for landowners and their ' +
        'immediate family. Check with yours before you lodge — without their endorsement the application has ' +
        'no section 16(2) support. Dedicated sport shooting is the usual route for a semi-automatic.',
    });
  }

  return out;
}
