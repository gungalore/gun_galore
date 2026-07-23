'use client';

/**
 * Offer decision page — handles BOTH directions of the offer/counter
 * conversation:
 *
 *   OFFER_DECISION   — seller sees a buyer's fresh offer
 *                      Actions: Accept / Counter / Reject
 *                      Endpoints: accept-offer / counter-offer / reject-offer
 *
 *   COUNTER_DECISION — buyer sees the seller's counter
 *                      Actions: Accept / Reject only
 *                      Endpoints: accept-counter / reject-counter
 *                      (the offer state machine is single-counter — the buyer
 *                      cannot counter-back, so no counter button is shown here.
 *                      FLOW-F5: showing it 403'd on the OFFER_DECISION-only
 *                      counter-offer handler and burned the token's attempts.)
 *
 * Mobile-only: single column, large tap targets, no desktop layout.
 */

import { useState } from 'react';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface OfferDecisionPayload {
  kind: 'OFFER_DECISION' | 'COUNTER_DECISION';
  expiresAt: string;
  offerExpiresAt: string | null;
  offerStatus: string;
  greeting: string;
  listing: {
    id: string;
    title: string;
    listPrice: number | null;
    reference: string | null;
    primaryImageUrl: string | null;
  };
  offer: {
    id: string;
    amount: number; // original buyer offer (cents)
    counterAmount: number | null; // seller's counter if any (cents)
    buyerUsername: string;
    buyerNote: string | null;
    sellerNote: string | null;
  };
}

type ViewState =
  | { kind: 'choice' }
  | { kind: 'countering'; amountCents: number }
  // Seller declining an offer — reason ticklist required (drives the
  // seller-standing policy; mirrors /offers/received).
  | { kind: 'rejecting'; reason: string | null; note: string }
  | { kind: 'submitting' }
  | { kind: 'done'; outcome: 'accepted' | 'rejected' | 'countered'; amount?: number }
  | { kind: 'error'; message: string };

// Mirrors OFFER_REJECT_REASONS (backend/src/common/seller-reject-policy.ts).
const DECLINE_REASONS = [
  { value: 'ITEM_NO_LONGER_AVAILABLE', label: 'Item is no longer available' },
  { value: 'ITEM_DAMAGED', label: 'Item is damaged or faulty' },
  { value: 'OFFER_TOO_LOW', label: 'Offer is too low' },
  { value: 'BUYER_SUSPICIOUS', label: 'Concerns about the buyer' },
  { value: 'LISTING_ERROR', label: 'Listing had an error (price/details)' },
  { value: 'CHANGED_MIND', label: 'No longer selling' },
  { value: 'OTHER', label: 'Other (write a reason)' },
];

export function OfferDecisionPage({
  token,
  payload,
}: {
  token: string;
  payload: OfferDecisionPayload;
}) {
  // Which amount is the "decision amount" — what the user is being
  // asked to accept or reject. For OFFER_DECISION it's the buyer's
  // offer; for COUNTER_DECISION it's the seller's counter.
  const decisionAmount =
    payload.kind === 'OFFER_DECISION'
      ? payload.offer.amount
      : (payload.offer.counterAmount ?? payload.offer.amount);

  // Sensible starting amount for the counter input. Anchored
  // halfway between the current "decision amount" and the listing
  // price, snapped up to the nearest R100. That makes the +/- a
  // natural starting point regardless of which direction the user
  // wants to push.
  const initialCounter = roundToStep(
    Math.round(
      (decisionAmount + (payload.listing.listPrice ?? decisionAmount)) / 2,
    ),
    10_000, // R100 in cents
  );

  const [view, setView] = useState<ViewState>({ kind: 'choice' });

  async function callAction(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<void> {
    setView({ kind: 'submitting' });
    try {
      const res = await fetch(`${API_URL}/actions/${token}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
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
      // Successful — what outcome?
      const outcome =
        endpoint.includes('accept')
          ? 'accepted'
          : endpoint.includes('reject')
            ? 'rejected'
            : 'countered';
      setView({
        kind: 'done',
        outcome,
        amount: endpoint.startsWith('counter')
          ? (body?.amount as number | undefined)
          : decisionAmount,
      });
    } catch (err) {
      setView({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : "Couldn't reach Gun Galore — try again in a moment.",
      });
    }
  }

  // ─── Done / success state ────────────────────────────────────────
  if (view.kind === 'done') {
    return (
      <DoneScreen
        outcome={view.outcome}
        amount={view.amount}
        listingTitle={payload.listing.title}
        isSeller={payload.kind === 'OFFER_DECISION'}
      />
    );
  }

  // ─── Error state (transient — user can tap retry to go back) ─────
  if (view.kind === 'error') {
    return (
      <ErrorPanel
        message={view.message}
        onRetry={() => setView({ kind: 'choice' })}
      />
    );
  }

  // ─── Default: render the offer details + action buttons ──────────
  const isSubmitting = view.kind === 'submitting';
  const isCountering = view.kind === 'countering';
  const isRejecting = view.kind === 'rejecting';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header card */}
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
          Hi {payload.greeting},
        </p>
        <p
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {payload.kind === 'OFFER_DECISION'
            ? `You have a new offer from @${payload.offer.buyerUsername}`
            : `The seller has countered your offer`}
        </p>
      </div>

      {/* Listing card */}
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
        {payload.listing.primaryImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={payload.listing.primaryImageUrl}
            alt={payload.listing.title}
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
            {payload.listing.title}
          </p>
          {payload.listing.reference && (
            <p
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {payload.listing.reference}
            </p>
          )}
        </div>
      </div>

      {/* Amounts card */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {payload.listing.listPrice ? (
          <AmountRow
            label="Your listing price"
            amountCents={payload.listing.listPrice}
            muted
          />
        ) : null}

        {payload.kind === 'OFFER_DECISION' ? (
          <AmountRow
            label="Offer amount"
            amountCents={payload.offer.amount}
            primary
          />
        ) : (
          <>
            <AmountRow
              label="Your offer was"
              amountCents={payload.offer.amount}
              muted
            />
            <AmountRow
              label="Seller's counter"
              amountCents={payload.offer.counterAmount ?? payload.offer.amount}
              primary
            />
          </>
        )}

        {payload.offer.buyerNote && (
          <NoteBlock
            label={`Note from @${payload.offer.buyerUsername}`}
            text={payload.offer.buyerNote}
          />
        )}
        {payload.offer.sellerNote && (
          <NoteBlock
            label="Note from the seller"
            text={payload.offer.sellerNote}
          />
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ActionButton
          variant="primary"
          disabled={isSubmitting || isCountering}
          onClick={() => {
            const endpoint =
              payload.kind === 'OFFER_DECISION'
                ? 'accept-offer'
                : 'accept-counter';
            void callAction(endpoint);
          }}
        >
          {isSubmitting && view.kind === 'submitting'
            ? 'Working…'
            : `Accept ${formatRand(decisionAmount)}`}
        </ActionButton>

        {/* FLOW-F5 — the counter button only exists for the SELLER's
            OFFER_DECISION view. The offer state machine is single-counter
            (buyer offers → seller counters once → buyer accepts/rejects); there
            is no buyer counter-back handler, so showing it on the buyer's
            COUNTER_DECISION view routed to counter-offer, which requires an
            OFFER_DECISION token → 403 + a burned attempt each tap. The buyer's
            choices on a counter are Accept or Reject. */}
        {payload.kind === 'OFFER_DECISION' && (
          <ActionButton
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => {
              if (isCountering) {
                setView({ kind: 'choice' });
              } else {
                setView({ kind: 'countering', amountCents: initialCounter });
              }
            }}
          >
            {isCountering ? '← Cancel counter' : 'Counter offer'}
          </ActionButton>
        )}

        <ActionButton
          variant="ghost"
          disabled={isSubmitting || isCountering || isRejecting}
          onClick={() => {
            if (payload.kind === 'OFFER_DECISION') {
              // Seller decline needs a reason — open the ticklist.
              setView({ kind: 'rejecting', reason: null, note: '' });
            } else {
              // Buyer declining a counter — no reason required.
              void callAction('reject-counter');
            }
          }}
        >
          Reject
        </ActionButton>
      </div>

      {/* Decline-reason ticklist (seller, OFFER_DECISION only) */}
      {isRejecting && view.kind === 'rejecting' && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 10,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
          }}
        >
          <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Why are you declining?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DECLINE_REASONS.map((r) => (
              <label
                key={r.value}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: 'var(--text-primary)', cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  name="a-decline-reason"
                  checked={view.reason === r.value}
                  onChange={() => setView({ kind: 'rejecting', reason: r.value, note: view.note })}
                  style={{ marginTop: 3 }}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
          {view.reason === 'OTHER' && (
            <textarea
              value={view.note}
              onChange={(e) => setView({ kind: 'rejecting', reason: view.reason, note: e.target.value })}
              maxLength={300}
              rows={2}
              placeholder="Briefly describe your reason (min 10 characters)"
              style={{
                width: '100%',
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 14,
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
                resize: 'vertical',
              }}
            />
          )}
          <p style={{ margin: '10px 0 12px', fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            The buyer sees this reason. Every decline records a strike
            against your seller standing (buyer concerns go to admin review
            instead — no strike). Three strikes suspends selling on your
            account; buying is unaffected. Countering is always penalty-free.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionButton variant="ghost" onClick={() => setView({ kind: 'choice' })}>
              ← Back
            </ActionButton>
            <ActionButton
              variant="secondary"
              disabled={
                !view.reason ||
                (view.reason === 'OTHER' && view.note.trim().length < 10)
              }
              onClick={() => {
                void callAction('reject-offer', {
                  reason: view.reason,
                  note: view.note.trim() || undefined,
                });
              }}
            >
              Confirm decline
            </ActionButton>
          </div>
        </div>
      )}

      {/* Counter form — slides into view when "Counter" tapped */}
      {isCountering && (
        <CounterForm
          amountCents={view.amountCents}
          minCents={1_000} // R10 floor
          listingPriceCents={payload.listing.listPrice}
          onAmountChange={(v) => setView({ kind: 'countering', amountCents: v })}
          onSubmit={() => {
            void callAction('counter-offer', { amount: view.amountCents });
          }}
          submitting={false}
        />
      )}

      {/* Expiry hint */}
      {payload.offerExpiresAt && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            textAlign: 'center',
          }}
        >
          This offer expires{' '}
          {formatRelativeExpiry(payload.offerExpiresAt)}
        </p>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

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
      <span
        style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
        }}
      >
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
        }}
      >
        {formatRand(amountCents)}
      </span>
    </div>
  );
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 10,
      }}
    >
      <p
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-tertiary)',
          marginBottom: 4,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-primary)',
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </p>
    </div>
  );
}

function CounterForm({
  amountCents,
  minCents,
  listingPriceCents,
  onAmountChange,
  onSubmit,
  submitting,
}: {
  amountCents: number;
  minCents: number;
  listingPriceCents: number | null;
  onAmountChange: (v: number) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const step = 10_000; // R100 increments — sensible counter granularity
  const canDecrement = amountCents - step >= minCents;
  // No upper cap — sellers can counter ABOVE listing price if they
  // want (e.g. small bundle discount they're not willing to honour).
  // Just show a hint when they cross the listing price.
  const aboveListing =
    listingPriceCents != null && amountCents > listingPriceCents;

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
      <div style={{ textAlign: 'center' }}>
        <p
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-tertiary)',
            marginBottom: 6,
          }}
        >
          Your counter offer
        </p>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          <StepperButton
            onClick={() => onAmountChange(amountCents - step)}
            disabled={!canDecrement}
            label="−"
          />
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: 'var(--red)',
              minWidth: 140,
              textAlign: 'center',
            }}
          >
            {formatRand(amountCents)}
          </div>
          <StepperButton
            onClick={() => onAmountChange(amountCents + step)}
            label="+"
          />
        </div>
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            marginTop: 8,
          }}
        >
          R100 steps
        </p>
      </div>

      {aboveListing && (
        <p
          style={{
            fontSize: 12,
            color: '#f59e0b',
            textAlign: 'center',
            background: 'rgba(245,158,11,0.08)',
            border: '0.5px solid rgba(245,158,11,0.45)',
            borderRadius: 6,
            padding: '8px 10px',
          }}
        >
          This counter is above your listing price. Buyers usually
          expect counters to come down, not up.
        </p>
      )}

      <ActionButton
        variant="primary"
        disabled={submitting || amountCents < minCents}
        onClick={onSubmit}
      >
        {submitting ? 'Sending…' : `Send counter — ${formatRand(amountCents)}`}
      </ActionButton>
    </div>
  );
}

function StepperButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label === '+' ? 'Increase' : 'Decrease'}
      style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: disabled ? 'var(--bg-inset)' : 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
        fontSize: 28,
        fontWeight: 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

function DoneScreen({
  outcome,
  amount,
  listingTitle,
  isSeller,
}: {
  outcome: 'accepted' | 'rejected' | 'countered';
  amount?: number;
  listingTitle: string;
  isSeller: boolean;
}) {
  const copy = (() => {
    if (outcome === 'accepted') {
      return {
        title: isSeller ? 'Offer accepted' : 'Counter accepted',
        body: isSeller
          ? `You've accepted ${formatRand(amount ?? 0)} for "${listingTitle}". The buyer has 24 hours to pay — we'll text you when they do.`
          : `You've accepted the seller's counter at ${formatRand(amount ?? 0)} for "${listingTitle}". Check your phone for the payment link.`,
        emoji: '✓',
        color: '#22c55e',
      };
    }
    if (outcome === 'rejected') {
      return {
        title: 'Rejected',
        body: isSeller
          ? `You've rejected the offer on "${listingTitle}".`
          : `You've rejected the seller's counter on "${listingTitle}".`,
        emoji: '✕',
        color: 'var(--text-tertiary)',
      };
    }
    return {
      title: 'Counter sent',
      body: isSeller
        ? `You've countered at ${formatRand(amount ?? 0)} for "${listingTitle}". The buyer has 24 hours to respond.`
        : `Your counter-back has been sent to the seller. They have 24 hours to respond.`,
      emoji: '↔',
      color: 'var(--red)',
    };
  })();

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
          background: copy.color,
          color: '#fff',
          fontSize: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
        }}
      >
        {copy.emoji}
      </div>
      <p
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}
      >
        {copy.title}
      </p>
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
      >
        {copy.body}
      </p>
    </div>
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
        Couldn&apos;t complete that action
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

// ─── Helpers ─────────────────────────────────────────────────────────

function formatRand(cents: number): string {
  const rand = cents / 100;
  return `R ${rand.toLocaleString('en-US', {
    minimumFractionDigits: rand % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
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
