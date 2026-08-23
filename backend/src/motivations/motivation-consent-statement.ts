import { cardRowsFor, type FirearmSnapshot } from './motivation-seller-consent.service';

// ────────────────────────────────────────────────────────────────────
// WHAT THE PREVIOUS OWNER SIGNS.
//
// ⚠️ THE WORDING IS DRAFTED, NOT BLESSED. This is the document a DFO reads to
// satisfy themselves that a named licence holder agreed to transfer a named
// firearm. Every other template in this module goes past an attorney before it
// goes live and this one carries more weight than most of them. Treat the
// sentence below as a first draft to be reviewed, not as settled wording.
//
// ⚠️ THE DECLARATION NAMES THE PEOPLE; THE FIREARM IS A LIST BENEATH IT.
// Operator, 2026-08-23: "have all the details in a list form and not embeded
// in the declaration sentence. Just make the declaration of the current owners
// details states that the fire arm listed below."
//
// That is the right shape for two reasons beyond how it reads. A paragraph
// carrying ten card fields invites paraphrase — "a Nordiske .223 rifle" — and
// paraphrase is exactly what must not happen to values that have to match the
// SAPS register. And a labelled list is the form the reader already has in
// front of them, because it is how the licence card itself is laid out.
// ────────────────────────────────────────────────────────────────────

/** Everything the printed consent needs, already decrypted by the caller. */
export interface ConsentStatement {
  sellerFullName: string;
  sellerIdNumber: string;
  /**
   * The number the link was sent to and the OTP was answered on.
   *
   * ⚠️ THE VERIFIED ONE, NOT A TYPED ONE. It is the only contact detail on
   * this page we can actually attest to — we sent a code to it and it came
   * back. A field the seller filled in is a claim; printing one next to a
   * verified signature would weaken both. If they want a different number on
   * record, that belongs somewhere that does not look attested.
   */
  sellerPhone: string;
  firearm: FirearmSnapshot;
  signedPlace: string | null;
  signedAt: Date | null;
}

/**
 * The declaration, in the seller's voice.
 *
 * ⚠️ "LISTED BELOW" IS LOAD-BEARING — it is what lets the firearm be a list.
 * If this sentence is ever reworded, the reference has to survive, or the
 * table underneath is orphaned from the thing that gives it force.
 */
export function declarationFor(s: ConsentStatement): string {
  const applicant = s.firearm.applicantName?.trim() || 'the applicant';
  const applicantId = s.firearm.applicantIdNumber?.trim();
  const who = applicantId
    ? `${applicant} (identity number ${applicantId})`
    : applicant;

  return (
    `I, ${s.sellerFullName} (identity number ${s.sellerIdNumber}, ` +
    `contact number ${s.sellerPhone}), am the ` +
    `licensed holder of the firearm listed below. I give my consent to ` +
    `${who} to apply to the South African Police Service for a licence to ` +
    `possess it, and I confirm that the particulars listed below are those ` +
    `reflected on my own licence for this firearm.`
  );
}

/**
 * The firearm rows, exactly as the card reads them.
 *
 * ⚠️ NOTHING IS NORMALISED HERE, DELIBERATELY. "NONE" prints as NONE, a serial
 * keeps its exact characters, and the type string is copied whole rather than
 * split into words we think we understand. The one thing that IS dropped is a
 * field nobody ever established — see cardRowsFor, and the note on
 * FirearmSnapshot about why unread and NONE must never converge.
 */
export function firearmRowsFor(
  s: ConsentStatement,
): { label: string; value: string }[] {
  return cardRowsFor(s.firearm);
}

/**
 * "Signed at Bloemfontein on 23 August 2026."
 *
 * ⚠️ THE PLACE IS OMITTED RATHER THAN GUESSED. Location comes from the phone
 * and can be refused, and a statement that says "Signed at —" is better than
 * one that names a town the signatory was not in.
 */
export function signedLineFor(s: ConsentStatement): string {
  const date = s.signedAt
    ? s.signedAt.toLocaleDateString('en-ZA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';
  const place = (s.signedPlace ?? '').trim();
  if (place && date) return `Signed at ${place} on ${date}.`;
  if (date) return `Signed on ${date}.`;
  return 'Signed.';
}

/**
 * The line that tells a reader what the two photographs are.
 *
 * The seller photographs their own licence as part of consenting, and those
 * pages travel in the pack as the SELLER_LICENCE annexure. Saying so on the
 * consent itself means a DFO does not have to infer the connection.
 */
export const LICENCE_PHOTO_NOTE =
  'Photographs of the front and back of my licence for this firearm are attached.';

/** Heading printed above the list. */
export const FIREARM_LIST_HEADING = 'The firearm';

// ────────────────────────────────────────────────────────────────────
// THE PRINTED SHEET.
//
// Assembled into the same block model the character statement uses, so it goes
// through renderStatementForm and inherits the thing that matters most: that
// renderer measures the whole sheet and SCALES it to fit one A4 page rather
// than spilling. Operator, on the consent: "Everything on one page."
// ────────────────────────────────────────────────────────────────────

import type { CharacterStatementForm } from './motivation-character-statement';

export const CONSENT_FORM_LAYOUT_VERSION = 'consent-1';

export function consentFormFor(
  s: ConsentStatement,
  media: { signature: Buffer | null; front: Buffer | null; back: Buffer | null },
): CharacterStatementForm {
  const rows = firearmRowsFor(s);
  return {
    eyebrow: 'CONSENT OF THE CURRENT OWNER',
    title: 'Consent to apply for a firearm licence',
    subtitle: 'Given by the licensed holder of the firearm below',
    index: 1,
    version: CONSENT_FORM_LAYOUT_VERSION,
    blocks: [
      // The declaration names the people and points at the list. It carries no
      // firearm particulars itself — see the note at the top of this file.
      { kind: 'text', text: declarationFor(s) },
      { kind: 'part', label: '', title: FIREARM_LIST_HEADING },
      // ⚠️ EVERY ROW THE CARD GAVE US, IN CARD ORDER, INCLUDING ITS NONEs.
      ...rows.map((r) => ({ kind: 'value' as const, label: r.label, value: r.value })),
      ...(media.front || media.back
        ? [
            {
              kind: 'images' as const,
              label: LICENCE_PHOTO_NOTE,
              images: [media.front, media.back].filter(
                (b): b is Buffer => !!b,
              ),
            },
          ]
        : []),
      {
        kind: 'signed' as const,
        name: s.sellerFullName,
        place: s.signedPlace ?? '',
        date: s.signedAt,
        signature: media.signature ?? undefined,
      },
    ],
  };
}
