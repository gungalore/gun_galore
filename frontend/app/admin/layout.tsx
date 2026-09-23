import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './admin.css';

/**
 * THE ADMIN PWA'S ROOT — and it is deliberately NOT the shop.
 *
 * ⚠️ SEPARATE INSTALL. The shop manifest declares id/start_url/scope all `/`,
 * so "Add to Home Screen" from an admin page would install the STOREFRONT (the
 * old Desk shipped with exactly that bug). This layout overrides `manifest`
 * with its own, whose id and start_url point at /admin/warden and whose scope
 * is /admin/ — two installed apps that cannot be confused for one another.
 *
 * ⚠️ THE THEME IS SCOPED TO `.admin-os`. Nothing in admin.css touches `:root`,
 * so the white shop is untouched by any value here. `app/globals.css` still
 * loads (the root layout owns it) and its box-shadow kill switch still applies.
 */

export const metadata: Metadata = {
  title: 'Warden — ALL Outdoor',
  description: 'Operations console for ALL Outdoor.',
  manifest: '/admin/manifest.webmanifest',
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: 'Warden',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#030507',
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin-os">{children}</div>;
}
