import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Offer } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import ReceivedOfferActions from './received-offer-actions';
import { PageReveal } from '@/components/page-reveal';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default async function ReceivedOffersPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/offers/received');

  const token = await getToken();
  const res = await fetch(`${API_URL}/offers/received`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const offers: Offer[] = res.ok ? await res.json() : [];

  // Pending offers auto-expire (48h from creation; re-offers refresh
  // expiresAt) — sort the queue MOST-URGENT FIRST so the offer about to
  // die is at the top, not buried under newer arrivals. History stays
  // in the API's newest-first order.
  const pending = offers
    .filter((o) => o.status === 'PENDING')
    .sort(
      (a, b) =>
        new Date(a.expiresAt ?? 0).getTime() -
        new Date(b.expiresAt ?? 0).getTime(),
    );
  const other = offers.filter((o) => o.status !== 'PENDING');

  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <PageReveal variant="slide-up">
      <h1 data-reveal className="text-xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
        Received Offers
      </h1>

      {offers.length === 0 && (
        /* Teach-style empty state, matching the buyer-side /my/offers card.
           The bare "No offers received yet." line was a dead end: sellers land
           here expecting offers without knowing offers only exist on Take a
           Shot listings, so the copy names the cause and the two next steps. */
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
            No offers yet
          </p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
            {/* ⚠️ THERE IS NO "Take a Shot pricing" TO PICK ANY MORE. This
                told sellers to choose a listing type that was removed on
                2026-08-27 — Take a Shot is now a switch on every Buy Now and
                Auction listing, on by default. Found on the live site
                2026-08-28. */}
            Offers arrive when buyers Take a Shot at your listings. Every Buy
            Now and Auction listing invites them unless you switch offers off.
            You can accept, counter once, or decline each one.
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
              List an item →
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
      )}

      {pending.length > 0 && (
        <section data-reveal className="mb-8">
          <h2 className="text-xs uppercase mb-3" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            Awaiting your response
          </h2>
          <div className="space-y-3">
            {pending.map((offer) => <ReceivedOfferCard key={offer.id} offer={offer} />)}
          </div>
        </section>
      )}

      {other.length > 0 && (
        <section data-reveal>
          <h2 className="text-xs uppercase mb-3" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            History
          </h2>
          <div className="space-y-3">
            {other.map((offer) => <ReceivedOfferCard key={offer.id} offer={offer} />)}
          </div>
        </section>
      )}
      </PageReveal>
    </main>
  );
}

// Server-rendered deadline chip (page is no-store, so it's fresh on every
// load). Same urgency tiers as the buyer-side ExpiryCountdown on /my/offers.
function ResponseDeadline({ expiresAt }: { expiresAt: string }) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return (
      <p
        className="text-xs mb-3 px-2 py-1 rounded inline-block"
        style={{
          background: 'rgba(200,16,46,0.10)',
          border: '0.5px solid var(--red)',
          color: 'var(--red)',
        }}
      >
        Expiring — respond now or this offer lapses.
      </p>
    );
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const isCritical = hours < 2;
  const isWarning = hours < 6;
  const tone = isCritical
    ? { bg: 'rgba(200,16,46,0.10)', border: 'var(--red)', label: 'var(--red)' }
    : isWarning
      ? { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.45)', label: '#f59e0b' }
      : { bg: 'var(--bg-inset)', border: 'var(--border)', label: 'var(--text-secondary)' };
  const left = hours >= 1 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return (
    <p
      className="text-xs mb-3 px-2 py-1 rounded inline-block"
      style={{
        background: tone.bg,
        border: `0.5px solid ${tone.border}`,
        color: tone.label,
      }}
    >
      ⏱ {left} left to respond — unanswered offers expire automatically.
    </p>
  );
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING:   { label: 'Pending', color: '#f59e0b' },
  COUNTERED: { label: 'Countered', color: '#3b82f6' },
  ACCEPTED:  { label: 'Accepted', color: '#22c55e' },
  REJECTED:  { label: 'Rejected', color: 'var(--text-tertiary)' },
  WITHDRAWN: { label: 'Withdrawn', color: 'var(--text-tertiary)' },
  EXPIRED:   { label: 'Expired', color: 'var(--text-tertiary)' },
  CONVERTED: { label: 'Sold', color: '#22c55e' },
};

function ReceivedOfferCard({ offer }: { offer: Offer }) {
  const st = STATUS_LABEL[offer.status] ?? { label: offer.status, color: 'var(--text-tertiary)' };
  // Username-only attribution per platform policy — real names exist
  // only inside post-payment transaction details.
  const buyerName = offer.buyer?.username ?? 'Anonymous buyer';

  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <Link
            href={`/listings/${offer.listing.id}`}
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {offer.listing.title}
          </Link>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            from {buyerName} · {offer.buyer?.totalSales ?? 0} sale{(offer.buyer?.totalSales ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
        <span className="text-xs shrink-0" style={{ color: st.color }}>{st.label}</span>
      </div>

      <div className="flex gap-4 text-sm mb-3">
        <div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Offer</p>
          <p style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatPrice(offer.offerAmount)}</p>
        </div>
        {offer.counterAmount && (
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Your counter</p>
            <p style={{ color: '#3b82f6', fontWeight: 500 }}>{formatPrice(offer.counterAmount)}</p>
          </div>
        )}
      </div>

      {offer.buyerNote && (
        <p className="text-xs mb-3 italic" style={{ color: 'var(--text-tertiary)' }}>
          &ldquo;{offer.buyerNote}&rdquo;
        </p>
      )}

      {/* Response deadline — pending offers auto-expire; without this chip
          sellers had no idea a clock was running. Red <2h, amber <6h. */}
      {offer.status === 'PENDING' && offer.expiresAt && (
        <ResponseDeadline expiresAt={offer.expiresAt} />
      )}

      {offer.status === 'PENDING' && (
        <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: '0.75rem' }}>
          <ReceivedOfferActions offerId={offer.id} offerAmount={offer.offerAmount} />
        </div>
      )}
    </div>
  );
}
