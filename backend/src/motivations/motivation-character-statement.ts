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
  /** A ruled write-on line. `value` prefills it (typed, not written). */
  | { kind: 'field'; label: string; span: 'full' | 'half'; value?: string }
  /** Tick boxes on one line. */
  | { kind: 'choice'; label: string; options: string[] }
  /** One of the regulation 13(7) questions, with its boxes. */
  | { kind: 'declare'; number: string; text: string; options: string[] }
  /**
   * Blank ruled lines to write on.
   *
   * `'fill'` means "as many as fit before the blocks after you" — see the
   * renderer. Used for the one free-text section, so that whatever room is
   * left on the sheet becomes writing space instead of white space.
   */
  | { kind: 'lines'; label?: string; count: number | 'fill' }
  /** The signature row: signature, date, place. */
  | { kind: 'sign' }
  /** The commissioner-of-oaths box, used only if a DFO asks for one. */
  | { kind: 'commissioner' };

export interface CharacterStatementForm {
  title: string;
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

/** The three answers. Order matters: the positive one first, then the outs. */
const ANSWERS = ['Yes', 'No', 'I am not able to say'];

/**
 * Build one form.
 *
 * Pure and deterministic, like the prior-notice builder — the pack is
 * re-rendered from stored answers on every download, so anything that varied
 * per call would produce a different document each time somebody opened it.
 */
export function buildCharacterStatement(
  input: CharacterStatementInput,
  index: number,
): CharacterStatementForm {
  const who = input.applicantName;
  const ordinal = index === 1 ? 'first' : 'second';

  const blocks: StatementBlock[] = [
    {
      kind: 'note',
      text:
        `${who} has asked you to give a character reference in support of an ` +
        `application to the South African Police Service for a firearm ` +
        `licence (${input.licenceTypeLabel}). This page is that reference. ` +
        `Please read it, answer every question yourself, and sign at the end. ` +
        `${who} should not complete any part of it for you.`,
    },
    {
      kind: 'note',
      text:
        'Four things you are entitled to know before you begin. Giving this ' +
        'reference is voluntary. The Designated Firearms Officer may contact ' +
        'you afterwards about it; you are not compelled to say more, though a ' +
        'reference may be treated as ineffective if you do not (reg 13(8)). ' +
        'Your name, identity number and contact details go to the police with ' +
        'the application so they can reach you. And this forms part of an ' +
        'application under the Firearms Control Act 60 of 2000, where section ' +
        '120(9)(f) makes it an offence to supply information knowing it to be ' +
        'false, incorrect or misleading, or not believing it to be correct.',
    },
    {
      // ⚠️ THE MOST IMPORTANT SENTENCE ON THE PAGE. It comes directly after
      // the offence warning on purpose: a person told they may be prosecuted
      // for a wrong answer, and not told that "No" is an answer, is a person
      // being pressured to sign. Both halves or neither.
      kind: 'note',
      text:
        'If you cannot answer a question with a yes, say so. "No" and "I am ' +
        'not able to say" are proper answers, and a reference that is not true ' +
        'is of no use to anybody.',
    },

    { kind: 'part', label: 'PART A', title: 'WHO YOU ARE' },
    {
      kind: 'field',
      label: 'Full name, as it appears on your identity document',
      span: 'full',
    },
    { kind: 'field', label: 'Identity or passport number', span: 'half' },
    { kind: 'field', label: 'Contact number', span: 'half' },
    { kind: 'field', label: 'Email address', span: 'half' },
    { kind: 'field', label: 'Occupation', span: 'half' },
    { kind: 'field', label: 'Residential address', span: 'full' },
    { kind: 'field', label: '', span: 'full' },

    { kind: 'part', label: 'PART B', title: 'HOW YOU KNOW THE APPLICANT' },
    {
      // Prefilled, so the page can never be attached to the wrong file and the
      // referee is never in doubt about whom they are writing about.
      kind: 'field',
      label: 'The applicant',
      span: 'half',
      value: who,
    },
    {
      kind: 'field',
      label: 'Application reference',
      span: 'half',
      value: input.referenceNumber,
    },
    {
      kind: 'choice',
      label: 'In what capacity do you know the applicant?',
      options: [
        'Employer or colleague',
        'Neighbour',
        'Friend',
        'Fellow club or association member',
        'Family member',
        'Other',
      ],
    },
    { kind: 'field', label: 'If other, please say', span: 'half' },
    { kind: 'field', label: 'How long have you known them?', span: 'half' },
    {
      kind: 'choice',
      label: 'How often are you in contact?',
      options: ['Daily', 'Weekly', 'Monthly', 'A few times a year'],
    },

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
        'applicant is the three things below. Answer each from your own ' +
        'knowledge of them, and tick one box for each.',
    },
    {
      kind: 'declare',
      number: '1',
      text:
        'Is the applicant a fit and proper person to be issued with the ' +
        `firearm licence applied for? ·${NB}reg${NB}13(7)(a)`,
      options: ANSWERS,
    },
    {
      kind: 'declare',
      number: '2',
      text:
        'Is the applicant of a stable mental condition, and not inclined to ' +
        `violence? ·${NB}reg${NB}13(7)(b)`,
      options: ANSWERS,
    },
    {
      kind: 'declare',
      number: '3',
      text:
        'Is the applicant free of dependence on any substance which has an ' +
        `intoxicating or narcotic effect? ·${NB}reg${NB}13(7)(c)`,
      options: ANSWERS,
    },
    {
      kind: 'lines',
      label:
        'If you answered “No” or “I am not able to say” to any of the three, ' +
        'please explain here',
      count: 2,
    },

    {
      kind: 'part',
      label: 'PART D',
      title: 'ANYTHING ELSE YOU WOULD LIKE TO ADD',
    },
    {
      kind: 'note',
      text:
        'Optional, and in your own words. How you know the applicant, and ' +
        'anything about their character you think the Registrar should know. ' +
        'There is no right answer and no need to fill the space.',
    },
    // ⚠️ 'fill', NOT A NUMBER. This is the only open section on the form, and
    // it is the last thing before the declaration — so it is exactly where a
    // fixed count either strands the signature on a third sheet or leaves a
    // hand's width of nothing above it. Filling makes the form two sheets and
    // hands the leftover to the referee to write in.
    { kind: 'lines', count: 'fill' },

    { kind: 'part', label: 'PART E', title: 'YOUR DECLARATION' },
    {
      kind: 'text',
      text:
        'I confirm that I have read this page, that the answers above are my ' +
        'own, and that they are true to the best of my knowledge and belief.',
    },
    { kind: 'sign' },
    {
      kind: 'note',
      text:
        'Only if you have been asked to have this commissioned: take it and ' +
        'your identity document to a commissioner of oaths — any police ' +
        'station, or a practising attorney — and do not sign above until you ' +
        'are in front of them. Otherwise leave the block below blank.',
    },
    { kind: 'commissioner' },
  ];

  return {
    title: 'CHARACTER REFERENCE',
    subtitle: `Statement by the ${ordinal} of two people who know the applicant`,
    index,
    blocks,
    version: CHARACTER_STATEMENT_VERSION,
  };
}

/** Both forms, in order. */
export function buildCharacterStatements(
  input: CharacterStatementInput,
): CharacterStatementForm[] {
  return Array.from({ length: CHARACTER_STATEMENT_COUNT }, (_, i) =>
    buildCharacterStatement(input, i + 1),
  );
}

/**
 * The applicant-facing instruction, for the checklist row.
 *
 * Kept here beside the form so the two cannot drift apart — the checklist
 * telling somebody to "get two character references" while the pack contains
 * forms with different instructions on them is exactly the kind of quiet
 * contradiction that made the prior-notice tick box wrong for months.
 */
export const CHARACTER_STATEMENT_GUIDANCE =
  'Your pack contains two blank character reference forms, near the back. ' +
  'Print them and give one each to two people who know you — ideally in ' +
  'different parts of your life, such as an employer and a neighbour, rather ' +
  'than two people who know you the same way. They fill them in themselves ' +
  'and sign them; you must not complete any part of them. Upload the signed ' +
  'forms here when you get them back.';
