'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import DealersTable from './dealers-table';

interface Dealer {
  id: string;
  name: string;
  licenceNumber: string;
  address: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
  _count: { transactions: number };
}

export default function DealersPage() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? undefined;
  const includeInactive = searchParams.get('includeInactive') ?? undefined;

  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (includeInactive) params.set('includeInactive', includeInactive);
      try {
        const res = await adminFetch(`/admin/dealers?${params.toString()}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setDealers(data.rows);
          setCount(data.count);
        }
      } catch {
        // empty list will render
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [search, includeInactive]);

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          SAPS-licensed dealers
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {count} {count === 1 ? 'dealer' : 'dealers'} in directory
        </p>
      </div>

      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Dealers in this directory are offered to buyers at checkout when shipping is
        <strong style={{ color: 'var(--text-primary)' }}> DEALER_TRANSFER </strong>
        (firearms only). Verify the licence before adding.
      </p>

      {loaded && <DealersTable initialDealers={dealers} />}
    </div>
  );
}
