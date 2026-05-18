'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

  if (!isLoaded || !user || user.id !== sellerClerkId) return null;
  if (!['ACTIVE', 'DRAFT', 'PENDING_REVIEW'].includes(status)) return null;

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
      className="mt-4 pt-4 flex gap-2"
      style={{ borderTop: '0.5px solid var(--border-divider)' }}
    >
      <Link
        href={`/listings/${listingId}/edit`}
        className="flex-1 py-2 rounded-[6px] text-sm text-center font-medium"
        style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)', textDecoration: 'none' }}
      >
        Edit listing
      </Link>
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
          className="px-3 py-2 rounded-[6px] text-sm"
          style={{ color: 'var(--red)', border: '0.5px solid var(--red)40' }}
        >
          Cancel listing
        </button>
      )}
    </div>
  );
}
