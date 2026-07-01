'use client';

// PowderBurnChart — every powder in our load-data library as a single numbered
// list, fastest → slowest (the classic relative-burn-rate reference format).
// Flowed across newspaper columns so it fits the width; colour-coded by maker.
//
//   • Hover / tap a powder → the top cartridges it's used in (+ bullet-weight range).
//   • Search a cartridge → highlights every powder used in it (green).
//
// A powder can carry several manual name-variants (keys[]); the cartridge lookup
// unions their loads and the highlight matches any of them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface ChartPowder {
  id: string;
  maker: string;
  name: string;
  keys: string[];
  yNorm: number;
  approx?: boolean;
  cartridgeCount: number;
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

// One colour per maker (green is reserved for the cartridge-match highlight).
const MAKER_COLOR: Record<string, string> = {
  Hodgdon: '#3b82f6',
  IMR: '#f59e0b',
  Winchester: '#ef4444',
  Vihtavuori: '#06b6d4',
  Alliant: '#a855f7',
  Accurate: '#14b8a6',
  Ramshot: '#fb923c',
  ADI: '#ec4899',
  Somchem: '#6366f1',
  Norma: '#0284c7',
  'Shooters World': '#b45309',
  Vectan: '#94a3b8',
};
const makerColor = (m: string) => MAKER_COLOR[m] ?? '#94a3b8';
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

export function PowderBurnChart() {
  const { getToken } = useAuth();
  const [chart, setChart] = useState<Chart | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [hover, setHover] = useState<{
    powder: ChartPowder;
    x: number;
    y: number;
    rows: PowderCartridge[] | null;
  } | null>(null);
  const cartCache = useRef<Map<string, PowderCartridge[]>>(new Map());
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CartridgeHit[]>([]);
  const [selected, setSelected] = useState<{ name: string; keys: Set<string> } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authFetch = useCallback(
    async (path: string) => {
      const token = await getToken();
      if (!token) return null;
      const r = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      return r.ok ? r.json() : null;
    },
    [getToken],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = (await authFetch('/load-lab/burn-chart').catch(() => null)) as Chart | null;
      if (cancelled) return;
      if (data?.powders) setChart(data);
      else setLoadError(true);
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  // Fastest → slowest, numbered.
  const ranked = useMemo(
    () => (chart ? [...chart.powders].sort((a, b) => a.yNorm - b.yNorm) : []),
    [chart],
  );

  const openHover = useCallback(
    (powder: ChartPowder, e: React.MouseEvent) => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      const cacheKey = powder.keys.join(',');
      const cached = cartCache.current.get(cacheKey);
      setHover({ powder, x: e.clientX, y: e.clientY, rows: cached ?? null });
      if (!cached) {
        authFetch(`/load-lab/powder-cartridges?keys=${encodeURIComponent(cacheKey)}`)
          .then((res) => {
            const rows: PowderCartridge[] = res?.cartridges ?? [];
            cartCache.current.set(cacheKey, rows);
            setHover((h) => (h && h.powder.id === powder.id ? { ...h, rows } : h));
          })
          .catch(() => setHover((h) => (h && h.powder.id === powder.id ? { ...h, rows: [] } : h)));
      }
    },
    [authFetch],
  );
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHover(null), 140);
  }, []);
  const cancelClose = useCallback(() => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    searchTimer.current = setTimeout(async () => {
      const res = await authFetch(`/load-lab/cartridge-search?q=${encodeURIComponent(q)}`).catch(() => null);
      setHits(res?.hits ?? []);
    }, 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, authFetch]);

  const selectCartridge = useCallback(
    async (hit: CartridgeHit) => {
      setQuery(hit.name);
      setHits([]);
      const res = await authFetch(`/load-lab/cartridge-powders?cartridge=${encodeURIComponent(hit.name)}`).catch(() => null);
      setSelected({ name: res?.cartridge ?? hit.name, keys: new Set<string>(res?.powderKeys ?? []) });
    },
    [authFetch],
  );
  const clearSelected = useCallback(() => { setSelected(null); setQuery(''); setHits([]); }, []);

  if (loadError) return <div className="text-sm" style={{ color: 'var(--text-tertiary)', padding: 16 }}>Powder chart unavailable right now.</div>;
  if (!chart) return <div className="text-sm" style={{ color: 'var(--text-tertiary)', padding: 16 }}>Loading powder chart…</div>;

  const highlightKeys = selected?.keys ?? null;

  return (
    <div>
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
          <h3 className="text-base" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Relative powder burn rates — fastest to slowest
          </h3>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {ranked.length} powders · hover for cartridges
          </span>
        </div>
        <div style={{ position: 'relative', maxWidth: 360 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a cartridge to highlight its powders…"
            className="w-full px-3 py-2 rounded-[8px] text-sm outline-none"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          />
          {selected && (
            <button onClick={clearSelected} className="absolute text-xs" style={{ right: 10, top: 9, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>clear ✕</button>
          )}
          {hits.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 40, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              {hits.map((h) => (
                <button key={h.cartridgeKey} onClick={() => selectCartridge(h)} className="block w-full text-left px-3 py-2 text-sm"
                  style={{ color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-inset)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>{h.name}</button>
              ))}
            </div>
          )}
        </div>
        {selected && (
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
            Highlighting powders with published <strong>{selected.name}</strong> loads
          </p>
        )}
      </div>

      {/* Maker legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
        {chart.makers.map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: makerColor(m), flexShrink: 0 }} />
            {m}
          </span>
        ))}
      </div>

      {/* Numbered list, flowed into newspaper columns */}
      <div style={{ columnWidth: 220, columnGap: 16 }}>
        {ranked.map((p, i) => {
          const isHi = highlightKeys ? p.keys.some((k) => highlightKeys.has(k)) : false;
          const dim = !!highlightKeys && !isHi;
          const c = makerColor(p.maker);
          return (
            <div
              key={p.id}
              onMouseEnter={(e) => openHover(p, e)}
              onMouseLeave={scheduleClose}
              onClick={(e) => openHover(p, e)}
              title={`${p.maker} ${p.name} — ${p.cartridgeCount} cartridge${p.cartridgeCount === 1 ? '' : 's'}`}
              style={{
                breakInside: 'avoid',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 3,
                padding: '3px 7px',
                borderRadius: 5,
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1.25,
                background: isHi ? 'rgba(34,197,94,0.20)' : hexA(c, 0.16),
                borderLeft: `3px solid ${isHi ? '#22c55e' : c}`,
                opacity: dim ? 0.32 : 1,
                transition: 'opacity 120ms',
              }}
            >
              <span style={{ width: 26, textAlign: 'right', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontWeight: isHi ? 700 : 400 }}>
                {p.maker} {p.name}{p.approx && <span style={{ opacity: 0.55 }}> ≈</span>}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
        {chart.note} Positions marked ≈ are approximate. Hover a powder for the cartridges it's used in;
        search a cartridge to highlight the powders it uses.
      </p>

      {hover && <HoverList hover={hover} onEnter={cancelClose} onLeave={scheduleClose} />}
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
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = hover.x + 16 + W > vw ? hover.x - W - 16 : hover.x + 16;
  const top = Math.max(8, Math.min(hover.y, vh - 300));
  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ position: 'fixed', left, top, width: W, maxHeight: 280, overflowY: 'auto', zIndex: 60, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', padding: '10px 12px' }}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{hover.powder.maker} {hover.powder.name}</span>
      </div>
      {hover.rows === null ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading…</div>
      ) : hover.rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No published loads.</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {hover.rows.map((c) => (
            <li key={c.cartridge} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0', fontSize: 12, borderBottom: '0.5px solid var(--border-divider, var(--border))' }}>
              <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.cartridge}</span>
              <span style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {c.minWeightGr === c.maxWeightGr ? `${c.maxWeightGr}gr` : `${c.minWeightGr}–${c.maxWeightGr}gr`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
