'use client';

import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import Image from 'next/image';
import Link from 'next/link';
import { HelpTip } from '@/components/help-tip';
import { HelpText } from '@/components/help-text';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ─── Types ────────────────────────────────────────────────────────────
type Tier = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
type SlotStatus = 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';

interface SlotForBidder {
  id: string;
  slotNumber: number;
  status: SlotStatus;
  featuredUntil: string | null;
  currentListing: null | {
    id: string;
    title: string;
    seller: { username: string | null };
    images: { url: string }[];
  };
  currentAuction: null | {
    id: string;
    kind: 'SCHEDULED' | 'AD_HOC';
    status: 'OPEN' | 'CLOSED_AWARDED' | 'CLOSED_NO_BIDS' | 'CANCELLED_BY_ADMIN';
    openedAt: string;
    closesAt: string | null;
  };
  topBid: null | {
    id: string;
    amountCents: number;
    tier: Tier;
    bidder: { username: string | null };
  };
  yourBid: null | {
    id: string;
    amountCents: number;
    tier: Tier;
  };
  bidCount: number;
}

interface Config {
  bidFloorCents: number;
  t1AmountCents: number; t1DurationSec: number;
  t2AmountCents: number; t2DurationSec: number;
  t3AmountCents: number; t3DurationSec: number;
  t4AmountCents: number; t4DurationSec: number;
  t5AmountCents: number; t5DurationSec: number;
  bindWindowSec: number;
}

// Phase E2 — /featured/slots now returns the slots in a wrapper that
// also includes the signed-in bidder's GG+ subscription discount.
// The bid modal uses it to preview "you'll pay R250" before commit.
type SubscriptionTier = 'FREE' | 'MEMBER' | 'PRO';
interface SlotsResponse {
  slots: SlotForBidder[];
  bidderSubscriptionTier: SubscriptionTier;
  bidderDiscountPercent: number;
}

interface MyListing {
  id: string;
  title: string;
  status: string;
  images: { url: string; isPrimary: boolean }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────
function formatRand(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatRemaining(target: string | null): string {
  if (!target) return '';
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// Snap an amount to the highest tier it qualifies for. Mirrors the
// backend logic so the UI can preview the snapped tier BEFORE submit.
function snapToTier(amountCents: number, cfg: Config): {
  tier: Tier;
  amountCents: number;
  durationSec: number;
} | null {
  if (amountCents >= cfg.t5AmountCents) return { tier: 'T5', amountCents: cfg.t5AmountCents, durationSec: cfg.t5DurationSec };
  if (amountCents >= cfg.t4AmountCents) return { tier: 'T4', amountCents: cfg.t4AmountCents, durationSec: cfg.t4DurationSec };
  if (amountCents >= cfg.t3AmountCents) return { tier: 'T3', amountCents: cfg.t3AmountCents, durationSec: cfg.t3DurationSec };
  if (amountCents >= cfg.t2AmountCents) return { tier: 'T2', amountCents: cfg.t2AmountCents, durationSec: cfg.t2DurationSec };
  if (amountCents >= cfg.t1AmountCents) return { tier: 'T1', amountCents: cfg.t1AmountCents, durationSec: cfg.t1DurationSec };
  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function FeaturedBidPage() {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();

  const [slots, setSlots] = useState<SlotForBidder[] | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  // Phase E2 — render the GG+ discount banner above the tier table.
  const [bidderTier, setBidderTier] = useState<SubscriptionTier>('FREE');
  const [bidderDiscount, setBidderDiscount] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeModal, setActiveModal] = useState<
    | null
    | { kind: 'bid'; slot: SlotForBidder }
    | { kind: 'bind'; slot: SlotForBidder }
    | { kind: 'buynow'; slot: SlotForBidder }
  >(null);

  // Tick every second so countdowns refresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Initial load + revalidate every 15s so other bidders' moves show.
  // On non-OK responses or network failure, surface a visible error
  // state instead of leaving skeletons up forever (previous behaviour
  // hid every failure mode, so users got a permanently blank-looking
  // page if /featured/slots ever errored).
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    async function load() {
      try {
        const [s, c] = await Promise.all([
          fetch(`${API_URL}/featured/slots`, {
            headers: { Authorization: `Bearer ${await getToken()}` },
            cache: 'no-store',
          }),
          fetch(`${API_URL}/featured/config`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (!s.ok) {
          setLoadError(`Couldn't load featured slots (HTTP ${s.status})`);
          return;
        }
        if (!c.ok) {
          setLoadError(`Couldn't load tier config (HTTP ${c.status})`);
          return;
        }
        const [slotData, cfgData] = await Promise.all([s.json(), c.json()]);
        if (cancelled) return;
        // Phase E2 — backend now wraps slots[] with the bidder's
        // subscription discount. Old shape (bare array) is handled
        // as a defensive fallback so the page doesn't blank if the
        // backend hasn't been restarted.
        const wrapped: SlotsResponse | SlotForBidder[] = slotData;
        if (Array.isArray(wrapped)) {
          setSlots(wrapped);
          setBidderTier('FREE');
          setBidderDiscount(0);
        } else {
          setSlots(wrapped.slots);
          setBidderTier(wrapped.bidderSubscriptionTier);
          setBidderDiscount(wrapped.bidderDiscountPercent);
        }
        setConfig(cfgData);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? `Network error: ${err.message}`
              : 'Network error loading featured slots',
          );
        }
      }
    }
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isLoaded, isSignedIn, getToken, reloadKey]);

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <main className="max-w-[760px] mx-auto px-4 py-16">
        <h1
          className="text-xl mb-3"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Sign in to bid
        </h1>
        <p
          className="text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          Featured-slot bidding is for sellers. <Link href="/sign-in" style={{ color: 'var(--red)' }}>Sign in</Link> to place a bid.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-[1120px] mx-auto px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center" style={{ marginBottom: 2 }}>
          <h1
            className="text-2xl"
            style={{ color: 'var(--text-primary)', fontWeight: 500, letterSpacing: '-0.01em' }}
          >
            Bid for a featured spot
          </h1>
          <HelpTip title="How featured bidding works" side="right">
            Each of the 10 featured slots runs its own auction. When a
            slot is empty, the auction opens immediately and waits for a
            first bid. As soon as someone bids, a 24-hour countdown
            starts. Highest bid at close wins and gets 15 minutes to
            pick which listing to feature.
          </HelpTip>
        </div>
        <p
          className="text-sm"
          style={{ color: 'var(--text-tertiary)' }}
        >
          10 slots on the left rail of every browse page. Bid high to lock a slot for longer.
        </p>

        {/* Prominent prerequisite — sellers regularly hit the bid flow
            without an active listing, win the slot, then have nothing
            to bind in the 15-minute window. Surface the requirement
            BEFORE they bid so they create a listing first if needed. */}
        <div
          className="rounded-[6px] px-3 py-2 mt-4 text-xs"
          style={{
            background: 'rgba(245,158,11,0.10)',
            border: '0.5px solid rgba(245,158,11,0.45)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            lineHeight: 1.45,
          }}
        >
          <span
            style={{
              color: '#f59e0b',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontSize: 10,
              flexShrink: 0,
            }}
          >
            Heads up
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            You&apos;ll need an active <strong style={{ color: 'var(--text-primary)' }}>Marketplace</strong>,{' '}
            <strong style={{ color: 'var(--text-primary)' }}>Auction</strong>, or{' '}
            <strong style={{ color: 'var(--text-primary)' }}>Take a Shot</strong> listing to bind once you win.{' '}
            <Link href="/listings/new" style={{ color: 'var(--red)', textDecoration: 'none' }}>
              Create a listing →
            </Link>
          </span>
        </div>
      </header>

      {/* Phase E2 — GG+ discount banner (MEMBER/PRO only). FREE
          users see an upsell nudge instead. */}
      {bidderDiscount > 0 ? (
        <div
          className="rounded-[6px] px-3 py-2 mb-4 text-xs"
          style={{
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid rgba(200,16,46,0.40)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            lineHeight: 1.45,
          }}
        >
          <span
            style={{
              color: 'var(--red)',
              fontWeight: 600,
              letterSpacing: '0.04em',
              fontSize: 10,
              flexShrink: 0,
            }}
          >
            {bidderTier === 'PRO' ? 'GG PRO' : `GG+ ${bidderTier}`}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            Your Ask Boet subscription unlocks{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {bidderDiscount}% off
            </strong>{' '}
            every featured-slot bid you place.
          </span>
        </div>
      ) : (
        <div
          className="rounded-[6px] px-3 py-2 mb-4 text-xs"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            lineHeight: 1.45,
          }}
        >
          <span style={{ color: 'var(--text-tertiary)' }}>
            <Link href="/ask-gg" style={{ color: 'var(--red)' }}>
              Subscribe to Ask Boet
            </Link>{' '}
            for 25% off featured bids (PRO: 50% off).
          </span>
        </div>
      )}

      {/* Tier table */}
      {config && <TierTable config={config} />}

      {/* Load error banner — replaces the permanent skeletons state
          when the slots / config endpoints fail, so the user knows
          something is wrong instead of seeing an empty page. */}
      {loadError && (
        <div
          className="mt-6 rounded-[8px] p-4 flex items-center gap-3 flex-wrap"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--red)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              className="text-sm"
              style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 2 }}
            >
              Couldn&apos;t load featured slots
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {loadError}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setReloadKey((k) => k + 1);
            }}
            className="px-3 py-1.5 rounded text-xs"
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Slots grid — show skeletons while slots load so the page
          doesn't flash blank for a second. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
        {slots === null && !loadError
          ? Array.from({ length: 6 }).map((_, i) => <SlotSkeleton key={i} />)
          : (slots ?? []).map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                now={now}
                onBid={() => setActiveModal({ kind: 'bid', slot })}
                onBind={() => setActiveModal({ kind: 'bind', slot })}
                onBuyNow={() => setActiveModal({ kind: 'buynow', slot })}
              />
            ))}
      </div>

      {activeModal?.kind === 'bid' && config && (
        <BidModal
          slot={activeModal.slot}
          config={config}
          bidderTier={bidderTier}
          bidderDiscountPercent={bidderDiscount}
          onClose={() => setActiveModal(null)}
          onPlaced={async () => {
            setActiveModal(null);
            // Force a refetch by triggering the effect's dep change
            // — simpler: call the endpoint again here.
            const r = await fetch(`${API_URL}/featured/slots`, {
              headers: { Authorization: `Bearer ${await getToken()}` },
              cache: 'no-store',
            });
            if (r.ok) {
              const wrapped: SlotsResponse | SlotForBidder[] = await r.json();
              if (Array.isArray(wrapped)) {
                setSlots(wrapped);
              } else {
                setSlots(wrapped.slots);
                setBidderTier(wrapped.bidderSubscriptionTier);
                setBidderDiscount(wrapped.bidderDiscountPercent);
              }
            }
          }}
          getToken={getToken}
        />
      )}

      {activeModal?.kind === 'bind' && (
        <BindModal
          slot={activeModal.slot}
          onClose={() => setActiveModal(null)}
          onBound={async () => {
            setActiveModal(null);
            const r = await fetch(`${API_URL}/featured/slots`, {
              headers: { Authorization: `Bearer ${await getToken()}` },
              cache: 'no-store',
            });
            if (r.ok) {
              const wrapped: SlotsResponse | SlotForBidder[] = await r.json();
              if (Array.isArray(wrapped)) {
                setSlots(wrapped);
              } else {
                setSlots(wrapped.slots);
                setBidderTier(wrapped.bidderSubscriptionTier);
                setBidderDiscount(wrapped.bidderDiscountPercent);
              }
            }
          }}
          getToken={getToken}
        />
      )}

      {activeModal?.kind === 'buynow' && config && (
        <BuyNowModal
          slot={activeModal.slot}
          config={config}
          bidderTier={bidderTier}
          bidderDiscountPercent={bidderDiscount}
          onClose={() => setActiveModal(null)}
          onBought={async () => {
            setActiveModal(null);
            const r = await fetch(`${API_URL}/featured/slots`, {
              headers: { Authorization: `Bearer ${await getToken()}` },
              cache: 'no-store',
            });
            if (r.ok) {
              const wrapped: SlotsResponse | SlotForBidder[] = await r.json();
              if (Array.isArray(wrapped)) {
                setSlots(wrapped);
              } else {
                setSlots(wrapped.slots);
                setBidderTier(wrapped.bidderSubscriptionTier);
                setBidderDiscount(wrapped.bidderDiscountPercent);
              }
            }
          }}
          getToken={getToken}
        />
      )}
    </main>
  );
}

// ─── Tier table ───────────────────────────────────────────────────────
function TierTable({ config }: { config: Config }) {
  const tiers: { label: string; cents: number; sec: number }[] = [
    { label: 'T1', cents: config.t1AmountCents, sec: config.t1DurationSec },
    { label: 'T2', cents: config.t2AmountCents, sec: config.t2DurationSec },
    { label: 'T3', cents: config.t3AmountCents, sec: config.t3DurationSec },
    { label: 'T4', cents: config.t4AmountCents, sec: config.t4DurationSec },
    { label: 'T5', cents: config.t5AmountCents, sec: config.t5DurationSec },
  ];
  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-center mb-3">
        <p
          className="text-xs uppercase"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
            fontWeight: 500,
          }}
        >
          Tier table
        </p>
        <HelpTip title="What tiers do" side="right">
          The amount you bid snaps down to the nearest tier — bidding
          R450 gives you the T4 R400 price, not the in-between amount.
          The tier you land on decides how long your listing stays
          featured if you win the slot.
        </HelpTip>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {tiers.map((t) => (
          <div
            key={t.label}
            className="rounded-[6px] p-3 text-center"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
            }}
          >
            <div
              className="text-xs mb-1"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.04em',
              }}
            >
              {t.label}
            </div>
            <div
              className="text-base"
              style={{ color: 'var(--red)', fontWeight: 500 }}
            >
              {formatRand(t.cents)}
            </div>
            <div
              className="text-xs mt-0.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              {formatDuration(t.sec)} featured
            </div>
          </div>
        ))}
      </div>
      <p
        className="text-xs mt-3"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Bid amount snaps DOWN to the nearest tier. Min bid {formatRand(config.bidFloorCents)}.
        The auction&apos;s 24h countdown only starts after the first bid lands.
      </p>
    </div>
  );
}

// ─── Slot skeleton ────────────────────────────────────────────────────
// Renders while slots are still loading. Same outer dimensions as
// SlotCard so the grid doesn't jump when real data arrives. Soft
// shimmer pulse so it visually reads as "content coming" rather than
// a permanent placeholder.
function SlotSkeleton() {
  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        minHeight: 180,
      }}
    >
      <style>{`
        @keyframes featuredSkeletonPulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.9; }
        }
        .featured-skel {
          background: var(--bg-inset);
          border-radius: 4px;
          animation: featuredSkeletonPulse 1.4s ease-in-out infinite;
        }
      `}</style>
      <div className="flex items-baseline justify-between mb-3">
        <span className="featured-skel" style={{ width: 60, height: 12 }} />
        <span className="featured-skel" style={{ width: 70, height: 16, borderRadius: 999 }} />
      </div>
      <div className="featured-skel mb-2" style={{ width: 80, height: 11 }} />
      <div className="featured-skel mb-2" style={{ width: 120, height: 22 }} />
      <div className="featured-skel mb-4" style={{ width: 140, height: 11 }} />
      <div className="featured-skel" style={{ width: '100%', height: 40, borderRadius: 6 }} />
    </div>
  );
}

// ─── Slot card ────────────────────────────────────────────────────────
function SlotCard({
  slot,
  now,
  onBid,
  onBind,
  onBuyNow,
}: {
  slot: SlotForBidder;
  now: number;
  onBid: () => void;
  onBind: () => void;
  onBuyNow: () => void;
}) {
  const isAuctionOpen =
    slot.currentAuction?.status === 'OPEN' &&
    (slot.currentAuction.closesAt === null ||
      new Date(slot.currentAuction.closesAt).getTime() > now);
  const isAwaitingFirstBid =
    slot.currentAuction?.status === 'OPEN' && slot.currentAuction.closesAt === null;
  const isYourTopBid =
    slot.topBid && slot.yourBid && slot.topBid.id === slot.yourBid.id;

  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${isYourTopBid ? 'var(--red)' : 'var(--border)'}`,
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

      {/* OCCUPIED — show occupant + countdown to slot's auction window */}
      {slot.status === 'OCCUPIED' && slot.currentListing && (
        <>
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
              Featured until {new Date(slot.featuredUntil).toLocaleString('en-ZA')}
            </div>
          )}
        </>
      )}

      {/* AUCTION_RUNNING / VACANT — show top bid + place-bid CTA */}
      {(slot.status === 'AUCTION_RUNNING' || slot.status === 'VACANT') && (
        <>
          <div className="mb-3">
            {slot.topBid ? (
              <>
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Top bid
                </div>
                <div
                  className="text-lg"
                  style={{ color: 'var(--red)', fontWeight: 500 }}
                >
                  {formatRand(slot.topBid.amountCents)}
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  by {slot.topBid.bidder.username ?? 'Anonymous bidder'}
                  {' '}· {slot.bidCount} bid{slot.bidCount === 1 ? '' : 's'}
                </div>
              </>
            ) : (
              <>
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  No bids yet
                </div>
                <div
                  className="text-sm mt-1"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Be the first to bid this slot.
                </div>
              </>
            )}
          </div>
          {slot.yourBid && !isYourTopBid && (
            <div
              className="text-xs mb-2"
              style={{ color: 'var(--pendingText, #f59e0b)' }}
            >
              Your bid {formatRand(slot.yourBid.amountCents)} — outbid
            </div>
          )}
          {slot.currentAuction && (
            <div
              className="text-xs mb-3"
              style={{ color: isAuctionOpen ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}
            >
              {isAwaitingFirstBid
                ? 'Waiting for first bid — 24h timer starts then'
                : isAuctionOpen
                  ? `Closes in ${formatRemaining(slot.currentAuction.closesAt)}`
                  : `Closing… ${formatRemaining(slot.currentAuction.closesAt)}`}
            </div>
          )}
          <button
            type="button"
            onClick={onBid}
            disabled={!isAuctionOpen}
            className="w-full py-2.5 rounded-[6px] text-sm font-medium"
            style={{
              background: isAuctionOpen ? 'var(--red)' : 'var(--bg-inset)',
              color: isAuctionOpen ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: isAuctionOpen ? 'pointer' : 'not-allowed',
            }}
          >
            {isYourTopBid ? 'Raise your bid' : 'Place bid'}
          </button>
          {/* Buy Now — skip the auction, take the slot outright at 2× the
              tier price. Always actionable while the slot is open/vacant
              (no timer dependency; there's nothing to be outbid on). */}
          <button
            type="button"
            onClick={onBuyNow}
            className="w-full py-2 mt-2 rounded-[6px] text-sm font-medium"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: '0.5px solid var(--red)',
              cursor: 'pointer',
            }}
          >
            Buy now — skip the auction
          </button>
        </>
      )}

      {/* BIND_WINDOW — show countdown + Pick listing CTA if it's yours */}
      {slot.status === 'BIND_WINDOW' && (
        <BindWindowBlock slot={slot} onBind={onBind} />
      )}
    </div>
  );
}

function SlotStatusPill({
  status,
  kind,
}: {
  status: SlotStatus;
  kind?: 'SCHEDULED' | 'AD_HOC';
}) {
  const { bg, fg, label, tip } = (() => {
    switch (status) {
      case 'OCCUPIED':
        return {
          bg: 'rgba(47,158,107,0.12)',
          fg: '#2f9e6b',
          label: 'Featured',
          tip: 'A listing is currently live in this slot and showing on the featured rail. The slot reopens for bidding the moment this listing sells or its featured time runs out.',
        };
      case 'AUCTION_RUNNING':
        return {
          bg: 'rgba(245,158,11,0.12)',
          fg: '#f59e0b',
          label: 'Auction open',
          tip: 'Anyone can place a bid right now. As soon as the first bid lands, a 24-hour countdown starts. Highest bid at the end wins the slot.',
        };
      case 'BIND_WINDOW':
        return {
          bg: 'rgba(245,158,11,0.12)',
          fg: '#f59e0b',
          label: 'Bind window',
          tip: 'The auction closed. The winning bidder has 15 minutes to pick which of their active listings to feature. If they miss the window, the slot reopens for bidding.',
        };
      default:
        return {
          bg: 'var(--bg-inset)',
          fg: 'var(--text-tertiary)',
          label: 'Vacant',
          tip: 'No listing is currently featured here. The slot will reopen for bidding shortly.',
        };
    }
  })();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
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
      <HelpTip title={label} side="bottom">
        {tip}
      </HelpTip>
    </span>
  );
}

function BindWindowBlock({
  slot,
  onBind,
}: {
  slot: SlotForBidder;
  onBind: () => void;
}) {
  // The slot's currentAuction.winningBid is what we'd need to check
  // "is the bidder me" — the backend's getSlotsForBidder doesn't expose
  // that yet. For now we show a generic "winner picking listing" panel
  // and let the user click to try. If they're not the winner the bind
  // endpoint rejects with 403.
  return (
    <div>
      <div
        className="text-xs mb-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        Auction closed. The winner has 15 minutes to bind a listing.
      </div>
      <button
        type="button"
        onClick={onBind}
        className="w-full py-2.5 rounded-[6px] text-sm font-medium"
        style={{
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          border: '0.5px solid var(--red)',
          cursor: 'pointer',
        }}
      >
        Bind my listing (if I won)
      </button>
      <HelpText>
        Click only if you won the auction. You&apos;ll pick one of your
        active listings to put in the slot. If you weren&apos;t the
        winner, the click is rejected.
      </HelpText>
    </div>
  );
}

// ─── Bid modal ────────────────────────────────────────────────────────
function BidModal({
  slot,
  config,
  bidderTier,
  bidderDiscountPercent,
  onClose,
  onPlaced,
  getToken,
}: {
  slot: SlotForBidder;
  config: Config;
  bidderTier: SubscriptionTier;
  bidderDiscountPercent: number;
  onClose: () => void;
  onPlaced: () => void;
  getToken: () => Promise<string | null>;
}) {
  // Stepper starts at the bid floor (or one tier above the current top
  // bid, whichever is higher).
  const initial = slot.topBid
    ? Math.max(slot.topBid.amountCents + 1, config.bidFloorCents)
    : config.bidFloorCents;
  const [amountCents, setAmountCents] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapped = snapToTier(amountCents, config);
  // Phase E2 — effective charge after GG+ discount (floor cents,
  // matches backend math exactly so the preview doesn't lie).
  const effectiveChargeCents = snapped
    ? Math.floor((snapped.amountCents * (100 - bidderDiscountPercent)) / 100)
    : 0;

  // Stepper increments — match the tiers. Lets users jump between
  // tiers with single clicks.
  const tierJumps: { label: string; cents: number }[] = [
    { label: 'T1', cents: config.t1AmountCents },
    { label: 'T2', cents: config.t2AmountCents },
    { label: 'T3', cents: config.t3AmountCents },
    { label: 'T4', cents: config.t4AmountCents },
    { label: 'T5', cents: config.t5AmountCents },
  ];

  async function submit() {
    if (!snapped) {
      setError(`Minimum bid is ${formatRand(config.bidFloorCents)}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/featured/bids`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slotId: slot.id, amountCents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      onPlaced();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bid');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[8px] p-6 max-w-md w-full"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="text-lg mb-1"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Bid on Slot #{slot.slotNumber}
        </h3>
        <p
          className="text-xs mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          You bid for the slot first. After you win, you have {Math.round(config.bindWindowSec / 60)} min to pick a listing.
        </p>

        {/* Tier jump buttons */}
        <div className="grid grid-cols-5 gap-1 mb-3">
          {tierJumps.map((t) => {
            const active = amountCents === t.cents;
            return (
              <button
                key={t.label}
                type="button"
                onClick={() => setAmountCents(t.cents)}
                className="py-2 rounded-[4px] text-xs"
                style={{
                  background: active ? 'var(--red)' : 'var(--bg-inset)',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  border: active ? 'none' : '0.5px solid var(--border)',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {formatRand(t.cents)}
              </button>
            );
          })}
        </div>

        {/* Custom amount */}
        <div className="mb-3">
          <label
            className="text-xs mb-1 block"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Or type a custom amount (snaps down to nearest tier)
          </label>
          <div className="relative">
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              R
            </span>
            <input
              type="number"
              min={config.bidFloorCents / 100}
              step="1"
              value={amountCents / 100}
              onChange={(e) =>
                setAmountCents(Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)))
              }
              className="w-full pl-7 pr-3 py-2.5 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        {/* Snap preview */}
        <div
          className="rounded-[6px] px-3 py-3 mb-4 text-xs"
          style={{
            background: snapped ? 'rgba(47,158,107,0.10)' : 'rgba(239,68,68,0.10)',
            border: `0.5px solid ${snapped ? '#2f9e6b' : '#ef4444'}`,
            color: snapped ? '#2f9e6b' : '#ef4444',
          }}
        >
          {snapped ? (
            <>
              Snaps to <strong>{formatRand(snapped.amountCents)}</strong> —{' '}
              <strong>{formatDuration(snapped.durationSec)}</strong> featured if you win.
              {bidderDiscountPercent > 0 && (
                <div
                  className="mt-1 pt-1"
                  style={{
                    borderTop: '0.5px solid rgba(47,158,107,0.30)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {bidderTier === 'PRO' ? 'GG PRO' : `GG+ ${bidderTier}`} discount −{bidderDiscountPercent}% →{' '}
                  you&apos;ll be charged{' '}
                  <strong>{formatRand(effectiveChargeCents)}</strong>{' '}
                  (saving {formatRand(snapped.amountCents - effectiveChargeCents)})
                </div>
              )}
            </>
          ) : (
            <>Below floor — minimum is {formatRand(config.bidFloorCents)}.</>
          )}
        </div>

        {error && (
          <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !snapped}
            className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
            style={{
              background: snapped && !submitting ? 'var(--red)' : 'var(--bg-inset)',
              color: snapped && !submitting ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: submitting || !snapped ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Placing…' : 'Place bid'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bind modal ───────────────────────────────────────────────────────
function BindModal({
  slot,
  onClose,
  onBound,
  getToken,
}: {
  slot: SlotForBidder;
  onClose: () => void;
  onBound: () => void;
  getToken: () => Promise<string | null>;
}) {
  const [listings, setListings] = useState<MyListing[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Phase-1 payment gate — the manual-EFT slot-fee lane is retired and the
  // card paygate isn't live yet, so binding a listing returns the shared
  // "card payments are launching soon" state (HTTP 503) instead of payment
  // instructions. True once the backend gate is hit.
  const [comingSoon, setComingSoon] = useState(false);

  // Load the seller's ACTIVE listings on mount.
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/listings/mine?status=ACTIVE`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) {
          // A non-2xx (401 during token refresh, 500, …) must not leave the
          // picker stuck on "Loading…" forever. Surface it + resolve to an
          // empty list so the modal renders an actionable state.
          setError('Could not load your listings — please close and retry.');
          setListings([]);
          return;
        }
        const data = await res.json();
        // The backend's GET /listings/mine doesn't honor ?status= yet —
        // it returns every listing the seller owns. Filter client-side
        // so only ACTIVE listings (any listingType: BUY_NOW / AUCTION /
        // TAKE_A_SHOT) appear in the bind picker. Anything else would
        // be rejected by the bind endpoint anyway.
        const all: MyListing[] = Array.isArray(data) ? data : (data.listings ?? []);
        setListings(all.filter((l) => l.status === 'ACTIVE'));
      } catch {
        setError('Could not load your listings');
      }
    })();
  }, [getToken]);

  async function bind(listingId: string) {
    setPicking(listingId);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/featured/bind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slotId: slot.id, listingId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Phase-1 payment gate: the slot fee can't be collected until card
        // checkout is live, so the backend returns 503 "card payments are
        // launching soon". Show the shared coming-soon surface instead of a
        // red error banner.
        if (res.status === 503 || /launching soon/i.test(data?.message ?? '')) {
          setComingSoon(true);
          return;
        }
        throw new Error(data?.message ?? `Error ${res.status}`);
      }
      onBound();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bind');
    } finally {
      setPicking(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[8px] p-6 max-w-md w-full max-h-[80vh] overflow-y-auto"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {comingSoon ? (
          // ── Phase-1 payment gate — card checkout isn't live yet ──────
          // The manual-EFT slot-fee lane is retired, so binding can't
          // collect the fee. Show the shared coming-soon surface instead of
          // banking instructions for a rail that no longer exists.
          <div>
            <PaymentsComingSoon />
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 mt-4 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        ) : (
          <>
        <h3
          className="text-lg mb-1"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Pick a listing for Slot #{slot.slotNumber}
        </h3>
        <p
          className="text-xs mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Pick one of your ACTIVE listings — Marketplace, Auction, or
          Take a Shot all work. Once your slot fee is paid it will be
          featured on the left rail until the slot&apos;s time runs out.
        </p>

        {error && (
          <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}

        {!listings ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Loading your listings…
          </p>
        ) : listings.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            You don&apos;t have any ACTIVE listings to feature.
          </p>
        ) : (
          // Vertical picker, 50px-tall rows — same visual language as
          // the FeaturedRail's compact card so the seller gets a
          // preview of how their listing will look in the rail before
          // they commit. Single-line title with truncate keeps every
          // row exactly 50px regardless of title length. Subtle warm
          // glow matches the rail's "this is a featured surface" cue.
          <div className="space-y-1.5">
            {listings.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => bind(l.id)}
                disabled={picking !== null}
                className="w-full flex items-center rounded-[6px] text-left"
                style={{
                  height: 50,
                  padding: '0 8px',
                  gap: 10,
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  boxShadow:
                    '0 0 12px rgba(232, 181, 58, 0.20),' +
                    ' 0 0 4px rgba(200, 16, 46, 0.18)',
                  cursor: picking !== null ? 'wait' : 'pointer',
                  opacity: picking !== null && picking !== l.id ? 0.5 : 1,
                }}
              >
                <div
                  className="relative shrink-0 rounded-[3px] overflow-hidden"
                  style={{ width: 36, height: 36, background: 'var(--bg-inset)' }}
                >
                  {l.images[0] && (
                    <Image
                      src={l.images[0].url}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="36px"
                    />
                  )}
                </div>
                <span
                  className="text-xs leading-tight truncate flex-1"
                  style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                >
                  {l.title}
                </span>
                {picking === l.id && (
                  <span
                    className="text-[10px] shrink-0"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Binding…
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 mt-4 rounded-[6px] text-sm"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Buy Now modal ────────────────────────────────────────────────────
// Skip the auction: pick a tier + one of your ACTIVE listings and pay a
// fixed 2× the tier's base price to take the slot outright, live now, for
// that tier's duration. Atomic — no bind window. The GG PRO discount
// applies to the doubled base, mirroring the auction bid maths.
const BUY_NOW_MULTIPLIER = 2;

function BuyNowModal({
  slot,
  config,
  bidderTier,
  bidderDiscountPercent,
  onClose,
  onBought,
  getToken,
}: {
  slot: SlotForBidder;
  config: Config;
  bidderTier: SubscriptionTier;
  bidderDiscountPercent: number;
  onClose: () => void;
  onBought: () => void;
  getToken: () => Promise<string | null>;
}) {
  const tierRows: { tier: Tier; amountCents: number; durationSec: number }[] = [
    { tier: 'T1', amountCents: config.t1AmountCents, durationSec: config.t1DurationSec },
    { tier: 'T2', amountCents: config.t2AmountCents, durationSec: config.t2DurationSec },
    { tier: 'T3', amountCents: config.t3AmountCents, durationSec: config.t3DurationSec },
    { tier: 'T4', amountCents: config.t4AmountCents, durationSec: config.t4DurationSec },
    { tier: 'T5', amountCents: config.t5AmountCents, durationSec: config.t5DurationSec },
  ];

  const [tier, setTier] = useState<Tier>('T1');
  const [listings, setListings] = useState<MyListing[] | null>(null);
  const [selectedListing, setSelectedListing] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState(false);

  const chosen = tierRows.find((r) => r.tier === tier)!;
  // 2× the base price is what Buy Now charges (pre-discount). The GG PRO
  // discount then applies to that doubled base — same floor-cents maths
  // as the backend so the preview never lies.
  const baseCents = chosen.amountCents * BUY_NOW_MULTIPLIER;
  const chargedCents = Math.floor(
    (baseCents * (100 - bidderDiscountPercent)) / 100,
  );

  // Load the seller's ACTIVE listings on mount (same source as BindModal).
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/listings/mine?status=ACTIVE`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) {
          // Don't leave the picker stuck on "Loading…" on a non-2xx.
          setError('Could not load your listings — please close and retry.');
          setListings([]);
          return;
        }
        const data = await res.json();
        const all: MyListing[] = Array.isArray(data) ? data : (data.listings ?? []);
        setListings(all.filter((l) => l.status === 'ACTIVE'));
      } catch {
        setError('Could not load your listings');
      }
    })();
  }, [getToken]);

  async function submit() {
    if (!selectedListing) {
      setError('Pick a listing to feature first');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/featured/buy-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slotId: slot.id, tier, listingId: selectedListing }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Payment gate — the slot fee can't be collected until card
        // checkout is live, so the backend returns 503 "launching soon".
        if (res.status === 503 || /launching soon/i.test(data?.message ?? '')) {
          setComingSoon(true);
          return;
        }
        throw new Error(data?.message ?? `Error ${res.status}`);
      }
      onBought();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Buy Now failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[8px] p-6 max-w-md w-full max-h-[85vh] overflow-y-auto"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {comingSoon ? (
          <div>
            <PaymentsComingSoon />
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 mt-4 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <h3
              className="text-lg mb-1"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Buy Slot #{slot.slotNumber} outright
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Skip the auction. Pick a tier + one of your active listings and
              it goes featured immediately for the tier&apos;s duration. Buy Now
              costs {BUY_NOW_MULTIPLIER}× the normal tier price.
            </p>

            {/* Tier dropdown */}
            <label
              className="text-xs mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Tier (sets how long you stay featured)
            </label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as Tier)}
              className="w-full mb-3 px-3 py-2.5 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              {tierRows.map((r) => (
                <option key={r.tier} value={r.tier}>
                  {r.tier} · {formatDuration(r.durationSec)} featured —{' '}
                  {formatRand(r.amountCents * BUY_NOW_MULTIPLIER)}
                </option>
              ))}
            </select>

            {/* Price preview */}
            <div
              className="rounded-[6px] px-3 py-3 mb-4 text-xs"
              style={{
                background: 'rgba(47,158,107,0.10)',
                border: '0.5px solid #2f9e6b',
                color: '#2f9e6b',
              }}
            >
              Buy Now <strong>{formatRand(baseCents)}</strong> —{' '}
              <strong>{formatDuration(chosen.durationSec)}</strong> featured,
              live immediately.
              {bidderDiscountPercent > 0 && (
                <div
                  className="mt-1 pt-1"
                  style={{
                    borderTop: '0.5px solid rgba(47,158,107,0.30)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {bidderTier === 'PRO' ? 'GG PRO' : `GG+ ${bidderTier}`} discount
                  −{bidderDiscountPercent}% → you&apos;ll be charged{' '}
                  <strong>{formatRand(chargedCents)}</strong>{' '}
                  (saving {formatRand(baseCents - chargedCents)})
                </div>
              )}
            </div>

            {/* Listing picker */}
            <label
              className="text-xs mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Listing to feature
            </label>
            {error && (
              <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}
            {!listings ? (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Loading your listings…
              </p>
            ) : listings.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                You don&apos;t have any ACTIVE listings to feature.{' '}
                <Link href="/listings/new" style={{ color: 'var(--red)', textDecoration: 'none' }}>
                  Create one →
                </Link>
              </p>
            ) : (
              <div className="space-y-1.5">
                {listings.map((l) => {
                  const active = selectedListing === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setSelectedListing(l.id)}
                      className="w-full flex items-center rounded-[6px] text-left"
                      style={{
                        height: 50,
                        padding: '0 8px',
                        gap: 10,
                        background: 'var(--bg-card)',
                        border: `0.5px solid ${active ? 'var(--red)' : 'var(--border)'}`,
                        boxShadow: active
                          ? '0 0 12px rgba(232, 181, 58, 0.20), 0 0 4px rgba(200, 16, 46, 0.18)'
                          : 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        className="relative shrink-0 rounded-[3px] overflow-hidden"
                        style={{ width: 36, height: 36, background: 'var(--bg-inset)' }}
                      >
                        {l.images[0] && (
                          <Image
                            src={l.images[0].url}
                            alt=""
                            fill
                            className="object-cover"
                            sizes="36px"
                          />
                        )}
                      </div>
                      <span
                        className="text-xs leading-tight truncate flex-1"
                        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                      >
                        {l.title}
                      </span>
                      {active && (
                        <span
                          className="text-[10px] shrink-0"
                          style={{ color: 'var(--red)', fontWeight: 600 }}
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-[6px] text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !selectedListing}
                className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
                style={{
                  background: !selectedListing || submitting ? 'var(--bg-inset)' : 'var(--red)',
                  color: !selectedListing || submitting ? 'var(--text-tertiary)' : '#fff',
                  border: 'none',
                  cursor: !selectedListing || submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Processing…' : `Buy now — ${formatRand(chargedCents)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
