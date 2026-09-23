'use client';

import { useMemo, useState } from 'react';
import { ConfirmDialog, ReasonDialog } from '@/components/admin/admin-confirm';
import { useAdminToast } from '@/components/admin/admin-ui';
import { adminFetch, type AdminUserProfile } from '@/lib/admin-api';

type UserActionKind =
  | 'ban'
  | 'unban'
  | 'close'
  | 'erase'
  | 'kyc-approve'
  | 'kyc-reject';

/**
 * The enforcement controls for one member.
 *
 * ⚠️ ONE COMPONENT, TWO SURFACES, ON PURPOSE. These buttons and the exact
 * wording of every confirmation existed twice the moment a full profile page
 * was added — and a ban that says one thing in the drawer and another on the
 * page is the drift this repo has been bitten by before (the footer's link
 * lists, the account-menu's route table). The wording lives here once.
 *
 * Every action is destructive or state-changing, so each goes through a dialog
 * that states what will happen and demands a reason; the backend refuses a
 * write without one.
 */
export function UserActions({
  user,
  isGod,
  onChanged,
}: {
  user: AdminUserProfile;
  isGod: boolean;
  onChanged?: () => void;
}) {
  const { toast } = useAdminToast();
  const [action, setAction] = useState<UserActionKind | null>(null);
  const [clearStrikesOpen, setClearStrikesOpen] = useState(false);

  const handle = user.username
    ? `@${user.username}`
    : user.id.slice(0, 8);

  const copy = useMemo(() => {
    if (!action) return null;
    switch (action) {
      case 'ban':
        return {
          title: `Ban ${handle}?`,
          body: 'Bans block the account immediately. Listings and money already in flight are unaffected — settle those separately.',
          label: 'Ban member',
          danger: true,
          minLength: 5,
        };
      case 'unban':
        return {
          title: `Lift the ban on ${handle}?`,
          body: 'Access is restored on the next request. Enforcement history is kept.',
          label: 'Unban',
          minLength: 3,
        };
      case 'close':
        return {
          title: `Close ${handle}’s account?`,
          body: 'A closure is the member’s own choice, not misconduct. The record survives so a lawful request can still be answered.',
          label: 'Close account',
          danger: true,
          minLength: 5,
        };
      case 'erase':
        return {
          title: `Erase ${handle}’s personal data?`,
          body: 'This is the right-to-erasure path. Identity documents, motivations and vault files are purged and cannot be recovered. Financial records are kept as required.',
          label: 'Erase data',
          danger: true,
          minLength: 15,
        };
      case 'kyc-approve':
        return {
          title: `Approve ${handle}’s verification?`,
          body: 'Approving marks the seller verified and unblocks their payouts.',
          label: 'Approve',
          minLength: 5,
        };
      case 'kyc-reject':
        return {
          title: `Reject ${handle}’s verification?`,
          body: 'The seller must re-submit. Payouts stay blocked.',
          label: 'Reject',
          danger: true,
          minLength: 5,
        };
    }
  }, [action, handle]);

  async function run(reason: string) {
    if (!action) return;
    const id = user.id;
    switch (action) {
      case 'ban':
        await adminFetch(`/admin/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isBanned: true, reason }),
        });
        toast('Member banned.');
        break;
      case 'unban':
        await adminFetch(`/admin/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isBanned: false, reason }),
        });
        toast('Ban lifted.');
        break;
      case 'close':
        await adminFetch(`/admin/users/${id}/close-account`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        });
        toast('Account closed. Records are retained.');
        break;
      case 'erase':
        await adminFetch(`/admin/users/${id}/erase`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        });
        toast('Erasure completed — identity documents purged.');
        break;
      case 'kyc-approve':
        await adminFetch(`/admin/users/${id}/kyc-review`, {
          method: 'POST',
          body: JSON.stringify({ decision: 'APPROVE', reason }),
        });
        toast('Verification approved.');
        break;
      case 'kyc-reject':
        await adminFetch(`/admin/users/${id}/kyc-review`, {
          method: 'POST',
          body: JSON.stringify({ decision: 'REJECT', reason }),
        });
        toast('Verification rejected.');
        break;
    }
    onChanged?.();
  }

  return (
    <>
      <div
        className="adm-label"
        style={{ color: isGod ? 'var(--adm-red)' : 'var(--adm-ink-2)' }}
      >
        {isGod ? 'Enforcement controls' : 'Read-only admin tier — no controls'}
      </div>

      <div className="adm-grid-2">
        <button
          type="button"
          className="adm-btn"
          data-tone={user.isBanned ? 'green' : 'red'}
          disabled={!isGod}
          onClick={() => setAction(user.isBanned ? 'unban' : 'ban')}
        >
          {user.isBanned ? 'Lift ban' : 'Ban member'}
        </button>
        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          disabled={!isGod}
          onClick={() => setAction('close')}
        >
          Close account
        </button>
        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          disabled={!isGod}
          onClick={() => setClearStrikesOpen(true)}
        >
          Clear strikes
        </button>
        <button
          type="button"
          className="adm-btn"
          data-tone="red"
          disabled={!isGod}
          onClick={() => setAction('erase')}
        >
          Erase data
        </button>
      </div>

      {user.kycStatus === 'UNDER_REVIEW' ? (
        <div className="adm-grid-2">
          <button
            type="button"
            className="adm-btn"
            data-tone="green"
            disabled={!isGod}
            onClick={() => setAction('kyc-approve')}
          >
            Approve verification
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone="red"
            disabled={!isGod}
            onClick={() => setAction('kyc-reject')}
          >
            Reject verification
          </button>
        </div>
      ) : null}

      {copy ? (
        <ReasonDialog
          open
          title={copy.title}
          body={copy.body}
          confirmLabel={copy.label}
          danger={copy.danger}
          minLength={copy.minLength}
          onClose={() => setAction(null)}
          onConfirm={run}
        />
      ) : null}

      <ConfirmDialog
        open={clearStrikesOpen}
        title="Clear seller reject strikes?"
        body="Removes the reject strikes that suspend this seller’s offers and resolves the related alerts. Use only where the rejections were not the seller’s fault."
        confirmLabel="Clear strikes"
        onClose={() => setClearStrikesOpen(false)}
        onConfirm={async () => {
          await adminFetch(`/admin/users/${user.id}/clear-reject-strikes`, {
            method: 'POST',
          });
          toast('Reject strikes cleared.');
          onChanged?.();
        }}
      />
    </>
  );
}
