'use client';

/**
 * THE BENCH — the page.
 *
 * The only stateful thing in the module: every component under
 * components/bench/ is presentational and receives its data and callbacks from
 * here (see components/bench/contract.ts). One owner means one place where a
 * filter change, a fetch and an overlay can get out of step.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useStandalone } from '@/lib/use-standalone';
import {
  benchApi,
  benchErrorCopy,
  isAbort,
  type BenchPowder,
  type BenchSharePayload,
  type BenchView,
  type CartridgeSpec,
  type LoadGroup,
  type LoadRow,
  type LoadsResponse,
  type LogEntry,
} from '@/lib/bench/api';
import type { Units } from '@/lib/bench/geometry';
import {
  DEFAULT_TOLERANCE,
  DEFAULT_URL_STATE,
  EMPTY_OFF,
  NO_OVERLAY,
  type BenchBulletOption,
  type BenchCartridgeOption,
  type OverlayStack,
  WEIGHT_BANDS,
  WEIGHT_TOLERANCES,
  benchUrlSearch,
  bulletKey,
  closeOverlay,
  hasOverlay,
  type LogDraft,
  offFromSnapshot,
  type OffState,
  onlyOverlay,
  parseBenchUrl,
  pushOverlay,
  replaceTop,
  type ShelfNames,
  type WeightBand,
} from '@/components/bench/contract';
import { Btn, Seg, cx, usePhone } from '@/components/bench/primitives';
// benchBulletName is the chip's own wording for a bullet. The toast that
// confirms a removal has to use it, or it confirms something the member cannot
// match to the chip they just pointed at — see the note on the helper.
import BenchRail, { benchBulletName } from '@/components/bench/BenchRail';
import BenchSheet from '@/components/bench/BenchSheet';
import { ResultsList } from '@/components/bench/ResultsList';
import { LoadCard } from '@/components/bench/LoadCard';
import { SpecCard } from '@/components/bench/SpecCard';
import LogSheet from '@/components/bench/LogSheet';
import LogList from '@/components/bench/LogList';
import { PowderPicker } from '@/components/bench/PowderPicker';
import { BulletPicker } from '@/components/bench/BulletPicker';
import { CartridgePicker } from '@/components/bench/CartridgePicker';
import { Toast } from '@/components/bench/Toast';

/**
 * How a spec card is put on the screen.
 *
 * 🚨 THE STACK IS THE ONLY RECORD OF WHO OPENED IT, AND THEREFORE OF WHAT ITS
 * CLOSE BUTTON GOES BACK TO. Opened from a load card the spec sits ON TOP of
 * it and closes back onto it; opened from a group header it is the only thing
 * open and closes onto the finder. Held instead as a separate `openLoad` flag
 * that nothing ever cleared, the second case brought back whichever load card
 * had been looked at last — a card for a cartridge the member had stopped
 * reading about, produced by a Close button.
 */
type SpecOpen =
  /** From a group header: the only overlay. */
  | 'only'
  /** From the load card: on top of it. */
  | 'over'
  /** From a shell-holder chip: swap this card for the next, never six deep. */
  | 'replace'
  /** Retry: re-run the fetch and leave the stack exactly as it is. */
  | 'keep';

/**
 * The body PUT /bench/me replaces the stored bench with.
 *
 * ⚠️ TAKEN OFF benchApi.saveBench RATHER THAN RETYPED. It is the complete
 * bench — all four fields — and a copy of that shape here is a copy that can
 * go one field short of the client's while still compiling.
 */
type SaveBody = Parameters<typeof benchApi.saveBench>[1];

interface OpenLoad {
  row: LoadRow;
  group: LoadGroup;
  weightGr: number;
}

/**
 * ⚠️ THE SUSPENSE BOUNDARY IS FOR `useSearchParams`, NOT FOR DATA. Next
 * de-opts a route out of static rendering when a client component reads the
 * search params, and without a boundary above it that is a BUILD error rather
 * than a runtime one — so the finder's own state can be in the URL (C4) only
 * if this wrapper exists. `fallback={null}` because the page below draws its
 * own skeletons; a second set here would flash a different empty shape first.
 */
export default function BenchPage() {
  return (
    <Suspense fallback={null}>
      <BenchFinder />
    </Suspense>
  );
}

function BenchFinder() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const standalone = useStandalone();
  const phone = usePhone();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const token = useCallback(() => getToken(), [getToken]);

  const [bench, setBench] = useState<BenchView | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);

  /**
   * The bench the next write must build on, and the queue it builds in.
   *
   * 🚨 EVERY WRITE SENDS THE WHOLE BENCH, SO TWO IN FLIGHT AT ONCE UNDO EACH
   * OTHER. PUT /bench/me replaces rather than merges, and each of the five
   * writers below builds its body from the bench it was rendered with — so a
   * member who taps × on a powder and, before the answer lands, taps × on a
   * bullet sends a second body still carrying the powder. The powder comes
   * back. Nothing errors, both toasts say "removed", and the chip the member
   * watched disappear is on the rail again a moment later. Flipping mm/inch
   * in that same moment does it too: the units write carries the whole shelf.
   *
   * ⚠️ SO THE BENCH A WRITE STARTS FROM IS THE REF, NEVER THE CLOSURE, and
   * writes run one after another rather than at once. `writing` is the tail of
   * the queue; each writer appends to it and reads `benchRef` only once its
   * turn comes, by which time the write before it has already been applied.
   */
  const benchRef = useRef<BenchView | null>(null);
  const writing = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * The address bar, read ONCE.
   *
   * 🚨 A LAZY INITIALISER, NOT AN EFFECT. Hydrating the filters after the
   * first render would fire one search against the DEFAULT bench and a second
   * against the link's — so a shared or bookmarked query flickers through
   * somebody else's answer on the way to its own, and on a slow connection it
   * stays there. Read here, the very first request is already the right one.
   *
   * ⚠️ AND `parseBenchUrl` VALIDATES EVERY VALUE against the widths and bands
   * the toolbar actually offers. A URL is typed by strangers; an unrecognised
   * band would narrow the search while lighting no pill.
   */
  const [initialUrl] = useState(() => parseBenchUrl(params));

  const [off, setOff] = useState<OffState>(initialUrl.off);
  const [cartridge, setCartridge] = useState(initialUrl.cartridge);
  const [weight, setWeight] = useState<WeightBand>(initialUrl.weight);
  /**
   * How many grains either side of a bench bullet's weight the search covers.
   *
   * 🚨 IT WIDENS THE SEARCH, IT NEVER WIDENS A CHARGE. A member who owns a
   * 150 gr .308 owns a shelf of bullets a reloader treats as one: on the
   * operator's own bench, .30-06 with N550 finds 9 loads at exactly 150 gr and
   * 17 at ± 5. Those extra loads are the point of the tool. Every one of them
   * still arrives quoted at ITS OWN bullet weight, in its own weight group,
   * with its own start and max charge — the window says what is SHOWN, never
   * what may be loaded, and no copy on this page may blur the two.
   *
   * ⚠️ A NUMBER, DEFAULTED FROM contract.ts. The widths and the default live
   * in WEIGHT_TOLERANCES / DEFAULT_TOLERANCE beside the backend's matching
   * pair, and a literal 5 typed here is how the toolbar and the server end up
   * disagreeing about what the member asked for.
   */
  const [tolerance, setTolerance] = useState<number>(initialUrl.tolerance);
  const [units, setUnits] = useState<Units>('metric');

  /**
   * The permalink this page was opened with, until it has been applied.
   *
   * ⚠️ IT GATES THE URL WRITER BELOW. Serialising the finder's state before the
   * share has been read would strip `?s=` out of the address bar first, and
   * the token would be gone before anything had fetched it.
   */
  const [shareToken, setShareToken] = useState<string | null>(() => params.get('s'));

  const [result, setResult] = useState<LoadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stack, setStack] = useState<OverlayStack>(NO_OVERLAY);
  const [openLoad, setOpenLoad] = useState<OpenLoad | null>(null);

  const [spec, setSpec] = useState<CartridgeSpec | null>(null);
  /** Which cartridge the open card is about, so Retry can ask for it again. */
  const [specKey, setSpecKey] = useState<string | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logBump, setLogBump] = useState(false);

  const [powders, setPowders] = useState<BenchPowder[]>([]);
  const [powdersLoading, setPowdersLoading] = useState(false);
  const [bullets, setBullets] = useState<BenchBulletOption[]>([]);
  const [bulletsLoading, setBulletsLoading] = useState(false);
  const [cartridges, setCartridges] = useState<BenchCartridgeOption[]>([]);
  const [cartridgesLoading, setCartridgesLoading] = useState(false);

  /**
   * The toast, with the tone it is said in.
   *
   * 🚨 A FAILURE USED TO ARRIVE WITH A GREEN TICK. Every error on this page
   * was routed through the same `setToast(e.message)` as every confirmation,
   * so "The bullet list could not be loaded" appeared beside the same
   * reassuring glyph as "H4350 added to your bench" — and the one time a
   * member most needs to notice a message is the one time it looked like
   * everything had worked.
   *
   * ⚠️ SAY IT THROUGH `say()` OR `fail()`, NEVER setToast DIRECTLY. Two
   * helpers rather than a tone argument at forty call sites is what stops the
   * next failure being confirmed in green.
   */
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const say = useCallback((text: string) => setToast({ text, tone: 'ok' }), []);

  /**
   * ⚠️ THE COPY COMES FROM THE STATUS, NEVER FROM THE BODY. `call()` throws
   * with the raw text of whatever answered — an nginx error page on a 502, a
   * Clerk JSON blob on a 401 — and both were rendered into the page verbatim.
   * The original goes to the console, where a developer can read it and a
   * member cannot. See benchErrorCopy in lib/bench/api.ts.
   */
  const fail = useCallback((e: unknown, where: string) => {
    if (isAbort(e)) return;
    console.error(`[bench] ${where}`, e);
    setToast({ text: benchErrorCopy(e), tone: 'error' });
  }, []);

  /* ── The bench ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let live = true;
    benchApi
      .me(token)
      .then((b) => {
        if (!live) return;
        benchRef.current = b;
        setBench(b);
        setUnits(b.units === 'imperial' ? 'imperial' : 'metric');
      })
      .catch((e: unknown) => {
        if (!live || isAbort(e)) return;
        console.error('[bench] GET /bench/me', e);
        setBenchError(benchErrorCopy(e));
      });
    return () => {
      live = false;
    };
  }, [isLoaded, isSignedIn, token]);

  /* ── The address bar ───────────────────────────────────────────────── */

  /**
   * The finder's four controls, mirrored into the query string.
   *
   * 🚨 `replace`, NOT `push`, AND `scroll: false`. Toggling four chips is one
   * act, not four history entries — pushed, the Back button would walk a
   * member backwards through their own typing instead of leaving the page.
   * And a scroll to the top on every chip tap would throw away their place in
   * a three-hundred-row list.
   *
   * ⚠️ ONLY WHEN THE STRING ACTUALLY CHANGES. `router.replace` to the URL the
   * browser is already on still re-renders the route; called from an effect
   * that also depends on the params it writes, that is a loop.
   *
   * ⚠️ AND NO OVERLAY IS IN HERE. SPEC-BUILD §11: the URL never changes except
   * for the permalink. A modal in the history is a modal the Back button
   * closes, and Escape and Back would then mean two different things on one
   * screen.
   */
  useEffect(() => {
    // The permalink has not been read yet; writing now would strip it.
    if (shareToken) return;
    const next = benchUrlSearch({ off, cartridge, weight, tolerance });
    if (next === params.toString()) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [off, cartridge, weight, tolerance, shareToken, params, pathname, router]);

  /* ── The permalink ─────────────────────────────────────────────────── */

  /**
   * `/bench?s=<token>` — somebody else's search, on this member's bench.
   *
   * 🚨 THE SNAPSHOT IS APPLIED AS `off` CHIPS AND IS NEVER WRITTEN TO THE
   * BENCH. A link that could add six powders to a stranger's saved shelf is a
   * link nobody can safely open; muting my own chips answers their question on
   * my screen, is visible as chips, and is undone with one tap. See
   * offFromSnapshot in contract.ts.
   *
   * ⚠️ IT WAITS FOR THE BENCH, because the snapshot can only be compared
   * against a shelf that has arrived.
   */
  useEffect(() => {
    if (!shareToken || !bench) return;
    let live = true;
    const ac = new AbortController();

    benchApi
      .getShare(token, shareToken, { signal: ac.signal })
      .then((payload: BenchSharePayload | null) => {
        if (!live) return;
        const f = payload?.filters ?? {};
        // Back through the same validator the URL uses, so a stored width the
        // toolbar no longer offers cannot light a pill that does not exist.
        const applied = parseBenchUrl(
          new URLSearchParams(
            benchUrlSearch({
              off: { ...DEFAULT_URL_STATE.off, ...(f.off ?? {}) },
              cartridge: f.cartridge ?? 'all',
              weight: (f.weight ?? 'any') as WeightBand,
              tolerance: f.tolerance ?? DEFAULT_TOLERANCE,
            }),
          ),
        );
        setCartridge(applied.cartridge);
        setWeight(applied.weight);
        setTolerance(applied.tolerance);
        setOff(payload?.bench ? offFromSnapshot(bench, payload.bench, applied.off) : applied.off);
        setShareToken(null);
      })
      .catch((e: unknown) => {
        if (!live || isAbort(e)) return;
        // An expired token is a 404, and the member stays on their OWN bench
        // with a sentence — never on a half-applied filter set they did not
        // choose and cannot see the rest of.
        fail(e, 'GET /bench/share/:token');
        setShareToken(null);
      });

    return () => {
      live = false;
      ac.abort();
    };
  }, [shareToken, bench, token, fail]);

  /**
   * The one door every bench write goes through.
   *
   * 🚨 IT EXISTS BECAUSE PUT /bench/me REPLACES THE BENCH. `build` is handed
   * the shelf as it stands AFTER every write already queued, not the one this
   * component rendered with, so a second tap cannot resurrect what the first
   * one removed. Returning null from `build` sends nothing — that is how a
   * removal of something no longer there stays silent rather than writing the
   * bench back unchanged and toasting a removal that never happened.
   *
   * ⚠️ THE BODY IS ALWAYS COMPLETE. Every caller spreads all four fields off
   * `current`; a body that names only the axis it edits clears the other two,
   * and nothing errors, because an empty bench is a legal bench.
   */
  const writeBench = useCallback(
    (
      build: (current: BenchView) => SaveBody | null,
      done?: (next: BenchView) => void,
      failed?: (e: Error) => void,
    ) => {
      // `.catch` first: one rejected write must not stop the queue, or a
      // dropped connection would leave the rail unable to save anything for
      // the rest of the sitting.
      writing.current = writing.current
        .catch(() => undefined)
        .then(() => {
          const current = benchRef.current;
          if (!current) return;
          const body = build(current);
          if (!body) return;
          return benchApi.saveBench(token, body).then(
            (next) => {
              benchRef.current = next;
              setBench(next);
              done?.(next);
            },
            (e: Error) => failed?.(e),
          );
        });
    },
    [token],
  );

  /* ── The results ───────────────────────────────────────────────────── */

  /**
   * ⚠️ STALE RESPONSES ARE DROPPED BY SEQUENCE, NOT BY UNMOUNT. Toggling three
   * chips quickly fires three searches, and they can land out of order — the
   * cheapest query often answers last. Without this the member sees the result
   * of a filter they have already changed, which reads as the filter being
   * broken rather than slow.
   */
  const seq = useRef(0);

  /**
   * The switched-off chips as the API takes them: one flat list, all three
   * axes, because the server matches each axis against the same set.
   *
   * 🚨 IT GOES TO EVERY BENCH-RELATIVE COUNT, NOT JUST THE LIST, AND SO DOES
   * THE GRAIN WINDOW. The powder picker's per-powder count and the spec card's
   * "loads on your bench" are answers about the same shelf as the results
   * behind them, and a request that leaves either out does not fail — it
   * silently answers for a different shelf and prints a figure the list
   * contradicts. The two travel together as a BenchScope; see lib/bench/api.ts.
   */
  const offList = useMemo(
    () => [...off.powderIds, ...off.cartridgeKeys, ...off.bullets],
    [off],
  );

  const search = useCallback(() => {
    if (!isLoaded || !isSignedIn) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    benchApi
      // ⚠️ THE TOLERANCE IS SENT ON EVERY SEARCH, INCLUDING WHEN IT IS 0.
      // "Exact" is a real choice and an omitted tolerance falls back to the
      // server's default of 5 — see the note in lib/bench/api.ts query().
      .loads(token, { cartridge, weight, tolerance, off: offList })
      .then((r) => {
        if (mine !== seq.current) return;
        setResult(r);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (mine !== seq.current || isAbort(e)) return;
        // ⚠️ THE COPY, NOT THE BODY. ResultsList deliberately does not print
        // this string (its panel carries fixed copy), but it is state on a
        // surface with a hard copy boundary and a raw gateway page has no
        // business sitting in it.
        console.error('[bench] GET /bench/loads', e);
        setError(benchErrorCopy(e));
        setLoading(false);
      });
    // ⚠️ `tolerance` IS IN THE DEPS, WHICH IS WHAT MAKES THE CONTROL REAL.
    // The effect below re-runs the search when this callback's identity
    // changes; a width left out of the list would change the pill, change the
    // request it would have sent, and never send one — the decorative-filter
    // failure this module has already shipped twice.
  }, [isLoaded, isSignedIn, token, cartridge, weight, tolerance, offList]);

  /**
   * The shelf as the QUERY sees it — every field the search actually sends,
   * and not one more.
   *
   * 🚨 IT IS NOT `bench`. The effect below used to key on the bench OBJECT,
   * and every write replaces that object — so flipping mm/inch, which is a
   * display preference the server never reads on a search, fired a fresh
   * results query and repainted the whole list. Adding a powder must re-run
   * the search; changing the units must not, and only a key built from the
   * fields the request carries can tell those apart.
   *
   * An empty string means the bench has not arrived yet; an EMPTY BENCH keys
   * as `||`, which is truthy, so a member with nothing on the shelf still gets
   * their (empty) answer and the panel that explains it.
   */
  const shelfKey = useMemo(
    () =>
      bench
        ? [
            bench.powders.map((p) => p.id).join(','),
            bench.bullets.map(bulletKey).join(','),
            bench.cartridges.map((c) => c.key).join(','),
          ].join('|')
        : '',
    [bench],
  );

  useEffect(() => {
    if (!shelfKey) return;
    search();
  }, [shelfKey, search]);

  /* ── Filters ───────────────────────────────────────────────────────── */

  const toggleOff = useCallback((kind: keyof OffState, id: string) => {
    // Switches an item off for THIS SEARCH only. Deliberately never saves —
    // the bench is edited through the Add flows.
    setOff((prev) => {
      const list = prev[kind];
      return {
        ...prev,
        [kind]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
      };
    });
    /*
     * 🚨 AND THE TOOLBAR TAB LETS GO OF A CARTRIDGE THE CHIP JUST DROPPED.
     * The tab is a FILTER and the chip is an AXIS, and on the server the
     * filter outranks the axis — so a tab still pinned to a cartridge the
     * member has greyed out goes on returning that cartridge's loads, chip
     * and all. The one control on the screen whose whole promise is "take it
     * off the shelf for this search" would then visibly fail to.
     *
     * Same reset the removal path does (see removeFromBench), for the same
     * reason and by the same rule: a filter may never name something the
     * search is not running against.
     */
    if (kind === 'cartridgeKeys') setCartridge((cur) => (cur === id ? 'all' : cur));
  }, []);

  /**
   * Every control back to where it started.
   *
   * ⚠️ THE FILTERS ONLY — THE BENCH IS NOT TOUCHED. Muting a chip and removing
   * one are two different acts everywhere else in this module, and a "Reset"
   * that quietly emptied a shelf would be the worst possible place to blur
   * them. Units are not in here either: mm/inch is a saved preference, not a
   * description of this search.
   */
  const resetFilters = useCallback(() => {
    setOff(EMPTY_OFF);
    setCartridge('all');
    setWeight('any');
    setTolerance(DEFAULT_TOLERANCE);
  }, []);

  /**
   * ⚠️ THE SWITCHED-OFF CARTRIDGES ARE NOT OFFERED. Leave them in and the tab
   * can be pointed back at a greyed-out chip a moment after the reset above
   * put it right, which is the same contradiction by a slower route.
   */
  const cartridgeOptions = useMemo(
    () => [
      { id: 'all', label: 'All' },
      ...(bench?.cartridges ?? [])
        .filter((c) => !off.cartridgeKeys.includes(c.key))
        .map((c) => ({ id: c.key, label: c.name })),
    ],
    [bench, off.cartridgeKeys],
  );

  /**
   * The grain widths as the segmented control speaks them.
   *
   * ⚠️ BUILT FROM WEIGHT_TOLERANCES, NEVER RETYPED. Seg is a tablist keyed by
   * string ids, so the figures are carried as strings across it and converted
   * back with Number() on the way out; a second hand-written list of labels
   * here is how the toolbar comes to offer a width the server does not honour.
   */
  const toleranceOptions = useMemo(
    () => WEIGHT_TOLERANCES.map((t) => ({ id: String(t.id), label: t.label })),
    [],
  );

  /**
   * Which axes the shelf has nothing on.
   *
   * ⚠️ ONE FLAG PER AXIS, NOT ONE "IS IT EMPTY" BOOLEAN. Results are an AND
   * across powder, bullet and cartridge, so a shelf missing any one axis
   * returns nothing however full the other two are — and the empty state has
   * to name and open the axis that is actually bare. Collapsed to a single
   * boolean it could only ever offer "Add a powder", which is the wrong door
   * for the member who already has six.
   *
   * Every gap is false until the bench has loaded: with nothing fetched yet we
   * do not know what is missing, and guessing draws the wrong sentence for a
   * frame.
   */
  const gaps = useMemo(
    () => ({
      powder: !!bench && bench.powders.length === 0,
      bullet: !!bench && bench.bullets.length === 0,
      cartridge: !!bench && bench.cartridges.length === 0,
    }),
    [bench],
  );

  /**
   * What this search actually ran against, named — the other half of
   * LoadsResponse.why.
   *
   * ⚠️ THE `off` CHIPS ARE TAKEN OUT HERE. A count with each axis relaxed
   * ("70 loads on your cartridges and powders") is only true of the search the
   * server ran, and that search excluded the chips the member switched off.
   * Naming a powder they had just switched off would be the panel explaining a
   * search that never happened.
   *
   * 🚨 AND THE CARTRIDGE TAB NARROWS IT TOO, FOR THE SAME REASON THE CHIPS DO.
   * Every count in `why` is taken with the tab held — a filter is not an axis,
   * so the server pins it through all four queries — and a sentence naming the
   * whole shelf beside a figure counted for one cartridge reads "Your 3
   * cartridges and N550 have 70 loads together" about 70 loads that are all in
   * the one cartridge the member is looking at. Named this way the clause is
   * ".30-06 Springfield and N550", which is what was counted.
   *
   * 🚨 AND A BULLET IS NAMED BY benchBulletName, THE CHIP'S OWN WORDS. The
   * sentence sits a few centimetres from the chips it is talking about, and
   * "Hornady 150 gr" names four projectiles — .277", .308", .311", .323" — so
   * a second, calibre-less spelling here would leave the member unable to tell
   * which of their own bullets the panel means.
   */
  const shelf = useMemo<ShelfNames>(
    () => ({
      powders: (bench?.powders ?? [])
        .filter((p) => !off.powderIds.includes(p.id))
        .map((p) => p.name),
      // ⚠️ THE WINDOW IS NAMED WITH THE BULLET, OR THE COUNT BESIDE IT LIES.
      // The empty panel says "X and Y have N loads together", and for the
      // bullet axis that N is counted across the whole ± window — 145 to 155
      // grains for a 150. Naming the bullet at its exact weight while quoting
      // a window-wide count attributes loads to a bullet that did not earn
      // them. A count is a promise; this keeps it one.
      bullets: (bench?.bullets ?? [])
        .filter((b) => !off.bullets.includes(bulletKey(b)))
        .map((b) =>
          tolerance > 0
            ? `${benchBulletName(b)} ± ${tolerance} gr`
            : benchBulletName(b),
        ),
      cartridges: (bench?.cartridges ?? [])
        .filter((c) => !off.cartridgeKeys.includes(c.key))
        .filter((c) => cartridge === 'all' || c.key === cartridge)
        .map((c) => c.name),
    }),
    [bench, off, cartridge, tolerance],
  );

  /* ── Units ─────────────────────────────────────────────────────────── */

  const changeUnits = useCallback(
    (next: Units) => {
      setUnits(next);
      // The whole bench goes with it: PUT replaces rather than merges, so
      // sending units alone would clear the shelf.
      //
      // ⚠️ AND IT GOES THROUGH THE QUEUE LIKE EVERY OTHER WRITE. The mm/inch
      // control sits in the toolbar with the rail beside it, so this is the
      // one write a member can fire while a removal is still in the air — and
      // built from a stale bench it puts the removed chip straight back.
      writeBench(
        (current) => ({
          powderIds: current.powders.map((p) => p.id),
          bullets: current.bullets,
          cartridgeKeys: current.cartridges.map((c) => c.key),
          units: next,
        }),
        undefined,
        () => {
          // A preference that failed to save is not worth interrupting for —
          // it stays applied for this sitting.
        },
      );
    },
    [writeBench],
  );

  /* ── Overlays ──────────────────────────────────────────────────────── */

  /**
   * One counter per overlay, and an AbortController where the answer is big.
   *
   * 🚨 A LATE ANSWER RENDERS THE WRONG CARTRIDGE. Tapping two group headers in
   * a second fires two spec fetches, and the cheaper one often lands last — so
   * the card the member is looking at fills with another cartridge's drawing,
   * its dimensions and its Pmax, with the right name in the header. Nothing
   * errors and nothing looks broken, which is what makes it dangerous on a
   * screen whose whole job is to be measured against.
   *
   * ⚠️ THE COUNTER IS THE GUARD; THE ABORT IS THE COURTESY. `abort()` stops
   * the superseded request costing anything, but a signal that fires after the
   * response has already been handed over changes nothing — so the sequence
   * check is what actually decides, exactly as `seq` does for the results.
   */
  const specSeq = useRef(0);
  const specAbort = useRef<AbortController | null>(null);
  const powdersSeq = useRef(0);
  const bulletsSeq = useRef(0);
  const cartridgesSeq = useRef(0);
  const logSeq = useRef(0);

  const openSpec = useCallback(
    (key: string, how: SpecOpen = 'only') => {
      const mine = ++specSeq.current;
      specAbort.current?.abort();
      const ac = new AbortController();
      specAbort.current = ac;

      setStack((s) =>
        how === 'keep'
          ? s
          : how === 'over'
            ? pushOverlay(s, 'spec')
            : how === 'replace'
              ? replaceTop(s, 'spec')
              : onlyOverlay('spec'),
      );
      setSpecKey(key);
      setSpec(null);
      setSpecError(null);
      setSpecLoading(true);
      benchApi
        // ⚠️ WITH THE OFF CHIPS *AND* THE GRAIN WINDOW. The card's "loads on
        // your bench" is a count against the same shelf as the list it was
        // opened from, and the shelf is both of those: sent without the chips
        // it answers for the full bench, and sent without the window it
        // answers over the server's default ± 5 gr. Either way it prints a
        // figure the list behind it contradicts, with nothing on screen to
        // explain the gap. See BenchScope in lib/bench/api.ts.
        .cartridge(token, key, { off: offList, tolerance, cartridge, weight }, { signal: ac.signal })
        .then((s) => {
          if (mine !== specSeq.current) return;
          setSpec(s);
          setSpecLoading(false);
        })
        .catch((e: unknown) => {
          if (mine !== specSeq.current || isAbort(e)) return;
          console.error('[bench] GET /bench/cartridges/:key', e);
          setSpecError(benchErrorCopy(e));
          setSpecLoading(false);
        });
    },
    [token, offList, tolerance, cartridge, weight],
  );

  const openLogList = useCallback(() => {
    const mine = ++logSeq.current;
    setStack(onlyOverlay('logList'));
    setLogLoading(true);
    benchApi
      .log(token)
      .then((rows) => {
        if (mine !== logSeq.current) return;
        setEntries(rows);
        setLogLoading(false);
      })
      .catch((e: unknown) => {
        if (mine !== logSeq.current || isAbort(e)) return;
        setLogLoading(false);
        fail(e, 'GET /bench/log');
      });
  }, [token, fail]);

  const openPowders = useCallback(() => {
    const mine = ++powdersSeq.current;
    setStack(onlyOverlay('powders'));
    setPowdersLoading(true);
    benchApi
      // ⚠️ WITH THE OFF CHIPS AND THE WINDOW, for the reason openSpec carries
      // them: each row's count is "how many loads this powder adds to your
      // bench", and the bench it means is the one the member can see — chips
      // and all, over the width the toolbar is showing. Counted at the default
      // ± 5 gr while the finder is on "Exact", a row reads "17 loads on your
      // bench" and opens onto nine.
      .powders(token, undefined, { off: offList, tolerance, cartridge, weight })
      .then((p) => {
        if (mine !== powdersSeq.current) return;
        setPowders(p);
        setPowdersLoading(false);
      })
      .catch((e: unknown) => {
        if (mine !== powdersSeq.current || isAbort(e)) return;
        setPowdersLoading(false);
        // Same reason the other two pickers toast: the empty state is a
        // statement about our catalogue, and a network error must not be
        // allowed to make it.
        fail(e, 'GET /bench/powders');
      });
  }, [token, offList, tolerance, cartridge, weight, fail]);

  const addPowder = useCallback(
    (p: BenchPowder) => {
      writeBench(
        (current) => ({
          powderIds: [...current.powders.map((x) => x.id), p.id],
          bullets: current.bullets,
          cartridgeKeys: current.cartridges.map((c) => c.key),
          // ⚠️ `current.units`, NOT THE COMPONENT'S. Every other field of this
          // body is taken off the queued bench for exactly this reason, and
          // units was the one read from a closure — so an add that queued
          // behind a mm/inch flip wrote the OLD preference back over the new
          // one, and the toolbar and the saved bench then disagreed until the
          // next reload.
          units: current.units,
        }),
        () => say(`${p.name} added to your bench`),
        (e) => fail(e, 'PUT /bench/me'),
      );
      setStack(NO_OVERLAY);
    },
    [writeBench, say, fail],
  );

  /**
   * ⚠️ A FAILED FETCH IS TOASTED, NOT SWALLOWED. Both pickers draw their empty
   * state from an empty array, so a rejected request lands the member on "No
   * bullets are loaded yet." / "No cartridges are loaded yet." — a statement
   * about our catalogue made out of a network error, on the one screen whose
   * whole job is to stop the bench being empty. The list props carry no error
   * channel, so the truth is told on the toast rail, which sits at z-index 70
   * and is therefore readable over the open overlay.
   */
  const openBullets = useCallback(() => {
    const mine = ++bulletsSeq.current;
    setStack(onlyOverlay('bullets'));
    setBulletsLoading(true);
    benchApi
      .bullets(token)
      .then((b) => {
        if (mine !== bulletsSeq.current) return;
        setBullets(b);
        setBulletsLoading(false);
      })
      .catch((e: unknown) => {
        if (mine !== bulletsSeq.current || isAbort(e)) return;
        setBulletsLoading(false);
        fail(e, 'GET /bench/bullets');
      });
  }, [token, fail]);

  const openCartridges = useCallback(() => {
    const mine = ++cartridgesSeq.current;
    setStack(onlyOverlay('cartridges'));
    setCartridgesLoading(true);
    benchApi
      .cartridgeList(token)
      .then((c) => {
        if (mine !== cartridgesSeq.current) return;
        setCartridges(c);
        setCartridgesLoading(false);
      })
      .catch((e: unknown) => {
        if (mine !== cartridgesSeq.current || isAbort(e)) return;
        setCartridgesLoading(false);
        fail(e, 'GET /bench/cartridges');
      });
  }, [token, fail]);

  /**
   * ⚠️ EVERY ADD SENDS THE WHOLE BENCH. PUT /bench/me replaces rather than
   * merges, so a body that omits an axis clears it — adding a bullet with a
   * partial body would wipe the member's powders.
   *
   * 🚨 A BULLET IS A WEIGHT IN A CALIBRE — NOT A BRAND. Operator, 2026-09-03:
   * "a 150gr bullet of any manufacturer would yield almost the exact same
   * pressures and speeds. this is the whole point of the Bench." So the two
   * fields written here are the two the match reads, and the maker and the
   * shape family are deliberately NOT among them: stored, they would only be a
   * second identity for the same shelf entry, and .30-06 + N550 + "Hornady
   * 150gr SP" is the bench that returned nothing at all.
   *
   * 🚨 AND THE CALIBRE STILL TRAVELS WITH IT. Dropping the maker is not
   * dropping the diameter: 150 gr names a .277", a .308", a .311" and a .323"
   * projectile, and they do not swap. `calibreIn` is copied through verbatim,
   * never re-derived — without it bulletKey() collapses all four into one
   * entry, which is the hazard the calibre work exists to prevent.
   */
  const addBullet = useCallback(
    (b: BenchBulletOption) => {
      writeBench(
        (current) => ({
          powderIds: current.powders.map((p) => p.id),
          bullets: [...current.bullets, { weightGr: b.weightGr, calibreIn: b.calibreIn }],
          cartridgeKeys: current.cartridges.map((c) => c.key),
          // See the note on addPowder: the units come off the queued bench.
          units: current.units,
        }),
        () => {
          // ⚠️ benchBulletName(), THE CHIP'S OWN WORDS — the fourth surface on
          // the same helper as the chip, its × and the removal toast. A bullet
          // is a calibre and a weight, so `.308" 150 gr added to your bench` is
          // a sentence the member can match to the row they just tapped AND to
          // the chip that appears on the rail a moment later.
          //
          // Spelled here by hand it drifted: the toast said `150 gr` where the
          // chip said `no calibre 150 gr`, and a confirmation the member cannot
          // match to the chip they are looking at is not a confirmation.
          say(
            `${benchBulletName({ weightGr: b.weightGr, calibreIn: b.calibreIn })} added to your bench`,
          );
        },
        (e) => fail(e, 'PUT /bench/me'),
      );
      setStack(NO_OVERLAY);
    },
    [writeBench, say, fail],
  );

  const addCartridge = useCallback(
    (c: BenchCartridgeOption) => {
      writeBench(
        (current) => ({
          powderIds: current.powders.map((p) => p.id),
          bullets: current.bullets,
          cartridgeKeys: [...current.cartridges.map((x) => x.key), c.key],
          // See the note on addPowder: the units come off the queued bench.
          units: current.units,
        }),
        () => say(`${c.name} added to your bench`),
        (e) => fail(e, 'PUT /bench/me'),
      );
      setStack(NO_OVERLAY);
    },
    [writeBench, say, fail],
  );

  /**
   * Takes one entry OFF THE BENCH, for good.
   *
   * ⚠️ THIS IS THE OTHER HALF OF `toggleOff`, AND ONLY THIS ONE WRITES.
   * Toggling takes a chip off the shelf for the current search and saves
   * nothing; this deletes it from the saved bench. Two acts, two controls on
   * the chip, two functions here — a single "onChipClick" that decided between
   * them from a modifier key is how a member loses a shelf entry they meant to
   * grey out for a minute.
   *
   * 🚨 AND IT SENDS THE WHOLE BENCH MINUS THE ONE ENTRY. PUT /bench/me replaces
   * rather than merges, so a body carrying only the axis being edited would
   * clear the other two — removing one bullet would take every powder and every
   * cartridge with it, and nothing would error, because an empty bench is a
   * legal bench. The two untouched axes are passed through whole and
   * deliberately: BulletPicker.spec.tsx asserts exactly that.
   */
  const removeFromBench = useCallback(
    (kind: keyof OffState, id: string) => {
      // Named as the write is built, not when the tap landed: by the time this
      // write's turn comes the shelf may already have changed, and once the
      // server answers the bench that comes back no longer holds the thing the
      // toast has to name.
      let gone: string | undefined;

      writeBench(
        (current) => {
          gone =
            kind === 'powderIds'
              ? current.powders.find((p) => p.id === id)?.name
              : kind === 'bullets'
                ? current.bullets.filter((b) => bulletKey(b) === id).map(benchBulletName)[0]
                : current.cartridges.find((c) => c.key === id)?.name;

          // Nothing on the bench answers to that id — a double tap on the ×,
          // most likely, now that the first tap's write has already landed.
          // Writing the bench back unchanged would toast a removal that never
          // happened.
          if (!gone) return null;

          // ⚠️ ONLY THE NAMED AXIS IS FILTERED. Matching `id` against all three
          // would make the write depend on ids from different namespaces never
          // colliding — true today, and not a thing to hang a delete on.
          return {
            powderIds: (kind === 'powderIds'
              ? current.powders.filter((p) => p.id !== id)
              : current.powders
            ).map((p) => p.id),
            bullets:
              kind === 'bullets'
                ? current.bullets.filter((b) => bulletKey(b) !== id)
                : current.bullets,
            cartridgeKeys: (kind === 'cartridgeKeys'
              ? current.cartridges.filter((c) => c.key !== id)
              : current.cartridges
            ).map((c) => c.key),
            // See the note on addPowder: the units come off the queued bench.
            units: current.units,
          };
        },
        () => {
          // ⚠️ THE `off` ENTRY GOES WITH IT. `off` is keyed by these same ids,
          // and a stale one is not harmless: re-adding the same bullet later
          // would bring it back switched OFF, which reads as the Add being
          // broken rather than as a leftover.
          setOff((prev) =>
            prev[kind].includes(id)
              ? { ...prev, [kind]: prev[kind].filter((x) => x !== id) }
              : prev,
          );
          // The toolbar filter can be pointing at the cartridge that just left,
          // and a filter pinned to something the bench no longer holds returns
          // nothing for ever with no chip on screen to explain why.
          if (kind === 'cartridgeKeys') setCartridge((cur) => (cur === id ? 'all' : cur));
          say(`${gone} removed from your bench`);
        },
        // Nothing was removed locally first, so a failed write leaves the chip
        // where it was and the toast says why.
        (e) => fail(e, 'PUT /bench/me'),
      );
    },
    [writeBench, say, fail],
  );

  const saveLog = useCallback(
    (draft: LogDraft) => {
      setSaving(true);
      setSaveError(null);
      benchApi
        .addLog(token, draft as unknown as Record<string, unknown>)
        .then((entry) => {
          setSaving(false);
          /**
           * 🚨 CLOSE THE SHEET; DO NOT OPEN ANYTHING. This used to be
           * `setOverlay('load')` — an instruction rather than a question — so
           * a save that landed after the member had closed the sheet, the card
           * and gone back to the list re-opened a load card over the finder,
           * seconds later, with no tap of theirs behind it. Asking the stack
           * instead makes the late case a no-op: `closeOverlay` on a kind that
           * is no longer open returns the stack it was given.
           */
          setStack((s) => closeOverlay(s, 'log'));
          // The badge is kept current without a second round trip; the entry
          // the server just wrote is exactly the row the log list would show.
          if (entry) setEntries((prev) => [entry, ...prev]);
          setLogBump(true);
          say(
            `Logged · ${openLoad?.group.cartridge.name ?? ''} · ${draft.powderName} ${draft.chargeGr} gr`,
          );
        })
        .catch((e: unknown) => {
          if (isAbort(e)) return;
          setSaving(false);
          console.error('[bench] POST /bench/log', e);
          // The sheet prints this one inline, beside the form the member can
          // still fix — so it is the fixed copy, not the response body.
          setSaveError(benchErrorCopy(e));
        });
    },
    [token, openLoad, say],
  );

  /**
   * ⚠️ THE PROMISE IS RETURNED, NOT SWALLOWED. LogList removes the row
   * optimistically and puts it back when this rejects — which it can only do
   * if it is handed something to wait on. Returning void left the row gone
   * from the screen and present on the server, with nothing said.
   */
  const deleteLog = useCallback(
    (id: string) => {
      const before = entries;
      setEntries((prev) => prev.filter((e) => e.id !== id));
      return benchApi.deleteLog(token, id).catch((e: unknown) => {
        // Put the list back as it was rather than refetching: a refetch would
        // race the list's own revert and could leave the row in twice.
        setEntries(before);
        console.error('[bench] DELETE /bench/log/:id', e);
        throw e;
      });
    },
    [token, entries],
  );

  /**
   * The log, fetched once so the button can carry a count.
   *
   * ⚠️ SPEC §7 GIVES THE LOAD LOG BUTTON A RED COUNT BADGE, and entries were
   * only ever fetched when the list was opened — so the badge could not exist:
   * the one number it needed was the one thing the page had not asked for.
   * There is no count endpoint, so this is the list itself, read once; every
   * later change (a save, a delete, an edit) is applied to this same array
   * rather than refetched.
   */
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const mine = ++logSeq.current;
    const ac = new AbortController();
    benchApi
      .log(token, { signal: ac.signal })
      .then((rows) => {
        if (mine !== logSeq.current) return;
        setEntries(rows);
      })
      .catch(() => {
        // Silent: a badge that cannot be drawn is not worth a toast on a page
        // the member opened to look at loads.
      });
    return () => ac.abort();
  }, [isLoaded, isSignedIn, token]);

  /* ── The permalink ─────────────────────────────────────────────────── */

  /**
   * Copy a link to this exact search.
   *
   * ⚠️ THE BENCH SNAPSHOT IS NAMES AND IDS, NOT THE WHOLE SHELF OBJECT. The
   * server caps a share at 8 KB, and what the far end needs is only enough to
   * work out which of ITS OWN chips to mute — see offFromSnapshot.
   *
   * ⚠️ AND THE CLIPBOARD IS NOT ALWAYS THERE. `navigator.clipboard` is absent
   * on an insecure origin and can be refused outright, and a "Permalink
   * copied" over an empty clipboard is worse than no button: the member pastes
   * nothing into a message and does not find out until the other end says so.
   * The fallback prints the URL, which can at least be read off the screen.
   */
  const copyLink = useCallback(() => {
    const payload: BenchSharePayload = {
      filters: { cartridge, weight, tolerance, off },
      bench: bench
        ? {
            powders: bench.powders.map((p) => ({ id: p.id, name: p.name })),
            bullets: bench.bullets.map((b) => ({
              weightGr: b.weightGr,
              calibreIn: b.calibreIn ?? null,
            })),
            cartridges: bench.cartridges.map((c) => ({ key: c.key, name: c.name })),
          }
        : undefined,
    };

    benchApi
      .share(token, payload)
      .then(async ({ url }) => {
        try {
          await navigator.clipboard.writeText(url);
          say('Permalink copied');
        } catch {
          say(`Link: ${url}`);
        }
      })
      .catch((e: unknown) => fail(e, 'POST /bench/share'));
  }, [token, cartridge, weight, tolerance, off, bench, say, fail]);

  useEffect(() => {
    if (!logBump) return;
    const t = setTimeout(() => setLogBump(false), 700);
    return () => clearTimeout(t);
  }, [logBump]);

  /**
   * 🚨 THE CARD'S SUBJECT GOES WITH THE CARD. `openLoad` was set on every row
   * tap and cleared by nothing, so it outlived the card by the whole rest of
   * the sitting — and every later `openLoad ? …` test read a load the member
   * had finished with. Tied to the stack it cannot get out of step: the row
   * that owns the card is dropped the moment the card is.
   */
  useEffect(() => {
    if (!hasOverlay(stack, 'load')) setOpenLoad(null);
  }, [stack]);

  /* ── Render ────────────────────────────────────────────────────────── */

  if (!isLoaded) return null;

  /**
   * Signed out, and Clerk has finished saying so.
   *
   * 🚨 WITHOUT THIS THE PAGE SHOWS SIX SKELETON ROWS FOR EVER. `loading`
   * starts true and only the bench effect clears it, and that effect returns
   * immediately when there is no session — so a member whose session expired
   * mid-sitting, or who followed a shared link cold, sat watching a loading
   * state that could never finish, with no error and nothing to press.
   */
  if (isLoaded && !isSignedIn) {
    return (
      <main className="bench mx-auto px-4" style={{ maxWidth: 'var(--page-max)' }}>
        <div
          className="gg-tile"
          style={{
            margin: '32px auto',
            maxWidth: 460,
            padding: 24,
            border: '0.5px solid var(--border)',
            borderRadius: 'var(--r-md)',
            background: 'var(--bg-card)',
            textAlign: 'center',
          }}
        >
          <h1 className="head" style={{ margin: '0 0 8px', fontSize: 20 }}>
            The Bench
          </h1>
          <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
            Your bench — the powders, bullets and cartridges you keep — is yours alone. Sign in to
            see what it can build.
          </p>
          <Link
            href="/sign-in?redirect_url=/bench"
            className="btn red"
            style={{ display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 16px' }}
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (benchError) {
    return (
      <main className="bench mx-auto px-4" style={{ maxWidth: 'var(--page-max)' }}>
        {/* ⚠️ `benchError` IS ALREADY THE FIXED COPY — benchErrorCopy maps the
            status and drops the response body. Never interpolate a raw
            message here. */}
        <p style={{ padding: 24, color: 'var(--text-secondary)' }}>{benchError}</p>
      </main>
    );
  }

  const toolbar = (
    <div
      className="bench-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        flex: '0 0 auto',
        /**
         * ⚠️ min-height, NOT height. The bar wraps — that is what `flexWrap`
         * is for — and a fixed 64px meant the second row of pills was drawn
         * OUTSIDE the box, over the top of the results, from about 1300px
         * down. A wrapping row can only be given a floor.
         */
        minHeight: 64,
        borderBottom: '0.5px solid var(--border-divider)',
      }}
    >
      {/*
        ⚠️ GATED IN CSS ON html[data-standalone], NOT ON THE HOOK. The hook's
        server snapshot is always false, so an installed app renders the title
        on the first frame and drops it on hydration — a visible jump on the
        one layout that has its own push header above it saying the same words.
        The attribute is stamped before paint by the script in app/layout.tsx.
      */}
      <h1 className="head bench-h1" style={{ margin: 0, fontSize: 28, lineHeight: 1 }}>
        The Bench
      </h1>
      <Seg
        label="Cartridge filter"
        options={cartridgeOptions}
        value={cartridge}
        onChange={setCartridge}
        size={phone ? 'mobile' : 'desktop'}
      />
      <Seg
        label="Weight"
        options={WEIGHT_BANDS}
        value={weight}
        onChange={setWeight}
        size={phone ? 'mobile' : 'desktop'}
      />
      {/*
        ⚠️ BOTH OF THESE ACT ON THE LOAD'S OWN BULLET WEIGHT, AND THEY AND.
        The band above is a bound on the weights SHOWN — "150 gr +" hides every
        lighter load, whichever bench bullet found it. This one is a width
        around each bench bullet's weight. So a 150 gr shelf bullet at ± 15 gr
        under the "100–150 gr" band returns 135 to 150, not 135 to 165: the
        band cuts the window, it does not pick which bullets are searched with.

        ⚠️ THE NAME DESCRIBES THE SEARCH, AND ONLY THE SEARCH. "Bullet weight
        window" is what a reader hears, and "± 5 gr" is what the pill says: a
        width of bullets the finder will SHOW. Nothing here may be named in a
        way that suggests a charge travels between weights — every load that
        comes back carries its own bullet weight and its own charges, and the
        results group them by that weight for exactly this reason.
      */}
      <Seg
        label="Bullet weight window"
        options={toleranceOptions}
        value={String(tolerance)}
        onChange={(id) => setTolerance(Number(id))}
        size={phone ? 'mobile' : 'desktop'}
      />
      {/*
        ⚠️ THE ARGUMENT FOR THE WINDOW LIVED ONLY IN CODE COMMENTS. The pills
        say "± 5 gr" and nothing on the screen said what widening one does — so
        a reloader could reasonably read it as a licence to move a charge
        between weights, which is the one thing it must never mean. Both halves
        are in the sentence deliberately: what it shows, and what each load
        keeps.
      */}
      <span
        className="hidden md:inline"
        style={{ color: 'var(--text-tertiary)', fontSize: 11.5, maxWidth: 220, lineHeight: 1.3 }}
      >
        shows nearby weights; each load keeps its own charges
      </span>
      <Seg
        label="Units"
        options={[
          { id: 'metric', label: 'mm' },
          { id: 'imperial', label: 'inch' },
        ]}
        value={units}
        onChange={changeUnits}
        size={phone ? 'mobile' : 'desktop'}
      />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {/*
          🚨 lg, NOT md — IT HAS TO MATCH THE RAIL, WHICH IS `hidden lg:block`.
          At md the button was already hidden and the rail had not yet
          appeared, so between 768px and 1023px — an iPad in portrait — the
          bench was unreachable: no chips to toggle, no ×, no way to take
          anything off a shelf at all. The two breakpoints are one decision and
          must be changed together.
        */}
        <Btn
          className="lg:hidden"
          size={phone ? 'mobile' : 'desktop'}
          onClick={() => setStack(onlyOverlay('bench'))}
        >
          My bench
        </Btn>
        <Btn size={phone ? 'mobile' : 'desktop'} onClick={copyLink}>
          Copy link
        </Btn>
        <Btn
          className={cx(logBump && 'bump')}
          size={phone ? 'mobile' : 'desktop'}
          onClick={openLogList}
          // The badge is a glyph to a reader; the count belongs in the name.
          aria-label={
            entries.length > 0
              ? `Load log, ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
              : 'Load log'
          }
        >
          Load log
          {/*
            SPEC §7: "has entries → red count badge". The count comes from the
            log fetched once on mount and is kept current by every save, delete
            and edit — never refetched for the badge alone.
          */}
          {entries.length > 0 ? (
            <span className="bench-badge" aria-hidden="true">
              {entries.length > 99 ? '99+' : entries.length}
            </span>
          ) : null}
        </Btn>
      </div>
    </div>
  );

  return (
    /**
     * ⚠️ THE PAGE ITSELF DOES NOT SCROLL — SPEC §5.4 AND BEHAVIOUR §6. The tool
     * bar and the rail scrolled away with the list, so on a three-hundred-row
     * answer the member had to scroll back to the top to change a filter or
     * take a chip off. `.bench-shell` / `.bench-row` in bench.css put the
     * bound on the ROW and let ResultsList's own panel do the scrolling.
     *
     * ⚠️ 100dvh IN THE INSTALLED APP, AND dvh RATHER THAN vh. Mobile Safari's
     * vh is the tallest the viewport ever gets, so the last inch of a vh-tall
     * column sits behind the browser's own bar.
     */
    <main
      className="bench bench-shell mx-auto px-4"
      style={{ maxWidth: 'var(--page-max)', ...(standalone ? { height: '100dvh' } : null) }}
    >
      {toolbar}

      <div className="bench-row">
        {bench && (
          <div
            className="bench-rail-col hidden lg:block"
            style={{ width: 280, flex: '0 0 280px' }}
          >
            <BenchRail
              bench={bench}
              off={off}
              onToggle={toggleOff}
              onRemove={removeFromBench}
              onAddPowder={openPowders}
              onAddBullet={openBullets}
              onAddCartridge={openCartridges}
            />
          </div>
        )}

        <div className="bench-results-col">
          <ResultsList
            units={units}
            result={result}
            loading={loading}
            error={error}
            gaps={gaps}
            shelf={shelf}
            onRetry={search}
            onReset={resetFilters}
            onAddPowder={openPowders}
            onAddBullet={openBullets}
            onAddCartridge={openCartridges}
            // ⚠️ ONE ARGUMENT REACHES IT. ResultsList calls this with the
            // cartridge key alone, so the `how` default ('only') applies — a
            // group header opens the spec card on its own and closes onto the
            // finder, which is the whole of C1.
            onOpenSpec={openSpec}
            // 🚨 THE WEIGHT COMES FROM THE ROW, NOT FROM A SEARCH BACK THROUGH
            // THE GROUP. It is the load's own bullet weight, and the card and
            // the log sheet print it beside the charge. Re-derived here it had
            // a `?? 0` on the end of it — and now that a ± gr window draws
            // several weight groups per cartridge, a miss would print a real
            // charge under a weight nobody worked it up at.
            onOpenLoad={(row, group, weightGr) => {
              setOpenLoad({ row, group, weightGr });
              setStack(onlyOverlay('load'));
            }}
          />
        </div>
      </div>

      {bench && (
        <BenchSheet
          open={hasOverlay(stack, 'bench')}
          onClose={() => setStack((s) => closeOverlay(s, 'bench'))}
          bench={bench}
          off={off}
          onToggle={toggleOff}
          onRemove={removeFromBench}
          onAddPowder={openPowders}
          onAddBullet={openBullets}
          onAddCartridge={openCartridges}
        />
      )}

      {/*
        🚨 BOTH ARE MOUNTED, AND THAT IS THE POINT. BEHAVIOUR §12: "the log
        sheet opens over the load card. Escape closes only the top one, and
        closing returns focus to whatever opened it." With one overlay value
        the sheet REPLACED the card — the card unmounted, so its focus return
        fired into a dialog that was still open, and Escape closed the whole
        pair. Mount order is stacking order, and OverlayShell's own stack
        (primitives.tsx) reads exactly that to decide who owns the key.
      */}
      {hasOverlay(stack, 'load') && openLoad && (
        <LoadCard
          units={units}
          row={openLoad.row}
          cartridge={openLoad.group.cartridge}
          weightGr={openLoad.weightGr}
          onClose={() => setStack((s) => closeOverlay(s, 'load'))}
          onLog={() => setStack((s) => pushOverlay(s, 'log'))}
          // 'over': opened from the card, so Close comes back to the card.
          onSpec={() => openSpec(openLoad.group.cartridge.key, 'over')}
        />
      )}

      {hasOverlay(stack, 'spec') && (
        <SpecCard
          units={units}
          spec={spec}
          loading={specLoading}
          error={specError}
          /*
           * ⚠️ THE HEADER, BEFORE THE FETCH — SPEC §7. Only when the card was
           * opened FROM a group whose cartridge this actually is: `specKey`
           * moves the moment a shell-holder chip swaps the card, and the old
           * group's name printed over the new cartridge's drawing would be a
           * confident, wrong header on a page of measurements.
           */
          {...(openLoad && openLoad.group.cartridge.key === specKey
            ? {
                name: openLoad.group.cartridge.name,
                type: null,
                origin: null,
                year: null,
              }
            : null)}
          /*
           * ⚠️ CLOSES ONTO WHATEVER IS UNDERNEATH, WHICH THE STACK ALREADY
           * KNOWS. This used to read `setOverlay(openLoad ? 'load' : null)`,
           * and `openLoad` was never cleared — so closing a spec card opened
           * from a group header brought back the last load card the member had
           * looked at, minutes earlier, for a different cartridge.
           */
          onClose={() => setStack((s) => closeOverlay(s, 'spec'))}
          onUnitsChange={changeUnits}
          onShowOnly={(key) => {
            setCartridge(key);
            setStack(NO_OVERLAY);
          }}
          // A same-head chip swaps this card for that cartridge's — never
          // stacks, or six chips followed is six Escapes back to the finder.
          onOpenCartridge={(key) => openSpec(key, 'replace')}
          // Retry asks again for the SAME cartridge and leaves the stack alone.
          onRetry={specKey ? () => openSpec(specKey, 'keep') : undefined}
          onToast={say}
        />
      )}

      {hasOverlay(stack, 'log') && openLoad && (
        <LogSheet
          units={units}
          row={openLoad.row}
          cartridge={openLoad.group.cartridge}
          weightGr={openLoad.weightGr}
          saving={saving}
          error={saveError}
          onClose={() => setStack((s) => closeOverlay(s, 'log'))}
          onSave={saveLog}
        />
      )}

      {hasOverlay(stack, 'logList') && (
        <LogList
          units={units}
          entries={entries}
          loading={logLoading}
          onClose={() => setStack((s) => closeOverlay(s, 'logList'))}
          onDelete={deleteLog}
          // The page's copy of the row follows the server's, so the badge and
          // a later reopen both show what was actually saved.
          onUpdated={(entry) =>
            setEntries((prev) => prev.map((e) => (e.id === entry.id ? entry : e)))
          }
          onError={(message) => setToast({ text: message, tone: 'error' })}
        />
      )}

      <BulletPicker
        open={hasOverlay(stack, 'bullets')}
        bullets={bullets}
        loading={bulletsLoading}
        onBench={(bench?.bullets ?? []).map(bulletKey)}
        onClose={() => setStack((s) => closeOverlay(s, 'bullets'))}
        onAdd={addBullet}
      />

      <CartridgePicker
        open={hasOverlay(stack, 'cartridges')}
        cartridges={cartridges}
        loading={cartridgesLoading}
        onBench={(bench?.cartridges ?? []).map((c) => c.key)}
        onClose={() => setStack((s) => closeOverlay(s, 'cartridges'))}
        onAdd={addCartridge}
      />

      <PowderPicker
        open={hasOverlay(stack, 'powders')}
        powders={powders}
        loading={powdersLoading}
        onBench={bench?.powders.map((p) => p.id) ?? []}
        onClose={() => setStack((s) => closeOverlay(s, 'powders'))}
        onAdd={addPowder}
      />

      <Toast message={toast?.text ?? null} tone={toast?.tone} onDone={() => setToast(null)} />
    </main>
  );
}
