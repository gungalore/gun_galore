import { cookies } from 'next/headers';
import DealersTable from './dealers-table';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

export default async function DealersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; includeInactive?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const params = new URLSearchParams();
  if (sp.search) params.set('search', sp.search);
  if (sp.includeInactive) params.set('includeInactive', sp.includeInactive);

  let dealers: Dealer[] = [];
  let count = 0;
  try {
    const res = await fetch(`${API_URL}/admin/dealers?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      dealers = data.rows;
      count = data.count;
    }
  } catch {
    // empty list will render
  }

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

      <DealersTable initialDealers={dealers} />
    </div>
  );
}
