'use client';

/**
 * THE DESK — the session gate for the whole subtree.
 *
 * 🚨 WITHOUT THIS, /admin/desk RENDERS ITS SHELL TO ANYONE. `/admin(.*)` is a
 * PUBLIC route in middleware.ts, deliberately — the admin does not use Clerk,
 * it uses its own JWT — so nothing upstream turns a signed-out visitor away.
 * The legacy panel handles that by calling requireAdminToken() inside every
 * page; the Desk shipped with requireDeskToken() exported and called by no
 * page at all. The boards' own fetches would have failed with 401s, so what a
 * stranger saw was the operator's chrome, the board names, and a screenful of
 * errors — not data, but not a closed door either.
 *
 * ⚠️ IT LIVES IN THE LAYOUT, NOT IN THE PAGES. Five pages each remembering to
 * call a guard is five chances to forget, and the sixth board somebody adds
 * next month starts life ungated. One gate over the subtree cannot be
 * forgotten by a new page, because the new page never has to know about it.
 *
 * ⚠️ IT RENDERS NOTHING UNTIL IT HAS LOOKED. The token lives in browser
 * storage, so the server render cannot know whether there is one. Painting the
 * boards first and redirecting afterwards would flash the admin's structure at
 * exactly the visitor it is meant to turn away.
 */
import * as React from 'react';
import { getDeskToken, DESK_SIGN_IN_PATH } from '@/lib/desk-auth';

type Checked = 'looking' | 'in' | 'out';

export function RequireDeskSession({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<Checked>('looking');

  React.useEffect(() => {
    if (getDeskToken()) {
      setState('in');
      return;
    }
    setState('out');
    // replace(), not href: a bounce should not put the closed door in the
    // visitor's history for the Back button to walk into again.
    window.location.replace(DESK_SIGN_IN_PATH);
  }, []);

  if (state === 'in') return <>{children}</>;

  // Deliberately bare, and deliberately not "Access denied" — the Desk's
  // existence is not a thing to advertise to someone who cannot open it.
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--dk-ink-3)',
        fontSize: 13,
      }}
    >
      {state === 'looking' ? '' : 'Signing in…'}
    </div>
  );
}
