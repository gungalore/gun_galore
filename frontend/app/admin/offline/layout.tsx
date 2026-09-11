/**
 * THE DESK'S STAND-IN — the shell around the one page that has to render with
 * the network already gone.
 *
 * 🚨 IT IS AT /admin/offline AND NOT UNDER /admin/desk, AND THAT IS THE WHOLE
 * REASON IT WORKS. app/admin/desk/layout.tsx wraps every child in
 * <RequireDeskSession>, Next composes nested layouts, and a child route cannot
 * escape a parent one — so a page at /admin/desk/offline inherits the gate.
 * Offline, that gate finds an expired access token (fifteen minutes is the
 * ordinary resting state of a tab), calls refreshDeskSession(), gets
 * `unreachable` because the fetch throws, and does
 * `window.location.replace('/admin/login')`. /admin/login is network-only, so
 * that navigation fails too — and the operator lands on the browser's error
 * page, which is precisely what this page exists to replace. The stand-in
 * would have worked only inside a fifteen-minute window and failed silently
 * the rest of the time.
 *
 * There is no app/admin/layout.tsx, so this inherits the ROOT layout and
 * nothing else — no session gate, no shop chrome.
 *
 * ⚠️ NOTHING HERE MAY READ A SESSION, and not because of a rule: the document
 * is precached and served to whoever asks for it, so anything it renders is
 * rendered for everyone.
 *
 * Shape copied from app/admin/login/layout.tsx, which is the other page under
 * /admin that a signed-out visitor is supposed to reach. Kept as its own file
 * for the same reason that one is: near-identical is not identical, and the
 * two will diverge.
 */
import * as React from 'react';
import { fontDesk, fontDeskMono } from '../../fonts';
import '../../../components/desk/tokens.css';

/** The Desk's manifest, not the shop's. See app/admin/desk-manifest.ts. */
export const metadata = {
  manifest: '/admin/manifest.webmanifest',
  title: 'Offline — the Desk',
};

/**
 * ⚠️ The literal, not a var(). A meta tag is read by the browser chrome before
 * any stylesheet is parsed, so `var(--dk-ground)` resolves to nothing and the
 * tag is dropped silently. Keep in step with components/desk/tokens.css.
 *
 * ⚠️ AND theme-sync.cjs MUST NOT LEARN ABOUT THIS FILE. That gate binds the
 * shop's --bg to app/manifest.ts and app/layout.tsx; the Desk is deliberately
 * exempt from it, because the Desk is a different colour on purpose.
 */
export const viewport = {
  themeColor: '#101312',
};

export default function AdminOfflineLayout({
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
