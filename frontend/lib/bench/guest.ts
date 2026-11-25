import type { BenchBullet, BenchPowder, BenchView, GuestShelfQuery } from './api';
import { bulletKey, type OffState } from '@/components/bench/contract';

/**
 * THE BENCH — the shelf a signed-out visitor builds for one sitting.
 *
 * The finder answers for a shelf; a member's is stored and read from
 * GET /bench/me, and a declared visitor has none to read. So the page holds one
 * here, in state: it is fed by the same three public pickers, narrowed by the
 * same chips, and sent with every bench-relative read as the `powders[]` /
 * `bullets[]` / `cartridges[]` query arrays (SPEC-BUILD §4).
 *
 * 🚨 IT IS A FILTER AND NEVER A WRITE. Nothing in this file fetches, and the
 * page never PUTs it: the moment there is a session the saved bench is the only
 * shelf the screen answers from. That is what keeps the guest path read-only
 * without a second set of components — same rail, same chips, same pickers.
 *
 * ⚠️ IT IS A `BenchView`, DELIBERATELY. The rail, the sheet, the empty state
 * and the results all speak that shape already, so a guest shelf that is shaped
 * like a stored one renders through the SAME components rather than a parallel
 * signed-out UI that would drift from it.
 */

/**
 * A shelf with nothing on it.
 *
 * ⚠️ BUILT FRESH EACH TIME. getBench()'s empty bench is built fresh for the same
 * reason: a caller may keep it, and putting an entry on an empty one must not
 * put it on every empty one.
 */
export function emptyGuestShelf(): BenchView {
  return { powders: [], bullets: [], cartridges: [], units: 'metric' };
}

/**
 * The shelf as the SEARCH sees it — the three axes, in the order every
 * bench-relative endpoint takes them.
 *
 * ⚠️ IT IS THE COMPLETE SHELF EVERY TIME. The `off` chips, the grain window and
 * the filter travel beside it in the query string (see LoadQuery / BenchScope),
 * not inside it: the server applies `off` to this shelf and the window to the
 * match, exactly as it does for a stored bench. Packing them in here would give
 * the two shelves two different shapes and two chances to disagree.
 */
export function guestQuery(shelf: BenchView): GuestShelfQuery {
  return {
    powderIds: shelf.powders.map((p) => p.id),
    bullets: shelf.bullets.map((b) => ({
      weightGr: b.weightGr,
      calibreIn: b.calibreIn ?? null,
    })),
    cartridgeKeys: shelf.cartridges.map((c) => c.key),
  };
}

/**
 * A key for the shelf, for the effect that re-runs the search.
 *
 * 🚨 THE SAME KEY A STORED BENCH KEYS WITH, AND IT HAS TO STAY THAT WAY. The
 * page used to key on the bench OBJECT, so every write — including a mm/inch
 * flip the server never reads on a search — repainted the whole list. The key
 * is built from the fields the request carries, so adding a powder re-runs the
 * search and changing the units does not, on either shelf.
 *
 * An empty shelf keys as `'||'`, which is truthy on purpose: a visitor with
 * nothing added yet still gets their (empty) answer and the panel explaining it.
 */
export function guestShelfKey(shelf: BenchView): string {
  return [
    shelf.powders.map((p) => p.id).join(','),
    shelf.bullets.map(bulletKey).join(','),
    shelf.cartridges.map((c) => c.key).join(','),
  ].join('|');
}

/**
 * Put a powder on the guest shelf, once.
 *
 * ⚠️ THE PICKER ALREADY REFUSES A DUPLICATE (it is told what is on the shelf),
 * so this is the second line of defence for two fast taps: a doubled id would
 * be two chips with the same React key and one powder counted twice in the
 * empty-state sentence.
 */
export function addGuestPowder(shelf: BenchView, powder: BenchPowder): BenchView {
  if (shelf.powders.some((p) => p.id === powder.id)) return shelf;
  return { ...shelf, powders: [...shelf.powders, powder] };
}

/** Put a bullet (a weight in a calibre) on the guest shelf, once. */
export function addGuestBullet(shelf: BenchView, bullet: BenchBullet): BenchView {
  const key = bulletKey(bullet);
  if (shelf.bullets.some((b) => bulletKey(b) === key)) return shelf;
  // Only the two fields that are a bullet cross — the maker and category are
  // legacy decoration on a stored bench and match nothing. See GuestBench.
  return {
    ...shelf,
    bullets: [...shelf.bullets, { weightGr: bullet.weightGr, calibreIn: bullet.calibreIn ?? null }],
  };
}

/** Put a cartridge on the guest shelf, once. */
export function addGuestCartridge(
  shelf: BenchView,
  cartridge: { key: string; name: string },
): BenchView {
  if (shelf.cartridges.some((c) => c.key === cartridge.key)) return shelf;
  return {
    ...shelf,
    cartridges: [...shelf.cartridges, { key: cartridge.key, name: cartridge.name }],
  };
}

/**
 * Take one entry off the guest shelf.
 *
 * ⚠️ THE KINDS AND IDS ARE `OffState`'s, WHICH ARE ALSO `onToggle`'s. The rail
 * hands both callbacks the same `(kind, id)`, and a key spelled one way for the
 * toggle and another for the removal would take the wrong entry off the shelf.
 */
export function removeGuestEntry(
  shelf: BenchView,
  kind: keyof OffState,
  id: string,
): BenchView {
  if (kind === 'powderIds') {
    return { ...shelf, powders: shelf.powders.filter((p) => p.id !== id) };
  }
  if (kind === 'bullets') {
    return { ...shelf, bullets: shelf.bullets.filter((b) => bulletKey(b) !== id) };
  }
  return { ...shelf, cartridges: shelf.cartridges.filter((c) => c.key !== id) };
}

/**
 * Is this entry still on the guest shelf?
 *
 * ⚠️ THE REMOVAL HAS TO KNOW, FOR THE SAME REASON A STORED ONE DOES. A double
 * tap on the × arrives after the first one has already taken the entry off, and
 * a removal that never happened must not be confirmed by a toast. The page
 * computes the NAME itself (a bullet is named by the chip's own helper), so
 * this only answers the question the toast branches on.
 */
export function guestHasEntry(
  shelf: BenchView,
  kind: keyof OffState,
  id: string,
): boolean {
  if (kind === 'powderIds') return shelf.powders.some((p) => p.id === id);
  if (kind === 'bullets') return shelf.bullets.some((b) => bulletKey(b) === id);
  return shelf.cartridges.some((c) => c.key === id);
}
