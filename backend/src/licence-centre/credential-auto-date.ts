import { CredentialKind } from '@prisma/client';
import { LICENCE_YEARS, type LicenceSection } from '../common/sa-competency';
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
  now: Date;
}): AutoDateVerdict {
  const expiry = parseIsoDate(args.expiresOn);
  if (!expiry) return { arm: false, reason: 'no readable expiry' };

  // ⚠️ THE MODEL SAID IT WAS UNSURE. That is the whole signal, and until
  // today it was thrown away before anything could read it — the parser's
  // date branch returned before the confidence was captured, so this list
  // could never contain a date key at all.
  if (args.lowConfidence.includes('expires_on')) {
    return { arm: false, reason: 'the reading was flagged uncertain' };
  }

  // ⚠️ FIREARM LICENCES ONLY, FOR NOW. The extractor accepts expires_on for
  // every kind, and the CHECK constraint that once stopped a person-document
  // carrying an expiry was dropped in 20260823090100_credential_provenance_guard.
  // So a proof of address can already hold a date today — it is simply never
  // armed. Arming it would turn a municipal bill's due date into a push
  // notification about a firearm document.
  if (args.kind !== CredentialKind.FIREARM_LICENCE) {
    return { arm: false, reason: `not a firearm licence (${args.kind})` };
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
  const term = LICENCE_YEARS[args.section as LicenceSection];
  if (!issued || !term) {
    return { arm: false, reason: 'no issue date or section to check the term against' };
  }
  const expected = new Date(issued.getTime());
  expected.setUTCFullYear(expected.getUTCFullYear() + term);
  if (Math.abs(daysBetween(expiry, expected)) > TERM_TOLERANCE_DAYS) {
    return {
      arm: false,
      reason: `expiry ${args.expiresOn} does not match a ${term}-year ${args.section} term from ${args.issuedOn}`,
    };
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
