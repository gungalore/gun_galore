import { MotivationLicenceType } from '@prisma/client';
import { applicationWarnings } from './motivation-warnings';

// ────────────────────────────────────────────────────────────────────
// WHERE THE ACT IS STRICTER THAN WHAT THE CFR SOMETIMES ACCEPTS.
//
// MOTIVATION-GUIDE-BOOK Part 3.2. Never blocks: the Register does grant
// applications over these caps, and refusing to write the motivation would
// substitute our reading of the Act for the Registrar's at the applicant's
// expense. Never silent either: somebody over a cap who is not told lodges,
// pays, gives fingerprints, waits, and is refused on a ground nobody raised.
// ────────────────────────────────────────────────────────────────────

const codes = (
  t: MotivationLicenceType,
  a: Record<string, string>,
  at = new Date('2026-09-09T06:00:00Z'),
) => applicationWarnings(t, a, at).map((w) => w.code);

const held = (n: number, over: Record<string, string>) => ({
  [`existing_firearm_${n}_make`]: 'CZ',
  [`existing_firearm_${n}_calibre`]: '9mm Luger',
  [`existing_firearm_${n}_serial`]: `SER${n}`,
  ...over,
});

describe('section 13(3) — one at a time', () => {
  it('warns when a section 13 licence is already held', () => {
    expect(
      codes(MotivationLicenceType.S13_SELF_DEFENCE, {
        ...held(1, { existing_firearm_1_section_held: 'section_13' }),
      }),
    ).toContain('section-13-cap');
  });

  it('⚠️ DOES NOT COUNT A SECTION 16 HANDGUN, which is the whole point', () => {
    // Operator, 2026-09-09: "If someone owns a handgun and its on section 16.
    // Then the new applicant is allowed to apply for a section 13 of that
    // firearm if they do meet all the other conditions." The cap is on
    // licences under THIS section.
    expect(
      codes(MotivationLicenceType.S13_SELF_DEFENCE, {
        ...held(1, { existing_firearm_1_section_held: 'section_16' }),
      }),
    ).not.toContain('section-13-cap');
  });

  it('⚠️ DOES NOT COUNT A ROW WHOSE SECTION IS UNKNOWN', () => {
    // The count can UNDERCOUNT and must never overcount: telling somebody they
    // are over a cap when they are not is worse than saying nothing, because
    // the answer to a warning is to abandon an application.
    for (const v of ['', 'unsure']) {
      expect(
        codes(MotivationLicenceType.S13_SELF_DEFENCE, {
          ...held(1, { existing_firearm_1_section_held: v }),
        }),
      ).not.toContain('section-13-cap');
    }
    expect(codes(MotivationLicenceType.S13_SELF_DEFENCE, {})).toEqual([]);
  });
});

describe('section 15(3) — four, three, and one handgun', () => {
  const four = {
    ...held(1, { existing_firearm_1_section_held: 'section_15' }),
    ...held(2, { existing_firearm_2_section_held: 'section_15' }),
    ...held(3, { existing_firearm_3_section_held: 'section_15' }),
    ...held(4, { existing_firearm_4_section_held: 'section_15' }),
  };

  it('is quiet at three held, warns at four', () => {
    const three = { ...four };
    delete (three as Record<string, string>).existing_firearm_4_make;
    delete (three as Record<string, string>).existing_firearm_4_calibre;
    delete (three as Record<string, string>).existing_firearm_4_serial;
    delete (three as Record<string, string>).existing_firearm_4_section_held;
    expect(codes(MotivationLicenceType.S15_OCCASIONAL_HUNTER, three)).not.toContain(
      'section-15-cap',
    );
    expect(codes(MotivationLicenceType.S15_OCCASIONAL_HUNTER, four)).toContain(
      'section-15-cap',
    );
  });

  it('⚠️ DROPS THE CEILING TO THREE WHERE A SECTION 13 IS HELD', () => {
    const three = {
      ...held(1, { existing_firearm_1_section_held: 'section_15' }),
      ...held(2, { existing_firearm_2_section_held: 'section_15' }),
      ...held(3, { existing_firearm_3_section_held: 'section_15' }),
      ...held(4, { existing_firearm_4_section_held: 'section_13' }),
    };
    const out = applicationWarnings(
      MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      three,
    );
    const cap = out.find((w) => w.code === 'section-15-cap')!;
    expect(cap).toBeDefined();
    expect(cap.message).toContain('the Act allows 3');
    expect(cap.message).toContain('because you also hold a section 13');
  });

  it('warns on a second section 15 handgun', () => {
    expect(
      codes(MotivationLicenceType.S15_OCCASIONAL_HUNTER, {
        firearm_type: 'Handgun',
        ...held(1, {
          existing_firearm_1_section_held: 'section_15',
          existing_firearm_1_type: 'Handgun',
        }),
      }),
    ).toContain('section-15-handgun-cap');
  });

  it('says nothing about a handgun when the held one is a rifle', () => {
    expect(
      codes(MotivationLicenceType.S15_OCCASIONAL_HUNTER, {
        firearm_type: 'Handgun',
        ...held(1, {
          existing_firearm_1_section_held: 'section_15',
          existing_firearm_1_type: 'Rifle',
        }),
      }),
    ).not.toContain('section-15-handgun-cap');
  });
});

describe('section 16(1)(c) — five shots', () => {
  const shotgun = {
    firearm_type: 'Shotgun',
    firearm_action: 'Semi-automatic (self-loading)',
  };

  it('warns over five, and names section 14 as the alternative', () => {
    const out = applicationWarnings(MotivationLicenceType.S16_DEDICATED_SPORT, {
      ...shotgun,
      firearm_capacity: '8',
    });
    const w = out.find((x) => x.code === 'section-16-shotgun-capacity')!;
    expect(w).toBeDefined();
    expect(w.message).toContain('Section 14 is the alternative');
  });

  it('is quiet at five, and quiet when the capacity was not given', () => {
    for (const cap of ['5', '', 'unknown']) {
      expect(
        codes(MotivationLicenceType.S16_DEDICATED_SPORT, {
          ...shotgun,
          firearm_capacity: cap,
        }),
      ).not.toContain('section-16-shotgun-capacity');
    }
  });

  it('says nothing about a manual shotgun', () => {
    expect(
      codes(MotivationLicenceType.S16_DEDICATED_SPORT, {
        firearm_type: 'Shotgun',
        firearm_action: 'Pump action',
        firearm_capacity: '8',
      }),
    ).not.toContain('section-16-shotgun-capacity');
  });
});

describe('section 24 — the ninety days', () => {
  it('warns inside the window and says what is lost', () => {
    const out = applicationWarnings(
      MotivationLicenceType.S24_RENEWAL,
      { licence_expiry: '2026-10-20' },
      new Date('2026-09-09T06:00:00Z'),
    );
    const w = out.find((x) => x.code === 'renewal-inside-90-days')!;
    expect(w).toBeDefined();
    expect(w.message).toContain('will NOT automatically stay valid');
  });

  it('is quiet with more than ninety days to run', () => {
    expect(
      codes(
        MotivationLicenceType.S24_RENEWAL,
        { licence_expiry: '2027-06-30' },
        new Date('2026-09-09T06:00:00Z'),
      ),
    ).not.toContain('renewal-inside-90-days');
  });

  it('says something different once it has already expired', () => {
    const out = applicationWarnings(
      MotivationLicenceType.S24_RENEWAL,
      { licence_expiry: '2026-08-01' },
      new Date('2026-09-09T06:00:00Z'),
    );
    expect(out[0].message).toContain('already expired');
  });

  it('is quiet when there is no readable expiry', () => {
    expect(
      codes(MotivationLicenceType.S24_RENEWAL, { licence_expiry: 'soon' }),
    ).toEqual([]);
  });
});

describe('the two that are practice rather than the Act', () => {
  it('tells a section 15 association member the definition has not caught up', () => {
    const out = applicationWarnings(
      MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      { association_name: 'SA Hunters' },
    );
    const w = out.find((x) => x.code === 'section-15-association-member')!;
    expect(w).toBeDefined();
    expect(w.message).toContain('never claims dedicated status');
  });

  it('⚠️ LABELS THE SEMI-AUTO HUNTING WARNING AS POLICY, NOT LAW', () => {
    const out = applicationWarnings(
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      { firearm_action: 'Semi-automatic (self-loading)' },
    );
    const w = out.find((x) => x.code === 'semi-auto-hunting-not-landowner')!;
    expect(w).toBeDefined();
    expect(w.authority).toContain('not the Act');
  });
});
