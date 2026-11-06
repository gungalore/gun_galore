import {
  HISTORY_CHOICES,
  MAX_CHOICE_LENGTH,
  MAX_INTERVIEW_CHOICES,
  addCustomChoice,
  exerciseChoices,
  historyAnswerWords,
  normaliseChoices,
} from './intake-choices';
import { MIN_HISTORY_WORDS } from '../motivation-completeness';

describe('normaliseChoices', () => {
  it('turns a plain list of strings into value/label pairs', () => {
    expect(normaliseChoices(['Kudu', 'Impala'])).toEqual([
      { value: 'Kudu', label: 'Kudu' },
      { value: 'Impala', label: 'Impala' },
    ]);
  });

  it('keeps a usable label when the model supplies one', () => {
    expect(normaliseChoices([{ value: 's16', label: 'Dedicated hunter' }])).toEqual(
      [{ value: 's16', label: 'Dedicated hunter' }],
    );
  });

  it('uses the label as the value when the value is missing', () => {
    expect(normaliseChoices([{ label: 'Blue wildebeest' }])).toEqual([
      { value: 'Blue wildebeest', label: 'Blue wildebeest' },
    ]);
  });

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

  it('drops an answer too long to be a button', () => {
    const long = 'x'.repeat(MAX_CHOICE_LENGTH + 1);
    expect(normaliseChoices([long, 'Kudu'])).toEqual([
      { value: 'Kudu', label: 'Kudu' },
    ]);
  });

  it('falls back to the value when only the label is over-long', () => {
    const short = 'Kudu';
    const longLabel = 'y'.repeat(MAX_CHOICE_LENGTH + 1);
    expect(normaliseChoices([{ value: short, label: longLabel }])).toEqual([
      { value: short, label: short },
    ]);
  });

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

describe('historyAnswerWords', () => {
  // ?? Operator, 2026-11-06: "Why the error?" - nineteen words of a real
  // history were refused for not being sixty. The floor is now reachable by
  // tapping, and the ticks count.
  it('counts the typed answer and the ticked statements together', () => {
    expect(
      historyAnswerWords(['I grew up on a farm'], 'I shoot most weekends'),
    ).toBe(10);
  });

  it('says nothing was given when nothing was', () => {
    expect(historyAnswerWords(undefined, undefined)).toBe(0);
    expect(historyAnswerWords([], '   ')).toBe(0);
  });

  it('is reachable by tapping alone', () => {
    const ticked = [HISTORY_CHOICES[0].value, HISTORY_CHOICES[1].value];
    expect(historyAnswerWords(ticked, undefined)).toBeGreaterThanOrEqual(
      MIN_HISTORY_WORDS,
    );
  });

  it('does not accept one chip as a whole history', () => {
    expect(
      historyAnswerWords([HISTORY_CHOICES[7].value], undefined),
    ).toBeLessThan(MIN_HISTORY_WORDS);
  });
});

describe('HISTORY_CHOICES', () => {
  it('offers more than the model ever did, and never duplicates a value', () => {
    expect(HISTORY_CHOICES.length).toBeGreaterThan(MAX_INTERVIEW_CHOICES);
    const values = HISTORY_CHOICES.map((choice) => choice.value.toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });

  it('reads as a sentence in the sheet, not as a topic label', () => {
    for (const choice of HISTORY_CHOICES) {
      expect(choice.value.split(/\s+/).length).toBeGreaterThan(3);
    }
  });
});

describe('exerciseChoices', () => {
  // The entry chips come from the association's published rules, so a member
  // of a body we hold no rulebook for still gets a question - a free-text one.
  it('walks the published exercises for a known association', () => {
    const choices = exerciseChoices('Natshoot NHSA', 'Handgun');
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.length).toBeLessThanOrEqual(15);
    expect(choices[0].label).toMatch(/Com\d+/);
    // The value is the title, which is what rulesFor() matches on.
    expect(choices[0].value).not.toMatch(/Com\d+/);
  });

  it('returns nothing for an association whose rulebook we do not hold', () => {
    expect(exerciseChoices('Some Other Club', 'Rifle')).toEqual([]);
    expect(exerciseChoices(undefined, 'Rifle')).toEqual([]);
  });

  it('offers no duplicate exercise twice', () => {
    const values = exerciseChoices('NHSA', 'Rifle').map((choice) => choice.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
