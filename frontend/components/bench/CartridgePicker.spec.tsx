import { describe, expect, it } from 'vitest';
import { cartridgeHay, fold } from './CartridgePicker';

/**
 * THE BENCH — the cartridge picker's matching.
 *
 * ⚠️ THIS IS THE FILE THAT SAYS THE SCREEN IS REACHABLE. Cartridge names are
 * stored with a EUROPEAN DECIMAL COMMA — "6,5 Creedmoor", "7,62 x 54 R" — and
 * a South African member types a full stop, or nothing at all, as often as
 * they type the comma. A plain substring match finds the cartridge for exactly
 * one of those spellings and answers the other two with "Nothing matches that
 * name", on the one screen whose whole job is to stop the bench being empty.
 *
 * The picker filters in the browser, so nothing on the server can rescue a
 * needle that does not land. Hence a spec, not a comment.
 */

/** Exactly what the component does: fold the term, look for it in the hay. */
function finds(c: { name: string; key: string }, typed: string): boolean {
  return cartridgeHay(c).includes(fold(typed));
}

/** As stored: `name` is the reference spelling, `key` is cartridgeKey(name). */
const CREEDMOOR = { name: '6,5 Creedmoor', key: '65creedmoor' };
const RUSSIAN = { name: '7,62 x 54 R', key: '762x54r' };
const WINCHESTER = { name: '.308 Win.', key: '308winchester' };

describe('the cartridge picker finds a cartridge however the member spells it', () => {
  it.each([
    ['the stored spelling', '6,5 Creedmoor'],
    ['a full stop', '6.5 creedmoor'],
    ['no separator at all', '65 creedmoor'],
    ['no space either', '65creedmoor'],
    ['upper case', '6.5 CREEDMOOR'],
    ['the name alone', 'creedmoor'],
  ])('%s finds 6,5 Creedmoor', (_label, typed) => {
    expect(finds(CREEDMOOR, typed)).toBe(true);
  });

  it.each([
    ['the stored spelling', '7,62 x 54 R'],
    ['full stops for commas', '7.62x54r'],
    ['the typographic multiplication sign', '7,62 × 54 R'],
    ['the multiplication sign with no spaces', '7.62×54R'],
  ])('%s finds 7,62 x 54 R', (_label, typed) => {
    expect(finds(RUSSIAN, typed)).toBe(true);
  });

  /**
   * ⚠️ A KNOWN GAP, PINNED SO IT IS A DECISION RATHER THAN A SURPRISE. The
   * server's cartridgeKey() drops a "mm" that follows a figure; fold() does
   * not, so a member who pastes a spelling carrying the unit the stored name
   * leaves off — "7.62x54mm" against "7,62 x 54 R" — finds nothing. It does
   * not bite the common names, because both the name AND the expanded key are
   * searched: "9mm" finds "9 mm Luger" through the name, "10 auto" finds
   * "10 mm Auto" through the key. Closing it means teaching fold() the same
   * unit rule, which is a change to matching and belongs to whoever owns that
   * call, not to a passing edit.
   */
  it('a pasted mm unit the stored name does not carry is NOT matched today', () => {
    expect(finds(RUSSIAN, '7.62x54mm')).toBe(false);
    // The names that do carry it are unaffected, which is why this is a gap
    // and not an outage.
    expect(finds({ name: '9 mm Luger', key: '9luger' }, '9mm')).toBe(true);
    expect(finds({ name: '10 mm Auto', key: '10auto' }, '10 auto')).toBe(true);
  });

  it('a name stored with × is still found by someone typing x', () => {
    expect(finds({ name: '7,62 × 54 R', key: '762x54r' }, '7.62 x 54 r')).toBe(true);
  });

  it('the expanded key is searched too, so the abbreviation and the word both land', () => {
    expect(finds(WINCHESTER, '308 win')).toBe(true);
    expect(finds(WINCHESTER, '.308 Winchester')).toBe(true);
  });

  it('an unrelated cartridge is still not a match', () => {
    expect(finds(CREEDMOOR, '308')).toBe(false);
    expect(finds(RUSSIAN, 'creedmoor')).toBe(false);
  });

  /**
   * The deliberate limit, pinned so nobody "fixes" it: the x between the two
   * figures of a metric name is a letter, so folding it away as well would run
   * "6x47" and "647" into one another.
   */
  it('the x is a letter, not punctuation', () => {
    expect(finds(RUSSIAN, '762 54 r')).toBe(false);
    expect(finds({ name: '6 x 47 ATZL', key: '6x47atzl' }, '647')).toBe(false);
  });

  it('a needle that folds away to nothing matches everything, not nothing', () => {
    // The component shows the whole list for an empty needle; the guard here
    // is that a lone comma folds to '' rather than to a character no name has.
    expect(fold(',')).toBe('');
    expect(finds(CREEDMOOR, ',')).toBe(true);
  });
});
