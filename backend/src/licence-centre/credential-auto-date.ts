import { CredentialKind } from '@prisma/client';
import { LICENCE_YEARS, sectionFromText } from '../common/sa-competency';
import { parseIsoDate } from './licence-dates';

// ────────────────────────────────────────────────────────────────────
// WHEN WE MAY FILL A DATE IN AND ARM IT WITHOUT ASKING.
//
// Operator, 2026-08-25: "if the certificate date is determined by the math
// insert it, don't wait for the user to go and confirm it. Same for the
// licenses, they all have an expiry date, insert it. No further user
// interaction required. Thats why we are designing this system, for
// automation and ease of use!"
//
// ⚠️ THIS FILE IS THE HUMAN WE JUST REMOVED. Until now a member had to look at
// every date before anything reminded on it — which is why a licence uploaded
// and never revisited produced no reminder at all, the failure this change
// exists to end. But that step was also the only thing standing between an
// OCR misreading and an SMS. Nothing downstream re-checks: the date is
// written, the sweep sees it, and the member is told a fact about their own
// firearm licence that we invented.
//
// So the gate does not ask whether the member is paying attention. It asks
// whether WE are sure. A reading that fails any test below is still written —
// the member still sees a filled-in box — but it is left unarmed and the row
// keeps asking, exactly as it does today. Nothing is taken away by failing;
// only the automatic part is withheld.
//
// ⚠️ AND ABSENT IS NOT WRONG. Where a document simply has no date, there is
// nothing to arm and nothing to invent. That case is not a failure of this
// guard, it never reaches it.
// ────────────────────────────────────────────────────────────────────

/**
 * The kinds whose printed expiry we may act on without being asked.
 *
 * ⚠️ THREE KINDS ARE DELIBERATELY ABSENT AND MUST STAY ABSENT.
 * COMPETENCY_CERTIFICATE prints no expiry at all (reference §5.2) — anything
 * a reader finds on one is another document's date or a misread, and its real
 * expiry is DERIVED, which is mayArmDerivedExpiry's job. PROFICIENCY and
 * IDENTITY_DOCUMENT do not run out, so a date on one is a course date or a
 * card-replacement date and reminding on it is noise about a document that
 * cannot lapse. All three are also in NO_EXPIRY_ON_THE_PAGE, so the readers
 * refuse to put a date on them in the first place; this is the second lock.
 *
 * The two retired dedicated kinds are here as well as the current one: rows
 * filed before the 2026-08-20 consolidation still carry them, and a document
 * that would be armed today should not go unarmed because of when it was filed.
 */
const ARMABLE_KINDS: ReadonlySet<CredentialKind> = new Set([
  CredentialKind.FIREARM_LICENCE,
  CredentialKind.DEDICATED_DISCIPLINE,
  CredentialKind.DEDICATED_HUNTER,
  CredentialKind.DEDICATED_STATUS,
]);

/** The longest any licence runs under the section 27 Table. */
const MAX_TERM_YEARS = 10;
/** How far a read expiry may sit from the term its section implies. */
const TERM_TOLERANCE_DAYS = 90;

export interface AutoDateVerdict {
  /** Write the date AND arm it. */
  arm: boolean;
  /** Why not, for the log. Never shown to a member. */
  reason?: string;
}

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY);

/**
 * May we arm an expiry we READ off a document?
 *
 * Every condition below is a case where the read is plausible and wrong, and
 * where nobody would find out until the reminder did or did not arrive.
 */
export function mayArmReadExpiry(args: {
  kind: CredentialKind;
  /** Other roles this one document also fills. */
  coversKinds: readonly CredentialKind[];
  expiresOn: string | null;
  issuedOn: string | null;
  /** The licence section read off the card, if any. */
  section: string | null;
  /** Field keys the extractor flagged as uncertain. */
  lowConfidence: readonly string[];
  /**
   * The Textract reader's own verdict, where there is one.
   *
   * ⚠️ `false` IS A VETO, `undefined` IS NO OPINION. The Textract path scores
   * every material field and knows when one it cannot do without came back
   * empty; the Claude path has only per-field confidence and passes nothing
   * here. Without this the Textract path's doubt could not reach this guard at
   * all — `lowConfidence` names keys in `details`, and the expiry is not one
   * of them, so 'expires_on' could never appear in that list.
   */
  autoFillable?: boolean | null;
  now: Date;
}): AutoDateVerdict {
  const expiry = parseIsoDate(args.expiresOn);
  if (!expiry) return { arm: false, reason: 'no readable expiry' };

  // ⚠️ THE READER SAID SO ITSELF. Checked before anything clever, for the same
  // reason lowConfidence is: a reader that has measured its own work and found
  // it wanting outranks any cross-check we can invent from the outside.
  if (args.autoFillable === false) {
    return { arm: false, reason: 'the reader marked the document not auto-fillable' };
  }

  // ⚠️ THE MODEL SAID IT WAS UNSURE. That is the whole signal, and until
  // today it was thrown away before anything could read it — the parser's
  // date branch returned before the confidence was captured, so this list
  // could never contain a date key at all.
  if (args.lowConfidence.includes('expires_on')) {
    return { arm: false, reason: 'the reading was flagged uncertain' };
  }

  // ⚠️ AN ALLOWLIST, NOT "FIREARM LICENCES ONLY". The extractor accepts
  // expires_on for every kind, and the CHECK constraint that once stopped a
  // person-document carrying an expiry was dropped in
  // 20260823090100_credential_provenance_guard. So a proof of address can
  // already hold a date today — it is simply never armed, and arming it would
  // turn a municipal bill's due date into a push notification about a firearm
  // document. Everything not named below stays exactly there.
  //
  // ⚠️ DEDICATED STATUS WAS MISSING FROM THIS LIST AND IT MATTERS AS MUCH AS
  // THE LICENCE. An association's dedicated-hunter / dedicated-sport-shooter
  // certificate PRINTS a real expiry — unlike a competency, which prints none
  // (§5.2), and unlike an ID or a proficiency, which do not run out at all —
  // and it is a standing condition of a section 16 licence: let it lapse and
  // the licence behind it goes with it. It was the one document in the vault
  // that both carries a readable deadline and costs a firearm when missed, and
  // it could never fire a reminder without somebody going back to tick a box.
  if (!ARMABLE_KINDS.has(args.kind)) {
    return { arm: false, reason: `kind is never armed (${args.kind})` };
  }

  // ⚠️ ONE DOCUMENT DOING SEVERAL JOBS PRINTS SEVERAL DATES. An association
  // pack carries a membership validity, a dedicated-status validity and a
  // good-standing date, and we do not record which row a date came off. The
  // extract prompt even tells the model there is "ONE validity date" for such
  // a document, which is an instruction, not a fact about the paper.
  if (args.coversKinds.length) {
    return { arm: false, reason: 'document fills more than one role' };
  }

  const issued = parseIsoDate(args.issuedOn);

  // Plain sanity, before anything clever. The only bound on an OCR'd date
  // anywhere else is a 1900-2200 window, which admits almost every misreading
  // that matters.
  if (issued && expiry <= issued) {
    return { arm: false, reason: 'expiry is not after the issue date' };
  }
  if (issued && daysBetween(expiry, issued) > (MAX_TERM_YEARS + 1) * 365) {
    return { arm: false, reason: 'term longer than any licence runs' };
  }
  if (daysBetween(expiry, args.now) > (MAX_TERM_YEARS + 5) * 365) {
    return { arm: false, reason: 'expiry implausibly far out' };
  }
  // ⚠️ NEVER ARM A DATE ALREADY PAST. The reminder ladder's last stage fires
  // on anything at or past its expiry, so arming one lapsed in 2019 sends a
  // notice about it tonight. A past date is exactly the case where a member
  // should be asked, not told.
  if (daysBetween(expiry, args.now) < 0) {
    return { arm: false, reason: 'expiry already past' };
  }

  // ⚠️ THE CHECK THAT CATCHES A MISREAD YEAR, and the one thing here that uses
  // the statute. Section 27 fixes the term by section: five years under s13,
  // two under s14, ten under s15, s16 and s16A. A licence issued 2025 under
  // s16 expires 2035; a model that reads "2030" off a smudged card produces a
  // date that passes every other test on this page. The section and the issue
  // date are already asked for on every licence.
  //
  // No section read means no cross-check, which means no arming. That is a
  // deliberate cost: the alternative is trusting a date nothing corroborates.
  // ⚠️ NORMALISED, NOT LOOKED UP RAW. The card says "Section 16"; the table
  // is keyed 'S16'. A direct lookup misses on almost every real card and the
  // guard then refuses every licence, silently.
  //
  // ⚠️ A LICENCE ONLY. It is the section 27 Table that makes this check
  // possible, and nothing else in the vault has a section. A dedicated-status
  // certificate's period is set by the association, not by statute — there is
  // no term to compare against and no table to look one up in — so requiring
  // this of one would refuse every single one of them, silently, which is the
  // state this change exists to end. What guards a dedicated status instead is
  // everything above: a date the reader was sure of, on a document filling one
  // role only, later than its issue date, not already past, and not further
  // out than any firearm document runs.
  if (args.kind === CredentialKind.FIREARM_LICENCE) {
    const parsed = sectionFromText(args.section);
    const term = parsed ? LICENCE_YEARS[parsed] : undefined;
    if (!issued || !term) {
      return { arm: false, reason: 'no issue date or section to check the term against' };
    }
    const expected = new Date(issued.getTime());
    expected.setUTCFullYear(expected.getUTCFullYear() + term);
    if (Math.abs(daysBetween(expiry, expected)) > TERM_TOLERANCE_DAYS) {
      return {
        arm: false,
        reason: `expiry ${args.expiresOn} does not match a ${term}-year ${parsed} term from ${args.issuedOn}`,
      };
    }
  }

  return { arm: true };
}

/**
 * May we arm a competency date we DERIVED?
 *
 * ⚠️ ONLY WHERE A REAL LICENCE BACKS IT. The derivation has two outcomes that
 * both produce a date: one inherited from a licence the member holds, and the
 * five-year no-licence assumption. The first is a fact about a document they
 * can read for themselves. The second is a rule the reference marks
 * [UNVERIFIED] and instructs must "never be presented to a user as the legal
 * position" — it is the REPEALED s10(2), applied from habit. A push
 * notification counting down to it is the loudest way to present something.
 *
 * The statutory muzzle-loader period is a fact and may be armed.
 */
export function mayArmDerivedExpiry(basis: string): AutoDateVerdict {
  if (basis === 'licence' || basis === 'statute') return { arm: true };
  return { arm: false, reason: `derivation was ${basis}, not licence-backed` };
}
