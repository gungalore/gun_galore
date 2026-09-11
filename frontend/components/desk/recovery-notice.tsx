'use client';

/**
 * THE DESK — "this session can read but not change anything."
 *
 * 🚨 A SUPERADMIN SILENTLY UNABLE TO WRITE READS AS A BROKEN PANEL. A session
 * opened with a recovery code is `recoveryOnly`, and AdminJwtGuard checks that
 * BEFORE the role — so every decision, every payout, every reject comes back
 * 403 with a sentence the operator only sees after they have already tried.
 * Nothing else on any surface would have said why: `recoveryOnly` is not a JWT
 * claim and `GET /admin/auth/me` does not return it, so without this strip the
 * only signal is the pattern of refusals.
 *
 * ⚠️ IT RENDERS ON THE SHELL, WHICH IS WHAT "EVERY SURFACE" MEANS HERE.
 * DeskShell is mounted by all five boards (desk, ledger, people, pulse, site)
 * and by nothing else, so those five are covered — and a sixth board would
 * inherit it by mounting the shell, which every board does. It does NOT cover
 * /admin/login or /admin/logout, which have their own layouts and no shell;
 * that is correct, because there is no session there to describe.
 *
 * ⚠️ NO NEW `.dk-` CLASS. tokens.css is at the 19-class cap that
 * scripts/desk-guard.cjs enforces, so this is inline style off the warn trio —
 * the same shape the admin drawer's confirm blocks use.
 */
import * as React from 'react';
import { IconAlert } from './icons';
import { isRecoveryOnlySession, subscribeDeskSession } from '@/lib/desk-auth';

/**
 * ⚠️ useSyncExternalStore, NOT useState-in-an-effect. The flag changes when a
 * silent refresh answers — which happens while the operator is mid-board, in
 * a tab that never saw a login response — and localStorage fires no event in
 * the tab that wrote it. The server snapshot is `false` because the server
 * cannot read localStorage, and a banner in the first paint that vanishes on
 * hydration is a hydration mismatch as well as a lie.
 */
export function useRecoveryOnly(): boolean {
  return React.useSyncExternalStore(
    subscribeDeskSession,
    isRecoveryOnlySession,
    () => false,
  );
}

export function RecoveryNotice({ onEnrol }: { onEnrol?: () => void }) {
  const recoveryOnly = useRecoveryOnly();
  if (!recoveryOnly) return null;

  return (
    <div
      role="status"
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '9px 16px',
        borderBottom: '1px solid var(--dk-warn-line)',
        background: 'var(--dk-warn-wash)',
        color: 'var(--dk-ink)',
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <IconAlert size={14} style={{ flex: 'none', marginTop: 1, color: 'var(--dk-warn)' }} />
      <span>
        This session was opened without your authenticator, so it can read everything and change
        nothing. Set up your authenticator, then sign out and back in with it.
        {onEnrol ? (
          <>
            {' '}
            <button
              type="button"
              onClick={onEnrol}
              style={{
                // ⚠️ 44px UNDER 1024px VIA --dk-h-control. This was a 17px word
                // run inside a wrapping sentence — the only action on a strip
                // whose whole job is telling the operator how to get their
                // write access back, and the guard's own refusal text points
                // at it. Inline-flex so it stays inside the sentence while
                // still being a real target.
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 'var(--dk-h-control)',
                padding: '0 2px',
                background: 'none',
                border: 'none',
                font: 'inherit',
                color: 'var(--dk-ink)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Open your account
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}
