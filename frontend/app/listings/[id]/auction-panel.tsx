'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser, useAuth, SignInButton } from '@clerk/nextjs';
import { HelpTip } from '@/components/help-tip';
import { HelpText } from '@/components/help-text';
import {
  BidStepper,
  bidIncrement,
  formatRandStrict,
} from '@/components/bid-stepper';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// (bidIncrement, BidStepper, formatRandStrict moved to
//  @/components/bid-stepper.tsx so the SMS-link /a/<token> page can
//  share the same UI + tier table.)
// Mirror of backend INCREMENT_TIERS (auctions.service.ts). Kept here so
// the +/- stepper can locally step by the right amount without a round
// trip per click. If the backend tiers change, this needs to match.
// bidIncrement is now imported from @/components/bid-stepper

interface AuctionState {
  id: string;
  status: string;
  startingBid: number;
  currentBid: number | null;
  currentBidderName: string | null;
  bidCount: number;
  reserveMet: boolean;
  hasReserve: boolean;
  startTime: string | null;
  endTime: string | null;
  endedAt: string | null;
  nextMinBid: number;
  recentBids: {
    id: string;
    amount: number;
    bidderName: string;
    wasCountered: boolean;
    createdAt: string;
  }[];
}

interface MyBidState {
  hasBid: boolean;
  maxAmount: number | null;
  isHighBidder: boolean;
  proxyActive: boolean;
}

function formatRand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

// Countdown for the big timer card. Returns each unit separately so the
// JSX can lay them out as four "D / H / M / S" blocks with labels.
// `closing` flips true in the last 5 minutes so the card can turn red.
function formatRemaining(endTime: string | null): {
  days: number;
  hours: number;
  mins: number;
  secs: number;
  ended: boolean;
  closing: boolean;
} {
  if (!endTime) {
    return { days: 0, hours: 0, mins: 0, secs: 0, ended: false, closing: false };
  }
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) {
    return { days: 0, hours: 0, mins: 0, secs: 0, ended: true, closing: false };
  }
  const sec = Math.floor(ms / 1000);
  return {
    days: Math.floor(sec / 86_400),
    hours: Math.floor((sec % 86_400) / 3_600),
    mins: Math.floor((sec % 3_600) / 60),
    secs: sec % 60,
    ended: false,
    closing: ms < 5 * 60 * 1000,
  };
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export default function AuctionPanel({
  listingId,
  sellerClerkId,
}: {
  listingId: string;
  sellerClerkId: string;
}) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [state, setState] = useState<AuctionState | null>(null);
  const [myBid, setMyBid] = useState<MyBidState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [now, setNow] = useState(Date.now());
  // Snipe-protection banner — appears for 8s when we detect that the
  // poll's new endTime is ≥30s further out than the previous one.
  // Comes from the server-side end-extension that auctions.service.ts
  // applies when a bid lands inside the last 2 min. Without surfacing
  // it, the visible countdown jumps and looks like a glitch.
  const prevEndTimeRef = useRef<string | null>(null);
  const [extendedBannerUntil, setExtendedBannerUntil] = useState(0);

  // Which modal is open. The three CTAs each open their own; only one
  // is ever visible at a time. null = closed.
  const [openModal, setOpenModal] = useState<
    null | 'placeBid' | 'autoBid'
  >(null);

  // Tick once per second for the countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll auction state every 5s so other bidders' actions show up,
  // and fetch the signed-in user's proxy state in parallel so the
  // Auto Bid button can display the active max.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const token = user ? await getToken() : null;
        const [stateRes, mineRes] = await Promise.all([
          fetch(`${API_URL}/auctions/${listingId}`, { cache: 'no-store' }),
          token
            ? fetch(`${API_URL}/auctions/${listingId}/me`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
              })
            : Promise.resolve(null),
        ]);
        if (stateRes.ok) {
          const data = await stateRes.json();
          if (!cancelled) {
            // Detect snipe-protection extension: if the new endTime
            // is ≥30s further out than the last one we saw, the
            // backend extended the auction. Show a transient banner
            // for 8s so the bidder knows why the timer jumped.
            const prev = prevEndTimeRef.current;
            if (
              prev &&
              data.endTime &&
              new Date(data.endTime).getTime() - new Date(prev).getTime() >= 30_000
            ) {
              setExtendedBannerUntil(Date.now() + 8_000);
            }
            prevEndTimeRef.current = data.endTime ?? null;
            setState(data);
          }
        }
        if (mineRes && mineRes.ok) {
          const mine = (await mineRes.json()) as MyBidState | null;
          if (!cancelled) setMyBid(mine);
        } else if (!user) {
          if (!cancelled) setMyBid(null);
        }
      } catch {
        /* network blip — keep last state */
      }
    }

    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [listingId, user, getToken]);

  if (!state) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 mb-5 text-sm text-center"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-tertiary)',
        }}
      >
        Loading auction…
      </div>
    );
  }

  const remaining = formatRemaining(state.endTime);
  const isOwnAuction = isLoaded && user?.id === sellerClerkId;

  // Shared bid-submit. Both Place Bid (one-shot) and Auto Bid (proxy)
  // hit the same endpoint with the same shape — only `isOneShot`
  // differs. Returning the success confirmation here keeps the two
  // modal flows nearly identical.
  async function submitBid(amountCents: number, isOneShot: boolean) {
    if (!amountCents || amountCents < (state?.nextMinBid ?? 0)) {
      setError(`Minimum bid is ${formatRand(state?.nextMinBid ?? 0)}`);
      return false;
    }
    setSubmitting(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/auctions/${listingId}/bids`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ maxAmount: amountCents, isOneShot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setConfirmation(
        data.youAreHighBidder
          ? `You are the high bidder at ${formatRand(data.currentBid)}.`
          : `Your bid is in but you were outbid. Current bid: ${formatRand(data.currentBid)}.`,
      );
      // Refresh state immediately so the header + countdown update.
      // Also refresh the user's own bid state so the Auto Bid button
      // flips to "ACTIVE · R{max}" without waiting for the 5s poll.
      const [fresh, mineFresh] = await Promise.all([
        fetch(`${API_URL}/auctions/${listingId}`, { cache: 'no-store' }),
        fetch(`${API_URL}/auctions/${listingId}/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ]);
      if (fresh.ok) setState(await fresh.json());
      if (mineFresh.ok) setMyBid(await mineFresh.json());
      setOpenModal(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bid');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelProxy() {
    // No confirm() dialog — some browsers eat browser-level confirms in
    // async click handlers, and the action is fully reversible (the
    // user can re-raise Auto Bid in two clicks). Keep it instant.
    setSubmitting(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/auctions/${listingId}/cancel-proxy`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setConfirmation(
        data.alreadyCancelled
          ? 'No active proxy to cancel.'
          : 'Auto bid cancelled. You remain the high bidder.',
      );
      // Refresh both state surfaces immediately.
      const [fresh, mineFresh] = await Promise.all([
        fetch(`${API_URL}/auctions/${listingId}`, { cache: 'no-store' }),
        fetch(`${API_URL}/auctions/${listingId}/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ]);
      if (fresh.ok) setState(await fresh.json());
      if (mineFresh.ok) setMyBid(await mineFresh.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel auto bid');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-5 space-y-3">
      {/* Snipe-extension banner — transient (8s) callout when the
          backend extends endTime in response to a last-minute bid. */}
      {now < extendedBannerUntil && (
        <div
          className="rounded-[6px] px-3 py-2 text-xs flex items-center gap-2"
          style={{
            background: 'rgba(245,158,11,0.10)',
            border: '0.5px solid #f59e0b',
            color: '#f59e0b',
            fontWeight: 500,
          }}
        >
          <span>⏱</span>
          <span>
            Auction extended — a last-minute bid triggered the 2-minute
            snipe-protection window.
          </span>
        </div>
      )}

      {/* Bid header — current/starting bid + reserve indicator. */}
      <div
        className="rounded-[6px] px-4 py-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div className="flex items-baseline justify-between mb-1">
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span
              className="text-xs uppercase"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
            >
              {state.bidCount === 0 ? 'Starting bid' : 'Current bid'}
            </span>
            {state.bidCount === 0 && state.hasReserve && (
              <HelpTip title="Starting bid" side="bottom">
                The starting bid is 30% below the seller&apos;s hidden
                reserve price. Bidding can start low, but the auction
                only closes a sale once the reserve is met.
              </HelpTip>
            )}
          </span>
          <span
            className="text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {state.bidCount} bid{state.bidCount === 1 ? '' : 's'}
          </span>
        </div>
        <div
          className="text-2xl"
          style={{ color: 'var(--red)', fontWeight: 500 }}
        >
          {formatRand(state.currentBid ?? state.startingBid)}
        </div>

        {/* Current high bidder — surfaces the actual winner so the
            user doesn't have to infer from the bid history (where
            proxy counters get attributed to the new bidder, not the
            proxy holder). */}
        {state.currentBidderName && state.bidCount > 0 && (
          <p
            className="text-xs mt-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            High bidder:{' '}
            <span
              style={{
                color: myBid?.isHighBidder ? '#22c55e' : 'var(--text-primary)',
                fontWeight: 500,
              }}
            >
              {myBid?.isHighBidder ? 'You ✓' : state.currentBidderName}
            </span>
          </p>
        )}

        {/* Reserve indicator + starting-bid pricing explainer.
            Buyers see "Starting bid is 30% below the seller's reserve."
            only when an actual reserve exists — for no-reserve auctions
            the starting bid is whatever the seller set directly, so the
            line would be misleading. */}
        {state.hasReserve && (
          <>
            <span
              className="mt-2"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <p
                className="text-xs"
                style={{
                  color: state.reserveMet ? '#16a34a' : 'var(--text-tertiary)',
                }}
              >
                {state.reserveMet ? '✓ Reserve met' : 'Reserve not yet met'}
              </p>
              <HelpTip title="Reserve price" side="bottom">
                The reserve is the lowest price the seller will accept,
                set privately at listing time. Bids count toward closing
                the sale only once the reserve is reached. The reserve
                amount stays hidden from bidders.
              </HelpTip>
            </span>
            {state.bidCount === 0 && (
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Starting bid is 30% below the seller&apos;s reserve.
              </p>
            )}
          </>
        )}
      </div>

      {/* Big countdown card — dedicated block, four D/H/M/S columns.
          Turns red in the last 5 minutes so the closing rush is
          obvious. Replaces the small "Time remaining: 2h 14m" line
          we had before — operator wanted the timer to feel like the
          centrepiece of the page, not a footnote. */}
      <div
        className="rounded-[6px] px-4 py-5"
        style={{
          background: remaining.closing
            ? 'rgba(200,16,46,0.10)'
            : 'var(--bg-card)',
          border: `0.5px solid ${
            remaining.closing ? 'var(--red)' : 'var(--border)'
          }`,
        }}
      >
        <p
          className="text-xs uppercase mb-3 text-center"
          style={{
            color: remaining.closing ? 'var(--red)' : 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            fontWeight: 500,
          }}
        >
          {remaining.ended ? 'Auction ended' : 'Time remaining'}
        </p>
        {remaining.ended ? (
          <p
            className="text-center text-lg"
            style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
          >
            Closed
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 text-center">
            <TimerCell
              value={remaining.days}
              label="Days"
              closing={remaining.closing}
            />
            <TimerCell
              value={remaining.hours}
              label="Hours"
              closing={remaining.closing}
              padded
            />
            <TimerCell
              value={remaining.mins}
              label="Mins"
              closing={remaining.closing}
              padded
            />
            <TimerCell
              value={remaining.secs}
              label="Secs"
              closing={remaining.closing}
              padded
            />
          </div>
        )}
      </div>

      {/* Outbid banner — shows when the signed-in user previously
          placed a bid but is no longer the high bidder. Distinguishes
          "exceeded your max" (another bidder went above) from "tied
          your max" (matched it; ties go to whoever bid first), since
          users hit the tie case often and the wording matters. */}
      {myBid?.hasBid && !myBid.isHighBidder && !remaining.ended && (
        <div
          className="rounded-[6px] px-4 py-3 text-sm"
          style={{
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            color: 'var(--text-primary)',
            lineHeight: 1.5,
          }}
        >
          <span style={{ color: 'var(--red)', fontWeight: 600 }}>
            You were outbid
          </span>
          {myBid.maxAmount != null && state.currentBid != null && (
            <span style={{ color: 'var(--text-secondary)' }}>
              {' '}—{' '}
              {state.currentBid > myBid.maxAmount
                ? `another bidder went above your max of ${formatRand(myBid.maxAmount)}.`
                : `another bidder matched your max of ${formatRand(myBid.maxAmount)} (ties go to the bidder who got there first).`}
            </span>
          )}{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            Raise your bid to stay in the running.
          </span>
        </div>
      )}

      {/* Owner's view */}
      {isOwnAuction ? (
        <div
          className="rounded-[6px] px-4 py-3 text-sm text-center"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          This is your auction — you can&apos;t bid on it.
        </div>
      ) : remaining.ended ? (
        <div
          className="rounded-[6px] px-4 py-3 text-sm text-center"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          Bidding has closed.
        </div>
      ) : !user ? (
        <SignInButton mode="modal">
          <button
            type="button"
            className="w-full py-3 rounded-[6px] text-sm font-medium"
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Sign in to bid
          </button>
        </SignInButton>
      ) : (
        <>
          {/* Three red CTAs. The bid amount no longer lives inline —
              each button opens its own modal with a +/- stepper. Buy
              Now only renders when the seller offered one AND no bids
              have landed yet (matches backend's buyNow eligibility). */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => { setError(''); setOpenModal('placeBid'); }}
              disabled={submitting}
              className="w-full py-3 rounded-[6px] text-sm font-medium"
              style={{
                background: 'var(--red)',
                color: '#fff',
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              Place Bid
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setOpenModal('autoBid'); }}
              disabled={submitting}
              className="w-full py-3 rounded-[6px] text-sm font-medium"
              style={{
                background:
                  myBid?.proxyActive ? 'rgba(34,197,94,0.18)' : 'var(--red)',
                color: myBid?.proxyActive ? '#22c55e' : '#fff',
                border: myBid?.proxyActive
                  ? '0.5px solid rgba(34,197,94,0.55)'
                  : 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {myBid?.proxyActive && myBid.maxAmount != null
                ? `Auto Bid · ACTIVE · ${formatRand(myBid.maxAmount)} (Raise)`
                : 'Auto Bid'}
            </button>
            {myBid?.proxyActive && (
              <button
                type="button"
                onClick={cancelProxy}
                disabled={submitting}
                className="w-full -mt-1 py-2 text-xs"
                style={{
                  background: 'transparent',
                  color: 'var(--text-tertiary)',
                  border: 'none',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Cancel auto bid (keep current lead, stop auto-countering)
              </button>
            )}
            {/*
              AUDIT M9 — Auction Buy-Now is temporarily disabled:
              the backend buyNow() returns a price but does not reserve
              the listing, and the subsequent /checkout/[listingId]
              redirect 404s on a non-ACTIVE auction (BUY_NOW listings
              are the only ones the checkout page currently handles).
              Re-enable once the auction winner-pay path lands and is
              proven to drive the buyer all the way through to paid.
              Hidden rather than disabled to avoid teasing a non-working
              feature; the inline help text below is also tightened.
            */}
          </div>
          <HelpText>
            <strong style={{ color: 'var(--text-secondary)' }}>Place Bid</strong> sets one
            exact amount; if outbid, come back and bid again.{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>Auto Bid</strong> sets your
            maximum and we keep you in front automatically up to that
            ceiling — your max stays private.
          </HelpText>

          {error && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}
          {confirmation && (
            <p
              className="text-xs mt-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {confirmation}
            </p>
          )}

          {/* Modals — only one open at a time. */}
          {openModal === 'placeBid' && (
            <BidModal
              kind="placeBid"
              minCents={state.nextMinBid}
              onCancel={() => setOpenModal(null)}
              onSubmit={(cents) => submitBid(cents, true)}
              submitting={submitting}
              error={error}
            />
          )}
          {openModal === 'autoBid' && (
            <BidModal
              kind="autoBid"
              minCents={state.nextMinBid}
              onCancel={() => setOpenModal(null)}
              onSubmit={(cents) => submitBid(cents, false)}
              submitting={submitting}
              error={error}
            />
          )}
        </>
      )}

      {/* Bid history */}
      {state.recentBids.length > 0 && (
        <div
          className="rounded-[6px] p-3 text-xs"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <p
            className="uppercase mb-2"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.05em',
            }}
          >
            Recent bids
          </p>
          <ul className="space-y-1">
            {state.recentBids.map((b) => (
              <li
                key={b.id}
                className="flex justify-between items-center"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {b.bidderName}
                  {b.wasCountered && (
                    <span
                      title="This bid was auto-countered by another bidder's proxy"
                      style={{
                        fontSize: 9,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--text-tertiary)',
                        background: 'var(--bg-inset)',
                        border: '0.5px solid var(--border)',
                        padding: '1px 5px',
                        borderRadius: 3,
                      }}
                    >
                      proxy counter
                    </span>
                  )}
                </span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {formatRand(b.amount)}
                </span>
              </li>
            ))}
          </ul>
          <p
            className="text-[11px] mt-2"
            style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
          >
            Rows tagged <em>proxy counter</em> are amounts pushed up by
            an existing proxy bid — the bidder&apos;s actual attempt was
            lower. The high bidder shown above is the true winner.
          </p>
        </div>
      )}
    </div>
  );
}

// One D / H / M / S column in the big countdown card. The value is
// zero-padded for hours/mins/secs so the timer doesn't visually wobble
// when it ticks from 10 → 9 (single digit vs double). Days is shown
// unpadded because "01 Days" looks weird and we usually only see days
// on multi-day auctions.
function TimerCell({
  value,
  label,
  closing,
  padded = false,
}: {
  value: number;
  label: string;
  closing: boolean;
  padded?: boolean;
}) {
  return (
    <div
      className="rounded-[4px] py-2"
      style={{
        background: closing ? 'rgba(200,16,46,0.08)' : 'var(--bg-inset)',
        border: `0.5px solid ${
          closing ? 'rgba(200,16,46,0.3)' : 'var(--border)'
        }`,
      }}
    >
      <div
        className="text-2xl sm:text-3xl"
        style={{
          color: closing ? 'var(--red)' : 'var(--text-primary)',
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {padded ? pad2(value) : value}
      </div>
      <div
        className="text-[10px] uppercase mt-1"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Bid modals (Place Bid + Auto Bid) ──────────────────────────────
// Both kinds share the same UI shape: a header, an explainer, the
// +/- stepper, and a red CTA. Only the copy + the `isOneShot` flag
// passed to onSubmit differs — kept as one component to avoid the
// "two slightly different copies that drift" failure mode.
function BidModal({
  kind,
  minCents,
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  kind: 'placeBid' | 'autoBid';
  minCents: number;
  onCancel: () => void;
  onSubmit: (cents: number) => Promise<boolean | void> | void;
  submitting: boolean;
  // Server rejection to show INSIDE the modal. The panel renders its own
  // error line too, but that sits UNDERNEATH this overlay — without this
  // prop a failed bid looked like "nothing happened" (user-reported).
  error?: string;
}) {
  // Stepper starts at the lowest legal bid and steps in tiered
  // increments. State is local so closing the modal resets it.
  const [valueCents, setValueCents] = useState(minCents);

  const title = kind === 'placeBid' ? 'Place Bid' : 'Auto Bid';
  const ctaLabel = kind === 'placeBid' ? 'Place Bid' : 'Set Auto Bid';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-[8px] p-6 max-w-sm w-full"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="text-lg mb-3"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          {title}
        </h3>

        {kind === 'autoBid' ? (
          <p
            className="text-xs mb-4"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            Set your maximum. We&apos;ll bid the minimum needed to keep
            you in front and auto-counter other bidders up to your
            ceiling. Your maximum is private — other bidders only see
            the visible amount.
          </p>
        ) : (
          <p
            className="text-xs mb-4"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            Bid exactly this amount right now. If someone outbids you,
            we won&apos;t auto-counter for you — you&apos;ll need to come
            back and bid again.
          </p>
        )}

        <BidStepper
          valueCents={valueCents}
          onChange={setValueCents}
          minCents={minCents}
        />

        {error && (
          <p
            className="text-xs mt-3"
            role="alert"
            style={{ color: 'var(--red)', lineHeight: 1.5 }}
          >
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit(valueCents)}
            disabled={submitting || valueCents < minCents}
            className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
            style={{
              background:
                submitting || valueCents < minCents
                  ? 'var(--bg-inset)'
                  : 'var(--red)',
              color:
                submitting || valueCents < minCents
                  ? 'var(--text-tertiary)'
                  : '#fff',
              border: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : `${ctaLabel} — ${formatRandStrict(valueCents)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// BidStepper + formatRandStrict are now imported from
// @/components/bid-stepper. Same UI + tier-table is reused on the
// SMS-link /a/<token> auction page.
