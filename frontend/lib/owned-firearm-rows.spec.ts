import { describe, expect, it } from 'vitest';
import {
  groupRows,
  rowInUse,
  rowIndex,
  rowsToShow,
} from './owned-firearm-rows';

// ────────────────────────────────────────────────────────────────────
// WHICH OF THE SIX OWNED-FIREARM ROWS A MEMBER IS SHOWN.
//
// ⚠️ THESE EXIST BECAUSE THE RULE WAS WRONG IN JSX AND NOTHING COULD SEE IT.
// The first version counted HOW MANY rows were in use rather than which was
// the LAST — so a member whose vault filled rows 1 and 4 was shown three rows,
// and row 4, carrying their own licensed firearm, silently disappeared off
// their application.
//
// It could not be caught by looking: Clerk's publishable key is domain-locked,
// so no signed-in session exists on a dev machine and this screen cannot be
// opened at all locally. A rule nobody can see is a rule that has to be tested.
// ────────────────────────────────────────────────────────────────────

const COLUMNS = [
  'type',
  'calibre',
  'make',
  'use',
  'barrel_serial',
  'frame_serial',
  'licence_no',
] as const;

/** The registry's real shape: six rows of seven, flat. */
const FIELDS = Array.from({ length: 6 }, (_, i) =>
  COLUMNS.map((c) => ({ key: `existing_firearm_${i + 1}_${c}` })),
).flat();

const ROWS = groupRows(FIELDS);

/** Put a make into row n, the way the vault does. */
const owning = (...rows: number[]): Record<string, string> =>
  Object.fromEntries(rows.map((n) => [`existing_firearm_${n}_make`, 'Tikka']));

describe('rowIndex', () => {
  it('reads the row number out of a column key', () => {
    expect(rowIndex('existing_firearm_3_make')).toBe(3);
    expect(rowIndex('existing_firearm_1_barrel_serial')).toBe(1);
  });

  it('returns null for anything that is not a row field', () => {
    // These share the section or the prefix and are NOT rows. Folding one into
    // row 1 would put a section-level question inside somebody's first firearm.
    for (const k of [
      'safe_present',
      'firearm_make',
      'existing_firearm_make',
      'existing_firearm__make',
    ]) {
      expect(rowIndex(k)).toBeNull();
    }
  });

  it('refuses a row number that is not a positive integer', () => {
    // A malformed key is not row 0, and treating it as one would create a
    // seventh row nothing can save.
    expect(rowIndex('existing_firearm_0_make')).toBeNull();
  });
});

describe('groupRows', () => {
  it('turns 42 flat fields into 6 rows of 7, in order', () => {
    expect(ROWS).toHaveLength(6);
    expect(ROWS.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const [, fs] of ROWS) expect(fs).toHaveLength(7);
  });

  it('drops fields that are not rows rather than guessing where they go', () => {
    const rows = groupRows([...FIELDS, { key: 'safe_present' }]);
    expect(rows).toHaveLength(6);
    expect(rows.flatMap(([, fs]) => fs.map((f) => f.key))).not.toContain(
      'safe_present',
    );
  });

  it('orders numerically, not lexically', () => {
    // Sorted as strings, 10 comes before 2. There are only six rows today and
    // there is no reason for that to be what stops this being wrong.
    const many = Array.from({ length: 12 }, (_, i) => ({
      key: `existing_firearm_${i + 1}_make`,
    }));
    expect(groupRows(many).map(([n]) => n)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
});

describe('rowInUse', () => {
  it('is true when ANY column carries a value', () => {
    const [, row] = ROWS[0];
    expect(rowInUse(row, {})).toBe(false);
    expect(rowInUse(row, { existing_firearm_1_licence_no: 'LIC-1' })).toBe(
      true,
    );
  });

  it('treats whitespace as empty', () => {
    const [, row] = ROWS[0];
    expect(rowInUse(row, { existing_firearm_1_make: '   ' })).toBe(false);
  });
});

describe('rowsToShow', () => {
  it('shows one row to a member who owns nothing yet', () => {
    // ⚠️ NEVER ZERO. A heading with no form under it is a dead end.
    expect(rowsToShow(ROWS, {})).toHaveLength(1);
  });

  it('shows what is in use plus one to type into', () => {
    expect(rowsToShow(ROWS, owning(1))).toHaveLength(2);
    expect(rowsToShow(ROWS, owning(1, 2))).toHaveLength(3);
  });

  it('⚠️ NEVER HIDES A ROW THAT HAS DATA IN IT', () => {
    // THE BUG. Rows 1 and 4 are in use — two rows — and counting them gave
    // three, which cut row 4 off the screen. The last row in use is what
    // matters, not how many there are.
    const shown = rowsToShow(ROWS, owning(1, 4));
    expect(shown.map(([n]) => n)).toEqual([1, 2, 3, 4, 5]);

    // The general form of the same guarantee.
    for (const gaps of [[2], [3, 5], [6], [1, 6], [4]]) {
      const rows = rowsToShow(ROWS, owning(...gaps));
      for (const n of gaps) {
        expect(rows.map(([r]) => r)).toContain(n);
      }
    }
  });

  it('never offers a seventh row to a member who owns six', () => {
    // The form has six. Rendering a seventh gives them boxes that cannot be
    // saved and a licence they cannot list.
    //
    // ⚠️ HONEST NOTE ON WHAT THIS PROVES. Array.slice already clamps to the
    // array's length, so removing the Math.min inside rowsToShow does NOT
    // fail this test — confirmed by trying it. The clamp is deliberate
    // defence and this is a regression guard against a future rewrite that
    // does its own indexing, not a proof of the current line.
    expect(rowsToShow(ROWS, owning(1, 2, 3, 4, 5, 6))).toHaveLength(6);
    expect(rowsToShow(ROWS, owning(1, 2, 3, 4, 5, 6), 3)).toHaveLength(6);
  });

  it('adds the rows the member explicitly asked for', () => {
    expect(rowsToShow(ROWS, {}, 1)).toHaveLength(2);
    expect(rowsToShow(ROWS, owning(1), 2)).toHaveLength(4);
  });

  it('ignores a negative extra rather than shrinking the list', () => {
    expect(rowsToShow(ROWS, owning(1, 2), -5)).toHaveLength(3);
  });

  it('returns nothing when there are no rows at all', () => {
    // The declarations and safe sections have none, and must not render an
    // empty repeating block.
    expect(rowsToShow([], { anything: 'here' })).toEqual([]);
  });
});
