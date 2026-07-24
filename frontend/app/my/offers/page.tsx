import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Offer } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import OfferActions from './offer-actions';
import { PageReveal } from '@/components/page-reveal';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING:   { label: 'Awaiting seller', color: '#f59e0b' },
  COUNTERED: { label: 'Counter received', color: '#3b82f6' },
  ACCEPTED:  { label: 'Accepted — checkout now', color: '#22c55e' },
  REJECTED:  { label: 'Rejected', color: 'var(--text-tertiary)' },
  WITHDRAWN: { label: 'Withdrawn', color: 'var(--text-tertiary)' },
  EXPIRED:   { label: 'Expired', color: 'var(--text-tertiary)' },
  CONVERTED: { label: 'Purchased', color: '#22c55e' },
};

export default async function MyOffersPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/offers');

  const token = await getToken();
  const res = await fetch(`${API_URL}/offers/mine`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const offers: Offer[] = res.ok ? await res.json() : [];

  const active = offers.filter((o) => ['PENDING', 'COUNTERED', 'ACCEPTED'].includes(o.status));
  const closed = offers.filter((o) => !['PENDING', 'COUNTERED', 'ACCEPTED'].includes(o.status));

  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <PageReveal variant="slide-up">
      <h1 data-reveal className="text-xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
        My Offers
      </h1>

      {active.length === 0 && closed.length === 0 && (
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
          <p
            className="text-sm mb-5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Take a Shot lets you name your own price. The seller can
            accept, counter once, or decline — you get 24 hours to act
            on a counter.
          </p>
          <Link
            href="/?listingType=TAKE_A_SHOT"
            className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Browse Take a Shot listings →
          </Link>
        </div>
      )}

      {active.length > 0 && (
        <section data-reveal className="mb-8">
          <h2 className="text-xs uppercase mb-3" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            Active
          </h2>
          <div className="space-y-3">
            {active.map((offer) => <OfferCard key={offer.id} offer={offer} />)}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <section data-reveal>
          <h2 className="text-xs uppercase mb-3" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            Closed
          </h2>
          <div className="space-y-3">
            {closed.map((offer) => <OfferCard key={offer.id} offer={offer} />)}
          </div>
        </section>
      )}
      </PageReveal>
    </main>
  );
}

function OfferCard({ offer }: { offer: Offer }) {
  const img = offer.listing.images.find((i) => i.isPrimary) ?? offer.listing.images[0];
  const st = STATUS_LABEL[offer.status] ?? { label: offer.status, color: 'var(--text-tertiary)' };
  const settled = offer.counterAmount ?? offer.offerAmount;
  // Prominent Active vs Closed pill at the card head so the eye reads
  // intent before details. Active = anything still in play (PENDING /
  // COUNTERED / ACCEPTED). Everything else is Closed.
  const isActive = ['PENDING', 'COUNTERED', 'ACCEPTED'].includes(offer.status);

  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] uppercase px-2 py-0.5 rounded-full"
          style={{
            background: isActive
              ? 'rgba(34,197,94,0.14)'
              : 'rgba(108,108,108,0.16)',
            color: isActive ? '#22c55e' : 'var(--text-tertiary)',
            border: `0.5px solid ${
              isActive ? 'rgba(34,197,94,0.35)' : 'var(--border)'
            }`,
            fontWeight: 600,
            letterSpacing: '0.06em',
          }}
        >
          {isActive ? 'Active' : 'Closed'}
        </span>
        <span className="text-xs" style={{ color: st.color }}>
          {st.label}
        </span>
      </div>
      <div className="flex gap-3">
        {img ? (
          <div className="relative w-16 h-16 flex-shrink-0 rounded-[4px] overflow-hidden">
            <Image src={img.url} alt={offer.listing.title} fill className="object-cover" sizes="64px" />
          </div>
        ) : (
          <div
            className="w-16 h-16 flex-shrink-0 rounded-[4px] flex items-center justify-center text-xs"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
          >
            No photo
          </div>
        )}
        <div className="flex-1 min-w-0">
          <Link
            href={`/listings/${offer.listing.id}`}
            className="text-sm font-medium leading-snug line-clamp-1"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {offer.listing.title}
          </Link>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Your offer: {formatPrice(offer.offerAmount)}
            </span>
            {offer.counterAmount && (
              <span className="text-xs" style={{ color: '#3b82f6' }}>
                Counter: {formatPrice(offer.counterAmount)}
              </span>
            )}
          </div>
          {offer.sellerNote && (
            <p className="text-xs mt-1 italic" style={{ color: 'var(--text-tertiary)' }}>
              Seller: &ldquo;{offer.sellerNote}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Actions for active states */}
      {offer.status === 'COUNTERED' && (
        <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          {/* Counters die in 24h (COUNTER_TTL_HOURS) — show the deadline so
              buyers don't let a live deal quietly lapse. */}
          <ExpiryCountdown expiresAt={offer.expiresAt} mode="respond" />
          <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
            Seller countered at <strong>{formatPrice(offer.counterAmount!)}</strong>. Accept or decline — this is final.
          </p>
          <OfferActions offerId={offer.id} action="counter" />
        </div>
      )}

      {offer.status === 'ACCEPTED' && !offer.transactionId && (
        <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          {/* Payment deadline countdown — backend sets a 24h expiry on
              acceptance (offers.service.ts COUNTER_TTL_HOURS = 24).
              If the buyer ghosts past the deadline, the offer is
              swept to EXPIRED by the offers cron and the listing
              returns to the marketplace. Buyer was missing this
              countdown before this notice was added. */}
          <ExpiryCountdown expiresAt={offer.expiresAt} />
          <a
            href={`/checkout/offer/${offer.id}`}
            className="block w-full py-2.5 rounded-[6px] text-sm text-center"
            style={{ background: 'var(--red)', color: '#fff', fontWeight: 500, textDecoration: 'none' }}
          >
            Complete Checkout — {formatPrice(settled)}
          </a>
        </div>
      )}

      {offer.status === 'PENDING' && (
        <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          <OfferActions offerId={offer.id} action="withdraw" />
        </div>
      )}
    </div>
  );
}

// Server-rendered static deadline display. We avoid a live ticking
// countdown to dodge SSR hydration mismatches; a relative-time chip
// (e.g. "12h left") is plenty for the buyer to decide whether to
// click checkout now or come back later. Red urgency if < 2h, amber
// if < 6h, neutral otherwise.
function ExpiryCountdown({
  expiresAt,
  mode = 'pay',
}: {
  expiresAt: string;
  // 'pay' — accepted offer awaiting checkout; 'respond' — a counter the
  // buyer must accept/decline. Same urgency ramp, different verbs.
  mode?: 'pay' | 'respond';
}) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return (
      <p
        className="text-xs mb-2 px-2 py-1 rounded"
        style={{
          background: 'rgba(200,16,46,0.10)',
          border: '0.5px solid var(--red)',
          color: 'var(--red)',
        }}
      >
        Expired — the seller may have relisted this item.
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
  const verb = mode === 'respond' ? 'left to respond' : 'left to pay';
  const left = hours >= 1 ? `${hours}h ${minutes}m ${verb}` : `${minutes}m ${verb}`;
  const consequence =
    mode === 'respond'
      ? "if you don't answer, the counter expires and the deal is off."
      : "if you don't pay in time, the offer expires and the listing goes back on sale.";
  return (
    <p
      className="text-xs mb-2 px-2 py-1 rounded"
      style={{
        background: tone.bg,
        border: `0.5px solid ${tone.border}`,
        color: tone.label,
      }}
    >
      ⏱ {left} — {consequence}
    </p>
  );
}
