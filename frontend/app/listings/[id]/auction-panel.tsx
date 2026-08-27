'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuctionOdometer } from '@/components/auction-odometer';
import Link from 'next/link';
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
  return `R ${(cents / 100).toLocaleString('en-ZA', {
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
  // Consecutive failed loads of GET /auctions/:id. Two different failure
  // shapes need two different treatments on a live-money surface:
  //   • no state yet + ≥1 failure → nothing to show, so render an error card
  //     with a Retry button instead of "Loading auction…" forever;
  //   • state exists + ≥3 failures → the numbers on screen are going stale,
  //     so warn quietly rather than letting a frozen countdown read as live.
  const [pollFailures, setPollFailures] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // Guards a fetch that is still in flight when the component unmounts (or
  // the listing changes) from writing into dead state.
  const aliveRef = useRef(true);

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
  // Hoisted out of the effect (useCallback) so the error card's Retry
  // button can re-run exactly the same load.
  const load = useCallback(async () => {
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
      // A non-2xx is a failure too, not "keep waiting" — the old code
      // silently ignored it, which is what left the panel stuck on
      // "Loading auction…" whenever the very first request 4xx/5xx'd.
      if (!stateRes.ok) throw new Error(`Auction fetch failed (${stateRes.status})`);
      const data = await stateRes.json();
      if (aliveRef.current) {
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
        setPollFailures(0);
      }
      if (mineRes && mineRes.ok) {
        const mine = (await mineRes.json()) as MyBidState | null;
        if (aliveRef.current) setMyBid(mine);
      } else if (!user) {
        if (aliveRef.current) setMyBid(null);
      }
    } catch {
      // Network blip or bad response — keep the last state on screen but
      // count the miss so the UI can admit it is not live any more.
      if (aliveRef.current) setPollFailures((n) => n + 1);
    }
  }, [listingId, user, getToken]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
  }, [load]);

  async function retryLoad() {
    setRetrying(true);
    await load();
    if (aliveRef.current) setRetrying(false);
  }

  if (!state) {
    // Nothing loaded yet AND at least one attempt failed → this is broken,
    // not slow. Say so and give the buyer a way out of the dead end.
    if (pollFailures > 0) {
      return (
        <div
          className="rounded-[6px] px-4 py-4 mb-5 text-sm"
          role="alert"
          style={{
            background: 'rgba(200,16,46,0.08)',
            border: '0.5px solid var(--red)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          <p style={{ color: 'var(--red)', fontWeight: 600 }}>
            Couldn&apos;t load this auction
          </p>
          <p className="mt-1">
            The live bid and countdown are unavailable — you may be offline, or
            the connection dropped. Nothing has changed on your side.
          </p>
          <button
            type="button"
            onClick={() => void retryLoad()}
            disabled={retrying}
            className="w-full mt-3 py-2.5 rounded-[6px] text-sm font-medium"
            style={{
              background: retrying ? 'var(--bg-inset)' : 'var(--red)',
              color: retrying ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: retrying ? 'not-allowed' : 'pointer',
            }}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      );
    }
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
  // "Over" means EITHER the client clock passed endTime OR the backend has
  // already moved the listing off ACTIVE. Both matter: the clock flips first
  // (finalizeAuction runs on a 1-minute cron, so there's a gap where the
  // countdown reads 0 but no outcome exists yet), and the status is the only
  // thing that tells us WHICH outcome happened. Keying the closed UI on the
  // clock alone is why every ended auction — win, reserve-not-met, cancelled
  // — used to read as the same flat "Bidding has closed."
  const auctionOver = remaining.ended || state.status !== 'ACTIVE';
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
      {/* Reconnecting hint — three polls in a row (~15s) have failed while
          we still have an old snapshot on screen. The countdown keeps
          ticking off the last known endTime, so without this the bidder
          would read stale numbers as live ones on a money surface. */}
      {pollFailures >= 3 && (
        <div
          className="rounded-[6px] px-3 py-2 text-xs flex items-center justify-between gap-2"
          role="status"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>Reconnecting… the bid shown may be out of date.</span>
          <button
            type="button"
            onClick={() => void retryLoad()}
            disabled={retrying}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--red)',
              fontWeight: 500,
              cursor: retrying ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              whiteSpace: 'nowrap',
            }}
          >
            {retrying ? 'Retrying…' : 'Retry now'}
          </button>
        </div>
      )}

      {/* Snipe-extension banner — transient (8s) callout when the
          backend extends endTime in response to a last-minute bid. */}
      {now < extendedBannerUntil && (
        <div
          className="rounded-[6px] px-3 py-2 text-xs flex items-center gap-2"
          style={{
            background: 'rgba(245,158,11,0.10)',
            border: '0.5px solid var(--warning)',
            color: 'var(--warning)',
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

      {/* The live price and countdown, as one piece.
          ⚠️ THIS REPLACED TWO BLOCKS, not one: a price card and a separate
          four-column D/H/M/S countdown card further down. The odometer carries
          both, and keeping either alongside it would have shown the same bid
          and the same clock twice. The DATA is unchanged — the same 1Hz tick
          and the same 5s poll feed it. */}
      <AuctionOdometer
        amountCents={state.currentBid ?? state.startingBid}
        bidCount={state.bidCount}
        endTime={auctionOver ? null : state.endTime}
        footnote={
          state.bidCount === 0 ? 'Starting bid — no bids yet' : undefined
        }
      />

      {/* What the odometer does NOT carry. The pack modelled none of this and
          all of it matters: who is winning, whether the hidden reserve is met,
          and why a starting bid sits where it does. */}
      <div
        className="rounded-[6px] px-4 py-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        {state.bidCount === 0 && state.hasReserve && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span
              className="text-xs uppercase"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
            >
              Starting bid
            </span>
            <HelpTip title="Starting bid" side="bottom">
              The starting bid is 30% below the seller&apos;s hidden
              reserve price. Bidding can start low, but the auction
              only closes a sale once the reserve is met.
            </HelpTip>
          </span>
        )}

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
                color: myBid?.isHighBidder ? 'var(--success)' : 'var(--text-primary)',
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
                  color: state.reserveMet ? 'var(--success)' : 'var(--text-tertiary)',
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

      {/* Outbid banner — shows when the signed-in user previously
          placed a bid but is no longer the high bidder. Distinguishes
          "exceeded your max" (another bidder went above) from "tied
          your max" (matched it; ties go to whoever bid first), since
          users hit the tie case often and the wording matters. */}
      {myBid?.hasBid && !myBid.isHighBidder && !auctionOver && (
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

      {/* Outcome first, ownership second: once an auction is over "you can't
          bid on your own auction" is noise, while WHAT HAPPENED (won /
          reserve not met / cancelled) matters to the seller too. The seller
          can never be the high bidder, so pass null and they get the
          third-party wording, never the winner's pay CTA. */}
      {auctionOver ? (
        <EndedAuctionNotice
          listingId={listingId}
          status={state.status}
          bidCount={state.bidCount}
          hasReserve={state.hasReserve}
          reserveMet={state.reserveMet}
          currentBid={state.currentBid}
          endedAt={state.endedAt}
          myBid={isOwnAuction ? null : myBid}
          now={now}
        />
      ) : isOwnAuction ? (
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
                color: myBid?.proxyActive ? 'var(--success)' : '#fff',
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

// ─── Ended-auction outcome ──────────────────────────────────────────
//
// Every viewer used to get the same "Bidding has closed." line — including
// the WINNER, whose only path to pay was the single "you won" SMS. Miss that
// SMS and the 24h clock runs out: listing EXPIREs and the backend records a
// strike against the bidder (auctions.service.ts sweepUnpaidWins). The
// listing page is the most natural place for a winner to come back to, so it
// has to carry the pay CTA too.
//
// No new endpoint is involved: /auctions/:id already returns status +
// endedAt, and /auctions/:id/me returns isHighBidder, which stays true after
// close (it's computed off listing.currentBidderId, which finalize doesn't
// clear). /checkout/<listingId> is the same page the SMS token link lands on
// and it explicitly handles AUCTION + PAYMENT_PENDING.

// finalizeAuction sets listing.expiresAt = endedAt + 24h as the pay-by time,
// but the public auction-state payload doesn't carry expiresAt. Deriving it
// from endedAt gives the identical instant with no payload change.
const PAY_WINDOW_MS = 24 * 60 * 60 * 1000;

function payByFrom(endedAt: string | null): Date | null {
  if (!endedAt) return null;
  const t = new Date(endedAt).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + PAY_WINDOW_MS);
}

// Absolute deadline, SAST-local in the reader's own locale settings. Shown
// alongside a relative "about Nh left" because an absolute time alone is easy
// to misjudge and a relative one alone is easy to forget.
function formatDeadline(d: Date): string {
  return d.toLocaleString('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatLeft(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? '' : 's'} left`;
  return 'about 24 hours left';
}

function EndedAuctionNotice({
  listingId,
  status,
  bidCount,
  hasReserve,
  reserveMet,
  currentBid,
  endedAt,
  myBid,
  now,
}: {
  listingId: string;
  status: string;
  bidCount: number;
  hasReserve: boolean;
  reserveMet: boolean;
  currentBid: number | null;
  endedAt: string | null;
  myBid: MyBidState | null;
  now: number;
}) {
  const neutral: React.CSSProperties = {
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-tertiary)',
  };

  // ── Winner: the only state on this page with an action attached. ──
  if (status === 'PAYMENT_PENDING' && myBid?.isHighBidder) {
    const payBy = payByFrom(endedAt);
    const msLeft = payBy ? payBy.getTime() - now : null;
    const lapsed = msLeft !== null && msLeft <= 0;
    return (
      <div
        className="rounded-[6px] px-4 py-4 text-sm"
        role="status"
        style={{
          background: 'rgba(34,197,94,0.10)',
          border: '0.5px solid rgba(34,197,94,0.55)',
          color: 'var(--text-secondary)',
          lineHeight: 1.55,
        }}
      >
        <p style={{ color: 'var(--success)', fontWeight: 600 }}>
          🏆 You won this auction
        </p>
        <p className="mt-1">
          Winning bid{' '}
          <strong style={{ color: 'var(--text-primary)' }}>
            {formatRand(currentBid ?? 0)}
          </strong>
          .{' '}
          {payBy
            ? lapsed
              ? 'Your 24-hour payment window has passed — the sale may already have been cancelled.'
              : `Complete checkout by ${formatDeadline(payBy)} (${formatLeft(msLeft!)}).`
            : 'Complete checkout within 24 hours of the auction closing.'}
        </p>
        <Link
          href={`/checkout/${listingId}`}
          className="block w-full mt-3 py-3 rounded-[6px] text-sm text-center"
          style={{
            background: 'var(--red)',
            color: '#fff',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Complete checkout — {formatRand(currentBid ?? 0)}
        </Link>
        <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
          If checkout isn&apos;t completed in time the sale is cancelled, the
          seller can relist, and a strike is recorded against your bidding
          account.
        </p>
      </div>
    );
  }

  // ── Someone else won (or nobody here is signed in as the winner). ──
  if (status === 'PAYMENT_PENDING') {
    return (
      <div className="rounded-[6px] px-4 py-3 text-sm" style={neutral}>
        {myBid?.hasBid
          ? 'Bidding has closed — you weren’t the high bidder. '
          : 'Bidding has closed. '}
        The winning bidder has 24 hours to complete checkout.
      </div>
    );
  }

  if (status === 'SOLD') {
    return (
      <div className="rounded-[6px] px-4 py-3 text-sm" style={neutral}>
        Sold — this auction closed and the sale went through.
      </div>
    );
  }

  if (status === 'CANCELLED') {
    return (
      <div className="rounded-[6px] px-4 py-3 text-sm" style={neutral}>
        Auction cancelled — the seller withdrew this listing before it closed.
      </div>
    );
  }

  if (status === 'EXPIRED') {
    // Three very different endings all land on EXPIRED, and buyers read them
    // completely differently: reserve-not-met (finalize case B), a winner who
    // never paid (sweepUnpaidWins), and a run with no bids at all (case C).
    if (bidCount > 0 && hasReserve && !reserveMet) {
      return (
        <div className="rounded-[6px] px-4 py-3 text-sm" style={neutral}>
          Auction ended — reserve not met. The top bid of{' '}
          {formatRand(currentBid ?? 0)} stayed below the seller&apos;s
          minimum, so no sale was made. They may relist it.
        </div>
      );
    }
    if (bidCount > 0) {
      return (
        <div className="rounded-[6px] px-4 py-3 text-sm" style={neutral}>
          Auction ended — the sale wasn&apos;t completed within the payment
          window. The seller may relist it.
        </div>
      );
    }
    return (
      <div className="rounded-[6px] px-4 py-3 text-sm" style={neutral}>
        Auction ended with no bids.
      </div>
    );
  }

  // Clock passed endTime but the 1-minute finalize cron hasn't claimed the
  // row yet. The panel polls every 5s, so this resolves itself — say so
  // rather than implying a final result that hasn't been decided.
  return (
    <div className="rounded-[6px] px-4 py-3 text-sm" style={neutral}>
      Bidding has closed — we&apos;re finalising the result. This page updates
      itself within a minute.
    </div>
  );
}

// One D / H / M / S column in the big countdown card. The value is
// zero-padded for hours/mins/secs so the timer doesn't visually wobble
// when it ticks from 10 → 9 (single digit vs double). Days is shown
// unpadded because "01 Days" looks weird and we usually only see days
// on multi-day auctions.

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
      // data-blocking-overlay is read by the listing page's sticky mobile buy
      // bar (a CSS :has() rule hides the bar while this is mounted). The bar
      // lives in a sibling stacking context, so z-index alone can't keep it
      // behind this overlay — the attribute is the contract between the two.
      data-blocking-overlay="true"
      role="dialog"
      aria-modal="true"
      aria-label={kind === 'placeBid' ? 'Place bid' : 'Set auto bid'}
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
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
