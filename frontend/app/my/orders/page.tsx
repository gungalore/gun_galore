import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Transaction } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STATUS_COLOR: Record<string, string> = {
  HELD: '#f59e0b',
  PENDING_ADMIN_VERIFICATION: '#f59e0b',
  RELEASED: '#22c55e',
  REFUNDED: '#6366f1',
  DISPUTED: 'var(--red)',
};

export default async function MyOrdersPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/orders');

  const token = await getToken();
  const res = await fetch(`${API_URL}/transactions?role=buyer`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const transactions: Transaction[] = res.ok ? await res.json() : [];

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <h1 className="text-xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
        My Orders
      </h1>

      {transactions.length === 0 ? (
        <div className="text-center py-20 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No orders yet.{' '}
          <Link href="/" style={{ color: 'var(--red)' }}>
            Browse listings →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {transactions.map((tx) => (
            <Link
              key={tx.id}
              href={`/transactions/${tx.id}`}
              className="flex items-center gap-4 p-4 rounded-[8px] transition-colors"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                textDecoration: 'none',
              }}
            >
              {tx.listing.images?.[0] && (
                <img
                  src={tx.listing.images[0].url}
                  alt=""
                  className="w-14 h-14 rounded-[6px] object-cover shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {tx.listing.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  Seller: {[tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') || 'Unknown'}
                  {' · '}{new Date(tx.createdAt).toLocaleDateString('en-ZA')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                  R{(tx.buyerTotal / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                </p>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    color: STATUS_COLOR[tx.paymentStatus] ?? 'var(--text-tertiary)',
                    background: `${STATUS_COLOR[tx.paymentStatus] ?? 'var(--text-tertiary)'}18`,
                  }}
                >
                  {tx.paymentStatus.replace(/_/g, ' ')}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
