'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const TIERS = ['NEW', 'ESTABLISHED', 'TRUSTED', 'TOP_SELLER', 'DEALER'];
const KYC_STATUSES = ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'];

function getToken() {
  return document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? '';
}

// Destructive admin actions on a user now require:
//   1. A typed reason (audit log — backend enforces ≥3 chars).
//   2. A confirmation modal for the irreversible actions (ban, tier
//      change). Soft actions (open the actions panel) stay one-click.
//
// Every change is recorded as an AdminAuditEvent row by the backend
// AdminService.updateUser — visible at /admin/audit.

export default function UserActions({
  userId,
  username,
  isBanned,
  sellerTier,
  kycStatus,
}: {
  userId: string;
  username: string | null;
  isBanned: boolean;
  sellerTier: string;
  kycStatus: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'ban' }
    | { kind: 'unban' }
    | { kind: 'tier'; value: string }
    | { kind: 'kyc'; value: string }
  >(null);

  function askConfirm(c: NonNullable<typeof confirm>) {
    setConfirm(c);
  }

  return (
    <>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="px-2.5 py-1 rounded text-xs"
          style={{
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
          }}
        >
          Actions
        </button>
      ) : (
        <div
          className="flex flex-col gap-2 min-w-[200px] p-2 rounded-[6px]"
          style={{
            border: '0.5px solid var(--border)',
            background: 'var(--bg-card)',
          }}
        >
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Tier
            </p>
            <select
              defaultValue={sellerTier}
              onChange={(e) =>
                e.target.value !== sellerTier &&
                askConfirm({ kind: 'tier', value: e.target.value })
              }
              className="w-full px-2 py-1 rounded text-xs outline-none"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
              KYC
            </p>
            <select
              defaultValue={kycStatus}
              onChange={(e) =>
                e.target.value !== kycStatus &&
                askConfirm({ kind: 'kyc', value: e.target.value })
              }
              className="w-full px-2 py-1 rounded text-xs outline-none"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              {KYC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() =>
                askConfirm({ kind: isBanned ? 'unban' : 'ban' })
              }
              className="flex-1 px-2 py-1 rounded text-xs font-medium"
              style={{
                background: isBanned
                  ? 'rgba(34,197,94,0.10)'
                  : 'rgba(200,16,46,0.10)',
                color: isBanned ? '#22c55e' : 'var(--red)',
                border: `0.5px solid ${
                  isBanned ? 'rgba(34,197,94,0.40)' : 'rgba(200,16,46,0.45)'
                }`,
              }}
            >
              {isBanned ? 'Unban' : 'Ban'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="px-2 py-1 rounded text-xs"
              style={{
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          confirm={confirm}
          userId={userId}
          username={username}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ConfirmModal({
  confirm,
  userId,
  username,
  onClose,
  onDone,
}: {
  confirm: { kind: 'ban' | 'unban' } | { kind: 'tier'; value: string } | { kind: 'kyc'; value: string };
  userId: string;
  username: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [typedUsername, setTypedUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For ban: require typing the username exactly to confirm. Soft
  // actions (KYC / tier change) don't require typed-confirm — the
  // reason field alone is enough friction.
  const isBan = confirm.kind === 'ban';
  const typedOk = !isBan || typedUsername.trim() === (username ?? '');
  const reasonOk = reason.trim().length >= 3;
  const canSubmit = typedOk && reasonOk && !busy;

  const title = (() => {
    switch (confirm.kind) {
      case 'ban':
        return `Ban @${username ?? 'this user'}?`;
      case 'unban':
        return `Unban @${username ?? 'this user'}?`;
      case 'tier':
        return `Change tier to ${confirm.value}?`;
      case 'kyc':
        return `Override KYC status to ${confirm.value}?`;
    }
  })();

  const subtitle = (() => {
    switch (confirm.kind) {
      case 'ban':
        return 'User will lose access immediately — they cannot bid, buy, sell, or contact other users. Reversible by an admin, but no automatic appeal.';
      case 'unban':
        return 'User regains full platform access. Their listings will become visible again if they were active.';
      case 'tier':
        return 'Tier changes affect commission discount and the badge shown on listings. DEALER is sticky and bypasses the auto-tier algorithm.';
      case 'kyc':
        return 'KYC overrides bypass VerifyNow + Home Affairs. Use only when you have independent verification of identity (manual document review).';
    }
  })();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { reason: reason.trim() };
      if (confirm.kind === 'ban') body.isBanned = true;
      if (confirm.kind === 'unban') body.isBanned = false;
      if (confirm.kind === 'tier') body.sellerTier = confirm.value;
      if (confirm.kind === 'kyc') body.kycStatus = confirm.value;

      const res = await fetch(`${API_URL}/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
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
          border: `0.5px solid ${isBan ? 'var(--red)' : 'var(--border)'}`,
        }}
      >
        <p
          className="text-base mb-2"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          {title}
        </p>
        <p
          className="text-sm mb-4"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
        >
          {subtitle}
        </p>

        {isBan && (
          <div className="mb-3">
            <label
              className="text-xs mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Type the username to confirm: <strong>{username}</strong>
            </label>
            <input
              type="text"
              value={typedUsername}
              onChange={(e) => setTypedUsername(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{
                background: 'var(--bg-inset)',
                border: `0.5px solid ${
                  typedUsername && !typedOk ? 'var(--red)' : 'var(--border)'
                }`,
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
              }}
              autoFocus
            />
          </div>
        )}

        <div className="mb-4">
          <label
            className="text-xs mb-1 block"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Reason (recorded in audit log)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Briefly explain why — what triggered this action?"
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              resize: 'vertical',
            }}
            autoFocus={!isBan}
          />
        </div>

        {error && (
          <p
            className="text-xs mb-3"
            style={{ color: 'var(--red)' }}
          >
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2 rounded text-sm"
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
            onClick={submit}
            disabled={!canSubmit}
            className="flex-1 py-2 rounded text-sm font-medium"
            style={{
              background: canSubmit ? 'var(--red)' : 'var(--bg-inset)',
              color: canSubmit ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
