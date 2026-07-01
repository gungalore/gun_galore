'use client';

// PowderBurnChart — every powder in our load-data library, laid out in maker
// columns and positioned by burn rate (fast at top, slow at bottom). Positions
// come from the GRT burn-rate coefficient; equivalent-burn-rate powders line up
// across columns.
//
//   • Hover a powder → a floating, scrollable list of the top cartridges it's
//     used in (with the bullet-weight range), pinned by the cursor.
//   • Search a cartridge → highlights (green) every powder used in it.
//
// A powder can carry several manual name-variants (keys[]); the hover unions
// their loads and the highlight matches any of them. Cells are de-collided per
// column so none overlap.

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
  hasLoads: boolean;
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

const COL_W = 124;
const COL_GAP = 8;
const HEADER_H = 34;
const TRACK_H = 1900; // burn-rate axis height; de-collision may extend it
const CELL_H = 21;
const MIN_GAP = 24; // min vertical gap between cell tops within a column

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

  // Column layout with de-collision: sort each maker's cells by yNorm and push
  // any that would overlap down by MIN_GAP. Also gives the container height.
  const layout = useMemo(() => {
    const tops = new Map<string, number>();
    let maxBottom = HEADER_H + TRACK_H;
    if (chart) {
      const byMaker = new Map<string, ChartPowder[]>();
      for (const p of chart.powders) {
        let a = byMaker.get(p.maker);
        if (!a) byMaker.set(p.maker, (a = []));
        a.push(p);
      }
      for (const list of byMaker.values()) {
        list.sort((a, b) => a.yNorm - b.yNorm || a.name.localeCompare(b.name));
        let last = -Infinity;
        for (const p of list) {
          let top = HEADER_H + 10 + p.yNorm * TRACK_H;
          if (top < last + MIN_GAP) top = last + MIN_GAP;
          tops.set(p.id, top);
          last = top;
          if (top + CELL_H > maxBottom) maxBottom = top + CELL_H;
        }
      }
    }
    return { tops, height: maxBottom + 16 };
  }, [chart]);

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

  const makers = chart.makers;
  const colX = (maker: string) => makers.indexOf(maker) * (COL_W + COL_GAP);
  const innerW = makers.length * (COL_W + COL_GAP);
  const highlightKeys = selected?.keys ?? null;

  return (
    <div>
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
          <h3 className="text-base" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Powder burn-rate chart</h3>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {chart.powders.length} powders · fast → slow · hover for cartridges
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

      <div style={{ maxHeight: '68vh', overflow: 'auto', border: '0.5px solid var(--border)', borderRadius: 10, background: 'var(--bg-inset)' }}>
        <div style={{ position: 'relative', width: innerW + 24, height: layout.height, padding: '0 12px' }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 6, height: HEADER_H, background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border)', marginLeft: -12, marginRight: -12, paddingLeft: 12 }}>
            {makers.map((m) => (
              <div key={m} style={{ position: 'absolute', left: colX(m) + 12, top: 0, width: COL_W, height: HEADER_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, letterSpacing: 0.2, color: 'var(--text-secondary)', textAlign: 'center' }}>{m}</div>
            ))}
          </div>

          {chart.powders.map((p) => {
            const top = layout.tops.get(p.id) ?? HEADER_H + 10 + p.yNorm * TRACK_H;
            const isHi = highlightKeys ? p.keys.some((k) => highlightKeys.has(k)) : false;
            const dim = !!highlightKeys && !isHi;
            return (
              <div
                key={p.id}
                onMouseEnter={(e) => openHover(p, e)}
                onMouseLeave={scheduleClose}
                title={`${p.name} — ${p.cartridgeCount} cartridge${p.cartridgeCount === 1 ? '' : 's'}`}
                style={{
                  position: 'absolute', left: colX(p.maker) + 12, top, width: COL_W, height: CELL_H,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, lineHeight: 1, padding: '0 4px', borderRadius: 5, cursor: 'pointer',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  opacity: dim ? 0.25 : 1, transition: 'opacity 120ms, box-shadow 120ms',
                  background: isHi ? 'rgba(34,197,94,0.18)' : 'var(--bg-card)',
                  border: isHi ? '1px solid #22c55e' : '0.5px solid var(--border)',
                  color: isHi ? '#16a34a' : 'var(--text-primary)',
                  fontWeight: isHi ? 600 : 400,
                }}
              >
                {p.name}
                {p.approx && <span style={{ opacity: 0.55, marginLeft: 3 }}>≈</span>}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
        {chart.note} Positions marked ≈ are approximate. Hover any powder to see the cartridges it's
        used in; search a cartridge to highlight the powders it uses.
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
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{hover.powder.name}</span>
        {hover.powder.maker && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{hover.powder.maker}</span>}
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
