import { SAPS271_COORDS } from './saps271-coords';

// ────────────────────────────────────────────────────────────────────
// EVERY CHARACTER GRID MUST BE EVENLY PITCHED.
//
// This test exists because two of them were not, and the damage was silent and
// total.
//
// Some rows on the form put a wide, undivided box between the label and the
// start of the character grid. It is a ruled cell like any other, so the
// measuring script took it as the first CHARACTER cell. The writer then fills
// cells in order — so one spurious leading cell pushed every digit one box
// early, left the real final box empty, and the row read as a DIFFERENT
// IDENTITY NUMBER on a form somebody signs under section 120(9)(f).
//
// ⚠️ AND NOTHING CAUGHT IT. The service's own safety check is
// `chars.length > cells.length`; an EXTRA cell makes that more false, not less,
// so no warning was ever logged. It was found by measuring the rendered PDF,
// which is not something anyone does by accident.
//
// f_id_number (the seller's) and g_spouse_passport (the applicant's spouse)
// both carried it. The second had been wrong since the map was first measured.
// ────────────────────────────────────────────────────────────────────

interface CharSpec {
  kind: 'chars';
  cells: { x: number; sep: string | null }[];
}

const charFields = Object.entries(SAPS271_COORDS)
  .filter(([, spec]) => (spec as { kind?: string }).kind === 'chars')
  .map(([name, spec]) => [name, spec as unknown as CharSpec] as const);

describe('character-cell grids', () => {
  it('finds them', () => {
    // If this reads zero, every test below passes for the wrong reason.
    expect(charFields.length).toBeGreaterThan(5);
  });

  it.each(charFields.map(([name]) => name))('%s is evenly pitched', (name) => {
    const spec = SAPS271_COORDS[name as keyof typeof SAPS271_COORDS] as CharSpec;
    const xs = spec.cells.map((c) => c.x);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // ⚠️ THE TELL IS A GAP THAT IS A MULTIPLE OF THE PITCH. A spacer box is
    // several character widths wide; f_id_number's first gap was 57.3 against
    // a 19.1 pitch — exactly three cells' worth — while every sibling field
    // started with a normal one.
    for (const [i, gap] of gaps.entries()) {
      expect({ field: name, cell: i, gap: Math.round(gap * 10) / 10, median }).toEqual({
        field: name,
        cell: i,
        gap: Math.round(gap * 10) / 10,
        median,
      });
      expect(gap).toBeLessThan(median * 1.6);
      expect(gap).toBeGreaterThan(median * 0.6);
    }
  });

  it('gives the three identity-number rows the same shape', () => {
    // They hold the same 13-digit value in the same 3-separator layout, so a
    // difference in cell count between them is a measuring error, not a
    // difference in the form.
    const ids = ['f_id_number', 'f_owner_id', 'g_id_number'] as const;
    const counts = ids.map(
      (k) => (SAPS271_COORDS[k] as unknown as CharSpec).cells.length,
    );
    expect(new Set(counts).size).toBe(1);

    // 13 digits plus 3 printed separators.
    const digits = ids.map(
      (k) =>
        (SAPS271_COORDS[k] as unknown as CharSpec).cells.filter((c) => !c.sep)
          .length,
    );
    expect(digits).toEqual([13, 13, 13]);
  });

  it('gives every postal code exactly four boxes', () => {
    // ⚠️ A POSTAL CODE IS FOUR PRINTED BOXES, ONE DIGIT EACH. Three of them
    // were mapped as a plain text box, so all four digits were drawn as one
    // string in the left of the first box and the other three sat empty — a
    // number written outside the lines. Operator, 2026-08-28: "postal codes
    // needs to have on number per box and currently have all four number in
    // the first box."
    const codes = Object.keys(SAPS271_COORDS).filter((k) =>
      k.includes('postal_code'),
    );
    expect(codes.length).toBeGreaterThan(4);
    for (const key of codes) {
      const spec = SAPS271_COORDS[key as keyof typeof SAPS271_COORDS] as {
        kind?: string;
        cells?: unknown[];
      };
      expect({ key, kind: spec.kind, boxes: spec.cells?.length }).toEqual({
        key,
        kind: 'chars',
        boxes: 4,
      });
    }
  });

  it('gives every date row exactly eight digit cells', () => {
    // DDMMYYYY. A date row with nine would swallow a digit the same way the
    // identity rows did, and dateDigits() would have nothing to protect.
    for (const key of ['g_date_of_birth', 'g_competency_issued', 'g_competency_expiry', 'f_declaration_date']) {
      const spec = SAPS271_COORDS[key as keyof typeof SAPS271_COORDS] as CharSpec;
      const digits = spec.cells.filter((c) => !c.sep).length;
      expect({ key, digits }).toEqual({ key, digits: 8 });
    }
  });
});
