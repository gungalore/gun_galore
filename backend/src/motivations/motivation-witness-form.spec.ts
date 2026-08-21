import {
  validateWitnessSubmission,
  witnessFullName,
  witnessNotices,
  witnessRelationship,
  WITNESS_ABOUT_FIELDS,
  WITNESS_ANSWERS,
  WITNESS_DECLARATIONS,
  WITNESS_FORM_VERSION,
  WITNESS_RELATIONSHIPS,
} from './motivation-witness-form';
import { buildCompletedStatement, WITNESS_QUESTIONS } from './motivation-character-statement';

// ────────────────────────────────────────────────────────────────────
// The statement is now filled in by a stranger on a phone, from a link, and
// printed straight into a pack that goes to the police. Nothing between those
// two points asks a human being whether the result makes sense — so what is
// checked here is the part that would fail silently: whether a question can
// still be answered honestly, and whether what the witness said is what the
// page prints.
// ────────────────────────────────────────────────────────────────────

const GOOD: Record<string, string> = {
  first_names: 'Anna Maria',
  surname: 'van der Merwe',
  id_number: '7802145009087',
  daytime_phone: '0835550142',
  relationship: 'Neighbour',
  known_for: 'About eleven years',
  fit_and_proper: 'Yes',
  stable_and_not_violent: 'Yes',
  not_dependent: 'Yes',
};

describe('the three statutory questions', () => {
  it('asks all three, in the order regulation 13(7) sets them', () => {
    expect(WITNESS_DECLARATIONS).toHaveLength(3);
    expect(WITNESS_DECLARATIONS[0].cite).toBe('reg 13(7)(a)');
    expect(WITNESS_DECLARATIONS[1].cite).toBe('reg 13(7)(b)');
    expect(WITNESS_DECLARATIONS[2].cite).toBe('reg 13(7)(c)');
    expect(WITNESS_DECLARATIONS[0].text).toMatch(/fit and proper/i);
    expect(WITNESS_DECLARATIONS[1].text).toMatch(/stable mental condition/i);
    expect(WITNESS_DECLARATIONS[1].text).toMatch(/inclined to violence/i);
    expect(WITNESS_DECLARATIONS[2].text).toMatch(/intoxicating or narcotic/i);
  });

  it('lets every question be answered negatively', () => {
    // ⚠️ THE LOAD-BEARING TEST. reg 13(7) says the witness must state WHETHER
    // the applicant is these things — the answer is allowed to be no. A form
    // offering only "Yes" is not a statement, it is a signature block, and
    // moving it onto a phone does not make that any more honest.
    expect(WITNESS_ANSWERS).toContain('Yes');
    expect(WITNESS_ANSWERS).toContain('No');
    expect(WITNESS_ANSWERS).toContain('I am not able to say');
  });

  it('is the same list the printed statement uses', () => {
    // Two files describe these questions: what the witness is asked, and how
    // the answer is set. They must not drift — a printed question that differs
    // from the one somebody answered is a document misquoting them.
    expect(WITNESS_QUESTIONS.map((q) => q.key)).toEqual(
      WITNESS_DECLARATIONS.map((d) => d.key),
    );
    for (let i = 0; i < WITNESS_QUESTIONS.length; i += 1) {
      expect(WITNESS_QUESTIONS[i].text).toBe(WITNESS_DECLARATIONS[i].text);
      expect(WITNESS_DECLARATIONS[i].cite).toContain(WITNESS_QUESTIONS[i].cite);
    }
  });
});

describe('validateWitnessSubmission', () => {
  it('accepts a complete, ordinary statement', () => {
    expect(validateWitnessSubmission(GOOD).ok).toBe(true);
  });

  it('will not accept a statement with a question unanswered', () => {
    const r = validateWitnessSubmission({ ...GOOD, not_dependent: '' });
    expect(r.ok).toBe(false);
    expect(r.problems.not_dependent).toBeTruthy();
  });

  it('refuses an answer that is not one of the three', () => {
    const r = validateWitnessSubmission({ ...GOOD, fit_and_proper: 'Maybe' });
    expect(r.ok).toBe(false);
  });

  it('⚠️ MAKES A NEGATIVE ANSWER EXPLAIN ITSELF', () => {
    // This rule is for the READER, not for us. "No" on its own tells a
    // Designated Firearms Officer that something is wrong and nothing about
    // what — worse for the applicant than a full answer, and unfair to the
    // witness, who may have meant something quite narrow.
    const bare = validateWitnessSubmission({ ...GOOD, not_dependent: 'No' });
    expect(bare.ok).toBe(false);
    expect(bare.problems.explain).toBeTruthy();

    const explained = validateWitnessSubmission({
      ...GOOD,
      not_dependent: 'No',
      explain: 'He gave up drinking two years ago and I have seen him refuse it since.',
    });
    expect(explained.ok).toBe(true);
  });

  it('treats "I am not able to say" as needing the same explanation', () => {
    const r = validateWitnessSubmission({
      ...GOOD,
      stable_and_not_violent: 'I am not able to say',
    });
    expect(r.ok).toBe(false);
    expect(r.problems.explain).toBeTruthy();
  });

  it('requires the details a Designated Firearms Officer needs', () => {
    for (const key of [
      'first_names',
      'surname',
      'id_number',
      'daytime_phone',
      'relationship',
      'known_for',
    ]) {
      const r = validateWitnessSubmission({ ...GOOD, [key]: '' });
      expect(r.ok).toBe(false);
      expect(r.problems[key]).toBeTruthy();
    }
  });

  it('nudges on an identity number without refusing a passport', () => {
    // A passport holder is a perfectly good witness and this field has to take
    // one — so the check is a nudge about shape, not a Luhn gate.
    const r = validateWitnessSubmission({ ...GOOD, id_number: 'A0123456' });
    expect(r.problems.id_number).toMatch(/passport/i);
  });

  it('will not let "Other" be a relationship that says nothing', () => {
    const r = validateWitnessSubmission({ ...GOOD, relationship: 'Other' });
    expect(r.ok).toBe(false);
    expect(r.problems.relationship_other).toBeTruthy();
  });

  it('offers "Other" at all', () => {
    // A closed list that cannot describe a relationship pushes people into the
    // nearest wrong box, and a DFO reading "Friend" where the truth was "my
    // pastor" has been told something false by our dropdown.
    expect(WITNESS_RELATIONSHIPS).toContain('Other');
    expect(WITNESS_RELATIONSHIPS.length).toBeGreaterThan(5);
  });
});

describe('what the witness is told before they sign', () => {
  const notices = witnessNotices('Gerhard Fourie').join(' ');

  it('names who is asking and says it is voluntary', () => {
    expect(notices).toMatch(/Gerhard Fourie has asked you/);
    expect(notices).toMatch(/voluntary/i);
  });

  it('states regulation 13(8) in full — contactable, not compelled', () => {
    expect(notices).toMatch(/may contact you/i);
    expect(notices).toMatch(/not compelled/i);
    expect(notices).toMatch(/13\(8\)/);
  });

  it('⚠️ SAYS WHERE THE STATEMENT ACTUALLY GOES', () => {
    // The operator's own disclosure, in the direction it truly travels: we
    // hand it to the applicant, and the applicant files it. Saying "we send it
    // to the police" would be false — we never touch SAPS.
    expect(notices).toMatch(/given to Gerhard Fourie and to nobody else by us/i);
    expect(notices).toMatch(/files it with the police/i);
    expect(notices).toMatch(/We do not send it to the police ourselves/i);
  });

  it('⚠️ SAYS THE APPLICANT MAY DECIDE NOT TO FILE IT', () => {
    // The applicant can delete a completed statement — their right on their
    // own application. A witness who is not told that has been allowed to
    // assume their answers reach the Registrar whatever they are.
    expect(notices).toMatch(/may decide not to file it/i);
  });

  it('warns about the offence AND says a negative answer is allowed', () => {
    // Both halves or neither: telling a member of the public they may be
    // prosecuted for a wrong answer, without telling them they are free to
    // answer "No", is pressure applied to somebody doing a favour.
    expect(notices).toMatch(/120\(9\)\(f\)/);
    expect(notices).toMatch(/are proper answers/i);
  });

  it('tells the applicant to keep their hands off it', () => {
    expect(notices).toMatch(/must not complete any part of it for you/i);
  });

  it('explains why it asks a stranger for their identity number', () => {
    // An unexplained demand for an ID number over an SMS link reads like a
    // scam — which is exactly what somebody sensible would assume.
    const idField = WITNESS_ABOUT_FIELDS.find((f) => f.key === 'id_number');
    expect(idField?.hint).toMatch(/officer needs this/i);
  });

  it('keeps the draft marker until an attorney has read the wording', () => {
    expect(WITNESS_FORM_VERSION).toMatch(/-draft$/);
  });
});

describe('the printed statement', () => {
  const built = buildCompletedStatement({
    index: 1,
    total: 2,
    applicantName: 'Gerhard Fourie',
    referenceNumber: 'MO000017',
    licenceTypeLabel: 'Section 16 — dedicated hunter',
    answers: { ...GOOD, comment: 'A steady, careful man.' },
    signedPlace: 'Kraaifontein',
    signedAt: new Date('2026-08-21T11:14:00Z'),
    version: WITNESS_FORM_VERSION,
  });

  const text = built.blocks
    .map((b) =>
      'text' in b
        ? b.text
        : 'value' in b
          ? b.value
          : 'name' in b
            ? b.name
            : '',
    )
    .join(' | ');

  it('prints what the witness actually said', () => {
    expect(text).toContain('Anna Maria');
    expect(text).toContain('van der Merwe');
    expect(text).toContain('7802145009087');
    expect(text).toContain('Neighbour');
    expect(text).toContain('About eleven years');
    expect(text).toContain('A steady, careful man.');
  });

  it('carries all three answers', () => {
    const answered = built.blocks.filter((b) => b.kind === 'answered');
    expect(answered).toHaveLength(3);
    for (const a of answered) {
      if (a.kind === 'answered') expect(a.answer).toBe('Yes');
    }
  });

  it('records where and when it was signed', () => {
    const signed = built.blocks.find((b) => b.kind === 'signed');
    expect(signed).toBeDefined();
    if (signed?.kind === 'signed') {
      expect(signed.place).toBe('Kraaifontein');
      expect(signed.date).toBeInstanceOf(Date);
      expect(signed.name).toBe('Anna Maria van der Merwe');
    }
  });

  it('says the statement was signed electronically and how identity was checked', () => {
    const notes = built.blocks
      .filter((b) => b.kind === 'note')
      .map((b) => (b.kind === 'note' ? b.text : ''))
      .join(' ');
    expect(notes).toMatch(/signed by the witness named below, on their own device/i);
    expect(notes).toMatch(/code sent to the mobile number/i);
  });

  it('says so when the witness added nothing', () => {
    // ⚠️ NOT A BLANK SPACE. An empty section reads as a page that failed to
    // print; "the witness did not add anything further" is a fact.
    const quiet = buildCompletedStatement({
      index: 1,
      total: 1,
      applicantName: 'Gerhard Fourie',
      referenceNumber: 'MO000017',
      licenceTypeLabel: 'Section 16',
      answers: GOOD,
      version: WITNESS_FORM_VERSION,
    });
    const notes = quiet.blocks
      .filter((b) => b.kind === 'note')
      .map((b) => (b.kind === 'note' ? b.text : ''))
      .join(' ');
    expect(notes).toMatch(/did not add anything further/i);
  });
});

describe('small helpers', () => {
  it('joins the name the way the witness gave it', () => {
    expect(witnessFullName(GOOD)).toBe('Anna Maria van der Merwe');
  });

  it('prints what they typed when the relationship is "Other"', () => {
    expect(
      witnessRelationship({ relationship: 'Other', relationship_other: 'My pastor' }),
    ).toBe('My pastor');
    expect(witnessRelationship({ relationship: 'Neighbour' })).toBe('Neighbour');
  });
});
