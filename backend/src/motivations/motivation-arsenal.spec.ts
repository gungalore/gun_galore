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

// ────────────────────────────────────────────────────────────────────
// AN ABSENT PURPOSE IS SAID OUT LOUD.
//
// `put` omits an empty value, so a row whose purpose nobody stated had no
// `licensed_for` at all — and the writer filled the gap every time. On
// MO000074 it wrote that the Mauser, the Marlin and the Howa were each "for
// hunting"; nothing in the pack says so, and documentScope refused the whole
// document three times over for it.
// ────────────────────────────────────────────────────────────────────

describe('a held firearm whose purpose nobody stated', () => {
  const rowFor = (over: Record<string, string>) =>
    arsenalRows({
      existing_firearm_1_make: 'Marlin',
      existing_firearm_1_calibre: '.45-70 Government',
      existing_firearm_1_serial: 'MR90189D',
      existing_firearm_1_section_held: 'section_16',
      ...over,
    })[0];

  it('⚠️ TELLS THE WRITER TO SAY NOTHING, RATHER THAN SAYING NOTHING', () => {
    const line = rowFor({}).line;
    expect(line).toContain('NOT STATED');
    expect(line).toMatch(/the document must not say either/i);
  });

  it('still carries the section, which IS stated', () => {
    // Naming the section is what the writer is for; deriving a purpose from it
    // would be a fact about the Act, not about this licence.
    expect(rowFor({}).line).toMatch(/section="section 16"/i);
  });

  it('says nothing extra once a purpose IS stated', () => {
    const line = rowFor({ existing_firearm_1_primary_use: 'plains_game' }).line;
    expect(line).not.toContain('NOT STATED');
    expect(line).toContain('licensed_for=');
  });
});

// ────────────────────────────────────────────────────────────────────
// AND WHERE NOBODY STATED ONE, THE GENERATED USES.
//
// Operator override of guide-book Part 1 rule 7, 2026-09-09. Candidate uses
// are generated per firearm CLASS — calibre, type, action, section — and
// attached to the row for the writer to cherry-pick from. Nothing is asked of
// the member: "I don't want an applicant to sit and read and tick fucking
// boxes."
// ────────────────────────────────────────────────────────────────────

describe('the candidate uses on a row', () => {
  const answers = {
    existing_firearm_1_make: 'Howa',
    existing_firearm_1_calibre: '6.5mm Creedmoor',
    existing_firearm_1_serial: 'HW65001',
    existing_firearm_1_section_held: 'section_15',
  };
  const HUNT = 'I use it for plains game at moderate ranges.';
  const SPORT = 'I use it on a club range to keep my shooting current.';
  const uses = [
    { label: 'occasional hunting', uses: [HUNT] },
    { label: 'occasional sport shooting', uses: [SPORT] },
  ];

  it('⚠️ OFFERS TWO LABELLED LISTS, NOT ONE MERGED ONE', () => {
    // Operator, 2026-09-09: "that would give two lists instead of one
    // consolidated list". The writer chooses the ARGUMENT before the sentence.
    const line = arsenalRows(answers, {}, { 1: uses })[0].line;
    expect(line).toContain('<uses for="occasional hunting">');
    expect(line).toContain('<uses for="occasional hunting">');
    expect(line).toContain('<uses for="occasional sport shooting">');
    expect(line).toContain(`<use>${HUNT}</use>`);
    expect(line).toContain(`<use>${SPORT}</use>`);
  });

  it('⚠️ STILL SAYS THE PURPOSE IS UNSTATED, EVEN WITH USES TO OFFER', () => {
    // ⚠️ THIS SPEC ASSERTED THE OPPOSITE UNTIL 2026-09-10, and production
    // disproved it. The warning was suppressed whenever the use generator had
    // anything for the class, on the reading that the candidates spoke for
    // themselves. They do not: MO000075 was refused with "the document says the
    // applicant's CZ Handgun 6.35MM BROWNING is for 'hunt', and nothing in the
    // pack states what it is licensed for" — the writer read the basket as a
    // statement of what the licence was FOR. Which is the identical refusal
    // MO000074 took the day before, on a row with no candidates at all.
    //
    // The two say different things and both are true: this licence's purpose is
    // unstated, AND this class of firearm can do these things.
    const line = arsenalRows(answers, {}, { 1: uses })[0].line;
    expect(line).toContain('NOT STATED');
    expect(line).toContain('<uses for="occasional hunting">');
  });

  it('⚠️ A STATED PURPOSE STILL WINS OUTRIGHT', () => {
    // Offering alternatives beside the applicant's own answer would invite the
    // writer to pick a nicer one than the truth.
    const line = arsenalRows(
      { ...answers, existing_firearm_1_use: 'plains game hunting' },
      {},
      { 1: uses },
    )[0].line;
    expect(line).toContain('licensed_for="plains game hunting"');
    expect(line).not.toContain('<uses');
  });

  it('⚠️ AN EMPTY LIST IS THE OLD BEHAVIOUR, NOT A QUIET PASS', () => {
    // forClass returns [] on a model outage, and then the row must go back to
    // telling the writer to say nothing — which is what documentScope checks.
    const line = arsenalRows(answers, {}, { 1: [] })[0].line;
    expect(line).toContain('NOT STATED');
    expect(line).not.toContain('<uses');
  });

  it('a list that came back empty is dropped, not printed empty', () => {
    const line = arsenalRows(
      answers,
      {},
      { 1: [{ label: 'occasional hunting', uses: [] }, uses[1]] },
    )[0].line;
    expect(line).not.toContain('occasional hunting');
    expect(line).toContain('<uses for="occasional sport shooting">');
  });

  it('still carries the section, which is never generated', () => {
    const line = arsenalRows(answers, {}, { 1: uses })[0].line;
    expect(line).toMatch(/section="section 15"/i);
  });
});
