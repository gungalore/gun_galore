// @vitest-environment jsdom
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { benchApi, type BenchView } from '@/lib/bench/api';
import { DEFAULT_TOLERANCE, WEIGHT_TOLERANCES } from './contract';

/*
 * ⚠️ ONE getToken, HOISTED OUT OF THE HOOK. `token` is a useCallback over
 * getToken and the bench effect depends on its identity, so a fresh arrow
 * function per call re-fetches the bench on every render — see the same note
 * in components/bench/BulletPicker.spec.tsx.
 */
vi.mock('@clerk/nextjs', () => {
  const getToken = async () => 'test-token';
  return { useAuth: () => ({ getToken, isLoaded: true, isSignedIn: true }) };
});
vi.mock('@/lib/use-standalone', () => ({ useStandalone: () => false }));
/*
 * ⚠️ THE PAGE NOW READS THE APP ROUTER, because the finder's filters live in
 * the query string (audit C4). `useRouter` outside a mounted router throws
 * "invariant expected app router to be mounted", which is a crash rather than
 * a failed assertion — so every test that renders the page needs this.
 *
 * ⚠️ ONE PARAMS INSTANCE, NOT A FRESH ONE PER CALL. The URL-writing effect
 * depends on the object it is handed; a new one each render would re-run it
 * on every render for the whole suite.
 */
vi.mock('next/navigation', () => {
  const params = new URLSearchParams();
  return {
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => '/bench',
    useSearchParams: () => params,
  };
});

import BenchPage from '@/app/bench/page';

/**
 * THE BENCH — the grain window is a control, not a decoration.
 *
 * 🚨 THIS FILE EXISTS BECAUSE THIS MODULE HAS SHIPPED DECORATIVE FILTERS
 * TWICE. The cartridge tab, the weight band and every switched-off chip each
 * wrote a query parameter that changed nothing: the pill lit, the URL moved,
 * the answer stayed. A control that does not reach the server is worse than no
 * control, because the member believes the screen is answering them. So the
 * proof here is not that the width reaches `query()` — api.spec.ts owns that —
 * but that TAPPING THE PILL puts a new request on the wire with the new width
 * on it.
 *
 * 🚨 AND IT IS A SEARCH WIDTH, NEVER A CHARGE. Widening it shows the member
 * more loads; every one of them still arrives quoted at ITS OWN bullet weight,
 * in its own weight group, with its own start and max charge. Nothing asserted
 * here says otherwise, and nothing added here may.
 *
 * ⚠️ AND THE TWO COUNTS GO WITH IT. The powder rows' "N loads on your bench"
 * and the spec card's count are answers about the SAME shelf as the list, and
 * the server resolves the window per request — so a count taken at the default
 * ± 5 gr beside a list drawn at ± 0 is the screen contradicting itself.
 */

const SHELF: BenchView = {
  units: 'metric',
  powders: [{ id: 'p-n550', name: 'N550', maker: 'Vihtavuori' }],
  bullets: [{ weightGr: 150, calibreIn: 0.308 }],
  cartridges: [{ key: '30-06-springfield', name: '.30-06 Springfield' }],
};

/** The pill labels, straight off the contract — never retyped here. */
const LABEL = new Map(WEIGHT_TOLERANCES.map((t) => [t.id, t.label]));

function pill(toleranceGr: number): string {
  const label = LABEL.get(toleranceGr);
  if (label === undefined) throw new Error(`no width of ${toleranceGr} gr on the toolbar`);
  return label;
}

describe('the bullet weight window reaches the server', () => {
  let loads: ReturnType<typeof spyLoads>;

  function spyLoads() {
    return vi.spyOn(benchApi, 'loads').mockResolvedValue({ count: 0, groups: [] });
  }

  // Restored once, after the last render is unmounted: a write settles into
  // state that re-runs the search effect a tick later, and a restore between
  // tests leaves that tick calling the real client against a torn-down jsdom.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(benchApi, 'me').mockResolvedValue(SHELF);
    vi.spyOn(benchApi, 'powders').mockResolvedValue([]);
    loads = spyLoads();
  });

  afterAll(() => vi.restoreAllMocks());

  /** Every width the toolbar offers, sent as the member chose it. */
  const WIDTHS = WEIGHT_TOLERANCES.filter((t) => t.id !== DEFAULT_TOLERANCE).map((t) => t.id);

  it.each(WIDTHS)('tapping %s gr searches again at that width', async (width) => {
    render(<BenchPage />);
    await waitFor(() => expect(loads).toHaveBeenCalled());
    const before = loads.mock.calls.length;

    fireEvent.click(screen.getByRole('tab', { name: pill(width) }));

    await waitFor(() => expect(loads.mock.calls.length).toBeGreaterThan(before));
    expect(loads.mock.calls.at(-1)?.[1]?.tolerance).toBe(width);
  });

  /**
   * 🚨 "Exact" IS 0, AND 0 IS THE ONE A FALSEY CHECK EATS. Dropped, the server
   * applies its default of ± 5 gr and the member reads a wider answer than the
   * lit pill promises — and the other three widths keep working, which is what
   * makes it hard to see from the screen.
   */
  it('sends 0 for Exact rather than falling back to the default', async () => {
    render(<BenchPage />);
    await waitFor(() => expect(loads).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: pill(0) }));

    await waitFor(() => expect(loads.mock.calls.at(-1)?.[1]?.tolerance).toBe(0));
  });

  it('opens on the width the contract names, not on a literal typed into the page', async () => {
    render(<BenchPage />);
    await waitFor(() => expect(loads).toHaveBeenCalled());
    expect(loads.mock.calls[0][1]?.tolerance).toBe(DEFAULT_TOLERANCE);
  });

  /**
   * ⚠️ THE POWDER ROWS' COUNTS ARE COUNTED OVER THE SAME WIDTH AS THE LIST.
   * Each row promises what tapping that powder will show; counted at the
   * server's default while the finder is on "Exact", it reads "17 loads on
   * your bench" and opens onto nine.
   */
  it('counts the powder rows over the width the member is looking at', async () => {
    const powders = vi.spyOn(benchApi, 'powders').mockResolvedValue([]);
    render(<BenchPage />);
    await waitFor(() => expect(loads).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: pill(15) }));
    await waitFor(() => expect(loads.mock.calls.at(-1)?.[1]?.tolerance).toBe(15));

    fireEvent.click(screen.getByRole('button', { name: 'Add powder' }));
    await waitFor(() => expect(powders).toHaveBeenCalled());
    expect(powders.mock.calls.at(-1)?.[2]).toMatchObject({ tolerance: 15 });
  });

  /**
   * ⚠️ AND SO IS THE SPEC CARD'S. Same promise, same shelf: "loads on your
   * bench" over a list drawn at a different width is two figures about one
   * question.
   */
  it('counts the spec card over the width the member is looking at', async () => {
    // The card opens off a results group header, so the list has to have one.
    // A single row, and the group heading is the load's OWN weight — never the
    // bench bullet's; see the note above the weight groups in ResultsList.
    loads.mockResolvedValue({
      count: 1,
      groups: [
        {
          cartridge: {
            key: '30-06-springfield',
            name: '.30-06 Springfield',
            maxLengthMm: null,
            pmaxBar: null,
            pmaxPsi: null,
            thumb: null,
          },
          weights: [
            {
              weightGr: 155,
              rows: [
                {
                  id: 'l1',
                  bulletMaker: 'Sierra',
                  bulletType: 'HPBT',
                  powder: 'N550',
                  startGr: 46.5,
                  startFps: null,
                  maxGr: 50.2,
                  maxFps: null,
                  coalMm: null,
                  coalLoMm: null,
                  coalHiMm: null,
                  flags: [],
                },
              ],
            },
          ],
        },
      ],
    });
    const cartridge = vi.spyOn(benchApi, 'cartridge').mockRejectedValue(new Error('not under test'));
    render(<BenchPage />);
    await waitFor(() => expect(loads).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: pill(0) }));
    await waitFor(() => expect(loads.mock.calls.at(-1)?.[1]?.tolerance).toBe(0));

    fireEvent.click(await screen.findByRole('button', { name: /Spec card/ }));
    await waitFor(() => expect(cartridge).toHaveBeenCalled());
    expect(cartridge.mock.calls.at(-1)?.[2]).toMatchObject({ tolerance: 0 });
  });

  /**
   * 🚨 THE ROW IS LABELLED WITH THE LOAD'S OWN WEIGHT, NOT THE BENCH BULLET'S.
   * A 150 gr .308 on the shelf brings back 145, 150 and 155 gr loads once the
   * window is open, and each arrives in the group for the weight IT was worked
   * up at with its own start and max charge. That separation is the whole
   * safety of the wider search — a 155 gr row printed as "150 gr" would be the
   * screen offering one weight's charge for another.
   */
  it('prints a found load at its own bullet weight, not the shelf bullet’s', async () => {
    loads.mockResolvedValue({
      count: 1,
      groups: [
        {
          cartridge: {
            key: '30-06-springfield',
            name: '.30-06 Springfield',
            maxLengthMm: null,
            pmaxBar: null,
            pmaxPsi: null,
            thumb: null,
          },
          weights: [
            {
              weightGr: 155,
              rows: [
                {
                  id: 'l1',
                  bulletMaker: 'Sierra',
                  bulletType: 'HPBT',
                  powder: 'N550',
                  startGr: 46.5,
                  startFps: null,
                  maxGr: 50.2,
                  maxFps: null,
                  coalMm: null,
                  coalLoMm: null,
                  coalHiMm: null,
                  flags: [],
                },
              ],
            },
          ],
        },
      ],
    });
    render(<BenchPage />);

    // The shelf holds a 150 gr bullet; the load found for it is a 155 gr one,
    // and it says so — the maker and the type stay on the ROW because they
    // name the projectile THIS charge was worked up with, even though neither
    // narrows the search any more. (Two matches: the phone card and the
    // desktop row, which draw the same load at different widths.)
    expect(await screen.findByText('155 gr')).toBeInTheDocument();
    expect(screen.getAllByText(/Sierra HPBT 155 gr/).length).toBeGreaterThan(0);
    // And never the shelf bullet's weight on the load itself.
    expect(screen.queryByText(/Sierra HPBT 150 gr/)).not.toBeInTheDocument();
  });

  /**
   * 🚨 THE SCREEN MAY NOT CALL A WINDOWED MATCH BUILDABLE. The count above the
   * list used to read "N loads CAN BE BUILT from your bench" — true while a
   * bench bullet matched its own weight exactly, and false the moment a ± gr
   * window opened: the 155 gr load below was worked up with a projectile this
   * member does not own, and telling them it is theirs to load is one weight's
   * charge offered for another. It matched their shelf. It says so.
   *
   * ⚠️ ASSERTED OVER THE WHOLE PANEL, not over one string, because the same
   * promise can be made again by any surface that counts against the bench —
   * the cartridge group's meta line is the other one on this screen.
   */
  it('says the loads MATCH the bench, never that they can be built from it', async () => {
    loads.mockResolvedValue({
      count: 1,
      groups: [
        {
          cartridge: {
            key: '30-06-springfield',
            name: '.30-06 Springfield',
            maxLengthMm: null,
            pmaxBar: null,
            pmaxPsi: null,
            thumb: null,
          },
          weights: [
            {
              weightGr: 155,
              rows: [
                {
                  id: 'l1',
                  bulletMaker: 'Sierra',
                  bulletType: 'HPBT',
                  powder: 'N550',
                  startGr: 46.5,
                  startFps: null,
                  maxGr: 50.2,
                  maxFps: null,
                  coalMm: null,
                  coalLoMm: null,
                  coalHiMm: null,
                  flags: [],
                },
              ],
            },
          ],
        },
      ],
    });
    const { container } = render(<BenchPage />);
    await screen.findByText('155 gr');

    const copy = (container.textContent ?? '').toLowerCase();
    expect(copy).toContain('match your bench');
    expect(copy).not.toMatch(/can be built|you can (build|load)|safe to/);
  });
});
