'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

// Proof-of-delivery photo (Phase 5 P5.3). Shows an uploaded delivery photo
// if present, and lets the buyer or seller attach one. This is dispute
// EVIDENCE only — it never releases or affects payout (that stays on the
// buyer's "Confirm delivery").
export default function PodProofSection({
  transactionId,
  podProofUrl,
}: {
  transactionId: string;
  podProofUrl: string | null;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch(`${API_URL}/transactions/${transactionId}/pod-proof`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 pt-4" style={{ borderTop: '0.5px solid var(--border-divider)' }}>
      <p className="text-xs uppercase mb-2" style={{ color: 'var(--text-tertiary)' }}>
        Proof of delivery
      </p>
      {podProofUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={podProofUrl}
          alt="Proof of delivery"
          className="rounded-[6px] max-h-56 w-auto object-contain"
          style={{ border: '0.5px solid var(--border)' }}
        />
      ) : (
        <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
          Optional — attach a photo of the delivered parcel as a record. Kept
          as evidence; it doesn&apos;t affect payment.
        </p>
      )}
      <label
        className="inline-block mt-2 text-sm px-3 py-1.5 rounded-md cursor-pointer"
        style={{
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Uploading…' : podProofUrl ? 'Replace photo' : 'Add delivery photo'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={onPick}
        />
      </label>
      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
