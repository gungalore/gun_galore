import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Offer } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { OfferCheckoutForm } from './offer-checkout-form';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default async function OfferCheckoutPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const { offerId } = await params;
  const { userId, getToken } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=/checkout/offer/${offerId}`);

  const token = await getToken();
  const res = await fetch(`${API_URL}/offers/${offerId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) return notFound();
  const offer: Offer = await res.json();

  if (offer.status !== 'ACCEPTED') {
    return (
      <main className="max-w-[560px] mx-auto px-4 py-8">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          This offer is no longer available for checkout.{' '}
          <Link href="/my/offers" style={{ color: 'var(--red)' }}>View my offers</Link>
        </p>
      </main>
    );
  }

  if (offer.transactionId) {
    redirect(`/transactions/${offer.transactionId}`);
  }

  // Offer expiry safety check — backend sweeps EXPIRED rows every 10
  // min via cron, but a buyer could load this page during the gap.
  // If the deadline has already passed at render time, refuse the
  // checkout path explicitly so the buyer doesn't fill out card
  // details and get rejected on submit.
  if (offer.expiresAt && new Date(offer.expiresAt).getTime() < Date.now()) {
    return (
      <main className="max-w-[560px] mx-auto px-4 py-8">
        <div
          className="rounded-[6px] px-4 py-3 text-sm"
          style={{
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            color: 'var(--text-primary)',
            lineHeight: 1.55,
          }}
        >
          <p style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 4 }}>
            Offer expired
          </p>
          <p style={{ color: 'var(--text-secondary)' }}>
            The 24-hour payment window on this accepted offer has
            elapsed. The listing has gone back on sale — you can make
            a fresh offer if it&apos;s still available.
          </p>
          <Link
            href={`/listings/${offer.listing.id}`}
            className="inline-block mt-3 text-xs"
            style={{ color: 'var(--red)', textDecoration: 'underline' }}
          >
            View listing →
          </Link>
        </div>
      </main>
    );
  }

  const settledAmount = offer.counterAmount ?? offer.offerAmount;

  return (
    <main className="max-w-[900px] mx-auto px-4 py-8">
      <Link
        href="/my/offers"
        className="text-sm inline-block mb-6"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← Back to offers
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* Left: checkout form */}
        <div>
          <h1 className="text-xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
            Complete your purchase
          </h1>
          <OfferCheckoutForm
            offerId={offer.id}
            listingId={offer.listingId}
            settledAmount={settledAmount}
            isFirearm={false}
          />
        </div>

        {/* Right: summary */}
        <div
          className="rounded-[8px] p-5 self-start"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Order summary
          </h2>
          <Link
            href={`/listings/${offer.listing.id}`}
            className="block text-sm mb-3 line-clamp-2"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            {offer.listing.title}
          </Link>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Your offer</span>
              <span style={{ color: 'var(--text-secondary)' }}>{formatPrice(offer.offerAmount)}</span>
            </div>
            {offer.counterAmount && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Seller counter</span>
                <span style={{ color: '#3b82f6' }}>{formatPrice(offer.counterAmount)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2" style={{ borderTop: '0.5px solid var(--border)' }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Agreed price</span>
              <span style={{ color: 'var(--red)', fontWeight: 500 }}>{formatPrice(settledAmount)}</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
