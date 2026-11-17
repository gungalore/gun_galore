import {
  describeDistances,
  distanceFits,
  distancesInText,
  filterSportUsesForDiscipline,
  parseDistances,
  rangeSpecForAnswers,
  rangeViolations,
  usesFittingDiscipline,
} from './discipline-ranges';

describe('parsing distances out of a published rule', () => {
  it('reads the SHOOTING DISTANCE line', () => {
    const parsed = parseDistances(
      'SHOOTING DISTANCE: The shooting distance measured from the target to the edge of the firing line closest to the shooter is 10 meters.',
    );
    expect(parsed.values).toEqual([10]);
    expect(parsed.span).toBe(false);
  });

  it('reads a band as a band', () => {
    const parsed = parseDistances('Target Rifle is shot at 300 m to 900 m.');
    expect(parsed.values).toEqual([300, 900]);
    expect(parsed.span).toBe(true);
  });

  it('reads Bisley’s yards and the spaced thousand', () => {
    const parsed = parseDistances('from 300 to 1 000 yards');
    expect(parsed.values).toEqual([274, 914]);
    expect(parsed.span).toBe(true);
  });

  it('never mistakes a millimetre or a gauge for a distance', () => {
    expect(
      parseDistances(
        '9 mm Parabellum, 6,35 mm Browning, a 12 gauge and a 20 gauge.',
      ).values,
    ).toEqual([]);
  });

  it('never mistakes a target’s dimensions for a shooting distance', () => {
    // NHSA's steel-plate rule prints "maximum 300m (w) x 300mm (h) x 10mm".
    expect(
      parseDistances(
        'Plates of maximum 300m (w) x 300mm (h) x 10mm thick. Distance: 20 m.',
      ).values,
    ).toEqual([20]);
  });

  it('ignores shot counts and reads the distance beside them', () => {
    expect(parseDistances('Total of 5 shots at 10 m.').values).toEqual([10]);
  });

  it('reads several fixed distances as a list', () => {
    const parsed = parseDistances('Target frames stand at 100 m, 200 m and 300 m.');
    expect(parsed.values).toEqual([100, 200, 300]);
    expect(parsed.span).toBe(false);
  });
});

describe('the spec for an application', () => {
  const nhsa = {
    association_name: 'NHSA',
    discipline_exercise: '10m Air Pistol Exercise',
  };

  it('takes the exercise’s own published distance', () => {
    const spec = rangeSpecForAnswers(nhsa);
    expect(spec?.source).toBe('exercise');
    expect(spec?.values).toEqual([10]);
    expect(describeDistances(spec!)).toBe('10 m');
  });

  it('falls back to a distance carried in the exercise title', () => {
    const spec = rangeSpecForAnswers({
      association_name: 'NHSA',
      discipline_exercise: '100m, Small Calibre Centre-Fire Rifle Exercise',
    });
    expect(spec?.values).toContain(100);
  });

  it('returns nothing for an association we hold no rulebook for', () => {
    expect(
      rangeSpecForAnswers({ association_name: 'Unknown Club' }),
    ).toBeNull();
  });

  it('returns nothing from a discipline requirement paragraph alone', () => {
    // The requirements are prose about equipment; their stray metres are
    // facilities and target sizes, not courses of fire.
    expect(
      rangeSpecForAnswers({ discipline: 'ipsc-practical-pistol-handgun' }),
    ).toBeNull();
  });

  it('returns nothing when the rule says the distance varies', () => {
    // FOSA's Scope Setting Target prints "Distance: Various".
    const spec = rangeSpecForAnswers({
      association_name: 'FOSA',
      discipline_exercise: 'Scope Setting Target',
    });
    expect(spec).toBeNull();
  });
});

describe('what the discipline admits', () => {
  const twenty = {
    label: '20 m handgun exercise',
    values: [20],
    span: false,
    source: 'exercise' as const,
  };
  const band = {
    label: 'Target Rifle',
    values: [300, 900],
    span: true,
    source: 'exercise' as const,
  };

  it('admits only the fixed distance of a fixed-distance exercise', () => {
    expect(distanceFits(twenty, 20)).toBe(true);
    expect(distanceFits(twenty, 25)).toBe(false);
  });

  it('admits anything inside a published band', () => {
    expect(distanceFits(band, 600)).toBe(true);
    expect(distanceFits(band, 200)).toBe(false);
  });

  it('drops a generated use whose range is not this discipline’s', () => {
    const kept = usesFittingDiscipline(
      [
        'It is a standard chambering for F-Class prone shooting at 600 m.',
        'It suits club-level target shooting at 20 m.',
        'I would like to shoot the club league with it.',
      ],
      twenty,
    );
    expect(kept).toEqual([
      'It suits club-level target shooting at 20 m.',
      'I would like to shoot the club league with it.',
    ]);
  });

  it('filters only the sport slices of the generated uses table', () => {
    const groups = filterSportUsesForDiscipline(
      [
        {
          label: 'dedicated sport shooting',
          uses: [
            'It is a standard chambering for F-Class prone shooting at 600 m.',
            'I would like to shoot the club league with it.',
          ],
        },
        {
          label: 'dedicated hunting',
          uses: ['It is suited to plains game at 300 m.'],
        },
      ],
      {
        association_name: 'NHSA',
        discipline_exercise: '10m Air Pistol Exercise',
      },
    );
    expect(groups[0].uses).toEqual([
      'I would like to shoot the club league with it.',
    ]);
    expect(groups[1].uses).toEqual(['It is suited to plains game at 300 m.']);
  });

  it('leaves the table alone when the discipline has no published distances', () => {
    const groups = [
      { label: 'dedicated sport shooting', uses: ['F-Class prone at 600 m.'] },
    ];
    expect(
      filterSportUsesForDiscipline(groups, {
        association_name: 'Unknown Club',
      }),
    ).toEqual(groups);
  });
});

describe('checking the document', () => {
  const spec = {
    label: '10m Air Pistol Exercise',
    values: [10],
    span: false,
    source: 'exercise' as const,
  };

  it('flags a course-of-fire distance the exercise does not admit', () => {
    const issues = rangeViolations(
      'My exercise is shot at 100 m. The course of fire is walked and scored.',
      spec,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('100 m');
    expect(issues[0]).toContain('10 m');
  });

  it('passes the exercise’s own distance', () => {
    expect(
      rangeViolations('The exercise is shot at 10 m from the firing line.', spec),
    ).toEqual([]);
  });

  it('ignores a distance that is not about the course of fire', () => {
    expect(
      rangeViolations('I practise at 300 m on the farm when I can.', spec),
    ).toEqual([]);
  });

  it('ignores a millimetre in a sentence about the course', () => {
    expect(
      rangeViolations('My 9 mm handgun suits the exercise at 10 m.', spec),
    ).toEqual([]);
  });

  it('says nothing without a spec', () => {
    expect(rangeViolations('My exercise is shot at 100 m.', null)).toEqual([]);
    expect(distancesInText('at 600 m')).toEqual([600]);
  });
});
