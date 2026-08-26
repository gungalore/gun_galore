import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils';
import { PageReveal } from '@/components/page-reveal';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// hasReserve distinguishes "no reserve" from "reserve not met" — reserveMet
// is false for both, and the amber chip must only show for the latter.
interface MyBidRow {
  hasReserve: boolean;
  bidId: string;
  listingId: string;
  listingTitle: string;
  listingStatus: string;
  listingImage: string | null;
  myMaxAmount: number;
  myLastBidAmount: number;
  currentBid: number | null;
  reserveMet: boolean;
  endTime: string | null;
  endedAt: string | null;
  youAreHighBidder: boolean;
  isWinner: boolean;
  // NOT currently sent by /auctions/me/bids — the 24h pay deadline lives on
  // the listing's expiresAt and is read off the public listing detail below.
  // Declared optional so that the moment the backend adds it to the row
  // (auctions.service.ts getMyBids select), the extra fetch is skipped with
  // no further frontend change.
  payByAt?: string | null;
}

// Server-rendered static deadline chip for a WON auction awaiting payment —
// the same shape as the buyer-side ExpiryCountdown on /my/offers, with the
// auction consequence spelled out. This is load-bearing, not decoration:
// sweepUnpaidWins() flips the listing to EXPIRED **and** records a
// non-payment strike against the winner (3 strikes = no more bidding), so a
// winner who never saw the clock gets punished for a deadline nobody showed
// them. No live tick — the page is a server component (no-store), same
// accepted limitation as the offers-side countdown; a reload re-evaluates.
function PayDeadline({ payByAt }: { payByAt: string }) {
  const ms = new Date(payByAt).getTime() - Date.now();
  if (ms <= 0) {
    // Past due but not yet swept (the sweep runs on a cron, so there's a
    // gap). Never say "expired" — the win is still claimable until the
    // sweep lands, and telling them it's dead would stop them paying.
    return (
      <p
        className="text-xs mb-2 px-2 py-1 rounded"
        style={{
          background: 'rgba(200,16,46,0.10)',
          border: '0.5px solid var(--red)',
          color: 'var(--red)',
        }}
      >
        ⏱ Your payment window has closed — this win lapses at any moment and
        counts against your account. Pay now if you still want the item.
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
      ? {
          bg: 'rgba(245,158,11,0.10)',
          border: 'rgba(245,158,11,0.45)',
          label: '#f59e0b',
        }
      : {
          bg: 'var(--bg-inset)',
          border: 'var(--border)',
          label: 'var(--text-secondary)',
        };
  const left = hours >= 1 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return (
    <p
      className="text-xs mb-2 px-2 py-1 rounded"
      style={{
        background: tone.bg,
        border: `0.5px solid ${tone.border}`,
        color: tone.label,
      }}
    >
      ⏱ {left} left to pay — miss it and the sale lapses and counts against
      your account.
    </p>
  );
}

function remaining(endTime: string | null): string {
  if (!endTime) return '';
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return 'Ended';
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3_600);
  const mins = Math.floor((sec % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

// Time pressure has to LOOK like time pressure — "5m left" rendered in muted
// tertiary grey next to the bid amounts read as a footnote. Red under an hour,
// amber under six. This page is a server component with no polling, so the
// tone is correct as of render (same accepted limitation as the offers-side
// ExpiryCountdown); a reload re-evaluates it.
function remainingColor(endTime: string | null): string {
  if (!endTime) return 'var(--text-tertiary)';
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return 'var(--text-tertiary)';
  if (ms < 3_600_000) return 'var(--red)';
  if (ms < 6 * 3_600_000) return '#f59e0b';
  return 'var(--text-tertiary)';
}

export default async function MyBidsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/bids');

  const token = await getToken();
  const auctionRes = await fetch(`${API_URL}/auctions/me/bids`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const bids: MyBidRow[] = auctionRes.ok ? await auctionRes.json() : [];

  const live = bids.filter(
    (b) => b.listingStatus === 'ACTIVE' && !b.endedAt,
  );
  // Only a win still awaiting payment (listing PAYMENT_PENDING) belongs in
  // 'Won — pay now' with the /checkout CTA. A win that was PAID lands the
  // listing on SOLD; a lapsed win lands it on EXPIRED — both must NOT show
  // the (now-404ing) Complete Checkout button.
  const won = bids.filter(
    (b) => b.isWinner && b.listingStatus === 'PAYMENT_PENDING',
  );
  const purchased = bids.filter(
    (b) => b.isWinner && b.listingStatus === 'SOLD',
  );
  const closed = bids.filter(
    (b) =>
      !live.includes(b) && !won.includes(b) && !purchased.includes(b),
  );

  // Pay-by clock for the "Won — pay now" rows. /auctions/me/bids does NOT
  // return it, but the listing's `expiresAt` IS the 24h pay deadline while
  // the listing sits in PAYMENT_PENDING (sweepUnpaidWins reads exactly that
  // field) and it's part of the PUBLIC listing projection — so read it off
  // the public detail endpoint rather than leaving winners blind. Only the
  // handful of won-and-unpaid rows are fetched, and a failed fetch degrades
  // to "no chip" instead of throwing the page.
  //
  // NOTE: a null expiresAt is meaningful, not missing — starting checkout
  // CAS-nulls it, so a winner mid-checkout must NOT be shown a deadline.
  const payByEntries = await Promise.all(
    won.map(async (b) => {
      // Row already carries it (future backend) — don't spend a request.
      if (b.payByAt !== undefined) return [b.listingId, b.payByAt] as const;
      const r = await fetch(`${API_URL}/listings/${b.listingId}`, {
        cache: 'no-store',
      }).catch(() => null);
      if (!r || !r.ok) return [b.listingId, null] as const;
      const l = (await r
        .json()
        .catch(() => null)) as { expiresAt?: string | null } | null;
      return [b.listingId, l?.expiresAt ?? null] as const;
    }),
  );
  const payByAt = new Map<string, string | null>(payByEntries);

  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <PageReveal variant="slide-up">
      <h1
        data-reveal
        className="text-xl font-medium mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        My Bids
      </h1>

      {bids.length === 0 && (
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
            No bids yet
          </p>
          <p
            className="text-sm mb-5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Bid on a live auction to score gear at competitive prices.
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            <Link
              href="/?listingType=AUCTION"
              className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Browse live auctions →
            </Link>
          </div>
        </div>
      )}

      {/* ─── Auction bids on listings ─────────────────────────────── */}
      {live.length > 0 && (
        <div data-reveal><Section title="Live">
          {live.map((b) => (
            <BidCard key={b.bidId} row={b} />
          ))}
        </Section></div>
      )}

      {won.length > 0 && (
        <div data-reveal><Section title="Won — pay now">
          {won.map((b) => (
            <BidCard
              key={b.bidId}
              row={b}
              payByAt={payByAt.get(b.listingId) ?? null}
            />
          ))}
        </Section></div>
      )}

      {purchased.length > 0 && (
        <div data-reveal><Section title="Purchased">
          {purchased.map((b) => (
            <BidCard key={b.bidId} row={b} />
          ))}
        </Section></div>
      )}

      {closed.length > 0 && (
        <div data-reveal><Section title="Closed">
          {closed.map((b) => (
            <BidCard key={b.bidId} row={b} />
          ))}
        </Section></div>
      )}

      </PageReveal>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2
        className="text-xs uppercase mb-3"
        style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
      >
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function BidCard({
  row,
  payByAt = null,
}: {
  row: MyBidRow;
  // Only the "Won — pay now" section passes this (ISO pay-by timestamp);
  // null means either not-a-win or checkout already started (which nulls
  // the listing's expiresAt server-side).
  payByAt?: string | null;
}) {
  const ended = !!row.endedAt;
  const ahead = row.youAreHighBidder;
  // High bidder on a live RESERVE auction where the reserve isn't met yet:
  // "high bidder" alone reads as "winning", but the item won't sell at this
  // price — surface it so the buyer knows to bid higher.
  const reserveShort = !ended && ahead && row.hasReserve && !row.reserveMet;
  const statusLabel = row.isWinner
    ? 'You won'
    : ended
    ? 'Lost'
    : ahead
    ? reserveShort
      ? 'High bidder — reserve not met'
      : 'High bidder'
    : 'Outbid';
  const statusColor = row.isWinner
    ? '#22c55e'
    : ended
    ? 'var(--text-tertiary)'
    : ahead
    ? reserveShort
      ? '#f59e0b'
      : '#22c55e'
    : '#f59e0b';
  // Prominent Active vs Closed pill at the card head — the eye reads
  // intent instantly without parsing the detail row.
  const isActive = !ended && !row.isWinner;
  // Being outbid is the single highest-intent moment on this page and it was
  // the only state with no button at all. Gate on listingStatus ACTIVE too
  // (not just !endedAt) so a cancelled or already-sold listing never gets a
  // CTA pointing at a dead auction — that mirrors the `live` bucket exactly.
  const canIncrease = !ended && !ahead && row.listingStatus === 'ACTIVE';
  const timeColor = remainingColor(row.endTime);
  const timeUrgent = timeColor !== 'var(--text-tertiary)';

  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
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
        <span className="text-xs" style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </div>
      <div className="flex gap-3">
        {row.listingImage ? (
          <div className="relative w-16 h-16 flex-shrink-0 rounded-[4px] overflow-hidden">
            <Image
              src={row.listingImage}
              alt={row.listingTitle}
              fill
              className="object-cover"
              sizes="64px"
            />
          </div>
        ) : (
          <div
            className="w-16 h-16 flex-shrink-0 rounded-[4px] flex items-center justify-center text-xs"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-tertiary)',
            }}
          >
            No photo
          </div>
        )}
        <div className="flex-1 min-w-0">
          <Link
            href={`/listings/${row.listingId}`}
            className="text-sm font-medium leading-snug line-clamp-1"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {row.listingTitle}
          </Link>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Current bid:{' '}
              <span style={{ color: 'var(--text-primary)' }}>
                {row.currentBid !== null
                  ? formatPrice(row.currentBid)
                  : '—'}
              </span>
            </span>
            <span
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Your max:{' '}
              <span style={{ color: 'var(--text-primary)' }}>
                {formatPrice(row.myMaxAmount)}
              </span>
            </span>
            {!ended && row.endTime && (
              <span
                className="text-xs"
                style={{
                  color: timeColor,
                  fontWeight: timeUrgent ? 500 : undefined,
                }}
              >
                {remaining(row.endTime)}
              </span>
            )}
          </div>
        </div>
      </div>

      {canIncrease && (
        <div
          className="mt-3 pt-3"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <Link
            href={`/listings/${row.listingId}`}
            className="block w-full py-2.5 rounded-[6px] text-sm text-center"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Increase your bid →
          </Link>
        </div>
      )}

      {row.isWinner && row.listingStatus === 'PAYMENT_PENDING' && (
        <div
          className="mt-3 pt-3"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          {/* Deadline sits ABOVE the checkout button — it is the reason to
              press it. Absent while checkout is already underway. */}
          {payByAt && <PayDeadline payByAt={payByAt} />}
          <a
            href={`/checkout/${row.listingId}`}
            className="block w-full py-2.5 rounded-[6px] text-sm text-center"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Complete Checkout — {formatPrice(row.currentBid ?? 0)}
          </a>
        </div>
      )}
      {row.isWinner && row.listingStatus === 'SOLD' && (
        <div
          className="mt-3 pt-3"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <Link
            href="/transactions"
            className="block w-full py-2.5 rounded-[6px] text-sm text-center"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            View purchase
          </Link>
        </div>
      )}
      {row.isWinner &&
        row.listingStatus !== 'PAYMENT_PENDING' &&
        row.listingStatus !== 'SOLD' && (
          <div
            className="mt-3 pt-3 text-xs"
            style={{
              borderTop: '0.5px solid var(--border)',
              color: 'var(--text-tertiary)',
            }}
          >
            Payment window missed — this sale was cancelled.
          </div>
        )}
    </div>
  );
}

