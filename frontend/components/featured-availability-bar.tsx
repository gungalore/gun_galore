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

  const { openCount, takingBidsCount, totalSlots, topBidCents, openSlots } = sum;

  return (
    <div className="flex flex-col items-center gap-2.5 mb-8" data-reveal>
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

      {/* Clickable per-slot chips — the missing "bid on a specific open
          slot" entry point. Each deep-links into the bid page. */}
      {openSlots.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 max-w-3xl">
          {openSlots.map((s) => (
            <Link
              key={s.id}
              href={`/featured/bid?slot=${s.id}`}
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full transition-colors"
              style={{
                border: '0.5px solid rgba(232, 181, 58, 0.5)',
                background: 'rgba(232, 181, 58, 0.06)',
                color: 'var(--text-primary)',
                textDecoration: 'none',
              }}
            >
              <span style={{ fontWeight: 600 }}>Spot {s.slotNumber}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                {s.bidCount > 0
                  ? `${rand(s.topBidCents ?? 0)} · ${s.bidCount} bid${
                      s.bidCount === 1 ? '' : 's'
                    }`
                  : 'no bids yet'}
              </span>
            </Link>
          ))}
        </div>
      )}

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
