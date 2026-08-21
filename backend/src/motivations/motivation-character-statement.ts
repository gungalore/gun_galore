// ────────────────────────────────────────────────────────────────────
// THE TWO CHARACTER REFERENCE FORMS — the pages the applicant sends out.
//
// Operator, 2026-08-21: "start with the two character witness statements. the
// ones we need to send to them to tick and sign."
//
// ⚠️ THIS IS THE ONLY DOCUMENT IN THE PACK THAT SOMEBODY ELSE SIGNS. Every
// other page is written by the applicant, about the applicant, and signed by
// the applicant. These two are handed to a third party who owes us nothing,
// who is putting their name and identity number on a police document, and who
// may be telephoned about it afterwards. That changes what the page has to do:
// it has to be honest with the REFEREE, not persuasive on the applicant's
// behalf.
//
// Which is why the form does three things that a marketing-minded version of
// it would not:
//
//   1. EVERY QUESTION CAN BE ANSWERED NO. The three statutory questions offer
//      "Yes", "No" and "I am not able to say", and Part C gives space to
//      explain a No. A form that only allows agreement is not a statement, it
//      is a signature block with decoration — and it puts words in the mouth
//      of someone who has not spoken them.
//
//   2. IT SUPPLIES NO WORDS. Part D is blank ruled lines with a prompt, never
//      a draft to adapt. Two referees returning the same sentences is the most
//      obvious possible tell that the applicant wrote both, and it would be
//      true: they would have got the sentences from us.
//
//   3. IT TELLS THE REFEREE WHAT THEY ARE SIGNING UP FOR. Regulation 13(8)
//      lets the Designated Firearms Officer come back to them for more
//      information, and says a refusal to give it may render the
//      recommendation ineffective — while also saying nobody is compelled.
//      Someone deciding whether to sign is entitled to know all three of those
//      before they do, not after the phone rings.
//
// WHAT THE LAW ACTUALLY REQUIRES, because the form is built around it:
//
//   reg 13(7)  Any person providing a recommendation concerning the character
//              of an applicant "must also state whether the applicant, to the
//              best of such person's knowledge and belief, is —
//                (a) a fit and proper person to be issued with the competency
//                    certificate, licence, permit or authorisation applied for;
//                (b) of a stable mental condition and is not inclined to
//                    violence; and
//                (c) not dependent on any substance which has an intoxicating
//                    or narcotic effect."
//
//              Note "must ALSO state WHETHER". The three are a floor, not a
//              script, and the answer is allowed to be no. Part C asks exactly
//              these three, in this order, in these words.
//
//   reg 13(8)  (a) the DFO may ask the referee for further information;
//              (b) failure or refusal may render the recommendation
//                  ineffective;
//              (c) no person is compelled to provide further information.
//
//   s 120(9)(f)  It is an offence to supply particulars, information or
//              answers in an application for a licence under the Act knowing
//              them to be false, incorrect or misleading, or not believing
//              them to be correct. The referee is told this in one plain
//              sentence, alongside the reminder that "No" is a proper answer —
//              the two belong together, because a warning without a way out
//              just pressures people into signing.
//
// ⚠️ SAPS DOES NOT DEMAND TWO, AND THE FORM MUST NOT PRETEND OTHERWISE. The
// Act and the Regulations set no number: reg 13(7) governs the CONTENT of a
// recommendation if one is given, not how many an applicant must produce. Two
// is what the professional writers file and what the operator asked for, and
// the covering text says it that way — "two, because that is what is usually
// filed" — rather than inventing a requirement.
//
// ⚠️ IT IS NOT AN AFFIDAVIT unless a DFO asks for one. Sworn statements are
// what s 16(2) demands of the ASSOCIATION, not of a character referee. The
// commissioner block at the foot is there for the DFO who asks anyway, with
// the one instruction that matters: do not sign before you are in front of
// them.
//
// ⚠️ ATTORNEY REVIEW, same as the prior-notice request. This page quotes the
// Regulations and warns a member of the public about a criminal offence, and
// it has not been read by the attorney who reviews the statutory pages. The
// -draft suffix in the version string is the only thing on the page that says
// so; do not tidy it away.
// ────────────────────────────────────────────────────────────────────

/** Bumped when the wording changes, and stamped on each form. */
export const CHARACTER_STATEMENT_VERSION = 'cs-2026-08-a-draft';

/** How many forms we put in a pack. See the note above: convention, not law. */
export const CHARACTER_STATEMENT_COUNT = 2;

/**
 * The block vocabulary a form is built from.
 *
 * Deliberately not the motivation's paragraph vocabulary. A form is ruled
 * lines, tick boxes and captions — it has almost nothing in common with
 * flowing prose, and forcing it through the same renderer would produce a
 * page of justified paragraphs with nowhere to write.
 */
export type StatementBlock =
  /** Small grey explanatory text — addressed to the referee, never filled in. */
  | { kind: 'note'; text: string }
  /** A part heading: "PART A", "WHO YOU ARE". */
  | { kind: 'part'; label: string; title: string }
  /** A normal sentence at body weight. */
  | { kind: 'text'; text: string }
  // ── What a COMPLETED statement is made of ────────────────────────
  /** A label and the value the witness gave — a filled-in field. */
  | { kind: 'value'; label: string; value: string }
  /** One statutory question with the answer they chose. */
  | {
      kind: 'answered';
      number: string;
      text: string;
      answer: string;
    }
  /** Something the witness wrote, set apart so it reads as their words. */
  | { kind: 'quote'; label: string; text: string }
  /** Their signature image, the place, and the date the server recorded. */
  | {
      kind: 'signed';
      name: string;
      signature?: Buffer;
      place: string;
      date: Date | null;
    };

export interface CharacterStatementForm {
  title: string;
  /**
   * The small line above the title.
   *
   * ⚠️ IT USED TO BE HARD-CODED "FORM n OF 2" IN THE RENDERER, which was true
   * of the blank forms and false of everything that replaced them: a signed
   * statement is not a form, and there are not always two.
   */
  eyebrow: string;
  /** "Statement by the first of two people", for the page. */
  subtitle: string;
  /** 1 or 2 — the forms are identical apart from this. */
  index: number;
  blocks: StatementBlock[];
  version: string;
}

export interface CharacterStatementInput {
  applicantName: string;
  referenceNumber: string;
  /** "Section 16 — dedicated hunter", so the referee knows what is applied for. */
  licenceTypeLabel: string;
}

/**
 * Glue for the statutory citations at the end of each question.
 *
 * ⚠️ NON-BREAKING. With ordinary spaces the line broke after the separator and
 * left a lone bullet at the end of one line with "reg 13(7)(a)" on the next.
 * A citation has to travel as one object.
 */
const NB = ' ';

/**
 * The three statutory questions, as the completed statement prints them.
 *
 * Mirrors WITNESS_DECLARATIONS in motivation-witness-form.ts — that file is
 * what the witness is asked, this is how the answer is set. A spec locks the
 * two together.
 */
export const WITNESS_QUESTIONS = [
  {
    key: 'fit_and_proper',
    number: '1',
    text: 'Is the applicant a fit and proper person to be issued with the firearm licence applied for?',
    cite: '13(7)(a)',
  },
  {
    key: 'stable_and_not_violent',
    number: '2',
    text: 'Is the applicant of a stable mental condition, and not inclined to violence?',
    cite: '13(7)(b)',
  },
  {
    key: 'not_dependent',
    number: '3',
    text: 'Is the applicant free of dependence on any substance which has an intoxicating or narcotic effect?',
    cite: '13(7)(c)',
  },
] as const;

/** The three answers. Order matters: the positive one first, then the outs. */
const ANSWERS = ['Yes', 'No', 'I am not able to say'];

/**
 * A COMPLETED statement, built from what the witness actually typed.
 *
 * Operator, 2026-08-21: "generate a form that be filled by the system from the
 * information provided by the witness. It needs to have the signature as well.
 * we can generate the date and if possible ask the witness to use their
 * location to fill the place of signature." And on the blank forms: "Only use
 * the link."
 *
 * ⚠️ SO THE BLANK FORMS ARE GONE, and this is what the pack carries instead —
 * a statement somebody has actually signed, rather than two sheets of ruled
 * lines hoping they will. The block vocabulary is reused unchanged: what the
 * witness answered prints exactly where the blank version left room for it,
 * which is the cheapest possible guarantee that a question they answered
 * cannot be missing from the page they signed.
 *
 * ⚠️ NOTHING HERE IS OURS TO REWORD. Every value comes off the witness's own
 * submission; the only strings this function contributes are the labels that
 * were already on the form. A statement whose prose we improved is a statement
 * the witness did not make.
 */
export function buildCompletedStatement(input: {
  index: number;
  total: number;
  applicantName: string;
  referenceNumber: string;
  licenceTypeLabel: string;
  /** Field key -> what the witness typed. */
  answers: Record<string, string | undefined>;
  /** Their drawn signature, decrypted for this render. */
  signature?: Buffer;
  signedPlace?: string | null;
  signedAt?: Date | null;
  version: string;
}): CharacterStatementForm {
  const a = (k: string) => (input.answers[k] ?? '').trim();
  const fullName = [a('first_names'), a('surname')].filter(Boolean).join(' ');
  const relationship =
    a('relationship') === 'Other' && a('relationship_other')
      ? a('relationship_other')
      : a('relationship');

  const blocks: StatementBlock[] = [
    {
      kind: 'note',
      text:
        `This statement was completed and signed by the witness named below, ` +
        `on their own device, in support of ${input.applicantName}'s ` +
        `application (${input.licenceTypeLabel}), reference ` +
        `${input.referenceNumber}. Their identity was checked by a code sent ` +
        `to the mobile number recorded here.`,
    },

    { kind: 'part', label: 'PART A', title: 'WHO GAVE THIS STATEMENT' },
    { kind: 'value', label: 'Full name(s)', value: a('first_names') },
    { kind: 'value', label: 'Surname', value: a('surname') },
    { kind: 'value', label: 'Identity number', value: a('id_number') },
    { kind: 'value', label: 'Daytime contact number', value: a('daytime_phone') },

    { kind: 'part', label: 'PART B', title: 'HOW THEY KNOW THE APPLICANT' },
    { kind: 'value', label: 'The applicant', value: input.applicantName },
    { kind: 'value', label: 'Relationship', value: relationship },
    { kind: 'value', label: 'Known each other', value: a('known_for') },

    {
      kind: 'part',
      label: 'PART C',
      title: 'THE THREE QUESTIONS THE REGULATIONS ASK',
    },
    {
      kind: 'note',
      text:
        'Regulation 13(7) of the Firearms Control Regulations, 2004 requires ' +
        'anyone giving a recommendation about an applicant’s character to ' +
        'state whether, to the best of their knowledge and belief, the ' +
        'applicant is the three things below.',
    },
    ...WITNESS_QUESTIONS.map(
      (q): StatementBlock => ({
        kind: 'answered',
        number: q.number,
        text: `${q.text} ${NB}·${NB}reg${NB}${q.cite}`,
        answer: a(q.key) || 'Not answered',
      }),
    ),
    ...(a('explain')
      ? ([
          {
            kind: 'quote',
            label: 'Their explanation',
            text: a('explain'),
          },
        ] as StatementBlock[])
      : []),

    { kind: 'part', label: 'PART D', title: 'IN THEIR OWN WORDS' },
    ...(a('comment')
      ? ([{ kind: 'quote', label: '', text: a('comment') }] as StatementBlock[])
      : ([
          {
            kind: 'note',
            text: 'The witness did not add anything further.',
          },
        ] as StatementBlock[])),

    { kind: 'part', label: 'PART E', title: 'DECLARATION AND SIGNATURE' },
    {
      kind: 'text',
      text:
        `I, ${fullName || 'the witness named above'}, confirm that I read this ` +
        `form, that the answers in it are my own, and that they are true to ` +
        `the best of my knowledge and belief.`,
    },
    {
      kind: 'signed',
      name: fullName,
      signature: input.signature,
      place: input.signedPlace ?? '',
      // ⚠️ THE DATE IS OURS, THE REST IS THEIRS. It is the moment the server
      // recorded the submission, not something anybody typed — which is the
      // only version of a date on this page that cannot be wrong.
      date: input.signedAt ?? null,
    },
  ];

  return {
    title: 'CHARACTER WITNESS STATEMENT',
    eyebrow:
      input.total > 1
        ? `STATEMENT ${input.index} OF ${input.total}`
        : 'SIGNED STATEMENT',
    subtitle: `Completed and signed by ${fullName || 'the witness'}`,
    index: input.index,
    blocks,
    version: input.version,
  };
}
