// ────────────────────────────────────────────────────────────────────
// THE REQUEST FOR PRIOR NOTICE — annexure "G" in a professional pack.
//
// ⚠️ THIS EXISTED AS A TICK BOX AND NOTHING ELSE. motivation-checklist.ts has
// carried a row labelled "Request for prior notice before refusal (PAJA)"
// under "Your pack", owned by US, ticking itself green the moment the
// motivation was written — and no code anywhere produced the document. An
// applicant reading that list was told we had prepared something that did not
// exist. Found on 2026-08-20 when the operator supplied the annexure list a
// professional writer actually files, which has it at G.
//
// WHY IT IS WORTH HAVING, and it is not a formality:
//
//   reg 89  A police official taking an administrative decision that may
//           detrimentally affect a person's rights must record the reasons in
//           writing when the decision is made, sign and date them, and
//           "without delay notify the person concerned in writing of the
//           decision stating the reasons".
//
//   reg 91(4)  "A copy of the notification contemplated in regulation 89(c)
//           must be attached to [the] appeal notice."
//
//   reg 91(1)(a)  An appeal must be noted within 90 DAYS AFTER THE DATE ON
//           WHICH THE REGISTRAR MADE THE DECISION — not the date the applicant
//           heard about it.
//
// Read together those three are the whole reason this page belongs in the
// pack. The clock runs from the decision; the appeal cannot be lodged without
// the written notification; and an applicant who is never sent one can lose
// the right to appeal without ever being told there was a decision to appeal
// against. Asking for the notification up front, in writing, on the file, is
// the cheapest possible insurance against that.
//
// ⚠️ TONE. This is a request, not a threat, and it must never read as one. It
// is filed WITH the application, before anyone has decided anything, so it is
// addressed to an official who has done nothing wrong and asks only for what
// regulation 89 already obliges them to do. A page that reads as
// pre-emptively litigious against the person about to consider your
// application is worse than no page at all.
//
// ⚠️ NO OUTCOME LANGUAGE, same as everywhere else on this product. It does not
// say a refusal is unlikely, or that this improves anything. It says what the
// applicant is asking for and under which provision.
//
// ⚠️ ATTORNEY REVIEW. The wording below cites PAJA and the Regulations and is
// signed by the applicant in their own name. It is drafted to track the
// provisions rather than to argue anything, but it has NOT been through the
// attorney who reviews the disclaimer and the statutory pages. Flagged in
// PRIOR_NOTICE_VERSION so a reviewed version can be told apart from this one.
// ────────────────────────────────────────────────────────────────────

/**
 * Bumped whenever the wording changes, and stamped on the rendered page.
 *
 * `-draft` until an attorney has read it. Do not remove the suffix as a
 * tidy-up: it is the only thing on the page that says whether the text was
 * reviewed.
 */
export const PRIOR_NOTICE_VERSION = 'pn-2026-08-a-draft';

export interface PriorNoticeInput {
  applicantName: string;
  idNumber?: string;
  referenceNumber: string;
  /** "Section 16 — dedicated hunter", for the opening sentence. */
  licenceTypeLabel: string;
  /** "a Howa 1500 in 6.5 Creedmoor, serial B742119", where it is known. */
  firearmLine?: string;
}

export interface PriorNoticeDocument {
  title: string;
  /** Blank-line-separated blocks, same contract as the motivation body. */
  body: string;
  version: string;
}

/**
 * Build the request.
 *
 * Pure and deterministic — no clock, no randomness — so the same application
 * always produces the same page, which is what lets the whole pack be
 * re-rendered from stored text rather than stored bytes.
 */
export function buildPriorNoticeRequest(
  input: PriorNoticeInput,
): PriorNoticeDocument {
  const who = input.idNumber
    ? `${input.applicantName}, identity number ${input.idNumber},`
    : `${input.applicantName},`;

  const what = input.firearmLine
    ? `my application under ${input.licenceTypeLabel} for ${input.firearmLine}`
    : `my application under ${input.licenceTypeLabel}`;

  const body = [
    `I, ${who} lodge this request together with ${what}, reference ${input.referenceNumber}.`,

    'What I am asking for:',

    // Kept to three numbered asks. A longer list reads as a demand; these
    // three are each anchored in a provision that already binds the decision
    // maker, which is what makes the page unobjectionable to receive.
    '1. That, should the Registrar be minded to refuse this application or to grant it subject to conditions, I be given notice of that intention and a reasonable opportunity to make representations before the decision is taken.',

    '2. That, if a decision adverse to me is taken, I be notified of it in writing, stating the reasons for it and the date and place at which it was taken.',

    '3. That the notification referred to above be sent to the address given in my application, and that I be told the date on which the decision was made.',

    'Why I am asking:',

    'Regulation 89 of the Firearms Control Regulations, 2004 requires a police official taking an administrative decision which may detrimentally affect the rights of a person to record the reasons for that decision in writing when it is made, to sign and date those reasons, and without delay to notify the person concerned in writing of the decision and of those reasons.',

    'Section 3 of the Promotion of Administrative Justice Act 3 of 2000 provides that administrative action which materially and adversely affects a person’s rights must be procedurally fair, which includes adequate notice of the nature and purpose of the proposed action and a reasonable opportunity to make representations.',

    // The practical point, stated plainly. This is the sentence that explains
    // why the request is filed at the START rather than after a refusal.
    'I make this request now, with my application, rather than after a decision, for a practical reason: regulation 91(1)(a) requires an appeal to be noted within 90 days after the date on which the decision was made, and regulation 91(4) requires a copy of the regulation 89(c) notification to be attached to the appeal notice. Written notice of the decision and its date is therefore what makes an appeal possible at all.',

    'This request is not an objection to anything and is not made in anticipation of a refusal. It asks only for what regulation 89 already requires, and it is on the file so that it does not have to be asked for later.',

    'I confirm that the contact details in my application are correct and undertake to notify the Designated Firearms Officer in writing of any change to them while this application is pending.',
  ].join('\n\n');

  return {
    title: 'REQUEST FOR PRIOR NOTICE AND WRITTEN REASONS',
    body,
    version: PRIOR_NOTICE_VERSION,
  };
}
