'use client';

// Thin client wrapper that decides whether to render the public-site
// chrome (Nav at the top, SiteFooter at the bottom). The root layout
// is server-rendered + wraps every route, but admin pages have their
// own layout/chrome and shouldn't show the public Nav or footer.
//
// Uses usePathname to detect /admin/* routes (and the /admin/login
// page which sits OUTSIDE the (protected) group but should still
// hide the public chrome).

import { usePathname } from 'next/navigation';
import { Nav } from '@/components/nav';
import { SiteFooter } from '@/components/site-footer';

export function PublicNav() {
  const pathname = usePathname();
  if (pathname.startsWith('/admin')) return null;
  return <Nav />;
}

export function PublicFooter() {
  const pathname = usePathname();
  // Hide on admin pages (own chrome) and on the offline fallback (PWA).
  if (pathname.startsWith('/admin')) return null;
  if (pathname === '/offline') return null;
  return <SiteFooter />;
}
