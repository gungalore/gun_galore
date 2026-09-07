import * as path from 'path';
import {
  excelSerialToYearMonth,
  parseRawData,
  quarterLabel,
  quarterOfMonth,
  RawDataShapeError,
  type RawRow,
} from './parse-raw-data';
import { readRawDataSheet } from './crime-stats-workbook';

// ────────────────────────────────────────────────────────────────────
// THE FIXTURE IS A REAL CUT OF THE REAL WORKBOOK.
//
// scripts/crime-stats-make-fixture.cjs slices the 10.8 MB 2025-2026 Q4 file
// down to three stations (Acornhoek, Brooklyn, Table View), all 44 crime
// categories, two rows each of the District / Province / National aggregate
// levels, and three rows of the trailing rubbish that sits below the table.
// 30 KB, and every quirk the parser has to survive is in it — a synthetic
// fixture would only ever contain the quirks we already thought of.
// ────────────────────────────────────────────────────────────────────
const FIXTURE = path.join(__dirname, '__fixtures__', 'saps-raw-data-sample.xlsx');

describe('excel serial dates', () => {
  it('reads 44562 as January 2022, the first month column of the Q4 release', () => {
    expect(excelSerialToYearMonth(44562)).toEqual({ year: 2022, month: 1 });
  });

  it('reads the newest month column, 46082, as March 2026', () => {
    expect(excelSerialToYearMonth(46082)).toEqual({ year: 2026, month: 3 });
  });

  it('puts January to March in calendar Q1, whatever SAPS calls it', () => {
    // SAPS calls this their FOURTH quarter, because their year starts in
    // April. The period key must not inherit that.
    expect(quarterOfMonth(1)).toBe(1);
    expect(quarterOfMonth(3)).toBe(1);
    expect(quarterOfMonth(4)).toBe(2);
    expect(quarterOfMonth(12)).toBe(4);
    expect(quarterLabel(2026, 1)).toBe('January to March 2026');
    expect(quarterLabel(2025, 3)).toBe('July to September 2025');
  });
});

describe('parseRawData over the real workbook fixture', () => {
  let rows: RawRow[];
  let result: ReturnType<typeof parseRawData>;

  beforeAll(async () => {
    rows = await readRawDataSheet(FIXTURE);
    result = parseRawData(rows);
  }, 30_000);

  it('reads the sheet SAPS puts the station figures on, not the first sheet', async () => {
    // The fixture carries a second sheet exactly so this can fail.
    expect(rows.length).toBe(144);
  });

  it('finds the header row below the two banner rows', () => {
    // Rows 1 and 2 are merged comparison banners; the headers are row 3.
    expect(rows[0].some((c) => String(c ?? '').includes('Comparison'))).toBe(
      true,
    );
    expect(rows[2]).toContain('Comp level');
  });

  it('finds the five quarters the release compares, ascending', () => {
    expect(result.quarters.map((q) => q.period)).toEqual([
      '2022-Q1',
      '2023-Q1',
      '2024-Q1',
      '2025-Q1',
      '2026-Q1',
    ]);
    expect(result.latestPeriod).toBe('2026-Q1');
    expect(result.latestLabel).toBe('January to March 2026');
  });

  it('pairs each quarter with its three month columns and its printed total', () => {
    for (const q of result.quarters) {
      expect(q.monthColumns).toHaveLength(3);
      expect(q.totalColumn).toBeGreaterThan(q.monthColumns[2]);
    }
  });

  it('keeps only Comp level = "Station" rows', () => {
    // Three stations, 44 categories each.
    expect(result.rows).toHaveLength(132);
    expect(result.stations.map((s) => s.name).sort()).toEqual([
      'Acornhoek',
      'Brooklyn',
      'Table View',
    ]);
  });

  it('drops the District / Province / National aggregate rows', () => {
    // ⚠️ THIS IS THE ONE THAT MATTERS. A province row loaded as a station
    // would give "Gauteng" a murder count two hundred times any precinct's.
    expect(result.skipped.aggregateRows).toBeGreaterThanOrEqual(6);
    for (const r of result.rows) {
      expect(r.station).not.toBe(r.province);
      expect(r.district).toMatch(/District|Metro|/);
    }
  });

  it('carries the district and province for every station', () => {
    const brooklyn = result.stations.find((s) => s.name === 'Brooklyn');
    expect(brooklyn).toEqual({
      name: 'Brooklyn',
      district: 'Tshwane District',
      province: 'Gauteng',
    });
  });

  it('reads the Brooklyn murder series SAPS printed', () => {
    const row = result.rows.find(
      (r) => r.station === 'Brooklyn' && r.category === 'Murder',
    );
    expect(row).toBeDefined();
    expect(row!.code).toBe(1);
    expect(row!.counts).toEqual([
      { period: '2022-Q1', count: 0 },
      { period: '2023-Q1', count: 2 },
      { period: '2024-Q1', count: 2 },
      { period: '2025-Q1', count: 2 },
      { period: '2026-Q1', count: 1 },
    ]);
  });

  it('adds the three months of every quarter up to the printed total', () => {
    // The months are our check on the total, and on a real release they
    // agree everywhere. A non-zero count here means SAPS shipped a sheet
    // whose own arithmetic disagrees, which is worth knowing about.
    expect(result.skipped.monthSumMismatches).toBe(0);
  });

  it('reports nothing unusable or duplicated in a clean release', () => {
    expect(result.skipped.unusableRows).toBe(0);
    expect(result.skipped.duplicateRows).toBe(0);
  });
});

describe('parseRawData on shapes SAPS could ship next quarter', () => {
  // A minimal sheet in the same shape, with the columns MOVED and the quarter
  // changed to April-June. Nothing in the parser may be positional.
  const header: RawRow = [
    'No',
    'Comp level',
    'Station Crime_Category',
    'Station',
    'District',
    'Province',
    'Crime_Category',
    'Code',
    45383, // 2024-04-01
    45414,
    45444,
    'April 2024 to \nJune 2024',
    45748, // 2025-04-01
    45779,
    45809,
    'April 2025 to \nJune 2025',
    'Count direction',
  ];
  const station = (
    name: string,
    cat: string,
    ...vals: (number | string | null)[]
  ): RawRow => [
    1,
    'Station',
    `${name} ${cat}`,
    name,
    'Some District',
    'Gauteng',
    cat,
    1,
    ...vals,
    'Increased',
  ];

  it('finds the columns wherever they sit and derives the calendar quarter', () => {
    const r = parseRawData([
      ['Comparison - 1st quarter'],
      header,
      station('Sandton', 'Murder', 1, 2, 3, 6, 2, 2, 2, 6),
    ]);
    expect(r.quarters.map((q) => q.period)).toEqual(['2024-Q2', '2025-Q2']);
    expect(r.latestLabel).toBe('April to June 2025');
    expect(r.rows[0].counts).toEqual([
      { period: '2024-Q2', count: 6 },
      { period: '2025-Q2', count: 6 },
    ]);
  });

  it('treats an unreported quarter as ABSENT, never as zero', () => {
    // A motivation that says "0 murders" where SAPS said nothing at all is a
    // false citation, and this module exists to make citations checkable.
    const r = parseRawData([
      header,
      station('Sandton', 'Murder', '', '', '', '', 1, 0, 1, 2),
    ]);
    expect(r.rows[0].counts).toEqual([{ period: '2025-Q2', count: 2 }]);
  });

  it('keeps the printed total when the months disagree, and says so', () => {
    const r = parseRawData([
      header,
      station('Sandton', 'Murder', 1, 1, 1, 9, 1, 1, 1, 3),
    ]);
    expect(r.rows[0].counts[0]).toEqual({ period: '2024-Q2', count: 9 });
    expect(r.skipped.monthSumMismatches).toBe(1);
  });

  it('sums the months when a release ships without a total column', () => {
    const noTotals = header.filter((c) => typeof c !== 'string' || !/ to /.test(c));
    const r = parseRawData([
      noTotals,
      [1, 'Station', 'x', 'Sandton', 'D', 'Gauteng', 'Murder', 1, 1, 2, 3, 4, 5, 6],
    ]);
    expect(r.quarters.map((q) => q.totalColumn)).toEqual([-1, -1]);
    expect(r.rows[0].counts).toEqual([
      { period: '2024-Q2', count: 6 },
      { period: '2025-Q2', count: 15 },
    ]);
  });

  it('keeps the first of two rows for the same station and category', () => {
    const r = parseRawData([
      header,
      station('Sandton', 'Murder', 1, 1, 1, 3, 1, 1, 1, 3),
      station('Sandton', 'Murder', 9, 9, 9, 27, 9, 9, 9, 27),
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].counts[0].count).toBe(3);
    expect(r.skipped.duplicateRows).toBe(1);
  });

  it('refuses a sheet it cannot recognise rather than loading nonsense', () => {
    expect(() => parseRawData([['a', 'b'], [1, 2]])).toThrow(RawDataShapeError);
  });

  it('refuses a header with names but no date columns', () => {
    const bare = header.slice(0, 8);
    expect(() => parseRawData([bare])).toThrow(RawDataShapeError);
  });
});
