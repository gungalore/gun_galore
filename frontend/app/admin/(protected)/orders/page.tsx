'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';
import { AdminStatusChip } from '@/components/admin/status-chip';

interface Order {
  id: string;
  orderReference: string | null;
  status: string;
  paymentMethod: string;
  buyerTotal: number;
  paidAt: string | null;
  createdAt: string;
  buyer: { id: string; username: string | null; email: string };
  _count: { transactions: number };
}

interface OrderResponse {
  orders: Order[];
  total: number;
  page: number;
  limit: number;
}

// OrderStatus enum (schema.prisma). No status tab selected → show all.
const STATUS_TABS = [
  'AWAITING_PAYMENT',
  'PAID',
  'PARTIALLY_FULFILLED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const page = searchParams.get('page') ?? '1';

  const [data, setData] = useState<OrderResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      qs.set('page', page);
      qs.set('limit', '20');
      const res = await adminFetch(`/admin/orders?${qs.toString()}`);
      if (cancelled) return;
      if (res.ok) setData(await res.json());
      else setData(null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, page]);

  return (
    <div>
      <AdminPageHeader title="Orders" />

      <div className="flex gap-2 mb-5 flex-wrap">
        <a
          href="/admin/orders"
          className="px-3 py-1 rounded-full text-xs font-medium"
          style={{
            background: status === '' ? 'var(--red)' : 'var(--bg-card)',
            color: status === '' ? '#fff' : 'var(--text-secondary)',
            border: `0.5px solid ${status === '' ? 'transparent' : 'var(--border)'}`,
            textDecoration: 'none',
          }}
        >
          All
        </a>
        {STATUS_TABS.map((t) => (
          <a
            key={t}
            href={`/admin/orders?status=${t}`}
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={{
              background: status === t ? 'var(--red)' : 'var(--bg-card)',
              color: status === t ? '#fff' : 'var(--text-secondary)',
              border: `0.5px solid ${status === t ? 'transparent' : 'var(--border)'}`,
              textDecoration: 'none',
            }}
          >
            {t.replace(/_/g, ' ')}
          </a>
        ))}
      </div>

      {!loaded ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
      ) : !data ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load orders.</p>
      ) : data.orders.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No orders in this status.</p>
      ) : (
        <>
          <div className="rounded-[8px] overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
            <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-inset)' }}>
                  {['Reference', 'Buyer', 'Lines', 'Total', 'Status', 'Date'].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-2.5 text-xs font-medium"
                      style={{ color: 'var(--text-tertiary)', borderBottom: '0.5px solid var(--border)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id} style={{ borderBottom: '0.5px solid var(--border-divider)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        style={{ color: 'var(--text-primary)', textDecoration: 'none', fontFamily: 'monospace' }}
                      >
                        {o.orderReference ?? o.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      @{o.buyer.username ?? 'anon'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {o._count.transactions}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      R{(o.buyerTotal / 100).toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-3">
                      <AdminStatusChip status={o.status} />
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(o.createdAt).toLocaleDateString('en-ZA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="flex justify-between items-center mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>{data.total} total</span>
            <div className="flex gap-2">
              {Number(page) > 1 && (
                <a
                  href={`/admin/orders?status=${status}&page=${Number(page) - 1}`}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  ← Prev
                </a>
              )}
              {Number(page) * data.limit < data.total && (
                <a
                  href={`/admin/orders?status=${status}&page=${Number(page) + 1}`}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  Next →
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
