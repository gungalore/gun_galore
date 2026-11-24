'use client';

import { useState } from 'react';
import { BRAND_NAME } from '../../../lib/brand';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * The signed-out Private Arrangement handover page. The token is scoped to ONE
 * party (seller or buyer) and one transaction; the backend verifies the party
 * before acting. No session, no phone number in the URL.
 *
 * Seller: Item delivered / Report that the handover did not happen
 * Buyer:  Item received  / Report that the handover did not happen
 *
 * That report is a NON-DELIVERY route only: the item was never handed over, or
 * the seller is unreachable. If the item was received but is not as expected,
 * that is between the buyer and the seller (message + complaint), not a
 * platform refund.
 */
export interface PrivateArrangeActionPayload {
  kind: 'PRIVATE_ARRANGE_ACTION';
  role: 'seller' | 'buyer';
  expiresAt: string;
  greeting: string;
  transaction: {
    id: string;
    orderReference: string | null;
    listingTitle: string;
    paymentStatus: string;
    paidAt: string | null;
    deliveredAt: string | null;
    receivedAt: string | null;
  };
}

type View = 'choice' | 'submitting' | 'dispute' | 'done' | 'error';

export function PrivateArrangeActionPage({
  token,
  payload,
}: {
  token: string;
  payload: PrivateArrangeActionPayload;
}) {
  const [view, setView] = useState<View>('choice');
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<
    'delivered' | 'received' | 'disputed' | null
  >(null);

  const tx = payload.transaction;
  const isSeller = payload.role === 'seller';
  const stillHeld = tx.paymentStatus === 'HELD';

  async function callAction(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<void> {
    setView('submitting');
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/actions/${token}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        const text = Array.isArray(payload.message)
          ? payload.message.join(', ')
          : (payload.message ?? `Error ${res.status}`);
        setMessage(text);
        setView('error');
        return;
      }
      setOutcome(
        endpoint.endsWith('dispute')
          ? 'disputed'
          : isSeller
            ? 'delivered'
            : 'received',
      );
      setView('done');
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : `Couldn't reach ${BRAND_NAME} - try again in a moment.`,
      );
      setView('error');
    }
  }

  if (!stillHeld) {
    const closed: Record<string, { title: string; body: string }> = {
      DISPUTED: {
        title: 'This handover is under review',
        body: 'Our team has been alerted to check whether the handover happened. No money will move while it is disputed.',
      },
      PENDING_ADMIN_VERIFICATION: {
        title: 'This handover is being checked',
        body: 'Our team is reviewing this order before any money moves. We will be in touch if we need anything.',
      },
      RELEASED: {
        title: 'This handover is complete',
        body: 'The buyer confirmed receipt and the seller has been paid. Nothing else is needed.',
      },
      REFUNDED: {
        title: 'This order was refunded',
        body: 'No handover needs to be confirmed. The buyer has been refunded.',
      },
    };
    const copy = closed[tx.paymentStatus] ?? {
      title: 'This handover is closed',
      body: 'This order is no longer waiting for a handover confirmation.',
    };
    return (
      <Card>
        <h1 style={heading}>{copy.title}</h1>
        <p style={bodyText}>{copy.body}</p>
        <p style={finePrint}>
          Reference {tx.orderReference ?? tx.id.slice(-8).toUpperCase()}
        </p>
      </Card>
    );
  }

  if (view === 'done') {
    return (
      <Card>
        <h1 style={heading}>
          {outcome === 'disputed' ? 'Handover reported' : 'Done'}
        </h1>
        <p style={bodyText}>
          {outcome === 'disputed'
            ? 'Our team has been alerted to check whether the handover happened. The payment stays held while they do. If you received the item but it is not as expected, message the seller from the order page or lodge a complaint — that is between you and the seller, not a platform refund.'
            : outcome === 'delivered'
              ? 'Marked as delivered. We have asked the buyer to confirm receipt.'
              : 'Receipt confirmed. The seller has been paid.'}
        </p>
        <p style={finePrint}>
          Reference {tx.orderReference ?? tx.id.slice(-8).toUpperCase()}
        </p>
      </Card>
    );
  }

  if (view === 'submitting') {
    return (
      <Card>
        <h1 style={heading}>Working…</h1>
        <p style={bodyText}>Hang tight, this will only take a moment.</p>
      </Card>
    );
  }

  if (view === 'error') {
    return (
      <Card>
        <h1 style={heading}>That didn&apos;t work</h1>
        <p style={bodyText}>{message}</p>
        <button
          type="button"
          onClick={() => setView('choice')}
          style={secondaryButton}
        >
          Back
        </button>
      </Card>
    );
  }

  if (view === 'dispute') {
    return (
      <Card>
        <h1 style={heading}>Report that the handover did not happen</h1>
        <p style={bodyText}>
          Use this only if the item was never handed over or the seller is
          unreachable. The payment stays held while our team reviews whether
          the handover happened.
        </p>
        <p style={bodyText}>
          If you received the item but it is not as expected, that is between
          you and the seller — message the seller from the order page or lodge
          a complaint; it is not a platform refund.
        </p>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="What happened? (optional)"
          rows={4}
          style={textarea}
        />
        <button
          type="button"
          onClick={() =>
            void callAction('private-arrange-dispute', {
              reason: reason.trim() || undefined,
            })
          }
          style={primaryButton}
        >
          Report it
        </button>
        <button
          type="button"
          onClick={() => setView('choice')}
          style={secondaryButton}
        >
          Back
        </button>
      </Card>
    );
  }

  if (isSeller && tx.deliveredAt) {
    return (
      <Card>
        <h1 style={heading}>Marked delivered</h1>
        <p style={bodyText}>
          We have asked the buyer to confirm receipt. Your payment is released
          when they confirm, or automatically 5 days after payment.
        </p>
        <p style={finePrint}>
          Reference {tx.orderReference ?? tx.id.slice(-8).toUpperCase()}
        </p>
      </Card>
    );
  }

  const primaryLabel = isSeller ? 'Item delivered' : 'Item received';
  const primaryEndpoint = isSeller
    ? 'private-arrange-delivered'
    : 'private-arrange-received';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <p style={eyebrow}>Private arrangement</p>
        <h1 style={heading}>{tx.listingTitle}</h1>
        <p style={bodyText}>
          Hi {payload.greeting}. {isSeller
            ? "Arrange the handover with the buyer, then confirm it here when you've handed the item over."
            : 'The seller has been asked to confirm the handover. Confirm here once you have your item.'}
        </p>
        <p style={finePrint}>
          Reference {tx.orderReference ?? tx.id.slice(-8).toUpperCase()}
        </p>
      </Card>

      <Card>
        <button
          type="button"
          onClick={() => void callAction(primaryEndpoint)}
          style={primaryButton}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={() => setView('dispute')}
          style={secondaryButton}
        >
          Report that the handover did not happen
        </button>
        <p style={finePrint}>
          {isSeller
            ? 'Your payment is released when the buyer confirms receipt, or automatically 5 days after payment.'
            : 'Confirming releases the seller’s payment immediately.'}
        </p>
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  margin: '0 0 6px',
};

const heading: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: 22,
  fontWeight: 600,
  margin: '0 0 10px',
  lineHeight: 1.25,
};

const bodyText: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 14,
  lineHeight: 1.6,
  margin: '0 0 10px',
};

const finePrint: React.CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 12,
  lineHeight: 1.5,
  margin: '12px 0 0',
};

const primaryButton: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  background: 'var(--action-primary-bg)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  width: '100%',
  marginTop: 10,
  padding: '12px 16px',
  background: 'transparent',
  color: 'var(--danger-edge)',
  border: '1.5px solid var(--danger-edge)',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const textarea: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 12,
  margin: '4px 0 12px',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  border: '0.5px solid var(--border)',
  borderRadius: 8,
  fontSize: 14,
  resize: 'vertical',
};
