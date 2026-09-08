import { arsenalBlock, arsenalRows } from './motivation-arsenal';

// ────────────────────────────────────────────────────────────────────
// THE ROWS THE WRITER WAS NEVER GIVEN.
//
// MO000071, section 9: "a MARLIN rifle in .45-70 Government under section 15".
// The Marlin is a section 16. The writer had a COUNT — five — and an
// instruction to compare against firearms it had never been shown, so it
// invented all five, including two licence sections.
//
// ⚠️ A GUESS THAT IS RIGHT BY CHANCE IS STILL A GUESS. Three of the five it
// wrote match the cards. That is the same defect with a better roll.
// ────────────────────────────────────────────────────────────────────

const row = (n: number, over: Record<string, string> = {}) => ({
  [`existing_firearm_${n}_make`]: 'Mauser',
  [`existing_firearm_${n}_type`]: 'Rifle',
  [`existing_firearm_${n}_calibre`]: '.30-06 Springfield',
  [`existing_firearm_${n}_serial`]: '96008993',
  [`existing_firearm_${n}_expiry`]: '2034-10-28',
  ...over,
});

describe('the rows', () => {
  it('reads every firearm the application holds', () => {
    const out = arsenalRows({
      ...row(1),
      ...row(2, {
        existing_firearm_2_make: 'CZ',
        existing_firearm_2_type: 'Handgun',
        existing_firearm_2_calibre: '6.35mm Browning',
        existing_firearm_2_serial: '81815',
      }),
    });
    expect(out.map((r) => r.make)).toEqual(['Mauser', 'CZ']);
    expect(out[0].serial).toBe('96008993');
  });

  it('⚠️ CARRIES A SECTION ONLY WHERE A LICENCE CARD ESTABLISHED ONE', () => {
    // ownedFirearmSections matches by SERIAL and refuses a make-and-calibre
    // match. A row it could not place carries no section, and the prompt then
    // forbids the writer naming one.
    const out = arsenalRows({ ...row(1), ...row(2, { existing_firearm_2_make: 'Marlin' }) }, { 1: 'section 16' });
    expect(out[0].line).toContain('section="section 16"');
    expect(out[1].line).not.toContain('section=');
  });

  it('⚠️ OMITS AN ABSENT FIELD RATHER THAN SENDING IT EMPTY', () => {
    // A row printed as section="" invites the model to fill it; a row with no
    // section attribute at all is a row the rule can be written against.
    const out = arsenalRows(row(1));
    expect(out[0].line).not.toContain('""');
    expect(out[0].line).not.toContain('model=');
  });

  it('⚠️ SAYS NOTHING ABOUT PURPOSE UNLESS SOMETHING STATED ONE', () => {
    // Rule 12, enforced by absence rather than by hope. Every "long-range game
    // harvesting" and "dedicated precision sport shooting rifle" in MO000071
    // was written into a gap exactly like this one.
    expect(arsenalRows(row(1))[0].licensedFor).toBe('');
    const stated = arsenalRows(
      row(1, { existing_firearm_1_use: 'plains game to 300 m' }),
    );
    expect(stated[0].line).toContain('licensed_for="plains game to 300 m"');
  });

  it('drops a row carrying nothing nameable', () => {
    // ownedRowTaken counts a tapped purpose as "somebody has been here", which
    // is right for the form and wrong for a sentence naming a firearm.
    expect(arsenalRows({ existing_firearm_3_primary_use: 'sport' })).toEqual([]);
  });

  it('reads a serial back through the retired keys', () => {
    const out = arsenalRows({
      existing_firearm_1_make: 'Marlin',
      existing_firearm_1_barrel_serial: 'AB1234',
    });
    expect(out[0].serial).toBe('AB1234');
  });
});

describe('the block', () => {
  it('⚠️ IS NOT SENT AT ALL FOR A FIRST-TIME APPLICANT', () => {
    // An empty <arsenal></arsenal> is an invitation to explain the absence.
    expect(arsenalBlock([])).toBe('');
  });

  it('carries the rule beside the rows, where it is read', () => {
    const block = arsenalBlock(arsenalRows(row(1), { 1: 'section 16' }));
    expect(block).toContain('<arsenal>');
    expect(block).toContain('must NOT be supplied');
    expect(block).toContain('State a section only where the row');
    expect(block).toContain(
      'Never describe a section 15 or 16 firearm with self-defence',
    );
  });
});
