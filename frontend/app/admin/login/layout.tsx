/**
 * The Desk's front door.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE SIGN-IN SCREEN WAS THE WRONG PRODUCT.
 *
 * `app/admin/login` sat outside `app/admin/desk`, so it inherited nothing: no
 * `data-desk`, so the token sheet did not apply and the page reached for the
 * storefront's `--bg` / `--bg-card` / `--red` instead; the SHOP's manifest, so
 * installing from the sign-in screen installed the storefront; and the shop's
 * `themeColor: #F6F5F1`, so the browser chrome painted cream above it.
 *
 * That was not a cosmetic problem. The installed PWA's `start_url` is
 * `/admin/desk`, and an expired token redirects here — so this cream card with
 * a brand-red button was the FIRST screen of a near-black control room on most
 * mornings. `scripts/desk-guard.cjs` would have caught every one of those
 * tokens; it simply was not looking at this directory. It is now.
 *
 * Deliberately NOT wrapped in <RequireDeskSession>: this is the one page under
 * /admin that a signed-out visitor is supposed to reach.
 *
 * ⚠️ NO TRANSFORM HERE OR ABOVE — same rule as the desk layout, for the same
 * reason (fixed-position descendants re-anchor to a transformed ancestor).
 */
import * as React from 'react';
import { fontDesk, fontDeskMono } from '../../fonts';
import '../../../components/desk/tokens.css';

/** The Desk's manifest, not the shop's. See app/admin/desk/layout.tsx. */
export const metadata = {
  manifest: '/admin/manifest.webmanifest',
};

/**
 * ⚠️ The literal, not a var(). A meta tag is read by the browser chrome before
 * any stylesheet is parsed, so `var(--dk-ground)` resolves to nothing and the
 * tag is dropped silently. Keep in step with components/desk/tokens.css.
 */
export const viewport = {
  themeColor: '#101312',
};

export default function AdminLoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-desk=""
      className={`${fontDesk.variable} ${fontDeskMono.variable}`}
      style={{ minHeight: '100vh' }}
    >
      {children}
    </div>
  );
}
