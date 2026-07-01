'use client';

// PowderBurnChart — the cross-manufacturer powder burn-rate chart on the Load
// Lab page (Vihtavuori chart + researched Somchem placements). Powders are laid
// out in maker columns and positioned vertically by burn rate (fast at top,
// slow at bottom); equivalent-burn-rate powders line up across columns.
//
// Interactions:
//   • Hover a powder (that we hold published loads for) → a floating, scrollable
//     list of the top 15 cartridges it's used in, with the bullet-weight range,
//     pinned next to the cursor. Stays open while the pointer is on the cell or
//     the list, so it can be scrolled; closes when the pointer leaves.
//   • Search a cartridge (Meilisearch typeahead) → highlights every powder we
//     hold a published load for in that cartridge.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface ChartPowder {
  id: string;
  maker: string;
  name: string;
  key: string;
  yNorm: number;
  somchem?: boolean;
  approx?: boolean;
  anchors?: string[];
  hasLoads: boolean;
  cartridgeCount: number;
  loadCount: number;
}
interface Chart {
  source: string;
  note: string;
  makers: string[];
  powders: ChartPowder[];
}
interface PowderCartridge {
  cartridge: string;
  minWeightGr: number;
  maxWeightGr: number;
  loadCount: number;
}
interface CartridgeHit {
  cartridgeKey: string;
  name: string;
}

const COL_W = 122; // px per maker column
const COL_GAP = 10;
const HEADER_H = 34; // sticky maker-name row
const TRACK_H = 1680; // burn-rate axis height (px), yNorm 0..1 maps into this
const CELL_H = 22;

export function PowderBurnChart() {
  const { getToken } = useAuth();
  const [chart, setChart] = useState<Chart | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Hover popover state
  const [hover, setHover] = useState<{
    powder: ChartPowder;
    x: number;
    y: number;
    rows: PowderCartridge[] | null; // null = loading
  } | null>(null);
  const cartCache = useRef<Map<string, PowderCartridge[]>>(new Map());
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cartridge search / highlight state
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CartridgeHit[]>([]);
  const [selected, setSelected] = useState<{ name: string; keys: Set<string> } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authFetch = useCallback(
    async (path: string, signal?: AbortSignal) => {
      const token = await getToken();
      if (!token) return null;
      const r = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal,
      });
      if (!r.ok) return null;
      return r.json();
    },
    [getToken],
  );

  // Load the chart once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = (await authFetch('/load-lab/burn-chart').catch(() => null)) as Chart | null;
      if (cancelled) return;
      if (data?.powders) setChart(data);
      else setLoadError(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  // ── Hover: fetch (cached) top cartridges for a powder ──
  const openHover = useCallback(
    (powder: ChartPowder, e: React.MouseEvent) => {
      if (!powder.hasLoads) return;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      const x = e.clientX;
      const y = e.clientY;
      const cached = cartCache.current.get(powder.key);
      setHover({ powder, x, y, rows: cached ?? null });
      if (!cached) {
        authFetch(`/load-lab/powder-cartridges?key=${encodeURIComponent(powder.key)}`)
          .then((res) => {
            const rows: PowderCartridge[] = res?.cartridges ?? [];
            cartCache.current.set(powder.key, rows);
            setHover((h) => (h && h.powder.key === powder.key ? { ...h, rows } : h));
          })
          .catch(() => {
            setHover((h) => (h && h.powder.key === powder.key ? { ...h, rows: [] } : h));
          });
      }
    },
    [authFetch],
  );

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHover(null), 140);
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // ── Cartridge search (debounced) ──
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const res = await authFetch(`/load-lab/cartridge-search?q=${encodeURIComponent(q)}`).catch(() => null);
      setHits(res?.hits ?? []);
    }, 200);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, authFetch]);

  const selectCartridge = useCallback(
    async (hit: CartridgeHit) => {
      setQuery(hit.name);
      setHits([]);
      const res = await authFetch(
        `/load-lab/cartridge-powders?cartridge=${encodeURIComponent(hit.name)}`,
      ).catch(() => null);
      const keys: string[] = res?.powderKeys ?? [];
      setSelected({ name: res?.cartridge ?? hit.name, keys: new Set(keys) });
    },
    [authFetch],
  );

  const clearSelected = useCallback(() => {
    setSelected(null);
    setQuery('');
    setHits([]);
  }, []);

  if (loadError) {
    return (
      <div className="text-sm" style={{ color: 'var(--text-tertiary)', padding: 16 }}>
        Powder chart unavailable right now.
      </div>
    );
  }
  if (!chart) {
    return (
      <div className="text-sm" style={{ color: 'var(--text-tertiary)', padding: 16 }}>
        Loading powder chart…
      </div>
    );
  }

  // Column order: Somchem first (local), then the source order.
  const makers = [...chart.makers].sort((a, b) =>
    a === 'Somchem' ? -1 : b === 'Somchem' ? 1 : chart.makers.indexOf(a) - chart.makers.indexOf(b),
  );
  const colX = (maker: string) => makers.indexOf(maker) * (COL_W + COL_GAP);
  const innerW = makers.length * (COL_W + COL_GAP);
  const highlightKeys = selected?.keys ?? null;

  return (
    <div>
      {/* Header + search */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
          <h3 className="text-base" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Powder burn-rate chart
          </h3>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            fast → slow · hover a powder for its cartridges
          </span>
        </div>

        {/* Cartridge search → highlight usable powders */}
        <div style={{ position: 'relative', maxWidth: 360 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a cartridge to highlight its powders…"
            className="w-full px-3 py-2 rounded-[8px] text-sm outline-none"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          {selected && (
            <button
              onClick={clearSelected}
              className="absolute text-xs"
              style={{ right: 10, top: 9, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              clear ✕
            </button>
          )}
          {hits.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: 4,
                zIndex: 40,
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                overflow: 'hidden',
              }}
            >
              {hits.map((h) => (
                <button
                  key={h.cartridgeKey}
                  onClick={() => selectCartridge(h)}
                  className="block w-full text-left px-3 py-2 text-sm"
                  style={{ color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-inset)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  {h.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {selected && (
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
            Highlighting powders with published <strong>{selected.name}</strong> loads
            {' · '}
            {[...selected.keys].length} match{[...selected.keys].length === 1 ? '' : 'es'}
          </p>
        )}
      </div>

      {/* Scrollable chart */}
      <div
        style={{
          maxHeight: '68vh',
          overflow: 'auto',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          background: 'var(--bg-inset)',
          position: 'relative',
        }}
      >
        {/* Left burn-rate gutter */}
        <div
          style={{
            position: 'sticky',
            left: 0,
            zIndex: 5,
            float: 'left',
            width: 0,
          }}
        />
        <div style={{ position: 'relative', width: innerW + 24, height: HEADER_H + TRACK_H + 40, padding: '0 12px' }}>
          {/* Sticky maker header row */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 6,
              height: HEADER_H,
              background: 'var(--bg-card)',
              borderBottom: '0.5px solid var(--border)',
              marginLeft: -12,
              marginRight: -12,
              paddingLeft: 12,
            }}
          >
            {makers.map((m) => (
              <div
                key={m}
                style={{
                  position: 'absolute',
                  left: colX(m) + 12,
                  top: 0,
                  width: COL_W,
                  height: HEADER_H,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                }}
              >
                {m}
              </div>
            ))}
          </div>

          {/* Powder cells, positioned by burn rate */}
          {chart.powders.map((p) => {
            const top = HEADER_H + 8 + p.yNorm * TRACK_H;
            const isHi = highlightKeys ? highlightKeys.has(p.key) : false;
            const dim = !!highlightKeys && !isHi;
            const interactive = p.hasLoads;
            return (
              <div
                key={p.id}
                onMouseEnter={(e) => interactive && openHover(p, e)}
                onMouseLeave={interactive ? scheduleClose : undefined}
                title={
                  interactive
                    ? `${p.name} — used in ${p.cartridgeCount} cartridge${p.cartridgeCount === 1 ? '' : 's'}`
                    : `${p.name} — no published loads in our library`
                }
                style={{
                  position: 'absolute',
                  left: colX(p.maker) + 12,
                  top,
                  width: COL_W,
                  height: CELL_H,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  lineHeight: 1,
                  padding: '0 4px',
                  borderRadius: 5,
                  cursor: interactive ? 'pointer' : 'default',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  opacity: dim ? 0.25 : p.hasLoads ? 1 : 0.5,
                  transition: 'opacity 120ms, box-shadow 120ms',
                  background: isHi
                    ? 'rgba(34,197,94,0.18)'
                    : p.hasLoads
                      ? 'var(--bg-card)'
                      : 'transparent',
                  border: isHi
                    ? '1px solid #22c55e'
                    : p.hasLoads
                      ? '0.5px solid var(--border)'
                      : '0.5px dashed var(--border-divider, var(--border))',
                  color: isHi
                    ? '#16a34a'
                    : p.hasLoads
                      ? 'var(--text-primary)'
                      : 'var(--text-tertiary)',
                  fontWeight: isHi ? 600 : 400,
                }}
              >
                {p.name}
                {p.approx && <span style={{ opacity: 0.6, marginLeft: 3 }}>≈</span>}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
        {chart.note} Placements marked ≈ are approximate, anchored to equivalent powders.
        Solid chips have published loads in our library — hover to see them; search a
        cartridge to highlight the powders it uses.
      </p>

      {/* Cursor-pinned, scrollable cartridge list */}
      {hover && (
        <HoverList
          hover={hover}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
}

function HoverList({
  hover,
  onEnter,
  onLeave,
}: {
  hover: { powder: ChartPowder; x: number; y: number; rows: PowderCartridge[] | null };
  onEnter: () => void;
  onLeave: () => void;
}) {
  const W = 236;
  // Flip to the left of the cursor if we'd overflow the right edge.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const left = hover.x + 16 + W > vw ? hover.x - W - 16 : hover.x + 16;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const top = Math.min(hover.y, vh - 300);
  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: 'fixed',
        left,
        top: Math.max(8, top),
        width: W,
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 60,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        padding: '10px 12px',
      }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {hover.powder.name}
        </span>
        {hover.powder.maker && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{hover.powder.maker}</span>
        )}
      </div>
      {hover.rows === null ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading…</div>
      ) : hover.rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No published loads.</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {hover.rows.map((c) => (
            <li
              key={c.cartridge}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '3px 0',
                fontSize: 12,
                borderBottom: '0.5px solid var(--border-divider, var(--border))',
              }}
            >
              <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.cartridge}
              </span>
              <span style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {c.minWeightGr === c.maxWeightGr
                  ? `${c.maxWeightGr}gr`
                  : `${c.minWeightGr}–${c.maxWeightGr}gr`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
