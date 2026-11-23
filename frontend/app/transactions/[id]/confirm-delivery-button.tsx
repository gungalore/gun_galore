'use client';

import { useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { useRouter } from 'next/navigation';
import { BRAND_NAME } from '../../../lib/brand';
import { RaiseDisputeModal } from './raise-dispute-button';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Confirm-delivery is irreversible — it releases payment to the
// seller (paymentStatus HELD → RELEASED in transactions.service.ts)
// and you can't dispute afterwards. The original 2-step inline flow
// was easy to mis-click through. This modal forces an explicit
// 3-point inspection checklist + final confirmation so a buyer
// can't accidentally release funds before they've actually checked
// the parcel.
//
// Confirming is only ever about an item the buyer actually has in
// hand. Condition, description, damage after delivery and change of
// mind are between the buyer and the seller — message the seller from
// the order or lodge a complaint; they are not a platform refund. A
// dispute is for non-delivery only.
//
// The modal therefore exposes an "item never arrived" secondary
// action. A buyer who opened the modal before the parcel arrived (or
// before a collection handover happened) has a real in-modal
// alternative instead of being pressured into ticking the boxes.

export function ConfirmDeliveryButton({
  transactionId,
  // Collection listings reuse this exact flow + endpoint but relabel the
  // copy for in-person pickup ("Confirm collection" rather than
  // "Confirm delivery"). Everything else — the irreversible-release
  // inspection checklist + dispute escape hatch — is identical.
  variant = 'delivery',
}: {
  transactionId: string;
  variant?: 'delivery' | 'collection';
}) {
  const isCollection = variant === 'collection';
  const { getToken } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Three inspection points the buyer must explicitly acknowledge.
  // All must be ticked before the Confirm button activates.
  const [chk1, setChk1] = useState(false);
  const [chk2, setChk2] = useState(false);
  const [chk3, setChk3] = useState(false);
  const allChecked = chk1 && chk2 && chk3;

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${transactionId}/confirm-delivery`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{
          background: 'var(--success)',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        {isCollection ? 'I have collected the item' : 'I have received the item'}
      </button>

      {open && (
        <div
          onClick={() => !busy && setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 480,
              width: '100%',
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p
              className="text-base mb-1"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {isCollection ? 'Confirm collection' : 'Confirm delivery'}
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              Confirming releases the payment to the seller and is final.
              Once you confirm, {BRAND_NAME} will not refund the item for a
              condition, description or change-of-mind concern — those are
              between you and the seller, so message the seller from this
              order or lodge a complaint. Take 30 seconds to inspect the item
              before you tick the boxes below. If the item has not{' '}
              {isCollection ? 'been handed over' : 'arrived'}, don&apos;t
              confirm — report non-delivery instead.
            </p>

            <div
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <label
                className="flex items-start gap-2 text-xs mb-2"
                style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
              >
                <input
                  type="checkbox"
                  checked={chk1}
                  onChange={(e) => setChk1(e.target.checked)}
                  style={{ marginTop: 3, accentColor: 'var(--red)' }}
                />
                <span>
                  I have <strong style={{ color: 'var(--text-primary)' }}>physically inspected</strong> the item and it matches the listing.
                </span>
              </label>
              <label
                className="flex items-start gap-2 text-xs mb-2"
                style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
              >
                <input
                  type="checkbox"
                  checked={chk2}
                  onChange={(e) => setChk2(e.target.checked)}
                  style={{ marginTop: 3, accentColor: 'var(--red)' }}
                />
                <span>
                  Any <strong style={{ color: 'var(--text-primary)' }}>condition or description concern</strong> is between me and the seller.
                </span>
              </label>
              <label
                className="flex items-start gap-2 text-xs"
                style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
              >
                <input
                  type="checkbox"
                  checked={chk3}
                  onChange={(e) => setChk3(e.target.checked)}
                  style={{ marginTop: 3, accentColor: 'var(--red)' }}
                />
                <span>
                  I understand confirming{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>releases payment to the seller</strong>{' '}
                  and is final.
                </span>
              </label>
            </div>

            {error && (
              <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
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
                onClick={handleConfirm}
                disabled={!allChecked || busy}
                className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
                style={{
                  background: allChecked && !busy ? 'var(--success)' : 'var(--bg-inset)',
                  color: allChecked && !busy ? '#fff' : 'var(--text-tertiary)',
                  border: 'none',
                  cursor: allChecked && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                {busy ? 'Releasing…' : 'Release payment'}
              </button>
            </div>

            {/* Escape hatch — the item has not arrived (or a collection
                handover never happened), so payment must stay held. Hand
                the buyer straight to the non-delivery dispute flow instead
                of pressuring them into ticking the boxes anyway. */}
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: '0.5px solid var(--border)',
                textAlign: 'center',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setDisputeOpen(true);
                }}
                disabled={busy}
                className="text-xs"
                style={{
                  background: 'transparent',
                  color: 'var(--red)',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  lineHeight: 1.5,
                }}
              >
                The item has not {isCollection ? 'been handed over' : 'arrived'} — report non-delivery instead
              </button>
            </div>
          </div>
        </div>
      )}

      {disputeOpen && (
        <RaiseDisputeModal
          transactionId={transactionId}
          onClose={() => setDisputeOpen(false)}
          onDone={() => setDisputeOpen(false)}
        />
      )}
    </>
  );
}
