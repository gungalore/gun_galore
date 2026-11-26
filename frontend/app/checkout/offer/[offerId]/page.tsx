import { serverAuth as auth } from '../../../../lib/auth-server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Offer, ListingType, OfferStatus } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import {
  offerCheckoutSource,
  offerHasExpired,
  settledOfferAmount,
} from '@/lib/offer-checkout';
import { OfferCheckoutForm } from './offer-checkout-form';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * The public listing projection returned by GET /actions/:token/offer-checkout
 * — only the fields this page's form + summary need.
 */
interface TokenOfferListing {
  id: string;
  title: string;
  listingType?: ListingType;
  isFirearm?: boolean;
  plannedDealerName?: string | null;
  plannedDealerLocation?: string | null;
}

/**
 * The signed-out offer-checkout payload.
 *
 * ⚠️ THE CONTRACT IS NARROW ON PURPOSE (see backend action-tokens.controller.ts):
 * no offer `transactionId`, no seller identity, no buyer data beyond the id the
 * token already authorises. Do not widen this read by falling back to
 * GET /offers/:id — a signed-out buyer has no session to send it with.
 */
interface TokenOfferPayload {
  offer: {
    id: string;
    status: OfferStatus;
    offerAmount: number;
    counterAmount: number | null;
    expiresAt: string | null;
    buyerId: string;
    listingId: string;
  };
  listing: TokenOfferListing;
}

export default async function OfferCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { offerId } = await params;
  const { t: actionToken } = await searchParams;
  const { userId, getToken } = await auth();

  // Which credential can read this offer. A signed-in member keeps the exact
  // behaviour this page has always had; the checkout token is the signed-out
  // buyer's ONLY credential, and bouncing them to sign-in (as this page used
  // to) dead-ends the "your offer was accepted — pay now" link for anyone who
  // opened it on a phone without a session.
  const source = offerCheckoutSource({ signedIn: !!userId, actionToken });
  if (source === 'sign-in') {
    redirect(`/sign-in?redirect_url=/checkout/offer/${offerId}`);
  }
  if (source === 'token') {
    if (!actionToken) redirect(`/sign-in?redirect_url=/checkout/offer/${offerId}`);
    return <TokenOfferCheckout offerId={offerId} actionToken={actionToken} />;
  }

  const token = await getToken();
  const res = await fetch(`${API_URL}/offers/${offerId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) return notFound();
  const offer: Offer = await res.json();

  if (offer.status !== 'ACCEPTED') {
    return <OfferUnavailable backHref="/my/offers" backLabel="View my offers" />;
  }

  if (offer.transactionId) {
    redirect(`/transactions/${offer.transactionId}`);
  }

  // Offer expiry safety check — backend sweeps EXPIRED rows every 10
  // min via cron, but a buyer could load this page during the gap.
  // If the deadline has already passed at render time, refuse the
  // checkout path explicitly so the buyer doesn't fill out card
  // details and get rejected on submit.
  if (offerHasExpired(offer.expiresAt)) {
    return <OfferExpired listingId={offer.listing.id} />;
  }

  return (
    <OfferCheckoutView
      offerId={offer.id}
      listingId={offer.listingId}
      offerAmount={offer.offerAmount}
      counterAmount={offer.counterAmount}
      listingTitle={offer.listing.title}
      isFirearm={offer.listing.isFirearm ?? false}
      listingType={offer.listing.listingType ?? 'BUY_NOW'}
      dealerName={offer.listing.plannedDealerName}
      dealerLocation={offer.listing.plannedDealerLocation}
      backHref="/my/offers"
      backLabel="Back to offers"
    />
  );
}

/**
 * The signed-out half: read the offer through the CHECKOUT action token.
 *
 * ⚠️ A READ, NOT A CONSUMPTION — the page can be reloaded and the Pay call
 * still carries the token. Rendering it does not spend the buyer's one shot.
 */
async function TokenOfferCheckout({
  offerId,
  actionToken,
}: {
  offerId: string;
  actionToken: string;
}) {
  const payload = await apiFetch<TokenOfferPayload>(
    `/actions/${encodeURIComponent(actionToken)}/offer-checkout`,
    { cache: 'no-store' },
  ).catch(() => null);

  // A dead/expired/used token. The page is reached from an SMS link, so the
  // copy has to make sense to somebody who has no idea what a session is:
  // tell them the link is spent, not that the server said 410.
  if (!payload) {
    return (
      <main className="max-w-[560px] mx-auto px-4 py-8">
        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
          This payment link is no longer valid — it may have expired or
          already been used.
        </p>
        <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>
          <Link href="/my/offers" style={{ color: 'var(--red)' }}>
            Sign in to view your offers
          </Link>{' '}
          to pick this up again.
        </p>
      </main>
    );
  }

  const { offer, listing } = payload;

  // The offer may have moved on since the message was sent (withdrawn,
  // expired by the cron, converted into a transaction). The token grants a
  // READ only, so say so rather than rendering a Pay button the server will
  // refuse.
  if (offer.id !== offerId || offer.status !== 'ACCEPTED') {
    return (
      <OfferUnavailable
        backHref="/sign-in?redirect_url=%2Fmy%2Foffers"
        backLabel="Sign in to view your offers"
      />
    );
  }

  if (offerHasExpired(offer.expiresAt)) {
    return <OfferExpired listingId={listing.id} />;
  }

  return (
    <OfferCheckoutView
      offerId={offer.id}
      listingId={listing.id}
      offerAmount={offer.offerAmount}
      counterAmount={offer.counterAmount}
      listingTitle={listing.title}
      isFirearm={listing.isFirearm ?? false}
      listingType={listing.listingType ?? 'BUY_NOW'}
      dealerName={listing.plannedDealerName}
      dealerLocation={listing.plannedDealerLocation}
      actionToken={actionToken}
      backHref={`/listings/${listing.id}`}
      backLabel="Back to listing"
    />
  );
}

/**
 * The one layout both credential paths render, so the signed-in page cannot
 * drift from the token page. The form carries the credential: `actionToken`
 * makes every API call append `?t=` instead of a Bearer header.
 */
function OfferCheckoutView({
  offerId,
  listingId,
  offerAmount,
  counterAmount,
  listingTitle,
  isFirearm,
  listingType,
  dealerName,
  dealerLocation,
  actionToken,
  backHref,
  backLabel,
}: {
  offerId: string;
  listingId: string;
  offerAmount: number;
  counterAmount: number | null;
  listingTitle: string;
  isFirearm: boolean;
  listingType: ListingType;
  dealerName?: string | null;
  dealerLocation?: string | null;
  actionToken?: string | null;
  backHref: string;
  backLabel: string;
}) {
  const settledAmount = settledOfferAmount({ offerAmount, counterAmount });
  return (
    <main className="max-w-[900px] mx-auto px-4 py-8">
      <Link
        href={backHref}
        className="text-sm inline-block mb-6"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← {backLabel}
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* Left: checkout form */}
        <div>
          <h1 className="text-xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
            Complete your purchase
          </h1>
          <OfferCheckoutForm
            offerId={offerId}
            listingId={listingId}
            settledAmount={settledAmount}
            isFirearm={isFirearm}
            listingType={listingType}
            dealerName={dealerName}
            dealerLocation={dealerLocation}
            actionToken={actionToken}
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
            href={`/listings/${listingId}`}
            className="block text-sm mb-3 line-clamp-2"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            {listingTitle}
          </Link>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Your offer</span>
              <span style={{ color: 'var(--text-secondary)' }}>{formatPrice(offerAmount)}</span>
            </div>
            {counterAmount && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Seller counter</span>
                <span style={{ color: 'var(--info)' }}>{formatPrice(counterAmount)}</span>
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

function OfferUnavailable({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  return (
    <main className="max-w-[560px] mx-auto px-4 py-8">
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        This offer is no longer available for checkout.{' '}
        <Link href={backHref} style={{ color: 'var(--red)' }}>
          {backLabel}
        </Link>
      </p>
    </main>
  );
}

function OfferExpired({ listingId }: { listingId: string }) {
  return (
    <main className="max-w-[560px] mx-auto px-4 py-8">
      <div
        className="rounded-[6px] px-4 py-3 text-sm"
        style={{
          background: 'var(--red-wash)',
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
          href={`/listings/${listingId}`}
          className="inline-block mt-3 text-xs"
          style={{ color: 'var(--red)', textDecoration: 'underline' }}
        >
          View listing →
        </Link>
      </div>
    </main>
  );
}
