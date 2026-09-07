import { existingFirearms } from './motivation-render.service';
import { OWNED_ROWS } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// "FIREARMS ALREADY LICENSED TO ME" — the table in the motivation pack.
//
// ⚠️ IT IS EVIDENCE, NOT DECORATION. Section 13 caps a self-defence applicant
// at one firearm and section 15(3) caps an occasional sport shooter at four,
// so what somebody already holds is a statutory precondition the DFO checks —
// and this table is where they check it at a glance. An undercount does not
// merely look untidy; it understates the very thing being tested.
//
// It read `i <= 3` while the registry carried six rows and the 271 printed
// six. An applicant with four licences had the fourth collected, printed on
// their form, argued about by the overlap check — and missing from here.
// ────────────────────────────────────────────────────────────────────

const row = (n: number, over: Record<string, string> = {}) => ({
  [`existing_firearm_${n}_make`]: 'CZ',
  [`existing_firearm_${n}_model`]: '550',
  [`existing_firearm_${n}_calibre`]: '.308 Winchester',
  [`existing_firearm_${n}_type`]: 'Rifle',
  [`existing_firearm_${n}_licence_no`]: `40091178${n}`,
  [`existing_firearm_${n}_expiry`]: '2031-04-30',
  ...over,
});

describe('the owned-firearms table in the pack', () => {
  it('lists every row the registry offers, not the first three', () => {
    let answers: Record<string, string> = {};
    for (let n = 1; n <= OWNED_ROWS; n++) answers = { ...answers, ...row(n) };
    expect(existingFirearms(answers)).toHaveLength(OWNED_ROWS);
  });

  it('prints the model the column head has always promised', () => {
    // The column is headed "Make and model" in motivation-pdf.service.ts and
    // was fed the make alone, so the pack promised a model and printed none.
    // Operator, 2026-09-07: "when listing the fire arms I already own it
    // should only be the make, model, serial number and expiry date listed."
    expect(existingFirearms(row(1))[0].make).toBe('CZ 550');
  });

  it('prints the make alone when there is no model', () => {
    // "Model NONE" on a real card is the card saying this firearm has no model
    // designation; the placeholder rule strips it at the answer boundary, so
    // what arrives here is simply absent — and absent must not print a space
    // or a dash after the make.
    const one = existingFirearms(row(1, { existing_firearm_1_model: '' }))[0];
    expect(one.make).toBe('CZ');
  });

  it('prints the licence expiry beside the licence it belongs to', () => {
    // The table has four fixed columns, so the expiry rides with the licence
    // number rather than being dropped — it is a fact ABOUT that licence, and
    // a DFO reading "Held under" is exactly who wants to know it.
    expect(existingFirearms(row(1))[0].section).toBe(
      'Licence 400911781, expires 30/04/2031',
    );
  });

  it('leaves a date it cannot read exactly as it was given', () => {
    // ⚠️ NEVER REINTERPRETS. Reading 03/04/2029 as one order or the other is
    // how a licence expiry becomes a different licence expiry on a document
    // somebody files.
    const odd = existingFirearms(
      row(1, { existing_firearm_1_expiry: '03/04/2029' }),
    )[0];
    expect(odd.section).toBe('Licence 400911781, expires 03/04/2029');
  });

  it('says "Licensed" rather than guessing a section, and adds no comma for a missing date', () => {
    const bare = existingFirearms(
      row(1, { existing_firearm_1_licence_no: '', existing_firearm_1_expiry: '' }),
    )[0];
    expect(bare.section).toBe('Licensed');
  });

  it('still skips an abandoned row', () => {
    // The interview lets somebody start firearm 2 and abandon it. Half a row
    // on a submission reads as carelessness.
    const answers = { ...row(1), existing_firearm_2_use: 'Clay targets' };
    expect(existingFirearms(answers)).toHaveLength(1);
  });
});
