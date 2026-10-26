import { resolvePostalArea } from './postal-locality';

// ────────────────────────────────────────────────────────────────────
// The buyer-facing area comes from the POSTAL CODE, not from Google's
// `locality`. A Kraaifontein address has locality "Cape Town"; code 7570
// names Kraaifontein, which is the area a buyer is actually driving to.
// ────────────────────────────────────────────────────────────────────

describe('resolvePostalArea', () => {
  it('names the postal area rather than the metro', () => {
    expect(resolvePostalArea({ postalCode: '7570' })).toBe('Kraaifontein');
  });

  it('tolerates stray whitespace in the code', () => {
    expect(resolvePostalArea({ postalCode: ' 7570 ' })).toBe('Kraaifontein');
  });

  it('prefers the suburb name attached to the code when a code lists several', () => {
    // 7530 lists both Bellville and Cape Town.
    expect(resolvePostalArea({ postalCode: '7530', suburb: 'Bellville' })).toBe(
      'Bellville',
    );
    expect(
      resolvePostalArea({ postalCode: '7530', suburb: '  bellville ' }),
    ).toBe('Bellville');
  });

  it('falls back to the name nearest the pickup coordinates', () => {
    // 3610 covers Pinetown and its neighbours; a Pinetown point resolves to it.
    expect(
      resolvePostalArea({ postalCode: '3610', lat: -29.817, lng: 30.85 }),
    ).toBe('Pinetown');
    // 0157 covers Centurion and Pretoria names; the Centurion point wins.
    expect(
      resolvePostalArea({ postalCode: '0157', lat: -25.86, lng: 28.189 }),
    ).toBe('Centurion');
  });

  it('returns null when a multi-name code has no signal to choose from', () => {
    expect(resolvePostalArea({ postalCode: '7530' })).toBeNull();
  });

  it('returns null for unknown or malformed codes', () => {
    expect(resolvePostalArea({ postalCode: '9999' })).toBeNull();
    expect(resolvePostalArea({ postalCode: '757' })).toBeNull();
    expect(resolvePostalArea({ postalCode: 'ABC1' })).toBeNull();
    expect(resolvePostalArea({ postalCode: '' })).toBeNull();
    expect(resolvePostalArea({})).toBeNull();
  });
});
