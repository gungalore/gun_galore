'use client';

/**
 * THE BENCH — the page.
 *
 * The only stateful thing in the module: every component under
 * components/bench/ is presentational and receives its data and callbacks from
 * here (see components/bench/contract.ts). One owner means one place where a
 * filter change, a fetch and an overlay can get out of step.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useStandalone } from '@/lib/use-standalone';
import {
  benchApi,
  type BenchPowder,
  type BenchView,
  type CartridgeSpec,
  type LoadGroup,
  type LoadRow,
  type LoadsResponse,
  type LogEntry,
} from '@/lib/bench/api';
import type { Units } from '@/lib/bench/geometry';
import { formatCalibre } from '@/lib/bench/calibre';
import {
  EMPTY_OFF,
  type BenchBulletOption,
  type BenchCartridgeOption,
  WEIGHT_BANDS,
  bulletKey,
  type LogDraft,
  type OffState,
  type ShelfNames,
  type WeightBand,
} from '@/components/bench/contract';
import { Btn, Seg } from '@/components/bench/primitives';
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
 * Which overlay is on top. Only one at a time, except the log sheet, which sits
 * over the load card.
 *
 * ⚠️ 'bench' IS THE PHONE'S BENCH SHEET AND 'powders' IS THE POWDER PICKER —
 * TWO DIFFERENT SURFACES. They shared the one value, so the "My bench" button
 * mounted both: the picker rendered last and therefore on top, over an empty
 * list nothing had fetched, and the bench sheet underneath it was unreachable
 * on a phone. That is also where the remove control lives on a phone, so with
 * one value there was no way to take anything off a bench from one.
 */
type Overlay =
  | null
  | 'bench'
  | 'load'
  | 'spec'
  | 'log'
  | 'logList'
  | 'powders'
  | 'bullets'
  | 'cartridges';

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

export default function BenchPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const standalone = useStandalone();

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

  const [off, setOff] = useState<OffState>(EMPTY_OFF);
  const [cartridge, setCartridge] = useState('all');
  const [weight, setWeight] = useState<WeightBand>('any');
  const [units, setUnits] = useState<Units>('metric');

  const [result, setResult] = useState<LoadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [openLoad, setOpenLoad] = useState<OpenLoad | null>(null);

  const [spec, setSpec] = useState<CartridgeSpec | null>(null);
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

  const [toast, setToast] = useState<string | null>(null);

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
      .catch((e: Error) => live && setBenchError(e.message));
    return () => {
      live = false;
    };
  }, [isLoaded, isSignedIn, token]);

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
   * 🚨 IT GOES TO EVERY BENCH-RELATIVE COUNT, NOT JUST THE LIST. The powder
   * picker's per-powder count and the spec card's "loads on your bench" are
   * answers about the same shelf as the results behind them, and a request
   * that leaves this out does not fail — it silently answers for the full
   * bench and prints a bigger figure over a shorter list.
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
      .loads(token, { cartridge, weight, off: offList })
      .then((r) => {
        if (mine !== seq.current) return;
        setResult(r);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (mine !== seq.current) return;
        setError(e.message);
        setLoading(false);
      });
  }, [isLoaded, isSignedIn, token, cartridge, weight, offList]);

  useEffect(() => {
    if (bench) search();
  }, [bench, search]);

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
      bullets: (bench?.bullets ?? [])
        .filter((b) => !off.bullets.includes(bulletKey(b)))
        .map(benchBulletName),
      cartridges: (bench?.cartridges ?? [])
        .filter((c) => !off.cartridgeKeys.includes(c.key))
        .filter((c) => cartridge === 'all' || c.key === cartridge)
        .map((c) => c.name),
    }),
    [bench, off, cartridge],
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

  const openSpec = useCallback(
    (key: string) => {
      setOverlay('spec');
      setSpec(null);
      setSpecError(null);
      setSpecLoading(true);
      benchApi
        // ⚠️ WITH THE OFF CHIPS. The card's "loads on your bench" is a count
        // against the same shelf as the list it was opened from; sent without
        // them it answers for the full bench and prints a bigger figure over a
        // shorter list, with the greyed-out chip beside it explaining neither.
        .cartridge(token, key, offList)
        .then((s) => {
          setSpec(s);
          setSpecLoading(false);
        })
        .catch((e: Error) => {
          setSpecError(e.message);
          setSpecLoading(false);
        });
    },
    [token, offList],
  );

  const openLogList = useCallback(() => {
    setOverlay('logList');
    setLogLoading(true);
    benchApi
      .log(token)
      .then((rows) => {
        setEntries(rows);
        setLogLoading(false);
      })
      .catch(() => setLogLoading(false));
  }, [token]);

  const openPowders = useCallback(() => {
    setOverlay('powders');
    setPowdersLoading(true);
    benchApi
      // ⚠️ WITH THE OFF CHIPS, for the reason openSpec carries them: each row's
      // count is "how many loads this powder adds to your bench", and the bench
      // it means is the one the member can see, chips and all.
      .powders(token, undefined, offList)
      .then((p) => {
        setPowders(p);
        setPowdersLoading(false);
      })
      .catch(() => setPowdersLoading(false));
  }, [token, offList]);

  const addPowder = useCallback(
    (p: BenchPowder) => {
      writeBench(
        (current) => ({
          powderIds: [...current.powders.map((x) => x.id), p.id],
          bullets: current.bullets,
          cartridgeKeys: current.cartridges.map((c) => c.key),
          units,
        }),
        () => setToast(`${p.name} added to your bench`),
        (e) => setToast(e.message),
      );
      setOverlay(null);
    },
    [writeBench, units],
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
    setOverlay('bullets');
    setBulletsLoading(true);
    benchApi
      .bullets(token)
      .then((b) => {
        setBullets(b);
        setBulletsLoading(false);
      })
      .catch(() => {
        setBulletsLoading(false);
        setToast('The bullet list could not be loaded. Please try again.');
      });
  }, [token]);

  const openCartridges = useCallback(() => {
    setOverlay('cartridges');
    setCartridgesLoading(true);
    benchApi
      .cartridgeList(token)
      .then((c) => {
        setCartridges(c);
        setCartridgesLoading(false);
      })
      .catch(() => {
        setCartridgesLoading(false);
        setToast('The cartridge list could not be loaded. Please try again.');
      });
  }, [token]);

  /**
   * ⚠️ EVERY ADD SENDS THE WHOLE BENCH. PUT /bench/me replaces rather than
   * merges, so a body that omits an axis clears it — adding a bullet with a
   * partial body would wipe the member's powders.
   *
   * 🚨 AND THE CALIBRE TRAVELS WITH THE BULLET. `calibreIn` is part of what a
   * bullet IS — "Hornady 150gr SP" is a .277", a .308", a .311" and a .323"
   * projectile, and they do not swap — so dropping it here would store the
   * member's .308 bullet as a bare "Hornady 150 SP" that bulletKey() then
   * matches against every other calibre of the same name, which is the whole
   * bug. It is copied through verbatim, never re-derived.
   */
  const addBullet = useCallback(
    (b: BenchBulletOption) => {
      writeBench(
        (current) => ({
          powderIds: current.powders.map((p) => p.id),
          bullets: [
            ...current.bullets,
            {
              maker: b.maker,
              weightGr: b.weightGr,
              category: b.category,
              calibreIn: b.calibreIn,
            },
          ],
          cartridgeKeys: current.cartridges.map((c) => c.key),
          units,
        }),
        () => {
          // Named the way the picker named it, calibre first: the member just
          // chose between two rows that differed only there, and a toast that
          // says "Hornady 150gr added" cannot confirm which one they got.
          // filter() rather than a template: a bullet with no calibre would
          // otherwise be toasted with a leading space where a figure belongs.
          const named = [formatCalibre(b.calibreIn), b.maker, `${b.weightGr}gr`]
            .filter(Boolean)
            .join(' ');
          setToast(`${named} added to your bench`);
        },
        (e) => setToast(e.message),
      );
      setOverlay(null);
    },
    [writeBench, units],
  );

  const addCartridge = useCallback(
    (c: BenchCartridgeOption) => {
      writeBench(
        (current) => ({
          powderIds: current.powders.map((p) => p.id),
          bullets: current.bullets,
          cartridgeKeys: [...current.cartridges.map((x) => x.key), c.key],
          units,
        }),
        () => setToast(`${c.name} added to your bench`),
        (e) => setToast(e.message),
      );
      setOverlay(null);
    },
    [writeBench, units],
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
            units,
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
          setToast(`${gone} removed from your bench`);
        },
        // Nothing was removed locally first, so a failed write leaves the chip
        // where it was and the toast says why.
        (e) => setToast(e.message),
      );
    },
    [writeBench, units],
  );

  const saveLog = useCallback(
    (draft: LogDraft) => {
      setSaving(true);
      setSaveError(null);
      benchApi
        .addLog(token, draft as unknown as Record<string, unknown>)
        .then(() => {
          setSaving(false);
          setOverlay('load');
          setLogBump(true);
          setToast(
            `Logged · ${openLoad?.group.cartridge.name ?? ''} · ${draft.powderName} ${draft.chargeGr} gr`,
          );
        })
        .catch((e: Error) => {
          setSaving(false);
          setSaveError(e.message);
        });
    },
    [token, openLoad],
  );

  const deleteLog = useCallback(
    (id: string) => {
      // Removed from the list first: the row is the member's own and the call
      // is a delete, so waiting on the round-trip only makes it feel broken.
      setEntries((prev) => prev.filter((e) => e.id !== id));
      benchApi.deleteLog(token, id).catch(() => openLogList());
    },
    [token, openLogList],
  );

  useEffect(() => {
    if (!logBump) return;
    const t = setTimeout(() => setLogBump(false), 700);
    return () => clearTimeout(t);
  }, [logBump]);

  /* ── Render ────────────────────────────────────────────────────────── */

  if (!isLoaded) return null;

  if (benchError) {
    return (
      <main className="bench mx-auto px-4" style={{ maxWidth: 'var(--page-max)' }}>
        <p style={{ padding: 24, color: 'var(--text-secondary)' }}>
          Your bench could not be loaded. {benchError}
        </p>
      </main>
    );
  }

  const toolbar = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        height: standalone ? undefined : 64,
        borderBottom: '0.5px solid var(--border-divider)',
      }}
    >
      {!standalone && (
        <h1 className="head" style={{ margin: 0, fontSize: 28, lineHeight: 1 }}>
          The Bench
        </h1>
      )}
      <Seg
        label="Cartridge filter"
        options={cartridgeOptions}
        value={cartridge}
        onChange={setCartridge}
      />
      <Seg
        label="Weight"
        options={WEIGHT_BANDS}
        value={weight}
        onChange={setWeight}
      />
      <Seg
        label="Units"
        options={[
          { id: 'metric', label: 'mm' },
          { id: 'imperial', label: 'inch' },
        ]}
        value={units}
        onChange={changeUnits}
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
        <Btn className="lg:hidden" onClick={() => setOverlay('bench')}>
          My bench
        </Btn>
        <Btn className={logBump ? 'bump' : undefined} onClick={openLogList}>
          Load log
        </Btn>
      </div>
    </div>
  );

  return (
    <main className="bench mx-auto px-4" style={{ maxWidth: 'var(--page-max)' }}>
      {toolbar}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {bench && (
          <div className="hidden lg:block" style={{ width: 280, flex: '0 0 280px' }}>
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

        <div style={{ flex: 1, minWidth: 0 }}>
          <ResultsList
            units={units}
            result={result}
            loading={loading}
            error={error}
            gaps={gaps}
            shelf={shelf}
            onRetry={search}
            onAddPowder={openPowders}
            onAddBullet={openBullets}
            onAddCartridge={openCartridges}
            onOpenSpec={openSpec}
            onOpenLoad={(row, group) => {
              const weightGr =
                group.weights.find((w) => w.rows.some((r) => r.id === row.id))?.weightGr ?? 0;
              setOpenLoad({ row, group, weightGr });
              setOverlay('load');
            }}
          />
        </div>
      </div>

      {bench && (
        <BenchSheet
          open={overlay === 'bench'}
          onClose={() => setOverlay(null)}
          bench={bench}
          off={off}
          onToggle={toggleOff}
          onRemove={removeFromBench}
          onAddPowder={openPowders}
          onAddBullet={openBullets}
          onAddCartridge={openCartridges}
        />
      )}

      {overlay === 'load' && openLoad && (
        <LoadCard
          units={units}
          row={openLoad.row}
          cartridge={openLoad.group.cartridge}
          weightGr={openLoad.weightGr}
          onClose={() => setOverlay(null)}
          onLog={() => setOverlay('log')}
          onSpec={() => openSpec(openLoad.group.cartridge.key)}
        />
      )}

      {overlay === 'spec' && (
        <SpecCard
          units={units}
          spec={spec}
          loading={specLoading}
          error={specError}
          onClose={() => setOverlay(openLoad ? 'load' : null)}
          onUnitsChange={changeUnits}
          onShowOnly={(key) => {
            setCartridge(key);
            setOverlay(null);
          }}
        />
      )}

      {overlay === 'log' && openLoad && (
        <LogSheet
          units={units}
          row={openLoad.row}
          cartridge={openLoad.group.cartridge}
          weightGr={openLoad.weightGr}
          saving={saving}
          error={saveError}
          onClose={() => setOverlay('load')}
          onSave={saveLog}
        />
      )}

      {overlay === 'logList' && (
        <LogList
          units={units}
          entries={entries}
          loading={logLoading}
          onClose={() => setOverlay(null)}
          onDelete={deleteLog}
        />
      )}

      <BulletPicker
        open={overlay === 'bullets'}
        bullets={bullets}
        loading={bulletsLoading}
        onBench={(bench?.bullets ?? []).map(bulletKey)}
        onClose={() => setOverlay(null)}
        onAdd={addBullet}
      />

      <CartridgePicker
        open={overlay === 'cartridges'}
        cartridges={cartridges}
        loading={cartridgesLoading}
        onBench={(bench?.cartridges ?? []).map((c) => c.key)}
        onClose={() => setOverlay(null)}
        onAdd={addCartridge}
      />

      <PowderPicker
        open={overlay === 'powders'}
        powders={powders}
        loading={powdersLoading}
        onBench={bench?.powders.map((p) => p.id) ?? []}
        onClose={() => setOverlay(null)}
        onAdd={addPowder}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </main>
  );
}
