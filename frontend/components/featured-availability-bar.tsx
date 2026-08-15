'use client';

// Featured-spots availability bar — shown under the homepage "Featured"
// header. Two jobs the operator asked for (2026-07-21):
//   1. Tell people how many slots are open + how many are taking bids.
//   2. Give sellers a place to CLICK into a bid on a specific open slot
//      (the marquee only shows filled slots, so there was no bid entry
//      once the homepage had featured ads).
//
// Data: public GET /featured/summary (counts + the biddable slots, with
// public bid amounts/counts but no bidder identity). Each open-slot chip
// deep-links to /featured/bid?slot=<id> which pre-selects that slot.
//
// Self-hides only if the summary can't load; otherwise always renders a
// bid entry point so the homepage is never a dead end for sellers.

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface OpenSlot {
  id: string;
  slotNumber: number;
  status: 'AUCTION_RUNNING' | 'VACANT' | string;
  auctionOpen: boolean;
  closesAt: string | null;
  topBidCents: number | null;
  bidCount: number;
}
interface Summary {
  totalSlots: number;
  openCount: number;
  takingBidsCount: number;
  occupiedCount: number;
  topBidCents: number | null;
  openSlots: OpenSlot[];
}

function rand(cents: number): string {
  return 'R' + Math.round(cents / 100).toLocaleString('en-ZA');
}

export function FeaturedAvailabilityBar() {
  const [sum, setSum] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_URL}/featured/summary`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as Summary;
        if (!cancelled) setSum(data);
      } catch {
        // Decorative — keep the last good snapshot on a network blip.
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!sum) return null;

  const { openCount, takingBidsCount, totalSlots, topBidCents } = sum;

  // No slots configured at all. Distinct from "all taken": openCount is 0 in
  // both cases, so the copy below would have announced "All spots taken right
  // now" on a site with zero spots, over a CTA to bid on one of them. Render
  // nothing instead — there is genuinely nothing to sell here yet.
  if (totalSlots === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2.5 mt-7 mb-2" data-reveal>
      {/* Indicator line: how many open + how many taking bids. */}
      <div
        className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[13px]"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span className="inline-flex items-center gap-1.5">
          <i className="gg-bid-dot" aria-hidden="true" />
          <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
            {openCount === 0
              ? 'All spots taken right now'
              : `${openCount} of ${totalSlots} spots open`}
          </strong>
        </span>
        {takingBidsCount > 0 && (
          <span>
            ·{' '}
            {takingBidsCount} taking bid{takingBidsCount === 1 ? '' : 's'}
          </span>
        )}
        {topBidCents ? <span>· top bid {rand(topBidCents)}</span> : null}
      </div>

      {/* Primary CTA — shared gold treatment. Always present so there's a
          bid entry even when every slot is currently taken. */}
      <Link
        href="/featured/bid"
        className="gg-bid-spot inline-flex items-center gap-2 rounded-full px-5 py-2 text-[13px]"
        style={{
          background:
            'radial-gradient(120% 160% at 50% 0%, rgba(232, 181, 58, 0.14) 0%, transparent 70%), var(--bg-card)',
          color: 'var(--text-primary)',
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        <i className="gg-bid-dot" aria-hidden="true" />
        {openCount === 0 ? 'Bid to be next in line →' : 'Bid for a spot →'}
      </Link>
    </div>
  );
}
