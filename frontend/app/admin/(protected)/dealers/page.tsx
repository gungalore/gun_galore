'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';
import DealersTable from './dealers-table';

interface Dealer {
  id: string;
  name: string;
  licenceNumber: string;
  address: string;
  suburb: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
  source: string;
  isVerified: boolean;
  rawAddress: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  _count: { transactions: number };
}

export default function DealersPage() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? undefined;
  const includeInactive = searchParams.get('includeInactive') ?? undefined;
  const source = searchParams.get('source') ?? undefined;
  const pending = searchParams.get('pending') ?? undefined;

  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [count, setCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (includeInactive) params.set('includeInactive', includeInactive);
      if (source) params.set('source', source);
      if (pending) params.set('pending', pending);
      try {
        const res = await adminFetch(`/admin/dealers?${params.toString()}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setDealers(data.rows);
          setCount(data.count);
          setPendingCount(data.pendingCount ?? 0);
        }
      } catch {
        // empty list will render
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [search, includeInactive, source, pending]);

  return (
    <div>
      <AdminPageHeader
        title="SAPS-licensed dealers"
        meta={<>{count} {count === 1 ? 'dealer' : 'dealers'} in directory</>}
        description={
          <>
            Dealers in this directory are offered to buyers at checkout when shipping is
            <strong style={{ color: 'var(--text-primary)' }}> DEALER_TRANSFER </strong>
            (firearms only). Entries auto-added from a verified transfer land
            <strong style={{ color: 'var(--text-primary)' }}> inactive </strong>
            until you review &amp; activate them — verify the licence first.
          </>
        }
      />

      {loaded && (
        <DealersTable
          initialDealers={dealers}
          pendingCount={pendingCount}
          activeFilters={{
            source: source ?? null,
            pending: pending === 'true',
            includeInactive: includeInactive === 'true',
          }}
        />
      )}
    </div>
  );
}
