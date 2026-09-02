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
import {
  EMPTY_OFF,
  type BenchBulletOption,
  type BenchCartridgeOption,
  WEIGHT_BANDS,
  bulletKey,
  type LogDraft,
  type OffState,
  type WeightBand,
} from '@/components/bench/contract';
import { Btn, Seg } from '@/components/bench/primitives';
import BenchRail from '@/components/bench/BenchRail';
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

/** Which overlay is on top. Only one at a time, except the log sheet, which sits over the load card. */
type Overlay = null | 'load' | 'spec' | 'log' | 'logList' | 'powders' | 'bullets' | 'cartridges';

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
        setBench(b);
        setUnits(b.units === 'imperial' ? 'imperial' : 'metric');
      })
      .catch((e: Error) => live && setBenchError(e.message));
    return () => {
      live = false;
    };
  }, [isLoaded, isSignedIn, token]);

  /* ── The results ───────────────────────────────────────────────────── */

  /**
   * ⚠️ STALE RESPONSES ARE DROPPED BY SEQUENCE, NOT BY UNMOUNT. Toggling three
   * chips quickly fires three searches, and they can land out of order — the
   * cheapest query often answers last. Without this the member sees the result
   * of a filter they have already changed, which reads as the filter being
   * broken rather than slow.
   */
  const seq = useRef(0);

  const search = useCallback(() => {
    if (!isLoaded || !isSignedIn) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    benchApi
      .loads(token, {
        cartridge,
        weight,
        off: [...off.powderIds, ...off.cartridgeKeys, ...off.bullets],
      })
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
  }, [isLoaded, isSignedIn, token, cartridge, weight, off]);

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
  }, []);

  const cartridgeOptions = useMemo(
    () => [
      { id: 'all', label: 'All' },
      ...(bench?.cartridges ?? []).map((c) => ({ id: c.key, label: c.name })),
    ],
    [bench],
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

  /* ── Units ─────────────────────────────────────────────────────────── */

  const changeUnits = useCallback(
    (next: Units) => {
      setUnits(next);
      if (!bench) return;
      // The whole bench goes with it: PUT replaces rather than merges, so
      // sending units alone would clear the shelf.
      benchApi
        .saveBench(token, {
          powderIds: bench.powders.map((p) => p.id),
          bullets: bench.bullets,
          cartridgeKeys: bench.cartridges.map((c) => c.key),
          units: next,
        })
        .then(setBench)
        .catch(() => {
          // A preference that failed to save is not worth interrupting for —
          // it stays applied for this sitting.
        });
    },
    [bench, token],
  );

  /* ── Overlays ──────────────────────────────────────────────────────── */

  const openSpec = useCallback(
    (key: string) => {
      setOverlay('spec');
      setSpec(null);
      setSpecError(null);
      setSpecLoading(true);
      benchApi
        .cartridge(token, key)
        .then((s) => {
          setSpec(s);
          setSpecLoading(false);
        })
        .catch((e: Error) => {
          setSpecError(e.message);
          setSpecLoading(false);
        });
    },
    [token],
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
      .powders(token)
      .then((p) => {
        setPowders(p);
        setPowdersLoading(false);
      })
      .catch(() => setPowdersLoading(false));
  }, [token]);

  const addPowder = useCallback(
    (p: BenchPowder) => {
      if (!bench) return;
      const next = {
        powderIds: [...bench.powders.map((x) => x.id), p.id],
        bullets: bench.bullets,
        cartridgeKeys: bench.cartridges.map((c) => c.key),
        units,
      };
      benchApi
        .saveBench(token, next)
        .then((b) => {
          setBench(b);
          setToast(`${p.name} added to your bench`);
        })
        .catch((e: Error) => setToast(e.message));
      setOverlay(null);
    },
    [bench, token, units],
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
   */
  const addBullet = useCallback(
    (b: BenchBulletOption) => {
      if (!bench) return;
      benchApi
        .saveBench(token, {
          powderIds: bench.powders.map((p) => p.id),
          bullets: [
            ...bench.bullets,
            { maker: b.maker, weightGr: b.weightGr, category: b.category },
          ],
          cartridgeKeys: bench.cartridges.map((c) => c.key),
          units,
        })
        .then((next) => {
          setBench(next);
          setToast(`${b.maker} ${b.weightGr}gr added to your bench`);
        })
        .catch((e: Error) => setToast(e.message));
      setOverlay(null);
    },
    [bench, token, units],
  );

  const addCartridge = useCallback(
    (c: BenchCartridgeOption) => {
      if (!bench) return;
      benchApi
        .saveBench(token, {
          powderIds: bench.powders.map((p) => p.id),
          bullets: bench.bullets,
          cartridgeKeys: [...bench.cartridges.map((x) => x.key), c.key],
          units,
        })
        .then((next) => {
          setBench(next);
          setToast(`${c.name} added to your bench`);
        })
        .catch((e: Error) => setToast(e.message));
      setOverlay(null);
    },
    [bench, token, units],
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
        <Btn className="md:hidden" onClick={() => setOverlay('powders')}>
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
          open={overlay === 'powders' && !!bench}
          onClose={() => setOverlay(null)}
          bench={bench}
          off={off}
          onToggle={toggleOff}
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
