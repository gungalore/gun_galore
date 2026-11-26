import Link from 'next/link';
import Image from 'next/image';
import { viewerFetch } from '@/lib/api-viewer';
import { formatPrice } from '@/lib/utils';

/**
 * WHAT HAPPENED TO AN AUCTION — the destination of every ended-auction
 * notification.
 *
 * ⚠️ THE PDP CANNOT BE THE DESTINATION. An EXPIRED listing is deliberately not
 * publicly visible (backend/src/listings/listing-visibility.ts: dead inventory
 * must not stay crawlable), so the loser/lapsed/cancelled emails used to link
 * at `/listings/<id>` and land every recipient on the generic 404. This page
 * reads GET /auctions/<id> instead, which still serves the final state for an
 * auction that has ended (EXPIRED/CANCELLED included) — it exposes nothing the
 * PDP did while the auction was live: no reserve price, masked bidder names.
 *
 * Content class, not member-only, and deliberately NOT gated any further: the
 * recipient may be any losing bidder, and the 18+ gate is already in front of
 * it via middleware (which is also why a crawler never reaches it).
 */
export const metadata = {
  title: 'Auction result — ALL Outdoor',
  description:
    'How an auction on ALL Outdoor ended: the final bid, whether it sold, and what happens next.',
};

interface AuctionResultState {
  id: string;
  title: string;
  primaryImageUrl: string | null;
  status: string;
  startingBid: number | null;
  currentBid: number | null;
  currentBidderName: string | null;
  bidCount: number;
  reserveMet: boolean;
  hasReserve: boolean;
  startTime: string | null;
  endTime: string | null;
  endedAt: string | null;
}

type Outcome = {
  /** Short verdict, e.g. "Sold". */
  label: string;
  /** What this means for the person reading it. */
  detail: string;
  tone: 'success' | 'warning' | 'neutral';
};

/** SA-time date + time, or '—'. */
function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * The one decision this page makes from the public auction state.
 *
 * ⚠️ "WINNER DIDN'T PAY" HAS NO FLAG OF ITS OWN. The auction service marks a
 * closed-with-winner sale PAYMENT_PENDING, and if the 24h window lapses it
 * flips the row to CANCELLED. A seller/platform cancellation also lands on
 * CANCELLED, so the two cannot be told apart by status alone. The only signal
 * left in the payload is the relationship between when it ENDED and the end
 * time it was scheduled for: an auction cancelled before it closed has
 * endedAt < endTime, while one that closed properly has endedAt at/after
 * endTime. That distinction is used below to say "did not complete" rather
 * than accuse a seller of withdrawing — and never to claim a winner who was
 * never paid.
 */
function outcomeFor(state: AuctionResultState): Outcome {
  if (state.status === 'SOLD') {
    const soldFor = state.currentBid ?? state.startingBid;
    return {
      label: 'Sold',
      detail: `${soldFor ? formatPrice(soldFor) : 'The item'} was paid${
        state.currentBidderName ? ` by ${state.currentBidderName}` : ''
      } after ${state.bidCount} bid${state.bidCount === 1 ? '' : 's'}.`,
      tone: 'success',
    };
  }
  if (state.status === 'PAYMENT_PENDING') {
    return {
      label: 'Sold — awaiting payment',
      detail: `The winning bidder has 24 hours to complete payment. If that window lapses, the sale is cancelled.`,
      tone: 'warning',
    };
  }
  if (state.status === 'CANCELLED') {
    const closedAt = state.endedAt ? new Date(state.endedAt).getTime() : NaN;
    const wasDueAt = state.endTime ? new Date(state.endTime).getTime() : NaN;
    const cancelledBeforeClose =
      Number.isFinite(closedAt) &&
      Number.isFinite(wasDueAt) &&
      closedAt < wasDueAt;
    return {
      label: 'Cancelled',
      detail: cancelledBeforeClose
        ? 'This auction was cancelled before it closed. No sale was made and nothing is payable.'
        : 'This sale did not complete. No payment was taken and nothing is owed.',
      tone: 'neutral',
    };
  }
  if (state.status === 'EXPIRED') {
    if (state.bidCount === 0) {
      return {
        label: 'No bids',
        detail: 'This auction closed without a bid. Nothing was sold and nothing is payable.',
        tone: 'neutral',
      };
    }
    if (state.hasReserve && !state.reserveMet) {
      return {
        label: 'Reserve not met',
        detail: `The highest bid${state.currentBid ? ` of ${formatPrice(state.currentBid)}` : ''} did not reach the seller's reserve, so the item did not sell.`,
        tone: 'warning',
      };
    }
  }
  // ACTIVE (should not normally be reached from a notification, but a live
  // link may be opened again while the auction is still running) and any
  // status this page does not recognise. Saying less is the safe direction.
  return {
    label: 'Auction closed',
    detail: 'This auction is no longer running. See the live auctions for items you can still bid on.',
    tone: 'neutral',
  };
}

const TONE_STYLE: Record<Outcome['tone'], { color: string; wash: string }> = {
  success: { color: 'var(--success)', wash: 'var(--success-wash)' },
  warning: { color: 'var(--warning)', wash: 'var(--warning-wash)' },
  neutral: { color: 'var(--text-secondary)', wash: 'var(--bg-inset)' },
};

export default async function AuctionResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const state = await viewerFetch<AuctionResultState>(`/auctions/${id}`).catch(
    () => null,
  );

  if (!state) {
    return (
      <main className="max-w-[560px] mx-auto px-4 py-10">
        <h1
          className="text-lg font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Auction result unavailable
        </h1>
        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          We could not find this auction. It may have been removed, or the link
          may be incomplete.
        </p>
        <BrowseLinks />
      </main>
    );
  }

  // The listing link is offered only when the PDP would actually resolve —
  // EXPIRED/CANCELLED listings 404 for non-owners by design, and a link to a
  // 404 is worse than no link. Asking the PDP endpoint (rather than assuming
  // from status) keeps this page honest if that visibility rule changes.
  const listingResolves = await viewerFetch(`/listings/${state.id}`)
    .then(() => true)
    .catch(() => false);

  const outcome = outcomeFor(state);
  const tone = TONE_STYLE[outcome.tone];
  const finalPrice = state.currentBid ?? state.startingBid;

  return (
    <main className="max-w-[640px] mx-auto px-4 py-8">
      <p
        className="text-xs uppercase mb-1"
        style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}
      >
        Auction result
      </p>
      <h1
        className="text-xl font-medium mb-5 leading-snug"
        style={{ color: 'var(--text-primary)' }}
      >
        {state.title}
      </h1>

      <div className="flex gap-4 mb-5">
        {state.primaryImageUrl ? (
          <Image
            src={state.primaryImageUrl}
            alt={state.title}
            width={96}
            height={96}
            sizes="96px"
            className="w-24 h-24 rounded-[6px] object-cover flex-shrink-0"
            style={{ background: 'var(--bg-inset)' }}
          />
        ) : null}
        <div className="min-w-0">
          <div
            className="inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase mb-2"
            style={{
              background: tone.wash,
              color: tone.color,
              border: `0.5px solid ${tone.color}`,
              letterSpacing: '0.06em',
            }}
          >
            {outcome.label}
          </div>
          <p
            className="text-sm"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
          >
            {outcome.detail}
          </p>
        </div>
      </div>

      <dl
        className="rounded-[8px] p-4 mb-6 space-y-1 text-sm"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div className="flex justify-between">
          <dt style={{ color: 'var(--text-tertiary)' }}>
            {state.currentBid != null ? 'Final bid' : 'Starting bid'}
          </dt>
          <dd style={{ color: 'var(--text-primary)' }}>
            {finalPrice != null ? formatPrice(finalPrice) : '—'}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt style={{ color: 'var(--text-tertiary)' }}>Bids received</dt>
          <dd style={{ color: 'var(--text-primary)' }}>{state.bidCount}</dd>
        </div>
        {state.hasReserve ? (
          <div className="flex justify-between">
            <dt style={{ color: 'var(--text-tertiary)' }}>Reserve</dt>
            <dd style={{ color: state.reserveMet ? 'var(--success)' : 'var(--warning)' }}>
              {state.reserveMet ? 'Met' : 'Not met'}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt style={{ color: 'var(--text-tertiary)' }}>Closed</dt>
          <dd style={{ color: 'var(--text-primary)' }}>
            {formatWhen(state.endedAt ?? state.endTime)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/?listingType=AUCTION"
          className="px-4 py-2.5 rounded-[6px] text-sm"
          style={{
            background: 'var(--action-primary-bg)',
            color: '#fff',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Browse live auctions
        </Link>
        {listingResolves ? (
          <Link
            href={`/listings/${state.id}`}
            className="px-4 py-2.5 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-primary)',
              border: '0.5px solid var(--border-visible)',
              textDecoration: 'none',
            }}
          >
            View the listing
          </Link>
        ) : null}
      </div>
    </main>
  );
}

function BrowseLinks() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        href="/?listingType=AUCTION"
        className="px-4 py-2.5 rounded-[6px] text-sm"
        style={{
          background: 'var(--action-primary-bg)',
          color: '#fff',
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        Browse live auctions
      </Link>
      <Link
        href="/"
        className="px-4 py-2.5 rounded-[6px] text-sm"
        style={{
          background: 'var(--bg-inset)',
          color: 'var(--text-primary)',
          border: '0.5px solid var(--border-visible)',
          textDecoration: 'none',
        }}
      >
        Back to the marketplace
      </Link>
    </div>
  );
}
