'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface EditLockState {
  canEdit: boolean;
  reason: string | null;
  code: string | null;
}

export default function SellerControls({
  listingId,
  sellerClerkId,
  status,
}: {
  listingId: string;
  sellerClerkId: string;
  status: string;
}) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // Edit-lock state — fetched from GET /listings/:id/edit-lock so we
  // don't have to trial-and-error on the PATCH. Same backend gate
  // covers AUCTION (bids placed) AND TAKE_A_SHOT (active offer).
  const [lock, setLock] = useState<EditLockState | null>(null);

  const isOwner = isLoaded && user && user.id === sellerClerkId;
  const statusAllowsEdit = ['ACTIVE', 'DRAFT', 'PENDING_REVIEW'].includes(
    status,
  );

  useEffect(() => {
    // Only the actual seller needs the lock state — skip the request
    // for everyone else. Status gate also short-circuits since locked
    // statuses (SOLD/CANCELLED) already hide the controls entirely.
    if (!isOwner || !statusAllowsEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/listings/${listingId}/edit-lock`, {
          cache: 'no-store',
        });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as EditLockState;
        if (!cancelled) setLock(data);
      } catch {
        // Network blip — leave lock null, treat as unlocked
        // (backend will reject any actual edit anyway).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, statusAllowsEdit, listingId]);

  if (!isOwner) return null;
  if (!statusAllowsEdit) return null;

  const locked = lock ? !lock.canEdit : false;

  async function handleCancel() {
    setBusy(true);
    try {
      const token = await getToken();
      await fetch(`${API_URL}/listings/${listingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push('/my/listings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-4 pt-4 flex flex-col gap-2"
      style={{ borderTop: '0.5px solid var(--border-divider)' }}
    >
      {locked && lock && (
        <p
          style={{
            margin: 0,
            padding: '8px 10px',
            fontSize: 12,
            color: 'var(--text-secondary)',
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            lineHeight: 1.4,
          }}
        >
          🔒 Editing locked — {lock.reason}{' '}
          {lock.code === 'listing-locked-by-bids'
            ? 'Cancel and relist if the listing is wrong (cancelling will refund all bidders).'
            : lock.code === 'listing-locked-by-offer'
              ? 'Reject the active offer (or wait for it to expire), then edit.'
              : ''}
        </p>
      )}
      <div className="flex gap-2">
        {!locked && (
          <Link
            href={`/listings/${listingId}/edit`}
            className="flex-1 py-2 rounded-[6px] text-sm text-center font-medium"
            style={{
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
            }}
          >
            Edit listing
          </Link>
        )}
        {confirm ? (
          <div className="flex gap-1.5">
            <button
              onClick={handleCancel}
              disabled={busy}
              className="px-3 py-2 rounded-[6px] text-sm font-medium"
              style={{ background: 'var(--red)', color: '#fff', opacity: busy ? 0.6 : 1 }}
            >
              Confirm cancel
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="px-3 py-2 rounded-[6px] text-sm"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className={
              locked
                ? 'flex-1 py-2 rounded-[6px] text-sm font-medium'
                : 'px-3 py-2 rounded-[6px] text-sm'
            }
            style={{ color: 'var(--red)', border: '0.5px solid var(--red-line)' }}
          >
            Cancel listing
          </button>
        )}
      </div>
    </div>
  );
}
