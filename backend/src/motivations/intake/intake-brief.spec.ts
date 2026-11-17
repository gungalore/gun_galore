import { MotivationLicenceType } from '@prisma/client';
import {
  INTERVIEW_BRIEF_VERSION,
  askableFields,
  briefFacts,
  briefHash,
  composeAcknowledgement,
  deterministicBrief,
  forbiddenValues,
  isSafeChip,
  validateBrief,
} from './intake-brief';
import { fieldByKey } from '../motivation-fields';

const S16 = MotivationLicenceType.S16_DEDICATED_HUNTER;

describe('the brief hash', () => {
  it('ignores answers that do not change the questions', () => {
    const base = {
      firearm_type: 'Rifle',
      firearm_calibre: '.30-06 Springfield',
    };
    expect(briefHash(S16, base)).toBe(
      briefHash(S16, { ...base, marital_status: 'Married', occupation: 'Farmer' }),
    );
  });

  it('changes when the calibre, purpose or section changes', () => {
    const base = { firearm_type: 'Rifle', firearm_calibre: '.30-06' };
    expect(briefHash(S16, base)).not.toBe(
      briefHash(S16, { ...base, firearm_calibre: '.375 H&H' }),
    );
    expect(briefHash(S16, base)).not.toBe(
      briefHash(S16, { ...base, firearm_use_kind: 'sport' }),
    );
    expect(briefHash(S16, base)).not.toBe(
      briefHash(MotivationLicenceType.S16_DEDICATED_SPORT, base),
    );
  });
});

describe('what the brief may ask about', () => {
  it('never offers a sensitive, form-only or declaration field', () => {
    const keys = askableFields(S16).map((field) => field.key);
    for (const forbidden of [
      'full_name',
      'id_number',
      'firearm_serial',
      'residential_address',
      'history_conviction',
      'spouse_name',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('offers the purpose fields the interview actually asks', () => {
    const keys = askableFields(S16).map((field) => field.key);
    expect(keys).toContain('intended_quarry');
    expect(keys).toContain('hunt_game_class');
    expect(keys).toContain('discipline_exercise');
  });

  it('never offers a section 13 threat answer to the model', () => {
    const keys = askableFields(
      MotivationLicenceType.S13_SELF_DEFENCE,
    ).map((field) => field.key);
    // It is sensitive free text; the interview asks it with its own control.
    expect(keys).not.toContain('threat_circumstances');
    expect(keys).toContain('premises_enclosure');
  });
});

describe('the facts projection', () => {
  const answers = {
    firearm_type: 'Rifle',
    firearm_make: 'Tikka',
    firearm_model: 'T3x',
    firearm_calibre: '.30-06',
    firearm_use_kind: 'hunting',
    firearm_serial: 'ABC123',
    full_name: 'Gerhard Fourie',
    id_number: '8001015009087',
    residential_address: '12 Main Road, Bethlehem',
    spouse_name: 'Annelie Fourie',
  };

  it('keeps the application facts', () => {
    const labels = briefFacts(S16, answers).map((fact) => fact.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Firearm', 'Calibre', 'Purpose']),
    );
  });

  it('never includes a name, ID, serial or address', () => {
    const text = JSON.stringify(briefFacts(S16, answers));
    expect(text).not.toContain('Gerhard');
    expect(text).not.toContain('8001015009087');
    expect(text).not.toContain('ABC123');
    expect(text).not.toContain('12 Main Road');
    expect(text).not.toContain('Annelie');
  });

  it('collects the sensitive values that a brief must never echo', () => {
    const forbidden = forbiddenValues(S16, answers);
    expect(forbidden).toContain('abc123');
    expect(forbidden).toContain('8001015009087');
  });
});

describe('validating a brief', () => {
  const facts = [{ label: 'Calibre', value: '.30-06' }];
  const forbidden = ['abc123'];
  const valid = (raw: unknown) =>
    validateBrief({ type: S16, raw, facts, hash: 'h', forbidden });

  it('keeps a question that ends in a question mark', () => {
    const brief = valid({
      questions: [
        {
          fieldKey: 'intended_quarry',
          question: 'What do you hunt with this .30-06?',
          why: 'The DFO reads the quarry against the calibre.',
        },
      ],
    });
    expect(brief.questions).toHaveLength(1);
    expect(brief.questions[0].question).toContain('?');
  });

  it('drops a field key that was never offered', () => {
    const brief = valid({
      questions: [
        { fieldKey: 'not_a_field', question: 'What?', why: 'Because.' },
        { fieldKey: 'intended_quarry', question: 'What?', why: 'Because.' },
      ],
    });
    expect(brief.questions.map((q) => q.fieldKey)).toEqual(['intended_quarry']);
  });

  it('drops a question or chip that leaks a sensitive value', () => {
    const brief = valid({
      questions: [
        {
          fieldKey: 'intended_quarry',
          question: 'Is ABC123 the serial you hunt with?',
          why: 'Because.',
        },
      ],
      chips: [{ fieldKey: 'intended_quarry', choices: [{ value: 'ABC123', label: 'ABC123' }] }],
    });
    expect(brief.questions).toEqual([]);
    expect(brief.chips).toEqual({});
  });

  it('drops a chip that argues or predicts', () => {
    const brief = valid({
      chips: [
        {
          fieldKey: 'intended_quarry',
          choices: [
            { value: 'Therefore I need it', label: 'Therefore I need it' },
            { value: 'Kudu', label: 'Kudu' },
          ],
        },
      ],
    });
    expect(brief.chips.intended_quarry).toEqual([
      { value: 'Kudu', label: 'Kudu' },
    ]);
    expect(isSafeChip('Therefore I need it')).toBe(false);
    expect(isSafeChip('Kudu')).toBe(true);
    // A product standard is a fact, not a promise about the application.
    expect(isSafeChip('I have a SABS-approved safe')).toBe(true);
    expect(isSafeChip('This will be approved')).toBe(false);
  });

  it('de-duplicates and caps the chips', () => {
    const brief = valid({
      chips: [
        {
          fieldKey: 'intended_quarry',
          choices: Array.from({ length: 9 }, (_, i) => ({
            value: `Species ${i}`,
            label: `Species ${i}`,
          })).concat([
            { value: 'species 0', label: 'Species 0' },
          ]),
        },
      ],
    });
    expect(brief.chips.intended_quarry).toHaveLength(6);
  });

  it('keeps the local facts and only lets the model add', () => {
    const brief = valid({
      facts: [
        { label: 'Calibre', value: 'something else' },
        { label: 'Discipline', value: 'IPSC Practical Rifle' },
      ],
    });
    const calibre = brief.facts.filter((f) => f.label === 'Calibre');
    expect(calibre).toHaveLength(1);
    expect(calibre[0].value).toBe('.30-06');
    expect(brief.facts.map((f) => f.label)).toContain('Discipline');
  });

  it('stamps the current version', () => {
    expect(valid({}).version).toBe(INTERVIEW_BRIEF_VERSION);
  });
});

describe('the deterministic brief', () => {
  it('asks the gate’s own gaps when no model is available', () => {
    const brief = deterministicBrief({
      type: S16,
      answers: { firearm_use_kind: 'hunting' },
      hash: 'h',
    });
    expect(brief.researched).toBe(false);
    expect(brief.questions.map((q) => q.fieldKey)).toEqual(
      expect.arrayContaining(['intended_quarry', 'shooting_history']),
    );
    expect(brief.questions[0].why).toBeTruthy();
  });
});

describe('the acknowledgement', () => {
  const house = fieldByKey(S16, 'residence_type');
  const history = fieldByKey(S16, 'shooting_history');
  const serial = fieldByKey(S16, 'firearm_serial');

  it('echoes a closed answer in the member’s words', () => {
    expect(composeAcknowledgement(house, 'House')).toBe('Got it — House.');
  });

  it('does not paraphrase a long, card or sensitive answer', () => {
    expect(composeAcknowledgement(history, 'I grew up hunting with my father')).toBe(
      'Noted.',
    );
    expect(composeAcknowledgement(serial, 'ABC123')).toBe('Noted.');
  });

  it('says Noted rather than echo a value that is not one of the answers', () => {
    expect(
      composeAcknowledgement(house, 'Rifle Bolt action Tikka .30-06 serial ABC'),
    ).toBe('Noted.');
  });

  it('says nothing when there is no answer', () => {
    expect(composeAcknowledgement(house, '')).toBeUndefined();
  });
});
