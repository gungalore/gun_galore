/**
 * The sign-out page renders for a fraction of a second, and it must not do it
 * in the storefront's cream. Same three jobs as the sign-in layout, same
 * reason — see app/admin/login/layout.tsx.
 *
 * Deliberately NOT wrapped in <RequireDeskSession>: gating the exit behind a
 * session means a half-expired one cannot sign itself out.
 */
import * as React from 'react';
import { fontDesk, fontDeskMono } from '../../fonts';
import '../../../components/desk/tokens.css';

export const metadata = {
  manifest: '/admin/manifest.webmanifest',
};

export const viewport = {
  themeColor: '#101312',
};

export default function AdminLogoutLayout({
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
