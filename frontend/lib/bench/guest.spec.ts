import { describe, expect, it } from 'vitest';

import type { BenchView } from './api';
import {
  addGuestBullet,
  addGuestCartridge,
  addGuestPowder,
  emptyGuestShelf,
  guestHasEntry,
  guestQuery,
  guestShelfKey,
  removeGuestEntry,
} from './guest';

/**
 * THE BENCH — the signed-out visitor's shelf.
 *
 * 🚨 IT IS THE SAME SHELF A MEMBER HAS, IN PAGE STATE. The finder answers from
 * three axes; a guest has no stored row to read, so the page holds one and
 * sends it as the SPEC query arrays. These helpers are the whole of that shelf:
 * what goes to the server, what the search effect keys on, and what adding and
 * removing an entry does. Every bug in them is silent — a shelf that saves
 * nothing, a search that does not re-run, an entry that cannot be removed.
 */

const POWDER = { id: 'p1', name: 'N550', maker: 'Vihtavuori' };
const BULLET = { weightGr: 150, calibreIn: 0.308 };
const CARTRIDGE = { key: '308win', name: '.308 Winchester' };

function shelfWith(over: Partial<BenchView> = {}): BenchView {
  return { ...emptyGuestShelf(), ...over };
}

describe('the guest shelf travels as the server contract', () => {
  it('starts empty, and a new one is not the same object', () => {
    const a = emptyGuestShelf();
    expect(a).toEqual({ powders: [], bullets: [], cartridges: [], units: 'metric' });
    expect(emptyGuestShelf()).not.toBe(a);
  });

  /**
   * 🚨 A BULLET IS A WEIGHT IN A CALIBRE ON THE WIRE TOO. The server parses
   * `calibre|weight` — the chip key — and a calibre-less bullet keys as
   * `|150`, a two-part form whose empty first part means "matches any calibre".
   */
  it('maps the three axes, and a bullet as its chip key', () => {
    const shelf = shelfWith({
      powders: [POWDER],
      bullets: [BULLET, { weightGr: 139 }],
      cartridges: [CARTRIDGE],
    });

    expect(guestQuery(shelf)).toEqual({
      powderIds: ['p1'],
      bullets: [
        { weightGr: 150, calibreIn: 0.308 },
        { weightGr: 139, calibreIn: null },
      ],
      cartridgeKeys: ['308win'],
    });
  });

  it('keys the same way a stored bench keys, and an empty shelf keys truthy', () => {
    // The page's search effect must re-run when the shelf changes and not when
    // the units do; an empty shelf must still be searched (its empty answer is
    // what draws the "add a powder" panel).
    expect(guestShelfKey(emptyGuestShelf())).toBe('||');
    expect(guestShelfKey(shelfWith({ powders: [POWDER], bullets: [BULLET], cartridges: [CARTRIDGE] }))).toBe(
      'p1|0.308|150|308win',
    );
  });
});

describe('adding to the guest shelf', () => {
  it('adds each axis once, in the picker order', () => {
    let shelf = emptyGuestShelf();
    shelf = addGuestPowder(shelf, POWDER);
    shelf = addGuestPowder(shelf, { id: 'p2', name: 'H4350', maker: 'Hodgdon' });
    shelf = addGuestBullet(shelf, BULLET);
    shelf = addGuestCartridge(shelf, CARTRIDGE);

    expect(shelf.powders.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(shelf.bullets).toEqual([{ weightGr: 150, calibreIn: 0.308 }]);
    expect(shelf.cartridges).toEqual([{ key: '308win', name: '.308 Winchester' }]);
  });

  /** A bullet is a weight in a calibre: 150 gr of another diameter is another bullet. */
  it('keeps two bullets of one weight in different calibres apart', () => {
    let shelf = addGuestBullet(emptyGuestShelf(), BULLET);
    shelf = addGuestBullet(shelf, { weightGr: 150, calibreIn: 0.277 });

    expect(shelf.bullets).toHaveLength(2);
  });

  it('does not double an entry on a second tap', () => {
    let shelf = addGuestPowder(emptyGuestShelf(), POWDER);
    const once = shelf;
    shelf = addGuestPowder(shelf, POWDER);

    expect(shelf).toBe(once);
  });

  /** The maker/category decoration on an old shelf is not part of what is kept. */
  it('stores only the weight and the calibre of a bullet', () => {
    const shelf = addGuestBullet(emptyGuestShelf(), {
      weightGr: 150,
      calibreIn: 0.308,
      maker: 'Hornady',
      category: 'SP',
    } as never);

    expect(shelf.bullets).toEqual([{ weightGr: 150, calibreIn: 0.308 }]);
  });
});

describe('removing from the guest shelf', () => {
  const full = shelfWith({ powders: [POWDER], bullets: [BULLET], cartridges: [CARTRIDGE] });

  it.each([
    ['powderIds', 'p1', { powders: [], bullets: [BULLET], cartridges: [CARTRIDGE] }],
    ['bullets', '0.308|150', { powders: [POWDER], bullets: [], cartridges: [CARTRIDGE] }],
    ['cartridgeKeys', '308win', { powders: [POWDER], bullets: [BULLET], cartridges: [] }],
  ] as const)('takes %s off by the id the toggle also uses', (kind, id, expected) => {
    expect(removeGuestEntry(full, kind, id)).toMatchObject(expected);
  });

  it('knows when an entry is no longer there, so a double tap is not confirmed', () => {
    expect(guestHasEntry(full, 'powderIds', 'p1')).toBe(true);
    expect(guestHasEntry(full, 'bullets', '0.308|150')).toBe(true);
    expect(guestHasEntry(full, 'cartridgeKeys', '308win')).toBe(true);
    expect(guestHasEntry(full, 'powderIds', 'nope')).toBe(false);
    expect(guestHasEntry(full, 'bullets', '0.277|150')).toBe(false);
  });
});
