'use client';

/**
 * Sign out, honestly.
 *
 * ⚠️ THIS REPLACES A ROUTE HANDLER THAT COULD NOT DO ITS JOB.
 *
 * `app/admin/logout/route.ts` was a server GET that deleted the
 * `gg_admin_sess` cookie and redirected. But the cookie is the SECONDARY
 * store — the credential the guard actually reads is the JWT in
 * `localStorage.gg_admin_token`, and a server route cannot touch
 * localStorage. So "log out" cleared the half nothing authenticates with and
 * left the half that does, for its full 8-hour life. lib/desk-auth.ts was
 * written to close exactly that hole, and this path was still open.
 *
 * It could not be fixed in place, only moved: the work has to happen in the
 * browser. Kept at the same path so an existing bookmark still does the right
 * thing, rather than 404ing and leaving the session alive.
 */

import * as React from 'react';
import { DESK_SIGN_IN_PATH, signOutOfDesk } from '../../../lib/desk-auth';

export default function AdminLogoutPage() {
  React.useEffect(() => {
    signOutOfDesk();
    // replace(), so the browser's back button cannot return to a page that
    // will immediately bounce. Hard navigation rather than router.replace so
    // every module holding the old token is dropped with the document.
    window.location.replace(DESK_SIGN_IN_PATH);
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--dk-ground)',
        color: 'var(--dk-ink-3)',
        fontSize: 12.5,
      }}
    >
      Signing out…
    </main>
  );
}
