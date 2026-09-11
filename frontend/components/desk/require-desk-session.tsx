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
 *
 * 🚨 AND "NO TOKEN" STOPPED MEANING "SIGNED OUT" THE DAY THE ACCESS TOKEN
 * BECAME FIFTEEN MINUTES. getDeskToken() returns null for an EXPIRED token,
 * which is the ordinary resting state of a tab left open over lunch — so this
 * gate bounced the operator to sign in while a thirty-day refresh cookie sat
 * untouched in the browser. Reloading a board after fifteen minutes cost a
 * password. It asks the refresh route first now, and only a refusal is a
 * sign-out.
 */
import * as React from 'react';
import { getDeskToken, refreshDeskSession, DESK_SIGN_IN_PATH } from '@/lib/desk-auth';

type Checked = 'looking' | 'in' | 'out';

export function RequireDeskSession({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<Checked>('looking');

  React.useEffect(() => {
    let live = true;
    if (getDeskToken()) {
      setState('in');
      return;
    }

    // ⚠️ SHARED SINGLE-FLIGHT. This fires at the same moment as the boards'
    // own reads, and refreshDeskSession() hands every caller the same promise
    // rather than starting a second rotation of the same refresh token. See
    // its header for exactly what that avoids — the server's thirty-second
    // grace window covers the simultaneous case, and single-flight is what
    // stops us depending on it.
    void refreshDeskSession().then((outcome) => {
      if (!live) return;
      if (outcome.kind === 'renewed') {
        setState('in');
        return;
      }
      // `unreachable` lands here too, and deliberately: without a usable
      // access token every board renders a screen of failures, so the sign-in
      // page is the more honest place to be.
      //
      // ⚠️ THIS BOUNCE DOES END THE SESSION, and a comment here used to say it
      // did not ("clearDeskToken is only called on a refusal, inside the
      // refresh" — nothing in the refresh clears anything). The sign-in page
      // clears on mount AND revokes server-side, so arriving here on a merely
      // UNREACHABLE server costs a password. That is the deliberate trade: the
      // alternative is a door that looks closed and is not.
      setState('out');
      // replace(), not href: a bounce should not put the closed door in the
      // visitor's history for the Back button to walk into again.
      window.location.replace(DESK_SIGN_IN_PATH);
    });

    return () => {
      live = false;
    };
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
