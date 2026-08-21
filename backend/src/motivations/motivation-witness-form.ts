// ────────────────────────────────────────────────────────────────────
// WHAT THE WITNESS IS ASKED, AND IN WHAT ORDER.
//
// Operator, 2026-08-21: "We require the following: Full name(s), Surname, ID
// number, Contact number to be reached on during the daytime, Relationship
// with applicant (give them a dropdown menu), how long they have known each
// other, the three ticks, a free comment form, auto date, location of
// statement (phone gps), physical signature."
//
// ⚠️ ONE DEFINITION, TWO CONSUMERS. The web form the witness fills in and the
// statement that prints into the pack are generated from THIS file. They were
// nearly written twice — a set of React fields and a set of pdfkit blocks —
// and the failure mode of that is a question the witness never answered
// appearing blank on a document they signed, or worse, an answer they gave
// quietly not printing at all.
//
// ⚠️ THE THREE STATUTORY QUESTIONS ARE UNCHANGED FROM THE PAPER FORM. See
// motivation-character-statement.ts: regulation 13(7) says the witness must
// state WHETHER the applicant is these three things, so "No" and "I am not
// able to say" are answers, not failures. Moving the form onto a phone does
// not make a form that only permits agreement any more honest.
// ────────────────────────────────────────────────────────────────────

/** Bumped when the questions change; stamped on the printed statement. */
export const WITNESS_FORM_VERSION = 'ws-2026-08-a-draft';

export type WitnessFieldKind = 'text' | 'tel' | 'id' | 'select' | 'longtext';

export interface WitnessField {
  key: string;
  label: string;
  kind: WitnessFieldKind;
  /** Shown under the input — why we ask, or how to answer. */
  hint?: string;
  required: boolean;
  maxLength: number;
  choices?: readonly string[];
}

/**
 * How the witness knows the applicant.
 *
 * ⚠️ "OTHER" IS LAST AND IT IS REAL. A closed list that cannot describe a
 * relationship pushes people into the nearest wrong box, and a DFO reading
 * "Friend" where the truth was "my pastor" has been told something slightly
 * false by our dropdown rather than by the witness.
 */
export const WITNESS_RELATIONSHIPS = [
  'Employer',
  'Colleague',
  'Neighbour',
  'Friend',
  'Fellow club or association member',
  'Hunting or shooting partner',
  'Family member',
  'Business associate',
  'Professional adviser',
  'Other',
] as const;

/** Step 3 — who the witness is. */
export const WITNESS_ABOUT_FIELDS: readonly WitnessField[] = [
  {
    key: 'first_names',
    label: 'Full name(s)',
    kind: 'text',
    hint: 'As they appear on your identity document.',
    required: true,
    maxLength: 120,
  },
  {
    key: 'surname',
    label: 'Surname',
    kind: 'text',
    required: true,
    maxLength: 80,
  },
  {
    key: 'id_number',
    label: 'Identity number',
    kind: 'id',
    // ⚠️ SAY WHY. Asking a stranger for their identity number over an SMS link
    // is a large ask, and an unexplained one reads like a scam — which is
    // exactly what somebody sensible would assume.
    hint: 'The Designated Firearms Officer needs this to identify who gave the statement.',
    required: true,
    maxLength: 20,
  },
  {
    key: 'daytime_phone',
    label: 'Daytime contact number',
    kind: 'tel',
    hint: 'A number you can be reached on during working hours — the officer may phone you about this statement.',
    required: true,
    maxLength: 20,
  },
  {
    key: 'relationship',
    label: 'How do you know the applicant?',
    kind: 'select',
    required: true,
    maxLength: 60,
    choices: WITNESS_RELATIONSHIPS,
  },
  {
    key: 'relationship_other',
    label: 'If other, please say',
    kind: 'text',
    required: false,
    maxLength: 80,
  },
  {
    key: 'known_for',
    label: 'How long have you known each other?',
    kind: 'text',
    hint: 'For example: “about six years”.',
    required: true,
    maxLength: 60,
  },
];

/** The three questions regulation 13(7) prescribes, in its order. */
export const WITNESS_DECLARATIONS = [
  {
    key: 'fit_and_proper',
    number: '1',
    text: 'Is the applicant a fit and proper person to be issued with the firearm licence applied for?',
    cite: 'reg 13(7)(a)',
  },
  {
    key: 'stable_and_not_violent',
    number: '2',
    text: 'Is the applicant of a stable mental condition, and not inclined to violence?',
    cite: 'reg 13(7)(b)',
  },
  {
    key: 'not_dependent',
    number: '3',
    text: 'Is the applicant free of dependence on any substance which has an intoxicating or narcotic effect?',
    cite: 'reg 13(7)(c)',
  },
] as const;

/** The only three answers. Order matters: the positive one, then the outs. */
export const WITNESS_ANSWERS = [
  'Yes',
  'No',
  'I am not able to say',
] as const;

export type WitnessAnswer = (typeof WITNESS_ANSWERS)[number];

export const WITNESS_EXPLAIN_KEY = 'explain';
export const WITNESS_COMMENT_KEY = 'comment';

/**
 * What the witness is told before they start.
 *
 * ⚠️ THE DISCLOSURE SENTENCE IS THE OPERATOR'S, and it is the honest one:
 * "remember the disclaimer that we will share this form with all it's contents
 * with only the applicant (as this essentially true, they will give it to the
 * DFO)". We hand it to the applicant; the applicant files it. Saying "we send
 * it to the police" would be false — we never touch SAPS — and saying nothing
 * would leave somebody signing without knowing where it goes.
 *
 * ⚠️ AND IT SAYS THE APPLICANT CAN DECIDE NOT TO FILE IT. They can delete a
 * completed statement, which is their right on their own application. A
 * witness who is not told that has been allowed to assume their answers reach
 * the Registrar whatever they are.
 */
export function witnessNotices(applicantName: string): readonly string[] {
  return [
    `${applicantName} has asked you to give a character statement in support of an application to the South African Police Service for a firearm licence. This form is that statement. Please answer every question yourself — ${applicantName} must not complete any part of it for you.`,

    'Giving this statement is voluntary. The Designated Firearms Officer may contact you afterwards about it; you are not compelled to say more, though a statement may be treated as ineffective if you do not (regulation 13(8) of the Firearms Control Regulations, 2004).',

    // The operator's disclosure line, stated in the direction it actually
    // travels.
    `What you write here is given to ${applicantName} and to nobody else by us. ${applicantName} then files it with the police as part of their application, and may decide not to file it at all. We do not send it to the police ourselves and we do not use it for anything else.`,

    'Your answers form part of an application under the Firearms Control Act 60 of 2000, where section 120(9)(f) makes it an offence to supply information knowing it to be false, incorrect or misleading, or not believing it to be correct. If you cannot answer a question with a yes, say so — “No” and “I am not able to say” are proper answers, and a statement that is not true is of no use to anybody.',
  ];
}

/**
 * Everything the witness typed, as it is stored and later printed.
 *
 * A plain record rather than a class: it is encrypted as JSON on the row and
 * has to survive being read back by a future version that may know about more
 * fields than the one that wrote it.
 */
export interface WitnessAnswers {
  [key: string]: string | undefined;
}

export interface WitnessValidationResult {
  ok: boolean;
  /** Field key -> what is wrong with it, phrased for the witness. */
  problems: Record<string, string>;
}

/**
 * Check a submission before it is stored.
 *
 * ⚠️ ON THE SERVER, WHATEVER THE FORM DOES. The witness page is a public route
 * reachable with a token and a browser; nothing about it is trustworthy. This
 * is the only check that actually runs.
 */
export function validateWitnessSubmission(
  answers: WitnessAnswers,
): WitnessValidationResult {
  const problems: Record<string, string> = {};
  const val = (k: string) => (answers[k] ?? '').trim();

  for (const f of WITNESS_ABOUT_FIELDS) {
    const v = val(f.key);
    if (!v) {
      if (f.required) problems[f.key] = 'Please fill this in.';
      continue;
    }
    if (v.length > f.maxLength) {
      problems[f.key] = `Please keep this under ${f.maxLength} characters.`;
      continue;
    }
    if (f.kind === 'select' && f.choices && !f.choices.includes(v)) {
      problems[f.key] = 'Please choose one of the options.';
    }
    if (f.kind === 'id' && !/^\d{13}$/.test(v.replace(/\s/g, ''))) {
      // Not a Luhn check: a passport holder is a perfectly good witness and
      // this field has to take one. Thirteen digits is the shape SAPS expects
      // for a South African identity number, and anything else is passed
      // through with a nudge rather than refused.
      problems[f.key] =
        'A South African identity number is 13 digits. If you are using a passport number, ignore this.';
    }
    if (f.kind === 'tel' && v.replace(/\D/g, '').length < 9) {
      problems[f.key] = 'That does not look like a phone number.';
    }
  }

  // "Other" without saying what is a dropdown that told us nothing.
  if (val('relationship') === 'Other' && !val('relationship_other')) {
    problems.relationship_other = 'Please say how you know the applicant.';
  }

  for (const d of WITNESS_DECLARATIONS) {
    const v = val(d.key);
    if (!v) {
      problems[d.key] = 'Please answer this question.';
    } else if (!(WITNESS_ANSWERS as readonly string[]).includes(v)) {
      problems[d.key] = 'Please choose one of the three answers.';
    }
  }

  // ⚠️ A NEGATIVE ANSWER MUST BE EXPLAINED, and this is the one rule here that
  // is for the READER rather than for us. "No" on its own tells a Designated
  // Firearms Officer that something is wrong and nothing about what — which is
  // worse for the applicant than a full answer, and unfair to the witness, who
  // may have meant something quite narrow.
  const negative = WITNESS_DECLARATIONS.some((d) =>
    ['No', 'I am not able to say'].includes(val(d.key)),
  );
  if (negative && val(WITNESS_EXPLAIN_KEY).length < 10) {
    problems[WITNESS_EXPLAIN_KEY] =
      'Please explain your answer in a sentence or two.';
  }

  const comment = val(WITNESS_COMMENT_KEY);
  if (comment.length > 1500) {
    problems[WITNESS_COMMENT_KEY] = 'Please keep this under 1500 characters.';
  }
  if (val(WITNESS_EXPLAIN_KEY).length > 1500) {
    problems[WITNESS_EXPLAIN_KEY] = 'Please keep this under 1500 characters.';
  }

  return { ok: Object.keys(problems).length === 0, problems };
}

/** "Johan Petrus" + "Fourie" -> "Johan Petrus Fourie". */
export function witnessFullName(answers: WitnessAnswers): string {
  return [answers.first_names, answers.surname]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** The relationship as it should print — the choice, or what they typed. */
export function witnessRelationship(answers: WitnessAnswers): string {
  const r = (answers.relationship ?? '').trim();
  const other = (answers.relationship_other ?? '').trim();
  if (r === 'Other' && other) return other;
  return r;
}
