'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';
import TransactionActions from './transaction-actions';

interface Tx {
  id: string;
  paymentStatus: string;
  amount: number;
  createdAt: string;
  listing: { title: string; price: number };
  buyer: { firstName: string | null; lastName: string | null; email: string };
  seller: { firstName: string | null; lastName: string | null; email: string };
}

interface TxResponse {
  transactions: Tx[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_TABS = ['PENDING_ADMIN_VERIFICATION', 'HELD', 'RELEASED', 'REFUNDED'];

export default function AdminTransactionsPage() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? 'PENDING_ADMIN_VERIFICATION';
  const page = searchParams.get('page') ?? '1';

  const [data, setData] = useState<TxResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const res = await adminFetch(
        `/admin/transactions?status=${status}&page=${page}&limit=20`,
      );
      if (cancelled) return;
      if (res.ok) setData(await res.json());
      else setData(null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, page]);

  function name(p: { firstName: string | null; lastName: string | null; email: string }) {
    return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;
  }

  return (
    <div>
      <AdminPageHeader title="Transactions" />

      <div className="flex gap-2 mb-5 flex-wrap">
        {STATUS_TABS.map((t) => (
          <a
            key={t}
            href={`/admin/transactions?status=${t}`}
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
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load transactions.</p>
      ) : data.transactions.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No transactions in this status.</p>
      ) : (
        <>
          <div className="rounded-[8px] overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
            <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-inset)' }}>
                  {['Listing', 'Buyer', 'Seller', 'Amount', 'Date', ''].map((h) => (
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
                {data.transactions.map((tx) => (
                  <tr key={tx.id} style={{ borderBottom: '0.5px solid var(--border-divider)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                      <Link
                        href={`/admin/transactions/${tx.id}`}
                        style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                      >
                        <div className="font-medium">{tx.listing.title}</div>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          R{tx.listing.price.toLocaleString('en-ZA')}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {name(tx.buyer)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {name(tx.seller)}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      R{tx.amount.toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(tx.createdAt).toLocaleDateString('en-ZA')}
                    </td>
                    <td className="px-4 py-3">
                      {status === 'PENDING_ADMIN_VERIFICATION' && (
                        <TransactionActions txId={tx.id} />
                      )}
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
                  href={`/admin/transactions?status=${status}&page=${Number(page) - 1}`}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  ← Prev
                </a>
              )}
              {Number(page) * data.limit < data.total && (
                <a
                  href={`/admin/transactions?status=${status}&page=${Number(page) + 1}`}
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
