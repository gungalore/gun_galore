'use client';

import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

/**
 * Sign out, on the account page.
 *
 * ⚠️ THIS EXISTS BECAUSE THE AVATAR STOPPED OPENING A MENU. Signing out used to
 * live ONLY inside the nav's avatar dropdown; when the avatar became a link to
 * this page (operator: "I don't like the dropdown list when clicking my profile
 * picture, that's why I opted for the tiles"), that was the sole desktop exit
 * and it would have gone with the dropdown. The design's Account board puts
 * "Log out" at the top right of the identity card, which is where this sits.
 *
 * Same behaviour as the dropdown's button had: sign out, then land on the
 * homepage rather than on a members-only page that is about to bounce.
 */
export function AccountSignOut() {
  const { signOut } = useClerk();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        // Guard the double-tap: signOut is a network round trip, and a second
        // click mid-flight throws rather than doing nothing.
        if (busy) return;
        setBusy(true);
        try {
          await signOut();
          router.push('/');
        } catch {
          // Leave the member on the page they were on rather than stranding
          // them on a half-signed-out screen with a dead button.
          setBusy(false);
        }
      }}
      className="text-sm shrink-0"
      style={{
        color: 'var(--red)',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.6 : 1,
        // Phase 0's token: the opacity change is a state, so it gets a
        // transition rather than snapping.
        transition: 'opacity var(--dur-fast) var(--ease-standard)',
      }}
    >
      {busy ? 'Signing out…' : 'Log out'}
    </button>
  );
}
