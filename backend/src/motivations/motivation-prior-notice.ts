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
export const PRIOR_NOTICE_VERSION = 'pn-2026-10-16-a-draft';

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

  /**
   * ⚠️ SHORT BY INSTRUCTION. Operator, 2026-10-16: "work on the wording and
   * shorten the whole document" — the letter was spilling its signature block
   * onto a second sheet. Every provision it rests on is kept (reg 89, PAJA s3,
   * reg 91(1)(a) and 91(4)); what went is the second sentence of each point,
   * the repetition between them, and the separate contact undertaking. The
   * three numbered asks stay three, because a longer list reads as a demand.
   */
  const body = [
    `I, ${who} lodge this request together with ${what}, reference ${input.referenceNumber}.`,

    'What I am asking for:',

    '1. That, if the Registrar is minded to refuse this application or grant it subject to conditions, I first be given notice and a reasonable opportunity to make representations.',

    '2. That any adverse decision be notified to me in writing, with the reasons and the date and place it was taken.',

    '3. That the notification be sent to the address in my application.',

    'Why I am asking:',

    'Regulation 89 of the Firearms Control Regulations, 2004 requires an official taking an administrative decision that may detrimentally affect a person’s rights to record the reasons in writing when it is made, to sign and date them, and to notify the person in writing without delay.',

    'Section 3 of the Promotion of Administrative Justice Act 3 of 2000 requires administrative action that materially and adversely affects a person’s rights to be procedurally fair, including adequate notice and a reasonable opportunity to make representations.',

    'I ask now, with my application, because regulation 91(1)(a) gives 90 days to note an appeal from the date of the decision, and regulation 91(4) requires the regulation 89(c) notification to be attached to the appeal notice.',

    'This request is not an objection and is not made in anticipation of a refusal. It asks only for what regulation 89 already requires.',
  ].join('\n\n');

  return {
    title: 'REQUEST FOR PRIOR NOTICE AND WRITTEN REASONS',
    body,
    version: PRIOR_NOTICE_VERSION,
  };
}
