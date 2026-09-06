import { describe, expect, it } from 'vitest';

import { BenchApiError, benchErrorCopy } from '@/lib/bench/api';
import {
  DEFAULT_TOLERANCE,
  DEFAULT_URL_STATE,
  EMPTY_OFF,
  NO_OVERLAY,
  type BenchUrlState,
  type OverlayStack,
  benchUrlSearch,
  bulletKey,
  closeOverlay,
  hasOverlay,
  offFromSnapshot,
  onlyOverlay,
  parseBenchUrl,
  pushOverlay,
  replaceTop,
  topOverlay,
} from '@/components/bench/contract';

/**
 * THE BENCH — the page shell's three pure decisions.
 *
 * 🚨 NONE OF THIS IS TESTABLE THROUGH THE PAGE, WHICH IS WHY IT IS OUT HERE.
 * The URL round trip, the overlay stack and the error copy were all inline in
 * `app/bench/page.tsx`, where the only way to exercise them is to mount Clerk,
 * the app router and five overlays — so in practice nothing exercised them at
 * all, and each of the three shipped a bug the audit had to find by reading.
 *
 * ⚠️ AND THEY ARE PURE ON PURPOSE. A helper that reaches for `window` cannot
 * be asked a question in node, and the version of it that can is a second copy
 * waiting to disagree with the one that ships.
 */

/* ── URL state ──────────────────────────────────────────────────────── */

function roundTrip(state: BenchUrlState): BenchUrlState {
  return parseBenchUrl(new URLSearchParams(benchUrlSearch(state)));
}

describe('the finder survives a refresh (C4)', () => {
  it('carries every control through the query string and back', () => {
    const state: BenchUrlState = {
      off: {
        powderIds: ['clx1powder', 'clx2powder'],
        bullets: ['0.308|150', '|168'],
        cartridgeKeys: ['65creedmoor'],
      },
      cartridge: '30-06-springfield',
      weight: '100to150',
      tolerance: 15,
    };

    expect(roundTrip(state)).toEqual(state);
  });

  /**
   * 🚨 THE BULLET KEY IS THE ONE THAT COULD BREAK ON THE WIRE. It is two parts
   * joined by a pipe with a decimal point in the first — `0.308|150` — and the
   * empty leading part of a pre-calibre bench (`|168`) is a PART, not an
   * absence. Collapsed or escaped away, the chip stays greyed on the screen
   * and stays live in the query.
   */
  it('keeps a calibre-less bullet key as its two-part form', () => {
    const key = bulletKey({ weightGr: 168 });
    expect(key).toBe('|168');
    expect(roundTrip({ ...DEFAULT_URL_STATE, off: { ...EMPTY_OFF, bullets: [key] } }).off.bullets).toEqual([
      key,
    ]);
  });

  /**
   * ⚠️ AN AXIS IS NOT GUESSABLE FROM A FLAT LIST. The API sends `off` as one
   * comma-joined list because the server matches every axis against the same
   * set; a link has to come back, and one list cannot say whether an id was a
   * powder or a cartridge.
   */
  it('keeps each axis in its own parameter', () => {
    const search = benchUrlSearch({
      ...DEFAULT_URL_STATE,
      off: { powderIds: ['p1'], bullets: ['0.308|150'], cartridgeKeys: ['c1'] },
    });
    const p = new URLSearchParams(search);
    expect(p.get('offp')).toBe('p1');
    expect(p.get('offb')).toBe('0.308|150');
    expect(p.get('offc')).toBe('c1');
  });

  it('writes nothing at all for an untouched finder', () => {
    expect(benchUrlSearch(DEFAULT_URL_STATE)).toBe('');
  });

  /**
   * 🚨 THE REGRESSION THIS FILE WAS WRITTEN OVER. `Number(null)` is 0 and 0 is
   * a real width on this toolbar ("Exact"), so a URL with no `tol` at all
   * parsed as the NARROWEST setting the finder has — every plain `/bench`
   * opened showing a fraction of the member's loads, with the Exact pill lit
   * and nothing on screen saying why.
   */
  it('reads a missing width as the default, never as Exact', () => {
    expect(parseBenchUrl(new URLSearchParams()).tolerance).toBe(DEFAULT_TOLERANCE);
    expect(parseBenchUrl(new URLSearchParams('tol=')).tolerance).toBe(DEFAULT_TOLERANCE);
  });

  it('reads an explicit Exact as Exact', () => {
    expect(parseBenchUrl(new URLSearchParams('tol=0')).tolerance).toBe(0);
  });

  /**
   * ⚠️ A URL IS TYPED BY STRANGERS AND BY OUR OWN OLDER LINKS. A width or a
   * band the toolbar does not offer would narrow the search while lighting no
   * pill — the screen and the answer disagreeing, with nothing on either
   * saying so.
   */
  it('falls back to the defaults for values the toolbar does not offer', () => {
    const parsed = parseBenchUrl(new URLSearchParams('weight=heavy&tol=999'));
    expect(parsed.weight).toBe('any');
    expect(parsed.tolerance).toBe(DEFAULT_TOLERANCE);
  });

  it('does not put the defaults in the link', () => {
    const search = benchUrlSearch({ ...DEFAULT_URL_STATE, tolerance: DEFAULT_TOLERANCE });
    expect(search).not.toContain('tol=');
  });

  /** The same shelf tapped in a different order is the same link. */
  it('orders the off lists so one search has one address', () => {
    const a = benchUrlSearch({ ...DEFAULT_URL_STATE, off: { ...EMPTY_OFF, powderIds: ['b', 'a'] } });
    const b = benchUrlSearch({ ...DEFAULT_URL_STATE, off: { ...EMPTY_OFF, powderIds: ['a', 'b'] } });
    expect(a).toBe(b);
  });
});

/* ── The overlay stack ──────────────────────────────────────────────── */

describe('overlays stack (C1, C2, C3)', () => {
  it('opens the log sheet on top of the load card', () => {
    const stack = pushOverlay(onlyOverlay('load'), 'log');
    expect(stack).toEqual(['load', 'log']);
    expect(topOverlay(stack)).toBe('log');
    // Both mounted: the card is still on screen under the sheet.
    expect(hasOverlay(stack, 'load')).toBe(true);
  });

  it('closes the sheet back onto the card', () => {
    const stack = closeOverlay(['load', 'log'], 'log');
    expect(stack).toEqual(['load']);
  });

  /**
   * 🚨 C1. A spec card opened from a GROUP HEADER closes onto the finder; one
   * opened from the load card closes back onto the card. Held instead as a
   * separate `openLoad` flag that nothing cleared, the first case brought back
   * whichever card had been looked at last — for a different cartridge.
   */
  it('remembers who opened the spec card, structurally', () => {
    expect(closeOverlay(onlyOverlay('spec'), 'spec')).toEqual([]);
    expect(closeOverlay(pushOverlay(onlyOverlay('load'), 'spec'), 'spec')).toEqual(['load']);
  });

  /**
   * 🚨 C2. A save that resolves after the member has closed everything must
   * not put anything back on the screen. `closeOverlay` on a kind that is not
   * open is a no-op — and returns the SAME reference, so the page's
   * `setStack` does not even re-render.
   */
  it('is a no-op — same reference — when the sheet has already gone', () => {
    const closed: OverlayStack = NO_OVERLAY;
    expect(closeOverlay(closed, 'log')).toBe(closed);
    const elsewhere: OverlayStack = ['logList'];
    expect(closeOverlay(elsewhere, 'log')).toBe(elsewhere);
  });

  it('takes anything above with it when something buried closes', () => {
    expect(closeOverlay(['load', 'log'], 'load')).toEqual([]);
  });

  /** A shell-holder chip swaps the card rather than stacking six deep. */
  it('replaces the top for a sibling card', () => {
    expect(replaceTop(['load', 'spec'], 'spec')).toEqual(['load', 'spec']);
    expect(replaceTop(onlyOverlay('spec'), 'spec')).toEqual(['spec']);
  });

  /** One entry per kind: two would mount two copies of one dialog. */
  it('moves an already-open overlay rather than doubling it', () => {
    expect(pushOverlay(['load', 'log'], 'load')).toEqual(['log', 'load']);
  });

  it('has no top when nothing is open', () => {
    expect(topOverlay(NO_OVERLAY)).toBeNull();
  });
});

/* ── Error copy ─────────────────────────────────────────────────────── */

describe('a failure is said in our own words (C9)', () => {
  /**
   * 🚨 THE RESPONSE BODY IS NEVER THE COPY. `call()` throws with the raw text
   * of whatever answered, and both an nginx error page and a Clerk JSON blob
   * were rendered into the page verbatim. It is also the one string on this
   * module nothing has vetted against the copy rules.
   */
  it('never returns the body it was handed', () => {
    const body = '<html><body>502 Bad Gateway — nginx</body></html>';
    expect(benchErrorCopy(new BenchApiError(body, 502))).not.toContain('nginx');
  });

  it('sends an expired session back to signing in', () => {
    for (const status of [401, 403]) {
      expect(benchErrorCopy(new BenchApiError('{"message":"Unauthenticated"}', status))).toBe(
        'Sign in again to see your bench.',
      );
    }
  });

  it('offers a retry for anything the server or the network lost', () => {
    for (const status of [500, 502, 503]) {
      expect(benchErrorCopy(new BenchApiError('boom', status))).toBe(
        'The bench could not load. Try again.',
      );
    }
  });

  /** A thrown TypeError from a dropped connection is not a BenchApiError. */
  it('treats a network failure as the same retryable thing', () => {
    expect(benchErrorCopy(new TypeError('Failed to fetch'))).toBe(
      'The bench could not load. Try again.',
    );
  });

  /**
   * ⚠️ NO COPY ON THIS MODULE MAY NAME WHERE A FIGURE COMES FROM (operator
   * ruling, 2026-09-02). These sentences are on the finder, so they are held
   * to the same boundary as everything else on it.
   */
  it('says nothing forbidden', () => {
    const said = [400, 401, 403, 404, 413, 500, 0].map((s) =>
      benchErrorCopy(new BenchApiError('x', s)).toLowerCase(),
    );
    for (const line of said) {
      for (const word of ['manual', 'cip', 'saami', 'published', 'source', 'escrow']) {
        expect(line).not.toContain(word);
      }
    }
  });
});

/* ── A shared link ──────────────────────────────────────────────────── */

describe('a permalink narrows my search and never writes my bench (A7)', () => {
  const mine = {
    powders: [{ id: 'p-varget' }, { id: 'p-n550' }],
    bullets: [{ weightGr: 150, calibreIn: 0.308 }, { weightGr: 140, calibreIn: 0.264 }],
    cartridges: [{ key: '30-06' }, { key: '65creedmoor' }],
  };

  it('mutes what the sender did not have', () => {
    const off = offFromSnapshot(mine, {
      powders: [{ id: 'p-varget' }],
      bullets: [{ weightGr: 150, calibreIn: 0.308 }],
      cartridges: [{ key: '30-06' }],
    });
    expect(off.powderIds).toEqual(['p-n550']);
    expect(off.bullets).toEqual(['0.264|140']);
    expect(off.cartridgeKeys).toEqual(['65creedmoor']);
  });

  /**
   * 🚨 WHAT THEY HAD AND I DO NOT IS SIMPLY ABSENT. There is no chip to light,
   * and adding one would be the link writing to my bench by another name.
   */
  it('adds nothing of theirs', () => {
    const off = offFromSnapshot(mine, {
      // Everything of mine, plus one of theirs I do not own.
      powders: [...mine.powders, { id: 'p-h4350' }],
      bullets: [...mine.bullets, { weightGr: 55, calibreIn: 0.224 }],
      cartridges: [...mine.cartridges, { key: '223rem' }],
    });
    expect(off.powderIds).toEqual([]);
    expect(off.bullets).toEqual([]);
    expect(off.cartridgeKeys).toEqual([]);
  });

  it('keeps the chips the link itself switched off', () => {
    const off = offFromSnapshot(mine, mine, { ...EMPTY_OFF, powderIds: ['p-varget'] });
    expect(off.powderIds).toEqual(['p-varget']);
  });
});
