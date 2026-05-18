'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const TIERS = ['NEW', 'ESTABLISHED', 'TRUSTED', 'TOP_SELLER', 'DEALER'];
const KYC_STATUSES = ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'];

function getToken() {
  return document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? '';
}

export default function UserActions({
  userId,
  isBanned,
  sellerTier,
  kycStatus,
}: {
  userId: string;
  isBanned: boolean;
  sellerTier: string;
  kycStatus: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function patch(data: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`${API_URL}/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(data),
      });
      router.refresh();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  if (open) {
    return (
      <div className="flex flex-col gap-2 min-w-[180px] p-2 rounded-[6px]" style={{ border: '0.5px solid var(--border)', background: 'var(--bg-card)' }}>
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Tier</p>
          <select
            defaultValue={sellerTier}
            onChange={(e) => patch({ sellerTier: e.target.value })}
            className="w-full px-2 py-1 rounded text-xs outline-none"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>KYC</p>
          <select
            defaultValue={kycStatus}
            onChange={(e) => patch({ kycStatus: e.target.value })}
            className="w-full px-2 py-1 rounded text-xs outline-none"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {KYC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => patch({ isBanned: !isBanned })}
            disabled={busy}
            className="flex-1 px-2 py-1 rounded text-xs font-medium"
            style={{ background: isBanned ? '#22c55e18' : 'var(--red)18', color: isBanned ? '#22c55e' : 'var(--red)', border: `0.5px solid ${isBanned ? '#22c55e40' : 'var(--red)40'}` }}
          >
            {isBanned ? 'Unban' : 'Ban'}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setOpen(true)}
      className="px-2.5 py-1 rounded text-xs"
      style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
    >
      Actions
    </button>
  );
}
