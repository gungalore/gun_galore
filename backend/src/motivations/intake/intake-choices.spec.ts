import {
  MAX_CHOICE_LENGTH,
  MAX_INTERVIEW_CHOICES,
  addCustomChoice,
  normaliseChoices,
} from './intake-choices';

describe('normaliseChoices', () => {
  it('turns a plain list of strings into value/label pairs', () => {
    expect(normaliseChoices(['Kudu', 'Impala'])).toEqual([
      { value: 'Kudu', label: 'Kudu' },
      { value: 'Impala', label: 'Impala' },
    ]);
  });

  it('keeps a usable label when the model supplies one', () => {
    expect(
      normaliseChoices([{ value: 's16', label: 'Dedicated hunter' }]),
    ).toEqual([{ value: 's16', label: 'Dedicated hunter' }]);
  });

  it('uses the label as the value when the value is missing', () => {
    expect(normaliseChoices([{ label: 'Blue wildebeest' }])).toEqual([
      { value: 'Blue wildebeest', label: 'Blue wildebeest' },
    ]);
  });

  // ⚠️ Two buttons that read the same are one answer with a duplicate the
  // member can tap twice. Trailing punctuation is the model's favourite way to
  // produce it.
  it('drops answers that differ only by case or a trailing full stop', () => {
    expect(
      normaliseChoices(['I own a farm', 'i own a farm.', 'I own a farm!']),
    ).toEqual([{ value: 'I own a farm', label: 'I own a farm' }]);
  });

  it('drops empty values rather than rendering a button that stores nothing', () => {
    expect(normaliseChoices(['', '   ', { value: '', label: '' }, 'Kudu'])).toEqual(
      [{ value: 'Kudu', label: 'Kudu' }],
    );
  });

  // A paragraph reads as an answer the interview has already written for them.
  it('drops an answer too long to be a button', () => {
    const long = 'x'.repeat(MAX_CHOICE_LENGTH + 1);
    expect(normaliseChoices([long, 'Kudu'])).toEqual([
      { value: 'Kudu', label: 'Kudu' },
    ]);
  });

  it('falls back to the value when only the label is over-long', () => {
    const short = 'Kudu';
    const longLabel = 'y'.repeat(MAX_CHOICE_LENGTH + 1);
    expect(
      normaliseChoices([{ value: short, label: longLabel }]),
    ).toEqual([{ value: short, label: short }]);
  });

  // "Occupation" is not an answer to "What is your occupation?".
  it('never offers the field label back as an answer', () => {
    expect(
      normaliseChoices(['Occupation', 'Farmer'], { fieldLabel: 'Occupation' }),
    ).toEqual([{ value: 'Farmer', label: 'Farmer' }]);
  });

  it('caps the list at five', () => {
    const many = Array.from({ length: 9 }, (_, index) => `Answer ${index}`);
    expect(normaliseChoices(many)).toHaveLength(MAX_INTERVIEW_CHOICES);
  });

  it('returns nothing for anything that is not an array', () => {
    expect(normaliseChoices(undefined)).toEqual([]);
    expect(normaliseChoices(null)).toEqual([]);
    expect(normaliseChoices('Kudu')).toEqual([]);
    expect(normaliseChoices({ choices: ['Kudu'] })).toEqual([]);
  });
});

describe('addCustomChoice', () => {
  // ?? THE MO000059 FAULT: a ticked chip plus a typed answer became only the
  // typed answer, and the document argued one quarry where the applicant had
  // named two.
  it('keeps the ticked answer and appends the typed one', () => {
    expect(addCustomChoice('helmeted-guineafowl', 'snakes')).toBe(
      'helmeted-guineafowl, snakes',
    );
  });

  it('is the typed answer alone when nothing was ticked', () => {
    expect(addCustomChoice(undefined, 'snakes')).toBe('snakes');
    expect(addCustomChoice('', 'snakes')).toBe('snakes');
  });

  it('does not add the same answer twice', () => {
    expect(addCustomChoice('snakes', 'snakes')).toBe('snakes');
    expect(addCustomChoice('kudu, snakes', ' snakes ')).toBe('kudu, snakes');
  });

  it('leaves the list alone when the typed answer is blank', () => {
    expect(addCustomChoice('kudu', '   ')).toBe('kudu');
  });
});
