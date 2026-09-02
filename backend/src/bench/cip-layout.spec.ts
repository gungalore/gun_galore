import {
  parseSheet,
  clusterRows,
  findColumns,
  type TextItem,
  type ParsedField,
} from './cip-layout';

/**
 * THE BENCH — the C.I.P. layout regression.
 *
 * The fixture is the real 6,5 Creedmoor sheet: every glyph run pdfjs reports
 * for the header, the Lengths block, the Collar rows, and — deliberately — the
 * drawing callouts sitting to their left. The drawing repeats the table's own
 * letters (L1, L2, L3, G1, H2, S, F), so a parser that reads labels without
 * regard to column picks them up and pairs them with whatever value is nearest.
 *
 * ⚠️ THE FIRST TEST IS THE ONE THAT MATTERS. `pdftotext -layout` reflows this
 * page so that every length is attributed to the row above it — L2 reads as
 * 48.77 and L3 as 71.76. Those are wrong by one row, and wrong in the
 * direction that would tell a reloader a case is 7mm longer than it is.
 */

const SHEET: TextItem[] = [
  { s: "TAB.", x: 434.6, y: 754.1 }, { s: "I", x: 532, y: 754.1 }, { s: "6,5 Creedmoor", x: 262.7, y: 744.8 },
  { s: "Date", x: 434.6, y: 739.9 }, { s: "12-05-30", x: 515.1, y: 739.9 }, { s: "C.I.P.", x: 101.5, y: 738.1 },
  { s: "Country of Origin: US", x: 270.3, y: 726 }, { s: "Revision", x: 434.6, y: 725.8 }, { s: "20-04-21", x: 515.1, y: 725.8 },
  { s: "CARTRIDGE MAXI", x: 316.2, y: 709.1 }, { s: "CHAMBER MINI", x: 464.2, y: 709.1 }, { s: "Lengths", x: 286.3, y: 692.6 },
  { s: "Lengths", x: 430.4, y: 692.6 }, { s: "1)", x: 302, y: 683.9 }, { s: "L1", x: 290.5, y: 681.9 },
  { s: "=", x: 332.9, y: 681.9 }, { s: "37.84", x: 362, y: 681.9 }, { s: "-0.20", x: 404.6, y: 681.9 },
  { s: "L1", x: 434.6, y: 681.9 }, { s: "=", x: 477, y: 681.9 }, { s: "37.76", x: 505.9, y: 681.9 },
  { s: "1)", x: 302, y: 672.8 }, { s: "L2", x: 290.5, y: 670.8 }, { s: "=", x: 332.9, y: 670.8 },
  { s: "41.52", x: 362, y: 670.8 }, { s: "-0.20", x: 404.6, y: 670.8 }, { s: "L2", x: 434.6, y: 670.8 },
  { s: "=", x: 477, y: 670.8 }, { s: "41.42", x: 505.9, y: 670.8 }, { s: "1)", x: 302, y: 661.8 },
  { s: "1)", x: 446.1, y: 661.8 }, { s: "L3", x: 290.5, y: 659.8 }, { s: "=", x: 332.9, y: 659.8 },
  { s: "48.77", x: 362, y: 659.8 }, { s: "L3", x: 434.6, y: 659.8 }, { s: "=", x: 477, y: 659.8 },
  { s: "48.90", x: 505.9, y: 659.8 }, { s: "L4", x: 290.5, y: 648.8 }, { s: "=", x: 332.9, y: 648.8 },
  { s: "G1", x: 196.7, y: 646 }, { s: "L5", x: 290.5, y: 637.9 }, { s: "=", x: 332.9, y: 637.9 },
  { s: "H2", x: 96.9, y: 627.6 }, { s: "L6", x: 290.5, y: 626.8 }, { s: "=", x: 332.9, y: 626.8 },
  { s: "71.76", x: 362, y: 626.8 }, { s: "S", x: 83, y: 546.7 }, { s: "L3", x: 248.2, y: 546.4 },
  { s: "e min", x: 290.5, y: 544.3 }, { s: "=", x: 332.9, y: 544.3 }, { s: "1.40", x: 366.8, y: 544.3 },
  { s: "L2", x: 235.8, y: 535.1 }, { s: "=", x: 332.9, y: 533.3 }, { s: "36°", x: 370.6, y: 533.3 },
  { s: "δ", x: 290.5, y: 532.4 }, { s: "L1", x: 223.3, y: 529.4 }, { s: "f", x: 290.5, y: 522.3 },
  { s: "=", x: 332.9, y: 522.3 }, { s: "0.38", x: 366.8, y: 522.3 }, { s: "*", x: 303.5, y: 375.8 },
  { s: "*", x: 447.6, y: 375.8 }, { s: "H1", x: 290.5, y: 373.8 }, { s: "=", x: 332.9, y: 373.8 },
  { s: "7.49", x: 366.8, y: 373.8 }, { s: "H1", x: 434.6, y: 373.8 }, { s: "=", x: 477, y: 373.8 },
  { s: "7.54", x: 510.8, y: 373.8 }, { s: "s", x: 226.7, y: 371 }, { s: "1)", x: 303.5, y: 364.8 },
  { s: "1)", x: 447.6, y: 364.8 }, { s: "H2", x: 290.5, y: 362.8 }, { s: "=", x: 332.9, y: 362.8 },
  { s: "7.49", x: 366.8, y: 362.8 }, { s: "H2", x: 434.6, y: 362.8 }, { s: "=", x: 477, y: 362.8 },
  { s: "7.52", x: 510.8, y: 362.8 }, { s: "F", x: 74.4, y: 361.2 },
];

const field = (fields: ParsedField[], label: string): ParsedField | undefined =>
  fields.find((f) => f.label === label);

describe('C.I.P. sheet — the off-by-one row trap', () => {
  const parsed = parseSheet(SHEET)!;

  it('parses the sheet at all', () => {
    expect(parsed).not.toBeNull();
  });

  it('reads the cartridge lengths off their own baselines', () => {
    expect(field(parsed.cartridge, 'L1')?.value).toBe('37.84');
    // 41.52, NOT 48.77 — the value pdftotext -layout attributes to L2.
    expect(field(parsed.cartridge, 'L2')?.value).toBe('41.52');
    // 48.77, NOT 71.76.
    expect(field(parsed.cartridge, 'L3')?.value).toBe('48.77');
    expect(field(parsed.cartridge, 'L6')?.value).toBe('71.76');
  });

  it('agrees with the cartridge reference file, which is an independent source', () => {
    // cartridge_reference.csv records 6,5 Creedmoor as L3 = 48.77, L6 = 71.76.
    expect(field(parsed.cartridge, 'L3')?.value).toBe('48.77');
    expect(field(parsed.cartridge, 'L6')?.value).toBe('71.76');
  });

  it('keeps the chamber column apart from the cartridge column', () => {
    expect(field(parsed.chamber, 'L1')?.value).toBe('37.76');
    expect(field(parsed.chamber, 'L2')?.value).toBe('41.42');
    expect(field(parsed.chamber, 'L3')?.value).toBe('48.90');
    // The same labels, different numbers: proof the split is by column.
    expect(field(parsed.cartridge, 'L1')?.value)
      .not.toBe(field(parsed.chamber, 'L1')?.value);
  });

  it('does not read the drawing callouts as data', () => {
    // L1/L2/L3 appear a second time at x≈223-248 as callouts on the drawing,
    // on baselines close to the table's own rows. Each label must appear
    // exactly once per column.
    for (const label of ['L1', 'L2', 'L3']) {
      expect(parsed.cartridge.filter((f) => f.label === label)).toHaveLength(1);
    }
    // F and S are callouts here with no table row in this slice.
    expect(field(parsed.cartridge, 'F')?.value ?? '').not.toBe('74.4');
  });

  it('separates the tolerance from the value', () => {
    expect(field(parsed.cartridge, 'L1')?.tolerance).toBe('-0.20');
    expect(field(parsed.cartridge, 'L2')?.tolerance).toBe('-0.20');
    expect(field(parsed.cartridge, 'L3')?.tolerance).toBeNull();
  });

  it('attaches footnote markers to the label, not the value', () => {
    expect(field(parsed.cartridge, 'L1')?.footnotes).toBe('1)');
    expect(field(parsed.cartridge, 'L1')?.value).toBe('37.84');
  });

  it('reads the header block', () => {
    expect(parsed.tab).toBe('I');
    expect(parsed.sheetDate).toBe('12-05-30');
    expect(parsed.revision).toBe('20-04-21');
  });

  it('leaves a blank row blank rather than borrowing the next row′s value', () => {
    // L4 and L5 are printed with no figure on this sheet.
    expect(field(parsed.cartridge, 'L4')?.value).toBe('');
    expect(field(parsed.cartridge, 'L5')?.value).toBe('');
  });
});

describe('C.I.P. sheet — column detection', () => {
  it('finds two equals-sign columns', () => {
    const cols = findColumns(clusterRows(SHEET))!;
    expect(cols).not.toBeNull();
    expect(cols.chamber).toBeGreaterThan(cols.maxi);
  });

  it('returns null for a page with no table', () => {
    expect(findColumns(clusterRows([{ s: 'nothing here', x: 10, y: 10 }]))).toBeNull();
  });

  it('parseSheet returns null rather than an empty shell for an image-only page', () => {
    expect(parseSheet([])).toBeNull();
  });
});
