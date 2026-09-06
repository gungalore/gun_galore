import * as fs from 'node:fs';
import * as path from 'node:path';
import { bulletCategory, num, powderKey, slugify } from './bench-import';

/**
 * THE BENCH — the import's normalisers.
 *
 * 🚨 THESE FOUR FUNCTIONS DECIDE WHAT THE CATALOGUE IS, AND EVERY ONE OF THEM
 * FAILS QUIETLY. A powder key that disagrees splits one powder into two rows a
 * member has to choose between; a category rule that fires in the wrong order
 * puts one projectile's charge range under another's name; a number that will
 * not parse drops the row with nothing printed. The script's own failure mode
 * is a tidy report over missing data, so the parts are tested here rather than
 * inferred from the totals.
 */

describe('The Bench — the canonical powder name', () => {
  it.each([
    // The spec's own examples, §3.3 step 2.
    ['H 4350', 'H4350'],
    ['H4350', 'H4350'],
    ['N-160', 'N160'],
    ['N160', 'N160'],
    ['Alliant RL-15', 'RL15'],
    ['NORMA 203 B', 'NORMA203B'],
    // Case is not identity: a straight majority elects the DISPLAY name, and
    // the key must not move with it.
    ['Varget', 'VARGET'],
    ['VARGET', 'VARGET'],
  ])('reads %p as %p', (printed, key) => {
    expect(powderKey(printed)).toBe(key);
  });

  it('folds a maker written in front of the product name', () => {
    // "Hodgdon H4350" and "H4350" are one bottle.
    expect(powderKey('Hodgdon H4350')).toBe(powderKey('H4350'));
    expect(powderKey('Vihtavuori N160')).toBe(powderKey('N160'));
  });

  /**
   * 🚨 THE PREFIX LIST CANNOT BE GENERALISED, AND THESE TWO ARE WHY. "NORMA
   * 203 B" is the powder's name, not a maker in front of one; and "IMR 4350"
   * is a DIFFERENT powder from "H4350", so stripping IMR would leave "4350",
   * which is nobody's product and would merge two powders that behave
   * differently.
   */
  it.each([
    ['NORMA 203 B', 'NORMA203B'],
    ['IMR 4350', 'IMR4350'],
    ['Winchester 748', 'WINCHESTER748'],
  ])('leaves %p alone', (printed, key) => {
    expect(powderKey(printed)).toBe(key);
  });

  it('never strips a maker to nothing', () => {
    // A row whose powder_name is only the maker keeps it, rather than
    // canonicalising to the empty string and being reported unresolved.
    expect(powderKey('Alliant')).toBe('ALLIANT');
  });

  /**
   * ⚠️ THE MIGRATION'S BACKFILL HARD-CODES THE SAME THREE WORDS. A prefix
   * added here that the SQL does not know re-splits the powder at the next
   * import — the very thing the key column exists to stop — so the two lists
   * are compared rather than trusted.
   */
  it('strips exactly the prefixes the migration backfills', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../../../prisma/migrations/20260906120000_bench_audit/migration.sql'),
      'utf8',
    );
    const inSql = /regexp_replace\(name, '\^\(([^)]+)\)/.exec(sql);
    expect(inSql).not.toBeNull();

    const words = inSql![1].split('|').map((w) => w.toUpperCase()).sort();
    expect(words).toEqual(['ALLIANT', 'HODGDON', 'VIHTAVUORI']);
    for (const w of words) {
      // Each one really is stripped by the code, not merely listed in the SQL.
      expect(powderKey(`${w} 999`)).toBe('999');
    }
  });
});

/**
 * 🚨 FIRST MATCH WINS, AND THE ORDER IS THE SPEC'S (SPEC-BUILD §3.3 step 4):
 * FMJ · the construction group (MONO, TIP, SP) · HP · CAST · else OTHER.
 * `bulletCategory` is part of BenchLoad's unique key, so the order decides
 * which GROUP a source row consolidates into — and a group is one start charge
 * and one max charge.
 */
describe('The Bench — the bullet category', () => {
  it.each([
    ['FMJ', 'FMJ'],
    ['TMJ RN', 'FMJ'],
    ['TTSX BT', 'MONO'],
    ['GMX', 'MONO'],
    ['ELD-X', 'TIP'],
    ['V-MAX', 'TIP'],
    ['Ballistic Tip', 'TIP'],
    ['InterLock SP', 'SP'],
    ['Partition', 'SP'],
    ['Spitzer', 'SP'],
    ['ELD Match', 'HP'],
    ['HPBT', 'HP'],
    ['Scenar', 'HP'],
    ['RNGC', 'CAST'],
    ['Round Nose', 'OTHER'],
  ])('reads %p as %p', (type, cat) => {
    expect(bulletCategory(type)).toBe(cat);
  });

  /**
   * The pair that moved. The spec puts the construction group ahead of HP, so
   * a Partition that also says HP is a Partition — the code had it the other
   * way round.
   */
  it('lets the construction win over the hollow point, as the spec orders them', () => {
    expect(bulletCategory('Partition HP')).toBe('SP');
    expect(bulletCategory('TTSX HP')).toBe('MONO');
  });

  it('leaves an ELD Match alone, which is what HP-after-SP had to preserve', () => {
    // The reason the old order existed: "ELD Match" must not fall through to
    // the soft-point bucket. It does not — the SP rule does not match it.
    expect(bulletCategory('ELD Match')).toBe('HP');
    expect(bulletCategory('HDY ELD-M')).toBe('HP');
  });
});

/**
 * 🚨 `v.replace(',', '.')` REPLACED THE FIRST COMMA ONLY. "1,234.5" became
 * "1.234.5" → NaN → null → the row dropped by a guard, silently, in a script
 * whose failure mode is a tidy report over missing data.
 */
describe('The Bench — numbers off the CSV', () => {
  it.each([
    ['plain', '41.5', 41.5],
    ['an integer', '140', 140],
    ['a European decimal comma', '35,6', 35.6],
    ['a thousands separator', '1,234.5', 1234.5],
    ['several separators', '1,234,567', 1234567],
    ['blank', '', null],
    ['whitespace', '   ', null],
    ['free text', 'n/a', null],
    // Two commas with no decimal point and the wrong grouping is not a number
    // in either convention, and is not guessed into one.
    ['an ambiguous mess', '1,23,4', null],
  ])('reads %s', (_name, raw, expected) => {
    expect(num(raw)).toBe(expected);
  });
});

describe('The Bench — the cartridge slug', () => {
  it('turns the decimal comma into a dash, as the spec spells it', () => {
    expect(slugify('6,5 Creedmoor')).toBe('6-5-creedmoor');
  });

  /**
   * 🚨 THE COLLISION THE IMPORT NOW HANDLES. The comma and the full stop both
   * become a dash, so two reference rows spelled differently want ONE slug —
   * and the unique index used to throw a raw P2002 halfway through the loop,
   * with half the cartridges written and the rest never attempted.
   */
  it('collides on two spellings of one name, which is why the import de-duplicates', () => {
    expect(slugify('6,5 Creedmoor')).toBe(slugify('6.5 Creedmoor'));
  });
});

describe('The Bench — a load row finds its cartridge', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { cipLookupKey, decodeEntities } = require('./bench-import') as typeof import('./bench-import');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { cartridgeKey } = require('../../common/cartridge-key') as typeof import('../../common/cartridge-key');

  it('reads through the HTML entities the scrape left in the file', () => {
    expect(decodeEntities('.300 H &amp; H Magnum')).toBe('.300 H & H Magnum');
    expect(cartridgeKey(decodeEntities('.300 H &amp; H Magnum'))).toBe(cartridgeKey('.300 H&H Magnum'));
  });

  it("finds a C.I.P. sheet under the manual's spelling, without moving the stored key", () => {
    // What a manual prints -> what the sheet prints. Both sides go through the
    // lookup; only the sheet's own name is ever keyed for storage.
    for (const [printed, sheet] of [
      ['378 Weatherby Magnum', '378 Weath. Mag.'],
      ['300 Weath. Mag.', '300 Weath. Mag.'],
      ['6.5x55 Swed. Mauser', '6,5 x 55 SE'],
      ['6,5 x 55 SE', '6,5 x 55 SE'],
      ['7.5 X 55mm Schmidt Rubin (7.5mm Swiss)', '7,5 x 55 Suisse'],
      ['505 Gibbs', '505 Mag. Gibbs'],
      ['.505 GIBBS - Rimless Magnum', '505 Mag. Gibbs'],
    ]) {
      expect(cipLookupKey(printed)).toBe(cipLookupKey(sheet));
    }
    // The stored key is cartridgeKey() of the sheet name, untouched by the synonyms.
    expect(cartridgeKey('300 Weath. Mag.')).toBe('300weathmagnum');
  });

  it('does not conflate cartridges the synonyms do not name', () => {
    expect(cipLookupKey('300 Win. Mag.')).not.toBe(cipLookupKey('300 Weath. Mag.'));
    expect(cipLookupKey('6,5 x 55 SE')).not.toBe(cipLookupKey('6,5 x 57'));
  });
});
