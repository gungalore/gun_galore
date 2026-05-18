'use client';

import { useState, useEffect } from 'react';

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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const containerStyle: React.CSSProperties = {
  border: '0.5px solid var(--border)',
  borderRadius: '6px',
  overflow: 'hidden',
};

const rowStyle: React.CSSProperties = {
  padding: '10px 12px',
  cursor: 'pointer',
  borderBottom: '0.5px solid var(--border-divider)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
};

export function LockerPicker({
  lat,
  lng,
  radiusKm = 30,
  onSelect,
  selectedId,
}: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  onSelect: (locker: PudoLocker) => void;
  selectedId?: string;
}) {
  const [lockers, setLockers] = useState<PudoLocker[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams({ radiusKm: String(radiusKm), limit: '15' });
    if (lat != null) qs.set('lat', String(lat));
    if (lng != null) qs.set('lng', String(lng));

    fetch(`${API_URL}/shipping/pudo/lockers?${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) setLockers(data as PudoLocker[]);
      })
      .catch(() => setError('Could not load Pudo lockers'))
      .finally(() => setLoading(false));
  }, [lat, lng, radiusKm]);

  if (loading)
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
        Loading lockers…
      </p>
    );

  if (error)
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--red)' }}>
        {error}
      </p>
    );

  if (lockers.length === 0)
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
        No Pudo lockers found in this area.
      </p>
    );

  return (
    <div style={containerStyle}>
      {lockers.map((locker, i) => {
        const isSelected = locker.lockerId === selectedId;
        return (
          <div
            key={locker.lockerId}
            onClick={() => onSelect(locker)}
            style={{
              ...rowStyle,
              borderBottom:
                i < lockers.length - 1 ? '0.5px solid var(--border-divider)' : 'none',
              background: isSelected ? 'var(--bg-inset)' : 'transparent',
            }}
          >
            <div>
              <p
                className="text-sm"
                style={{ color: 'var(--text-primary)', fontWeight: isSelected ? 500 : 400 }}
              >
                {locker.name}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {locker.address}, {locker.suburb}, {locker.city}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {locker.distanceKm != null && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {locker.distanceKm.toFixed(1)} km
                </span>
              )}
              {isSelected && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-[3px]"
                  style={{ background: 'var(--red)', color: '#fff' }}
                >
                  Selected
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
