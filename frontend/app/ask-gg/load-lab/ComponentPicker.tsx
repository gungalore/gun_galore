'use client';

// ComponentPicker — generic typeahead for the Load Lab cartridge / bullet
// / powder pickers. Mirrors the live-search.tsx behaviour: 180ms debounce,
// AbortController cancels stale requests, outside-click + Esc close, an
// absolutely-positioned dropdown styled like live-search. Once a hit is
// chosen it collapses to a removable pill.

import { useEffect, useRef, useState } from 'react';
import { useLoadLab } from '@/lib/use-load-lab';
import type {
  LoadLabBulletHit,
  LoadLabCartridgeHit,
  LoadLabComponentKind,
  LoadLabPowderHit,
  LoadLabSearchHit,
} from '@/lib/load-lab-types';
import { num } from '@/lib/load-lab-format';

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
};

/** Primary display label for a hit, by kind. */
function hitLabel(kind: LoadLabComponentKind, h: LoadLabSearchHit): string {
  if (kind === 'cartridge') return (h as LoadLabCartridgeHit).name;
  if (kind === 'bullet') {
    const b = h as LoadLabBulletHit;
    return `${b.maker} ${b.name}`.trim();
  }
  const p = h as LoadLabPowderHit;
  return `${p.maker} ${p.name}`.trim();
}

/** Secondary, muted detail line for a hit, by kind. */
function hitDetail(kind: LoadLabComponentKind, h: LoadLabSearchHit): string {
  if (kind === 'cartridge') {
    const c = h as LoadLabCartridgeHit;
    return `${num(c.caseVolGrH2O, 1)} gr H₂O · ${num(c.pMaxBar)} bar max`;
  }
  if (kind === 'bullet') {
    const b = h as LoadLabBulletHit;
    return `${b.caliber} · ${num(b.weightGr)} gr · BC ${num(b.g1bc, 3)}`;
  }
  const p = h as LoadLabPowderHit;
  return p.lot ? `Lot ${p.lot}` : 'Powder';
}

export interface ComponentPickerProps<H extends LoadLabSearchHit> {
  kind: LoadLabComponentKind;
  value: H | null;
  onSelect: (hit: H | null) => void;
  placeholder?: string;
  /** Bullet picker only — passes the cartridge groove (mm) through to the
   *  search so diameters are matched to the chosen barrel. */
  grooveMm?: number;
}

export function ComponentPicker<H extends LoadLabSearchHit>({
  kind,
  value,
  onSelect,
  placeholder,
  grooveMm,
}: ComponentPickerProps<H>) {
  const { search } = useLoadLab();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LoadLabSearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Outside-click + Esc — close the dropdown.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Debounced fetch (180ms) with AbortController cancelling the prior call.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      setBusy(false);
      abortRef.current?.abort();
      return;
    }
    setBusy(true);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      void search(kind, term, grooveMm, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setHits(res);
          setOpen(true);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setBusy(false);
        });
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, kind, grooveMm, search]);

  // Selected → removable pill. Replaces the input entirely.
  if (value) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '7px 10px',
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-primary)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hitLabel(kind, value)}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hitDetail(kind, value)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQ('');
            setHits(null);
          }}
          aria-label={`Remove ${hitLabel(kind, value)}`}
          style={{
            flexShrink: 0,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (hits && hits.length > 0) setOpen(true);
        }}
        placeholder={placeholder ?? `Search ${kind}…`}
        style={inputStyle}
        aria-label={`Search ${kind}`}
        autoComplete="off"
      />
      {open && hits !== null && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 60,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {hits.length === 0 ? (
            <div
              style={{
                padding: '14px 16px',
                fontSize: 13,
                color: 'var(--text-tertiary)',
              }}
            >
              {busy ? 'Searching…' : `No ${kind} for “${q}”`}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(h as H);
                      setOpen(false);
                      setQ('');
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      padding: '9px 14px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '0.5px solid var(--border)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      {hitLabel(kind, h)}
                    </span>
                    <span
                      style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
                    >
                      {hitDetail(kind, h)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
