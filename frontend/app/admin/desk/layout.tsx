/**
 * THE DESK — the shell for the five live surfaces.
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
          JWT, so nothing upstream stops a signed-out visitor. */}
      <RequireDeskSession>{children}</RequireDeskSession>
    </div>
  );
}
