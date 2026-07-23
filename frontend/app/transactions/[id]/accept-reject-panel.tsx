'use client';

/**
 * Seller-facing Accept / Reject panel on /transactions/[id].
 *
 * Mirrors the /a/<token>/transaction-accept flow but for a signed-in
 * seller who is already on the order page. Same backend endpoints
 * underneath — POST /transactions/:id/accept and POST /transactions/:id/reject.
 *
 * Renders when seller has paid + not accepted + not rejected + not
 * dispatched. Tight on space so the existing dispatch / dealer-verification
 * stack on the same right rail still fits below.
 *
 * Reject opens a small reason picker inside the same card; once a
 * reason is chosen, the second confirm tap fires the POST and refreshes
 * the page (router.refresh) so the buyer-side "Awaiting accept" chip
 * flips to "Cancelled — refund issued" + the existing payment-status
 * chip flips to REFUNDED.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

type View =
  | { kind: 'idle' }
  | { kind: 'accepting' }
  | { kind: 'rejecting'; reason: RejectReasonKey | null; freeText: string }
  | { kind: 'submitting-accept' }
  | { kind: 'submitting-reject' }
  | { kind: 'error'; message: string };

export function AcceptRejectPanel({
  transactionId,
  acceptDeadlineAt,
  isDealerTransfer,
  isCollection = false,
}: {
  transactionId: string;
  acceptDeadlineAt: string | null;
  isDealerTransfer: boolean;
  isCollection?: boolean;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [view, setView] = useState<View>({ kind: 'idle' });

  async function authedFetch(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const token = await getToken();
    return fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function doAccept() {
    setView({ kind: 'submitting-accept' });
    try {
      const res = await authedFetch(`/transactions/${transactionId}/accept`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setView({
          kind: 'error',
          message: j.message ?? `Couldn’t accept (HTTP ${res.status})`,
        });
        return;
      }
      router.refresh();
    } catch (err) {
      setView({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Network error — try again in a moment.',
      });
    }
  }

  async function doReject(reasonText: string) {
    setView({ kind: 'submitting-reject' });
    try {
      const res = await authedFetch(`/transactions/${transactionId}/reject`, {
        reason: reasonText,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setView({
          kind: 'error',
          message: j.message ?? `Couldn’t reject (HTTP ${res.status})`,
        });
        return;
      }
      router.refresh();
    } catch (err) {
      setView({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Network error — try again in a moment.',
      });
    }
  }

  // Countdown text — shown in the header pill.
  const deadlineMs = acceptDeadlineAt
    ? new Date(acceptDeadlineAt).getTime()
    : null;
  const msLeft = deadlineMs ? deadlineMs - Date.now() : null;
  const hoursLeft = msLeft != null ? Math.floor(msLeft / 3_600_000) : null;
  const expired = msLeft != null && msLeft <= 0;
  const headerText = expired
    ? 'ACCEPT WINDOW EXPIRED'
    : hoursLeft != null
      ? `ACCEPT WITHIN ${hoursLeft}H`
      : 'ACTION NEEDED';

  if (view.kind === 'rejecting') {
    const canSubmit =
      view.reason !== null &&
      (view.reason !== 'OTHER' || view.freeText.trim().length >= 3);
    // "CODE: label" — the code prefix drives the seller-standing policy on
    // the backend (parsed before the first colon); the label keeps the
    // stored reason readable in the admin dossier + buyer notification.
    const submittable =
      view.reason === 'OTHER'
        ? `OTHER: ${view.freeText.trim()}`
        : `${view.reason}: ${REJECT_REASONS.find((r) => r.value === view.reason)?.label ?? ''}`;
    return (
      <div
        className="rounded-[8px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--red)',
        }}
      >
        <p
          className="text-sm font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Why are you rejecting?
        </p>
        <p
          className="text-xs mb-3"
          style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
        >
          The buyer will be refunded in full and notified of the reason. Pick
          honestly — admins see this for trust-safety review.
        </p>
        <div className="flex flex-col gap-2 mb-3">
          {REJECT_REASONS.map((r) => (
            <label
              key={r.value}
              className="flex items-start gap-2 cursor-pointer p-2 rounded-[6px]"
              style={{
                background:
                  view.reason === r.value ? 'var(--bg-inset)' : 'transparent',
                border: `0.5px solid ${
                  view.reason === r.value
                    ? 'var(--text-secondary)'
                    : 'var(--border)'
                }`,
              }}
            >
              <input
                type="radio"
                name="reject-reason"
                checked={view.reason === r.value}
                onChange={() =>
                  setView({
                    kind: 'rejecting',
                    reason: r.value,
                    freeText: view.freeText,
                  })
                }
                style={{ marginTop: 3 }}
              />
              <span
                className="text-sm"
                style={{ color: 'var(--text-primary)' }}
              >
                {r.label}
              </span>
            </label>
          ))}
        </div>
        {view.reason === 'OTHER' && (
          <textarea
            value={view.freeText}
            onChange={(e) =>
              setView({
                kind: 'rejecting',
                reason: 'OTHER',
                freeText: e.target.value,
              })
            }
            placeholder="Tell the buyer what happened (min 3 chars)"
            rows={3}
            maxLength={500}
            className="w-full mb-3 p-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              resize: 'vertical',
            }}
          />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setView({ kind: 'idle' })}
            className="flex-1 py-2.5 px-3 rounded-[6px] text-sm"
            style={{
              background: 'transparent',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void doReject(submittable)}
            className="flex-1 py-2.5 px-3 rounded-[6px] text-sm"
            style={{
              background: canSubmit ? 'var(--red)' : 'var(--bg-inset)',
              color: canSubmit ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontWeight: 500,
            }}
          >
            Reject + refund buyer
          </button>
        </div>
      </div>
    );
  }

  const isSubmittingAccept = view.kind === 'submitting-accept';
  const isSubmittingReject = view.kind === 'submitting-reject';
  const isBusy = isSubmittingAccept || isSubmittingReject;

  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: expired ? 'rgba(200,16,46,0.08)' : 'var(--bg-card)',
        border: `0.5px solid ${expired ? 'var(--red)' : 'var(--red)'}`,
      }}
    >
      <p
        className="text-xs uppercase mb-2"
        style={{
          color: 'var(--red)',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {headerText}
      </p>
      <p
        className="text-sm mb-3"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Confirm you can fulfil this sale
      </p>
      <p
        className="text-xs mb-4"
        style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
      >
        The buyer has paid and the funds are being held by Gun Galore. Tap{' '}
        <strong style={{ color: 'var(--text-primary)' }}>Accept</strong> to
        commit —{' '}
        {isCollection ? (
          <>
            then arrange a pickup time with the buyer. There’s no courier and
            no dispatch step; your payment is released once the buyer confirms
            they’ve collected the item in person.
          </>
        ) : (
          <>
            you’ll then have{' '}
            <strong style={{ color: 'var(--text-primary)' }}>5 days</strong> to
            dispatch.{' '}
            {isDealerTransfer
              ? 'You can drop the firearm with your dealer in parallel — the SAPS 534 photos upload after dispatch.'
              : ''}
          </>
        )}
      </p>

      {view.kind === 'error' && (
        <p
          className="text-xs mb-3 p-2 rounded-[6px]"
          style={{
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
            lineHeight: 1.45,
          }}
        >
          {view.message}
        </p>
      )}

      <button
        type="button"
        disabled={isBusy}
        onClick={() => void doAccept()}
        className="w-full py-3 px-4 rounded-[8px] text-sm mb-2"
        style={{
          background: isBusy ? 'var(--bg-inset)' : 'var(--red)',
          color: isBusy ? 'var(--text-tertiary)' : '#fff',
          border: 'none',
          fontWeight: 500,
          cursor: isBusy ? 'not-allowed' : 'pointer',
        }}
      >
        {isSubmittingAccept ? 'Accepting…' : 'Accept this sale'}
      </button>
      <button
        type="button"
        disabled={isBusy}
        onClick={() =>
          setView({ kind: 'rejecting', reason: null, freeText: '' })
        }
        className="w-full py-2.5 px-4 rounded-[6px] text-xs"
        style={{
          background: 'transparent',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          cursor: isBusy ? 'not-allowed' : 'pointer',
        }}
      >
        I can’t fulfil — reject + refund buyer
      </button>
    </div>
  );
}
