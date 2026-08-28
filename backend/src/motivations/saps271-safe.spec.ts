import { MotivationLicenceType } from '@prisma/client';
import { buildSaps271 } from './saps271-map';
import { SAPS271_COORDS } from './saps271-coords';

// ────────────────────────────────────────────────────────────────────
// ITEMS 68.1 AND 69.1 — "IF YES, SUBMIT FULL DETAILS".
//
// Both items ask for details in as many words, and 68.1 spells out "(Indicate
// with an X, with short description)". Until now only the X was ever drawn:
// the form asked twice for a description and got a blank band back both times.
//
// The answer is a pointer to the photographs, which are already in the pack —
// operator, 2026-08-28: "on the safe questions, Add see annexure(whatever the
// safe pictures are) for the submit full details."
//
// ⚠️ AND A POINTER TO NOTHING IS WORSE THAN A BLANK. "See Annexure F" on a
// pack with no Annexure F is a false statement on a declaration signed under
// section 120(9)(f) of the Firearms Control Act, and it is the kind of false
// statement a DFO discovers at the counter. Every test below that leaves a box
// empty is proving that guard, not tolerating a gap.
// ────────────────────────────────────────────────────────────────────

const S16 = MotivationLicenceType.S16_DEDICATED_SPORT;

const SAFE = {
  safe_present: 'Yes',
  safe_type: 'Rifle safe',
  safe_mounted: 'Yes',
  safe_mounted_to: 'Wall',
};

const build = (answers: Record<string, string>, letter?: string) =>
  buildSaps271({ licenceType: S16, answers, safeAnnexureLetter: letter });

describe('the safe, items 68 and 69', () => {
  it('answers both "submit full details" boxes with the annexure', () => {
    const out = build(SAFE, 'F');
    expect(out.text.safe_detail_handgun_rifle).toBe(
      'See Annexure F (photographs of the safe)',
    );
    expect(out.text.safe_detail_mounted).toBe(
      'See Annexure F (photographs of the safe)',
    );
  });

  it('carries the letter the pack actually gave the photographs', () => {
    // The letter moves with what else was uploaded, so it is passed in rather
    // than assumed. A hardcoded "F" would be right on a full pack and wrong on
    // every short one.
    expect(build(SAFE, 'C').text.safe_detail_handgun_rifle).toBe(
      'See Annexure C (photographs of the safe)',
    );
  });

  it('writes nothing at all when there are no photographs to point at', () => {
    const out = build(SAFE);
    expect(out.text.safe_detail_handgun_rifle).toBeUndefined();
    expect(out.text.safe_detail_mounted).toBeUndefined();
    const reasons = out.leftBlank.filter((b) =>
      b.field.startsWith('saps271_item_'),
    );
    expect(reasons.map((r) => r.field).sort()).toEqual([
      'saps271_item_68.1',
      'saps271_item_69.1',
    ]);
    for (const r of reasons) expect(r.because).toContain('upload');
  });

  it('puts the description beside the type that was ticked', () => {
    // 68.1 is three printed rows, and the band belongs to the row. A
    // description on the Device row describes a device.
    const strongroom = build({ ...SAFE, safe_type: 'Strongroom' }, 'F');
    expect(strongroom.ticks).toContain('safe_type_strongroom');
    expect(strongroom.text.safe_detail_strongroom).toContain('Annexure F');
    expect(strongroom.text.safe_detail_handgun_rifle).toBeUndefined();
    expect(strongroom.text.safe_detail_device).toBeUndefined();

    const device = build({ ...SAFE, safe_type: 'Other device' }, 'F');
    expect(device.text.safe_detail_device).toContain('Annexure F');
    expect(device.text.safe_detail_strongroom).toBeUndefined();
  });

  it('shares one band between the handgun and rifle rows, as the form does', () => {
    // They are printed on the same row and there is only one band on it.
    for (const type of ['Handgun safe', 'Rifle safe']) {
      expect(
        build({ ...SAFE, safe_type: type }, 'F').text.safe_detail_handgun_rifle,
      ).toContain('Annexure F');
    }
  });

  it('never describes a safe whose type was not ticked', () => {
    // ⚠️ AN UNRECOGNISED TYPE TICKS NOTHING, so a description written anyway
    // would sit in a row with an empty tick box — a description of a safe the
    // form does not say they have.
    const out = build({ ...SAFE, safe_type: 'Ammunition cabinet' }, 'F');
    expect(out.ticks.filter((t) => t.startsWith('safe_type_'))).toEqual([]);
    for (const k of [
      'safe_detail_handgun_rifle',
      'safe_detail_strongroom',
      'safe_detail_device',
    ] as const) {
      expect(out.text[k]).toBeUndefined();
    }
  });

  it('leaves 69.1 alone on a safe that is not mounted', () => {
    // The item is "IF YES". A pointer under a ticked NO reads as a claim the
    // applicant did not make.
    const out = build({ ...SAFE, safe_mounted: 'No' }, 'F');
    expect(out.ticks).toContain('safe_mounted_no');
    expect(out.text.safe_detail_mounted).toBeUndefined();
    expect(out.text.safe_detail_handgun_rifle).toContain('Annexure F');
  });

  it('writes neither box when there is no safe', () => {
    const out = build({ safe_present: 'No' }, 'F');
    expect(out.ticks).toContain('safe_no');
    expect(out.text.safe_detail_handgun_rifle).toBeUndefined();
    expect(out.text.safe_detail_mounted).toBeUndefined();
  });

  it('fits the bands it writes into', () => {
    // The service shrinks to a floor and then refuses, logging and leaving the
    // box empty — so a sentence that does not fit is a silently blank form.
    // Helvetica averages under 0.5em per character; the shortest band is the
    // 210.9pt one on the handgun/rifle row.
    const text = 'See Annexure F (photographs of the safe)';
    for (const key of [
      'safe_detail_handgun_rifle',
      'safe_detail_strongroom',
      'safe_detail_device',
      'safe_detail_mounted',
    ] as const) {
      const spec = SAPS271_COORDS[key] as { kind: string; w: number };
      expect({ key, kind: spec.kind }).toEqual({ key, kind: 'text' });
      expect(spec.w).toBeGreaterThan(text.length * 4.2);
    }
  });
});
