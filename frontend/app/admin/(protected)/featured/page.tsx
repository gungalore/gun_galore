'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { FeaturedTabs } from './tabs';

type SlotStatus = 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';
type AuctionStatus = 'OPEN' | 'CLOSED_AWARDED' | 'CLOSED_NO_BIDS' | 'CANCELLED_BY_ADMIN';
type AuctionKind = 'SCHEDULED' | 'AD_HOC';

interface AdminSlot {
  id: string;
  slotNumber: number;
  status: SlotStatus;
  featuredUntil: string | null;
  currentListing: null | {
    id: string;
    title: string;
    seller: { username: string | null };
    images: { url: string }[];
    category: { name: string };
  };
  currentAuction: null | {
    id: string;
    kind: AuctionKind;
    status: AuctionStatus;
    openedAt: string;
    closesAt: string;
  };
}

export default function AdminFeaturedSlotsPage() {
  const [slots, setSlots] = useState<AdminSlot[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const res = await adminFetch('/admin/featured/slots');
      if (cancelled) return;
      if (res.ok) setSlots(await res.json());
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Backend doesn't guarantee order — sort by slotNumber for stable rendering.
  const sorted = [...slots].sort((a, b) => a.slotNumber - b.slotNumber);

  return (
    <div>
      <h1
        className="text-xl mb-4"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Featured Slots
      </h1>
      <FeaturedTabs current="slots" />

      {loaded && sorted.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No slots configured.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sorted.map((slot) => (
            <SlotCard key={slot.id} slot={slot} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotCard({ slot }: { slot: AdminSlot }) {
  return (
    <div
      className="rounded-[8px] p-4 flex flex-col"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <span
          className="text-xs uppercase"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
            fontWeight: 500,
          }}
        >
          Slot #{slot.slotNumber}
        </span>
        <SlotStatusPill status={slot.status} kind={slot.currentAuction?.kind} />
      </div>

      {slot.status === 'OCCUPIED' && slot.currentListing && (
        <div className="flex-1">
          <div className="flex gap-3 mb-3">
            {slot.currentListing.images[0]?.url && (
              <div
                className="relative shrink-0 rounded-[4px] overflow-hidden"
                style={{ width: 56, height: 56, background: 'var(--bg-inset)' }}
              >
                <Image
                  src={slot.currentListing.images[0].url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div
                className="text-sm leading-snug line-clamp-2"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                {slot.currentListing.title}
              </div>
              {slot.currentListing.seller.username && (
                <div
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  @{slot.currentListing.seller.username}
                </div>
              )}
            </div>
          </div>
          {slot.featuredUntil && (
            <div
              className="text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              Featured until{' '}
              {new Date(slot.featuredUntil).toLocaleString('en-ZA')}
            </div>
          )}
          <div
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {formatRemaining(slot.featuredUntil)} remaining
          </div>
        </div>
      )}

      {slot.status === 'AUCTION_RUNNING' && slot.currentAuction && (
        <div className="flex-1">
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Auction
          </div>
          <div
            className="text-sm mt-0.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            {slot.currentAuction.kind === 'AD_HOC' ? 'Ad-hoc' : 'Scheduled'}
          </div>
          <div
            className="text-xs mt-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            Closes {new Date(slot.currentAuction.closesAt).toLocaleString('en-ZA')}
          </div>
          <div
            className="text-xs mt-0.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            in {formatRemaining(slot.currentAuction.closesAt)}
          </div>
        </div>
      )}

      {slot.status === 'BIND_WINDOW' && (
        <div className="flex-1">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Winner picking listing
          </p>
          {slot.currentAuction && (
            <p
              className="text-xs mt-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Auction closed{' '}
              {new Date(slot.currentAuction.closesAt).toLocaleString('en-ZA')}
            </p>
          )}
        </div>
      )}

      {slot.status === 'VACANT' && (
        <div className="flex-1">
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No occupant, no auction running.
          </p>
        </div>
      )}

      <Link
        href={`/admin/featured/${slot.id}`}
        className="text-xs mt-3 hover:underline"
        style={{ color: 'var(--red)', textDecoration: 'none' }}
      >
        View detail →
      </Link>
    </div>
  );
}

function SlotStatusPill({
  status,
  kind,
}: {
  status: SlotStatus;
  kind?: AuctionKind;
}) {
  const { bg, fg, label } = (() => {
    switch (status) {
      case 'OCCUPIED':
        return { bg: 'rgba(47,158,107,0.12)', fg: '#2f9e6b', label: 'Featured' };
      case 'AUCTION_RUNNING':
        return {
          bg: 'rgba(245,158,11,0.12)',
          fg: '#f59e0b',
          label: kind === 'AD_HOC' ? 'Just opened' : 'Pre-auction',
        };
      case 'BIND_WINDOW':
        return { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b', label: 'Bind window' };
      default:
        return { bg: 'var(--bg-inset)', fg: 'var(--text-tertiary)', label: 'Vacant' };
    }
  })();
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{
        background: bg,
        color: fg,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function formatRemaining(target: string | null): string {
  if (!target) return '—';
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
