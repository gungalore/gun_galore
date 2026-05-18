'use client';

import { useState, useEffect } from 'react';
import { Province } from '@/lib/types';
import { PROVINCE_LABELS } from '@/lib/utils';

export interface Dealer {
  id: string;
  name: string;
  licenceNumber: string;
  address: string;
  suburb: string;
  city: string;
  province: Province;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
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
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '8px',
};

export function DealerPicker({
  province,
  onSelect,
  selectedId,
}: {
  province?: Province;
  onSelect: (dealer: Dealer) => void;
  selectedId?: string;
}) {
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [filterProvince, setFilterProvince] = useState<string>(province ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const qs = filterProvince ? `?province=${filterProvince}` : '';
    fetch(`${API_URL}/shipping/dealers${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) setDealers(data as Dealer[]);
      })
      .catch(() => setDealers([]))
      .finally(() => setLoading(false));
  }, [filterProvince]);

  return (
    <div>
      {/* Province filter */}
      <select
        value={filterProvince}
        onChange={(e) => setFilterProvince(e.target.value)}
        className="w-full mb-3"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          borderRadius: '6px',
          padding: '7px 10px',
          fontSize: '13px',
          outline: 'none',
        }}
      >
        <option value="">All provinces</option>
        {Object.entries(PROVINCE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>

      {loading ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
          Loading dealers…
        </p>
      ) : dealers.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
          No dealers found.
        </p>
      ) : (
        <div style={containerStyle}>
          {dealers.map((dealer, i) => {
            const isSelected = dealer.id === selectedId;
            return (
              <div
                key={dealer.id}
                onClick={() => onSelect(dealer)}
                style={{
                  ...rowStyle,
                  borderBottom:
                    i < dealers.length - 1 ? '0.5px solid var(--border-divider)' : 'none',
                  background: isSelected ? 'var(--bg-inset)' : 'transparent',
                }}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm"
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: isSelected ? 500 : 400,
                    }}
                  >
                    {dealer.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {dealer.address}, {dealer.suburb}, {dealer.city}
                  </p>
                  {dealer.phone && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {dealer.phone}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-[3px]"
                    style={{
                      background: 'var(--bg-inset)',
                      color: 'var(--text-tertiary)',
                      border: '0.5px solid var(--border)',
                    }}
                  >
                    {PROVINCE_LABELS[dealer.province] ?? dealer.province}
                  </span>
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
      )}
    </div>
  );
}
