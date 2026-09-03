// @vitest-environment jsdom
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { benchApi, type BenchView } from '@/lib/bench/api';
import { CALIBRE_UNKNOWN, CALIBRE_UNKNOWN_SHORT, formatCalibre } from '@/lib/bench/calibre';
import { BulletPicker, haystack, matches } from './BulletPicker';
import { BenchSections } from './BenchRail';
import { EMPTY_OFF, bulletKey } from './contract';
import type { BenchBulletOption } from './contract';

/**
 * The page mounts for the removal tests at the foot of this file, and it needs
 * two things a jsdom render cannot give it: a signed-in member and an answer
 * to "is this the installed app?". Neither is what those tests are about.
 *
 * ⚠️ THE API IS NOT MOCKED HERE. `benchApi` is a plain object, so each test
 * spies on the two or three calls it actually needs and restores them
 * afterwards — a whole-module mock would also replace `BenchApiError` and the
 * wire types, and then the specs above would be testing a stub of the client
 * rather than the client.
 */
/*
 * ⚠️ ONE getToken, HOISTED OUT OF THE HOOK, BECAUSE THE PAGE KEYS AN EFFECT ON
 * ITS IDENTITY. `token` is a useCallback over getToken, and the effect that
 * fetches the bench depends on it — so a fresh arrow function per call makes
 * that effect re-run on EVERY render and re-fetch the bench, which quietly
 * puts a just-removed chip back on the rail a tick after the write landed.
 * Clerk hands back a stable getToken; a double that does not is a double the
 * page never sees in production, and every assertion about the rail would be
 * fighting it.
 */
vi.mock('@clerk/nextjs', () => {
  const getToken = async () => 'test-token';
  return { useAuth: () => ({ getToken, isLoaded: true, isSignedIn: true }) };
});
vi.mock('@/lib/use-standalone', () => ({ useStandalone: () => false }));

// Imported after the mocks above, which vitest hoists regardless — written in
// this order so the reason they exist is next to the thing that needs them.
import BenchPage from '@/app/bench/page';

/**
 * THE BENCH — the bullet picker's calibre.
 *
 * 🚨 THIS IS THE FILE THAT SAYS THE MEMBER CAN TELL TWO ROWS APART. "Hornady
 * 150gr SP" names four different projectiles — .277" for .270 Win, .308" for
 * .308 Win, .311" for .303 British, .323" for 8x57 IS — and they are not
 * interchangeable: three thou over will not chamber, or will chamber and spike
 * pressure. The picker filters in the browser, so nothing on the server can
 * rescue a search that cannot separate them.
 *
 * ⚠️ AND NOTHING HERE MAY ROUND, BUCKET OR CHAIN BY TOLERANCE. A thou of
 * spread inside one calibre is the same size as the gap between neighbouring
 * ones (.311" and .312" are both bullets you can buy), so the picker matches
 * on the figure it was handed and nothing else. The neighbour cases below are
 * the guard on that.
 */

/** As the endpoint returns them: the same three words, four different bullets. */
function bullet(calibreIn: number | null, over: Partial<BenchBulletOption> = {}): BenchBulletOption {
  return { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn, loads: 12, ...over };
}

/** Exactly what the component does: fold the term, look for every word in the hay. */
function finds(b: BenchBulletOption, typed: string): boolean {
  const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return matches(haystack(b), words);
}

const TWO_SEVEN_SEVEN = bullet(0.277); // .270 Win
const THREE_OH_EIGHT = bullet(0.308); // .308 Win
const THREE_ELEVEN = bullet(0.311); // .303 British
const THREE_TWELVE = bullet(0.312); // its immediate neighbour on the shelf
const NO_CALIBRE = bullet(null); // one of the five cartridges with no figure

describe('the calibre is written the way the box is', () => {
  it.each([
    [0.308, '.308"'],
    [0.277, '.277"'],
    [0.311, '.311"'],
    [0.323, '.323"'],
    // Three digits even when the standard diameter has fewer — .40 is `.400"`
    // on the box, not `.4"`.
    [0.4, '.400"'],
  ])('%s is written %s', (inches, written) => {
    expect(formatCalibre(inches)).toBe(written);
  });

  it('has nothing to write when the cartridge gives no figure', () => {
    expect(formatCalibre(null)).toBe('');
    expect(formatCalibre(undefined)).toBe('');
  });

  it('names no source when there is no figure — operator ruling 2026-09-02', () => {
    expect(CALIBRE_UNKNOWN.toLowerCase()).not.toMatch(/published|manual|c\.?i\.?p|saami|source/);
  });
});

describe('typing a calibre narrows to that calibre', () => {
  it.each(['308', '.308', '0.308'])('%s finds the .308 bullet', (typed) => {
    expect(finds(THREE_OH_EIGHT, typed)).toBe(true);
  });

  it.each(['308', '.308', '0.308'])('%s does NOT find the .277 bullet of the same name', (typed) => {
    expect(finds(TWO_SEVEN_SEVEN, typed)).toBe(false);
  });

  it('separates neighbouring calibres, which are one thou apart', () => {
    expect(finds(THREE_ELEVEN, '311')).toBe(true);
    expect(finds(THREE_ELEVEN, '312')).toBe(false);
    expect(finds(THREE_TWELVE, '312')).toBe(true);
    expect(finds(THREE_TWELVE, '311')).toBe(false);
  });

  it('still finds a bullet by maker, weight and type, in any order', () => {
    for (const typed of ['hornady 150', '150 sp', 'sp 150', '150gr']) {
      expect(finds(THREE_OH_EIGHT, typed)).toBe(true);
      expect(finds(TWO_SEVEN_SEVEN, typed)).toBe(true);
    }
  });

  it('takes calibre and the rest of the row together', () => {
    expect(finds(THREE_OH_EIGHT, '308 hornady 150')).toBe(true);
    expect(finds(TWO_SEVEN_SEVEN, '308 hornady 150')).toBe(false);
  });

  it('does not match a calibre search to a bullet that has no calibre', () => {
    expect(finds(NO_CALIBRE, '308')).toBe(false);
    expect(finds(NO_CALIBRE, '150 sp')).toBe(true);
  });
});

describe('two calibres are never one row', () => {
  it('keys four same-named bullets apart', () => {
    const keys = [0.277, 0.308, 0.311, 0.323].map((c) => bulletKey(bullet(c)));
    expect(new Set(keys).size).toBe(4);
  });

  it('keeps the pre-calibre key for a bench saved before calibres existed', () => {
    expect(bulletKey({ maker: 'Hornady', weightGr: 150, category: 'SP' })).toBe('Hornady|150|SP');
    expect(bulletKey(THREE_OH_EIGHT)).toBe('Hornady|150|SP|0.308');
  });
});

/* ── On screen ──────────────────────────────────────────────────────── */

/**
 * ⚠️ THE POINT IS THAT IT IS VISIBLE, NOT THAT IT IS IN THE OBJECT. The bug
 * being fixed was a member reading two identical rows and picking one; a
 * calibre that reaches the component and is never drawn fixes nothing they can
 * see. So these render.
 */
describe('the calibre is on screen wherever a bullet is named', () => {
  it('leads every row of the picker, once per calibre', () => {
    render(
      <BulletPicker
        open
        loading={false}
        bullets={[TWO_SEVEN_SEVEN, THREE_OH_EIGHT, NO_CALIBRE]}
        onBench={[]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByText('.277"')).toBeInTheDocument();
    expect(screen.getByText('.308"')).toBeInTheDocument();
    // Said, not left blank, where the cartridge gives no figure.
    expect(screen.getByText(CALIBRE_UNKNOWN)).toBeInTheDocument();

    // The three rows read the same but for that: three Hornadys, one each.
    expect(screen.getAllByText(/Hornady/)).toHaveLength(3);
  });

  it('is on the bench chip too, which is where the member reads their own shelf', () => {
    const bench: BenchView = {
      powders: [],
      cartridges: [],
      units: 'metric',
      bullets: [
        { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.277 },
        { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
        { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: null },
      ],
    };

    render(
      <BenchSections
        bench={bench}
        off={EMPTY_OFF}
        onToggle={vi.fn()}
        onRemove={vi.fn()}
        onAddPowder={vi.fn()}
        onAddBullet={vi.fn()}
        onAddCartridge={vi.fn()}
      />,
    );

    expect(screen.getByText('.277"')).toBeInTheDocument();
    expect(screen.getByText('.308"')).toBeInTheDocument();
    expect(screen.getByText(CALIBRE_UNKNOWN_SHORT)).toBeInTheDocument();
  });

  it('shows a bullet already on the bench as added only when the calibre matches too', () => {
    render(
      <BulletPicker
        open
        loading={false}
        bullets={[TWO_SEVEN_SEVEN, THREE_OH_EIGHT]}
        onBench={[bulletKey(THREE_OH_EIGHT)]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    // One row is a statement of fact, the other is still a button to press —
    // adding the .308 must not mark the .277 of the same name as owned.
    expect(screen.getAllByText('On your bench')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /\.277/ })).toBeInTheDocument();
  });
});

/* ── Off the shelf vs off the bench ─────────────────────────────────── */

/**
 * 🚨 THESE TWO ACTS LIVE ON THE SAME CHIP AND MUST NEVER BE THE SAME CONTROL.
 * The pill takes an item off the shelf for THIS SEARCH and saves nothing; the
 * × beside it takes the item off the saved bench and writes. A member who
 * meant the first and got the second loses a shelf entry, and the finder gives
 * them no way to see that it went — the chip simply is not there any more.
 */

const SHELF: BenchView = {
  units: 'metric',
  powders: [{ id: 'p-n550', name: 'N550', maker: 'Vihtavuori' }],
  bullets: [
    { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    { maker: 'Lapua', weightGr: 139, category: 'HP', calibreIn: 0.264 },
  ],
  cartridges: [{ key: '30-06-springfield', name: '.30-06 Springfield' }],
};

/** Written out, not built from the component's own helper: a test that names
 *  the thing the same way the code does cannot notice the code renaming it. */
const REMOVE_LAPUA = 'Remove .264" Lapua HP 139 gr from your bench';
const REMOVE_HORNADY = 'Remove .308" Hornady SP 150 gr from your bench';
const REMOVE_N550 = 'Remove N550 from your bench';
const REMOVE_CARTRIDGE = 'Remove .30-06 Springfield from your bench';

describe('every chip has a way off the bench that is not its toggle', () => {
  function sections(onToggle = vi.fn(), onRemove = vi.fn()) {
    render(
      <BenchSections
        bench={SHELF}
        off={EMPTY_OFF}
        onToggle={onToggle}
        onRemove={onRemove}
        onAddPowder={vi.fn()}
        onAddBullet={vi.fn()}
        onAddCartridge={vi.fn()}
      />,
    );
    return { onToggle, onRemove };
  }

  it('names what it removes, so two same-named bullets are told apart', () => {
    sections();
    // 🚨 The calibre is in the name for the same reason it leads the chip:
    // "Remove Hornady SP 150 gr" is four different projectiles.
    expect(screen.getByRole('button', { name: REMOVE_LAPUA })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REMOVE_HORNADY })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REMOVE_N550 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REMOVE_CARTRIDGE })).toBeInTheDocument();
    // Never a bare "Remove" — a reader running the button list would hear it
    // four times with nothing to separate them.
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('removes without toggling, and toggles without removing', () => {
    const { onToggle, onRemove } = sections();

    fireEvent.click(screen.getByRole('button', { name: REMOVE_N550 }));
    expect(onRemove).toHaveBeenCalledWith('powderIds', 'p-n550');
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /N550/, pressed: true }));
    expect(onToggle).toHaveBeenCalledWith('powderIds', 'p-n550');
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps the remove out of the toggle, which is a separate button', () => {
    sections();
    const remove = screen.getByRole('button', { name: REMOVE_N550 });
    // Nested <button>s are invalid markup and browsers drop one of the two,
    // so the pair is two siblings — the toggle must not contain the remove.
    expect(remove.closest('button')).toBe(remove);
    // And the toggle keeps its own name: the remove's name must not be read
    // as part of the chip a reader is toggling.
    expect(screen.getByRole('button', { name: /N550/, pressed: true })).not.toContainElement(
      remove,
    );
  });
});

/**
 * 🚨 THE REGRESSION THIS FILE EXISTS FOR, SECOND HALF. PUT /bench/me REPLACES
 * the bench, it does not merge, so a removal that sends only the axis it edited
 * silently empties the other two — take one bullet off and every powder and
 * cartridge the member owns goes with it. Nothing errors: an empty bench is a
 * legal bench, and they find out next time they open the finder.
 */
describe('removing writes the whole bench back, minus the one entry', () => {
  /** The three calls this page makes, standing in for the endpoint. */
  function server() {
    vi.spyOn(benchApi, 'me').mockResolvedValue(SHELF);
    vi.spyOn(benchApi, 'loads').mockResolvedValue({ count: 0, groups: [] });
    // Echoes what it was sent, the way the endpoint does — so a body that
    // dropped an axis would empty the rail on screen too.
    return vi.spyOn(benchApi, 'saveBench').mockImplementation(async (_token, body) => ({
      units: body.units,
      powders: SHELF.powders.filter((p) => body.powderIds.includes(p.id)),
      bullets: body.bullets,
      cartridges: SHELF.cartridges.filter((c) => body.cartridgeKeys.includes(c.key)),
    }));
  }

  let saveBench: ReturnType<typeof server>;

  // ⚠️ RESTORED ONCE, AFTER THE LAST RENDER IS UNMOUNTED, NOT AFTER EACH
  // TEST. A write settles into `setBench`, which re-runs the search effect a
  // tick later; restore between tests and that tick finds the REAL client,
  // which fetches localhost from a torn-down jsdom and rejects into nothing.
  // Clearing the call log is all a test actually needs between runs.
  beforeEach(() => {
    vi.clearAllMocks();
    saveBench = server();
  });

  afterAll(() => vi.restoreAllMocks());

  const CASES: [string, string, string[], string[], string[]][] = [
    // what leaves            the control                 powders left    bullets left (keys)                cartridges left
    ['a bullet', REMOVE_LAPUA, ['p-n550'], [bulletKey(SHELF.bullets[0])], ['30-06-springfield']],
    [
      'a powder',
      REMOVE_N550,
      [],
      SHELF.bullets.map(bulletKey),
      ['30-06-springfield'],
    ],
    ['a cartridge', REMOVE_CARTRIDGE, ['p-n550'], SHELF.bullets.map(bulletKey), []],
  ];

  it.each(CASES)(
    'keeps the other two axes when %s leaves',
    async (_what, control, powderIds, bulletKeys, cartridgeKeys) => {
      render(<BenchPage />);

      fireEvent.click(await screen.findByRole('button', { name: control }));
      await waitFor(() => expect(saveBench).toHaveBeenCalledTimes(1));

      const body = saveBench.mock.calls[0][1];
      expect(body.powderIds).toEqual(powderIds);
      expect(body.bullets.map(bulletKey)).toEqual(bulletKeys);
      expect(body.cartridgeKeys).toEqual(cartridgeKeys);
      // The units ride along too: PUT replaces those as well, and a body
      // without them would silently put an imperial member back on mm.
      expect(body.units).toBe('metric');

      // And the member is told what left, in the words the chip was using.
      const gone = control.replace(/^Remove /, '').replace(/ from your bench$/, '');
      expect(await screen.findByText(`${gone} removed from your bench`)).toBeInTheDocument();
    },
  );

  it('does not write when the toggle is pressed', async () => {
    render(<BenchPage />);

    fireEvent.click(await screen.findByRole('button', { name: /N550/, pressed: true }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /N550/, pressed: false })).toBeInTheDocument(),
    );
    // Off the shelf for this search, and nothing saved. This is the whole
    // difference between the two controls.
    expect(saveBench).not.toHaveBeenCalled();
  });
});

/**
 * 🚨 EVERY BENCH WRITE SENDS THE WHOLE BENCH, SO TWO IN FLIGHT AT ONCE UNDO
 * EACH OTHER. PUT /bench/me replaces rather than merges, and each writer used
 * to build its body from the bench its own render closed over — so a second
 * tap landing before the first answer sent a body still carrying what the
 * first tap removed. The chip came back. Nothing errored, and both toasts said
 * "removed", which is the screen telling the member something that is not so.
 *
 * ⚠️ THE × IS A 44px TARGET ON A PHONE AND THE UNITS PILL IS NEXT TO THE RAIL.
 * Two taps inside one round trip is not an exotic sequence; it is two fingers
 * on a slow connection.
 */
describe('two writes in the same moment do not undo each other', () => {
  function server() {
    vi.spyOn(benchApi, 'me').mockResolvedValue(SHELF);
    vi.spyOn(benchApi, 'loads').mockResolvedValue({ count: 0, groups: [] });
    return vi.spyOn(benchApi, 'saveBench').mockImplementation(async (_token, body) => ({
      units: body.units,
      powders: SHELF.powders.filter((p) => body.powderIds.includes(p.id)),
      bullets: body.bullets,
      cartridges: SHELF.cartridges.filter((c) => body.cartridgeKeys.includes(c.key)),
    }));
  }

  beforeEach(() => vi.clearAllMocks());
  afterAll(() => vi.restoreAllMocks());

  it('builds the second removal on the first one, not on the bench it rendered with', async () => {
    const saveBench = server();
    render(<BenchPage />);

    // Both taps land before either write can settle — nothing is removed
    // optimistically, so both controls are still on screen for the second.
    fireEvent.click(await screen.findByRole('button', { name: REMOVE_N550 }));
    fireEvent.click(screen.getByRole('button', { name: REMOVE_LAPUA }));

    await waitFor(() => expect(saveBench).toHaveBeenCalledTimes(2));

    // 🚨 THE POWDER DOES NOT COME BACK. Built from the render's own bench this
    // body still carries N550, and the second write puts it back on the shelf.
    const second = saveBench.mock.calls[1][1];
    expect(second.powderIds).toEqual([]);
    expect(second.bullets.map(bulletKey)).toEqual([bulletKey(SHELF.bullets[0])]);

    // And the rail agrees: both entries are gone, neither is back.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: REMOVE_N550 })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: REMOVE_LAPUA })).not.toBeInTheDocument();
  });

  /**
   * ⚠️ THE UNITS WRITE CARRIES THE WHOLE SHELF TOO, and its control sits in
   * the toolbar with the rail beside it — the one write a member can fire
   * while a removal is still in the air.
   */
  it('does not resurrect a removed chip when the units are flipped straight after', async () => {
    const saveBench = server();
    render(<BenchPage />);

    fireEvent.click(await screen.findByRole('button', { name: REMOVE_N550 }));
    fireEvent.click(screen.getByRole('tab', { name: 'inch' }));

    await waitFor(() => expect(saveBench).toHaveBeenCalledTimes(2));

    const units = saveBench.mock.calls[1][1];
    expect(units.units).toBe('imperial');
    expect(units.powderIds).toEqual([]);
  });
});
