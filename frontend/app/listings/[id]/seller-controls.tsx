'use client';

import { useUser } from '../../../lib/auth';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface EditLockState {
  canEdit: boolean;
  reason: string | null;
  code: string | null;
}

export default function SellerControls({
  listingId,
  sellerId,
  status,
  inline = false,
}: {
  listingId: string;
  sellerId: string;
  status: string;
  /**
   * 2026-11-24 sales-layout audit: on your OWN listing these controls now sit
   * in the buy-box slot (Edit is the primary action when you cannot buy your
   * own item), so the divider and top margin that made sense at the foot of
   * the page are wrong there. `inline` drops both, nothing else changes.
   */
  inline?: boolean;
}) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // A failed DELETE is now a real possibility (auctions with bids are refused
  // server-side), so the server's message gets a line of its own instead of a
  // silent navigate-away that leaves the seller thinking it worked.
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Edit-lock state — fetched from GET /listings/:id/edit-lock so we
  // don't have to trial-and-error on the PATCH. Same backend gate
  // covers AUCTION (bids placed) AND TAKE_A_SHOT (active offer).
  const [lock, setLock] = useState<EditLockState | null>(null);

  const isOwner = isLoaded && user && user.id === sellerId;
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
        const token = await getToken();
        const r = await fetch(`${API_URL}/listings/${listingId}/edit-lock`, {
          cache: 'no-store',
          // Owner-only now: the probe requires the listing owner (it used to
          // be an unauthenticated existence oracle for hidden listings).
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
  // Audit H4/M12 — once bids exist the auction cannot be cancelled (the edit
  // lock reason is exactly that), so do not offer a confirm for it at all.
  const blockedByBids = lock?.code === 'listing-locked-by-bids';

  async function handleCancel() {
    setBusy(true);
    setCancelError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/listings/${listingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // The server refuses a live auction with bids (and any other guarded
        // case) with a 409/400. Surface its message rather than pretending
        // the cancel happened.
        const body = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        const message = Array.isArray(body.message)
          ? body.message.join(', ')
          : (body.message ?? `Could not cancel (error ${res.status}).`);
        throw new Error(message);
      }
      router.push('/my/listings');
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : 'Could not cancel this listing.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={inline ? 'flex flex-col gap-2 mb-3' : 'mt-4 pt-4 flex flex-col gap-2'}
      style={{ borderTop: inline ? undefined : '0.5px solid var(--border-divider)' }}
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
            ? 'Bids are locked in, and an auction cannot be cancelled once bids are placed — let it run, or contact support if something is wrong.'
            : lock.code === 'listing-locked-by-offer'
              ? 'Reject the active offer (or wait for it to expire), then edit.'
              : ''}
        </p>
      )}
      {cancelError && (
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--text-secondary)',
            background: 'var(--red-wash)',
            border: '0.5px solid var(--red)',
            borderRadius: 6,
            padding: '8px 10px',
            lineHeight: 1.4,
          }}
        >
          {cancelError}
        </p>
      )}
      <div className="flex gap-2">
        {!locked && (
          <Link
            href={`/listings/${listingId}/edit`}
            className="flex-1 py-2 rounded-[6px] text-sm text-center font-medium"
            style={
              inline
                ? {
                    background: 'var(--action-primary-bg)',
                    color: '#fff',
                    textDecoration: 'none',
                  }
                : {
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                    textDecoration: 'none',
                  }
            }
          >
            Edit listing
          </Link>
        )}
        {/* No cancel offered while the edit lock says bids exist — the server
            refuses that DELETE, and this surface must not promise otherwise. */}
        {!blockedByBids &&
          (confirm ? (
            <div className="flex gap-1.5">
              <button
                onClick={handleCancel}
                disabled={busy}
                className="px-3 py-2 rounded-[6px] text-sm font-medium"
                style={{ background: 'var(--danger-fill)', color: 'var(--danger-ink)', opacity: busy ? 0.6 : 1 }}
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
              style={{ color: 'var(--danger-edge)', border: '1.5px solid var(--danger-edge)' }}
            >
              Cancel listing
            </button>
          ))}
      </div>
    </div>
  );
}
