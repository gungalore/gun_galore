import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Transaction } from '@/lib/types';
import {
  PAYMENT_STATUS,
  resolveStatus,
  toneColor,
  paymentStatusHint,
} from '@/lib/status-labels';
import { PageReveal } from '@/components/page-reveal';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default async function MySalesPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/sales');

  const token = await getToken();
  const res = await fetch(`${API_URL}/transactions?role=seller`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const transactions: Transaction[] = res.ok ? await res.json() : [];

  const pending = transactions.filter((t) =>
    ['HELD', 'PENDING_ADMIN_VERIFICATION'].includes(t.paymentStatus),
  );
  const completed = transactions.filter((t) =>
    ['RELEASED', 'REFUNDED'].includes(t.paymentStatus),
  );

  function TxRow({ tx }: { tx: Transaction }) {
    const status = resolveStatus(PAYMENT_STATUS, tx.paymentStatus);
    const color = toneColor(status.tone);
    return (
      <Link
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
            Buyer: {tx.buyer.username ?? 'Anonymous'}
            {' · '}{new Date(tx.createdAt).toLocaleDateString('en-ZA')}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Payout
          </p>
          <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
            R{(tx.sellerPayout / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
          </p>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            title={
              paymentStatusHint(tx.paymentStatus, tx.shippingMethod) ??
              status.hint ??
              status.label
            }
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
  }

  return (
    <main className="max-w-[var(--page-max)] mx-auto px-4 py-6">
      <PageReveal variant="slide-up">
      <h1 data-reveal className="text-xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
        My Sales
      </h1>

      {transactions.length === 0 ? (
        <div
          data-reveal
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
            No sales yet
          </p>
          <p
            className="text-sm mb-5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Once a buyer pays for one of your listings, the sale lands
            here with dispatch instructions and payout status.
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            <Link
              href="/listings/new"
              className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Create a listing →
            </Link>
            <Link
              href="/my/listings"
              className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                textDecoration: 'none',
              }}
            >
              View my listings
            </Link>
          </div>
        </div>
      ) : (
        <div data-reveal className="space-y-6">
          {pending.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Active ({pending.length})
              </p>
              <div className="space-y-2">
                {pending.map((tx) => <TxRow key={tx.id} tx={tx} />)}
              </div>
            </div>
          )}
          {completed.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Completed ({completed.length})
              </p>
              <div className="space-y-2">
                {completed.map((tx) => <TxRow key={tx.id} tx={tx} />)}
              </div>
            </div>
          )}
        </div>
      )}
      </PageReveal>
    </main>
  );
}
