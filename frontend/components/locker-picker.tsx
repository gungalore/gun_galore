'use client';

import { useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Shape returned by GET /shipping/pudo/lockers (the existing endpoint —
// see backend/src/shipping/pudo.service.ts → PudoService.PudoLocker).
export interface PudoLocker {
  lockerId: string;
  name: string;
  address: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  lat: number;
  lng: number;
  distanceKm?: number;
}

interface Props {
  /** Coordinates the nearest-lockers fetch hangs off. Optional —
   *  postalCode below can substitute for them. */
  lat?: number | null;
  lng?: number | null;
  /** SA postal code (4 digits, e.g. "7570"). When set, the backend
   *  tiers results by exact-match → Delaunay neighbours → distance.
   *  Either lat/lng OR postalCode (ideally both) is enough to fetch. */
  postalCode?: string | null;
  /** Currently-chosen locker id (e.g. from form state). */
  selectedId?: string;
  /** Callback when the user picks a locker. Receives the full row so the
   *  parent can render name / address without re-fetching. */
  onSelect: (locker: PudoLocker) => void;
}

// Pudo locker picker. Two-mode UI:
//  1. Nearest 5 (when lat/lng given) — auto-fetched, click-to-select cards.
//  2. Override search — debounced query against the search endpoint
//     (Meilisearch when wired; substring fallback otherwise). Lets the
//     user pick any locker country-wide.
//
// Used in two places:
//  - Sell form (lat/lng from seller's pickup address)
//  - Buyer checkout (no lat/lng → search-only)
export function LockerPicker({
  lat,
  lng,
  postalCode,
  selectedId,
  onSelect,
}: Props) {
  const [nearest, setNearest] = useState<PudoLocker[] | null>(null);
  const [loadingNearest, setLoadingNearest] = useState(false);
  const [errorNearest, setErrorNearest] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PudoLocker[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch nearest-N whenever the user's location signal changes.
  // EITHER lat/lng OR postalCode is enough — the backend tiers
  // results by postal code first (exact match → Delaunay neighbours)
  // then falls back to lat/lng distance ordering. Having both is
  // ideal but the picker now works for users who saved a manual
  // address without geocoded coordinates.
  useEffect(() => {
    const hasCoords = lat != null && lng != null;
    const hasPostal = !!postalCode && postalCode.trim().length === 4;
    if (!hasCoords && !hasPostal) {
      setNearest(null);
      return;
    }
    setLoadingNearest(true);
    setErrorNearest(null);
    const qs = new URLSearchParams({
      radiusKm: '50',
      limit: '5',
    });
    if (hasCoords) {
      qs.set('lat', String(lat));
      qs.set('lng', String(lng));
    }
    if (hasPostal) {
      qs.set('postalCode', postalCode!.trim());
    }
    fetch(`${API_URL}/shipping/pudo/lockers?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((data) => {
        if (Array.isArray(data)) setNearest(data as PudoLocker[]);
        else setNearest([]);
      })
      .catch((err) =>
        setErrorNearest(
          typeof err === 'string' ? err : 'Could not load nearest lockers',
        ),
      )
      .finally(() => setLoadingNearest(false));
  }, [lat, lng, postalCode]);

  // Debounced search — hits the backend's Meilisearch-backed endpoint.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      fetch(
        `${API_URL}/shipping/pudo/lockers/search?q=${encodeURIComponent(query.trim())}&limit=10`,
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
        .then((data) => {
          if (Array.isArray(data)) setResults(data as PudoLocker[]);
          else setResults([]);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Resolve the selected locker for the summary chip.
  const selectedLocker =
    nearest?.find((l) => l.lockerId === selectedId) ??
    results.find((l) => l.lockerId === selectedId) ??
    null;

  return (
    <div
      className="rounded-[6px] p-4 space-y-3"
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          className="text-xs uppercase"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            fontWeight: 500,
          }}
        >
          Pudo drop-off locker
        </p>
        {selectedLocker && (
          <span
            className="text-xs"
            style={{ color: '#22c55e', fontWeight: 500 }}
          >
            ✓ {selectedLocker.lockerId}
          </span>
        )}
      </div>

      {/* Nearest 5 — the search input below still lets the buyer pick
          any locker country-wide if they prefer a specific one. The
          fetch fires on EITHER lat/lng or postal code, so users who
          saved a manual address (no autocomplete) still see results. */}
      {(lat == null || lng == null) &&
      (!postalCode || postalCode.trim().length !== 4) ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Save an address (or a postal code) above so we can suggest nearby lockers.
        </p>
      ) : loadingNearest ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Finding lockers near you…
        </p>
      ) : errorNearest ? (
        <p className="text-xs" style={{ color: 'var(--red)' }}>
          {errorNearest}
        </p>
      ) : nearest && nearest.length > 0 ? (
        <div className="space-y-2">
          {nearest.map((l) => {
            const selected = l.lockerId === selectedId;
            return (
              <button
                key={l.lockerId}
                type="button"
                onClick={() => onSelect(l)}
                className="w-full text-left rounded-[6px] p-3 transition-colors"
                style={{
                  background: selected
                    ? 'rgba(200,16,46,0.08)'
                    : 'var(--bg-card)',
                  border: `0.5px solid ${selected ? 'var(--red)' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="text-sm"
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                    }}
                  >
                    {l.name}
                  </span>
                  {l.distanceKm != null && (
                    <span
                      className="text-xs shrink-0"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {l.distanceKm.toFixed(1)} km
                    </span>
                  )}
                </div>
                <div
                  className="text-xs mt-0.5"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {l.address}
                  {l.suburb ? `, ${l.suburb}` : ''}
                  {l.city ? `, ${l.city}` : ''}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          No nearby lockers found. Use the search below.
        </p>
      )}

      {/* Meilisearch-backed override */}
      <div
        className="pt-3"
        style={{ borderTop: '0.5px solid var(--border)' }}
      >
        <p
          className="text-xs mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          Different locker? Search by name, suburb, or postal code:
        </p>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowResults(true);
            }}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            placeholder="e.g. Sandton City, Claremont, 8000…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          {showResults && query.trim().length > 0 && (
            <div
              className="absolute left-0 right-0 mt-1 rounded-[6px] overflow-hidden z-10"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              {searching && (
                <div
                  className="px-3 py-2 text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Searching…
                </div>
              )}
              {!searching && results.length === 0 && (
                <div
                  className="px-3 py-2 text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  No lockers match &quot;{query}&quot;.
                </div>
              )}
              {!searching &&
                results.map((l) => (
                  <button
                    key={l.lockerId}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onSelect(l);
                      setQuery('');
                      setResults([]);
                      setShowResults(false);
                    }}
                    className="w-full text-left px-3 py-2"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '0.5px solid var(--border)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{l.name}</div>
                    <div
                      className="text-xs mt-0.5"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {l.suburb ? `${l.suburb}, ` : ''}
                      {l.city}
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
