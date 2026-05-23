import { cookies } from 'next/headers';
import Link from 'next/link';
import TransactionActions from './transaction-actions';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status = 'PENDING_ADMIN_VERIFICATION', page = '1' } = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const res = await fetch(
    `${API_URL}/admin/transactions?status=${status}&page=${page}&limit=20`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );
  const data: TxResponse | null = res.ok ? await res.json() : null;

  function name(p: { firstName: string | null; lastName: string | null; email: string }) {
    return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;
  }

  return (
    <div>
      <h1 className="text-lg font-medium mb-5" style={{ color: 'var(--text-primary)' }}>
        Transactions
      </h1>

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

      {!data ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load transactions.</p>
      ) : data.transactions.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No transactions in this status.</p>
      ) : (
        <>
          <div className="rounded-[8px] overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
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
