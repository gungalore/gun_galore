import {
  buildCategory,
  precinctFactLines,
  previousQuarter,
  sameQuarterLastYearOf,
} from './crime-stats.service';
import type {
  CrimeStatsRelease,
  PrecinctFigures,
} from './crime-stats.types';

const RELEASE: CrimeStatsRelease = {
  key: '2025-2026-Q4',
  periodLabel: 'January to March 2026',
  latestPeriod: '2026-Q1',
  fetchedOn: '2026-09-07',
  sourceUrl:
    'https://www.saps.gov.za/services/downloads/2025/2025-2026_-_4th_Quarter_WEB.xlsx',
};

type Best = Map<string, { count: number; releaseKey: string }>;

function best(
  entries: [string, number, string?][],
  category = 'Murder',
): Best {
  const m: Best = new Map();
  for (const [period, count, key] of entries) {
    m.set(`${category} ${period}`, { count, releaseKey: key ?? RELEASE.key });
  }
  return m;
}

describe('quarter arithmetic', () => {
  it('walks back over a year boundary', () => {
    expect(previousQuarter('2026-Q1')).toBe('2025-Q4');
    expect(previousQuarter('2025-Q4')).toBe('2025-Q3');
  });

  it('finds the same quarter a year earlier', () => {
    expect(sameQuarterLastYearOf('2026-Q1')).toBe('2025-Q1');
  });
});

describe('buildCategory', () => {
  it('reads the cited release’s own newest quarter as `latest`', () => {
    const c = buildCategory(
      'Murder',
      best([
        ['2022-Q1', 0],
        ['2023-Q1', 2],
        ['2024-Q1', 2],
        ['2025-Q1', 2],
        ['2026-Q1', 1],
      ]),
      RELEASE,
    )!;
    expect(c.latest).toEqual({
      period: '2026-Q1',
      label: 'January to March 2026',
      count: 1,
    });
    expect(c.sameQuarterLastYear).toEqual({
      period: '2025-Q1',
      label: 'January to March 2025',
      count: 2,
    });
    expect(c.yearOnYearPct).toBe(-50);
    // ⚠️ ALL FIVE, not the two that happen to sit within eight consecutive
    // quarters of the latest. A SAPS release IS the same quarter five years
    // running, and that comparison is the reason the file exists.
    expect(c.recent.map((q) => q.period)).toEqual([
      '2022-Q1',
      '2023-Q1',
      '2024-Q1',
      '2025-Q1',
      '2026-Q1',
    ]);
    // Newest LAST.
    expect(c.recent[c.recent.length - 1].period).toBe('2026-Q1');
    expect(c.recent).toHaveLength(5);
  });

  it('will not build a category the cited release has no figure for', () => {
    // ⚠️ SAPS renames categories between releases. Falling back to an older
    // release's quarter would print a 2025 count under a 2026 heading.
    const stale = best([
      ['2024-Q1', 7],
      ['2025-Q1', 9],
    ]);
    expect(buildCategory('Murder', stale, RELEASE)).toBeNull();
  });

  it('flags a "year" that is really five Januaries', () => {
    // This is what ONE SAPS release actually contains.
    const c = buildCategory(
      'Murder',
      best([
        ['2022-Q1', 0],
        ['2023-Q1', 2],
        ['2024-Q1', 2],
        ['2025-Q1', 2],
        ['2026-Q1', 1],
      ]),
      RELEASE,
    )!;
    expect(c.lastTwelveMonths).toBe(1);
    expect(c.note).toContain('not a full year');
  });

  it('adds a real four-quarter year with no note', () => {
    const c = buildCategory(
      'Murder',
      best([
        ['2025-Q2', 3],
        ['2025-Q3', 4],
        ['2025-Q4', 5],
        ['2026-Q1', 1],
      ]),
      RELEASE,
    )!;
    expect(c.lastTwelveMonths).toBe(13);
    expect(c.note).toBeUndefined();
  });

  it('names the other releases when a quarter did not come from the cited one', () => {
    const c = buildCategory(
      'Murder',
      best([
        ['2025-Q2', 3, '2025-2026-Q1'],
        ['2025-Q3', 4, '2025-2026-Q2'],
        ['2025-Q4', 5, '2025-2026-Q3'],
        ['2026-Q1', 1],
      ]),
      RELEASE,
    )!;
    expect(c.note).toContain('2025-2026-Q1');
    expect(c.note).toContain('2025-2026-Q3');
  });

  it('gives no year-on-year percentage when last year is missing or zero', () => {
    expect(
      buildCategory('Murder', best([['2026-Q1', 1]]), RELEASE)!.yearOnYearPct,
    ).toBeNull();
    expect(
      buildCategory(
        'Murder',
        best([
          ['2025-Q1', 0],
          ['2026-Q1', 3],
        ]),
        RELEASE,
      )!.yearOnYearPct,
    ).toBeNull();
  });
});

describe('precinctFactLines', () => {
  const figures: PrecinctFigures = {
    station: {
      name: 'Brooklyn',
      district: 'Tshwane District',
      province: 'Gauteng',
    },
    release: RELEASE,
    categories: [
      buildCategory(
        'Murder',
        best([
          ['2025-Q2', 3],
          ['2025-Q3', 4],
          ['2025-Q4', 5],
          ['2025-Q1', 2],
          ['2026-Q1', 1],
        ]),
        RELEASE,
      )!,
      buildCategory(
        'Carjacking',
        best(
          [
            ['2025-Q1', 4],
            ['2026-Q1', 6],
          ],
          'Carjacking',
        ),
        RELEASE,
      )!,
    ],
  };
  const lines = precinctFactLines(figures);

  it('names the station, its district and its province once, at the top', () => {
    expect(lines[0]).toContain('Brooklyn');
    expect(lines[0]).toContain('Tshwane District');
    expect(lines[0]).toContain('Gauteng');
  });

  it('names the release on the heading line', () => {
    expect(lines[0]).toContain('January to March 2026 release');
    expect(lines[0]).toContain('SAPS');
  });

  it('carries the category, the count and the period label on every line', () => {
    const murder = lines.find((l) => l.startsWith('Murder'))!;
    expect(murder).toContain('1 recorded');
    expect(murder).toContain('January to March 2026');

    const carjacking = lines.find((l) => l.startsWith('Carjacking'))!;
    expect(carjacking).toContain('6 recorded');
    expect(carjacking).toContain('January to March 2026');
  });

  it('states the direction against the same quarter a year earlier', () => {
    expect(lines.find((l) => l.startsWith('Murder'))).toContain(
      'down 50% on January to March 2025',
    );
    expect(lines.find((l) => l.startsWith('Carjacking'))).toContain(
      'up 50% on January to March 2025',
    );
  });

  it('quotes a twelve-month total only when it IS one', () => {
    // Murder has four consecutive quarters; Carjacking has two Januaries.
    expect(lines.find((l) => l.startsWith('Murder'))).toContain(
      '13 over the four quarters to January to March 2026',
    );
    const carjacking = lines.find((l) => l.startsWith('Carjacking'))!;
    expect(carjacking).not.toContain('four quarters to');
    expect(carjacking).toContain('not a full year');
  });

  it('never names a place the figures do not name', () => {
    // ⚠️ THE RULE THIS FILE EXISTS FOR. These lines are handed to the
    // motivation writer as supplied facts, and a suburb or a city that
    // appears here but not in the data is a fabricated citation.
    const allowed = ['Brooklyn', 'Tshwane District', 'Gauteng'];
    const named = new Set<string>();
    for (const line of lines) {
      for (const m of line.matchAll(/\b[A-Z][a-zA-Z-]+(?: [A-Z][a-zA-Z-]+)*/g)) {
        named.add(m[0]);
      }
    }
    for (const place of allowed) expect(named.has(place)).toBe(true);
    // Nothing that looks like a place but is not one of ours.
    for (const suspect of ['Pretoria', 'Johannesburg', 'Sandton', 'Menlyn']) {
      expect(lines.join(' ')).not.toContain(suspect);
    }
  });

  it('produces one line per category plus the heading', () => {
    expect(lines).toHaveLength(3);
  });
});
