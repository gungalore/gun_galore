import { CredentialKind } from '@prisma/client';
import { toIsoDate } from './licence-dates';
// The form's own vocabulary, owned by the module that owns the form.
import { normaliseFirearmType } from '../motivations/saps-vocabulary';

// ────────────────────────────────────────────────────────────────────
// THE RENEWAL LOOP.
//
// This is the join that makes the Licence Centre worth building: the reminder
// lands, and one tap opens a section 24 renewal motivation already carrying
// everything the vault knows about the licence being renewed.
//
// It is also where the recurring income is. Renewals recur by statute — the
// demand never stops — and the pack is priced by the existing table
// (R199 / R99 / free with AO Pro).
//
// PURE — no Nest, no Prisma, no clock. Everything it needs is passed in.
// ────────────────────────────────────────────────────────────────────

/** What the vault holds about one document, decrypted. */
export interface RenewalSource {
  kind: CredentialKind;
  title: string;
  expiresOn: Date | null;
  confirmedAt: Date | null;
  /** Decrypted detail map — licence_number, make, calibre, serials, … */
  details: Record<string, string>;
}

export type RenewalRefusal = 'not-a-licence' | 'no-confirmed-date';

export interface RenewalPlan {
  /** Answers to seed the new motivation with. */
  seed: Record<string, string>;
  /**
   * Disambiguates the motivation, because one member may hold several
   * licences and `@@unique([userId, licenceType, applicationRef])` would
   * otherwise let them renew exactly one, ever.
   */
  applicationRef: string;
}

/**
 * Why a renewal cannot start from this document — or null if it can.
 *
 * Refusing EARLY and by NAME is the point. The alternative is a motivation
 * that opens empty with no explanation, which reads as the button being
 * broken.
 */
export function renewalRefusal(src: RenewalSource): RenewalRefusal | null {
  // A competency renewal is a different application on a different form; the
  // writer's section 24 pack is about a firearm licence. Offering the button
  // on a competency certificate would produce a document for the wrong thing.
  if (src.kind !== 'FIREARM_LICENCE') return 'not-a-licence';

  // The expiry date IS the application: section 24 turns on when the current
  // licence runs out, and an unconfirmed date is one nobody has checked.
  if (!src.expiresOn || !src.confirmedAt) return 'no-confirmed-date';

  // ⚠️ NOT REFUSED FOR A MISSING LICENCE NUMBER, deliberately.
  //
  // It used to be, and it was a dead end with no exit: the extraction prompt
  // omits any value it cannot read with certainty, so a glare on the card
  // loses the number while the expiry reads fine — and nothing anywhere in
  // the product could then add it. The wizard asks for
  // existing_licence_number as a required, editable field anyway, so the
  // honest behaviour is to open the renewal and let them type the one value
  // we could not read.

  return null;
}

/** The message the member actually sees. Each one says what to do next. */
export const REFUSAL_COPY: Record<RenewalRefusal, string> = {
  'not-a-licence':
    'A renewal pack is for a firearm licence. Competency and dedicated status are renewed separately, through your association or the police station.',
  'no-confirmed-date':
    'Confirm the expiry date on this document first — the renewal is built around it.',
};

/**
 * Build the answers a section 24 motivation should open with.
 *
 * ⚠️ ONLY WHAT THE DOCUMENT ACTUALLY SAYS. Nothing is inferred and nothing is
 * invented — every value here can be checked against the card in the member's
 * hand, because they will be signing the result. Anything the vault does not
 * hold stays an ordinary question in the wizard.
 */
export function renewalPlan(src: RenewalSource): RenewalPlan {
  const d = src.details;
  const seed: Record<string, string> = {};

  const put = (key: string, value: string | undefined | null) => {
    const v = (value ?? '').trim();
    if (v) seed[key] = v;
  };

  const number = licenceNumber(d);
  put('existing_licence_number', number);
  if (src.expiresOn) put('licence_expiry', toIsoDate(src.expiresOn));

  // THE FIREARM ITSELF, on the keys the WIZARD renders.
  //
  // ⚠️ These are not the same keys as the existing_firearm_1_* block below.
  // That block feeds the SAPS 271 table and the overlap engine; the step the
  // applicant actually sees — "The firearm" — reads firearm_make,
  // firearm_calibre and friends, and every one of them is required. Seeding
  // only the 271 keys meant the card promised "already carrying the
  // firearm's details" and then presented five blank required boxes.
  put('firearm_make', d.make);
  put('firearm_calibre', d.calibre);
  put('firearm_type', normaliseFirearmType(d.firearm_type));
  put('firearm_serial', d.frame_serial);

  // The renewal form asks about the firearm itself, and the licence names it.
  // These are the same keys the overlap engine reads, so a renewal that also
  // mentions other owned firearms lines up with the rest of the registry.
  put('existing_firearm_1_licence_no', number);
  put('existing_firearm_1_make', d.make);
  put('existing_firearm_1_calibre', d.calibre);
  put('existing_firearm_1_type', normaliseFirearmType(d.firearm_type));
  put('existing_firearm_1_frame_serial', d.frame_serial);
  put('existing_firearm_1_barrel_serial', d.barrel_serial);

  // ⚠️ `continued_use` IS DELIBERATELY LEFT EMPTY. It is the only question on
  // a renewal that carries an argument — what they have actually done with the
  // firearm since it was issued — and it is the reason the pack is worth
  // paying for. Pre-filling it with something plausible would put words in an
  // applicant's mouth on a document they sign as their own.

  return {
    seed,
    // The licence number is the natural reference: it is what the member and
    // the DFO both call this application, and it keeps two renewals for two
    // different firearms from colliding on the one-per-type constraint.
    applicationRef: number ? `LIC-${number}` : '',
  };
}

function licenceNumber(d: Record<string, string>): string {
  return (d.licence_number ?? d.reference_number ?? '').trim();
}

