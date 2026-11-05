import { huntGameClassOptions } from './motivation-hunt-classes';

const keys = (calibre: string) =>
  huntGameClassOptions(calibre).map((option) => option.key);

describe('the hunt-class menu follows the calibre', () => {
  it('does not offer dangerous game to a varmint rifle', () => {
    expect(keys('.223 Remington')).toEqual(['small', 'plains_light']);
  });

  it('does not offer wingshooting to a .30-06', () => {
    expect(keys('.30-06 Springfield')).toEqual([
      'plains_light',
      'plains_medium',
    ]);
  });

  it('offers only birds to a shotgun', () => {
    expect(keys('12 gauge')).toEqual(['wingshooting']);
  });

  it('offers only dangerous game to a dangerous-game chambering', () => {
    expect(keys('.458 Lott')).toEqual(['dangerous']);
  });

  it('does not call a .338 a dangerous-game rifle', () => {
    expect(keys('.338 Winchester Magnum')).toEqual(['plains_medium']);
  });

  it('adds dangerous game for a .375', () => {
    expect(keys('.375 H&H')).toEqual(['plains_medium', 'dangerous']);
  });

  it('keeps the full menu when the calibre is unknown', () => {
    expect(keys('some wildcat')).toHaveLength(5);
  });
});

