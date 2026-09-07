import { describe, expect, it } from 'vitest';
import {
  firearmLine,
  offerRows,
  ownedFirearmSummary,
  ownedRowCap,
} from './owned-firearm-summary';

// ────────────────────────────────────────────────────────────────────
// MAKE, MODEL, SERIAL, EXPIRY. NOTHING ELSE.
//
// Operator, 2026-09-07: "when listing the fire arms I already own it should
// only be the make, model, serial number and expiry date listed, nothing else."
//
// Two screens list them — the collapsed row on "What you own", and the Document
// Centre prefill offer, which was printing seven rows per firearm. This is the
// one line both of them use, so they cannot drift apart again.
// ────────────────────────────────────────────────────────────────────

describe('the line', () => {
  it('is the four values, in the order they were named', () => {
    expect(
      firearmLine({
        make: 'Glock',
        model: '17',
        serial: 'ABC123',
        expiry: '2029-04-30',
      }),
    ).toBe('Glock · 17 · ABC123 · 2029-04-30');
  });

  it('⚠️ LISTS NOTHING ELSE, however much it is handed', () => {
    // Type, calibre, use and the licence number still go onto the form. They
    // are just not how somebody recognises their own firearm.
    expect(
      firearmLine({
        make: 'CZ',
        model: '75',
        serial: 'S1',
        expiry: '2030-01-01',
        type: 'Pistol',
        calibre: '9mmP',
        use: 'Self-defence',
        licence_no: '1234567',
      }),
    ).toBe('CZ · 75 · S1 · 2030-01-01');
  });

  it('⚠️ FALLS BACK TO THE OLD SERIAL COLUMNS', () => {
    // The registry is mid-change: one `_serial` is replacing `_frame_serial` /
    // `_barrel_serial`. Both must read correctly, or the line goes blank on
    // whichever side of that change is not deployed.
    expect(firearmLine({ make: 'Sako', frame_serial: 'F9' })).toBe('Sako · F9');
    expect(firearmLine({ make: 'Sako', barrel_serial: 'B9' })).toBe(
      'Sako · B9',
    );
    // A live `_serial` wins over a legacy one rather than printing both.
    expect(
      firearmLine({ serial: 'NEW', frame_serial: 'OLD', barrel_serial: 'OLD2' }),
    ).toBe('NEW');
  });

  it('⚠️ BARREL BEFORE FRAME — the order the server reads them in', () => {
    // ownedFirearmSerial() in backend/src/motivations/motivation-fields.ts
    // reads _serial, then _barrel_serial, then _frame_serial. Reading frame
    // first here let these two screens name a different number from the one
    // the printed SAPS 271 carries, on the same firearm.
    expect(firearmLine({ barrel_serial: 'B9', frame_serial: 'F9' })).toBe('B9');
  });

  it('⚠️ "NONE" IS THE CARD SAYING NOTHING, NOT A SERIAL', () => {
    // The operator's own cards print NONE against a row that does not apply,
    // and on the firearms where the two serials genuinely differ one of them
    // says exactly that. The placeholder falls through to the other column.
    expect(
      firearmLine({ make: 'Glock', barrel_serial: 'NONE', frame_serial: 'ZABA01892' }),
    ).toBe('Glock · ZABA01892');
    // And it is never printed as a value of its own.
    expect(firearmLine({ make: 'Sako', model: 'NONE', serial: 'N/A' })).toBe(
      'Sako',
    );
    // Anchored: a serial that merely starts with those letters survives.
    expect(firearmLine({ serial: 'NA1234' })).toBe('NA1234');
  });

  it('drops what is missing rather than printing gaps', () => {
    expect(firearmLine({ make: 'Marlin', expiry: '' })).toBe('Marlin');
    expect(firearmLine({})).toBe('');
  });

  it('reads a slot straight off the answers', () => {
    expect(
      ownedFirearmSummary(3, {
        existing_firearm_3_make: 'Marlin',
        existing_firearm_3_model: '1895',
        existing_firearm_3_frame_serial: 'MR44',
        existing_firearm_3_expiry: '2031-06-30',
        existing_firearm_3_calibre: '.45-70',
        existing_firearm_2_make: 'Not this one',
      }),
    ).toBe('Marlin · 1895 · MR44 · 2031-06-30');
  });
});

describe('the prefill offer, collapsed', () => {
  const item = (key: string, value: string) => ({ key, label: key, value });

  it('turns seven columns into one line', () => {
    const rows = offerRows([
      item('existing_firearm_1_type', 'Pistol'),
      item('existing_firearm_1_calibre', '9mmP'),
      item('existing_firearm_1_make', 'Glock'),
      item('existing_firearm_1_model', '17'),
      item('existing_firearm_1_use', 'Self-defence'),
      item('existing_firearm_1_frame_serial', 'ABC123'),
      item('existing_firearm_1_licence_no', '9876543'),
    ]);
    expect(rows).toEqual([
      {
        key: 'existing_firearm_1',
        label: 'Firearm 1',
        value: 'Glock · 17 · ABC123',
        collapsed: true,
      },
    ]);
  });

  it('keeps each firearm separate', () => {
    const rows = offerRows([
      item('existing_firearm_1_make', 'Glock'),
      item('existing_firearm_4_make', 'Marlin'),
      item('existing_firearm_4_serial', 'MR44'),
    ]);
    expect(rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
      'Firearm 1: Glock',
      'Firearm 4: Marlin · MR44',
    ]);
  });

  it('leaves everything else exactly as it was', () => {
    const rows = offerRows([
      item('competency_number', '1234'),
      item('id_number', '8001015009087'),
    ]);
    expect(rows).toEqual([
      { key: 'competency_number', label: 'competency_number', value: '1234' },
      { key: 'id_number', label: 'id_number', value: '8001015009087' },
    ]);
  });

  it('⚠️ A FIREARM TAKES THE POSITION OF ITS FIRST COLUMN', () => {
    // Appending the collapsed rows after everything else would hoist unrelated
    // values above the firearms they sit between — the ordering bug the pack
    // screen's own partitionKeys carries the same warning about.
    const rows = offerRows([
      item('existing_firearm_1_make', 'Glock'),
      item('overlap_justification', 'Different purpose'),
      item('existing_firearm_1_serial', 'ABC123'),
    ]);
    expect(rows.map((r) => r.key)).toEqual([
      'existing_firearm_1',
      'overlap_justification',
    ]);
    expect(rows[0].value).toBe('Glock · ABC123');
  });
});

describe('⚠️ A FIREARM WITH NO LINE IS NOT COLLAPSED', () => {
  const item = (key: string, value: string) => ({ key, label: key, value });

  it('shows the columns that WILL be written, rather than a blank row', () => {
    // The offer only carries answers the member has NOT already given, so a
    // firearm whose make and serial they typed themselves arrives as a type
    // and a calibre — no make, no model, no serial, no expiry, nothing for the
    // four-value line to draw. Collapsing it produced "Firearm 3" with an
    // empty value beside a button that would still write both answers, over a
    // panel whose header promises the opposite.
    const rows = offerRows([
      item('existing_firearm_3_type', 'Rifle'),
      item('existing_firearm_3_calibre', '.308'),
    ]);
    expect(rows).toEqual([
      { key: 'existing_firearm_3_type', label: 'existing_firearm_3_type', value: 'Rifle' },
      {
        key: 'existing_firearm_3_calibre',
        label: 'existing_firearm_3_calibre',
        value: '.308',
      },
    ]);
    expect(rows.some((r) => r.collapsed)).toBe(false);
  });

  it('a serial of NONE is no line either', () => {
    const rows = offerRows([item('existing_firearm_2_frame_serial', 'NONE')]);
    expect(rows).toEqual([
      {
        key: 'existing_firearm_2_frame_serial',
        label: 'existing_firearm_2_frame_serial',
        value: 'NONE',
      },
    ]);
  });

  it('⚠️ MARKS THE COLLAPSED ONES, so the panel can say the rest goes on too', () => {
    // `rows.length < items.length` was the old test and it is false when
    // exactly ONE column of a firearm is offered — the case where the line
    // hides the most.
    const rows = offerRows([item('existing_firearm_1_make', 'Glock')]);
    expect(rows).toEqual([
      {
        key: 'existing_firearm_1',
        label: 'Firearm 1',
        value: 'Glock',
        collapsed: true,
      },
    ]);
  });

  it('an uncollapsed firearm still holds its position', () => {
    const rows = offerRows([
      item('existing_firearm_1_calibre', '9mmP'),
      item('competency_number', '1234'),
      item('existing_firearm_1_type', 'Pistol'),
    ]);
    expect(rows.map((r) => r.key)).toEqual([
      'existing_firearm_1_calibre',
      'existing_firearm_1_type',
      'competency_number',
    ]);
  });
});

describe('⚠️ HOW MANY ROWS THE REGISTRY HAS — never a literal', () => {
  const f = (key: string) => ({ key });

  it('is the highest row the served fields mention', () => {
    expect(
      ownedRowCap([
        f('existing_firearm_1_make'),
        f('existing_firearm_14_expiry'),
        f('competency_number'),
      ]),
    ).toBe(14);
  });

  it('the six the wizard used to hard-code is just one possible answer', () => {
    // The registry went 6 → 14 on 2026-09-07 (the blank SAPS 271's item 2.1 is
    // fourteen identical rows). Rows 7-14 were written into the answers where
    // no screen rendered them and nobody could correct them.
    const six = Array.from({ length: 6 }, (_, i) =>
      f(`existing_firearm_${i + 1}_make`),
    );
    expect(ownedRowCap(six)).toBe(6);
  });

  it('is 0 before the fields have loaded — "add nothing yet", not "one"', () => {
    expect(ownedRowCap([])).toBe(0);
    expect(ownedRowCap([f('id_number')])).toBe(0);
  });

  it('ignores a malformed row number rather than reading it as a row', () => {
    expect(ownedRowCap([f('existing_firearm_0_make')])).toBe(0);
  });
});
