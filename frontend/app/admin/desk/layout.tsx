/**
 * THE DESK — the shell for the four live surfaces.
 *
 * Identical in job to the kit fixture's layout: it carries `data-desk`, the
 * two Geist variables and the token sheet. Kept as its own file rather than
 * shared, because the fixture is scaffolding that gets deleted and this one
 * is the product.
 *
 * ⚠️ NO TRANSFORM HERE OR ABOVE. See components/desk/shell.tsx — the fixed
 * drawer, the dialogs and the palette all anchor to the viewport, and a
 * transformed ancestor silently re-anchors them to this div.
 */
import * as React from 'react';
import { fontDesk, fontDeskMono } from '../../fonts';
import '../../../components/desk/tokens.css';
import { RequireDeskSession } from '../../../components/desk/require-desk-session';
import { DeskStatusProvider } from '../../../components/desk/desk-status';

/**
 * ⚠️ THE DESK LINKS ITS OWN MANIFEST, NOT THE SHOP'S.
 *
 * Without this line every /admin page carried the root <link rel="manifest">
 * to /manifest.webmanifest, whose id/start_url/scope are all '/'. So adding
 * the Desk to a home screen installed the SHOP — its name, its icon, and a
 * launch into the storefront — and no setting on the phone could change it.
 *
 * The manifest itself is served by app/admin/manifest.webmanifest/route.ts;
 * see the note there for why it is a route handler and not a manifest.ts.
 */
export const metadata = {
  manifest: '/admin/manifest.webmanifest',
};

/**
 * The Desk paints its own browser chrome.
 *
 * Without this the Desk inherited the SHOP's theme-color, #F6F5F1 — the cream
 * of the white retail skin — so on a phone the status bar and the pull-to-
 * refresh gutter rendered near-white directly above a #101312 near-black app.
 * On an installed home-screen icon that is the first and last thing seen on
 * every launch.
 *
 * ⚠️ --dk-ground's literal value, not a var(). This is a meta tag, resolved by
 * the browser chrome long before any stylesheet is parsed; a var() here
 * resolves to nothing and the tag is silently dropped. Keep it in step with
 * components/desk/tokens.css — it is the one place the palette is duplicated,
 * and the only place it has to be.
 */
export const viewport = {
  themeColor: '#101312',
};

export default function DeskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-desk=""
      className={`${fontDesk.variable} ${fontDeskMono.variable}`}
      style={{ minHeight: '100vh' }}
    >
      {/* The gate for every board under /admin/desk. See the component:
          `/admin(.*)` is public in middleware because the admin runs its own
          JWT, so nothing upstream stops a signed-out visitor.

          🚨 THE STATUS POLL MOUNTS HERE AND NOWHERE ELSE, FOR TWO REASONS.
          (1) This layout is the only node under /admin/desk that SURVIVES a
          tab press — every board renders its own <DeskShell>, so that subtree
          unmounts and remounts on each navigation and a timer inside it would
          restart and re-fetch every time, which is four polls wearing one
          name. (2) It is INSIDE the gate, so nothing polls an authenticated
          API for a signed-out visitor sitting on the sign-in screen.

          ⚠️ AND IT IS A SEPARATE 'use client' FILE RATHER THAN A PRAGMA ON
          THIS ONE. This layout exports `metadata` and `viewport`, both of
          which are server-only — adding 'use client' here would drop the
          Desk's own manifest link and the themeColor declared above, and the
          symptom is a near-white status bar over a near-black app plus "Add to
          Home Screen" installing the SHOP.

          (The colour is deliberately not repeated in this sentence: a JSX
          comment is not stripped by desk-guard's per-line comment matcher —
          only a block comment whose continuation lines start with `*` is — so
          naming the literal here fails the build for documenting itself.) */}
      <RequireDeskSession>
        <DeskStatusProvider>{children}</DeskStatusProvider>
      </RequireDeskSession>
    </div>
  );
}
