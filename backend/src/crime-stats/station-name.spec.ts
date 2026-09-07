import { addressPlaceTokens, normaliseStationName } from './station-name';

describe('normaliseStationName', () => {
  it('reduces every way Google spells a station to the way SAPS spells it', () => {
    const saps = normaliseStationName('Brooklyn');
    for (const google of [
      'Brooklyn SAPS',
      'SAPS Brooklyn',
      'Brooklyn Police Station',
      'BROOKLYN POLICE STATION',
      'South African Police Service - Brooklyn',
      'Brooklyn Police Station, Pretoria',
      'Brooklyn Polisiestasie',
    ]) {
      expect(normaliseStationName(google)).toBe(saps);
    }
  });

  it('strips the longest phrase first', () => {
    // ⚠️ Strip "police" before "south african police service" and the
    // leftover "south african service" matches nothing.
    expect(normaliseStationName('South African Police Service Sandton')).toBe(
      'sandton',
    );
  });

  it('keeps a two-word station name whole', () => {
    expect(normaliseStationName('Table View Police Station')).toBe('table view');
    expect(normaliseStationName('Cape Town Central SAPS')).toBe(
      'cape town central',
    );
  });

  it('folds accents, so a member typing without them still matches', () => {
    expect(normaliseStationName('Mokopané')).toBe(
      normaliseStationName('Mokopane'),
    );
  });

  it('is empty for a name made only of noise, and never throws on rubbish', () => {
    expect(normaliseStationName('Police Station')).toBe('');
    expect(normaliseStationName('')).toBe('');
    expect(normaliseStationName('   ---   ')).toBe('');
  });
});

describe('addressPlaceTokens', () => {
  it('offers two-word phrases before single words', () => {
    // "Table View" is a station; "Table" and "View" are not.
    const tokens = addressPlaceTokens('9 Blaauwberg Road, Table View, 7441');
    expect(tokens.indexOf('table view')).toBeLessThan(tokens.indexOf('table'));
  });

  it('drops street types, unit words and the country', () => {
    const tokens = addressPlaceTokens('12 Main Road, Brooklyn, South Africa');
    expect(tokens).toContain('brooklyn');
    expect(tokens).not.toContain('road');
    expect(tokens).not.toContain('africa');
  });

  it('drops street numbers and postal codes', () => {
    const tokens = addressPlaceTokens('412 Duncan Street, Hatfield, 0083');
    expect(tokens).not.toContain('412');
    expect(tokens).not.toContain('0083');
    expect(tokens).toContain('hatfield');
  });

  it('keeps city and province words, because stations are named after them', () => {
    // ⚠️ "Cape Town Central" is a real precinct. Tidying "cape" away as a
    // province word would make it unreachable.
    expect(addressPlaceTokens('Long Street, Cape Town')).toContain('cape town');
  });

  it('returns nothing for an address with no place words', () => {
    expect(addressPlaceTokens('12 34')).toEqual([]);
    expect(addressPlaceTokens('')).toEqual([]);
  });
});
