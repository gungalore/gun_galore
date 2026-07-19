'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

const TIERS = ['NEW', 'ESTABLISHED', 'TRUSTED', 'TOP_SELLER', 'DEALER'];
// Must match the KycStatus enum (backend @IsEnum rejects anything else).
// 'SUBMITTED' was never a real status; 'UNDER_REVIEW' is the Claude-flow
// human-review state; 'NONE' resets a user to unverified.
const KYC_STATUSES = ['NONE', 'PENDING', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW'];
const SUBSCRIPTION_TIERS = ['FREE', 'PRO']; // MEMBER retired 2026-07-19

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
  firstName,
  lastName,
  phone,
  isBanned,
  sellerTier,
  kycStatus,
  subscriptionTier,
}: {
  userId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isBanned: boolean;
  sellerTier: string;
  kycStatus: string;
  subscriptionTier: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'ban' }
    | { kind: 'unban' }
    | { kind: 'tier'; value: string }
    | { kind: 'kyc'; value: string }
    | { kind: 'subscription'; value: string }
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
          <button
            onClick={() => setEditProfile(true)}
            className="w-full px-2 py-1.5 rounded text-xs text-left"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            Edit profile…
          </button>
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
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
              GG+ / Pro
            </p>
            <select
              defaultValue={subscriptionTier}
              onChange={(e) =>
                e.target.value !== subscriptionTier &&
                askConfirm({ kind: 'subscription', value: e.target.value })
              }
              className="w-full px-2 py-1 rounded text-xs outline-none"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              {SUBSCRIPTION_TIERS.map((s) => (
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
      {editProfile && (
        <EditProfileModal
          userId={userId}
          initial={{ username, firstName, lastName, phone }}
          onClose={() => setEditProfile(false)}
          onDone={() => {
            setEditProfile(false);
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// Support profile edit — for "help a member fix their profile" requests.
// Sends ONLY the fields that changed; the backend audits each one and the
// reason is mandatory (same rule as every other admin user change). Email
// is deliberately absent: it's the Clerk login identity, members change it
// themselves in account settings.
function EditProfileModal({
  userId,
  initial,
  onClose,
  onDone,
}: {
  userId: string;
  initial: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  };
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    username: initial.username ?? '',
    firstName: initial.firstName ?? '',
    lastName: initial.lastName ?? '',
    phone: initial.phone ?? '',
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    form.username !== (initial.username ?? '') ||
    form.firstName !== (initial.firstName ?? '') ||
    form.lastName !== (initial.lastName ?? '') ||
    form.phone !== (initial.phone ?? '');
  const canSubmit = dirty && reason.trim().length >= 3 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { reason: reason.trim() };
      if (form.username !== (initial.username ?? '') && form.username.trim())
        body.username = form.username.trim();
      if (form.firstName !== (initial.firstName ?? ''))
        body.firstName = form.firstName;
      if (form.lastName !== (initial.lastName ?? ''))
        body.lastName = form.lastName;
      if (form.phone !== (initial.phone ?? '')) body.phone = form.phone;
      const res = await adminFetch(`/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 13,
    outline: 'none',
  };

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
        className="w-full max-w-sm rounded-[8px] p-4 space-y-3"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <p className="text-sm font-medium m-0" style={{ color: 'var(--text-primary)' }}>
          Edit profile — @{initial.username ?? userId}
        </p>
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Username (public — shown on listings & ratings)</p>
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} style={fieldStyle} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>First name</p>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} style={fieldStyle} />
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Last name</p>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} style={fieldStyle} />
          </div>
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Phone (SMS notifications go here)</p>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={fieldStyle} />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Reason (required — recorded in the audit log)</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. member asked support to fix a typo" style={fieldStyle} />
        </div>
        {error && (
          <p className="text-xs m-0" style={{ color: 'var(--red)' }}>{error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={!canSubmit} className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: canSubmit ? 'pointer' : 'default', opacity: canSubmit ? 1 : 0.5 }}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  confirm,
  userId,
  username,
  onClose,
  onDone,
}: {
  confirm:
    | { kind: 'ban' | 'unban' }
    | { kind: 'tier'; value: string }
    | { kind: 'kyc'; value: string }
    | { kind: 'subscription'; value: string };
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
      case 'subscription':
        return `Set GG+ subscription to ${confirm.value}?`;
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
      case 'subscription':
        return 'Manually sets the GG+ subscription tier without going through paid checkout — a comp / support grant. PRO unlocks Ask GG Pro features, Load Lab, and the ballistics calculator. Reversible; recorded in the audit log.';
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
      if (confirm.kind === 'subscription') body.subscriptionTier = confirm.value;

      const res = await adminFetch(`/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
