'use client';

// LoadDataBrowser — the PRO-gated Load Lab browser over PUBLISHED manual
// load data, organised by calibre. Replaces the retired internal-ballistics
// calculator.
//
//   • Left  — a calibre tree: search box (flat filter) over an accordion of
//              families → cartridges, each with a load-count pill.
//   • Right — the load data for the selected cartridge: one section per bullet
//              weight, each a stack of load cards (powder · charge start→max ·
//              velocity · fill · COAL · primer · manual citation + work-up).
//
// Cartridges are keyed by canonical cartridgeKey (collapses the messy printed
// spellings). Where a key merges more than one printed label (e.g. a 45-70
// pressure tier), each load shows its own `variant` label. Both endpoints are
// PRO-gated; a non-PRO user gets an upgrade nudge. Desktop lays the two columns
// side by side; mobile shows the tree, then swaps to the data once a calibre is
// picked.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CartridgeSpecPanel } from './CartridgeSpecPanel';
import {
  useLoadData,
  type CartridgeLoadsResponse,
  type CartridgeLoadsResult,
  type ManualCartridgesResponse,
  type ManualCartridgesResult,
  type ManualLoadRow,
} from '@/lib/use-load-data';

// ─── Small shared helpers ───────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 8,
};

const pillStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  padding: '1px 6px',
  borderRadius: 999,
  border: '0.5px solid var(--border)',
  color: 'var(--text-tertiary)',
  flexShrink: 0,
};

/** Grains — trim to a clean string (42 not 42.0, 45.5 stays). */
const gr = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

const int = (n: number): string => n.toLocaleString('en-ZA');

/** Desktop ≥ 760px → two columns; below → single column with back nav. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 760px)');
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

function Spinner() {
  return (
    <span
      className="animate-spin"
      aria-hidden
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        border: '2px solid var(--border)',
        borderTopColor: 'var(--red)',
        borderRadius: '50%',
      }}
    />
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...cardStyle,
        padding: '28px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontSize: 13,
        color: 'var(--text-tertiary)',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────

export function LoadDataBrowser() {
  const { listCartridges, loadsFor } = useLoadData();

  const [cartResult, setCartResult] = useState<ManualCartridgesResult | null>(
    null,
  );
  const [initialLoading, setInitialLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loads, setLoads] = useState<CartridgeLoadsResult | null>(null);
  const [loadsLoading, setLoadsLoading] = useState(false);

  const isDesktop = useIsDesktop();

  // Load the calibre hierarchy on mount.
  useEffect(() => {
    let cancelled = false;
    setInitialLoading(true);
    listCartridges().then((r) => {
      if (cancelled) return;
      setCartResult(r);
      setInitialLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [listCartridges]);

  const toggleFamily = useCallback((id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Select a cartridge. We do NOT clear `loads` here — the fetch effect flips
  // loadsLoading (which the panel renders as a spinner), so re-clicking the
  // already-selected row is a harmless no-op instead of a stuck spinner.
  const selectCartridge = useCallback((cartridgeKey: string, name: string) => {
    setSelectedName(name);
    setSelectedKey(cartridgeKey);
  }, []);

  // Fetch the loads whenever the selected cartridge changes.
  useEffect(() => {
    if (!selectedKey) return;
    const ctrl = new AbortController();
    setLoadsLoading(true);
    loadsFor(selectedKey, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setLoads(r);
      setLoadsLoading(false);
    });
    return () => ctrl.abort();
  }, [selectedKey, loadsFor]);

  // ── Top-level states: loading / failed / upgrade-gated ──

  if (initialLoading) {
    return (
      <CenterNote>
        <Spinner /> Loading calibres…
      </CenterNote>
    );
  }
  if (!cartResult) {
    return (
      <CenterNote>Couldn&rsquo;t load the calibre list right now.</CenterNote>
    );
  }
  const data: ManualCartridgesResponse = cartResult;

  const tree = (
    <CalibreTree
      data={data}
      search={search}
      onSearch={setSearch}
      expanded={expanded}
      onToggleFamily={toggleFamily}
      selectedKey={selectedKey}
      onSelect={selectCartridge}
    />
  );

  const dataPanel = (
    <LoadDataPanel
      selectedKey={selectedKey}
      selectedName={selectedName}
      loads={loads}
      loading={loadsLoading}
    />
  );

  // Desktop: tree + data side by side.
  if (isDesktop) {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 280px', minWidth: 0 }}>{tree}</div>
        <div style={{ flex: '1 1 0%', minWidth: 0 }}>{dataPanel}</div>
      </div>
    );
  }

  // Mobile: tree until a calibre is chosen, then the data with a back button.
  if (selectedKey) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          type="button"
          onClick={() => {
            setSelectedKey(null);
            setSelectedName(null);
          }}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 999,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          ← Calibres
        </button>
        {dataPanel}
      </div>
    );
  }
  return tree;
}

// ─── Calibre tree (search + families → cartridges) ──────────────────

function CalibreTree({
  data,
  search,
  onSearch,
  expanded,
  onToggleFamily,
  selectedKey,
  onSelect,
}: {
  data: ManualCartridgesResponse;
  search: string;
  onSearch: (v: string) => void;
  expanded: Set<string>;
  onToggleFamily: (id: string) => void;
  selectedKey: string | null;
  onSelect: (cartridgeKey: string, name: string) => void;
}) {
  const q = search.trim().toLowerCase();

  // Flat matches across every family when searching.
  const flat = useMemo(() => {
    if (!q) return null;
    const out: {
      cartridgeKey: string;
      name: string;
      loadCount: number;
      familyLabel: string;
    }[] = [];
    for (const f of data.families) {
      for (const c of f.cartridges) {
        if (c.name.toLowerCase().includes(q)) {
          out.push({ ...c, familyLabel: f.label });
        }
      }
    }
    return out;
  }, [q, data]);

  return (
    <div
      style={{
        ...cardStyle,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      aria-label="Calibre browser"
    >
      <div>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search a calibre…"
          className="w-full"
          style={{
            width: '100%',
            padding: '8px 11px',
            borderRadius: 8,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            color: 'var(--text-tertiary)',
          }}
        >
          {int(data.totalCartridges)} calibres · {int(data.totalLoads)} published
          loads
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          maxHeight: 560,
          overflowY: 'auto',
        }}
      >
        {flat ? (
          flat.length === 0 ? (
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                padding: '8px 4px',
              }}
            >
              No calibres match &ldquo;{search.trim()}&rdquo;.
            </p>
          ) : (
            flat.map((c) => (
              <CartridgeRow
                key={c.cartridgeKey}
                cartridge={c.name}
                loadCount={c.loadCount}
                subLabel={c.familyLabel}
                selected={selectedKey === c.cartridgeKey}
                onSelect={() => onSelect(c.cartridgeKey, c.name)}
              />
            ))
          )
        ) : (
          data.families.map((f) => {
            const open = expanded.has(f.id);
            return (
              <div key={f.id}>
                <button
                  type="button"
                  onClick={() => onToggleFamily(f.id)}
                  aria-expanded={open}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 12,
                      fontSize: 10,
                      color: 'var(--text-tertiary)',
                      flexShrink: 0,
                    }}
                  >
                    {open ? '▾' : '▸'}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.label}
                  </span>
                  <span style={pillStyle}>{int(f.cartridgeCount)}</span>
                </button>
                {open &&
                  f.cartridges.map((c) => (
                    <CartridgeRow
                      key={c.cartridgeKey}
                      cartridge={c.name}
                      loadCount={c.loadCount}
                      indent
                      selected={selectedKey === c.cartridgeKey}
                      onSelect={() => onSelect(c.cartridgeKey, c.name)}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function CartridgeRow({
  cartridge,
  loadCount,
  selected,
  indent,
  subLabel,
  onSelect,
}: {
  cartridge: string;
  loadCount: number;
  selected: boolean;
  indent?: boolean;
  subLabel?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '7px 10px',
        paddingLeft: indent ? 30 : 10,
        borderRadius: 8,
        border: 'none',
        borderLeft: selected
          ? '2px solid var(--red)'
          : '2px solid transparent',
        background: selected ? 'rgba(200,16,46,0.10)' : 'transparent',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
      }}
    >
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: selected ? 600 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cartridge}
        </span>
        {subLabel && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {subLabel}
          </span>
        )}
      </span>
      <span style={pillStyle}>{int(loadCount)}</span>
    </button>
  );
}

// ─── Load data panel (right column / mobile data view) ──────────────

function LoadDataPanel({
  selectedKey,
  selectedName,
  loads,
  loading,
}: {
  selectedKey: string | null;
  selectedName: string | null;
  loads: CartridgeLoadsResult | null;
  loading: boolean;
}) {
  if (!selectedKey) {
    return (
      <CenterNote>Select a calibre to see its published loads.</CenterNote>
    );
  }
  if (loading || !loads) {
    return (
      <CenterNote>
        <Spinner /> Loading loads{selectedName ? ` for ${selectedName}` : ''}…
      </CenterNote>
    );
  }
  // Renders above whatever the load area shows. Self-hides when we hold no
  // verified spec for the cartridge.
  const specPanel = <CartridgeSpecPanel cartridgeKey={selectedKey} />;
  if (!loads.found || loads.groups.length === 0) {
    return (
      <>
        {specPanel}
        <CenterNote>No published loads for this calibre yet.</CenterNote>
      </>
    );
  }
  // Key by cartridge so the bullet-weight selection resets when the calibre changes.
  return (
    <>
      {specPanel}
      <LoadDataView key={loads.cartridge} data={loads} />
    </>
  );
}

function LoadDataView({ data }: { data: CartridgeLoadsResponse }) {
  const otherLabels = data.variants.filter((v) => v !== data.cartridge);
  // Second-level filter: pick a bullet weight → show only its powder charges.
  // Defaults to the lightest available weight so charges show immediately.
  const [weight, setWeight] = useState<number | 'all'>(
    data.groups[0]?.bulletWeightGr ?? 'all',
  );
  const shownGroups =
    weight === 'all'
      ? data.groups
      : data.groups.filter((g) => g.bulletWeightGr === weight);
  return (
    <section
      aria-label={`Published loads for ${data.cartridge}`}
      style={{
        ...cardStyle,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Header */}
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {data.cartridge}
        </h3>
        <p
          style={{
            margin: '3px 0 0',
            fontSize: 11.5,
            color: 'var(--text-tertiary)',
          }}
        >
          {int(data.totalLoads)} load{data.totalLoads === 1 ? '' : 's'}
          {data.manuals.length > 0 ? ` · from: ${data.manuals.join(', ')}` : ''}
        </p>
        {otherLabels.length > 0 && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 10.5,
              color: 'var(--text-tertiary)',
            }}
          >
            Also published as: {otherLabels.join(', ')} — check the label on each
            load below (pressure tiers can differ).
          </p>
        )}
      </div>

      {/* Safety line — published data is authoritative, but components differ. */}
      <div
        role="note"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--warning)',
          borderRadius: 8,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            fontSize: 16,
            lineHeight: 1.3,
            color: 'var(--warning)',
          }}
        >
          ℹ
        </span>
        <span
          style={{
            fontSize: 12.5,
            lineHeight: 1.45,
            color: 'var(--text-secondary)',
          }}
        >
          Start at the published <strong>START</strong> charge, work up watching
          for pressure, and <strong>never exceed MAX</strong>. Your rifle, brass,
          primers and components differ from the manual&rsquo;s test setup.
        </span>
      </div>

      {/* Bullet-weight selector — narrows to one weight's powder charges. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label
          htmlFor="llb-weight"
          style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}
        >
          Bullet weight
        </label>
        <select
          id="llb-weight"
          value={String(weight)}
          onChange={(e) =>
            setWeight(e.target.value === 'all' ? 'all' : Number(e.target.value))
          }
          style={{
            width: '100%',
            padding: '8px 11px',
            borderRadius: 8,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <option value="all">
            All bullet weights ({int(data.totalLoads)} loads)
          </option>
          {data.groups.map((g) => (
            <option key={g.bulletWeightGr} value={g.bulletWeightGr}>
              {gr(g.bulletWeightGr)} gr — {int(g.loadCount)} load
              {g.loadCount === 1 ? '' : 's'}
              {g.bullets.length > 0 ? ` · ${g.bullets.join(', ')}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* One section per bullet weight (filtered by the selector above) */}
      {shownGroups.map((g) => (
        <div
          key={g.bulletWeightGr}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              flexWrap: 'wrap',
              borderBottom: '0.5px solid var(--border)',
              paddingBottom: 5,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}
            >
              {gr(g.bulletWeightGr)} gr
            </span>
            {g.bullets.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {g.bullets.join(' · ')}
              </span>
            )}
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 10.5,
                color: 'var(--text-tertiary)',
              }}
            >
              {int(g.loadCount)} load{g.loadCount === 1 ? '' : 's'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.loads.map((l, i) => (
              <LoadCard key={i} load={l} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function LoadCard({ load }: { load: ManualLoadRow }) {
  const fill = load.fillPctMax ?? load.fillPctStart;
  const hasVel = load.startVelFps != null || load.maxVelFps != null;
  const powder =
    load.powderMaker && !load.powderName.startsWith(load.powderMaker)
      ? `${load.powderMaker} ${load.powderName}`
      : load.powderName;

  // Meta chips (fill / COAL / primer / work-up) — joined with · below.
  const meta: React.ReactNode[] = [];
  if (fill != null) {
    meta.push(
      <span key="fill">
        case fill {Math.round(fill)}%
        {load.compressed && (
          <span style={{ color: 'var(--red)', fontWeight: 700 }}>
            {' '}
            · compressed
          </span>
        )}
      </span>,
    );
  } else if (load.compressed) {
    meta.push(
      <span key="comp" style={{ color: 'var(--red)', fontWeight: 700 }}>
        compressed
      </span>,
    );
  }
  if (load.coalMm != null)
    meta.push(<span key="coal">COAL {load.coalMm.toFixed(1)} mm</span>);
  if (load.primer) meta.push(<span key="primer">{load.primer}</span>);
  if (load.incrementGr > 0 && load.ladderSteps > 1)
    meta.push(
      <span key="ladder">
        work up in ~{gr(load.incrementGr)} gr, ~{load.ladderSteps} steps
      </span>,
    );

  return (
    <div
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '9px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Variant label — only when this cartridge merges more than one printed
          label (e.g. a pressure tier). */}
      {load.variant && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--warning)',
            textTransform: 'none',
          }}
        >
          {load.variant}
        </div>
      )}

      {/* Powder + charge */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--text-primary)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {powder}
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
          }}
        >
          {gr(load.startGr)} → {gr(load.maxGr)} gr
        </span>
      </div>

      {/* Velocity range */}
      {hasVel && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {load.startVelFps ?? '?'} → {load.maxVelFps ?? '?'} fps
          {load.bulletName ? ` · ${load.bulletName}` : ''}
        </div>
      )}

      {/* Meta chips */}
      {meta.length > 0 && (
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--text-secondary)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {meta.map((m, i) => (
            <span key={i} style={{ display: 'inline-flex', gap: 6 }}>
              {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}>·</span>}
              {m}
            </span>
          ))}
        </div>
      )}

      {/* Citation */}
      <div
        style={{
          fontSize: 10.5,
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}
      >
        {load.manualLabel} p.{load.pageNumber}
      </div>
    </div>
  );
}

