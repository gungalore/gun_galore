import {
  resolveSportingPurpose,
  s15Purpose,
  weaponClass,
} from './motivation-purpose';

// ────────────────────────────────────────────────────────────────────
// THE ROUTE IS RESOLVED FROM THE PACK (2026-10-17).
//
// Operator: "first look at what firearms they already own and what section the
// licenses falls in, look for gaps that the current calibre fills best in
// hunting or sport shooting and use it in that. Rmember a person may sport
// shoot or hunt with a firearm regardless of the dedicated status, as long as
// they posses a legal license for that firearm they may use it for any lawfull
// purpose."
// ────────────────────────────────────────────────────────────────────

const MANUAL_RIFLE = {
  firearm_type: 'Rifle',
  firearm_action: 'Bolt action',
  firearm_calibre: '6.5 Creedmoor',
};

describe('the firearm decides a handgun or a self-loader', () => {
  it('argues a handgun in sport, whatever the licence type', () => {
    expect(resolveSportingPurpose({ firearm_type: 'Handgun' })).toBe('sport');
    expect(
      resolveSportingPurpose({
        firearm_type: 'Handgun',
        firearm_calibre: '9MM PAR ( 9X19MM )',
      }),
    ).toBe('sport');
  });

  it('argues a self-loading rifle or shotgun in sport', () => {
    expect(
      resolveSportingPurpose({
        firearm_type: 'Rifle',
        firearm_action: 'Semi-automatic (self-loading)',
        firearm_calibre: '.223 Remington',
      }),
    ).toBe('sport');
    expect(
      resolveSportingPurpose({
        firearm_type: 'Shotgun',
        firearm_action: 'Semi-automatic (self-loading)',
        firearm_calibre: '12 GAUGE',
      }),
    ).toBe('sport');
  });
});

describe('a manual rifle can do both, and the battery finds the gap', () => {
  it('argues both when nothing comparable is held', () => {
    expect(resolveSportingPurpose(MANUAL_RIFLE)).toBe('both');
  });

  it('argues the sport gap when the held same-class rifle is the hunting one', () => {
    expect(
      resolveSportingPurpose({
        ...MANUAL_RIFLE,
        existing_firearm_1_type: 'Rifle',
        existing_firearm_1_calibre: '6.5 Creedmoor',
        existing_firearm_1_use: 'bushveld plains game',
      }),
    ).toBe('sport');
  });

  it('argues the hunting gap when the held same-class rifle is the match one', () => {
    expect(
      resolveSportingPurpose({
        ...MANUAL_RIFLE,
        existing_firearm_1_type: 'Rifle',
        existing_firearm_1_calibre: '6.5 Creedmoor',
        existing_firearm_1_primary_use: 'sport_competition',
      }),
    ).toBe('hunting');
  });

  it('ignores a self-defence firearm in the battery', () => {
    // An S13 handgun does not fill a hunting or sport role.
    expect(
      resolveSportingPurpose({
        ...MANUAL_RIFLE,
        existing_firearm_1_type: 'Handgun',
        existing_firearm_1_calibre: '9MM PAR',
        existing_firearm_1_section_held: 'section_13',
        existing_firearm_1_use: 'self-defence carry',
      }),
    ).toBe('both');
  });
});

describe('a dangerous-game chambering is hunting', () => {
  it('recognises the curated table and the common big-bores', () => {
    for (const calibre of ['.375 H&H Magnum', '9.3x62', '.416 Rigby', '.458 Lott']) {
      expect(
        resolveSportingPurpose({
          firearm_type: 'Rifle',
          firearm_action: 'Bolt action',
          firearm_calibre: calibre,
        }),
      ).toBe('hunting');
    }
  });
});

describe('the heading leads with hunting on a tie', () => {
  it('turns "both" into the hunting heading', () => {
    expect(s15Purpose(MANUAL_RIFLE)).toBe('hunting');
    expect(s15Purpose({ firearm_type: 'Handgun' })).toBe('sport');
  });
});

describe('the class reader', () => {
  it('reads the type first and the calibre only as a tie-breaker', () => {
    expect(weaponClass({ firearm_type: 'Handgun' })).toBe('handgun');
    expect(weaponClass({ firearm_calibre: '9MM PAR ( 9X19MM )' })).toBe(
      'handgun',
    );
    expect(
      weaponClass({ firearm_type: 'Rifle', firearm_calibre: '9MM PAR' }),
    ).toBe('rifle');
  });
});
