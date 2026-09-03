import { describe, expect, it } from 'vitest';
import type { LoadsWhy } from '@/lib/bench/api';
import type { ShelfNames } from './contract';
import { explainEmpty } from './ResultsList';

/**
 * THE BENCH — the sentence an empty results panel has to say.
 *
 * 🚨 THIS IS THE FILE THAT SAYS A CORRECT EMPTY SCREEN DOES NOT LOOK BROKEN.
 * The operator's own bench — N550, a .30-06 and two bullets — returned nothing
 * and said nothing, and "nothing resolves" was the only reading available. The
 * data was right: .30-06 with N550 has 70 loads, for bullets they do not own.
 *
 * Node environment on purpose: explainEmpty is a pure function of the counts
 * and the shelf, so the words can be asserted without a DOM. The panel that
 * prints them is three lines of JSX around this.
 */

/** The operator's bench, as the search actually ran it. */
const BENCH: ShelfNames = {
  powders: ['N550'],
  bullets: ['.308" Hornady 150gr', '.264" Lapua 139gr'],
  cartridges: ['.30-06 Springfield'],
};

const NONE: LoadsWhy = { ignoringBullets: 0, ignoringPowders: 0, ignoringCartridges: 0 };

function why(over: Partial<LoadsWhy>): LoadsWhy {
  return { ...NONE, ...over };
}

/** Everything the panel prints, as one string. */
function said(w: LoadsWhy, shelf: ShelfNames = BENCH): string {
  const e = explainEmpty(w, shelf);
  return [e.title, ...e.lines].join(' ');
}

describe('the starving axis is named, with its number', () => {
  it('says the bullets are what the cartridge and powder have no load for', () => {
    const e = explainEmpty(why({ ignoringBullets: 70 }), BENCH);
    expect(e.title).toBe('70 loads — but not for your bullets');
    expect(e.lines[0]).toBe(
      '.30-06 Springfield and N550 have 70 loads together — but none for the bullets on your bench.',
    );
    // The door it opens is the axis it just named — not "add a powder", which
    // is the advice that sent a member to the shelf they had already filled.
    expect(e.offer).toEqual(['bullet']);
  });

  it('says the powders when the cartridge and bullets are what join', () => {
    const e = explainEmpty(why({ ignoringPowders: 13 }), BENCH);
    expect(e.title).toBe('13 loads — but not for your powders');
    expect(e.lines[0]).toBe(
      '.30-06 Springfield and your 2 bullets have 13 loads together — but none with the powders on your bench.',
    );
    expect(e.offer).toEqual(['powder']);
  });

  it('says the cartridges when the powder and bullets are what join', () => {
    const e = explainEmpty(why({ ignoringCartridges: 5 }), BENCH);
    expect(e.offer).toEqual(['cartridge']);
    expect(e.lines[0]).toContain('but none in the cartridges on your bench.');
    expect(e.lines[0]).toContain('N550');
  });

  it('counts one load in the singular, on both the title and the line', () => {
    const e = explainEmpty(why({ ignoringBullets: 1 }), BENCH);
    expect(e.title).toBe('1 load — but not for your bullets');
    expect(e.lines[0]).toContain('have 1 load together');
  });

  /**
   * ⚠️ THE NON-BREAKING SPACE IS THE POINT, and it is why this asserts on
   * ` ` rather than on a space anyone could type. Every figure on the
   * screen is grouped by the same helper, which uses NBSP so a four-figure
   * count never wraps between its digits mid-sentence.
   */
  it('groups a big number the way every other figure on the screen is grouped', () => {
    expect(said(why({ ignoringBullets: 1240 }))).toContain('1 240 loads');
  });
});

describe('more than one axis starving names them all', () => {
  const TWO = why({ ignoringBullets: 70, ignoringPowders: 13 });

  /** The 70 comes before the 13: the biggest opening leads, and the buttons follow it. */
  it('offers both, biggest opening first, and lets the member pick', () => {
    const e = explainEmpty(TWO, BENCH);
    expect(e.title).toBe('Two ways to open this up');
    expect(e.offer).toEqual(['bullet', 'powder']);
    expect(e.lines[0]).toContain('70 loads');
    expect(e.lines[1]).toContain('13 loads');
  });

  /** Sort is stable, so an equal pair falls back to the order the chips are in. */
  it('keeps the rail order when two openings are the same size', () => {
    expect(explainEmpty(why({ ignoringBullets: 9, ignoringPowders: 9 }), BENCH).offer).toEqual([
      'powder',
      'bullet',
    ]);
  });

  it('gives each one its own sentence, with its own number', () => {
    const text = said(TWO);
    expect(text).toContain('but none with the powders on your bench.');
    expect(text).toContain('but none for the bullets on your bench.');
    expect(text).toContain('70 loads');
    expect(text).toContain('13 loads');
  });

  it('counts three when all three would open something', () => {
    const e = explainEmpty(
      why({ ignoringBullets: 70, ignoringPowders: 13, ignoringCartridges: 5 }),
      BENCH,
    );
    expect(e.title).toBe('Three ways to open this up');
    expect(e.offer).toEqual(['bullet', 'powder', 'cartridge']);
  });
});

describe('all three zero promises nothing', () => {
  /**
   * 🚨 THE ONE CASE THAT MUST NOT OFFER A DOOR. The result is a subset of every
   * relaxed set, so all three being empty proves no single addition can change
   * the answer. An "Add a powder" button there is a promise the data has
   * already broken.
   */
  it('offers no picker at all', () => {
    expect(explainEmpty(NONE, BENCH).offer).toEqual([]);
  });

  it('says so plainly, and does not send them shopping for one thing', () => {
    const text = said(NONE);
    expect(text).toContain('No load uses one of your powders');
    expect(text).toContain('Adding one more of any single thing will not change that');
  });
});

describe('the shelf is named the way the member wrote it', () => {
  it('names the one on the shelf, and the shelf it is on', () => {
    expect(said(why({ ignoringBullets: 70 }))).toContain('.30-06 Springfield and N550 have');
  });

  /**
   * ⚠️ TWO AXES ARE ALREADY JOINED BY "and". A list inside either of them
   * gives ".30-06 and .308 Win and N550", whose own grammar hides which name
   * belongs to which shelf — so past one name the axis is counted instead.
   */
  it('counts them instead of listing them, so the "and" keeps its meaning', () => {
    const shelf: ShelfNames = {
      ...BENCH,
      cartridges: ['.30-06 Springfield', '.308 Win', '6.5 Creedmoor', '.223 Rem'],
    };
    const text = said(why({ ignoringBullets: 70 }), shelf);
    expect(text).toContain('Your 4 cartridges and N550');
    expect(text).not.toContain('.308 Win');
  });

  it('falls back to the plural rather than leaving a hole in the line', () => {
    const shelf: ShelfNames = { ...BENCH, powders: [] };
    expect(said(why({ ignoringBullets: 70 }), shelf)).toContain(
      '.30-06 Springfield and your powders',
    );
  });
});

/**
 * ⚠️ THE SAME BOUNDARY THE BACKEND'S LEAK SPEC HOLDS. Operator ruling
 * 2026-09-02: no Bench surface may say where a figure comes from. Load counts
 * are facts about the shelf and stay; anything underneath them does not.
 */
describe('the copy names no source', () => {
  const BANNED = /source|manual|c\.?i\.?p\.?|saami|published/i;

  it.each([
    ['bullets starving', why({ ignoringBullets: 70 })],
    ['powders starving', why({ ignoringPowders: 13 })],
    ['cartridges starving', why({ ignoringCartridges: 5 })],
    ['two starving', why({ ignoringBullets: 70, ignoringPowders: 13 })],
    ['nothing joining', NONE],
  ])('%s', (_name, w) => {
    expect(said(w)).not.toMatch(BANNED);
  });
});
