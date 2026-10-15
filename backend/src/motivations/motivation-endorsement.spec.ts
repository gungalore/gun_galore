import { endorsementVerdict } from './motivation-endorsement';

// The operator's own SA Hunters endorsement (2026-10-15): a "SUITABILITY OF
// FIREARM" table reading Handgun · 9 mm Parabellum · Glock · Self loading ·
// ZABA01892, against a Glock 9 mm Parabellum handgun application.
const ENDORSED = {
  firearm_type: 'Handgun',
  firearm_calibre: '9 mm Parabellum',
  firearm_make: 'Glock',
  firearm_action: 'Self loading',
  firearm_serial: 'ZABA01892',
};

const APPLIED = {
  firearm_type: 'Handgun',
  firearm_calibre: '9mm Parabellum (9x19mm)',
  firearm_make: 'GLOCK',
  firearm_action: 'Self loading',
  firearm_serial: 'ZABA01892',
};

describe('endorsementVerdict', () => {
  it('matches when the serials agree, whatever the wording', () => {
    expect(endorsementVerdict(ENDORSED, APPLIED)).toBe('match');
  });

  it('accepts a serial printed with spaces or punctuation', () => {
    expect(
      endorsementVerdict(
        { ...ENDORSED, firearm_serial: 'zaba 01892' },
        APPLIED,
      ),
    ).toBe('match');
  });

  it('⚠️ REFUSES A DIFFERENT SERIAL even when every other field agrees', () => {
    // Two 9 mm Glocks are the norm; the serial is the only thing that tells
    // them apart, and a same-make endorsement for the wrong one is the exact
    // document the library guard exists to keep out.
    expect(
      endorsementVerdict({ ...ENDORSED, firearm_serial: 'ZABA09999' }, APPLIED),
    ).toBe('mismatch');
  });

  it('falls back to type + calibre when the application has no serial yet', () => {
    const applied = { ...APPLIED, firearm_serial: '' };
    expect(endorsementVerdict(ENDORSED, applied)).toBe('match');
  });

  it('refuses a plainly different class when no serial is available', () => {
    const applied = { ...APPLIED, firearm_serial: '', firearm_type: 'Shotgun' };
    expect(endorsementVerdict(ENDORSED, applied)).toBe('mismatch');
  });

  it('refuses a clearly different calibre when no serial is available', () => {
    const applied = {
      ...APPLIED,
      firearm_serial: '',
      firearm_calibre: '.308 Winchester',
    };
    expect(endorsementVerdict(ENDORSED, applied)).toBe('mismatch');
  });

  it('⚠️ DOES NOT REFUSE on a same-number calibre wording it cannot expand', () => {
    // "9 mm" and "9x19mm" are the same round. The invariant that matters is
    // that this never reads as a MISMATCH — match or unverified are both safe.
    expect(
      endorsementVerdict(
        { ...ENDORSED, firearm_serial: '', firearm_calibre: '9mm' },
        { ...APPLIED, firearm_serial: '', firearm_calibre: '9x19mm' },
      ),
    ).not.toBe('mismatch');
  });

  it('is unverified when neither side describes the firearm', () => {
    expect(endorsementVerdict({}, {})).toBe('unverified');
  });

  it('is unverified when the endorsement names nothing readable', () => {
    expect(endorsementVerdict({}, APPLIED)).toBe('unverified');
  });
});
