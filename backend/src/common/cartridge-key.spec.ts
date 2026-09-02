import { cartridgeKey } from './cartridge-key';

/**
 * A characterisation test, not a design test.
 *
 * 🚨 THESE VALUES WERE CAPTURED FROM THE FUNCTION AS IT RAN IN THE LOAD LAB,
 * BEFORE IT MOVED HERE. They are not what anyone thinks a good key looks like
 * — they are what is already written into `CartridgeSpec.key` and the
 * `cartridgeKey` column of 50,789 `ManualLoad` rows, plus every Bench table
 * keyed the same way.
 *
 * A failure here means a change re-keys stored data. There is no migration
 * path and no error at runtime: the joins keep working and simply return
 * nothing. Fix the change, never the expectation.
 */
describe('cartridgeKey — the stored key must not move', () => {
  const CAPTURED: [string, string][] = [
    // The case the function exists for: GRT's spelling and the manual's must
    // land on one key.
    ['.308 Win. (7.62x51)', '308winchester'],
    ['.308 Winchester', '308winchester'],

    // European decimal comma and the "mm" the Somchem site writes.
    ['6,5 Creedmoor', '65creedmoor'],
    ['6.5 Creedmoor', '65creedmoor'],
    ['6.5mm Creedmoor', '65creedmoor'],
    ['9.3x62mm', '93x62'],

    ['.223 Rem', '223remington'],
    ['.30-06 Sprg', '3006springfield'],
    ['.300 Win Mag', '300winchestermagnum'],
    ['7mm Rem Mag', '7remingtonmagnum'],
    ['.270 WBY Magnum', '270weatherbymagnum'],
    ['.375 H&H Magnum', '375hhmagnum'],
    ['.338 Lapua Magnum', '338lapuamagnum'],

    // NATO maps to the empty string, so this is 5.56 and nothing else. Odd,
    // and load-bearing: it is what is stored.
    ['5.56 NATO', '556'],

    // The C.I.P. index really does hold a key of "22" for this sheet.
    ['22 (5,6/16)', '22'],

    ['', ''],
    [' ', ''],
  ];

  it.each(CAPTURED)('%j → %j', (input, expected) => {
    expect(cartridgeKey(input)).toBe(expected);
  });

  it('never emits a character outside [a-z0-9]', () => {
    for (const [input] of CAPTURED) {
      expect(cartridgeKey(input)).toMatch(/^[a-z0-9]*$/);
    }
  });

  it('is idempotent — keying a key returns the key', () => {
    // The importer and the query both call this, sometimes on already-keyed
    // input; a non-idempotent key would split one cartridge into two.
    for (const [, expected] of CAPTURED) {
      expect(cartridgeKey(expected)).toBe(expected);
    }
  });

  it('tolerates a null or undefined name rather than throwing', () => {
    expect(cartridgeKey(null as unknown as string)).toBe('');
    expect(cartridgeKey(undefined as unknown as string)).toBe('');
  });
});
