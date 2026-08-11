'use client';

/**
 * Auction outbid SMS-link page. Two-step flow:
 *   1. Choice screen — "Place a single bid" vs "Set auto-bid max"
 *   2. Amount picker  — +/- stepper (shared with listing-page AuctionPanel)
 *      → tap submit → POST /actions/:token/place-bid
 *
 * Each choice maps to the same backend endpoint with a different
 * `isOneShot` flag:
 *   Single bid    → isOneShot: true  (no proxy headroom)
 *   Auto-bid max  → isOneShot: false (proxy will auto-counter up to max)
 *
 * The auction's existing `placeBid` service handles both — we don't
 * need a separate endpoint per mode.
 *
 * Mobile-only: single column, big stepper, big buttons.
 */

import { useState } from 'react';
import { BidStepper, bidIncrement, formatRandStrict } from '@/components/bid-stepper';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface AuctionBidPayload {
  kind: 'AUCTION_BID';
  expiresAt: string;
  greeting: string;
  listing: {
    id: string;
    title: string;
    reference: string | null;
    primaryImageUrl: string | null;
    status: string;
    endTime: string | null;
    currentBid: number | null;
  };
  auction: {
    nextMinBid?: number;
    currentBid?: number;
    bidCount?: number;
    reserveMet?: boolean;
  } | null;
}

type ViewState =
  | { kind: 'choice' }
  | { kind: 'picker'; mode: 'single' | 'auto'; amountCents: number }
  | { kind: 'submitting' }
  | { kind: 'done'; outcome: BidOutcome }
  | { kind: 'error'; message: string };

interface BidOutcome {
  youAreHighBidder: boolean;
  currentBid: number;
  mode: 'single' | 'auto';
  yourMax: number;
  reserveMet: boolean;
}

export function AuctionBidPage({
  token,
  payload,
}: {
  token: string;
  payload: AuctionBidPayload;
}) {
  // Auction-ended guard — auction may have closed between SMS send
  // and tap. Show a tailored message instead of letting the user
  // tap submit only to get a backend rejection.
  const ended =
    payload.listing.status !== 'ACTIVE' ||
    (payload.listing.endTime &&
      new Date(payload.listing.endTime).getTime() <= Date.now());

  if (ended) {
    return <AuctionEndedScreen payload={payload} />;
  }

  const currentBid = payload.auction?.currentBid ?? payload.listing.currentBid ?? 0;
  const minNextBid = payload.auction?.nextMinBid ?? currentBid + bidIncrement(currentBid);

  const [view, setView] = useState<ViewState>({ kind: 'choice' });

  async function submitBid(mode: 'single' | 'auto', amountCents: number) {
    setView({ kind: 'submitting' });
    try {
      const res = await fetch(`${API_URL}/actions/${token}/place-bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxAmount: amountCents,
          isOneShot: mode === 'single',
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        const message = Array.isArray(body.message)
          ? body.message.join(', ')
          : (body.message ?? `Error ${res.status}`);
        setView({ kind: 'error', message });
        return;
      }
      const result = (await res.json()) as {
        youAreHighBidder?: boolean;
        currentBid?: number;
        reserveMet?: boolean;
      };
      setView({
        kind: 'done',
        outcome: {
          youAreHighBidder: !!result.youAreHighBidder,
          currentBid: result.currentBid ?? amountCents,
          mode,
          yourMax: amountCents,
          reserveMet: !!result.reserveMet,
        },
      });
    } catch (err) {
      setView({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : "Couldn't reach All Outdoor — try again in a moment.",
      });
    }
  }

  if (view.kind === 'done') {
    return <DoneScreen outcome={view.outcome} payload={payload} />;
  }
  if (view.kind === 'error') {
    return (
      <ErrorPanel
        message={view.message}
        onRetry={() => setView({ kind: 'choice' })}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <HeaderCard
        title="You've been outbid"
        subtitle={payload.listing.title}
        greeting={payload.greeting}
      />

      {/* Listing thumbnail + reference */}
      <ListingCard listing={payload.listing} />

      {/* Auction state */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <AmountRow label="Current high bid" amountCents={currentBid} primary />
        <AmountRow
          label="Minimum next bid"
          amountCents={minNextBid}
          muted
        />
        {payload.auction?.reserveMet === false && (
          <p
            style={{
              fontSize: 12,
              color: '#f59e0b',
              marginTop: 4,
            }}
          >
            ⚠ Reserve price not yet met. Even if you become the high bidder, the auction won&apos;t close unless the reserve is met by the end time.
          </p>
        )}
        {payload.listing.endTime && (
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              marginTop: 4,
            }}
          >
            Auction ends {formatRelativeExpiry(payload.listing.endTime)}
          </p>
        )}
      </div>

      {/* Choice page */}
      {view.kind === 'choice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ActionButton
            variant="primary"
            onClick={() =>
              setView({
                kind: 'picker',
                mode: 'auto',
                amountCents: minNextBid,
              })
            }
          >
            Set auto-bid max →
          </ActionButton>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              margin: '0 0 4px',
              lineHeight: 1.45,
            }}
          >
            Recommended. We bid the minimum needed to keep you in front, up to your set max.
          </p>

          <ActionButton
            variant="secondary"
            onClick={() =>
              setView({
                kind: 'picker',
                mode: 'single',
                amountCents: minNextBid,
              })
            }
          >
            Place a single bid →
          </ActionButton>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              margin: 0,
              lineHeight: 1.45,
            }}
          >
            One bid, no auto-counter. You&apos;ll need to come back if outbid again.
          </p>
        </div>
      )}

      {/* Amount picker */}
      {view.kind === 'picker' && (
        <PickerForm
          mode={view.mode}
          amountCents={view.amountCents}
          minCents={minNextBid}
          onAmountChange={(v) =>
            setView({ kind: 'picker', mode: view.mode, amountCents: v })
          }
          onSubmit={() => submitBid(view.mode, view.amountCents)}
          onBack={() => setView({ kind: 'choice' })}
        />
      )}

      {view.kind === 'submitting' && (
        <p
          style={{
            textAlign: 'center',
            fontSize: 14,
            color: 'var(--text-secondary)',
            padding: 20,
          }}
        >
          Placing your bid…
        </p>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function PickerForm({
  mode,
  amountCents,
  minCents,
  onAmountChange,
  onSubmit,
  onBack,
}: {
  mode: 'single' | 'auto';
  amountCents: number;
  minCents: number;
  onAmountChange: (v: number) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--red)',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-primary)',
          fontWeight: 500,
          textAlign: 'center',
        }}
      >
        {mode === 'auto' ? 'Your maximum bid' : 'Your one-shot bid'}
      </p>

      <BidStepper
        valueCents={amountCents}
        onChange={onAmountChange}
        minCents={minCents}
        size="large"
      />

      <p
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        {mode === 'auto'
          ? `We'll bid the minimum needed to keep you in front, up to ${formatRandStrict(amountCents)}. If someone bids past this max, you'll get another SMS.`
          : `One-shot bid at ${formatRandStrict(amountCents)} — no auto-counter. If you're outbid again, you'll need to come back.`}
      </p>

      <ActionButton variant="primary" onClick={onSubmit}>
        {mode === 'auto'
          ? `Set max at ${formatRandStrict(amountCents)}`
          : `Bid ${formatRandStrict(amountCents)} now`}
      </ActionButton>
      <ActionButton variant="ghost" onClick={onBack}>
        ← Back
      </ActionButton>
    </div>
  );
}

function DoneScreen({
  outcome,
  payload,
}: {
  outcome: BidOutcome;
  payload: AuctionBidPayload;
}) {
  const headline = outcome.youAreHighBidder
    ? "You're the high bidder"
    : 'Bid placed — but you were outbid';

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
        padding: 28,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: outcome.youAreHighBidder ? '#22c55e' : 'var(--text-tertiary)',
          color: '#fff',
          fontSize: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
        }}
      >
        {outcome.youAreHighBidder ? '✓' : '↑'}
      </div>
      <p
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 14,
        }}
      >
        {headline}
      </p>
      <div
        style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Current high bid:</span>
          <span
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatRandStrict(outcome.currentBid)}
          </span>
        </div>
        {outcome.mode === 'auto' && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Your max:</span>
            <span
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatRandStrict(outcome.yourMax)}
            </span>
          </div>
        )}
      </div>
      {!outcome.youAreHighBidder && (
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            marginTop: 16,
            lineHeight: 1.5,
            background: 'var(--bg-inset)',
            padding: 12,
            borderRadius: 6,
          }}
        >
          Someone else has a higher{' '}
          {outcome.mode === 'auto' ? 'auto-bid max' : 'one-shot bid'}.
          You&apos;ll get another SMS if you want to raise it.
        </p>
      )}
      {outcome.youAreHighBidder && (
        <p
          style={{
            fontSize: 13,
            color: '#22c55e',
            marginTop: 16,
            lineHeight: 1.5,
          }}
        >
          {payload.listing.endTime &&
            `If no one outbids you before ${new Date(payload.listing.endTime).toLocaleString('en-ZA')}, this firearm is yours.`}
        </p>
      )}
    </div>
  );
}

function AuctionEndedScreen({ payload }: { payload: AuctionBidPayload }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
        padding: 28,
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 8,
        }}
      >
        This auction has ended
      </p>
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          marginBottom: 16,
        }}
      >
        {payload.listing.title}
      </p>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-tertiary)',
        }}
      >
        Sign in to your All Outdoor account to see who won and whether the reserve was met.
      </p>
    </div>
  );
}

// ─── Shared bits (could be lifted later if duplication grows) ────────

function HeaderCard({
  title,
  subtitle,
  greeting,
}: {
  title: string;
  subtitle: string;
  greeting: string;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}
      >
        Hi {greeting},
      </p>
      <p
        style={{
          fontSize: 17,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 6,
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-tertiary)',
          lineHeight: 1.4,
        }}
      >
        {subtitle}
      </p>
    </div>
  );
}

function ListingCard({
  listing,
}: {
  listing: AuctionBidPayload['listing'];
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      {listing.primaryImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={listing.primaryImageUrl}
          alt={listing.title}
          style={{
            width: 72,
            height: 72,
            objectFit: 'cover',
            borderRadius: 8,
            border: '0.5px solid var(--border)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 8,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: 'var(--text-primary)',
            marginBottom: 4,
            lineHeight: 1.3,
          }}
        >
          {listing.title}
        </p>
        {listing.reference && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {listing.reference}
          </p>
        )}
      </div>
    </div>
  );
}

function AmountRow({
  label,
  amountCents,
  muted,
  primary,
}: {
  label: string;
  amountCents: number;
  muted?: boolean;
  primary?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
      }}
    >
      <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: primary ? 22 : 16,
          fontWeight: primary ? 600 : 400,
          color: muted
            ? 'var(--text-tertiary)'
            : primary
              ? 'var(--red)'
              : 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatRandStrict(amountCents)}
      </span>
    </div>
  );
}

function ActionButton({
  variant,
  onClick,
  disabled,
  children,
}: {
  variant: 'primary' | 'secondary' | 'ghost';
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const styles: Record<typeof variant, React.CSSProperties> = {
    primary: {
      background: disabled ? 'var(--bg-inset)' : 'var(--red)',
      color: disabled ? 'var(--text-tertiary)' : '#fff',
      border: 'none',
    },
    secondary: {
      background: 'var(--bg-card)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border)',
    },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 52,
        borderRadius: 10,
        fontSize: 16,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
        ...styles[variant],
      }}
    >
      {children}
    </button>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--red)',
        borderRadius: 12,
        padding: 20,
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--red)',
          marginBottom: 8,
        }}
      >
        Couldn&apos;t place that bid
      </p>
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          marginBottom: 20,
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
      <ActionButton variant="secondary" onClick={onRetry}>
        Try again
      </ActionButton>
    </div>
  );
}

function formatRelativeExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'soon';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `in ${days}d ${hours % 24}h`;
  }
  if (hours >= 1) {
    const mins = Math.floor((ms - hours * 3_600_000) / 60_000);
    return `in ${hours}h ${mins}m`;
  }
  const mins = Math.floor(ms / 60_000);
  return `in ${mins}m`;
}
