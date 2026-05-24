import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Transaction } from '@/lib/types';
import { PAYMENT_STATUS, resolveStatus, toneColor } from '@/lib/status-labels';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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
        <div
          className="rounded-[8px] py-12 px-6 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p
            className="text-base mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            No orders yet
          </p>
          <p
            className="text-sm mb-5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            When you buy something on Gun Galore, your order will show
            up here with shipping updates and dispatch details.
          </p>
          <Link
            href="/"
            className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Browse the marketplace →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {transactions.map((tx) => {
            const status = resolveStatus(PAYMENT_STATUS, tx.paymentStatus);
            const color = toneColor(status.tone);
            return (
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
                  <Image
                    src={tx.listing.images[0].url}
                    alt={tx.listing.title}
                    width={56}
                    height={56}
                    sizes="56px"
                    className="w-14 h-14 rounded-[6px] object-cover shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {tx.listing.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    Seller: {tx.seller.username ?? 'Anonymous'}
                    {' · '}{new Date(tx.createdAt).toLocaleDateString('en-ZA')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                    R{(tx.buyerTotal / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                  </p>
                  {/* `title` gives the hover tooltip on desktop + the
                      long-press tooltip on iOS — long enough text to
                      explain what "Payment held" means without making
                      the pill itself verbose. */}
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    title={status.hint ?? status.label}
                    style={{
                      color,
                      background: `${color}18`,
                    }}
                  >
                    {status.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
