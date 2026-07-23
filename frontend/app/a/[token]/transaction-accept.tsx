'use client';

/**
 * Transaction-accept page — seller's one-tap "I'll handle this sale"
 * landing from the post-payment SMS.
 *
 *   TRANSACTION_ACCEPT — buyer just paid; seller has 48h to accept.
 *                        Actions: Accept (one-tap) [+ Reject — Phase 2]
 *                        Endpoint: accept-transaction
 *
 * After accept fires successfully:
 *   - Backend stamps `acceptedAt` + computes `dispatchDeadlineAt` (5d)
 *   - Buyer + seller get an updated transaction view
 *   - Seller can dispatch from /transactions/:id OR via the existing
 *     48h dispatch nudge SMS (a separate token)
 *
 * Idempotent: if the seller has already accepted (e.g. tapped from
 * two devices, hit refresh after success) the page surfaces the
 * "already accepted" state instead of double-firing the action.
 *
 * Mobile-only: single column, large tap targets, no desktop layout.
 */

import { useEffect, useState } from 'react';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface TransactionAcceptPayload {
  kind: 'TRANSACTION_ACCEPT';
  expiresAt: string;
  greeting: string;
  transaction: {
    id: string;
    paidAt: string | null;
    acceptedAt: string | null;
    rejectedAt: string | null;
    acceptDeadlineAt: string | null;
    shippingMethod: string | null;
  };
  listing: {
    id: string;
    title: string;
    reference: string | null;
    listPrice: number | null;
    primaryImageUrl: string | null;
  };
  buyerUsername: string;
}

const REJECT_REASONS = [
  { value: 'SOLD_ELSEWHERE', label: 'I’ve sold this elsewhere' },
  { value: 'STOCK_ISSUE', label: 'Out of stock / item damaged' },
  {
    value: 'CANT_FULFIL_SHIPPING',
    label: 'Can’t fulfil shipping (location / dealer)',
  },
  { value: 'BUYER_SUSPICIOUS', label: 'Buyer seems suspicious' },
  { value: 'OTHER', label: 'Other (write a reason)' },
] as const;

type RejectReasonKey = (typeof REJECT_REASONS)[number]['value'];

type ViewState =
  | { kind: 'choice' }
  | { kind: 'rejecting'; reason: RejectReasonKey | null; freeText: string }
  | { kind: 'submitting' }
  | { kind: 'done'; outcome: 'accepted' | 'rejected' }
  | { kind: 'error'; message: string };

export function TransactionAcceptPage({
  token,
  payload,
}: {
  token: string;
  payload: TransactionAcceptPayload;
}) {
  // Initial view depends on whether the seller already accepted.
  // resolve() doesn't consume the token, so if they refresh after
  // a successful tap we want to show the "already accepted" state
  // rather than the live Accept button.
  const alreadyAccepted = payload.transaction.acceptedAt != null;
  const alreadyRejected = payload.transaction.rejectedAt != null;

  const [view, setView] = useState<ViewState>(
    alreadyRejected
      ? { kind: 'done', outcome: 'rejected' }
      : alreadyAccepted
        ? { kind: 'done', outcome: 'accepted' }
        : { kind: 'choice' },
  );

  async function callAccept(): Promise<void> {
    setView({ kind: 'submitting' });
    try {
      const res = await fetch(
        `${API_URL}/actions/${token}/accept-transaction`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
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
      setView({ kind: 'done', outcome: 'accepted' });
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

  async function callReject(reasonText: string): Promise<void> {
    setView({ kind: 'submitting' });
    try {
      const res = await fetch(
        `${API_URL}/actions/${token}/reject-transaction`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reasonText }),
        },
      );
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
      setView({ kind: 'done', outcome: 'rejected' });
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
        listingTitle={payload.listing.title}
        buyerUsername={payload.buyerUsername}
        outcome={view.outcome}
        wasAlreadyAccepted={alreadyAccepted}
        wasAlreadyRejected={alreadyRejected}
      />
    );
  }

  // ─── Error state — user can tap retry to go back ─────────────────
  if (view.kind === 'error') {
    return (
      <ErrorPanel
        message={view.message}
        onRetry={() => setView({ kind: 'choice' })}
      />
    );
  }

  // ─── Reject — reason picker ──────────────────────────────────────
  if (view.kind === 'rejecting') {
    return (
      <RejectPicker
        reason={view.reason}
        freeText={view.freeText}
        listingTitle={payload.listing.title}
        onChangeReason={(reason) =>
          setView({ kind: 'rejecting', reason, freeText: view.freeText })
        }
        onChangeFreeText={(freeText) =>
          setView({ kind: 'rejecting', reason: view.reason, freeText })
        }
        onCancel={() => setView({ kind: 'choice' })}
        onSubmit={(reasonText) => void callReject(reasonText)}
      />
    );
  }

  // ─── Default: render the sale details + Accept button ────────────
  const isSubmitting = view.kind === 'submitting';

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
          @{payload.buyerUsername} has paid for your listing
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

      {/* Sale-price card */}
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
            Sale price
          </span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--red)',
            }}
          >
            {payload.listing.listPrice
              ? formatRand(payload.listing.listPrice)
              : '—'}
          </span>
        </div>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            lineHeight: 1.5,
            marginTop: 4,
          }}
        >
          Payment is being <strong>held safely</strong> by Gun Galore and
          will be released once the buyer confirms delivery.
        </p>
      </div>

      {/* What-happens-next explainer */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <p
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-tertiary)',
          }}
        >
          What happens when you accept
        </p>
        <ol
          style={{
            margin: 0,
            paddingLeft: 22,
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          <li>The sale is locked in — buyer is notified you accepted.</li>
          <li>
            You have <strong style={{ color: 'var(--text-primary)' }}>5 days</strong>{' '}
            to dispatch the item.
          </li>
          {payload.transaction.shippingMethod === 'DEALER_TRANSFER' ? (
            <li>
              For dealer-transfer firearms: drop with your SAPS-licensed
              dealer + upload the 3 verification photos (SAPS 534 in BLOCK
              LETTERS).
            </li>
          ) : (
            <li>
              We&rsquo;ll send you a dispatch reminder SMS with a one-tap
              link to enter the tracking reference.
            </li>
          )}
          <li>Once the buyer confirms delivery, your payout is released.</li>
        </ol>
      </div>

      {/* Action buttons — Accept / Reject */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ActionButton
          variant="primary"
          disabled={isSubmitting}
          onClick={() => void callAccept()}
        >
          {isSubmitting ? 'Working…' : 'Accept this sale'}
        </ActionButton>
        <ActionButton
          variant="ghost"
          disabled={isSubmitting}
          onClick={() =>
            setView({ kind: 'rejecting', reason: null, freeText: '' })
          }
        >
          I can&rsquo;t fulfil — reject + refund buyer
        </ActionButton>
      </div>

      {/* Deadline hint */}
      {payload.transaction.acceptDeadlineAt && (
        <DeadlineCountdown
          deadlineIso={payload.transaction.acceptDeadlineAt}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function DeadlineCountdown({ deadlineIso }: { deadlineIso: string }) {
  // Re-render every 30s so the countdown stays roughly fresh. Tab
  // visibility doesn't matter here — the page is a one-shot landing.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const ms = new Date(deadlineIso).getTime() - Date.now();
  const expired = ms <= 0;
  const text = expired
    ? 'Accept window has expired'
    : `You have ${formatRelative(ms)} to accept`;
  return (
    <p
      style={{
        fontSize: 12,
        color: expired ? 'var(--red)' : 'var(--text-tertiary)',
        textAlign: 'center',
      }}
    >
      {text}
    </p>
  );
}

function RejectPicker({
  reason,
  freeText,
  listingTitle,
  onChangeReason,
  onChangeFreeText,
  onCancel,
  onSubmit,
}: {
  reason: RejectReasonKey | null;
  freeText: string;
  listingTitle: string;
  onChangeReason: (reason: RejectReasonKey) => void;
  onChangeFreeText: (freeText: string) => void;
  onCancel: () => void;
  onSubmit: (reasonText: string) => void;
}) {
  const canSubmit =
    reason !== null && (reason !== 'OTHER' || freeText.trim().length >= 3);
  // "CODE: label" — code prefix drives the seller-standing policy backend-
  // side; label keeps the stored reason readable (same as the web panel).
  const submittable =
    reason === 'OTHER'
      ? `OTHER: ${freeText.trim()}`
      : `${reason}: ${REJECT_REASONS.find((r) => r.value === reason)?.label ?? ''}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--red)',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <p
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}
        >
          Reject this sale?
        </p>
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
            marginBottom: 16,
          }}
        >
          The buyer will be refunded in full and notified of your reason.
          Rejecting a paid sale records a strike against your seller
          standing (genuine buyer concerns go to admin review instead) —
          three strikes suspends selling on your account.
        </p>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginBottom: 12,
          }}
        >
          {REJECT_REASONS.map((r) => (
            <label
              key={r.value}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: 12,
                borderRadius: 8,
                background:
                  reason === r.value
                    ? 'var(--bg-inset)'
                    : 'transparent',
                border: `0.5px solid ${
                  reason === r.value
                    ? 'var(--text-secondary)'
                    : 'var(--border)'
                }`,
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="reject-reason"
                checked={reason === r.value}
                onChange={() => onChangeReason(r.value)}
                style={{ marginTop: 4 }}
              />
              <span
                style={{
                  fontSize: 14,
                  color: 'var(--text-primary)',
                  lineHeight: 1.4,
                }}
              >
                {r.label}
              </span>
            </label>
          ))}
        </div>
        {reason === 'OTHER' && (
          <textarea
            value={freeText}
            onChange={(e) => onChangeFreeText(e.target.value)}
            placeholder="Tell the buyer what happened (min 3 chars)"
            rows={3}
            maxLength={500}
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 8,
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              fontSize: 14,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ActionButton
          variant="primary"
          disabled={!canSubmit}
          onClick={() => onSubmit(submittable)}
        >
          Reject + refund buyer
        </ActionButton>
        <ActionButton variant="ghost" onClick={onCancel}>
          ← Back
        </ActionButton>
      </div>
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

function DoneScreen({
  listingTitle,
  buyerUsername,
  outcome,
  wasAlreadyAccepted,
  wasAlreadyRejected,
}: {
  listingTitle: string;
  buyerUsername: string;
  outcome: 'accepted' | 'rejected';
  wasAlreadyAccepted: boolean;
  wasAlreadyRejected: boolean;
}) {
  // Branch copy on prior-state + outcome of THIS visit. Prior-state
  // wins so a refresh hours later doesn't say "you've just accepted".
  const justRejected = outcome === 'rejected' && !wasAlreadyRejected;
  const justAccepted = outcome === 'accepted' && !wasAlreadyAccepted;
  const copy = wasAlreadyRejected
    ? {
        title: 'Sale rejected',
        body: `You previously rejected the sale on "${listingTitle}". The buyer has been refunded — no further action needed.`,
        emoji: '✕',
        color: 'var(--text-tertiary)',
      }
    : justRejected
      ? {
          title: 'Sale rejected — buyer refunded',
          body: `You've rejected the sale on "${listingTitle}". The buyer has been refunded in full and notified of your reason. The listing is live again on the marketplace.`,
          emoji: '✕',
          color: 'var(--text-tertiary)',
        }
      : wasAlreadyAccepted
        ? {
            title: 'Sale already accepted',
            body: `You've already accepted the sale on "${listingTitle}" from @${buyerUsername}. We'll send another SMS with the dispatch link when it's time to ship.`,
            emoji: '✓',
            color: '#22c55e',
          }
        : justAccepted
          ? {
              title: 'Sale accepted',
              body: `You've accepted the sale on "${listingTitle}" from @${buyerUsername}. You have 5 days to dispatch — we'll send a separate SMS with a one-tap dispatch link.`,
              emoji: '✓',
              color: '#22c55e',
            }
          : {
              title: 'Done',
              body: `Action on "${listingTitle}" is complete.`,
              emoji: '✓',
              color: '#22c55e',
            };

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

function formatRelative(ms: number): string {
  if (ms <= 0) return 'no time';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours >= 1) {
    const mins = Math.floor((ms - hours * 3_600_000) / 60_000);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const mins = Math.floor(ms / 60_000);
  return `${mins}m`;
}
