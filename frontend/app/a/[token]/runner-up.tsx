'use client';

/**
 * Auction runner-up page — the seller's one-tap "offer it to the next bidder"
 * landing from the winner-didn't-pay SMS.
 *
 *   AUCTION_RUNNER_UP — an auction winner blew the 24h pay window, so the
 *                       listing went EXPIRED and the winner took a strike.
 *                       The second-highest bidder is a proven buyer who
 *                       already named a price; offering it to them beats
 *                       restarting a 7-day auction to reach someone we
 *                       already had. Endpoint: offer-runner-up.
 *
 * SELLER-CONFIRMED, never automatic — the platform never sells on someone's
 * behalf. Declining costs nothing: the listing stays EXPIRED and relisting
 * is still there.
 *
 * The runner-up's id and amount live in the TOKEN, not in this page's state,
 * so nothing here can nominate a different buyer or a different price. The
 * backend re-validates both against live state before promoting anything.
 *
 * Mobile-only: single column, large tap targets, no desktop layout.
 */

import { useState } from 'react';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface RunnerUpPayload {
  kind: 'AUCTION_RUNNER_UP';
  expiresAt: string;
  greeting: string;
  listing: {
    id: string;
    title: string;
    reference: string | null;
    primaryImageUrl: string | null;
    status: string;
  };
  runnerUp: {
    username: string | null;
    amount: number | null;
  };
  /** False when the seller already relisted, or the bidder has since been
   *  banned / struck out — render an explanation, not a dead button. */
  stillAvailable: boolean;
}

type ViewState =
  | { kind: 'choice' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'declined' }
  | { kind: 'error'; message: string };

function rand(cents: number | null): string {
  if (cents === null) return '—';
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

const CARD: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 12,
  padding: 20,
};

export function RunnerUpPage({
  token,
  payload,
}: {
  token: string;
  payload: RunnerUpPayload;
}) {
  const [view, setView] = useState<ViewState>({ kind: 'choice' });

  async function accept(): Promise<void> {
    setView({ kind: 'submitting' });
    try {
      const res = await fetch(`${API_URL}/actions/${token}/offer-runner-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      setView({ kind: 'done' });
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

  // ─── Offered ─────────────────────────────────────────────────────
  if (view.kind === 'done') {
    return (
      <div style={{ ...CARD, textAlign: 'center' }}>
        <p style={{ fontSize: 30, marginBottom: 8 }} aria-hidden>
          ✅
        </p>
        <p
          style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}
        >
          Offered to {payload.runnerUp.username ?? 'the next bidder'}
        </p>
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            marginTop: 8,
            lineHeight: 1.55,
          }}
        >
          We&apos;ve told them they can buy {payload.listing.title} for{' '}
          {rand(payload.runnerUp.amount)}, and they have 24 hours to pay. If
          they don&apos;t, nothing is lost — the listing comes back to you and
          you can relist it as normal.
        </p>
      </div>
    );
  }

  // ─── Declined (local only — nothing to tell the backend) ─────────
  if (view.kind === 'declined') {
    return (
      <div style={{ ...CARD, textAlign: 'center' }}>
        <p
          style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}
        >
          No problem
        </p>
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            marginTop: 8,
            lineHeight: 1.55,
          }}
        >
          We haven&apos;t offered it to anyone. {payload.listing.title} is still
          yours — relist it whenever you&apos;re ready from your listings page.
        </p>
      </div>
    );
  }

  if (view.kind === 'error') {
    return (
      <div style={{ ...CARD, border: '0.5px solid var(--red)' }}>
        <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--red)' }}>
          Couldn&apos;t offer it
        </p>
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            marginTop: 8,
            lineHeight: 1.55,
          }}
        >
          {view.message}
        </p>
        <button
          type="button"
          onClick={() => setView({ kind: 'choice' })}
          style={{
            marginTop: 16,
            width: '100%',
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Back
        </button>
      </div>
    );
  }

  // ─── Window closed under the seller ──────────────────────────────
  if (!payload.stillAvailable) {
    return (
      <div style={CARD}>
        <p
          style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}
        >
          This offer is no longer available
        </p>
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            marginTop: 8,
            lineHeight: 1.55,
          }}
        >
          Either you&apos;ve already relisted {payload.listing.title}, or the
          next-highest bidder can no longer be offered it. Nothing has changed —
          your listing is exactly where you left it.
        </p>
      </div>
    );
  }

  const submitting = view.kind === 'submitting';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...CARD, textAlign: 'center' }}>
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
          style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}
        >
          Your winning bidder didn&apos;t pay
        </p>
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            marginTop: 8,
            lineHeight: 1.55,
          }}
        >
          There&apos;s a second buyer who already bid on this item.
        </p>
      </div>

      {/* Listing */}
      <div
        style={{
          ...CARD,
          padding: 16,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        {payload.listing.primaryImageUrl && (
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
        )}
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            {payload.listing.title}
          </p>
          {payload.listing.reference && (
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                fontFamily: 'ui-monospace, monospace',
                marginTop: 2,
              }}
            >
              {payload.listing.reference}
            </p>
          )}
        </div>
      </div>

      {/* The offer */}
      <div style={{ ...CARD, textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          {payload.runnerUp.username ?? 'The next bidder'} bid
        </p>
        <p
          style={{
            fontSize: 30,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
            margin: '4px 0 8px',
          }}
        >
          {rand(payload.runnerUp.amount)}
        </p>
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
          }}
        >
          Offer it to them at that price and they get 24 hours to pay, exactly
          like a normal win. If they don&apos;t pay, the listing comes back to
          you and you can still relist.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void accept()}
        disabled={submitting}
        style={{
          width: '100%',
          padding: '16px',
          borderRadius: 10,
          background: submitting ? 'var(--bg-inset)' : 'var(--red)',
          color: submitting ? 'var(--text-tertiary)' : '#fff',
          border: 'none',
          fontSize: 16,
          fontWeight: 600,
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting
          ? 'Offering…'
          : `Sell to them for ${rand(payload.runnerUp.amount)}`}
      </button>

      <button
        type="button"
        onClick={() => setView({ kind: 'declined' })}
        disabled={submitting}
        style={{
          width: '100%',
          padding: '14px',
          borderRadius: 10,
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: '0.5px solid var(--border)',
          fontSize: 15,
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        No thanks — I&apos;ll relist it
      </button>
    </div>
  );
}
